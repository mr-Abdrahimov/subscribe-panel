export default defineNuxtRouteMiddleware((to) => {
  const token = useCookie<string | null>('accessToken');
  const isAuthenticated = Boolean(token.value);

  if (to.path === '/login' && isAuthenticated) {
    return navigateTo('/');
  }

  if (to.path !== '/login' && !isAuthenticated) {
    return navigateTo('/login');
  }
});

