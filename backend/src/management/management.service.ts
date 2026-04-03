import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PanelUser } from '@prisma/client';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { sliceProfileTitleForHappSubscription } from '../common/profile-title-header';
import type { SubscriptionAccessMeta } from '../common/subscription-client-meta';

@Injectable()
export class ManagementService {
  private readonly logger = new Logger(ManagementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Не отдаём subscriptionAccessToken в API панели. */
  private omitSubscriptionAccessToken<T extends { subscriptionAccessToken?: string | null }>(
    row: T,
  ): Omit<T, 'subscriptionAccessToken'> {
    const { subscriptionAccessToken: _omit, ...rest } = row;
    return rest;
  }

  listGroups() {
    return this.prisma.group.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  createGroup(name: string) {
    return this.prisma.group.create({
      data: { name: name.trim() },
    });
  }

  async deleteGroup(id: string) {
    const group = await this.prisma.group.findUnique({ where: { id } });
    if (!group) {
      throw new NotFoundException('Группа не найдена');
    }

    await this.prisma.group.delete({ where: { id } });

    await this.prisma.panelUser.deleteMany({
      where: { groupName: group.name },
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
    const aggregates = await this.prisma.panelUserAccessLog.groupBy({
      by: ['panelUserId'],
      _max: { createdAt: true },
    });
    const lastByUser = new Map(
      aggregates.map((a) => [a.panelUserId, a._max.createdAt]),
    );
    const hwidPairs = await this.prisma.panelUserAccessLog.groupBy({
      by: ['panelUserId', 'hwid'],
      where: { hwid: { not: null } },
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
    groupName: string,
    cryptoOnlySubscription = false,
  ) {
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
        groupName: groupName.trim(),
        allowAllUserAgents: false,
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
  private async fetchHappCryptoLink(subscriptionPageUrl: string): Promise<string | null> {
    const apiUrl = (
      this.config.get<string>('HAPP_CRYPTO_API_URL') ??
      'https://crypto.happ.su/api-v2.php'
    ).trim();
    const url = subscriptionPageUrl.trim();
    if (!apiUrl || !url.startsWith('http')) {
      this.logger.warn(
        'Пропуск запроса к HAPP crypto: неверный URL подписки или endpoint',
      );
      return null;
    }
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
        this.logger.warn(`HAPP crypto API: HTTP ${res.status}`);
        return null;
      }
      const data = (await res.json()) as { encrypted_link?: unknown };
      const link =
        typeof data.encrypted_link === 'string'
          ? data.encrypted_link.trim()
          : '';
      if (link.startsWith('happ://')) {
        return link;
      }
      this.logger.warn('HAPP crypto API: в ответе нет валидного encrypted_link');
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
    const raw = (
      this.config.get<string>('SUBSCRIPTION_CRYPTO_PATH_SEGMENT') ??
      'sub2128937123'
    )
      .trim()
      .replace(/^\/+|\/+$/g, '');
    return raw || 'sub2128937123';
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
      groupName?: string;
      allowAllUserAgents?: boolean;
      requireHwid?: boolean;
      requireNoHwid?: boolean;
      maxUniqueHwids?: number;
      cryptoOnlySubscription?: boolean;
    },
  ) {
    await this.ensureUser(id);
    const data: {
      enabled?: boolean;
      name?: string;
      groupName?: string;
      allowAllUserAgents?: boolean;
      requireHwid?: boolean;
      requireNoHwid?: boolean;
      maxUniqueHwids?: number;
      cryptoOnlySubscription?: boolean;
    } = {};
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
      data.groupName = trimmed;
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
    if (Object.keys(data).length === 0) {
      const row = await this.prisma.panelUser.findUnique({ where: { id } });
      return row ? this.omitSubscriptionAccessToken(row) : null;
    }
    const updated = await this.prisma.panelUser.update({
      where: { id },
      data,
    });
    return this.omitSubscriptionAccessToken(updated);
  }

  /**
   * Массовое обновление пользователей панели и/или очистка логов подписки.
   */
  async bulkUpdatePanelUsers(dto: {
    ids: string[];
    groupName?: string;
    restrictToCurrentGroupName?: string;
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
      throw new BadRequestException('Один или несколько пользователей не найдены');
    }

    const hasPatch =
      dto.groupName !== undefined ||
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

    const where: { id: { in: string[] }; groupName?: string } = { id: { in: uniq } };
    if (dto.groupName !== undefined && restrict) {
      where.groupName = restrict;
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

    const data: {
      groupName?: string;
      enabled?: boolean;
      allowAllUserAgents?: boolean;
      maxUniqueHwids?: number;
      cryptoOnlySubscription?: boolean;
    } = {};
    if (dto.groupName !== undefined) {
      data.groupName = dto.groupName.trim();
    }
    if (dto.enabled !== undefined) {
      data.enabled = dto.enabled;
    }
    if (dto.allowAllUserAgents !== undefined) {
      data.allowAllUserAgents = dto.allowAllUserAgents;
    }
    if (dto.maxUniqueHwids !== undefined) {
      data.maxUniqueHwids = dto.maxUniqueHwids;
    }
    if (dto.cryptoOnlySubscription !== undefined) {
      data.cryptoOnlySubscription = dto.cryptoOnlySubscription;
    }

    let updated = 0;
    if (Object.keys(data).length > 0) {
      const result = await this.prisma.panelUser.updateMany({ where, data });
      updated = result.count;
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
    return this.prisma.connect.update({
      where: { id },
      data: { groupNames: Array.from(new Set(groupNames.map((n) => n.trim()).filter(Boolean))) },
    });
  }

  /**
   * Превышен лимит уникальных HWID: учитываются логи и HWID текущего запроса.
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
      where: { panelUserId, hwid: { not: null } },
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
      return n > maxUniqueHwids;
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

  /** Пользователь панели по коду подписки (в т.ч. отключённый — для решения, что отдавать в /public/sub) */
  async findPanelUserByCode(code: string): Promise<PanelUser | null> {
    return this.prisma.panelUser.findUnique({
      where: { code },
    });
  }

  /**
   * Обычная base64-подписка: коннекты группы пользователя.
   * Фрагмент # в URI — Connect.name; при названии группы — строка #profile-title для Happ.
   */
  async buildPublicFeedForPanelUser(user: PanelUser): Promise<{
    encoded: string;
    profileTitle: string;
    panelUserId: string;
  }> {
    const groupTitle =
      (await this.resolveSubscriptionDisplayNameForUserGroup(
        user.groupName,
      )) ?? '';
    const profileTitle = groupTitle.trim();

    const connects = await this.prisma.connect.findMany({
      where: {
        status: 'ACTIVE',
        groupNames: {
          has: user.groupName,
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      select: { raw: true, name: true },
    });

    const uriLines = connects.map((c) =>
      this.applyCustomNameToUri(c.raw, c.name),
    );
    /** Happ: скрыть настройки серверов (тело подписки), см. app-management */
    const metaLines: string[] = [];
    const titleTrimmed = profileTitle.trim();
    if (titleTrimmed) {
      metaLines.push(
        `#profile-title: ${sliceProfileTitleForHappSubscription(titleTrimmed)}`,
      );
    }
    metaLines.push('#hide-settings: 1');
    const head = metaLines.join('\n');
    const bodyText =
      uriLines.length > 0 ? `${head}\n${uriLines.join('\n')}` : head;
    return {
      encoded: Buffer.from(bodyText, 'utf-8').toString('base64'),
      profileTitle,
      panelUserId: user.id,
    };
  }

  /**
   * Заглушка: случайный vless (не из БД), profile-title и имя в URI — переданный title.
   */
  buildNamedSubscriptionPlaceholderFeed(
    panelUserId: string | null,
    title: string,
  ): {
    encoded: string;
    profileTitle: string;
    panelUserId: string | null;
  } {
    const t = title.trim() || 'Нет подключений';
    const line = this.buildRandomPlaceholderVlessLineForName(t);
    const bodyText = `#profile-title: ${sliceProfileTitleForHappSubscription(t)}\n#hide-settings: 1\n${line}`;
    return {
      encoded: Buffer.from(bodyText, 'utf-8').toString('base64'),
      profileTitle: t,
      panelUserId,
    };
  }

  /**
   * Заглушка при ошибках доступа: случайный vless (не из БД), в клиенте — «Нет подключений».
   * Код неизвестен — panelUserId null (лог не пишем).
   */
  buildNoConnectionsPlaceholderFeed(panelUserId: string | null): {
    encoded: string;
    profileTitle: string;
    panelUserId: string | null;
  } {
    return this.buildNamedSubscriptionPlaceholderFeed(
      panelUserId,
      'Нет подключений',
    );
  }

  /** Запись в лог обращений к подписке (Happ и др.): IP, HWID, UA */
  async logPanelUserSubscriptionAccess(
    panelUserId: string,
    meta: SubscriptionAccessMeta,
  ): Promise<void> {
    const cap = (s: string | undefined, max: number) =>
      s && s.length > max ? `${s.slice(0, max)}…` : s;
    await this.prisma.panelUserAccessLog.create({
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
      },
    });
  }

  /**
   * Логи обращений клиентов к подписке (GET /public/sub/:code) для пользователя панели.
   */
  async listPanelUserSubscriptionAccessLogs(
    panelUserId: string,
    limit: number,
  ): Promise<{
    user: { name: string; code: string };
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
      createdAt: Date;
    }>;
  }> {
    await this.ensureUser(panelUserId);
    const user = await this.prisma.panelUser.findUniqueOrThrow({
      where: { id: panelUserId },
      select: { name: true, code: true },
    });
    const logs = await this.prisma.panelUserAccessLog.findMany({
      where: { panelUserId },
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
        createdAt: true,
      },
    });
    return { user, logs };
  }

  async getPublicUserByCode(code: string) {
    const user = await this.prisma.panelUser.findUnique({
      where: { code },
      select: {
        name: true,
        code: true,
        enabled: true,
        groupName: true,
        happCryptoUrl: true,
        cryptoOnlySubscription: true,
      },
    });
    if (!user) {
      throw new NotFoundException('Пользователь не найден');
    }

    const { happCryptoUrl: rawHappCrypto, ...publicUser } = user;
    const happCryptoUrl =
      typeof rawHappCrypto === 'string' && rawHappCrypto.trim().startsWith('happ://')
        ? rawHappCrypto.trim()
        : null;

    const groups = await this.collectPublicDisplayGroupNames(user.groupName);

    const sub =
      (await this.resolveSubscriptionDisplayNameForUserGroup(
        user.groupName,
      )) ?? '';
    const trimmedSub = sub.trim();
    const profileTitle = trimmedSub || null;

    const appLinks = await this.getPublicAppLinksForCode(
      user.code,
      happCryptoUrl,
      user.cryptoOnlySubscription === true,
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
      /** Название и готовая ссылка для блока «Приложения» на /sub */
      appLinks,
    };
  }

  /**
   * Уникальные названия групп: PanelUser.groupName и все теги groupNames у активных коннектов ленты.
   * Имя приводится к записи Group.name в БД при совпадении (регистр, NFC).
   */
  private async collectPublicDisplayGroupNames(
    panelGroupName: string,
  ): Promise<string[]> {
    const raw = new Set<string>();
    const primary = panelGroupName.trim();
    if (primary) {
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
          (g) =>
            g.name.trim().normalize('NFC').toLowerCase() === targetLower,
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

  async updateGroupSettings(
    id: string,
    dto: { subscriptionDisplayName?: string | null },
  ) {
    await this.ensureGroupById(id);
    if (dto.subscriptionDisplayName === undefined) {
      return this.prisma.group.findUnique({ where: { id } });
    }
    let subscriptionDisplayName: string | null;
    if (dto.subscriptionDisplayName === null) {
      subscriptionDisplayName = null;
    } else {
      const trimmed = dto.subscriptionDisplayName.trim();
      subscriptionDisplayName = trimmed === '' ? null : trimmed;
    }
    return this.prisma.group.update({
      where: { id },
      data: { subscriptionDisplayName },
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
   * База для полного URL страницы подписки: сначала PUBLIC_SUBSCRIPTION_BASE_URL,
   * иначе FRONTEND_ORIGIN (чтобы всегда получать https://домен/sub/CODE при наличии env).
   */
  private subscriptionPublicOrigin(): string {
    const primary = (this.config.get<string>('PUBLIC_SUBSCRIPTION_BASE_URL') ?? '')
      .trim()
      .replace(/\/$/, '');
    if (primary) {
      return primary;
    }
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
   * Название подписки из админки для группы пользователя: PanelUser.groupName → Group.name,
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
      groups.find(
        (g) => g.name.trim().normalize('NFC') === normalizedTarget,
      ) ??
      groups.find(
        (g) =>
          g.name.trim().normalize('NFC').toLowerCase() === targetLower,
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

