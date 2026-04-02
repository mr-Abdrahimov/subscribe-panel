/** Ответ GET /public/users/:code на Nest (NUXT_PUBLIC_API_BASE_URL) */
export type PublicUserResponse = {
  name: string
  code: string
  enabled: boolean
  groupName: string
  subscriptionDisplayName: string | null
  profileTitle: string | null
  groups: string[]
  appLinks: { name: string; url: string }[]
}
