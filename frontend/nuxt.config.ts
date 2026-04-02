// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/ui'
  ],

  devtools: {
    enabled: process.env.NODE_ENV !== 'production'
  },

  sourcemap: {
    client: false,
    server: false
  },

  vite: {
    build: {
      reportCompressedSize: false
    }
  },

  css: ['~/assets/css/main.css'],

  routeRules: {
    '/': { prerender: true }
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
