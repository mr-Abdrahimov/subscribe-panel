// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  /** Превью ссылок (Telegram и др.): HTML с og:* должен отдаваться с сервера */
  ssr: true,

  app: {
    head: {
      title: 'Панель подписок',
      charset: 'utf-8',
    },
  },

  modules: [
    // До @nuxt/ui: задаём путь API иконок (конфликт с прокси /api на бэкенд — nuxt/icon#185).
    [
      '@nuxt/icon',
      {
        localApiEndpoint: '/_nuxt_icon'
      }
    ],
    '@nuxt/eslint',
    '@nuxt/ui'
  ],

  devtools: {
    enabled: true
  },

  css: ['~/assets/css/main.css'],

  experimental: {
    payloadExtraction: false
  },

  runtimeConfig: {
    /** База API для серверных запросов Nitro (например /sub/* → backend). Без суффикса /api — путь как у Nest. Пример: http://127.0.0.1:3000 */
    apiInternalBaseUrl: process.env.NUXT_API_INTERNAL_BASE_URL || '',
    public: {
      apiBaseUrl: process.env.NUXT_PUBLIC_API_BASE_URL || 'http://localhost:3000',
      /** Публичный origin сайта (https://inv.avtlk.ru) — для абсолютных og:image при SSR, если Host недоступен */
      siteUrl: process.env.NUXT_PUBLIC_SITE_URL || '',
      adminEmail: process.env.NUXT_PUBLIC_ADMIN_EMAIL || 'admin@subscribe.local',
      adminPassword: process.env.NUXT_PUBLIC_ADMIN_PASSWORD || 'Admin123456'
    }
  },

  compatibilityDate: '2025-01-15',

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
    }
  },

  routeRules: {
    /** Явно: превью /sub/… в мессенджерах читают разметку с сервера */
    '/sub/**': { ssr: true },
  },
})
