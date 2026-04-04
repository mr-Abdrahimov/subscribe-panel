<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui';
import * as yup from 'yup';

definePageMeta({
  layout: 'dashboard'
});

type SubscriptionItem = {
  id: string;
  title: string;
  url: string;
  createdAt: string;
  lastFetchedAt: string | null;
  fetchIntervalMinutes: number | null;
};

const fetchIntervalInputSchema = yup.string().test(
  'fetch-interval',
  'Целое число минут от 5 до 10080 или оставьте пустым (только ручное обновление)',
  (val) => {
    const t = (val ?? '').trim();
    if (t === '') {
      return true;
    }
    const n = parseInt(t, 10);
    return Number.isInteger(n) && n >= 5 && n <= 10080;
  },
);

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

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** До 24 ч включительно — «N ч M мин назад»; старше — дата и время. */
function formatLastFetchedLabel(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) {
    return iso;
  }
  const diff = Date.now() - then;
  if (diff < 0) {
    return new Date(iso).toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  if (diff > MS_PER_DAY) {
    return new Date(iso).toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  const totalMin = Math.floor(diff / 60_000);
  if (totalMin < 1) {
    return 'только что';
  }
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) {
    return `${m} мин назад`;
  }
  if (m === 0) {
    return `${h} ч назад`;
  }
  return `${h} ч ${m} мин назад`;
}

const isModalOpen = ref(false);
const editId = ref<string | null>(null);
const formTitle = ref('');
const formUrl = ref('');
/** Пустая строка — без автообновления (null в API) */
const formFetchIntervalMinutes = ref('');
const loading = ref(false);
const subscriptions = ref<SubscriptionItem[]>([]);

const isConnectsModalOpen = ref(false);
const fetchedConnects = ref<FetchedConnect[]>([]);
/** id подписки, для которой сейчас идёт POST /fetch */
const fetchingSubscriptionId = ref<string | null>(null);
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
    id: 'fetchIntervalMinutes',
    header: 'Автообновление'
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
  formFetchIntervalMinutes.value = '';
  isModalOpen.value = true;
}

function openEdit(
  id: string,
  title: string,
  url: string,
  fetchIntervalMinutes: number | null,
) {
  editId.value = id;
  formTitle.value = title;
  formUrl.value = url;
  formFetchIntervalMinutes.value =
    fetchIntervalMinutes != null ? String(fetchIntervalMinutes) : '';
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
    await fetchIntervalInputSchema.validate(formFetchIntervalMinutes.value);
  } catch (e) {
    if (e instanceof yup.ValidationError) {
      toast.add({ title: e.message, color: 'error' });
      return;
    }
    throw e;
  }

  const rawInterval = formFetchIntervalMinutes.value.trim();
  const fetchIntervalMinutes =
    rawInterval === '' ? null : parseInt(rawInterval, 10);

  try {
    if (editId.value) {
      await $fetch(`${config.public.apiBaseUrl}/subscriptions/${editId.value}`, {
        method: 'PATCH',
        body: { title, url: value, fetchIntervalMinutes },
      });
      toast.add({ title: 'Подписка обновлена', color: 'success' });
    } else {
      await $fetch(`${config.public.apiBaseUrl}/subscriptions`, {
        method: 'POST',
        body: { title, url: value, fetchIntervalMinutes },
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
  fetchingSubscriptionId.value = id;
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
  } finally {
    fetchingSubscriptionId.value = null;
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
  <div class="cosmic-app space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="cosmic-h2">
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

        <template #fetchIntervalMinutes-cell="{ row }">
          <span
            v-if="row.original.fetchIntervalMinutes != null"
            class="whitespace-nowrap tabular-nums text-sm"
          >
            каждые {{ row.original.fetchIntervalMinutes }} мин
          </span>
          <span v-else class="text-muted text-sm">Только вручную</span>
        </template>

        <template #lastFetchedAt-cell="{ row }">
          <span
            v-if="row.original.lastFetchedAt"
            class="whitespace-nowrap tabular-nums"
            :title="new Date(row.original.lastFetchedAt).toLocaleString('ru-RU')"
          >
            {{ formatLastFetchedLabel(row.original.lastFetchedAt) }}
          </span>
          <span v-else class="text-error">Не получили</span>
        </template>

        <template #actions-cell="{ row }">
          <div class="flex flex-wrap items-center gap-2">
            <UTooltip
              :text="
                fetchingSubscriptionId === row.original.id
                  ? 'Загрузка коннектов…'
                  : 'Получить коннекты'
              "
            >
              <UButton
                size="xs"
                color="primary"
                variant="ghost"
                icon="i-lucide-download"
                :loading="fetchingSubscriptionId === row.original.id"
                :disabled="
                  fetchingSubscriptionId !== null &&
                  fetchingSubscriptionId !== row.original.id
                "
                @click="fetchConnects(row.original.id)"
              />
            </UTooltip>
            <UTooltip text="Редактировать подписку">
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-lucide-pencil"
                @click="
                  openEdit(
                    row.original.id,
                    row.original.title,
                    row.original.url,
                    row.original.fetchIntervalMinutes ?? null,
                  )
                "
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
          <UFormField
            label="Автообновление коннектов"
            description="Интервал в минутах (не реже одного раза в 5 минут). Оставьте пустым — обновление только кнопкой «Получить коннекты». На сервере используется очередь BullMQ с тем же алгоритмом синхронизации."
            class="w-full"
          >
            <UInput
              v-model="formFetchIntervalMinutes"
              type="number"
              :min="5"
              :max="10080"
              class="w-full tabular-nums"
              placeholder="Пусто = только вручную"
            />
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

