<script setup lang="ts">
definePageMeta({
  layout: 'sub'
});

type PublicUser = {
  name: string;
  code: string;
  groupName: string;
  enabled: boolean;
};

const route = useRoute();
const config = useRuntimeConfig();
const loading = ref(true);
const userName = ref<string | null>(null);

onMounted(async () => {
  const code = String(route.params.code ?? '');
  try {
    const user = await $fetch<PublicUser>(`${config.public.apiBaseUrl}/public/users/${code}`);
    userName.value = user.name;
  } catch {
    userName.value = null;
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <UCard class="w-full max-w-lg">
    <template #header>
      <h1 class="text-xl font-semibold">
        Профиль пользователя
      </h1>
    </template>

    <div v-if="loading" class="space-y-2">
      <USkeleton class="h-5 w-40" />
      <USkeleton class="h-6 w-60" />
    </div>

    <div v-else-if="userName" class="space-y-2">
      <p class="text-sm text-muted">
        Имя пользователя
      </p>
      <p class="text-lg font-medium">
        {{ userName }}
      </p>
    </div>

    <UAlert
      v-else
      color="error"
      variant="soft"
      icon="i-lucide-circle-alert"
      title="Пользователь не найден"
      description="Проверьте корректность ссылки."
    />
  </UCard>
</template>

