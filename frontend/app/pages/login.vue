<script setup lang="ts">
definePageMeta({
  layout: 'auth'
});

type AuthResponse = {
  accessToken: string;
};

const config = useRuntimeConfig();
const accessToken = useCookie<string | null>('accessToken', {
  sameSite: 'lax',
  path: '/'
});
const pending = ref(false);
const errorMessage = ref('');

const form = reactive({
  email: '',
  password: ''
});

async function submit() {
  pending.value = true;
  errorMessage.value = '';

  try {
    const response = await $fetch<AuthResponse>(`${config.public.apiBaseUrl}/auth/login`, {
      method: 'POST',
      body: {
        email: form.email,
        password: form.password
      }
    });

    accessToken.value = response.accessToken;
    if (import.meta.client) {
      localStorage.removeItem('accessToken');
    }
    await navigateTo('/');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Ошибка авторизации';
    errorMessage.value = message;
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <UCard
    class="cosmic-login-shell mx-auto w-full max-w-md !shadow-none"
    :ui="{
      root: 'ring-0 shadow-none',
      header: 'border-b border-[var(--cosmic-border)]',
    }"
  >
    <template #header>
      <h1 class="cosmic-h2 !text-lg normal-case tracking-tight">
        Авторизация
      </h1>
    </template>

    <form class="space-y-4 w-full" @submit.prevent="submit">
      <UFormField label="Email" required>
        <UInput v-model="form.email" class="w-full" type="email" placeholder="user@example.com" />
      </UFormField>

      <UFormField label="Пароль" required>
        <UInput v-model="form.password" class="w-full" type="password" placeholder="Введите пароль" />
      </UFormField>

      <UButton type="submit" :loading="pending" block>
        Войти
      </UButton>
    </form>

    <UAlert
      v-if="errorMessage"
      class="mt-4"
      color="error"
      variant="subtle"
      title="Ошибка"
      :description="errorMessage"
    />
  </UCard>
</template>

