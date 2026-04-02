export default defineAppConfig({
  // Клиентский плагин @nuxt/icon читает именно appConfig (см. nuxt/icon#185).
  // Иначе остаётся дефолт /api/_nuxt_icon → Nginx шлёт запрос в Nest → 404.
  icon: {
    localApiEndpoint: '/_nuxt_icon'
  },
  ui: {
    colors: {
      primary: 'green',
      neutral: 'slate'
    }
  }
})
