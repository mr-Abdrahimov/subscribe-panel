<script setup lang="ts">
definePageMeta({
  layout: 'sub'
});

type PublicUser = {
  name: string;
  code: string;
  groupName: string;
  enabled: boolean;
  subscriptionDisplayName: string | null;
  profileTitle: string | null;
  appLinks?: { name: string; url: string }[];
};

const route = useRoute();
const config = useRuntimeConfig();

const code = computed(() => String(route.params.code ?? '').trim());

function publicUserRequestUrl(c: string) {
  let base = config.public.apiBaseUrl.replace(/\/$/, '');
  if (import.meta.server) {
    const internal = (config.apiInternalBaseUrl as string | undefined)?.replace(/\/$/, '') ?? '';
    if (internal) {
      base = internal;
    }
  }
  return `${base}/public/users/${encodeURIComponent(c)}`;
}

const { data: publicUser, pending: loading } = await useAsyncData(
  () => `sub-public-user-${code.value}`,
  async () => {
    if (!code.value) {
      return null;
    }
    try {
      return await $fetch<PublicUser>(publicUserRequestUrl(code.value));
    } catch {
      return null;
    }
  },
  {
    watch: [code],
  },
);

const userName = computed(() => publicUser.value?.name ?? null);
const subscriptionDisplayName = computed(
  () => publicUser.value?.subscriptionDisplayName ?? null,
);
const profileTitle = computed(() => publicUser.value?.profileTitle?.trim() || null);
const appLinks = computed(() => publicUser.value?.appLinks ?? []);

const headTitle = computed(() => {
  if (loading.value) {
    return 'Подписка';
  }
  const c = code.value;
  if (!userName.value) {
    return c || 'Подписка';
  }
  return profileTitle.value || userName.value || c;
});

useHead({
  title: headTitle
});

useSeoMeta({
  title: headTitle,
  ogTitle: headTitle
});
</script>

<template>
  <UCard class="w-full max-w-lg">
    <template #header>
      <h1 class="text-xl font-semibold">
        <template v-if="loading">
          Загрузка…
        </template>
        <template v-else-if="userName && profileTitle">
          {{ profileTitle }}
        </template>
        <template v-else-if="userName">
          Профиль пользователя
        </template>
        <template v-else>
          Подписка
        </template>
      </h1>
    </template>

    <div v-if="loading" class="space-y-2">
      <USkeleton class="h-5 w-40" />
      <USkeleton class="h-6 w-60" />
    </div>

    <div v-else-if="userName" class="space-y-3">
      <div
        v-if="subscriptionDisplayName?.trim()"
        class="space-y-1"
      >
        <p class="text-sm text-muted">
          Название из настроек группы
        </p>
        <p class="text-lg font-medium">
          {{ subscriptionDisplayName.trim() }}
        </p>
      </div>
      <div class="space-y-1">
        <p class="text-sm text-muted">
          Имя пользователя
        </p>
        <p class="text-lg font-medium">
          {{ userName }}
        </p>
      </div>

      <div
        v-if="appLinks.length > 0"
        class="space-y-2 border-t border-default pt-4"
      >
        <p class="text-sm text-muted">
          Приложения
        </p>
        <ul class="space-y-2 list-none p-0 m-0">
          <li
            v-for="(item, idx) in appLinks"
            :key="`${item.url}-${idx}`"
          >
            <a
              :href="item.url"
              target="_blank"
              rel="noopener noreferrer"
              class="text-primary hover:underline font-medium text-sm sm:text-base inline-flex items-center gap-1.5 break-all"
            >
              <span>{{ item.name }}</span>
              <UIcon
                name="i-lucide-external-link"
                class="size-4 shrink-0 opacity-70"
              />
            </a>
          </li>
        </ul>
      </div>
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
