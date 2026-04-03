export default defineNuxtRouteMiddleware((to) => {
  const token = useCookie<string | null>('accessToken');
  const isAuthenticated = Boolean(token.value);
  const config = useRuntimeConfig();
  const crypto = String(config.public.subscriptionCryptoPath ?? 'sub2128937123')
    .trim()
    .replace(/^\/+|\/+$/g, '');
  const cryptoPrefix = `/${crypto}/`;
  const isPublicSubPage =
    to.path.startsWith('/sub/') || to.path.startsWith(cryptoPrefix);

  if (to.path === '/login' && isAuthenticated) {
    return navigateTo('/');
  }

  if (to.path !== '/login' && !isPublicSubPage && !isAuthenticated) {
    return navigateTo('/login');
  }
});

