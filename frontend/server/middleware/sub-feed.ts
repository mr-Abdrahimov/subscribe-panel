import { defineEventHandler, getRequestHeader, getRequestURL, setHeader } from 'h3';

export default defineEventHandler(async (event) => {
  const url = getRequestURL(event);
  const match = url.pathname.match(/^\/sub\/([^/]+)$/);
  if (!match) {
    return;
  }

  const accept = getRequestHeader(event, 'accept') ?? '';
  const isHtmlRequest = accept.includes('text/html');
  if (isHtmlRequest) {
    return;
  }

  const code = decodeURIComponent(match[1] ?? '').trim();
  if (!code) {
    return;
  }

  const config = useRuntimeConfig(event);
  /** Прямой вызов Nest (без публичного домена), чтобы не ловить кэш CDN/прокси и hairpin NAT */
  const internal = (config.apiInternalBaseUrl as string | undefined)?.replace(/\/$/, '') ?? '';
  const publicBase = config.public.apiBaseUrl.replace(/\/$/, '');
  const apiRoot = internal || publicBase;
  const endpoint = `${apiRoot}/public/sub/${encodeURIComponent(code)}`;
  const data = await $fetch<string>(endpoint);
  setHeader(event, 'content-type', 'text/plain; charset=utf-8');
  setHeader(
    event,
    'cache-control',
    'private, no-store, no-cache, must-revalidate, max-age=0',
  );
  setHeader(event, 'pragma', 'no-cache');
  return data;
});

