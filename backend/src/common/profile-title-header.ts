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
 * Обрезка объявления до лимита Happ, стараясь сохранить хвост, начинающийся с «Отображаются:»
 * (и при наличии — блок «Не отображаются:» на следующей строке).
 */
export function sliceAnnounceForHappPreservingGroupLines(t: string): string {
  const max = HAPP_ANNOUNCE_MAX_CHARS;
  const full = t.trim();
  if (!full) {
    return '';
  }
  const cp = [...full];
  if (cp.length <= max) {
    return full;
  }
  const marker = '\nОтображаются:';
  const idx = full.indexOf(marker);
  if (idx === -1) {
    if (full.startsWith('Отображаются:')) {
      return [...full].slice(0, max).join('');
    }
    return sliceAnnounceForHappSubscription(full);
  }
  const suffix = full.slice(idx + 1);
  const suffixCp = [...suffix];
  if (suffixCp.length >= max) {
    return suffixCp.slice(0, max).join('');
  }
  const roomForBase = max - suffixCp.length - 1;
  if (roomForBase <= 0) {
    return [...suffix].slice(0, max).join('');
  }
  const basePart = full.slice(0, idx).trimEnd();
  if (!basePart) {
    return [...suffix].slice(0, max).join('');
  }
  const baseTrimmed = [...basePart].slice(0, roomForBase).join('');
  return `${baseTrimmed}\n${suffix}`;
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

/**
 * Заголовок routing для Happ: ссылка вида happ://routing/… (как в теле подписки).
 * При нескольких непустых строках в настройке в заголовок попадает первая строка.
 * @see https://www.happ.su/main/ru/dev-docs/routing
 */
export function setHappRoutingResponseHeader(
  res: Response,
  routingConfig: string | null | undefined,
): void {
  const raw = routingConfig?.trim();
  if (!raw) {
    return;
  }
  const first = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!first) {
    return;
  }
  res.setHeader('routing', first);
}

/**
 * Заголовок profile-web-page-url: абсолютный URL страницы подписки.
 * Поддерживается рядом клиентов (помимо Happ) как "открыть в браузере".
 */
export function setProfileWebPageUrlHeader(
  res: Response,
  url: string | null | undefined,
): void {
  const u = url?.trim();
  if (!u) return;
  res.setHeader('profile-web-page-url', u);
}

/**
 * Устанавливает все стандартные заголовки профиля подписки (Happ и совместимые клиенты).
 * Применяется одинаково для BASE64 и JSON режимов.
 */
export function setAllSubscriptionProfileHeaders(
  res: Response,
  opts: {
    profileTitle?: string | null;
    announceMetaLine?: string | null;
    profileUpdateIntervalHours?: number | null;
    routingConfig?: string | null;
    profileWebPageUrl?: string | null;
  },
): void {
  setHappHideSettingsHeader(res);
  if (opts.profileTitle) setProfileTitleResponseHeaders(res, opts.profileTitle);
  if (opts.profileWebPageUrl) setProfileWebPageUrlHeader(res, opts.profileWebPageUrl);
  setSubscriptionAnnounceResponseHeaders(res, opts.announceMetaLine);
  setProfileUpdateIntervalResponseHeaders(res, opts.profileUpdateIntervalHours);
  setHappRoutingResponseHeader(res, opts.routingConfig);
}
