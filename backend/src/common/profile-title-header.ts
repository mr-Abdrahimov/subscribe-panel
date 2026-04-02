import type { Response } from 'express';

/**
 * HTTP-заголовки ответа с человекочитаемым названием подписки.
 * В Node значение заголовка должно быть в основном ASCII; кириллицу передаём через RFC 5987 (profile-title*).
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

  if (/^[\x20-\x7E]*$/.test(t)) {
    res.setHeader('profile-title', t);
  }
}
