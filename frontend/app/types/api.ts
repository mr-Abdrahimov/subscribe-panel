/** Ответ GET /public/users/:code на Nest (NUXT_PUBLIC_API_BASE_URL) */
export type PublicUserResponse = {
  name: string
  code: string
  enabled: boolean
  groupName: string
  subscriptionDisplayName: string | null
  profileTitle: string | null
  /** Реальная лента только через crypto happ:// и секретный путь; /sub/… даёт заглушку */
  cryptoOnlySubscription?: boolean
  /** happ:// от crypto.happ.su для копирования на публичной странице; null если не создана */
  happCryptoUrl?: string | null
  groups: string[]
  appLinks: { name: string; url: string }[]
}
