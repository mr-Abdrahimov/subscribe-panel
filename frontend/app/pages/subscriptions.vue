<script setup lang="ts">
definePageMeta({
  layout: 'dashboard'
});

type SubscriptionItem = {
  id: string;
  title: string;
  url: string;
  createdAt: string;
  lastFetchedAt: string | null;
};

type FetchedConnect = {
  id: string;
  name: string;
};

type FetchConnectsResponse = {
  fetchedAt: string;
  total: number;
  connects: FetchedConnect[];
};

const config = useRuntimeConfig();
const toast = useToast();

const isModalOpen = ref(false);
const editId = ref<string | null>(null);
const formTitle = ref('');
const formUrl = ref('');
const loading = ref(false);
const subscriptions = ref<SubscriptionItem[]>([]);

const isConnectsModalOpen = ref(false);
const fetchedConnects = ref<FetchedConnect[]>([]);

onMounted(() => {
  loadSubscriptions();
});

function openCreate() {
  editId.value = null;
  formTitle.value = '';
  formUrl.value = '';
  isModalOpen.value = true;
}

function openEdit(id: string, title: string, url: string) {
  editId.value = id;
  formTitle.value = title;
  formUrl.value = url;
  isModalOpen.value = true;
}

async function submit() {
  const title = formTitle.value.trim();
  const value = formUrl.value.trim();
  if (!title) {
    toast.add({ title: 'Введите название', color: 'error' });
    return;
  }

  if (!value) {
    toast.add({ title: 'Введите ссылку', color: 'error' });
    return;
  }

  try {
    const parsed = new URL(value);
    if (!(parsed.protocol === 'http:' || parsed.protocol === 'https:')) {
      throw new Error('invalid');
    }
  } catch {
    toast.add({ title: 'Некорректный формат ссылки', color: 'error' });
    return;
  }

  try {
    if (editId.value) {
      await $fetch(`${config.public.apiBaseUrl}/subscriptions/${editId.value}`, {
        method: 'PATCH',
        body: { title, url: value },
      });
      toast.add({ title: 'Подписка обновлена', color: 'success' });
    } else {
      await $fetch(`${config.public.apiBaseUrl}/subscriptions`, {
        method: 'POST',
        body: { title, url: value },
      });
      toast.add({ title: 'Подписка добавлена', color: 'success' });
    }
    await loadSubscriptions();
    isModalOpen.value = false;
  } catch {
    toast.add({ title: 'Не удалось сохранить подписку', color: 'error' });
  }
}

async function removeItem(id: string) {
  try {
    await $fetch(`${config.public.apiBaseUrl}/subscriptions/${id}`, {
      method: 'DELETE',
    });
    toast.add({ title: 'Подписка удалена', color: 'success' });
    await loadSubscriptions();
  } catch {
    toast.add({ title: 'Не удалось удалить подписку', color: 'error' });
  }
}

async function fetchConnects(id: string) {
  try {
    const response = await $fetch<FetchConnectsResponse>(
      `${config.public.apiBaseUrl}/subscriptions/${id}/fetch`,
      {
        method: 'POST',
      },
    );
    toast.add({
      title: `Получено коннектов: ${response.total}`,
      color: 'success',
    });
    fetchedConnects.value = response.connects;
    isConnectsModalOpen.value = true;
    await loadSubscriptions();
  } catch {
    toast.add({ title: 'Не удалось получить коннекты', color: 'error' });
  }
}

async function loadSubscriptions() {
  loading.value = true;
  try {
    subscriptions.value = await $fetch<SubscriptionItem[]>(
      `${config.public.apiBaseUrl}/subscriptions`,
    );
  } catch {
    toast.add({ title: 'Не удалось загрузить подписки', color: 'error' });
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between gap-3">
      <h2 class="text-xl font-semibold">
        Подписки
      </h2>

      <UButton icon="i-lucide-plus" @click="openCreate">
        Добавить
      </UButton>
    </div>

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <div v-if="loading" class="p-4">
        <USkeleton class="h-10 w-full" />
      </div>

      <div class="hidden md:block px-4 pb-4">
        <div class="grid grid-cols-[1fr_2fr_1fr_1fr_1.3fr] gap-3 border-b py-3 text-sm font-medium">
          <div>Название</div>
          <div>Ссылка</div>
          <div>Дата добавления</div>
          <div>Получено</div>
          <div>Действия</div>
        </div>

        <div v-if="subscriptions.length === 0 && !loading" class="py-6 text-center text-muted">
          Подписок пока нет
        </div>

        <div
          v-for="item in subscriptions"
          :key="item.id"
          class="grid grid-cols-[1fr_2fr_1fr_1fr_1.3fr] gap-3 border-b last:border-b-0 py-3 text-sm items-start"
        >
          <div class="whitespace-nowrap">{{ item.title }}</div>
          <div>
            <a :href="item.url" target="_blank" rel="noreferrer" class="text-primary hover:underline break-all">
              {{ item.url }}
            </a>
          </div>
          <div class="whitespace-nowrap">
            {{ new Date(item.createdAt).toLocaleString('ru-RU') }}
          </div>
          <div class="whitespace-nowrap">
            <span v-if="item.lastFetchedAt">
              {{ new Date(item.lastFetchedAt).toLocaleString('ru-RU') }}
            </span>
            <span v-else class="text-error">Не получили</span>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <UButton
              size="xs"
              color="primary"
              variant="soft"
              icon="i-lucide-download"
              @click="fetchConnects(item.id)"
            >
              Получить
            </UButton>
            <UButton
              size="xs"
              color="neutral"
              variant="soft"
              icon="i-lucide-pencil"
              @click="openEdit(item.id, item.title, item.url)"
            >
              Редактировать
            </UButton>
            <UButton
              size="xs"
              color="error"
              variant="soft"
              icon="i-lucide-trash"
              @click="removeItem(item.id)"
            >
              Удалить
            </UButton>
          </div>
        </div>
      </div>

      <div class="md:hidden space-y-3">
        <div
          v-if="subscriptions.length === 0 && !loading"
          class="py-4 text-center text-sm text-muted"
        >
          Подписок пока нет
        </div>

        <UCard v-for="item in subscriptions" :key="item.id" variant="subtle">
          <div class="space-y-2">
            <p class="text-xs text-muted">
              Название
            </p>
            <p class="font-medium">
              {{ item.title }}
            </p>

            <p class="text-xs text-muted mt-2">
              Ссылка
            </p>
            <a :href="item.url" target="_blank" rel="noreferrer" class="text-primary hover:underline break-all">
              {{ item.url }}
            </a>

            <p class="text-xs text-muted mt-2">
              Дата добавления
            </p>
            <p>{{ new Date(item.createdAt).toLocaleString('ru-RU') }}</p>

            <p class="text-xs text-muted mt-2">
              Получено
            </p>
            <p v-if="item.lastFetchedAt">
              {{ new Date(item.lastFetchedAt).toLocaleString('ru-RU') }}
            </p>
            <p v-else class="text-error">
              Не получили
            </p>

            <div class="flex flex-wrap gap-2 pt-2">
              <UButton
                size="xs"
                color="primary"
                variant="soft"
                icon="i-lucide-download"
                @click="fetchConnects(item.id)"
              >
                Получить
              </UButton>
              <UButton
                size="xs"
                color="neutral"
                variant="soft"
                icon="i-lucide-pencil"
                @click="openEdit(item.id, item.title, item.url)"
              >
                Редактировать
              </UButton>
              <UButton
                size="xs"
                color="error"
                variant="soft"
                icon="i-lucide-trash"
                @click="removeItem(item.id)"
              >
                Удалить
              </UButton>
            </div>
          </div>
        </UCard>
      </div>
    </UCard>

    <UModal v-model:open="isModalOpen" :title="editId ? 'Редактировать подписку' : 'Добавить подписку'">
      <template #body>
        <div class="space-y-3">
          <UFormField label="Название" required>
            <UInput v-model="formTitle" class="w-full" placeholder="Например: Основная VPN подписка" />
          </UFormField>
          <UFormField label="Ссылка на VPN подписку" required>
            <UInput v-model="formUrl" class="w-full" placeholder="https://sub.avtlk.ru/sub/..." />
          </UFormField>
        </div>
      </template>

      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton color="neutral" variant="ghost" @click="isModalOpen = false">
            Отмена
          </UButton>
          <UButton @click="submit">
            Сохранить
          </UButton>
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="isConnectsModalOpen"
      title="Полученные коннекты"
    >
      <template #body>
        <div class="space-y-2">
          <p v-if="fetchedConnects.length === 0" class="text-muted">
            Коннекты не найдены
          </p>
          <ul v-else class="space-y-2">
            <li
              v-for="connect in fetchedConnects"
              :key="connect.id"
              class="rounded-md border px-3 py-2"
            >
              {{ connect.name }}
            </li>
          </ul>
        </div>
      </template>
    </UModal>
  </div>
</template>

