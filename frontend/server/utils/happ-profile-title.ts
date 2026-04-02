import { Buffer } from 'node:buffer';

/**
 * Совпадает с backend/src/common/profile-title-header.ts (Happ /sub HTML-ответы).
 * @see https://www.happ.su/main/dev-docs/app-management
 */
export const HAPP_PROFILE_TITLE_MAX_CHARS = 25;

export function sliceProfileTitleForHappSubscription(t: string): string {
  return [...t.trim()].slice(0, HAPP_PROFILE_TITLE_MAX_CHARS).join('');
}

export function formatHappProfileTitleHeaderValue(short: string): string {
  if (!short) {
    return '';
  }
  if (/^[\x20-\x7E]*$/.test(short)) {
    return short;
  }
  return `base64:${Buffer.from(short, 'utf8').toString('base64')}`;
}
