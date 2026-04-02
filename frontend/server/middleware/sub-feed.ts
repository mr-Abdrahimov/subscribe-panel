import type { H3Event } from 'h3';
import { defineEventHandler, getRequestHeader, getRequestURL, setHeader } from 'h3';
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

  const apiRoot = getNestApiRoot(event);

  if (isHtmlRequest) {
    await attachProfileTitleHeadersForHtml(event, apiRoot, code);
    return;
  }
  const endpoint = `${apiRoot}/public/sub/${encodeURIComponent(code)}`;
  const res = await $fetch.raw(endpoint);
  const data = (res._data ?? '') as string;
  const profileTitleStar = res.headers.get('profile-title*');
  const profileTitlePlain = res.headers.get('profile-title');
  setHeader(event, 'content-type', 'text/plain; charset=utf-8');
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
  return data;
});

