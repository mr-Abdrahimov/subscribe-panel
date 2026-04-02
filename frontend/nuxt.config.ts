// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/ui'
  ],

  devtools: {
    enabled: true
  },

  css: ['~/assets/css/main.css'],

  // Nuxt Icon по умолчанию вешает API на /api/_nuxt_icon — на проде тот же префикс у Nest (Nginx → 404).
  icon: {
    localApiEndpoint: '/_nuxt_icon'
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
