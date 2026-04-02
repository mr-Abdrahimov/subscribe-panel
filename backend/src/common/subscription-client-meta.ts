import type { Request } from 'express';

export type SubscriptionAccessMeta = {
  clientIp?: string;
  userAgent?: string;
  hwid?: string;
  accept?: string;
  acceptLanguage?: string;
  referer?: string;
  queryParams?: Record<string, string>;
  extraHeaders?: Record<string, string>;
};

const SKIP_EXTRA = new Set([
  'user-agent',
  'accept',
  'accept-language',
  'referer',
  'cookie',
  'authorization',
  'host',
  'connection',
  'content-length',
  'content-type',
]);

const HWID_HEADER_KEYS = [
  'x-hwid',
  'x-device-id',
  'x-happ-hwid',
  'x-happ-device-id',
  'x-client-hwid',
  'device-id',
  'hwid',
];

const HWID_QUERY_KEYS = ['hwid', 'device_id', 'deviceid', 'deviceId', 'client_hwid'];

function headerString(
  headers: Request['headers'],
  name: string,
): string | undefined {
  const v = headers[name];
  if (typeof v === 'string' && v.trim()) {
    return v.trim();
  }
  if (Array.isArray(v) && v[0]) {
    return String(v[0]).trim();
  }
  return undefined;
}

function pickHwidFromHeaders(headers: Request['headers']): string | undefined {
  for (const k of HWID_HEADER_KEYS) {
    const v = headerString(headers, k);
    if (v) {
      return v.length > 512 ? `${v.slice(0, 512)}…` : v;
    }
  }
  return undefined;
}

function normalizeQuery(q: Request['query']): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined) {
      continue;
    }
    if (Array.isArray(v)) {
      out[k] = v.map((x) => String(x)).join(',');
    } else {
      out[k] = String(v);
    }
  }
  return out;
}

function pickHwidFromQuery(query: Record<string, string>): string | undefined {
  for (const k of HWID_QUERY_KEYS) {
    const v = query[k]?.trim();
    if (v) {
      return v.length > 512 ? `${v.slice(0, 512)}…` : v;
    }
  }
  return undefined;
}

function getClientIp(req: Request): string | undefined {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string') {
    const first = xff.split(',')[0]?.trim();
    if (first) {
      return first;
    }
  }
  if (Array.isArray(xff) && xff[0]) {
    return String(xff[0]).split(',')[0]?.trim();
  }
  const realIp = headerString(req.headers, 'x-real-ip');
  if (realIp) {
    return realIp;
  }
  const cf = headerString(req.headers, 'cf-connecting-ip');
  if (cf) {
    return cf;
  }
  const remote = req.socket?.remoteAddress;
  if (remote) {
    return remote;
  }
  return undefined;
}

function collectExtraHeaders(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined || SKIP_EXTRA.has(k)) {
      continue;
    }
    const lower = k.toLowerCase();
    if (
      lower.startsWith('x-') ||
      lower.includes('happ') ||
      lower.includes('device') ||
      lower.startsWith('sec-ch-')
    ) {
      const raw = Array.isArray(v) ? v.join(', ') : String(v);
      if (!raw) {
        continue;
      }
      out[k] = raw.length > 2000 ? `${raw.slice(0, 2000)}…` : raw;
    }
  }
  return out;
}

/** Метаданные клиента при GET подписки (Happ и др.): IP, HWID, UA, query, X-* заголовки */
export function extractSubscriptionAccessMeta(req: Request): SubscriptionAccessMeta {
  const queryParams = normalizeQuery(req.query);
  const fromHeaders = pickHwidFromHeaders(req.headers);
  const fromQuery = pickHwidFromQuery(queryParams);
  const extraHeaders = collectExtraHeaders(req);
  const hwid = fromHeaders ?? fromQuery;

  const meta: SubscriptionAccessMeta = {
    clientIp: getClientIp(req),
    userAgent: headerString(req.headers, 'user-agent'),
    accept: headerString(req.headers, 'accept'),
    acceptLanguage: headerString(req.headers, 'accept-language'),
    referer: headerString(req.headers, 'referer'),
    queryParams: Object.keys(queryParams).length ? queryParams : undefined,
    extraHeaders: Object.keys(extraHeaders).length ? extraHeaders : undefined,
  };
  if (hwid) {
    meta.hwid = hwid;
  }
  return meta;
}

/** Есть ли в запросе HWID (заголовки или query — см. список в модуле) */
export function hasSubscriptionHwid(req: Request): boolean {
  return Boolean(extractSubscriptionAccessMeta(req).hwid);
}
