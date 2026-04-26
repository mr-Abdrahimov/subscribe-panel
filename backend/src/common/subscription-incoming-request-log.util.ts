import type { Request } from 'express';

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

function collectHeaders(req: Request): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    const lower = name.toLowerCase();
    if (SENSITIVE_HEADER_NAMES.has(lower)) {
      out[name] = '[скрыто]';
      continue;
    }
    if (typeof value === 'string') {
      out[name] = truncate(value, MAX_HEADER_VALUE_LEN);
    } else {
      out[name] = value.map((v) => truncate(String(v), MAX_HEADER_VALUE_LEN));
    }
  }
  return out;
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
