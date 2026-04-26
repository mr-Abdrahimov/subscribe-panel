import {
  BadGatewayException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import {
  ensureUngroupedConnectGroupExists,
  UNGROUPED_CONNECT_GROUP_NAME,
} from '../common/ungrouped-connect-group';
import { BalancersService } from '../balancers/balancers.service';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from '../telegram/telegram.service';
import {
  normalizedConnectIdentity,
  prepareConnectUriForParse,
  stableMatchIdentity,
  subscriptionIncomingDedupeKey,
} from './connect-identity.util';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';
import { uriToOutbound, outboundToUri, extractProxyOutbound } from './uri-to-outbound.util';

/** Совпадает с ManagementService.PANEL_GLOBAL_SETTINGS_ID */
const PANEL_GLOBAL_SETTINGS_ID = 'global';

/** Заголовок для поля hwid подписки при GET к url */
const SUBSCRIPTION_FETCH_HWID_HEADER = 'X-HWID';

/** Как в CreateSubscriptionDto — не раздувать название из ответа провайдера */
const SUBSCRIPTION_TITLE_MAX_LEN = 200;

const TELEGRAM_MESSAGE_MAX = 3900;

/** Не удалять имеющиеся коннекты, если пришёл пустой список (ошибка/обрыв у провайдера). */
const EMPTY_REMOTE_LIST_MESSAGE =
  'Получен пустой список коннектов при наличии ранее загруженных. Синхронизация отменена, чтобы не удалить существующие коннекты.';

/** Предупреждение в Telegram, если до окончания подписки меньше этого интервала */
const SUBSCRIPTION_EXPIRY_TELEGRAM_WARN_MS = 10 * 60 * 60 * 1000;

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegramService: TelegramService,
    private readonly config: ConfigService,
    private readonly balancersService: BalancersService,
  ) {}

  findAll() {
    return this.prisma.subscription.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { connects: true },
        },
      },
    });
  }

  create(dto: CreateSubscriptionDto) {
    return this.prisma.subscription.create({
      data: {
        title: dto.title,
        url: dto.url,
        sourceUrl: dto.sourceUrl?.trim() || null,
        fetchIntervalMinutes: dto.fetchIntervalMinutes ?? null,
        userAgent: dto.userAgent?.trim() || null,
        hwid: dto.hwid?.trim() || null,
        feedMode: dto.feedMode ?? 'BASE64',
      },
    });
  }

  async update(id: string, dto: UpdateSubscriptionDto) {
    await this.ensureExists(id);

    const data: Prisma.SubscriptionUpdateInput = {
      title: dto.title,
      url: dto.url,
    };
    if (dto.fetchIntervalMinutes !== undefined) {
      data.fetchIntervalMinutes = dto.fetchIntervalMinutes;
    }
    if (dto.userAgent !== undefined) {
      data.userAgent =
        dto.userAgent === null ? null : dto.userAgent.trim() || null;
    }
    if (dto.hwid !== undefined) {
      data.hwid = dto.hwid === null ? null : dto.hwid.trim() || null;
    }
    if (dto.sourceUrl !== undefined) {
      data.sourceUrl =
        dto.sourceUrl === null ? null : dto.sourceUrl.trim() || null;
    }
    if (dto.feedMode !== undefined) {
      data.feedMode = dto.feedMode;
    }

    return this.prisma.subscription.update({
      where: { id },
      data,
    });
  }

  async remove(id: string) {
    await this.ensureExists(id);

    // Перед удалением вычищаем эти коннекты из пулов балансировщиков
    const connectsToDelete = await this.prisma.connect.findMany({
      where: { subscriptionId: id },
      select: { id: true },
    });
    for (const { id: cid } of connectsToDelete) {
      await this.balancersService.removeConnectFromAllBalancers(cid);
    }

    await this.prisma.connect.deleteMany({
      where: { subscriptionId: id },
    });

    await this.prisma.subscription.delete({
      where: { id },
    });
  }

  async fetchConnects(id: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id },
    });

    if (!subscription) {
      throw new NotFoundException('Подписка не найдена');
    }

    await ensureUngroupedConnectGroupExists(this.prisma);

    const isJsonMode = subscription.feedMode === 'JSON';

    const headers = new Headers();
    const ua = subscription.userAgent?.trim();
    if (ua) {
      headers.set('User-Agent', ua);
    }
    const hw = subscription.hwid?.trim();
    if (hw) {
      headers.set(SUBSCRIPTION_FETCH_HWID_HEADER, hw);
      // Happ также шлёт HWID без префикса X-
      headers.set('HWID', hw);
    }

    // JSON-режим требует полного набора заголовков, как отправляет Happ-клиент
    if (isJsonMode) {
      headers.set(
        'Accept',
        'application/json, text/plain, */*',
      );
      headers.set('Accept-Language', 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7');
      headers.set('Accept-Encoding', 'gzip, deflate, br');
      headers.set('Cache-Control', 'no-cache');
      headers.set('Pragma', 'no-cache');
      headers.set('Connection', 'keep-alive');
      headers.set('X-Device-OS', 'macOS');
      headers.set('X-Device-Locale', 'ru');
      headers.set('If-None-Match', 'W/"2927-1xES5jfyaL7GcApf4JC529f24Gg"');
      headers.set('X-Ver-OS', '26.4.1');
      headers.set('X-App-Version', '4.8.2');
      headers.set('X-Device-model', 'MacBook');
      // 'X-HWID': '8aa65da1baf4f22a',
      // 'User-Agent': 'Happ/4.8.2/macos catalyst/2604241624661',
    }

    const rawTimeout = Number(
      this.config.get<string>('SUBSCRIPTION_FETCH_TIMEOUT_MS') ?? 120_000,
    );
    const timeoutMs = Number.isFinite(rawTimeout)
      ? Math.min(300_000, Math.max(10_000, Math.trunc(rawTimeout)))
      : 120_000;

    const response = await fetch(subscription.url, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();

    if (!response.ok) {
      throw new BadGatewayException(
        `Сервер подписки ответил с ошибкой: HTTP ${response.status} ${response.statusText}`.trim(),
      );
    }

    // JSON-режим: парсим JSON-ответ и синхронизируем коннекты в БД
    if (isJsonMode) {
      return await this.fetchConnectsFromJson(id, response, text);
    }

    const decodedPayload = this.decodeSubscriptionRawPayload(text);
    const links = this.extractUriLinesFromDecodedContent(decodedPayload);
    const remoteTitle = this.resolveRemoteSubscriptionTitle(
      response,
      decodedPayload,
    );
    const remoteExpiresAt = this.resolveRemoteSubscriptionExpiresAt(
      response,
      decodedPayload,
    );
    const remoteTrafficUsedBytes = this.resolveRemoteSubscriptionTrafficUsedBytes(
      response,
      decodedPayload,
    );
    const remoteTrafficTotalBytes = this.resolveRemoteSubscriptionTrafficTotalBytes(
      response,
      decodedPayload,
    );
    const existingConnects = await this.prisma.connect.findMany({
      where: { subscriptionId: id },
      select: {
        id: true,
        raw: true,
        rawJson: true,
        name: true,
        originalName: true,
        sortOrder: true,
        protocol: true,
        identityKey: true,
        createdAt: true,
      },
    });

    if (links.length === 0 && existingConnects.length > 0) {
      this.logger.warn(
        `[fetchConnects] subscriptionId=${id}: пустой список при непустой БД — пропуск синхронизации`,
      );
      throw new BadGatewayException(EMPTY_REMOTE_LIST_MESSAGE);
    }

    /**
     * Одна запись на стабильный ключ (для vless — без UUID в userinfo, sni/sid): дубликаты и «та же нода,
     * другой UUID/SNI» в одном fetch схлопываем (последняя строка побеждает).
     * identityKey в БД — полный {@link normalizedConnectIdentity}, чтобы отличать реально разные URI.
     */
    const incomingByDedupeKey = new Map<
      string,
      {
        raw: string;
        originalName: string;
        protocol: string;
        fullIdentity: string;
      }
    >();
    for (const raw of links) {
      const dedupeKey = subscriptionIncomingDedupeKey(raw);
      const fullIdentity = normalizedConnectIdentity(raw);
      incomingByDedupeKey.set(dedupeKey, {
        raw,
        originalName: this.extractConnectName(raw),
        protocol: this.extractProtocol(raw),
        fullIdentity,
      });
    }

    /**
     * Явное сопоставление: коннект из подписки ищем в БД по текущему normalize(raw) ИЛИ по сохранённому identityKey.
     * Раньше «лишние» определялись только по normalize(raw) — при расхождении с identityKey строка удалялась
     * и создавалась заново с новым sortOrder (визуально «в конец»).
     */
    const matchedIds = new Set<string>();
    const poolSorted = [...existingConnects].sort((a, b) => {
      const byOrder = a.sortOrder - b.sortOrder;
      if (byOrder !== 0) {
        return byOrder;
      }
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

    /**
     * Порядок на /connects — глобальный по sortOrder (все подписки в одной таблице).
     * Брать max только по текущей подписке давало дубликаты sortOrder с другими подписками;
     * при равном sortOrder сортировка идёт по createdAt desc — новый коннект оказывался не в конце.
     */
    const globalMaxAgg = await this.prisma.connect.aggregate({
      _max: { sortOrder: true },
    });
    let nextSortOrder = globalMaxAgg._max.sortOrder ?? 0;
    const newUngroupedDisplayNames: string[] = [];

    for (const [, incoming] of incomingByDedupeKey) {
      const existing = poolSorted.find(
        (c) =>
          !matchedIds.has(c.id) &&
          this.connectMatchesIdentity(
            c,
            incoming.fullIdentity,
            incoming.raw,
          ),
      );

      const outbound = uriToOutbound(incoming.raw);
      const rawJsonValue = outbound as Prisma.InputJsonValue | null;

      if (!existing) {
        nextSortOrder += 1;

        await this.prisma.connect.create({
          data: {
            originalName: incoming.originalName,
            name: incoming.originalName,
            raw: incoming.raw,
            rawJson: rawJsonValue ?? undefined,
            identityKey: incoming.fullIdentity,
            protocol: incoming.protocol,
            status: 'ACTIVE',
            hidden: false,
            tags: [],
            groupNames: [UNGROUPED_CONNECT_GROUP_NAME],
            sortOrder: nextSortOrder,
            subscriptionId: id,
          },
        });
        newUngroupedDisplayNames.push(incoming.originalName);
        continue;
      }

      matchedIds.add(existing.id);

      const data: {
        raw?: string;
        rawJson?: Prisma.InputJsonValue | null;
        originalName?: string;
        protocol?: string;
        identityKey?: string;
      } = {};
      if (existing.raw !== incoming.raw) {
        data.raw = incoming.raw;
        // URI изменился — обновляем и rawJson
        data.rawJson = rawJsonValue;
      } else if (existing.rawJson === null || existing.rawJson === undefined) {
        // rawJson ещё не было — заполняем
        data.rawJson = rawJsonValue;
      }
      if (existing.originalName !== incoming.originalName) {
        data.originalName = incoming.originalName;
      }
      if (existing.protocol !== incoming.protocol) {
        data.protocol = incoming.protocol;
      }
      if ((existing.identityKey ?? '') !== incoming.fullIdentity) {
        data.identityKey = incoming.fullIdentity;
      }
      if (Object.keys(data).length > 0) {
        await this.prisma.connect.update({
          where: { id: existing.id },
          data,
        });
      }
    }

    const staleConnects = existingConnects.filter((c) => !matchedIds.has(c.id));
    const staleIds = staleConnects.map((c) => c.id);
    const removedDisplayNames = staleConnects.map((c) => c.name);
    if (staleIds.length > 0) {
      for (const staleId of staleIds) {
        await this.balancersService.removeConnectFromAllBalancers(staleId);
      }
      await this.prisma.connect.deleteMany({
        where: { id: { in: staleIds } },
      });
    }

    const nextTelegramExpiryMarker =
      await this.resolveTelegramSubscriptionExpiryWarning(
        subscription,
        remoteTitle ?? null,
        remoteExpiresAt,
      );

    const updatedSubscription = await this.prisma.subscription.update({
      where: { id },
      data: {
        lastFetchedAt: new Date(),
        fetchedProfileTitle: remoteTitle ?? null,
        fetchedSubscriptionExpiresAt: remoteExpiresAt,
        fetchedTrafficUsedBytes:
          remoteTrafficUsedBytes != null ? remoteTrafficUsedBytes.toString() : null,
        fetchedTrafficTotalBytes:
          remoteTrafficTotalBytes != null ? remoteTrafficTotalBytes.toString() : null,
        telegramExpiryWarningSentForExpiresAt: nextTelegramExpiryMarker,
      },
    });

    if (newUngroupedDisplayNames.length > 0 || removedDisplayNames.length > 0) {
      await this.notifyTelegramConnectsChanged(
        updatedSubscription.title,
        newUngroupedDisplayNames,
        removedDisplayNames,
      );
    }

    const connects = await this.prisma.connect.findMany({
      where: { subscriptionId: id },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        name: true,
      },
    });

    return {
      subscriptionId: id,
      fetchedAt: updatedSubscription.lastFetchedAt,
      title: updatedSubscription.title,
      fetchedProfileTitle: updatedSubscription.fetchedProfileTitle,
      fetchedSubscriptionExpiresAt: updatedSubscription.fetchedSubscriptionExpiresAt,
      total: connects.length,
      connects,
    };
  }

  /**
   * JSON-режим: парсит ответ подписки как JSON и синхронизирует коннекты в БД
   * по той же логике upsert/delete, что и BASE64-режим.
   * Поддерживает форматы: массив URI-строк, массив объектов { name, url },
   * Happ-формат (массив v2ray-конфигов [{ remarks, outbounds }]) и Sing-box ({ outbounds }).
   */
  private async fetchConnectsFromJson(
    subscriptionId: string,
    response: Response,
    rawText: string,
  ): Promise<{
    subscriptionId: string;
    fetchedAt: Date | null;
    feedMode: string;
    title: string;
    fetchedProfileTitle: string | null;
    fetchedSubscriptionExpiresAt: Date | null;
    total: number;
    connects: { id: string; name: string }[];
  }> {
    // Заголовки парсим сразу — они нужны и при ошибке JSON
    // decodedPayload для JSON-режима пустой (нет текстового тела с мета-строками)
    const emptyPayload = '';
    const remoteTitle = this.resolveRemoteSubscriptionTitle(response, emptyPayload);
    const remoteExpiresAt = this.resolveRemoteSubscriptionExpiresAt(response, emptyPayload);
    const remoteTrafficUsedBytes = this.resolveRemoteSubscriptionTrafficUsedBytes(response, emptyPayload);
    const remoteTrafficTotalBytes = this.resolveRemoteSubscriptionTrafficTotalBytes(response, emptyPayload);

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText.trim());
    } catch {
      this.logger.warn(
        `[JSON-mode] subscriptionId=${subscriptionId}: не удалось разобрать JSON: ${rawText.slice(0, 200)}`,
      );
      throw new BadGatewayException(
        'Ответ подписки не является валидным JSON, существующие коннекты не изменены',
      );
    }

    // --- Парсинг: собираем { originalName, raw, protocol, rawJson } ---
    type RawEntry = {
      originalName: string;
      raw: string;
      protocol: string;
      rawJson: unknown; // исходный JSON-объект конфига (null для URI-строк)
    };
    const entries: RawEntry[] = [];

    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        // Массив URI-строк
        if (typeof item === 'string') {
          const s = item.trim();
          if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
            entries.push({
              originalName: this.extractConnectName(s),
              raw: s,
              protocol: this.extractProtocol(s),
              rawJson: null,
            });
          }
          continue;
        }
        if (!item || typeof item !== 'object') continue;
        const obj = item as Record<string, unknown>;

        // Happ/v2ray формат: [{ remarks, outbounds: [{ tag:'proxy', protocol, settings }] }]
        if ('outbounds' in obj && Array.isArray(obj['outbounds'])) {
          const remarks = String(obj['remarks'] ?? '').trim();
          const proxy = (obj['outbounds'] as Record<string, unknown>[]).find(
            (o) => o['tag'] === 'proxy',
          );
          const protocol = proxy ? String(proxy['protocol'] ?? '').trim() : 'unknown';
          const server = this.extractV2rayServer(proxy);
          const port = this.extractV2rayPort(proxy);
          const rawKey = `json://${protocol}/${server}${port ? `:${port}` : ''}/${encodeURIComponent(remarks)}`;
          const displayName = remarks || (server ? `${protocol}:${server}` : protocol);
          entries.push({ originalName: displayName, raw: rawKey, protocol, rawJson: item });
          continue;
        }

        // Простой объект: { name/tag/remarks, url/link/address }
        const rawUri = String(obj['url'] ?? obj['link'] ?? obj['address'] ?? '').trim();
        const name = String(obj['name'] ?? obj['tag'] ?? obj['remarks'] ?? rawUri).trim();
        if (rawUri) {
          entries.push({
            originalName: name || rawUri,
            raw: rawUri,
            protocol: this.extractProtocol(rawUri),
            rawJson: item,
          });
        }
      }
    // Sing-box: { outbounds: [...] }
    } else if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      const outbounds = Array.isArray(obj['outbounds']) ? obj['outbounds'] : [];
      for (const ob of outbounds) {
        if (!ob || typeof ob !== 'object') continue;
        const o = ob as Record<string, unknown>;
        const tag = String(o['tag'] ?? '').trim();
        const type = String(o['type'] ?? o['protocol'] ?? '').trim();
        if (['selector', 'urltest', 'direct', 'dns', 'block', 'freedom', 'blackhole', ''].includes(type)) continue;
        const server = this.extractV2rayServer(o);
        const port = this.extractV2rayPort(o);
        const rawKey = `json://${type}/${server}${port ? `:${port}` : ''}/${encodeURIComponent(tag)}`;
        const displayName = tag || (type && server ? `${type}:${server}` : type || server || 'unknown');
        entries.push({ originalName: displayName, raw: rawKey, protocol: type, rawJson: ob });
      }
    }

    // --- Конвертируем JSON-конфиги → URI для BASE64-ленты ---
    // Для каждой записи с синтетическим raw (json://...) пытаемся
    // восстановить реальный proxy-URI из rawJson, чтобы коннект работал
    // в обоих режимах: BASE64 и JSON.
    for (const entry of entries) {
      if (!entry.raw.startsWith('json://') || !entry.rawJson) continue;
      try {
        const proxyOutbound = extractProxyOutbound(entry.rawJson as Record<string, unknown>);
        if (!proxyOutbound) continue;
        const uri = outboundToUri(proxyOutbound, entry.originalName);
        if (uri) {
          entry.raw = uri;
          entry.protocol = entry.protocol || String(proxyOutbound['protocol'] ?? '').trim();
        }
      } catch {
        // Не конвертируется — оставляем синтетический ключ
      }
    }

    this.logger.log(
      `[JSON-mode] subscriptionId=${subscriptionId}: найдено ${entries.length} записей`,
    );

    // --- Sync в БД: та же логика upsert/delete, что в BASE64-режиме ---
    const existingConnects = await this.prisma.connect.findMany({
      where: { subscriptionId },
      select: {
        id: true,
        raw: true,
        name: true,
        originalName: true,
        sortOrder: true,
        protocol: true,
        identityKey: true,
        createdAt: true,
      },
    });

    if (entries.length === 0 && existingConnects.length > 0) {
      this.logger.warn(
        `[JSON-mode] subscriptionId=${subscriptionId}: пустой список при непустой БД — пропуск синхронизации`,
      );
      throw new BadGatewayException(EMPTY_REMOTE_LIST_MESSAGE);
    }

    /**
     * Дедупликация входящих: та же что в BASE64-режиме.
     * Для vless — по стабильному ядру без UUID/sni/sid; иначе — по normalizedConnectIdentity.
     * При смене UUID одна нода → одна запись, не дублируется.
     */
    const incomingByDedupeKey = new Map<
      string,
      { raw: string; originalName: string; protocol: string; fullIdentity: string; rawJson: unknown }
    >();
    for (const e of entries) {
      const dedupeKey = subscriptionIncomingDedupeKey(e.raw);
      const fullIdentity = normalizedConnectIdentity(e.raw);
      incomingByDedupeKey.set(dedupeKey, { ...e, fullIdentity });
    }

    const matchedIds = new Set<string>();
    const poolSorted = [...existingConnects].sort((a, b) => {
      const byOrder = a.sortOrder - b.sortOrder;
      return byOrder !== 0 ? byOrder : a.createdAt.getTime() - b.createdAt.getTime();
    });

    const globalMaxAgg = await this.prisma.connect.aggregate({
      _max: { sortOrder: true },
    });
    let nextSortOrder = globalMaxAgg._max.sortOrder ?? 0;
    const newUngroupedDisplayNames: string[] = [];

    for (const [, incoming] of incomingByDedupeKey) {
      // Ищем совпадение по тем же трём критериям что в BASE64-режиме:
      // 1. normalizedConnectIdentity(c.raw) === incoming.fullIdentity
      // 2. c.identityKey === incoming.fullIdentity
      // 3. stableMatchIdentity совпадает (смена UUID/SNI/sid/пароля)
      const existing = poolSorted.find(
        (c) =>
          !matchedIds.has(c.id) &&
          this.connectMatchesIdentity(c, incoming.fullIdentity, incoming.raw),
      );

      const rawJsonValue = (incoming.rawJson as Prisma.InputJsonValue | null | undefined) ?? null;

      if (!existing) {
        nextSortOrder += 1;
        await this.prisma.connect.create({
          data: {
            originalName: incoming.originalName,
            name: incoming.originalName,
            raw: incoming.raw,
            rawJson: rawJsonValue ?? undefined,
            identityKey: incoming.fullIdentity,
            protocol: incoming.protocol,
            status: 'ACTIVE',
            hidden: false,
            tags: [],
            groupNames: [UNGROUPED_CONNECT_GROUP_NAME],
            sortOrder: nextSortOrder,
            subscriptionId,
          },
        });
        newUngroupedDisplayNames.push(incoming.originalName);
        continue;
      }

      matchedIds.add(existing.id);

      const data: {
        raw?: string;
        rawJson?: Prisma.InputJsonValue | null;
        originalName?: string;
        protocol?: string;
        identityKey?: string;
      } = {};

      // Обновляем raw если URI изменился (например сменился UUID)
      if (existing.raw !== incoming.raw) {
        data.raw = incoming.raw;
      }
      // rawJson всегда обновляем — конфиг мог измениться (новый UUID, параметры и т.д.)
      data.rawJson = rawJsonValue;
      if (existing.originalName !== incoming.originalName) {
        data.originalName = incoming.originalName;
      }
      if (existing.protocol !== incoming.protocol) {
        data.protocol = incoming.protocol;
      }
      if ((existing.identityKey ?? '') !== incoming.fullIdentity) {
        data.identityKey = incoming.fullIdentity;
      }
      if (Object.keys(data).length > 0) {
        await this.prisma.connect.update({ where: { id: existing.id }, data });
      }
    }

    const staleConnects = existingConnects.filter((c) => !matchedIds.has(c.id));
    const staleIds = staleConnects.map((c) => c.id);
    const removedDisplayNames = staleConnects.map((c) => c.name);
    if (staleIds.length > 0) {
      for (const staleId of staleIds) {
        await this.balancersService.removeConnectFromAllBalancers(staleId);
      }
      await this.prisma.connect.deleteMany({ where: { id: { in: staleIds } } });
    }

    const subscriptionForTelegram = await this.prisma.subscription.findUniqueOrThrow({
      where: { id: subscriptionId },
    });

    const nextTelegramExpiryMarker = await this.resolveTelegramSubscriptionExpiryWarning(
      subscriptionForTelegram,
      remoteTitle ?? null,
      remoteExpiresAt,
    );

    const updatedSubscription = await this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        lastFetchedAt: new Date(),
        fetchedProfileTitle: remoteTitle ?? null,
        fetchedSubscriptionExpiresAt: remoteExpiresAt,
        fetchedTrafficUsedBytes:
          remoteTrafficUsedBytes != null ? remoteTrafficUsedBytes.toString() : null,
        fetchedTrafficTotalBytes:
          remoteTrafficTotalBytes != null ? remoteTrafficTotalBytes.toString() : null,
        telegramExpiryWarningSentForExpiresAt: nextTelegramExpiryMarker,
      },
    });

    if (newUngroupedDisplayNames.length > 0 || removedDisplayNames.length > 0) {
      await this.notifyTelegramConnectsChanged(
        updatedSubscription.title,
        newUngroupedDisplayNames,
        removedDisplayNames,
      );
    }

    const connects = await this.prisma.connect.findMany({
      where: { subscriptionId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, name: true },
    });

    return {
      subscriptionId,
      fetchedAt: updatedSubscription.lastFetchedAt,
      feedMode: 'JSON',
      title: updatedSubscription.title,
      fetchedProfileTitle: updatedSubscription.fetchedProfileTitle,
      fetchedSubscriptionExpiresAt: updatedSubscription.fetchedSubscriptionExpiresAt,
      total: connects.length,
      connects,
    };
  }

  /**
   * Извлекает адрес сервера из v2ray/xray outbound-объекта.
   * Поддерживает vnext[].address (vless/vmess/trojan) и прямое поле address/server.
   */
  private extractV2rayServer(
    proxy: Record<string, unknown> | null | undefined,
  ): string {
    if (!proxy) return '';
    const settings = proxy['settings'];
    if (settings && typeof settings === 'object') {
      const s = settings as Record<string, unknown>;
      const vnext = s['vnext'];
      if (Array.isArray(vnext) && vnext.length > 0) {
        const first = vnext[0] as Record<string, unknown>;
        return String(first['address'] ?? '').trim();
      }
      if (s['address']) return String(s['address']).trim();
      if (s['server']) return String(s['server']).trim();
    }
    if (proxy['server']) return String(proxy['server']).trim();
    if (proxy['address']) return String(proxy['address']).trim();
    return '';
  }

  /**
   * Извлекает порт из v2ray/xray outbound-объекта.
   */
  private extractV2rayPort(
    proxy: Record<string, unknown> | null | undefined,
  ): number | null {
    if (!proxy) return null;
    const settings = proxy['settings'];
    if (settings && typeof settings === 'object') {
      const s = settings as Record<string, unknown>;
      const vnext = s['vnext'];
      if (Array.isArray(vnext) && vnext.length > 0) {
        const first = vnext[0] as Record<string, unknown>;
        const p = Number(first['port']);
        if (Number.isFinite(p)) return p;
      }
      const p = Number(s['port']);
      if (Number.isFinite(p)) return p;
    }
    const p = Number(proxy['port'] ?? proxy['server_port']);
    if (Number.isFinite(p)) return p;
    return null;
  }

  /**
   * Совпадение: полный ключ (normalize raw), сохранённый identityKey, либо стабильное ядро VLESS
   * без userinfo (UUID), sni/servername/sid — смена только UUID, SNI или Reality short_id обновляет запись.
   */
  private connectMatchesIdentity(
    c: { raw: string; identityKey: string | null },
    incomingFullIdentity: string,
    incomingRaw: string,
  ): boolean {
    if (normalizedConnectIdentity(c.raw) === incomingFullIdentity) {
      return true;
    }
    const stored = c.identityKey?.trim();
    if (!!stored && stored === incomingFullIdentity) {
      return true;
    }
    const stableRow = stableMatchIdentity(c.raw);
    const stableIn = stableMatchIdentity(incomingRaw);
    return (
      stableRow !== null &&
      stableIn !== null &&
      stableRow.length > 0 &&
      stableRow === stableIn
    );
  }

  private async ensureExists(id: string) {
    const exists = await this.prisma.subscription.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!exists) {
      throw new NotFoundException('Подписка не найдена');
    }
  }

  /**
   * Сырой ответ GET подписки → текст ленты (раскодированный base64 при необходимости).
   */
  private decodeSubscriptionRawPayload(payload: string): string {
    const trimmed = payload.trim();
    let content = trimmed;

    const looksLikeBase64 =
      !trimmed.includes('://') && /^[A-Za-z0-9+/=\r\n]+$/.test(trimmed);

    if (looksLikeBase64) {
      try {
        content = Buffer.from(trimmed.replace(/\s/g, ''), 'base64').toString(
          'utf-8',
        );
      } catch {
        content = trimmed;
      }
    }

    return content;
  }

  private extractUriLinesFromDecodedContent(content: string): string[] {
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .filter((line) => /^[a-z][a-z0-9+.-]*:\/\//i.test(line));
  }

  /**
   * Имя профиля из ответа провайдера (Happ / v2rayTun и др.): заголовок profile-title,
   * опционально с префиксом base64: для UTF-8 / эмодзи.
   */
  private parseProfileTitleHeader(raw: string | null): string | null {
    if (raw == null) {
      return null;
    }
    let s = raw.trim().replace(/^\uFEFF/, '');
    if (!s) {
      return null;
    }
    if (
      (s.startsWith('"') && s.endsWith('"')) ||
      (s.startsWith("'") && s.endsWith("'"))
    ) {
      s = s.slice(1, -1).trim();
    }
    if (!s) {
      return null;
    }
    const lower = s.toLowerCase();
    if (lower.startsWith('base64:')) {
      const b64 = s.slice(7).trim().replace(/\s/g, '');
      if (!b64) {
        return null;
      }
      try {
        const decoded = Buffer.from(b64, 'base64').toString('utf8').trim();
        return this.clampSubscriptionTitle(decoded);
      } catch {
        return null;
      }
    }
    return this.clampSubscriptionTitle(s);
  }

  private clampSubscriptionTitle(s: string): string | null {
    const t = s.trim().replace(/\s+/g, ' ');
    if (!t) {
      return null;
    }
    if (t.length > SUBSCRIPTION_TITLE_MAX_LEN) {
      return t.slice(0, SUBSCRIPTION_TITLE_MAX_LEN);
    }
    return t;
  }

  /**
   * Строка «#profile-title: …» / «# profile-title: …» до первой URI-строки (часто base64:… в теле после декодирования).
   */
  private extractProfileTitleMetaFromDecodedBody(
    decodedContent: string,
  ): string | null {
    const lines = decodedContent
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    for (const line of lines) {
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(line)) {
        break;
      }
      const m = line.match(/^#\s*profile-title:\s*(.+)$/i);
      if (m) {
        return this.parseProfileTitleHeader(m[1].trim());
      }
    }
    return null;
  }

  /**
   * Первая строка вида «# Название» в текстовой ленте (часто перед списком URI).
   */
  private extractTitleFromDecodedSubscriptionBody(decodedContent: string): string | null {
    const lines = decodedContent
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length < 2) {
      return null;
    }
    const first = lines[0];
    if (!first.startsWith('#')) {
      return null;
    }
    if (/^#\s*profile-title:/i.test(first)) {
      return null;
    }
    return this.clampSubscriptionTitle(first.slice(1).trim());
  }

  private resolveRemoteSubscriptionTitle(
    response: Response,
    decodedPayload: string,
  ): string | null {
    const fromHeader = this.parseProfileTitleHeader(
      response.headers.get('profile-title'),
    );
    if (fromHeader != null) {
      return fromHeader;
    }
    const fromBodyMeta = this.extractProfileTitleMetaFromDecodedBody(decodedPayload);
    if (fromBodyMeta != null) {
      return fromBodyMeta;
    }
    return this.extractTitleFromDecodedSubscriptionBody(decodedPayload);
  }

  /**
   * Unix time из subscription-userinfo: «expire=…» (секунды или мс). 0 или отсутствие — без срока.
   */
  private parseExpireUnixToDate(unix: number): Date | null {
    if (!Number.isFinite(unix) || unix <= 0) {
      return null;
    }
    const ms = unix > 10_000_000_000 ? unix : unix * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  private parseExpireFromSubscriptionUserinfoString(raw: string): Date | null {
    const t = raw.trim();
    if (!t) {
      return null;
    }
    const m = t.match(/(?:^|;\s*)expire\s*=\s*(\d+)/i);
    if (!m) {
      return null;
    }
    const n = Number.parseInt(m[1], 10);
    return this.parseExpireUnixToDate(n);
  }

  /**
   * Трафик из subscription-userinfo:
   * чаще всего: upload=…; download=…; total=…; expire=…
   * Нам нужен «потрачено»: upload + download.
   */
  private parseUsedBytesFromSubscriptionUserinfoString(
    raw: string,
  ): bigint | null {
    const t = raw.trim();
    if (!t) {
      return null;
    }
    const up = t.match(/(?:^|;\s*)upload\s*=\s*(\d+)/i);
    const down = t.match(/(?:^|;\s*)download\s*=\s*(\d+)/i);
    if (!up && !down) {
      return null;
    }
    try {
      const u = up ? BigInt(up[1]) : 0n;
      const d = down ? BigInt(down[1]) : 0n;
      const sum = u + d;
      return sum >= 0n ? sum : null;
    } catch {
      return null;
    }
  }

  private parseTotalBytesFromSubscriptionUserinfoString(raw: string): bigint | null {
    const t = raw.trim();
    if (!t) {
      return null;
    }
    const total = t.match(/(?:^|;\s*)total\s*=\s*(\d+)/i);
    if (!total) {
      return null;
    }
    try {
      const n = BigInt(total[1]);
      return n >= 0n ? n : null;
    } catch {
      return null;
    }
  }

  /**
   * Строка «#subscription-userinfo: …» до первой URI (как в ленте после base64).
   */
  private extractSubscriptionUserinfoMetaFromDecodedBody(
    decodedContent: string,
  ): string | null {
    const lines = decodedContent
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    for (const line of lines) {
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(line)) {
        break;
      }
      const m = line.match(/^#\s*subscription-userinfo:\s*(.+)$/i);
      if (m) {
        return m[1].trim();
      }
    }
    return null;
  }

  /**
   * «#expire: 1234567890» до первой URI.
   */
  private extractExpireMetaLineFromDecodedBody(
    decodedContent: string,
  ): Date | null {
    const lines = decodedContent
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    for (const line of lines) {
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(line)) {
        break;
      }
      const m = line.match(/^#\s*expire:\s*(\d+)\s*$/i);
      if (m) {
        const n = Number.parseInt(m[1], 10);
        return this.parseExpireUnixToDate(n);
      }
    }
    return null;
  }

  private resolveRemoteSubscriptionExpiresAt(
    response: Response,
    decodedPayload: string,
  ): Date | null {
    const headerRaw = response.headers.get('subscription-userinfo');
    if (headerRaw?.trim()) {
      const d = this.parseExpireFromSubscriptionUserinfoString(headerRaw);
      if (d) {
        return d;
      }
    }
    const bodyUserinfo =
      this.extractSubscriptionUserinfoMetaFromDecodedBody(decodedPayload);
    if (bodyUserinfo) {
      const d = this.parseExpireFromSubscriptionUserinfoString(bodyUserinfo);
      if (d) {
        return d;
      }
    }
    return this.extractExpireMetaLineFromDecodedBody(decodedPayload);
  }

  private resolveRemoteSubscriptionTrafficUsedBytes(
    response: Response,
    decodedPayload: string,
  ): bigint | null {
    const headerRaw = response.headers.get('subscription-userinfo');
    if (headerRaw?.trim()) {
      const used = this.parseUsedBytesFromSubscriptionUserinfoString(headerRaw);
      if (used != null) {
        return used;
      }
    }
    const bodyUserinfo =
      this.extractSubscriptionUserinfoMetaFromDecodedBody(decodedPayload);
    if (bodyUserinfo) {
      const used = this.parseUsedBytesFromSubscriptionUserinfoString(bodyUserinfo);
      if (used != null) {
        return used;
      }
    }
    return null;
  }

  private resolveRemoteSubscriptionTrafficTotalBytes(
    response: Response,
    decodedPayload: string,
  ): bigint | null {
    const headerRaw = response.headers.get('subscription-userinfo');
    if (headerRaw?.trim()) {
      const total = this.parseTotalBytesFromSubscriptionUserinfoString(headerRaw);
      if (total != null) {
        return total;
      }
    }
    const bodyUserinfo =
      this.extractSubscriptionUserinfoMetaFromDecodedBody(decodedPayload);
    if (bodyUserinfo) {
      const total = this.parseTotalBytesFromSubscriptionUserinfoString(bodyUserinfo);
      if (total != null) {
        return total;
      }
    }
    return null;
  }

  private extractConnectName(raw: string) {
    const prepared = prepareConnectUriForParse(raw);
    try {
      const hash = prepared.split('#')[1];
      if (hash) {
        const decoded = decodeURIComponent(hash).trim();
        if (decoded.length > 0) {
          return decoded;
        }
      }

      const baseOnly = prepared.includes('#')
        ? prepared.slice(0, prepared.indexOf('#'))
        : prepared;
      const url = new URL(baseOnly);
      return url.hostname || 'Без названия';
    } catch {
      return 'Без названия';
    }
  }

  private extractProtocol(raw: string) {
    const scheme = raw.split('://')[0]?.trim().toLowerCase();
    return scheme || 'unknown';
  }

  /** Сравнение момента окончания по секундам (устойчиво к расхождениям ms при записи в БД). */
  private sameSubscriptionExpiryInstant(
    a: Date | null | undefined,
    b: Date | null | undefined,
  ): boolean {
    if (!a || !b) {
      return false;
    }
    return Math.floor(a.getTime() / 1000) === Math.floor(b.getTime() / 1000);
  }

  /**
   * Маркер для поля telegramExpiryWarningSentForExpiresAt и одноразовая отправка в Telegram
   * при 0 < остаток < 10 ч для данной даты окончания.
   */
  private async resolveTelegramSubscriptionExpiryWarning(
    subscription: {
      title: string;
      telegramExpiryWarningSentForExpiresAt: Date | null;
    },
    fetchedProfileTitle: string | null,
    remoteExpiresAt: Date | null,
  ): Promise<Date | null> {
    if (!remoteExpiresAt) {
      return null;
    }
    const leftMs = remoteExpiresAt.getTime() - Date.now();
    if (leftMs <= 0 || leftMs >= SUBSCRIPTION_EXPIRY_TELEGRAM_WARN_MS) {
      return null;
    }
    if (
      this.sameSubscriptionExpiryInstant(
        subscription.telegramExpiryWarningSentForExpiresAt,
        remoteExpiresAt,
      )
    ) {
      return subscription.telegramExpiryWarningSentForExpiresAt;
    }
    const sentOk = await this.notifyTelegramSubscriptionExpirySoon(
      subscription.title,
      fetchedProfileTitle,
      remoteExpiresAt,
      leftMs,
    );
    return sentOk
      ? remoteExpiresAt
      : subscription.telegramExpiryWarningSentForExpiresAt;
  }

  private formatExpiryForTelegram(d: Date): string {
    return d.toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    });
  }

  private formatDurationLeftRu(leftMs: number): string {
    const totalMin = Math.max(0, Math.floor(leftMs / 60_000));
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h <= 0) {
      return `${m} мин`;
    }
    if (m === 0) {
      return `${h} ч`;
    }
    return `${h} ч ${m} мин`;
  }

  /** @returns true, если сообщение ушло (или Telegram не настроен — не считаем ошибкой). */
  private async notifyTelegramSubscriptionExpirySoon(
    panelTitle: string,
    listTitle: string | null,
    expiresAt: Date,
    leftMs: number,
  ): Promise<boolean> {
    const row = await this.prisma.panelGlobalSettings.findUnique({
      where: { id: PANEL_GLOBAL_SETTINGS_ID },
      select: { telegramBotSecret: true, telegramGroupId: true },
    });
    const token = row?.telegramBotSecret?.trim() ?? '';
    const chatId = row?.telegramGroupId?.trim() ?? '';
    if (!token || !chatId) {
      return true;
    }
    const listLine =
      listTitle && listTitle.trim() !== ''
        ? `Название из ленты: ${listTitle.trim()}\n`
        : '';
    const body =
      `⏳ Подписка скоро истекает (осталось меньше 10 ч)\n\n` +
      `Панель: ${panelTitle}\n` +
      listLine +
      `Окончание: ${this.formatExpiryForTelegram(expiresAt)}\n` +
      `Осталось: ~${this.formatDurationLeftRu(leftMs)}`;

    const r = await this.telegramService.sendMessage(token, chatId, body);
    if (!r.ok) {
      this.logger.warn(
        `Telegram: не удалось отправить предупреждение об окончании подписки «${panelTitle}»: ${r.error}`,
      );
      return false;
    }
    return true;
  }

  /**
   * Уведомление в Telegram об изменениях в подписке:
   * новые коннекты в «Без группы» и/или удалённые коннекты.
   */
  private async notifyTelegramConnectsChanged(
    subscriptionTitle: string,
    addedNames: string[],
    removedNames: string[],
  ): Promise<void> {
    if (addedNames.length === 0 && removedNames.length === 0) {
      return;
    }
    const row = await this.prisma.panelGlobalSettings.findUnique({
      where: { id: PANEL_GLOBAL_SETTINGS_ID },
      select: { telegramBotSecret: true, telegramGroupId: true },
    });
    const token = row?.telegramBotSecret?.trim() ?? '';
    const chatId = row?.telegramGroupId?.trim() ?? '';
    if (!token || !chatId) {
      return;
    }

    const chunks = this.buildTelegramConnectsChangedChunks(
      subscriptionTitle,
      addedNames,
      removedNames,
    );
    for (let i = 0; i < chunks.length; i++) {
      const r = await this.telegramService.sendMessage(token, chatId, chunks[i]);
      if (!r.ok) {
        this.logger.warn(
          `Telegram: не удалось отправить уведомление об изменениях коннектов (часть ${i + 1}/${chunks.length}): ${r.error}`,
        );
        break;
      }
    }
  }

  private buildTelegramConnectsChangedChunks(
    subscriptionTitle: string,
    addedNames: string[],
    removedNames: string[],
  ): string[] {
    const lines: string[] = [];

    if (addedNames.length > 0) {
      lines.push(`➕ Добавлено (${addedNames.length}):`);
      for (const n of addedNames) lines.push(`• ${n}`);
    }

    if (removedNames.length > 0) {
      if (lines.length > 0) lines.push('');
      lines.push(`🗑 Удалено (${removedNames.length}):`);
      for (const n of removedNames) lines.push(`• ${n}`);
    }

    const firstHeader =
      `🔔 Изменения коннектов\n\nПодписка: ${subscriptionTitle}\n\n`;

    const chunks: string[] = [];
    let lineIndex = 0;
    let partIdx = 0;

    while (lineIndex < lines.length) {
      const header =
        partIdx === 0
          ? firstHeader
          : `… продолжение (часть ${partIdx + 1}), подписка: ${subscriptionTitle}\n\n`;

      const bodyLines: string[] = [];
      let used = header.length;

      while (lineIndex < lines.length) {
        const line = lines[lineIndex];
        const sep = bodyLines.length > 0 ? 1 : 0;
        if (used + sep + line.length <= TELEGRAM_MESSAGE_MAX) {
          bodyLines.push(line);
          used += sep + line.length;
          lineIndex += 1;
          continue;
        }
        if (bodyLines.length === 0) {
          const max = TELEGRAM_MESSAGE_MAX - header.length - 1;
          bodyLines.push(`${line.slice(0, Math.max(0, max - 1))}…`);
          lineIndex += 1;
        }
        break;
      }

      chunks.push(header + bodyLines.join('\n'));
      partIdx += 1;
    }

    return chunks;
  }
}
