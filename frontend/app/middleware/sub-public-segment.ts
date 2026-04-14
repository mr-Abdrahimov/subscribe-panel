export default defineNuxtRouteMiddleware((to) => {
  const config = useRuntimeConfig();
  const crypto = String(config.public.subscriptionCryptoPath ?? '')
    .trim()
    .replace(/^\/+|\/+$/g, '');
  const seg = String(to.params.subSegment ?? '').trim();
  if (seg !== 'sub' && seg !== crypto) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' });
  }
});
