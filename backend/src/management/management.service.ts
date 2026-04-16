import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import type { CreateGroupDto } from './dto/create-group.dto';
import type { UpdateGroupSettingsDto } from './dto/update-group-settings.dto';
import type { UpdatePanelGlobalSettingsDto } from './dto/update-panel-global-settings.dto';
import { ConfigService } from '@nestjs/config';
import type { PanelUser } from '@prisma/client';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from '../telegram/telegram.service';
import {
  sliceAnnounceForHappPreservingGroupLines,
  sliceAnnounceForHappSubscription,
  sliceProfileTitleForHappSubscription,
} from '../common/profile-title-header';
import {
  ensureUngroupedConnectGroupExists,
  isReservedUngroupedConnectGroupName,
  normalizeConnectGroupNamesForStorage,
} from '../common/ungrouped-connect-group';
import { withPrismaWriteRetry } from '../common/prisma-write-retry';
import type { SubscriptionAccessMeta } from '../common/subscription-client-meta';
import { uriToOutbound } from '../subscriptions/uri-to-outbound.util';
import {
  SUBSCRIPTION_ACCESS_NOTIFY_JOB,
  SUBSCRIPTION_ACCESS_NOTIFY_QUEUE,
} from '../subscription-access-notify/subscription-access-notify.constants';

@Injectable()
export class ManagementService implements OnModuleInit {
  private readonly logger = new Logger(ManagementService.name);
  private panelUserGroupsBackfillDone = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly telegramService: TelegramService,
    @InjectQueue(SUBSCRIPTION_ACCESS_NOTIFY_QUEUE)
    private readonly subscriptionAccessNotifyQueue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensurePanelUserGroupNamesBackfill();
  }

  /**
   * Однократно: перенос legacy поля groupName → groupNames в MongoDB после смены схемы Prisma.
   */
  private async ensurePanelUserGroupNamesBackfill(): Promise<void> {
    if (this.panelUserGroupsBackfillDone) {
      return;
    }
    try {
      await this.prisma.$runCommandRaw({
        update: 'PanelUser',
        updates: [
          {
            q: {},
            u: [
              {
                $set: {
                  groupNames: {
                    $cond: {
                      if: {
                        $gt: [{ $size: { $ifNull: ['$groupNames', []] } }, 0],
                      },
                      then: '$groupNames',
                      else: {
                        $cond: {
                          if: {
                            $gt: [
                              {
                                $strLenCP: {
                                  $toString: { $ifNull: ['$groupName', ''] },
                                },
                              },
                              0,
                            ],
                          },
                          then: [{ $toString: '$groupName' }],
                          else: [],
                        },
                      },
                    },
                  },
                },
              },
            ],
            multi: true,
          },
        ],
      });
    } catch (e) {
      this.logger.warn(
        `PanelUser groupNames backfill: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    this.panelUserGroupsBackfillDone = true;
  }

  /**
   * Уникальные группы пользователя с сохранением порядка из `groupNames`
   * (пустые отбрасываются; дубликаты по NFC+lower схлопываются).
   */
  private orderedUniquePanelUserGroupNames(
    user: Pick<PanelUser, 'groupNames'>,
  ): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    const normKey = (s: string) => s.trim().normalize('NFC').toLowerCase();
    for (const g of user.groupNames ?? []) {
      const t = g.trim();
      if (!t) {
        continue;
      }
      const k = normKey(t);
      if (seen.has(k)) {
        continue;
      }
      seen.add(k);
      out.push(t);
    }
    return out;
  }

  /** Как orderedUniquePanelUserGroupNames, для входных массивов из DTO. */
  private dedupeOrderedInputGroupNames(names: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    const normKey = (s: string) => s.trim().normalize('NFC').toLowerCase();
    for (const g of names) {
      const t = g.trim();
      if (!t) {
        continue;
      }
      const k = normKey(t);
      if (seen.has(k)) {
        continue;
      }
      seen.add(k);
      out.push(t);
    }
    return out;
  }

  private async assertPanelGroupNamesExist(names: string[]): Promise<void> {
    const cleaned = Array.from(
      new Set(names.map((n) => n.trim()).filter((n) => n.length > 0)),
    );
    if (cleaned.length === 0) {
      throw new BadRequestException('Укажите хотя бы одну группу');
    }
    for (const n of cleaned) {
      const g = await this.prisma.group.findUnique({ where: { name: n } });
      if (!g) {
        throw new BadRequestException(`Группа не найдена: ${n}`);
      }
    }
  }

  private subscriptionPrefNormKey(s: string): string {
    return s.trim().normalize('NFC').toLowerCase();
  }

  private parseStoredSubscriptionPrefs(raw: unknown): Array<{
    name: string;
    include: boolean;
  }> | null {
    if (!Array.isArray(raw)) {
      return null;
    }
    const out: Array<{ name: string; include: boolean }> = [];
    for (const row of raw) {
      if (!row || typeof row !== 'object') {
        continue;
      }
      const o = row as Record<string, unknown>;
      if (typeof o.name !== 'string') {
        continue;
      }
      const name = o.name.trim();
      if (!name) {
        continue;
      }
      out.push({
        name,
        include: o.include !== false,
      });
    }
    return out.length > 0 ? out : null;
  }

  /**
   * Порядок групп и флаги «в ленту»: из subscriptionGroupPrefs (только имена из membership),
   * затем недостающие группы с include=true.
   */
  getEffectiveSubscriptionGroupEntries(user: {
    groupNames: string[];
    subscriptionGroupPrefs: unknown;
  }): Array<{ name: string; include: boolean }> {
    const membership = this.orderedUniquePanelUserGroupNames({
      groupNames: user.groupNames,
    });
    const memSet = new Set(membership);
    const parsed = this.parseStoredSubscriptionPrefs(
      user.subscriptionGroupPrefs,
    );
    if (!parsed) {
      return membership.map((name) => ({ name, include: true }));
    }
    const seenKeys = new Set<string>();
    const out: Array<{ name: string; include: boolean }> = [];
    for (const p of parsed) {
      if (!memSet.has(p.name)) {
        continue;
      }
      const k = this.subscriptionPrefNormKey(p.name);
      if (seenKeys.has(k)) {
        continue;
      }
      seenKeys.add(k);
      out.push({ name: p.name, include: p.include });
    }
    for (const name of membership) {
      const k = this.subscriptionPrefNormKey(name);
      if (!seenKeys.has(k)) {
        seenKeys.add(k);
        out.push({ name, include: true });
      }
    }
    return out;
  }

  private async syncSubscriptionPrefsAfterGroupRename(
    oldName: string,
    newName: string,
  ): Promise<void> {
    const users = await this.prisma.panelUser.findMany({
      select: { id: true, subscriptionGroupPrefs: true },
    });
    for (const u of users) {
      const prefs = this.parseStoredSubscriptionPrefs(u.subscriptionGroupPrefs);
      if (!prefs) {
        continue;
      }
      let changed = false;
      const next = prefs.map((p) => {
        if (p.name === oldName) {
          changed = true;
          return { name: newName, include: p.include };
        }
        return { name: p.name, include: p.include };
      });
      if (changed) {
        await this.prisma.panelUser.update({
          where: { id: u.id },
          data: { subscriptionGroupPrefs: next },
        });
      }
    }
  }

  /** Не отдаём subscriptionAccessToken в API панели. */
  private omitSubscriptionAccessToken<
    T extends { subscriptionAccessToken?: string | null },
  >(row: T): Omit<T, 'subscriptionAccessToken'> {
    const { subscriptionAccessToken: _omit, ...rest } = row;
    return rest;
  }

  private static readonly PANEL_GLOBAL_SETTINGS_ID = 'global';
  private groupSortOrderBackfillDone = false;

  /** Однократно: у всех групп был sortOrder по умолчанию 0 — выставляем 0..n-1 по дате создания. */
  private async ensureGroupSortOrderBackfill(): Promise<void> {
    if (this.groupSortOrderBackfillDone) {
      return;
    }
    const all = await this.prisma.group.findMany({
      orderBy: [{ createdAt: 'asc' }],
    });
    if (all.length <= 1) {
      this.groupSortOrderBackfillDone = true;
      return;
    }
    const firstOrder = all[0]?.sortOrder ?? 0;
    const allSame = all.every((g) => (g.sortOrder ?? 0) === firstOrder);
    if (allSame) {
      for (let i = 0; i < all.length; i += 1) {
        await this.prisma.group.update({
          where: { id: all[i].id },
          data: { sortOrder: i },
        });
      }
    }
    this.groupSortOrderBackfillDone = true;
  }

  async listGroups() {
    await this.ensureGroupSortOrderBackfill();
    await ensureUngroupedConnectGroupExists(this.prisma);
    const groups = await this.prisma.group.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    const nameSet = new Set(groups.map((g) => g.name));
    const [activeConnects, panelUsers] = await Promise.all([
      this.prisma.connect.findMany({
        where: { status: 'ACTIVE' },
        select: { groupNames: true },
      }),
      this.prisma.panelUser.findMany({
        select: { groupNames: true },
      }),
    ]);
    const connectCount = new Map<string, number>(
      groups.map((g) => [g.name, 0]),
    );
    const userCount = new Map<string, number>(groups.map((g) => [g.name, 0]));
    for (const c of activeConnects) {
      for (const gn of c.groupNames) {
        if (nameSet.has(gn)) {
          connectCount.set(gn, (connectCount.get(gn) ?? 0) + 1);
        }
      }
    }
    for (const u of panelUsers) {
      for (const gn of u.groupNames) {
        if (nameSet.has(gn)) {
          userCount.set(gn, (userCount.get(gn) ?? 0) + 1);
        }
      }
    }
    return groups.map((g) => ({
      ...g,
      isMainGroup: g.isMainGroup === true,
      activeConnectCount: connectCount.get(g.name) ?? 0,
      panelUserCount: userCount.get(g.name) ?? 0,
    }));
  }

  async reorderGroups(ids: string[]): Promise<{ success: boolean }> {
    await this.ensureGroupSortOrderBackfill();
    const uniq = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
    const all = await this.prisma.group.findMany({ select: { id: true } });
    if (uniq.length !== all.length) {
      throw new BadRequestException(
        'Список идентификаторов должен включать все группы без пропусков и дубликатов',
      );
    }
    const idSet = new Set(all.map((g) => g.id));
    for (const id of uniq) {
      if (!idSet.has(id)) {
        throw new BadRequestException(`Неизвестная группа: ${id}`);
      }
    }
    for (let i = 0; i < uniq.length; i += 1) {
      await this.prisma.group.update({
        where: { id: uniq[i] },
        data: { sortOrder: i },
      });
    }
    return { success: true };
  }

  /** Настройки панели для подписки Happ и уведомлений Telegram */
  async getPanelGlobalSettings(): Promise<{
    subscriptionAnnounce: string | null;
    profileUpdateInterval: number | null;
    telegramBotSecret: string | null;
    telegramGroupId: string | null;
    routingConfig: string | null;
  }> {
    const row = await this.prisma.panelGlobalSettings.findUnique({
      where: { id: ManagementService.PANEL_GLOBAL_SETTINGS_ID },
      select: {
        subscriptionAnnounce: true,
        profileUpdateInterval: true,
        telegramBotSecret: true,
        telegramGroupId: true,
        routingConfig: true,
      },
    });
    const h = row?.profileUpdateInterval;
    const intervalOk =
      typeof h === 'number' && Number.isFinite(h) && Math.floor(h) >= 1
        ? Math.floor(h)
        : null;
    return {
      subscriptionAnnounce: row?.subscriptionAnnounce?.trim() || null,
      profileUpdateInterval: intervalOk,
      telegramBotSecret: row?.telegramBotSecret?.trim() || null,
      telegramGroupId: row?.telegramGroupId?.trim() || null,
      routingConfig: row?.routingConfig?.trim() || null,
    };
  }

  async updatePanelGlobalSettings(dto: UpdatePanelGlobalSettingsDto): Promise<{
    subscriptionAnnounce: string | null;
    profileUpdateInterval: number | null;
    telegramBotSecret: string | null;
    telegramGroupId: string | null;
    routingConfig: string | null;
  }> {
    const patch: {
      subscriptionAnnounce?: string | null;
      profileUpdateInterval?: number | null;
      telegramBotSecret?: string | null;
      telegramGroupId?: string | null;
      routingConfig?: string | null;
    } = {};

    if (dto.subscriptionAnnounce !== undefined) {
      const t = dto.subscriptionAnnounce.trim();
      patch.subscriptionAnnounce =
        t === '' ? null : sliceAnnounceForHappSubscription(t) || null;
    }
    if (dto.profileUpdateInterval !== undefined) {
      patch.profileUpdateInterval =
        dto.profileUpdateInterval === null
          ? null
          : Math.min(8760, Math.max(1, Math.floor(dto.profileUpdateInterval)));
    }
    if (dto.telegramBotSecret !== undefined) {
      const t = dto.telegramBotSecret.trim();
      patch.telegramBotSecret = t === '' ? null : t;
    }
    if (dto.telegramGroupId !== undefined) {
      const t = dto.telegramGroupId.trim();
      patch.telegramGroupId = t === '' ? null : t;
    }
    if (dto.routingConfig !== undefined) {
      const t = dto.routingConfig.trim();
      patch.routingConfig = t === '' ? null : t;
    }

    if (Object.keys(patch).length === 0) {
      return this.getPanelGlobalSettings();
    }

    await this.prisma.panelGlobalSettings.upsert({
      where: { id: ManagementService.PANEL_GLOBAL_SETTINGS_ID },
      create: {
        id: ManagementService.PANEL_GLOBAL_SETTINGS_ID,
        subscriptionAnnounce: patch.subscriptionAnnounce ?? null,
        profileUpdateInterval: patch.profileUpdateInterval ?? null,
        telegramBotSecret: patch.telegramBotSecret ?? null,
        telegramGroupId: patch.telegramGroupId ?? null,
        routingConfig: patch.routingConfig ?? null,
      },
      update: patch,
    });
    return this.getPanelGlobalSettings();
  }

  /**
   * Проверка Telegram: отправить тестовое сообщение в сохранённый chat id.
   */
  async sendTelegramTestMessage(text?: string): Promise<{
    ok: true;
    messageId: number;
  }> {
    const row = await this.prisma.panelGlobalSettings.findUnique({
      where: { id: ManagementService.PANEL_GLOBAL_SETTINGS_ID },
      select: { telegramBotSecret: true, telegramGroupId: true },
    });
    const token = row?.telegramBotSecret?.trim() ?? '';
    const chatId = row?.telegramGroupId?.trim() ?? '';
    if (!token || !chatId) {
      throw new BadRequestException(
        'Сохраните TG Secret и TG group ID в настройках панели',
      );
    }
    const body =
      typeof text === 'string' && text.trim().length > 0
        ? text.trim()
        : 'Subscribe Panel — тест: бот настроен.';
    const r = await this.telegramService.sendMessage(token, chatId, body);
    if (!r.ok) {
      throw new BadRequestException(
        `Не удалось отправить в Telegram: ${r.error}`,
      );
    }
    return { ok: true, messageId: r.messageId };
  }

  /**
   * Строки #announce / #profile-update-interval и часы для заголовка Happ из сырых полей настроек.
   */
  private buildSubscriptionMetaLines(
    subscriptionAnnounceRaw: string | null | undefined,
    profileUpdateIntervalRaw: number | null | undefined,
  ): {
    announceMetaLine: string | null;
    profileUpdateIntervalMetaLine: string | null;
    profileUpdateIntervalHours: number | null;
  } {
    let announceMetaLine: string | null = null;
    const rawAnn = subscriptionAnnounceRaw?.trim();
    if (rawAnn) {
      const text = sliceAnnounceForHappPreservingGroupLines(rawAnn);
      if (text) {
        const b64 = Buffer.from(text, 'utf-8').toString('base64');
        announceMetaLine = `#announce: base64:${b64}`;
      }
    }

    const h = profileUpdateIntervalRaw;
    const profileUpdateIntervalHours =
      typeof h === 'number' && Number.isFinite(h) && Math.floor(h) >= 1
        ? Math.min(8760, Math.floor(h))
        : null;
    const profileUpdateIntervalMetaLine =
      profileUpdateIntervalHours !== null
        ? `#profile-update-interval: ${profileUpdateIntervalHours}`
        : null;

    return {
      announceMetaLine,
      profileUpdateIntervalMetaLine,
      profileUpdateIntervalHours,
    };
  }

  /**
   * Глобальные мета-строки (только PanelGlobalSettings).
   */
  async getSubscriptionGlobalMetaFromSettings(): Promise<{
    announceMetaLine: string | null;
    profileUpdateIntervalMetaLine: string | null;
    profileUpdateIntervalHours: number | null;
  }> {
    const row = await this.prisma.panelGlobalSettings.findUnique({
      where: { id: ManagementService.PANEL_GLOBAL_SETTINGS_ID },
      select: { subscriptionAnnounce: true, profileUpdateInterval: true },
    });
    return this.buildSubscriptionMetaLines(
      row?.subscriptionAnnounce,
      row?.profileUpdateInterval,
    );
  }

  /**
   * Порядок имён для меты Happ: сначала включённые группы из персональных настроек,
   * затем остальные из getOrderedPanelUserGroupNames (без дубликатов).
   */
  private async getOrderedNamesForPublicSubMeta(
    user: PanelUser,
  ): Promise<string[]> {
    const included = this.getEffectiveSubscriptionGroupEntries(user)
      .filter((e) => e.include)
      .map((e) => e.name);
    const seen = new Set<string>();
    const normKey = (s: string) => s.trim().normalize('NFC').toLowerCase();
    const out: string[] = [];
    for (const n of included) {
      const t = n.trim();
      if (!t) {
        continue;
      }
      const k = normKey(t);
      if (seen.has(k)) {
        continue;
      }
      seen.add(k);
      out.push(t);
    }
    const rest = await this.getOrderedPanelUserGroupNames(user);
    for (const n of rest) {
      const k = normKey(n);
      if (seen.has(k)) {
        continue;
      }
      seen.add(k);
      out.push(n);
    }
    return out;
  }

  /**
   * Суффикс объявления Happ: «Отображаются: …»; «Не отображаются: …» — только если есть скрытые группы.
   * У каждой группы в скобках — число активных коннектов с этим тегом (как в ленте /public/sub).
   */
  private async buildSubscriptionGroupAnnounceSuffixAsync(
    user: PanelUser,
  ): Promise<string | null> {
    const entries = this.getEffectiveSubscriptionGroupEntries(user);
    if (entries.length === 0) {
      return null;
    }
    const namesForCount = [
      ...new Set(
        entries
          .map((e) => e.name.trim())
          .filter((n) => n.length > 0),
      ),
    ];
    const counts: Record<string, number> =
      namesForCount.length > 0
        ? await this.countActiveConnectsByGroupNames(namesForCount)
        : {};
    const withCount = (n: string) => {
      const c = counts[n] ?? 0;
      return `${n} (${c})`;
    };
    const shown = entries
      .filter((e) => e.include)
      .map((e) => e.name.trim())
      .filter((n) => n.length > 0);
    const hidden = entries
      .filter((e) => !e.include)
      .map((e) => e.name.trim())
      .filter((n) => n.length > 0);
    const shownLine = `Отображаются: ${
      shown.length > 0 ? shown.map(withCount).join(', ') : '—'
    }`;
    if (hidden.length === 0) {
      return shownLine;
    }
    return `${shownLine}\nНе отображаются: ${hidden.map(withCount).join(', ')}`;
  }

  private async mergeSubscriptionAnnounceWithGroupLists(
    baseAnnounce: string | null | undefined,
    user: PanelUser | null,
  ): Promise<string | null> {
    const base = baseAnnounce?.trim() ?? '';
    const suffix = user
      ? await this.buildSubscriptionGroupAnnounceSuffixAsync(user)
      : null;
    if (!suffix && !base) {
      return null;
    }
    if (!suffix) {
      return base;
    }
    if (!base) {
      return suffix;
    }
    return `${base}\n${suffix}`;
  }

  /**
   * Мета для GET /public/sub: первая подходящая группа из порядка
   * (включённые из персональных настроек, затем прочие из ленты), наследование из глобальных настроек.
   */
  async getSubscriptionMetaForPublicSub(user: PanelUser | null): Promise<{
    announceMetaLine: string | null;
    profileUpdateIntervalMetaLine: string | null;
    profileUpdateIntervalHours: number | null;
    /** Ссылки/строки маршрутизации Happ из глобальных настроек панели (не наследуются с группы). */
    routingConfig: string | null;
  }> {
    const globalRow = await this.prisma.panelGlobalSettings.findUnique({
      where: { id: ManagementService.PANEL_GLOBAL_SETTINGS_ID },
      select: {
        subscriptionAnnounce: true,
        profileUpdateInterval: true,
        routingConfig: true,
      },
    });

    let effectiveAnnounce: string | null | undefined =
      globalRow?.subscriptionAnnounce;
    let effectiveInterval: number | null | undefined =
      globalRow?.profileUpdateInterval;

    if (user) {
      const ordered = await this.getOrderedNamesForPublicSubMeta(user);
      for (const name of ordered) {
        const g = await this.findGroupRowByPanelGroupName(name);
        if (g) {
          const ga = g.subscriptionAnnounce?.trim();
          effectiveAnnounce =
            ga && ga.length > 0
              ? g.subscriptionAnnounce
              : globalRow?.subscriptionAnnounce;
          const gi = g.profileUpdateInterval;
          effectiveInterval =
            typeof gi === 'number' && Number.isFinite(gi) && Math.floor(gi) >= 1
              ? gi
              : globalRow?.profileUpdateInterval;
          break;
        }
      }
    }

    const announcePlain = await this.mergeSubscriptionAnnounceWithGroupLists(
      effectiveAnnounce,
      user,
    );
    const meta = this.buildSubscriptionMetaLines(
      announcePlain,
      effectiveInterval,
    );
    const routingTrimmed = globalRow?.routingConfig?.trim() || null;
    return {
      ...meta,
      routingConfig: routingTrimmed,
    };
  }

  /**
   * Агрегированный subscription-userinfo для пользователя панели:
   * суммирует использованный трафик по всем его подпискам,
   * берёт ближайшую (наименьшую) дату окончания.
   * Возвращает null если данных нет ни по одной подписке.
   */
  async resolveSubscriptionUserinfoForPanelUser(user: PanelUser): Promise<{
    uploadBytes: bigint;
    downloadBytes: bigint;
    totalBytes: bigint;
    expiresAt: Date | null;
  } | null> {
    // Находим все активные подписки, коннекты которых входят в ленту пользователя
    const entries = this.getEffectiveSubscriptionGroupEntries(user);
    const includedNames = entries.filter((e) => e.include).map((e) => e.name);
    if (includedNames.length === 0) return null;

    // Получаем уникальные subscriptionId из коннектов пользователя
    const connects = await this.prisma.connect.findMany({
      where: {
        status: 'ACTIVE',
        OR: includedNames.map((n) => ({ groupNames: { has: n } })),
      },
      select: { subscriptionId: true },
      distinct: ['subscriptionId'],
    });

    const subIds = connects
      .map((c) => c.subscriptionId)
      .filter((id): id is string => !!id);

    if (subIds.length === 0) return null;

    const subs = await this.prisma.subscription.findMany({
      where: { id: { in: subIds } },
      select: {
        fetchedTrafficUsedBytes: true,
        fetchedTrafficTotalBytes: true,
        fetchedSubscriptionExpiresAt: true,
      },
    });

    let hasAnyData = false;
    let usedTotal = 0n;
    let trafficTotal = 0n;
    let expiresAt: Date | null = null;

    for (const s of subs) {
      if (s.fetchedTrafficUsedBytes) {
        try {
          usedTotal += BigInt(s.fetchedTrafficUsedBytes);
          hasAnyData = true;
        } catch { /* пропускаем нечисловые */ }
      }
      if (s.fetchedTrafficTotalBytes) {
        try {
          trafficTotal += BigInt(s.fetchedTrafficTotalBytes);
          hasAnyData = true;
        } catch { /* пропускаем нечисловые */ }
      }
      if (s.fetchedSubscriptionExpiresAt) {
        hasAnyData = true;
        if (!expiresAt || s.fetchedSubscriptionExpiresAt < expiresAt) {
          expiresAt = s.fetchedSubscriptionExpiresAt;
        }
      }
    }

    if (!hasAnyData) return null;

    return {
      uploadBytes: 0n,
      downloadBytes: usedTotal,
      totalBytes: trafficTotal,
      expiresAt,
    };
  }

  /** Непустые строки из настройки routing (каждая — отдельная строка тела подписки до base64). */
  private routingBodyLinesFromPanelConfig(
    routingConfig: string | null | undefined,
  ): string[] {
    const raw = routingConfig?.trim();
    if (!raw) {
      return [];
    }
    return raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  }

  private prependRoutingLinesToSubscriptionPlaintext(
    routingConfig: string | null | undefined,
    bodyPlain: string,
  ): string {
    const lines = this.routingBodyLinesFromPanelConfig(routingConfig);
    if (lines.length === 0) {
      return bodyPlain;
    }
    return `${lines.join('\n')}\n${bodyPlain}`;
  }

  /**
   * Порядок имён групп для выбора настроек объявления/интервала: сначала группы пользователя панели
   * (порядок в PanelUser.groupNames), затем остальные из collectPublicDisplayGroupNames (без дубликатов).
   */
  private async getOrderedPanelUserGroupNames(
    user: PanelUser,
  ): Promise<string[]> {
    const primaries = this.orderedUniquePanelUserGroupNames(user);
    const allDisplayed = await this.collectPublicDisplayGroupNames(primaries);
    const seen = new Set<string>();
    const out: string[] = [];
    const normKey = (s: string) => s.trim().normalize('NFC').toLowerCase();
    const add = (n: string) => {
      const t = n.trim();
      if (!t) {
        return;
      }
      const k = normKey(t);
      if (seen.has(k)) {
        return;
      }
      seen.add(k);
      out.push(t);
    };
    for (const n of primaries) {
      add(n);
    }
    for (const n of allDisplayed) {
      add(n);
    }
    return out;
  }

  /** Запись Group по имени из панели (точное, NFC и регистронезависимое совпадение с Group.name). */
  private async findGroupRowByPanelGroupName(panelGroupName: string): Promise<{
    subscriptionAnnounce: string | null;
    profileUpdateInterval: number | null;
  } | null> {
    const trimmed = panelGroupName.trim();
    if (!trimmed) {
      return null;
    }
    const exact = await this.prisma.group.findUnique({
      where: { name: trimmed },
      select: { subscriptionAnnounce: true, profileUpdateInterval: true },
    });
    if (exact) {
      return exact;
    }
    const normalizedTarget = trimmed.normalize('NFC');
    const targetLower = normalizedTarget.toLowerCase();
    const groups = await this.prisma.group.findMany({
      select: {
        subscriptionAnnounce: true,
        profileUpdateInterval: true,
        name: true,
      },
    });
    const row =
      groups.find((g) => g.name.trim().normalize('NFC') === normalizedTarget) ??
      groups.find(
        (g) => g.name.trim().normalize('NFC').toLowerCase() === targetLower,
      );
    if (!row) {
      return null;
    }
    return {
      subscriptionAnnounce: row.subscriptionAnnounce,
      profileUpdateInterval: row.profileUpdateInterval,
    };
  }

  async createGroup(dto: CreateGroupDto) {
    const name = dto.name.trim();
    if (!name) {
      throw new BadRequestException('Имя группы не может быть пустым');
    }
    if (isReservedUngroupedConnectGroupName(name)) {
      throw new BadRequestException(
        'Группа «Без группы» создаётся автоматически для коннектов без тегов и не добавляется вручную',
      );
    }
    const agg = await this.prisma.group.aggregate({
      _max: { sortOrder: true },
    });
    const nextSortOrder = (agg._max.sortOrder ?? -1) + 1;

    const data: {
      name: string;
      sortOrder: number;
      isMainGroup: boolean;
      subscriptionDisplayName?: string | null;
      subscriptionAnnounce?: string | null;
      profileUpdateInterval?: number | null;
    } = {
      name,
      sortOrder: nextSortOrder,
      isMainGroup: dto.isMainGroup === true,
    };

    if (dto.subscriptionDisplayName !== undefined) {
      const t = (dto.subscriptionDisplayName ?? '').trim();
      data.subscriptionDisplayName = t === '' ? null : t;
    }
    if (dto.subscriptionAnnounce !== undefined) {
      if (dto.subscriptionAnnounce === null) {
        data.subscriptionAnnounce = null;
      } else {
        const t = dto.subscriptionAnnounce.trim();
        if (t !== '') {
          data.subscriptionAnnounce =
            sliceAnnounceForHappSubscription(t) || null;
        }
      }
    }
    if (dto.profileUpdateInterval !== undefined) {
      if (dto.profileUpdateInterval === null) {
        data.profileUpdateInterval = null;
      } else if (Number.isFinite(dto.profileUpdateInterval)) {
        data.profileUpdateInterval = Math.min(
          8760,
          Math.max(1, Math.floor(dto.profileUpdateInterval)),
        );
      }
    }

    return this.prisma.group.create({ data });
  }

  async deleteGroup(id: string) {
    const group = await this.prisma.group.findUnique({ where: { id } });
    if (!group) {
      throw new NotFoundException('Группа не найдена');
    }
    if (isReservedUngroupedConnectGroupName(group.name)) {
      throw new BadRequestException(
        'Служебную группу «Без группы» нельзя удалить',
      );
    }

    await this.prisma.group.delete({ where: { id } });

    await this.prisma.panelUser.deleteMany({
      where: { groupNames: { has: group.name } },
    });

    await this.prisma.$runCommandRaw({
      update: 'Connect',
      updates: [
        {
          q: {},
          u: { $pull: { groupNames: group.name } },
          multi: true,
        },
      ],
    });
  }

  async listUsers() {
    const users = await this.prisma.panelUser.findMany({
      orderBy: { createdAt: 'desc' },
    });
    const successOnly = { NOT: { success: false } };
    const aggregates = await this.prisma.panelUserAccessLog.groupBy({
      by: ['panelUserId'],
      _max: { createdAt: true },
      where: successOnly,
    });
    const lastByUser = new Map(
      aggregates.map((a) => [a.panelUserId, a._max.createdAt]),
    );
    const hwidPairs = await this.prisma.panelUserAccessLog.groupBy({
      by: ['panelUserId', 'hwid'],
      where: { hwid: { not: null }, ...successOnly },
    });
    const uniqueHwidCountByUser = new Map<string, number>();
    for (const row of hwidPairs) {
      if (!row.hwid) {
        continue;
      }
      uniqueHwidCountByUser.set(
        row.panelUserId,
        (uniqueHwidCountByUser.get(row.panelUserId) ?? 0) + 1,
      );
    }
    return users.map((u) => {
      const { subscriptionAccessToken: _omit, ...rest } = u;
      return {
        ...rest,
        lastSubscriptionActivityAt: lastByUser.get(u.id) ?? null,
        subscriptionUniqueHwidCount: uniqueHwidCountByUser.get(u.id) ?? 0,
      };
    });
  }

  /**
   * Выдаёт или создаёт subscriptionAccessToken. При первом создании сбрасывает happCryptoUrl,
   * чтобы пересоздать happ:// ссылку с URL, содержащим ?t=.
   */
  async ensureSubscriptionAccessToken(panelUserId: string): Promise<string> {
    const row = await this.prisma.panelUser.findUnique({
      where: { id: panelUserId },
      select: { subscriptionAccessToken: true },
    });
    const cur = row?.subscriptionAccessToken?.trim();
    if (cur) {
      return cur;
    }
    const token = randomBytes(32).toString('hex');
    await this.prisma.panelUser.update({
      where: { id: panelUserId },
      data: { subscriptionAccessToken: token, happCryptoUrl: null },
    });
    return token;
  }

  subscriptionFetchTokenMatches(
    provided: string | string[] | undefined,
    expected: string,
  ): boolean {
    const p =
      typeof provided === 'string'
        ? provided.trim()
        : Array.isArray(provided)
          ? String(provided[0] ?? '').trim()
          : '';
    const e = expected.trim();
    if (!p || !e) {
      return false;
    }
    try {
      const a = Buffer.from(p, 'utf8');
      const b = Buffer.from(e, 'utf8');
      if (a.length !== b.length) {
        return false;
      }
      return timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  async createUser(
    name: string,
    code: string,
    groupNamesInput: string[],
    cryptoOnlySubscription = false,
    allowAllUserAgents = false,
  ) {
    const groupNames = this.dedupeOrderedInputGroupNames(groupNamesInput);
    await this.assertPanelGroupNamesExist(groupNames);
    const trimmedCode = code.trim();
    const subscriptionAccessToken = randomBytes(32).toString('hex');
    const pageUrl = this.buildAbsoluteSubscriptionPageUrlForCrypto(
      trimmedCode,
      subscriptionAccessToken,
      cryptoOnlySubscription,
    );
    const happCryptoUrl = await this.fetchHappCryptoLink(pageUrl);
    const created = await this.prisma.panelUser.create({
      data: {
        name: name.trim(),
        code: trimmedCode,
        groupNames,
        allowAllUserAgents: Boolean(allowAllUserAgents),
        requireHwid: true,
        requireNoHwid: false,
        maxUniqueHwids: 0,
        subscriptionAccessToken,
        cryptoOnlySubscription: Boolean(cryptoOnlySubscription),
        ...(happCryptoUrl !== null ? { happCryptoUrl } : {}),
      },
    });
    return this.omitSubscriptionAccessToken(created);
  }

  /**
   * POST https://crypto.happ.su/api-v2.php — в ответе JSON с полем encrypted_link (happ://…).
   */
  private async fetchHappCryptoLink(
    subscriptionPageUrl: string,
  ): Promise<string | null> {
    const apiUrl = (
      this.config.get<string>('HAPP_CRYPTO_API_URL') ??
      'https://crypto.happ.su/api-v2.php'
    ).trim();
    const url = subscriptionPageUrl.trim();
    if (!apiUrl || !url.startsWith('http')) {
      this.logger.warn(
        `Пропуск запроса к HAPP crypto: неверный URL подписки («${url}») или endpoint («${apiUrl}»). ` +
          'Проверьте что FRONTEND_ORIGIN задан с https://.',
      );
      return null;
    }
    this.logger.log(`HAPP crypto API: отправляем URL → ${url}`);
    try {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ url }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        this.logger.warn(
          `HAPP crypto API: HTTP ${res.status} — ${body.slice(0, 200)}`,
        );
        return null;
      }
      const rawText = await res.text();
      this.logger.log(`HAPP crypto API: ответ → ${rawText.slice(0, 300)}`);
      let data: { encrypted_link?: unknown };
      try {
        data = JSON.parse(rawText) as { encrypted_link?: unknown };
      } catch {
        this.logger.warn(
          `HAPP crypto API: не удалось распарсить JSON: ${rawText.slice(0, 200)}`,
        );
        return null;
      }
      const link =
        typeof data.encrypted_link === 'string'
          ? data.encrypted_link.trim()
          : '';
      if (link.startsWith('happ://')) {
        this.logger.log(`HAPP crypto API: получена ссылка ${link.slice(0, 80)}…`);
        return link;
      }
      this.logger.warn(
        `HAPP crypto API: в ответе нет валидного encrypted_link, получено: ${JSON.stringify(data).slice(0, 200)}`,
      );
      return null;
    } catch (e) {
      this.logger.warn(
        `HAPP crypto API: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }

  /**
   * Абсолютный URL для crypto.happ.su: обычно /sub/CODE?t=…; при cryptoOnly — /{SUBSCRIPTION_CRYPTO_PATH_SEGMENT}/CODE?t=…
   */
  private buildAbsoluteSubscriptionPageUrlForCrypto(
    code: string,
    subscriptionAccessToken: string,
    cryptoOnlySubscription: boolean,
  ): string {
    const origin = this.subscriptionPublicOrigin();
    const path = cryptoOnlySubscription
      ? `/${this.subscriptionCryptoPathSegment()}/${encodeURIComponent(code)}`
      : `/sub/${encodeURIComponent(code)}`;
    let full = origin ? `${origin.replace(/\/$/, '')}${path}` : path;
    if (!full.startsWith('http')) {
      const fallback = (this.config.get<string>('FRONTEND_ORIGIN') ?? '')
        .trim()
        .replace(/\/$/, '');
      if (fallback) {
        full = `${fallback}${path}`;
      }
    }
    const sep = full.includes('?') ? '&' : '?';
    return `${full}${sep}t=${encodeURIComponent(subscriptionAccessToken)}`;
  }

  /** Сегмент пути альтернативной страницы подписки (совпадает с NUXT_PUBLIC_SUBSCRIPTION_CRYPTO_PATH) */
  private subscriptionCryptoPathSegment(): string {
    return (
      this.config.get<string>('SUBSCRIPTION_CRYPTO_PATH_SEGMENT') ?? ''
    )
      .trim()
      .replace(/^\/+|\/+$/g, '');
  }

  /**
   * Создать happ crypto-ссылку для существующего пользователя или вернуть уже сохранённую.
   */
  async createHappCryptoUrlForPanelUser(
    id: string,
  ): Promise<{ happCryptoUrl: string }> {
    await this.ensureUser(id);
    const token = await this.ensureSubscriptionAccessToken(id);
    const user = await this.prisma.panelUser.findUniqueOrThrow({
      where: { id },
      select: { code: true, happCryptoUrl: true, cryptoOnlySubscription: true },
    });
    const existing = user.happCryptoUrl?.trim();
    if (existing?.startsWith('happ://')) {
      return { happCryptoUrl: existing };
    }
    const pageUrl = this.buildAbsoluteSubscriptionPageUrlForCrypto(
      user.code,
      token,
      user.cryptoOnlySubscription === true,
    );
    const happCryptoUrl = await this.fetchHappCryptoLink(pageUrl);
    if (!happCryptoUrl) {
      throw new BadRequestException(
        'Не удалось получить ссылку от сервиса crypto.happ.su',
      );
    }
    await this.prisma.panelUser.update({
      where: { id },
      data: { happCryptoUrl },
    });
    return { happCryptoUrl };
  }

  async deleteUser(id: string) {
    await this.ensureUser(id);
    await this.prisma.panelUser.delete({ where: { id } });
  }

  async toggleUser(id: string) {
    const user = await this.ensureUser(id);
    const updated = await this.prisma.panelUser.update({
      where: { id },
      data: { enabled: !user.enabled },
    });
    return this.omitSubscriptionAccessToken(updated);
  }

  async updatePanelUser(
    id: string,
    dto: {
      enabled?: boolean;
      name?: string;
      code?: string;
      groupNames?: string[];
      allowAllUserAgents?: boolean;
      requireHwid?: boolean;
      requireNoHwid?: boolean;
      maxUniqueHwids?: number;
      cryptoOnlySubscription?: boolean;
      feedJsonMode?: boolean;
    },
  ) {
    await this.ensureUser(id);
    const current = await this.prisma.panelUser.findUniqueOrThrow({
      where: { id },
      select: { code: true, cryptoOnlySubscription: true },
    });

    const data: {
      enabled?: boolean;
      name?: string;
      code?: string;
      groupNames?: string[];
      subscriptionGroupPrefs?: null;
      allowAllUserAgents?: boolean;
      requireHwid?: boolean;
      requireNoHwid?: boolean;
      maxUniqueHwids?: number;
      cryptoOnlySubscription?: boolean;
      feedJsonMode?: boolean;
      happCryptoUrl?: string | null;
    } = {};

    let codeChanged = false;
    if (dto.code !== undefined) {
      const trimmed = dto.code.trim();
      if (!trimmed) {
        throw new BadRequestException('Код подписки не может быть пустым');
      }
      if (trimmed !== current.code) {
        const taken = await this.prisma.panelUser.findFirst({
          where: { code: trimmed, id: { not: id } },
          select: { id: true },
        });
        if (taken) {
          throw new BadRequestException('Код подписки уже используется');
        }
        data.code = trimmed;
        codeChanged = true;
      }
    }

    if (dto.enabled !== undefined) {
      data.enabled = dto.enabled;
    }
    if (dto.name !== undefined) {
      const trimmed = dto.name.trim();
      if (!trimmed) {
        throw new BadRequestException('Имя не может быть пустым');
      }
      data.name = trimmed;
    }
    if (dto.groupNames !== undefined) {
      const cleaned = this.dedupeOrderedInputGroupNames(dto.groupNames);
      await this.assertPanelGroupNamesExist(cleaned);
      data.groupNames = cleaned;
      data.subscriptionGroupPrefs = null;
    }
    if (dto.allowAllUserAgents !== undefined) {
      data.allowAllUserAgents = dto.allowAllUserAgents;
    }
    if (dto.requireHwid === true) {
      data.requireHwid = true;
      data.requireNoHwid = false;
    } else if (dto.requireHwid === false) {
      data.requireHwid = false;
    }
    if (dto.requireNoHwid === true) {
      data.requireNoHwid = true;
      data.requireHwid = false;
    } else if (dto.requireNoHwid === false) {
      data.requireNoHwid = false;
    }
    if (dto.maxUniqueHwids !== undefined) {
      data.maxUniqueHwids = dto.maxUniqueHwids;
    }
    if (dto.cryptoOnlySubscription !== undefined) {
      data.cryptoOnlySubscription = dto.cryptoOnlySubscription;
    }
    if (dto.feedJsonMode !== undefined) {
      data.feedJsonMode = dto.feedJsonMode;
    }

    const effectiveCryptoOnly =
      dto.cryptoOnlySubscription !== undefined
        ? dto.cryptoOnlySubscription === true
        : current.cryptoOnlySubscription === true;
    const effectiveCode = data.code ?? current.code;

    if (codeChanged) {
      const token = await this.ensureSubscriptionAccessToken(id);
      const pageUrl = this.buildAbsoluteSubscriptionPageUrlForCrypto(
        effectiveCode,
        token,
        effectiveCryptoOnly,
      );
      const happCryptoUrl = await this.fetchHappCryptoLink(pageUrl);
      if (!happCryptoUrl) {
        throw new BadRequestException(
          'Не удалось получить ссылку happ:// после смены кода (crypto.happ.su). Код не изменён.',
        );
      }
      data.happCryptoUrl = happCryptoUrl;
    }

    if (Object.keys(data).length === 0) {
      const row = await this.prisma.panelUser.findUnique({ where: { id } });
      return row ? this.omitSubscriptionAccessToken(row) : null;
    }
    const updated = await withPrismaWriteRetry(() =>
      this.prisma.panelUser.update({
        where: { id },
        data,
      }),
    );
    return this.omitSubscriptionAccessToken(updated);
  }

  /**
   * Массовое обновление пользователей панели и/или очистка логов подписки.
   */
  async bulkUpdatePanelUsers(dto: {
    ids: string[];
    groupName?: string;
    restrictToCurrentGroupName?: string;
    addGroupName?: string;
    removeGroupName?: string;
    enabled?: boolean;
    allowAllUserAgents?: boolean;
    maxUniqueHwids?: number;
    cryptoOnlySubscription?: boolean;
    clearSubscriptionAccessLogs?: boolean;
  }): Promise<{ updated: number; deletedLogs: number }> {
    const uniq = [...new Set(dto.ids.map((id) => id.trim()).filter(Boolean))];
    if (!uniq.length) {
      throw new BadRequestException('Укажите хотя бы одного пользователя');
    }

    const found = await this.prisma.panelUser.count({
      where: { id: { in: uniq } },
    });
    if (found !== uniq.length) {
      throw new BadRequestException(
        'Один или несколько пользователей не найдены',
      );
    }

    const hasPatch =
      dto.groupName !== undefined ||
      dto.addGroupName !== undefined ||
      dto.removeGroupName !== undefined ||
      dto.enabled !== undefined ||
      dto.allowAllUserAgents !== undefined ||
      dto.maxUniqueHwids !== undefined ||
      dto.cryptoOnlySubscription !== undefined;
    if (dto.clearSubscriptionAccessLogs !== true && !hasPatch) {
      throw new BadRequestException(
        'Укажите хотя бы одно действие: поля обновления или очистку логов',
      );
    }

    const restrict = dto.restrictToCurrentGroupName?.trim();
    if (restrict && dto.groupName === undefined) {
      throw new BadRequestException(
        'Поле restrictToCurrentGroupName используется только вместе с groupName',
      );
    }

    if (dto.addGroupName !== undefined && dto.groupName !== undefined) {
      throw new BadRequestException(
        'Нельзя одновременно указывать groupName и addGroupName',
      );
    }
    if (dto.removeGroupName !== undefined && dto.groupName !== undefined) {
      throw new BadRequestException(
        'Нельзя одновременно указывать groupName и removeGroupName',
      );
    }
    if (dto.removeGroupName !== undefined && dto.addGroupName !== undefined) {
      throw new BadRequestException(
        'Нельзя одновременно указывать addGroupName и removeGroupName',
      );
    }
    if (dto.addGroupName !== undefined && restrict) {
      throw new BadRequestException(
        'Поле addGroupName несовместимо с restrictToCurrentGroupName',
      );
    }
    if (dto.removeGroupName !== undefined && restrict) {
      throw new BadRequestException(
        'Поле removeGroupName несовместимо с restrictToCurrentGroupName',
      );
    }

    if (dto.groupName !== undefined) {
      const trimmed = dto.groupName.trim();
      if (!trimmed) {
        throw new BadRequestException('Группа не может быть пустой');
      }
      const group = await this.prisma.group.findUnique({
        where: { name: trimmed },
      });
      if (!group) {
        throw new BadRequestException('Группа с таким названием не найдена');
      }
    }

    if (dto.addGroupName !== undefined) {
      const t = dto.addGroupName.trim();
      if (!t) {
        throw new BadRequestException('Группа не может быть пустой');
      }
      const group = await this.prisma.group.findUnique({
        where: { name: t },
      });
      if (!group) {
        throw new BadRequestException('Группа с таким названием не найдена');
      }
    }

    if (dto.removeGroupName !== undefined) {
      const t = dto.removeGroupName.trim();
      if (!t) {
        throw new BadRequestException('Группа не может быть пустой');
      }
      const group = await this.prisma.group.findUnique({
        where: { name: t },
      });
      if (!group) {
        throw new BadRequestException('Группа с таким названием не найдена');
      }
    }

    const baseData: {
      enabled?: boolean;
      allowAllUserAgents?: boolean;
      maxUniqueHwids?: number;
      cryptoOnlySubscription?: boolean;
    } = {};
    if (dto.enabled !== undefined) {
      baseData.enabled = dto.enabled;
    }
    if (dto.allowAllUserAgents !== undefined) {
      baseData.allowAllUserAgents = dto.allowAllUserAgents;
    }
    if (dto.maxUniqueHwids !== undefined) {
      baseData.maxUniqueHwids = dto.maxUniqueHwids;
    }
    if (dto.cryptoOnlySubscription !== undefined) {
      baseData.cryptoOnlySubscription = dto.cryptoOnlySubscription;
    }

    let updated = 0;

    if (dto.addGroupName !== undefined) {
      const addG = dto.addGroupName.trim();
      const users = await this.prisma.panelUser.findMany({
        where: { id: { in: uniq } },
        select: { id: true, groupNames: true },
      });
      for (const u of users) {
        const hadGroup = u.groupNames.some((g) => g.trim() === addG);
        const data: {
          groupNames?: string[];
          enabled?: boolean;
          allowAllUserAgents?: boolean;
          maxUniqueHwids?: number;
          cryptoOnlySubscription?: boolean;
        } = { ...baseData };
        if (!hadGroup) {
          data.groupNames = [...u.groupNames, addG];
        }
        if (Object.keys(data).length === 0) {
          continue;
        }
        await this.prisma.panelUser.update({
          where: { id: u.id },
          data,
        });
        updated += 1;
      }
    } else if (dto.removeGroupName !== undefined) {
      const remG = dto.removeGroupName.trim();
      const users = await this.prisma.panelUser.findMany({
        where: { id: { in: uniq } },
        select: { id: true, groupNames: true },
      });
      for (const u of users) {
        const hadGroup = u.groupNames.some((g) => g.trim() === remG);
        if (hadGroup) {
          const next = u.groupNames.filter((g) => g.trim() !== remG);
          if (next.length === 0) {
            throw new BadRequestException(
              'Нельзя удалить группу: у одного или нескольких выбранных пользователей это единственная группа',
            );
          }
        }
      }
      for (const u of users) {
        const hadGroup = u.groupNames.some((g) => g.trim() === remG);
        const data: {
          groupNames?: string[];
          enabled?: boolean;
          allowAllUserAgents?: boolean;
          maxUniqueHwids?: number;
          cryptoOnlySubscription?: boolean;
        } = { ...baseData };
        if (hadGroup) {
          data.groupNames = u.groupNames.filter((g) => g.trim() !== remG);
        }
        if (Object.keys(data).length === 0) {
          continue;
        }
        await this.prisma.panelUser.update({
          where: { id: u.id },
          data,
        });
        updated += 1;
      }
    } else if (dto.groupName !== undefined && restrict) {
      const newG = dto.groupName.trim();
      const users = await this.prisma.panelUser.findMany({
        where: {
          id: { in: uniq },
          groupNames: { has: restrict },
        },
        select: { id: true, groupNames: true },
      });
      for (const u of users) {
        const withoutOld = u.groupNames.filter((g) => g.trim() !== restrict);
        const merged = [...withoutOld];
        if (!merged.some((g) => g.trim() === newG)) {
          merged.push(newG);
        }
        await this.prisma.panelUser.update({
          where: { id: u.id },
          data: { groupNames: merged, ...baseData },
        });
        updated += 1;
      }
    } else if (dto.groupName !== undefined) {
      const newG = dto.groupName.trim();
      const result = await this.prisma.panelUser.updateMany({
        where: { id: { in: uniq } },
        data: { groupNames: [newG], ...baseData },
      });
      updated = result.count;
    } else if (Object.keys(baseData).length > 0) {
      const result = await this.prisma.panelUser.updateMany({
        where: { id: { in: uniq } },
        data: baseData,
      });
      updated = result.count;
    }

    const touchedGroupMembership =
      dto.groupName !== undefined ||
      dto.addGroupName !== undefined ||
      dto.removeGroupName !== undefined;
    if (touchedGroupMembership) {
      await this.prisma.panelUser.updateMany({
        where: { id: { in: uniq } },
        data: { subscriptionGroupPrefs: null },
      });
    }

    let deletedLogs = 0;
    if (dto.clearSubscriptionAccessLogs === true) {
      const del = await this.prisma.panelUserAccessLog.deleteMany({
        where: { panelUserId: { in: uniq } },
      });
      deletedLogs = del.count;
    }

    return { updated, deletedLogs };
  }

  async setConnectGroups(id: string, groupNames: string[]) {
    await this.ensureConnect(id);
    await ensureUngroupedConnectGroupExists(this.prisma);
    const normalized = normalizeConnectGroupNamesForStorage(
      groupNames ?? [],
    );
    await this.assertConnectHasAtMostOneMainGroup(normalized);
    return this.prisma.connect.update({
      where: { id },
      data: { groupNames: normalized },
    });
  }

  /**
   * У коннекта не может быть двух групп с флагом isMainGroup одновременно.
   */
  private async assertConnectHasAtMostOneMainGroup(
    groupNames: string[],
  ): Promise<void> {
    if (groupNames.length < 2) {
      return;
    }
    const mains = await this.prisma.group.findMany({
      where: { name: { in: groupNames }, isMainGroup: true },
      select: { name: true },
    });
    if (mains.length > 1) {
      throw new BadRequestException(
        `У коннекта может быть не больше одной главной группы. Сейчас выбраны: ${mains.map((m) => m.name).join(', ')}`,
      );
    }
  }

  /**
   * Превышен лимит уникальных HWID: учитываются логи и HWID текущего запроса.
   * Если HWID в запросе уже есть в логах этого пользователя — лимит не срабатывает (выдаём ленту).
   * Не применяется при maxUniqueHwids ≤ 0 или при requireNoHwid.
   */
  async isUniqueHwidLimitExceeded(
    panelUserId: string,
    maxUniqueHwids: number,
    requireNoHwid: boolean,
    currentHwid: string | undefined | null,
  ): Promise<boolean> {
    if (maxUniqueHwids <= 0 || requireNoHwid) {
      return false;
    }
    const rows = await this.prisma.panelUserAccessLog.groupBy({
      by: ['hwid'],
      where: {
        panelUserId,
        hwid: { not: null },
        NOT: { success: false },
      },
    });
    const known = new Set(
      rows.map((r) => r.hwid).filter((h): h is string => Boolean(h)),
    );
    const n = known.size;
    const h = typeof currentHwid === 'string' ? currentHwid.trim() : '';
    if (!h) {
      return n > maxUniqueHwids;
    }
    if (known.has(h)) {
      return false;
    }
    return n + 1 > maxUniqueHwids;
  }

  /** Удалить все логи обращений к подписке (GET /public/sub) для пользователя панели */
  async deleteAllPanelUserSubscriptionAccessLogs(
    panelUserId: string,
  ): Promise<{ deleted: number }> {
    await this.ensureUser(panelUserId);
    const result = await this.prisma.panelUserAccessLog.deleteMany({
      where: { panelUserId },
    });
    return { deleted: result.count };
  }

  /** Удалить логи с указанным HWID (точное совпадение строки в БД) */
  async deletePanelUserSubscriptionAccessLogsByHwid(
    panelUserId: string,
    hwid: string,
  ): Promise<{ deleted: number }> {
    const h = hwid.trim();
    if (!h) {
      throw new BadRequestException('Укажите HWID');
    }
    await this.ensureUser(panelUserId);
    const result = await this.prisma.panelUserAccessLog.deleteMany({
      where: { panelUserId, hwid: h },
    });
    return { deleted: result.count };
  }

  /** Пользователь панели по коду подписки (в т.ч. отключённый — для решения, что отдавать в /public/sub) */
  async findPanelUserByCode(code: string): Promise<PanelUser | null> {
    return this.prisma.panelUser.findUnique({
      where: { code },
    });
  }

  /**
   * Имя подписки для ленты: subscriptionDisplayName группы, иначе имя пользователя панели.
   */
  async resolveSubscriptionProfileTitleForPanelUser(
    user: PanelUser,
  ): Promise<string> {
    const entries = this.getEffectiveSubscriptionGroupEntries(user);
    const firstInc = entries.find((e) => e.include)?.name ?? '';
    if (firstInc) {
      const fromIncluded =
        await this.resolveSubscriptionDisplayNameForUserGroup(firstInc);
      const gi = (fromIncluded ?? '').trim();
      if (gi) {
        return gi;
      }
    }
    const primaries = this.orderedUniquePanelUserGroupNames(user);
    const fromGroup = await this.resolveSubscriptionDisplayNameForUserGroup(
      primaries[0] ?? '',
    );
    const g = (fromGroup ?? '').trim();
    if (g) {
      return g;
    }
    const n = (user.name ?? '').trim();
    if (n) {
      return n;
    }
    return 'Подписка';
  }

  /** Абсолютный URL страницы вида …/sub/CODE (для #profile-web-page-url). */
  buildPublicSubPageAbsoluteUrl(code: string): string {
    return this.buildSubscriptionPageUrl(code.trim(), false);
  }

  private profileWebPageUrlMetaLine(code: string): string {
    return `#profile-web-page-url: ${this.buildPublicSubPageAbsoluteUrl(code)}`;
  }

  /**
   * Обычная base64-подписка: коннекты группы пользователя.
   * Фрагмент # в URI — Connect.name; при названии группы — строка #profile-title для Happ.
   */
  async buildPublicFeedForPanelUser(
    user: PanelUser,
    announceMetaLine: string | null = null,
    profileUpdateIntervalMetaLine: string | null = null,
    routingConfig: string | null = null,
  ): Promise<{
    encoded: string;
    profileTitle: string;
    panelUserId: string;
    subscriptionDelivered: true;
  }> {
    const entries = this.getEffectiveSubscriptionGroupEntries(user);
    const includedNames = entries.filter((e) => e.include).map((e) => e.name);

    const profileTitle = (
      await this.resolveSubscriptionProfileTitleForPanelUser(user)
    ).trim();

    const seenConnectIds = new Set<string>();
    const uriLines: string[] = [];
    for (const gName of includedNames) {
      const batch = await this.prisma.connect.findMany({
        where: {
          status: 'ACTIVE',
          groupNames: { has: gName },
        },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
        select: { id: true, raw: true, name: true },
      });
      for (const c of batch) {
        if (seenConnectIds.has(c.id)) {
          continue;
        }
        seenConnectIds.add(c.id);
        // Коннекты-балансировщики не имеют URI-представления — пропускаем в Base64-ленте
        if (c.raw.startsWith('balancer://')) continue;
        uriLines.push(this.applyCustomNameToUri(c.raw, c.name));
      }
    }
    /** Happ: скрыть настройки серверов (тело подписки), см. app-management */
    const metaLines: string[] = [];
    const titleTrimmed = profileTitle.trim();
    if (titleTrimmed) {
      metaLines.push(
        `#profile-title: ${sliceProfileTitleForHappSubscription(titleTrimmed)}`,
      );
    }
    metaLines.push(this.profileWebPageUrlMetaLine(user.code));
    const ann = announceMetaLine?.trim();
    if (ann) {
      metaLines.push(ann);
    }
    const intv = profileUpdateIntervalMetaLine?.trim();
    if (intv) {
      metaLines.push(intv);
    }
    metaLines.push('#hide-settings: 1');
    const head = metaLines.join('\n');
    const bodyTextRaw =
      uriLines.length > 0 ? `${head}\n${uriLines.join('\n')}` : head;
    const bodyText = this.prependRoutingLinesToSubscriptionPlaintext(
      routingConfig,
      bodyTextRaw,
    );
    return {
      encoded: Buffer.from(bodyText, 'utf-8').toString('base64'),
      profileTitle,
      panelUserId: user.id,
      subscriptionDelivered: true,
    };
  }

  /**
   * JSON-режим: отдаёт массив rawJson-объектов коннектов пользователя.
   * Коннекты без rawJson (обычные URI) включаются как { remarks, raw }.
   */
  async buildJsonFeedForPanelUser(
    user: PanelUser,
    announceMetaLine: string | null = null,
  ): Promise<{
    jsonBody: string;
    profileTitle: string;
    profileWebPageUrl: string;
    panelUserId: string;
    subscriptionDelivered: true;
  }> {
    const entries = this.getEffectiveSubscriptionGroupEntries(user);
    const includedNames = entries.filter((e) => e.include).map((e) => e.name);

    const profileTitle = (
      await this.resolveSubscriptionProfileTitleForPanelUser(user)
    ).trim();
    const pageUrl = this.buildPublicSubPageAbsoluteUrl(user.code);

    // Декодируем текст объявления из #announce: base64:… → plain UTF-8
    const announceText = this.decodeAnnouncePlainText(announceMetaLine);

    // meta-блок для каждого JSON-объекта (Advanced Announcements Happ)
    // Включает: объявление как sub-info-text и ссылку на страницу подписки
    const metaBlock = this.buildJsonFeedMetaBlock(announceText, pageUrl);

    const seenConnectIds = new Set<string>();
    const items: unknown[] = [];

    const processConnect = (
      c: { id: string; raw: string; name: string; rawJson: unknown },
    ): Record<string, unknown> | null => {
      if (c.rawJson !== null && c.rawJson !== undefined) {
        if (typeof c.rawJson === 'object' && !Array.isArray(c.rawJson)) {
          const obj = c.rawJson as Record<string, unknown>;
          // outbound-объект (от uriToOutbound) — оборачиваем в полный конфиг
          if (obj['tag'] === 'proxy' && obj['protocol'] && obj['settings']) {
            return this.outboundToHappConfig(obj, c.name);
          }
          // Полный v2ray-конфиг (от JSON-подписки или балансировщика) — обновляем remarks
          return { ...obj, remarks: c.name };
        }
        return null;
      }
      if (!c.raw.startsWith('json://') && !c.raw.startsWith('balancer://')) {
        const outbound = uriToOutbound(c.raw);
        if (outbound) {
          return this.outboundToHappConfig(outbound as unknown as Record<string, unknown>, c.name);
        }
      }
      return null;
    };

    // Все группы пользователя обходим в порядке includedNames, внутри каждой группы — по sortOrder.
    // Балансировщики обрабатываются наравне с обычными коннектами — их позиция определяется
    // sortOrder в той группе, куда их переместил администратор.
    // После групп добавляем балансировщики, которые не попали ни в одну из групп пользователя.
    for (const gName of includedNames) {
      const batch = await this.prisma.connect.findMany({
        where: { status: 'ACTIVE', groupNames: { has: gName } },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
        select: { id: true, raw: true, name: true, rawJson: true },
      });
      for (const c of batch) {
        if (seenConnectIds.has(c.id)) continue;
        seenConnectIds.add(c.id);
        const item = processConnect(c);
        if (!item) continue;
        items.push(metaBlock ? this.injectMetaBlock(item, metaBlock) : item);
      }
    }

    // Балансировщики, которые не входят ни в одну из групп пользователя — добавляем в конец
    const balancerConnects = await this.prisma.connect.findMany({
      where: { status: 'ACTIVE', protocol: 'balancer' },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      select: { id: true, raw: true, name: true, rawJson: true },
    });
    this.logger.debug(
      `buildJsonFeed user=${user.id}: groups=[${includedNames.join(',')}] items=${items.length} balancers=${balancerConnects.length}`,
    );
    for (const c of balancerConnects) {
      if (seenConnectIds.has(c.id)) continue; // уже добавлен через группу
      seenConnectIds.add(c.id);
      const item = processConnect(c);
      if (!item) continue;
      items.push(metaBlock ? this.injectMetaBlock(item, metaBlock) : item);
    }

    return {
      jsonBody: JSON.stringify(items),
      profileTitle,
      profileWebPageUrl: pageUrl,
      panelUserId: user.id,
      subscriptionDelivered: true,
    };
  }

  /**
   * Декодирует текст объявления из строки формата «#announce: base64:…» или «#announce: текст».
   * Возвращает plain-текст или null.
   */
  private decodeAnnouncePlainText(metaLine: string | null | undefined): string | null {
    const s = metaLine?.trim();
    if (!s) return null;
    const m = s.match(/^#announce:\s*(.+)$/i);
    if (!m?.[1]) return null;
    const val = m[1].trim();
    if (val.startsWith('base64:')) {
      try {
        return Buffer.from(val.slice(7), 'base64').toString('utf8').trim();
      } catch {
        return null;
      }
    }
    return val || null;
  }

  /**
   * Строит meta-объект для JSON-ленты Happ (Advanced Announcements).
   * sub-info-text  — текст объявления (показывается как цветной блок в интерфейсе)
   * sub-info-button-text/link — кнопка «Открыть» ведёт на страницу подписки
   * sub-expire — включает автоматическое уведомление за 3 дня до истечения
   */
  private buildJsonFeedMetaBlock(
    announceText: string | null,
    pageUrl: string | null,
  ): Record<string, unknown> | null {
    if (!announceText) return null;

    const meta: Record<string, unknown> = {
      'sub-info-text': announceText.slice(0, 200),
      'sub-info-color': 'blue',
    };

    if (pageUrl) {
      meta['sub-info-button-text'] = 'Открыть';
      meta['sub-info-button-link'] = pageUrl;
    }

    return meta;
  }

  /**
   * Оборачивает outbound-объект (tag: "proxy") в минимальный Happ-совместимый v2ray конфиг
   * с dns, routing, inbounds и remarks.
   */
  private injectMetaBlock(
    item: Record<string, unknown>,
    metaBlock: Record<string, unknown>,
  ): Record<string, unknown> {
    const existingMeta =
      item['meta'] && typeof item['meta'] === 'object' && !Array.isArray(item['meta'])
        ? (item['meta'] as Record<string, unknown>)
        : {};
    return { ...item, meta: { ...metaBlock, ...existingMeta } };
  }

  private outboundToHappConfig(
    proxy: Record<string, unknown>,
    displayName: string,
  ): Record<string, unknown> {
    return {
      dns: { servers: ['1.1.1.1', '1.0.0.1'], queryStrategy: 'UseIP' },
      routing: {
        rules: [{ type: 'field', protocol: ['bittorrent'], outboundTag: 'direct' }],
        domainMatcher: 'hybrid',
        domainStrategy: 'IPIfNonMatch',
      },
      inbounds: [
        {
          tag: 'socks',
          port: 10808,
          listen: '127.0.0.1',
          protocol: 'socks',
          settings: { udp: true, auth: 'noauth' },
          sniffing: { enabled: true, routeOnly: false, destOverride: ['http', 'tls', 'quic'] },
        },
        {
          tag: 'http',
          port: 10809,
          listen: '127.0.0.1',
          protocol: 'http',
          settings: { allowTransparent: false },
          sniffing: { enabled: true, routeOnly: false, destOverride: ['http', 'tls', 'quic'] },
        },
      ],
      outbounds: [
        { ...proxy, tag: 'proxy' },
        { tag: 'direct', protocol: 'freedom' },
        { tag: 'block', protocol: 'blackhole' },
      ],
      remarks: displayName,
    };
  }

  /**
   * Заглушка без реальных коннектов: #profile-title и HTTP profile-title — из profileTitleForMeta
   * (настройки группы / имя пользователя); отображаемое имя строки vless (# в URI) — connectionDisplayName
   * (сценарий ошибки: «Только Cripto», «Отключите HWID» и т.д.).
   */
  buildNamedSubscriptionPlaceholderFeed(
    panelUserId: string | null,
    code: string,
    profileTitleForMeta: string,
    connectionDisplayName: string,
    announceMetaLine: string | null = null,
    profileUpdateIntervalMetaLine: string | null = null,
    routingConfig: string | null = null,
  ): {
    encoded: string;
    profileTitle: string;
    panelUserId: string | null;
    subscriptionDelivered: false;
  } {
    const meta = profileTitleForMeta.trim() || '❌ Ошибка:Нет подключений';
    const conn = connectionDisplayName.trim() || '❌ Ошибка: Нет подключений 3';
    const line = this.buildRandomPlaceholderVlessLineForName(conn);
    const web = this.profileWebPageUrlMetaLine(code);
    const ann = announceMetaLine?.trim();
    const intv = profileUpdateIntervalMetaLine?.trim();
    const metaBlock = [
      `#profile-title: ${sliceProfileTitleForHappSubscription(meta)}`,
      web,
      ...(ann ? [ann] : []),
      ...(intv ? [intv] : []),
      '#hide-settings: 1',
      line,
    ].join('\n');
    const bodyText = this.prependRoutingLinesToSubscriptionPlaintext(
      routingConfig,
      metaBlock,
    );
    return {
      encoded: Buffer.from(bodyText, 'utf-8').toString('base64'),
      profileTitle: meta,
      panelUserId,
      subscriptionDelivered: false,
    };
  }

  /**
   * Заглушка «нет коннектов» / отказ доступа: строка подключения — «Нет подключений».
   * Код неизвестен — panelUserId null (лог не пишем).
   */
  buildNoConnectionsPlaceholderFeed(
    panelUserId: string | null,
    code: string,
    profileTitleForMeta = 'Нет подключений',
    announceMetaLine: string | null = null,
    profileUpdateIntervalMetaLine: string | null = null,
    routingConfig: string | null = null,
  ): {
    encoded: string;
    profileTitle: string;
    panelUserId: string | null;
    subscriptionDelivered: false;
  } {
    return this.buildNamedSubscriptionPlaceholderFeed(
      panelUserId,
      code,
      profileTitleForMeta,
      '❌ Ошибка: Нет подключений 4',
      announceMetaLine,
      profileUpdateIntervalMetaLine,
      routingConfig,
    );
  }

  /** Запись в лог обращений к подписке (Happ и др.): IP, HWID, UA; success — выдана полная лента, не заглушка */
  async logPanelUserSubscriptionAccess(
    panelUserId: string,
    meta: SubscriptionAccessMeta,
    success: boolean,
  ): Promise<void> {
    const cap = (s: string | undefined, max: number) =>
      s && s.length > max ? `${s.slice(0, max)}…` : s;
    const log = await this.prisma.panelUserAccessLog.create({
      data: {
        panelUserId,
        clientIp: cap(meta.clientIp, 256) ?? undefined,
        userAgent: cap(meta.userAgent, 2000) ?? undefined,
        hwid: cap(meta.hwid, 512) ?? undefined,
        accept: cap(meta.accept, 512) ?? undefined,
        acceptLanguage: cap(meta.acceptLanguage, 512) ?? undefined,
        referer: cap(meta.referer, 2000) ?? undefined,
        queryParams: meta.queryParams ?? undefined,
        extraHeaders: meta.extraHeaders ?? undefined,
        success,
      },
      select: {
        id: true,
        createdAt: true,
        clientIp: true,
        userAgent: true,
        hwid: true,
        referer: true,
        queryParams: true,
        success: true,
      },
    });

    const notifyOn =
      this.config.get<string>('TELEGRAM_NOTIFY_SUBSCRIPTION_ACCESS')?.toLowerCase() !==
      'false';
    if (!notifyOn) {
      return;
    }

    const hwStored = log.hwid;
    if (!hwStored?.trim() || !log.success) {
      return;
    }

    try {
      const priorSameHwid = await this.prisma.panelUserAccessLog.count({
        where: {
          panelUserId,
          hwid: hwStored,
          success: true,
          id: { not: log.id },
        },
      });
      if (priorSameHwid > 0) {
        return;
      }

      const user = await this.prisma.panelUser.findUnique({
        where: { id: panelUserId },
        select: { name: true, code: true },
      });
      if (!user) {
        return;
      }
      let queryParamsJson: string | null = null;
      if (log.queryParams != null) {
        try {
          const s = JSON.stringify(log.queryParams);
          queryParamsJson = s.length > 600 ? `${s.slice(0, 599)}…` : s;
        } catch {
          queryParamsJson = null;
        }
      }
      const job = await this.subscriptionAccessNotifyQueue.add(
        SUBSCRIPTION_ACCESS_NOTIFY_JOB,
        {
          panelUserName: user.name?.trim() || '—',
          panelUserCode: user.code,
          clientIp: log.clientIp,
          userAgent: log.userAgent,
          hwid: log.hwid,
          referer: log.referer,
          queryParamsJson,
          success: log.success,
          createdAtIso: log.createdAt.toISOString(),
        },
        {
          attempts: 4,
          backoff: { type: 'exponential', delay: 2000 },
        },
      );
      this.logger.log(
        `subscription-access-notify: задача ${job.id} — новый HWID у пользователя ${user.code}`,
      );
    } catch (e) {
      this.logger.warn(
        `Не удалось поставить в очередь Telegram-уведомление о доступе к подписке: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /**
   * Логи обращений клиентов к подписке (GET /public/sub/:code) для пользователя панели.
   * @param hwidFilter — если задан, только записи с точным совпадением hwid
   */
  async listPanelUserSubscriptionAccessLogs(
    panelUserId: string,
    limit: number,
    hwidFilter?: string | null,
  ): Promise<{
    user: { name: string; code: string };
    /** Уникальные непустые HWID по всем логам пользователя (для фильтра в UI) */
    hwids: string[];
    logs: Array<{
      id: string;
      clientIp: string | null;
      userAgent: string | null;
      hwid: string | null;
      accept: string | null;
      acceptLanguage: string | null;
      referer: string | null;
      queryParams: unknown;
      extraHeaders: unknown;
      success: boolean;
      createdAt: Date;
    }>;
  }> {
    await this.ensureUser(panelUserId);
    const user = await this.prisma.panelUser.findUniqueOrThrow({
      where: { id: panelUserId },
      select: { name: true, code: true },
    });
    const hwidGroups = await this.prisma.panelUserAccessLog.groupBy({
      by: ['hwid'],
      where: { panelUserId, hwid: { not: null } },
    });
    const hwids = hwidGroups
      .map((g) => g.hwid)
      .filter((x): x is string => Boolean(x?.trim()))
      .sort((a, b) => a.localeCompare(b, 'ru'));

    const hf = hwidFilter?.trim();
    const logs = await this.prisma.panelUserAccessLog.findMany({
      where: {
        panelUserId,
        ...(hf ? { hwid: hf } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        clientIp: true,
        userAgent: true,
        hwid: true,
        accept: true,
        acceptLanguage: true,
        referer: true,
        queryParams: true,
        extraHeaders: true,
        success: true,
        createdAt: true,
      },
    });
    return { user, hwids, logs };
  }

  /**
   * Персональная страница /sub/:code — знание кода считается достаточным для изменения порядка групп
   * и флагов включения в ленту (без query t=).
   */
  async savePublicSubscriptionGroupPrefs(
    code: string,
    groups: Array<{ name: string; include: boolean }>,
  ): Promise<{
    subscriptionGroups: Array<{ name: string; include: boolean }>;
  }> {
    const user = await this.findPanelUserByCode(code);
    if (!user) {
      throw new NotFoundException('Пользователь не найден');
    }

    const membership = this.orderedUniquePanelUserGroupNames(user);
    if (membership.length === 0) {
      throw new BadRequestException('У пользователя нет групп');
    }

    const incoming = groups.map((g) => ({
      name: g.name.trim(),
      include: g.include !== false,
    }));
    if (incoming.length !== membership.length) {
      throw new BadRequestException(
        'Список групп должен содержать каждую группу пользователя ровно один раз',
      );
    }
    const memSet = new Set(membership);
    const seenIncoming = new Set<string>();
    for (const g of incoming) {
      if (!g.name) {
        throw new BadRequestException('Пустое имя группы');
      }
      if (!memSet.has(g.name)) {
        throw new BadRequestException(`Неизвестная группа: ${g.name}`);
      }
      const k = this.subscriptionPrefNormKey(g.name);
      if (seenIncoming.has(k)) {
        throw new BadRequestException('Дубликаты групп в списке');
      }
      seenIncoming.add(k);
    }
    for (const m of membership) {
      if (!incoming.some((g) => g.name === m)) {
        throw new BadRequestException(`В списке отсутствует группа: ${m}`);
      }
    }

    await this.prisma.panelUser.update({
      where: { id: user.id },
      data: { subscriptionGroupPrefs: incoming },
    });

    const fresh = await this.findPanelUserByCode(code);
    if (!fresh) {
      throw new NotFoundException('Пользователь не найден');
    }
    return {
      subscriptionGroups: this.getEffectiveSubscriptionGroupEntries(fresh),
    };
  }

  async getPublicUserByCode(code: string) {
    const user = await this.prisma.panelUser.findUnique({
      where: { code },
      select: {
        name: true,
        code: true,
        enabled: true,
        groupNames: true,
        subscriptionGroupPrefs: true,
        happCryptoUrl: true,
        cryptoOnlySubscription: true,
      },
    });
    if (!user) {
      throw new NotFoundException('Пользователь не найден');
    }

    const {
      happCryptoUrl: rawHappCrypto,
      subscriptionGroupPrefs: _prefsOmit,
      ...publicUser
    } = user;
    const happCryptoUrl =
      typeof rawHappCrypto === 'string' &&
      rawHappCrypto.trim().startsWith('happ://')
        ? rawHappCrypto.trim()
        : null;

    const primaries = this.orderedUniquePanelUserGroupNames(user);
    const groups = await this.collectPublicDisplayGroupNames(primaries);
    const subscriptionGroups = this.getEffectiveSubscriptionGroupEntries({
      groupNames: user.groupNames,
      subscriptionGroupPrefs: user.subscriptionGroupPrefs,
    });

    const sub =
      (await this.resolveSubscriptionDisplayNameForUserGroup(
        subscriptionGroups.find((e) => e.include)?.name ?? primaries[0] ?? '',
      )) ?? '';
    const trimmedSub = sub.trim();
    const profileTitle = trimmedSub || null;

    const appLinks = await this.getPublicAppLinksForCode(
      user.code,
      happCryptoUrl,
      user.cryptoOnlySubscription === true,
    );

    const namesForConnectCounts = new Set<string>();
    for (const e of subscriptionGroups) {
      namesForConnectCounts.add(e.name);
    }
    for (const g of groups) {
      namesForConnectCounts.add(g);
    }
    const groupActiveConnectCountByName =
      await this.countActiveConnectsByGroupNames(
        Array.from(namesForConnectCounts),
      );

    return {
      ...publicUser,
      /** happ:// для блока ENDPOINT на публичной странице; null если не создана */
      happCryptoUrl,
      subscriptionDisplayName: trimmedSub || null,
      /** Как profile-title ленты: subscriptionDisplayName группы пользователя */
      profileTitle,
      /** Режим «только crypto» для подсказок на публичных страницах */
      cryptoOnlySubscription: user.cryptoOnlySubscription === true,
      /** Имена групп для блока «Группа» на /sub: привязка пользователя и группы коннектов ленты */
      groups,
      /** Порядок групп пользователя и включение в ленту (персональные настройки) */
      subscriptionGroups,
      /**
       * Число активных коннектов с тегом группы (как при сборке ленты /public/sub):
       * status ACTIVE и массив groupNames содержит ключ.
       */
      groupActiveConnectCountByName,
      /** Название и готовая ссылка для блока «Приложения» на /sub */
      appLinks,
    };
  }

  /**
   * Подсчёт коннектов по имени группы — те же критерии, что в buildPublicFeedForPanelUser
   * (ACTIVE и groupNames has имя).
   */
  private async countActiveConnectsByGroupNames(
    names: string[],
  ): Promise<Record<string, number>> {
    const uniq = [
      ...new Set(names.map((n) => n.trim()).filter((n) => n.length > 0)),
    ];
    const counts = Object.fromEntries(uniq.map((n) => [n, 0])) as Record<
      string,
      number
    >;
    if (uniq.length === 0) {
      return {};
    }
    const connects = await this.prisma.connect.findMany({
      where: {
        status: 'ACTIVE',
        OR: uniq.map((n) => ({ groupNames: { has: n } })),
      },
      select: { groupNames: true },
    });
    for (const c of connects) {
      for (const n of uniq) {
        if (c.groupNames.includes(n)) {
          counts[n] += 1;
        }
      }
    }
    return counts;
  }

  /**
   * Уникальные названия групп: группы пользователя панели и все теги groupNames у активных коннектов их ленты.
   * Имя приводится к записи Group.name в БД при совпадении (регистр, NFC).
   */
  private async collectPublicDisplayGroupNames(
    panelUserGroupNames: string[],
  ): Promise<string[]> {
    const raw = new Set<string>();
    for (const primary of panelUserGroupNames
      .map((g) => g.trim())
      .filter((g) => g.length > 0)) {
      raw.add(primary);
      const connects = await this.prisma.connect.findMany({
        where: {
          status: 'ACTIVE',
          groupNames: { has: primary },
        },
        select: { groupNames: true },
      });
      for (const c of connects) {
        for (const g of c.groupNames) {
          const t = g.trim();
          if (t) {
            raw.add(t);
          }
        }
      }
    }
    return this.resolveGroupNamesToCanonical(Array.from(raw));
  }

  private async resolveGroupNamesToCanonical(
    rawNames: string[],
  ): Promise<string[]> {
    if (rawNames.length === 0) {
      return [];
    }
    const groups = await this.prisma.group.findMany({
      select: { name: true },
    });
    const resolved: string[] = [];
    const seen = new Set<string>();
    for (const raw of rawNames) {
      const trimmed = raw.trim();
      if (!trimmed) {
        continue;
      }
      const normalizedTarget = trimmed.normalize('NFC');
      const targetLower = normalizedTarget.toLowerCase();
      const row =
        groups.find((g) => g.name.trim() === trimmed) ??
        groups.find(
          (g) => g.name.trim().normalize('NFC') === normalizedTarget,
        ) ??
        groups.find(
          (g) => g.name.trim().normalize('NFC').toLowerCase() === targetLower,
        );
      const display = (row?.name ?? trimmed).trim();
      const dedupeKey = display.normalize('NFC').toLowerCase();
      if (!seen.has(dedupeKey)) {
        seen.add(dedupeKey);
        resolved.push(display);
      }
    }
    return resolved.sort((a, b) =>
      a.localeCompare(b, 'ru', { sensitivity: 'base' }),
    );
  }

  listSubscriptionAppLinks() {
    return this.prisma.subscriptionAppLink.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async createSubscriptionAppLink(dto: {
    name: string;
    urlTemplate: string;
    sortOrder?: number;
  }) {
    const name = dto.name.trim();
    const urlTemplate = dto.urlTemplate.trim();
    if (!name) {
      throw new BadRequestException('Название не может быть пустым');
    }
    if (!urlTemplate) {
      throw new BadRequestException('Ссылка не может быть пустой');
    }
    let sortOrder = dto.sortOrder;
    if (sortOrder === undefined) {
      const agg = await this.prisma.subscriptionAppLink.aggregate({
        _max: { sortOrder: true },
      });
      sortOrder = (agg._max.sortOrder ?? -1) + 1;
    }
    return this.prisma.subscriptionAppLink.create({
      data: { name, urlTemplate, sortOrder },
    });
  }

  async updateSubscriptionAppLink(
    id: string,
    dto: { name?: string; urlTemplate?: string; sortOrder?: number },
  ) {
    await this.ensureSubscriptionAppLink(id);
    const data: {
      name?: string;
      urlTemplate?: string;
      sortOrder?: number;
    } = {};
    if (dto.name !== undefined) {
      const n = dto.name.trim();
      if (!n) {
        throw new BadRequestException('Название не может быть пустым');
      }
      data.name = n;
    }
    if (dto.urlTemplate !== undefined) {
      const u = dto.urlTemplate.trim();
      if (!u) {
        throw new BadRequestException('Ссылка не может быть пустой');
      }
      data.urlTemplate = u;
    }
    if (dto.sortOrder !== undefined) {
      data.sortOrder = dto.sortOrder;
    }
    if (Object.keys(data).length === 0) {
      return this.prisma.subscriptionAppLink.findUnique({ where: { id } });
    }
    return this.prisma.subscriptionAppLink.update({
      where: { id },
      data,
    });
  }

  async deleteSubscriptionAppLink(id: string) {
    await this.ensureSubscriptionAppLink(id);
    await this.prisma.subscriptionAppLink.delete({ where: { id } });
  }

  /** Заменить вхождение oldName на newName в массивах groupNames у коннектов и пользователей панели. */
  private async renameGroupTagEverywhere(
    oldName: string,
    newName: string,
  ): Promise<void> {
    const connects = await this.prisma.connect.findMany({
      where: { groupNames: { has: oldName } },
      select: { id: true, groupNames: true },
    });
    for (const c of connects) {
      const next = c.groupNames.map((g) => (g === oldName ? newName : g));
      await this.prisma.connect.update({
        where: { id: c.id },
        data: { groupNames: next },
      });
    }
    const users = await this.prisma.panelUser.findMany({
      where: { groupNames: { has: oldName } },
      select: { id: true, groupNames: true },
    });
    for (const u of users) {
      const next = u.groupNames.map((g) => (g === oldName ? newName : g));
      await this.prisma.panelUser.update({
        where: { id: u.id },
        data: { groupNames: next },
      });
    }
  }

  async updateGroupSettings(id: string, dto: UpdateGroupSettingsDto) {
    const group = await this.ensureGroupById(id);
    const oldName = group.name;

    const data: {
      name?: string;
      isMainGroup?: boolean;
      subscriptionDisplayName?: string | null;
      subscriptionAnnounce?: string | null;
      profileUpdateInterval?: number | null;
    } = {};

    if (dto.name !== undefined) {
      const trimmed = dto.name.trim();
      if (!trimmed) {
        throw new BadRequestException('Имя группы не может быть пустым');
      }
      if (trimmed !== oldName) {
        if (isReservedUngroupedConnectGroupName(oldName)) {
          throw new BadRequestException(
            'Служебную группу «Без группы» нельзя переименовать',
          );
        }
        if (isReservedUngroupedConnectGroupName(trimmed)) {
          throw new BadRequestException(
            'Имя «Без группы» зарезервировано системой',
          );
        }
        const taken = await this.prisma.group.findUnique({
          where: { name: trimmed },
        });
        if (taken) {
          throw new BadRequestException(
            'Группа с таким названием уже существует',
          );
        }
        await this.renameGroupTagEverywhere(oldName, trimmed);
        await this.syncSubscriptionPrefsAfterGroupRename(oldName, trimmed);
        data.name = trimmed;
      }
    }

    if (dto.subscriptionDisplayName !== undefined) {
      if (dto.subscriptionDisplayName === null) {
        data.subscriptionDisplayName = null;
      } else {
        const trimmed = dto.subscriptionDisplayName.trim();
        data.subscriptionDisplayName = trimmed === '' ? null : trimmed;
      }
    }

    if (dto.subscriptionAnnounce !== undefined) {
      if (dto.subscriptionAnnounce === null) {
        data.subscriptionAnnounce = null;
      } else {
        const t = dto.subscriptionAnnounce.trim();
        data.subscriptionAnnounce =
          t === '' ? null : sliceAnnounceForHappSubscription(t) || null;
      }
    }

    if (dto.profileUpdateInterval !== undefined) {
      data.profileUpdateInterval =
        dto.profileUpdateInterval === null
          ? null
          : Math.min(8760, Math.max(1, Math.floor(dto.profileUpdateInterval)));
    }

    if (dto.isMainGroup !== undefined) {
      if (dto.isMainGroup === true && isReservedUngroupedConnectGroupName(group.name)) {
        throw new BadRequestException(
          'Служебную группу «Без группы» нельзя отметить как главную',
        );
      }
      data.isMainGroup = dto.isMainGroup;
    }

    if (Object.keys(data).length === 0) {
      return this.prisma.group.findUnique({ where: { id } });
    }
    return this.prisma.group.update({
      where: { id },
      data,
    });
  }

  private async ensureUser(id: string) {
    const user = await this.prisma.panelUser.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('Пользователь не найден');
    }
    return user;
  }

  private async ensureConnect(id: string) {
    const connect = await this.prisma.connect.findUnique({ where: { id } });
    if (!connect) {
      throw new NotFoundException('Коннект не найден');
    }
  }

  private async ensureGroupById(id: string) {
    const group = await this.prisma.group.findUnique({ where: { id } });
    if (!group) {
      throw new NotFoundException('Группа не найдена');
    }
    return group;
  }

  private async ensureSubscriptionAppLink(id: string) {
    const row = await this.prisma.subscriptionAppLink.findUnique({
      where: { id },
    });
    if (!row) {
      throw new NotFoundException('Запись не найдена');
    }
    return row;
  }

  /**
   * База для полного URL страницы подписки: FRONTEND_ORIGIN без trailing slash.
   */
  private subscriptionPublicOrigin(): string {
    return (this.config.get<string>('FRONTEND_ORIGIN') ?? '')
      .trim()
      .replace(/\/$/, '');
  }

  /** Полный абсолютный URL страницы подписки в браузере: /sub/CODE или /{cryptoSegment}/CODE при «только crypto». */
  private buildSubscriptionPageUrl(
    code: string,
    cryptoOnlySubscription = false,
  ): string {
    const base = this.subscriptionPublicOrigin();
    const seg = cryptoOnlySubscription
      ? this.subscriptionCryptoPathSegment()
      : 'sub';
    const path = `/${seg}/${encodeURIComponent(code)}`;
    if (!base) {
      return path;
    }
    return `${base}${path}`;
  }

  private resolveAppLinkUrl(
    template: string,
    subscriptionPageUrl: string,
    happCryptoUrl: string | null | undefined,
  ): string {
    const crypto = (happCryptoUrl ?? '').trim();
    return template
      .replaceAll('{link}', subscriptionPageUrl)
      .replaceAll('{crypto}', crypto);
  }

  private async getPublicAppLinksForCode(
    code: string,
    happCryptoUrl: string | null | undefined,
    cryptoOnlySubscription = false,
  ): Promise<{ name: string; url: string }[]> {
    const links = await this.prisma.subscriptionAppLink.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    if (links.length === 0) {
      return [];
    }
    const subscriptionPageUrl = this.buildSubscriptionPageUrl(
      code,
      cryptoOnlySubscription,
    );
    return links.map((l) => ({
      name: l.name,
      url: this.resolveAppLinkUrl(
        l.urlTemplate,
        subscriptionPageUrl,
        happCryptoUrl,
      ),
    }));
  }

  /**
   * Название подписки из админки для группы пользователя: имя группы → Group.name,
   * поле subscriptionDisplayName. Точное имя, затем NFC и регистронезависимое совпадение с Group.name.
   */
  private async resolveSubscriptionDisplayNameForUserGroup(
    panelGroupName: string,
  ): Promise<string | null> {
    const trimmed = panelGroupName.trim();
    if (!trimmed) {
      return null;
    }

    const exact = await this.prisma.group.findUnique({
      where: { name: trimmed },
      select: { subscriptionDisplayName: true },
    });
    if (exact) {
      const t = exact.subscriptionDisplayName?.trim();
      return t || null;
    }

    const normalizedTarget = trimmed.normalize('NFC');
    const targetLower = normalizedTarget.toLowerCase();
    const groups = await this.prisma.group.findMany({
      select: { name: true, subscriptionDisplayName: true },
    });
    const row =
      groups.find((g) => g.name.trim().normalize('NFC') === normalizedTarget) ??
      groups.find(
        (g) => g.name.trim().normalize('NFC').toLowerCase() === targetLower,
      );
    const sub = row?.subscriptionDisplayName?.trim();
    return sub || null;
  }

  /**
   * Клиенты VPN (vless/vmess и др.) берут отображаемое имя из фрагмента URI после `#`.
   * Подставляем кастомное название из панели, не меняя саму ссылку.
   */
  private applyCustomNameToUri(raw: string, displayName: string): string {
    const label = displayName.trim();
    if (!label || !raw.trim()) {
      return raw;
    }
    const hash = raw.indexOf('#');
    const base = hash >= 0 ? raw.slice(0, hash) : raw;
    return `${base}#${encodeURIComponent(label)}`;
  }

  /** Случайный несуществующий vless для заглушки с заданным отображаемым именем (#fragment) */
  private buildRandomPlaceholderVlessLineForName(displayName: string): string {
    const id = randomUUID();
    const port = 10000 + Math.floor(Math.random() * 55536);
    const raw = `vless://${id}@127.0.0.1:${port}?encryption=none&security=none&type=tcp`;
    return this.applyCustomNameToUri(raw, displayName);
  }
}
