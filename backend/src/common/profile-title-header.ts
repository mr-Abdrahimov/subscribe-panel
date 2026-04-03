import type { Response } from 'express';

/** Ограничение Happ (и др. клиентов): https://www.happ.su/main/dev-docs/app-management */
export const HAPP_PROFILE_TITLE_MAX_CHARS = 25;

/** Лимит отображаемого текста объявления (announce) в Happ */
export const HAPP_ANNOUNCE_MAX_CHARS = 200;

/**
 * Обрезка по кодовым точкам Unicode (не по UTF-16 единицам), до лимита Happ.
 */
export function sliceProfileTitleForHappSubscription(t: string): string {
  return [...t.trim()].slice(0, HAPP_PROFILE_TITLE_MAX_CHARS).join('');
}

/** Обрезка текста объявления по кодовым точкам Unicode до лимита Happ */
export function sliceAnnounceForHappSubscription(t: string): string {
  return [...t.trim()].slice(0, HAPP_ANNOUNCE_MAX_CHARS).join('');
}

/**
 * Значение для HTTP-заголовка profile-title: plain ASCII или base64:… для UTF-8 (Happ).
 */
export function formatHappProfileTitleHeaderValue(short: string): string {
  if (!short) {
    return '';
  }
  if (/^[\x20-\x7E]*$/.test(short)) {
    return short;
  }
  return `base64:${Buffer.from(short, 'utf8').toString('base64')}`;
}

/**
 * HTTP-заголовки названия подписки.
 * - profile-title* — RFC 5987, полное имя (для клиентов с поддержкой).
 * - profile-title — как ожидает Happ: plain ASCII или base64:UTF-8, не длиннее лимита.
 */
export function setProfileTitleResponseHeaders(
  res: Response,
  profileTitle: string,
): void {
  const t = profileTitle.trim();
  if (!t) {
    return;
  }

  res.setHeader('profile-title*', `UTF-8''${encodeURIComponent(t)}`);

  const short = sliceProfileTitleForHappSubscription(t);
  if (!short) {
    return;
  }

  res.setHeader('profile-title', formatHappProfileTitleHeaderValue(short));
}

/**
 * Happ: скрыть настройки серверов в подписке (HTTP-заголовок), см. app-management.
 */
export function setHappHideSettingsHeader(res: Response): void {
  res.setHeader('hide-settings', '1');
}

/**
 * Заголовок announce для Happ (как в теле подписки: base64:UTF-8).
 * metaLine — строка вида «#announce: base64:…» из тела ленты.
 */
export function setSubscriptionAnnounceResponseHeaders(
  res: Response,
  metaLine: string | null | undefined,
): void {
  const s = metaLine?.trim();
  if (!s) {
    return;
  }
  const m = s.match(/^#announce:\s*(.+)$/i);
  if (!m?.[1]) {
    return;
  }
  res.setHeader('announce', m[1].trim());
}

/** Заголовок profile-update-interval для Happ (целые часы). */
export function setProfileUpdateIntervalResponseHeaders(
  res: Response,
  hours: number | null | undefined,
): void {
  if (hours === null || hours === undefined) {
    return;
  }
  const n = Math.floor(hours);
  if (n < 1 || !Number.isFinite(n)) {
    return;
  }
  res.setHeader('profile-update-interval', String(n));
}
