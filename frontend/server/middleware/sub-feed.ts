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
  const endpoint = `${config.public.apiBaseUrl}/public/sub/${encodeURIComponent(code)}`;
  const data = await $fetch<string>(endpoint);
  setHeader(event, 'content-type', 'text/plain; charset=utf-8');
  return data;
});

