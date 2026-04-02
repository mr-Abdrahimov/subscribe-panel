export default defineNuxtRouteMiddleware((to) => {
  const token = useCookie<string | null>('accessToken');
  const isAuthenticated = Boolean(token.value);
  const isPublicSubPage = to.path.startsWith('/sub/');

  if (to.path === '/login' && isAuthenticated) {
    return navigateTo('/');
  }

  if (to.path !== '/login' && !isPublicSubPage && !isAuthenticated) {
    return navigateTo('/login');
  }
});

