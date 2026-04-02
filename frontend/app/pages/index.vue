<script setup lang="ts">
type AuthResponse = {
  accessToken: string;
  user: {
    id: string;
    email: string;
    name?: string;
  };
};

const config = useRuntimeConfig();
const isRegisterMode = ref(false);
const pending = ref(false);
const errorMessage = ref('');
const successMessage = ref('');
const savedToken = ref('');

const form = reactive({
  email: config.public.adminEmail as string,
  password: config.public.adminPassword as string,
  name: ''
});

onMounted(() => {
  savedToken.value = localStorage.getItem('accessToken') || '';
});

async function submit() {
  pending.value = true;
  errorMessage.value = '';
  successMessage.value = '';

  try {
    const endpoint = isRegisterMode.value ? '/auth/register' : '/auth/login';
    const payload = isRegisterMode.value
      ? { email: form.email, password: form.password, name: form.name || undefined }
      : { email: form.email, password: form.password };

    const response = await $fetch<AuthResponse>(`${config.public.apiBaseUrl}${endpoint}`, {
      method: 'POST',
      body: payload
    });

    localStorage.setItem('accessToken', response.accessToken);
    savedToken.value = response.accessToken;
    successMessage.value = isRegisterMode.value
      ? 'Регистрация успешна. Токен сохранен.'
      : 'Авторизация успешна. Токен сохранен.';
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Ошибка авторизации';
    errorMessage.value = message;
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <UContainer class="min-h-[100dvh] flex items-center justify-center py-6">
    <UCard class="mx-auto w-full max-w-md">
      <template #header>
        <div class="flex items-center justify-between gap-2">
          <h1 class="text-xl font-semibold">
            {{ isRegisterMode ? 'Регистрация' : 'Авторизация' }}
          </h1>

          <UButton
            size="sm"
            color="neutral"
            variant="ghost"
            @click="isRegisterMode = !isRegisterMode"
          >
            {{ isRegisterMode ? 'У меня уже есть аккаунт' : 'Создать аккаунт' }}
          </UButton>
        </div>
      </template>

      <form class="space-y-4 w-full" @submit.prevent="submit">
        <UFormField label="Email" required>
          <UInput v-model="form.email" class="w-full" type="email" placeholder="user@example.com" />
        </UFormField>

        <UFormField label="Пароль" required>
          <UInput v-model="form.password" class="w-full" type="password" placeholder="Введите пароль" />
        </UFormField>

        <UFormField v-if="isRegisterMode" label="Имя">
          <UInput v-model="form.name" class="w-full" placeholder="Ваше имя" />
        </UFormField>

        <UButton type="submit" :loading="pending" block>
          {{ isRegisterMode ? 'Зарегистрироваться' : 'Войти' }}
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

      <UAlert
        v-if="successMessage"
        class="mt-4"
        color="success"
        variant="subtle"
        title="Успех"
        :description="successMessage"
      />

      <div v-if="savedToken" class="mt-4 rounded-md border p-3 text-xs break-all">
        <p class="mb-1 font-medium">
          accessToken:
        </p>
        <p>{{ savedToken }}</p>
      </div>
    </UCard>
  </UContainer>
</template>
