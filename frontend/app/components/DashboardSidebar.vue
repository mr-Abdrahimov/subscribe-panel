<script setup lang="ts">
const route = useRoute();
const emit = defineEmits<{
  navigate: [];
}>();

const accessToken = useCookie<string | null>('accessToken', {
  sameSite: 'lax',
  path: '/'
});

const menuItems = [
  { to: '/groups', label: 'Группы', icon: 'i-lucide-users-round' },
  { to: '/', label: 'Пользователи', icon: 'i-lucide-users' },
  { to: '/connects', label: 'Коннекты', icon: 'i-lucide-plug' },
  { to: '/subscriptions', label: 'Подписки', icon: 'i-lucide-badge-check' }
];

async function logout() {
  accessToken.value = null;
  if (import.meta.client) {
    localStorage.removeItem('accessToken');
  }
  emit('navigate');
  await navigateTo('/login');
}

function onNavigate() {
  emit('navigate');
}
</script>

<template>
  <div class="flex h-full min-h-[100dvh] flex-col p-3 sm:p-4 lg:p-5">
    <div
      class="flex min-h-0 flex-1 flex-col rounded-2xl border border-[var(--cosmic-border)] bg-[var(--cosmic-glass)] p-4 shadow-none backdrop-blur-xl"
    >
      <div class="mb-4 space-y-4">
        <div class="flex items-start justify-between gap-3">
          <div class="flex min-w-0 items-center gap-3">
            <div
              class="flex size-11 shrink-0 items-center justify-center rounded-xl border border-[var(--cosmic-border)] bg-[var(--cosmic-sidebar-accent)]"
            >
              <UIcon name="i-lucide-orbit" class="size-5 text-primary" />
            </div>
            <div class="min-w-0">
              <p class="cosmic-mono text-[0.65rem] uppercase tracking-[0.18em] text-[var(--cosmic-fg-muted)]">
                Панель
              </p>
              <h1
                class="truncate text-base font-bold leading-tight tracking-tight text-[var(--cosmic-fg)]"
                style="font-family: Orbitron, sans-serif"
              >
                Subscribe Panel
              </h1>
            </div>
          </div>
          <ThemeToggle />
        </div>

        <div class="h-px w-full bg-[var(--cosmic-border)] opacity-80" />
      </div>

      <nav class="flex min-h-0 flex-1 flex-col gap-1.5">
        <UButton
          v-for="item in menuItems"
          :key="item.to"
          block
          color="primary"
          :variant="route.path === item.to ? 'soft' : 'ghost'"
          :icon="item.icon"
          :to="item.to"
          class="h-11 justify-start rounded-xl px-3 font-semibold"
          @click="onNavigate"
        >
          {{ item.label }}
        </UButton>
      </nav>

      <div class="mt-4 space-y-1.5 border-t border-[var(--cosmic-border)] pt-4">
        <UButton
          block
          color="primary"
          :variant="route.path === '/settings' ? 'soft' : 'ghost'"
          icon="i-lucide-settings"
          to="/settings"
          class="h-11 justify-start rounded-xl px-3 font-semibold"
          @click="onNavigate"
        >
          Настройки
        </UButton>
        <UButton
          block
          color="neutral"
          variant="ghost"
          icon="i-lucide-log-out"
          class="h-11 justify-start rounded-xl px-3 font-semibold text-[var(--cosmic-fg-muted)]"
          @click="logout"
        >
          Выйти
        </UButton>
      </div>
    </div>
  </div>
</template>
