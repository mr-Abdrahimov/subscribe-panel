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
  <div class="h-full p-3 sm:p-4 lg:p-5">
    <UCard class="h-full">
      <template #header>
        <div class="space-y-4">
          <div class="flex items-center gap-3">
            <div class="size-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <UIcon name="i-lucide-layout-dashboard" class="size-5 text-primary" />
            </div>
            <div>
              <p class="text-sm text-muted">
                Панель управления
              </p>
              <h1 class="text-lg font-semibold leading-tight">
                Subscribe Panel
              </h1>
            </div>
          </div>

          <USeparator />
        </div>
      </template>

      <div class="space-y-2">
        <UButton
          v-for="item in menuItems"
          :key="item.to"
          block
          color="neutral"
          :variant="route.path === item.to ? 'soft' : 'ghost'"
          :icon="item.icon"
          :to="item.to"
          class="justify-start h-11 rounded-lg px-3"
          @click="onNavigate"
        >
          {{ item.label }}
        </UButton>
      </div>

      <template #footer>
        <UButton
          block
          color="neutral"
          variant="ghost"
          icon="i-lucide-log-out"
          class="justify-start h-11 rounded-lg px-3"
          @click="logout"
        >
          Выйти
        </UButton>
      </template>
    </UCard>
  </div>
</template>

