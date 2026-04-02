import type { H3Event } from 'h3';
import {
  defineEventHandler,
  getRequestHeader,
  getRequestIP,
  getRequestURL,
  setHeader,
  setResponseStatus,
} from 'h3';
import {
  formatHappProfileTitleHeaderValue,
  sliceProfileTitleForHappSubscription,
} from '../utils/happ-profile-title';
import { getNestApiRoot } from '../utils/nest-api-root';

type PublicUserPayload = {
  name: string;
  subscriptionDisplayName: string | null;
  profileTitle: string | null;
};

function setProfileTitleHeadersFromString(
  event: H3Event,
  profileTitle: string,
) {
  const t = profileTitle.trim();
  if (!t) {
    return;
  }
  setHeader(event, 'profile-title*', `UTF-8''${encodeURIComponent(t)}`);
  const short = sliceProfileTitleForHappSubscription(t);
  if (!short) {
    return;
  }
  setHeader(event, 'profile-title', formatHappProfileTitleHeaderValue(short));
}

/**
 * JSON-обёртка подписки для VPN-клиентов (Happ и др.): то же base64, что и в plain-теле,
 * плюс дублирование meta из HTTP-заголовков в поля объекта ([Happ meta](https://www.happ.su/main/ru/dev-docs/meta-info)).
 * Браузер с Accept: text/html по-прежнему получает HTML-страницу /sub/…
 */
function wantsSubscriptionJson(
  accept: string,
  userAgent: string,
  formatParam: string | null,
): boolean {
  if (formatParam === 'json') {
    return true;
  }
  if (/\bapplication\/json\b/i.test(accept)) {
    return true;
  }
  const ua = userAgent.trim();
  return /^Happ/i.test(ua);
}

function buildSubscriptionJsonBody(
  base64Body: string,
  profileTitleStar: string | null,
  profileTitlePlain: string | null,
): string {
  const payload: Record<string, string> = {
    /** то же значение, что в plain-ответе (UTF-8 → base64 одной строкой) */
    data: base64Body,
    /** синоним для клиентов, ожидающих поле subscription */
    subscription: base64Body,
  };
  if (profileTitlePlain) {
    payload['profile-title'] = profileTitlePlain;
    payload.profileTitle = profileTitlePlain;
  }
  if (profileTitleStar) {
    payload['profile-title*'] = profileTitleStar;
    payload.profileTitleStar = profileTitleStar;
  }
  return JSON.stringify(payload);
}

async function attachProfileTitleHeadersForHtml(
  event: H3Event,
  apiRoot: string,
  code: string,
) {
  try {
    const user = await $fetch<PublicUserPayload>(
      `${apiRoot}/public/users/${encodeURIComponent(code)}`,
    );
    const title =
      (user.profileTitle && user.profileTitle.trim()) ||
      (user.subscriptionDisplayName && user.subscriptionDisplayName.trim()) ||
      (user.name && user.name.trim()) ||
      '';
    if (title) {
      setProfileTitleHeadersFromString(event, title);
    }
  } catch {
    /* нет пользователя — без заголовка */
  }
}

export default defineEventHandler(async (event) => {
  const url = getRequestURL(event);
  const match = url.pathname.match(/^\/sub\/([^/]+)$/);
  if (!match) {
    return;
  }

  const code = decodeURIComponent(match[1] ?? '').trim();
  if (!code) {
    return;
  }

  const accept = getRequestHeader(event, 'accept') ?? '';
  const isHtmlRequest = accept.includes('text/html');
  const userAgent = getRequestHeader(event, 'user-agent') ?? '';
  const wantsJson = wantsSubscriptionJson(
    accept,
    userAgent,
    url.searchParams.get('format'),
  );

  const apiRoot = getNestApiRoot(event);

  if (isHtmlRequest) {
    await attachProfileTitleHeadersForHtml(event, apiRoot, code);
    return;
  }
  const forwardHeaderNames = [
    'user-agent',
    'accept',
    'accept-language',
    'referer',
    'x-forwarded-for',
    'x-real-ip',
    'cf-connecting-ip',
    'x-hwid',
    'hwid',
    'x-device-id',
    'device-id',
    'x-happ-hwid',
    'x-happ-device-id',
  ] as const;
  const proxyHeaders: Record<string, string> = {};
  for (const name of forwardHeaderNames) {
    const v = getRequestHeader(event, name);
    if (v) {
      proxyHeaders[name] = v;
    }
  }
  const clientIp = getRequestIP(event, { xForwardedFor: true });
  if (clientIp && !proxyHeaders['x-forwarded-for']) {
    proxyHeaders['x-forwarded-for'] = clientIp;
  }

  const forwardParams = new URLSearchParams(url.search);
  forwardParams.delete('format');
  const forwardQuery = forwardParams.toString();
  const endpoint = `${apiRoot}/public/sub/${encodeURIComponent(code)}${forwardQuery ? `?${forwardQuery}` : ''}`;
  let res: Awaited<ReturnType<typeof $fetch.raw>>;
  try {
    res = await $fetch.raw(endpoint, { headers: proxyHeaders });
  } catch (err: unknown) {
    const e = err as {
      statusCode?: number;
      statusMessage?: string;
      data?: unknown;
    };
    const status = e.statusCode ?? 502;
    setResponseStatus(event, status);
    const body =
      typeof e.data === 'string'
        ? e.data
        : e.data != null
          ? JSON.stringify(e.data)
          : (e.statusMessage ?? 'Ошибка прокси подписки');
    if (wantsJson) {
      setHeader(event, 'content-type', 'application/json; charset=utf-8');
      return JSON.stringify({
        error: true,
        statusCode: status,
        message: body,
      });
    }
    setHeader(event, 'content-type', 'text/plain; charset=utf-8');
    return body;
  }

  setResponseStatus(event, res.status);
  const data = (res._data ?? '') as string;
  const profileTitleStar = res.headers.get('profile-title*');
  const profileTitlePlain = res.headers.get('profile-title');
  setHeader(
    event,
    'cache-control',
    'private, no-store, no-cache, must-revalidate, max-age=0',
  );
  setHeader(event, 'pragma', 'no-cache');
  if (profileTitleStar) {
    setHeader(event, 'profile-title*', profileTitleStar);
  }
  if (profileTitlePlain) {
    setHeader(event, 'profile-title', profileTitlePlain);
  }
  if (wantsJson) {
    setHeader(event, 'content-type', 'application/json; charset=utf-8');
    return buildSubscriptionJsonBody(
      data,
      profileTitleStar,
      profileTitlePlain,
    );
  }
  setHeader(event, 'content-type', 'text/plain; charset=utf-8');
  return data;
});

