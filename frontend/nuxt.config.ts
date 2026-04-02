// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
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
    public: {
      apiBaseUrl: process.env.NUXT_PUBLIC_API_BASE_URL || 'http://localhost:3000',
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
  }
})
