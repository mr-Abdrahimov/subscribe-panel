<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui';

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
const isDeleteConfirmOpen = ref(false);
const deleteSubscriptionId = ref<string | null>(null);
const columns: TableColumn<SubscriptionItem>[] = [
  {
    accessorKey: 'title',
    header: 'Название'
  },
  {
    accessorKey: 'url',
    header: 'Ссылка'
  },
  {
    accessorKey: 'createdAt',
    header: 'Дата добавления'
  },
  {
    id: 'lastFetchedAt',
    header: 'Получено'
  },
  {
    id: 'actions',
    header: 'Действия'
  }
];

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

function askRemoveItem(id: string) {
  deleteSubscriptionId.value = id;
  isDeleteConfirmOpen.value = true;
}

async function confirmRemoveItem() {
  if (!deleteSubscriptionId.value) {
    return;
  }
  await removeItem(deleteSubscriptionId.value);
  isDeleteConfirmOpen.value = false;
  deleteSubscriptionId.value = null;
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
      <UTable
        :data="subscriptions"
        :columns="columns"
        :loading="loading"
        empty="Подписок пока нет"
        class="w-full"
      >
        <template #url-cell="{ row }">
          <a
            :href="row.original.url"
            target="_blank"
            rel="noreferrer"
            class="text-primary hover:underline break-all"
          >
            {{ row.original.url }}
          </a>
        </template>

        <template #createdAt-cell="{ row }">
          <span class="whitespace-nowrap">
            {{ new Date(row.original.createdAt).toLocaleString('ru-RU') }}
          </span>
        </template>

        <template #lastFetchedAt-cell="{ row }">
          <span v-if="row.original.lastFetchedAt" class="whitespace-nowrap">
            {{ new Date(row.original.lastFetchedAt).toLocaleString('ru-RU') }}
          </span>
          <span v-else class="text-error">Не получили</span>
        </template>

        <template #actions-cell="{ row }">
          <div class="flex flex-wrap items-center gap-2">
            <UTooltip text="Получить коннекты">
              <UButton
                size="xs"
                color="primary"
                variant="ghost"
                icon="i-lucide-download"
                @click="fetchConnects(row.original.id)"
              />
            </UTooltip>
            <UTooltip text="Редактировать подписку">
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-lucide-pencil"
                @click="openEdit(row.original.id, row.original.title, row.original.url)"
              />
            </UTooltip>
            <UTooltip text="Удалить подписку">
              <UButton
                size="xs"
                color="error"
                variant="ghost"
                icon="i-lucide-trash"
                @click="askRemoveItem(row.original.id)"
              />
            </UTooltip>
          </div>
        </template>
      </UTable>
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

    <UModal v-model:open="isDeleteConfirmOpen" title="Подтверждение удаления">
      <template #body>
        <p>Вы действительно хотите удалить эту подписку?</p>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton color="neutral" variant="ghost" @click="isDeleteConfirmOpen = false">
            Отмена
          </UButton>
          <UButton color="error" @click="confirmRemoveItem">
            Да, удалить
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>

