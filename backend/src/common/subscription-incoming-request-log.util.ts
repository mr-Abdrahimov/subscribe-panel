import type { Request } from 'express';
import type { Socket } from 'net';
import type { TLSSocket } from 'tls';

const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'cookie',
  'proxy-authorization',
  'x-api-key',
]);

/** Ключи query, которые нельзя писать в лог (секрет подписки t=, токены) */
const SENSITIVE_QUERY_KEYS = new Set(['t', 'token', 'access_token', 'access-token']);

/** Маскируем слишком длинные значения в логе (например огромный query) */
const MAX_HEADER_VALUE_LEN = 4000;
const MAX_BODY_PREVIEW_LEN = 8000;

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}… (+${s.length - max} симв.)`;
}

function normalizeQuery(q: Request['query']): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined) continue;
    if (SENSITIVE_QUERY_KEYS.has(k.toLowerCase())) {
      out[k] = '[скрыто]';
      continue;
    }
    out[k] = Array.isArray(v) ? v.map((x) => String(x)) : String(v);
  }
  return out;
}

function isSensitiveHeaderName(lower: string): boolean {
  return SENSITIVE_HEADER_NAMES.has(lower);
}

function maskHeaderValue(
  nameLower: string,
  value: string,
): { value: string; redacted: boolean } {
  if (isSensitiveHeaderName(nameLower)) {
    return { value: '[скрыто]', redacted: true };
  }
  return { value: truncate(value, MAX_HEADER_VALUE_LEN), redacted: false };
}

function collectHeaders(req: Request): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    const lower = name.toLowerCase();
    if (typeof value === 'string') {
      out[name] = maskHeaderValue(lower, value).value;
    } else {
      out[name] = value.map((v) =>
        maskHeaderValue(lower, String(v)).value,
      );
    }
  }
  return out;
}

/**
 * Node `rawHeaders` — пары как пришли от клиента/прокси (дубликаты имён, порядок, регистр).
 * Для сервисов-аналитик это ближайший аналог «полного сырого» HTTP-заголовка.
 */
function collectRawHeaderPairs(
  req: Request,
): Array<{ name: string; value: string; redacted: boolean }> {
  const raw = (req as Request & { rawHeaders?: string[] }).rawHeaders;
  if (!raw || !Array.isArray(raw)) {
    return [];
  }
  const out: Array<{ name: string; value: string; redacted: boolean }> = [];
  for (let i = 0; i < raw.length; i += 2) {
    const name = raw[i] ?? '';
    const value = raw[i + 1] ?? '';
    const lower = name.toLowerCase();
    const m = maskHeaderValue(lower, value);
    out.push({ name, value: m.value, redacted: m.redacted });
  }
  return out;
}

/** sec-ch-*, device-memory, dpr, viewport-width и т.п. (Client Hints) */
function collectClientHints(
  req: Request,
): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    const lower = name.toLowerCase();
    const isCh =
      lower.startsWith('sec-ch-') ||
      lower === 'device-memory' ||
      lower === 'dpr' ||
      lower === 'viewport-width' ||
      lower === 'ect' ||
      lower === 'rtt' ||
      lower === 'downlink' ||
      lower === 'save-data';
    if (!isCh) {
      continue;
    }
    const str = Array.isArray(value) ? value.join(', ') : String(value);
    if (isSensitiveHeaderName(lower)) {
      out[name] = '[скрыто]';
    } else {
      out[name] = truncate(str, MAX_HEADER_VALUE_LEN);
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseUserAgentForLog(
  req: Request,
): {
  raw: string | null;
  segments: string[];
  /** Если похоже на Happ/.../.../... */
  happLike: {
    app: string;
    version: string;
    platformLine: string | null;
    buildOrTail: string | null;
  } | null;
  /** Кратко: из типичного UA Happ (часто уже видно os / catalyst / build) */
  note: string;
} {
  const ua = req.headers['user-agent'];
  const raw =
    typeof ua === 'string'
      ? ua
      : Array.isArray(ua) && ua[0]
        ? String(ua[0])
        : null;
  if (!raw?.trim()) {
    return {
      raw: null,
      segments: [],
      happLike: null,
      note: 'User-Agent пуст',
    };
  }
  const segments = raw.split('/').map((s) => s.trim());
  const happLike =
    segments[0]?.toLowerCase() === 'happ' && segments.length >= 2
      ? {
          app: segments[0]!,
          version: segments[1] ?? '',
          platformLine: segments[2] ?? null,
          buildOrTail: segments[3] ?? null,
        }
      : null;
  const n = raw.toLowerCase();
  const bits: string[] = [];
  if (n.includes('macos') || n.includes('mac os')) {
    bits.push('в строке UA явно macOS (часто выводят как «macOS / Mac» без знания модели MacBook)');
  }
  if (n.includes('catalyst')) {
    bits.push('Catalyst = приложение iOS, собранное для Mac; «MacBook» в UI сервиса часто — обобщение для Mac, не данные датчика');
  }
  if (n.includes('ios') || n.includes('iphone') || n.includes('ipad')) {
    bits.push('iOS-стек в UA');
  }
  if (n.includes('android')) {
    bits.push('Android в UA');
  }
  if (n.includes('windows')) {
    bits.push('Windows в UA');
  }
  if (bits.length === 0) {
    bits.push('модель ОС/устройства в UA не по типовым токенам; смотрите segments / Client Hints');
  }
  return {
    raw,
    segments,
    happLike,
    note: bits.join('; '),
  };
}

function isTlsSocketLike(
  s: Socket,
): s is TLSSocket & { getProtocol?: () => string | null } {
  return typeof (s as TLSSocket).getCipher === 'function';
}

function collectSocketAndTls(
  req: Request,
): {
  socket: {
    remoteAddress: string | undefined;
    remotePort: number | undefined;
    remoteFamily: string | undefined;
    localAddress: string | undefined;
    localPort: number | undefined;
    readyState?: string;
  } | null;
  /** Заполняется только если TLS окончен на Node (часто за nginx пусто) */
  tls: {
    secureProtocol?: string | null;
    alpnProtocol?: string | null | false;
    cipher?: { name: string; version: string } | null;
  } | null;
} {
  const sock = req.socket as Socket | undefined;
  if (!sock) {
    return { socket: null, tls: null };
  }
  const socket = {
    remoteAddress: sock.remoteAddress,
    remotePort: sock.remotePort,
    remoteFamily: sock.remoteFamily,
    localAddress: sock.localAddress,
    localPort: sock.localPort,
    readyState: (sock as { readyState?: string }).readyState,
  };
  if (!isTlsSocketLike(sock)) {
    return { socket, tls: null };
  }
  let cipher: { name: string; version: string } | null = null;
  try {
    const c = sock.getCipher();
    if (c && typeof c === 'object' && 'name' in c) {
      cipher = { name: c.name, version: c.version };
    }
  } catch {
    cipher = null;
  }
  const tls = {
    secureProtocol:
      typeof sock.getProtocol === 'function' ? sock.getProtocol() : null,
    alpnProtocol: sock.alpnProtocol,
    cipher,
  };
  return { socket, tls: Object.values(tls).some(Boolean) ? tls : null };
}

function collectHttpMessageMeta(req: Request): {
  httpVersion: string;
  httpVersionMajor?: number;
  httpVersionMinor?: number;
  complete: boolean;
} {
  const m = req as Request & {
    httpVersionMajor?: number;
    httpVersionMinor?: number;
    complete?: boolean;
  };
  return {
    httpVersion: req.httpVersion,
    httpVersionMajor: m.httpVersionMajor,
    httpVersionMinor: m.httpVersionMinor,
    complete: m.complete === true,
  };
}

export type SubscriptionIncomingRequestSnapshot = {
  at: string;
  /** Логическое имя маршрута (Happ / crypto-страница используют тот же handler) */
  route: 'GET /public/sub/:code';
  subscriptionCode: string;
  /** Запрос с секретного пути (via=crypto-page), как у happ://… после Nuxt-прокси */
  viaCryptoPage: boolean;
  method: string;
  url: string;
  originalUrl: string;
  path: string;
  baseUrl: string;
  httpVersion: string;
  protocol: string;
  host: string | undefined;
  hostname: string | undefined;
  ip: string | undefined;
  ips: string[] | undefined;
  remoteAddress: string | undefined;
  remotePort: number | undefined;
  query: Record<string, unknown>;
  headers: Record<string, unknown>;
  /**
   * Все пары сырьевых заголовков (как в Node), с маскировкой чувствительных.
   * Сервисы вне панели часто смотрят тот же набор, что и `headers`, плюс порядок/дубли.
   */
  rawHeaderPairs: Array<{ name: string; value: string; redacted: boolean }>;
  /** Уникальные имена заголовков (для обзора) */
  headerNames: string[];
  clientHints: Record<string, string> | undefined;
  userAgent: ReturnType<typeof parseUserAgentForLog>;
  /** Парам маршрута Express/Nest, если уже заполнены */
  routeParams: Record<string, string>;
  subdomains: string[] | undefined;
  secure: boolean;
  httpMessage: ReturnType<typeof collectHttpMessageMeta>;
  connectionMeta: {
    secure: boolean;
    expressTrustProxy: unknown;
    socket: ReturnType<typeof collectSocketAndTls>['socket'];
    tls: ReturnType<typeof collectSocketAndTls>['tls'];
  };
  /**
   * Почему внешние сервисы пишут «macOS (MacBook)» без магии: обычно
   * разбор `User-Agent` (у Happ — `…/macos catalyst/…`), Client Hints (`sec-ch-ua-model`),
   * IP/Geo; TLS/JA3 — на стороне терминирующего прокси, в Node за nginx чаще недоступно.
   */
  howDeviceMayBeInferred: string;
  /** Тело запроса (обычно пустое у GET); если включён body-parser — как есть */
  body: unknown;
  /** Сырое тело, если middleware его положил в req */
  rawBodyPreview: string | null;
  /** Итог обработчика: что отдали клиенту (для отладки Happ / happ://) */
  outcome: {
    httpStatus: 200 | 403;
    /** Неверный query t= при наличии user */
    tokenMismatch403?: true;
    userFound: boolean;
    userEnabled?: boolean;
    /** Полная лента (не заглушка) */
    subscriptionDelivered?: boolean;
    /** Ответ: base64-текст, JSON-массив v2ray или JSON не использовался */
    feedFormat?: 'base64' | 'json' | 'n/a';
  };
};

export type BuildSubscriptionSnapshotContext = {
  viaCryptoPage: boolean;
  httpStatus: 200 | 403;
  tokenMismatch403?: true;
  userFound: boolean;
  userEnabled?: boolean;
  subscriptionDelivered?: boolean;
  feedFormat?: 'base64' | 'json' | 'n/a';
};

/**
 * Снимок входящего HTTP-запроса к публичной ленте (Happ → панель, в т.ч. happ:// crypto / via=crypto-page).
 * Отключить: SUBSCRIPTION_INCOMING_HTTP_LOG=false
 */
export function isSubscriptionIncomingHttpLogEnabled(
  getEnv: (key: string) => string | undefined,
): boolean {
  return getEnv('SUBSCRIPTION_INCOMING_HTTP_LOG')?.toLowerCase() !== 'false';
}

export function buildSubscriptionIncomingRequestSnapshot(
  req: Request,
  subscriptionCode: string,
  ctx: BuildSubscriptionSnapshotContext,
): SubscriptionIncomingRequestSnapshot {
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  let rawBodyPreview: string | null = null;
  if (Buffer.isBuffer(rawBody) && rawBody.length > 0) {
    rawBodyPreview = truncate(rawBody.toString('utf8'), MAX_BODY_PREVIEW_LEN);
  }

  const { socket, tls } = collectSocketAndTls(req);
  const st = (req as { secure?: boolean }).secure === true;
  const ch = collectClientHints(req);
  const expressApp = (req as { app?: { get: (key: string) => unknown } }).app;
  return {
    at: new Date().toISOString(),
    route: 'GET /public/sub/:code',
    subscriptionCode,
    viaCryptoPage: ctx.viaCryptoPage,
    method: req.method,
    url: req.url,
    originalUrl: req.originalUrl,
    path: req.path,
    baseUrl: req.baseUrl,
    httpVersion: req.httpVersion,
    protocol: req.protocol,
    host: req.get('host'),
    hostname: req.hostname,
    ip: req.ip,
    ips: req.ips,
    remoteAddress: req.socket?.remoteAddress,
    remotePort: req.socket?.remotePort,
    query: normalizeQuery(req.query),
    headers: collectHeaders(req),
    rawHeaderPairs: collectRawHeaderPairs(req),
    headerNames: Object.keys(req.headers)
      .map((k) => k.toLowerCase())
      .sort(),
    clientHints: ch,
    userAgent: parseUserAgentForLog(req),
    routeParams: {
      ...((req as Request & { params?: Record<string, string> }).params ?? {}),
    },
    subdomains: req.subdomains,
    secure: st,
    httpMessage: collectHttpMessageMeta(req),
    connectionMeta: {
      secure: st,
      expressTrustProxy: expressApp?.get('trust proxy'),
      socket,
      tls,
    },
    howDeviceMayBeInferred: [
      'User-Agent: у Happ в UA часто явно macos, catalyst, build (см. userAgent).',
      ch
        ? 'Client Hints: есть sec-ch-* — могут дать platform/model; Happ иногда шлёт мало CH.'
        : 'Client Hints: в запросе нет sec-ch-*/typical — только обычные заголовки.',
      tls
        ? 'TLS сокета Node: шифрование видно (иначе трафик TLS до nginx, до Node — plain HTTP).'
        : 'TLS сокета Node не виден (типично за reverse proxy) — деталей рукопожатия в этом процессе нет.',
    ].join(' '),
    body:
      req.body !== undefined && req.body !== null
        ? typeof req.body === 'object'
          ? req.body
          : truncate(String(req.body), MAX_BODY_PREVIEW_LEN)
        : null,
    rawBodyPreview,
    outcome: {
      httpStatus: ctx.httpStatus,
      ...(ctx.tokenMismatch403 ? { tokenMismatch403: true } : {}),
      userFound: ctx.userFound,
      ...(ctx.userEnabled !== undefined
        ? { userEnabled: ctx.userEnabled }
        : {}),
      ...(ctx.subscriptionDelivered !== undefined
        ? { subscriptionDelivered: ctx.subscriptionDelivered }
        : {}),
      ...(ctx.feedFormat ? { feedFormat: ctx.feedFormat } : {}),
    },
  };
}
