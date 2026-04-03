<script setup>
const config = useRuntimeConfig()
const requestURL = useRequestURL()

const defaultTitle = 'Панель подписок'
const defaultDescription =
  'Управление VPN-подписками: группы, пользователи и персональные ссылки на ленты для Happ и других клиентов.'

const siteOrigin = computed(() => {
  const fromEnv = String(config.public.siteUrl || '').replace(/\/$/, '')
  if (fromEnv) {
    return fromEnv
  }
  return requestURL.origin
})

const defaultOgImage = computed(() => {
  const o = siteOrigin.value
  return o ? `${o}/og-share.jpg` : '/og-share.jpg'
})

useHead({
  meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }],
  link: [
    { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
    { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
    { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
  ],
  htmlAttrs: {
    lang: 'ru',
  },
})

useSeoMeta({
  title: defaultTitle,
  description: defaultDescription,
  ogSiteName: 'Subscribe Panel',
  ogTitle: defaultTitle,
  ogDescription: defaultDescription,
  ogType: 'website',
  ogLocale: 'ru_RU',
  ogImage: defaultOgImage,
  twitterCard: 'summary_large_image',
  twitterTitle: defaultTitle,
  twitterDescription: defaultDescription,
  twitterImage: defaultOgImage,
})
</script>

<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
