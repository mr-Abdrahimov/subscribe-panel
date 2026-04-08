<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui';
import * as yup from 'yup';

definePageMeta({
  layout: 'dashboard'
});

type SubscriptionItem = {
  id: string;
  title: string;
  /** Потраченный трафик (байты): upload+download из subscription-userinfo при последнем fetch */
  fetchedTrafficUsedBytes?: string | null;
  /** Доступный трафик (байты): total из subscription-userinfo при последнем fetch */
  fetchedTrafficTotalBytes?: string | null;
  /** Из ответа при «Получить коннекты»: profile-title / base64 или «# …» в теле ленты */
  fetchedProfileTitle?: string | null;
  /** ISO-8601, subscription-userinfo expire=… или «#expire:» */
  fetchedSubscriptionExpiresAt?: string | null;
  url: string;
  sourceUrl: string | null;
  lastFetchedAt: string | null;
  fetchIntervalMinutes: number | null;
  userAgent?: string | null;
  hwid?: string | null;
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

const subscriptionHeadersSchema = yup.object({
  userAgent: yup
    .string()
    .max(2048, 'User-Agent не длиннее 2048 символов'),
  hwid: yup.string().max(512, 'HWID не длиннее 512 символов'),
});

type FetchedConnect = {
  id: string;
  name: string;
};

type FetchConnectsResponse = {
  fetchedAt: string;
  title?: string;
  fetchedProfileTitle?: string | null;
  fetchedSubscriptionExpiresAt?: string | null;
  total: number;
  connects: FetchedConnect[];
};

const config = useRuntimeConfig();
const toast = useToast();

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const LINK_TABLE_DISPLAY_MAX = 20;

/** Короткая подпись ссылки в таблице; полный URL в href и title. */
function truncateLinkLabel(s: string, max = LINK_TABLE_DISPLAY_MAX): string {
  const t = s.trim();
  if (t.length <= max) {
    return t;
  }
  return `${t.slice(0, max)}…`;
}

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

function formatSubscriptionExpiresAt(iso: string | null | undefined): string {
  if (!iso) {
    return '';
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatSubscriptionExpiresLeft(iso: string | null | undefined): string {
  if (!iso) {
    return '';
  }
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) {
    return '';
  }
  const diffMs = then - Date.now();
  if (diffMs <= 0) {
    return 'истекла';
  }

  const totalMin = Math.max(0, Math.floor(diffMs / 60_000));
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin - days * 60 * 24) / 60);
  const mins = totalMin % 60;

  // Правила:
  // - если есть дни (>0) — минуты не пишем
  // - если дней 0 — дни не пишем
  if (days > 0) {
    return `${days}д ${hours}ч`;
  }
  if (hours > 0) {
    return mins > 0 ? `${hours}ч ${mins}мин` : `${hours}ч`;
  }
  return `${mins}мин`;
}

function formatUsedTrafficGb(rawBytes: string | null | undefined): string {
  const t = (rawBytes ?? '').trim();
  if (!t) {
    return '';
  }
  try {
    const bytes = BigInt(t);
    if (bytes < 0n) {
      return '';
    }
    const GB = 1_000_000_000n;
    // округление до 0.1 GB: (bytes/GB) с одним знаком после запятой
    const tenths = (bytes * 10n + GB / 2n) / GB;
    const whole = tenths / 10n;
    const frac = tenths % 10n;
    return `${whole.toString()}.${frac.toString()} ГБ`;
  } catch {
    return '';
  }
}

function formatTrafficUsageShort(
  usedBytes: string | null | undefined,
  totalBytes: string | null | undefined,
): string {
  const used = formatUsedTrafficGb(usedBytes);
  const total = formatUsedTrafficGb(totalBytes);
  if (!used && !total) {
    return '';
  }
  // Нужен вид "10/200" — убираем " ГБ" из обеих частей
  const u = used.replace(/\s*ГБ\s*$/i, '');
  const t = total.replace(/\s*ГБ\s*$/i, '');
  if (u && t) {
    return `${u}/${t}`;
  }
  return u || t;
}

const isModalOpen = ref(false);
const editId = ref<string | null>(null);
const formTitle = ref('');
const formUrl = ref('');
const formSourceUrl = ref('');
/** Пустое — без автообновления (null в API). */
const formFetchIntervalMinutes = ref<string>('');
const formUserAgent = ref('');
const formHwid = ref('');
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
    accessorKey: 'fetchedTrafficUsedBytes',
    header: 'Трафик'
  },
  {
    accessorKey: 'fetchedProfileTitle',
    header: 'Название из ленты'
  },
  {
    accessorKey: 'url',
    header: 'Саб ссылка'
  },
  {
    accessorKey: 'sourceUrl',
    header: 'Ссылка'
  },
  {
    accessorKey: 'fetchedSubscriptionExpiresAt',
    header: 'Окончание подписки'
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
  formSourceUrl.value = '';
  formFetchIntervalMinutes.value = '';
  formUserAgent.value = '';
  formHwid.value = '';
  isModalOpen.value = true;
}

function openEdit(row: SubscriptionItem) {
  editId.value = row.id;
  formTitle.value = row.title;
  formUrl.value = row.url;
  formSourceUrl.value = row.sourceUrl ?? '';
  formFetchIntervalMinutes.value =
    row.fetchIntervalMinutes != null ? String(row.fetchIntervalMinutes) : '';
  formUserAgent.value = row.userAgent ?? '';
  formHwid.value = row.hwid ?? '';
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
    toast.add({ title: 'Введите саб ссылку', color: 'error' });
    return;
  }

  try {
    const parsed = new URL(value);
    if (!(parsed.protocol === 'http:' || parsed.protocol === 'https:')) {
      throw new Error('invalid');
    }
  } catch {
    toast.add({ title: 'Некорректный формат саб ссылки', color: 'error' });
    return;
  }

  const sourceTrim = formSourceUrl.value.trim();
  if (sourceTrim !== '') {
    try {
      const sp = new URL(sourceTrim);
      if (!(sp.protocol === 'http:' || sp.protocol === 'https:')) {
        throw new Error('invalid');
      }
    } catch {
      toast.add({ title: 'Некорректный формат ссылки-источника', color: 'error' });
      return;
    }
  }
  const sourceUrl = sourceTrim === '' ? null : sourceTrim;

  const rawInterval = String(formFetchIntervalMinutes.value ?? '').trim();

  try {
    await fetchIntervalInputSchema.validate(rawInterval);
  } catch (e) {
    if (e instanceof yup.ValidationError) {
      toast.add({ title: e.message, color: 'error' });
      return;
    }
    throw e;
  }

  const fetchIntervalMinutes =
    rawInterval === '' ? null : parseInt(rawInterval, 10);

  try {
    await subscriptionHeadersSchema.validate({
      userAgent: formUserAgent.value,
      hwid: formHwid.value,
    });
  } catch (e) {
    if (e instanceof yup.ValidationError) {
      toast.add({ title: e.message, color: 'error' });
      return;
    }
    throw e;
  }

  const uaTrim = formUserAgent.value.trim();
  const hwTrim = formHwid.value.trim();
  const userAgent = uaTrim === '' ? null : uaTrim;
  const hwid = hwTrim === '' ? null : hwTrim;

  try {
    if (editId.value) {
      await $fetch(`${config.public.apiBaseUrl}/subscriptions/${editId.value}`, {
        method: 'PATCH',
        body: {
          title,
          url: value,
          sourceUrl,
          fetchIntervalMinutes,
          userAgent,
          hwid,
        },
      });
      toast.add({ title: 'Подписка обновлена', color: 'success' });
    } else {
      await $fetch(`${config.public.apiBaseUrl}/subscriptions`, {
        method: 'POST',
        body: {
          title,
          url: value,
          sourceUrl,
          fetchIntervalMinutes,
          userAgent,
          hwid,
        },
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

async function copyToClipboard(text: string) {
  const t = text.trim();
  if (!t) {
    return;
  }
  try {
    await navigator.clipboard.writeText(t);
    toast.add({ title: 'Ссылка скопирована', color: 'success' });
  } catch {
    toast.add({ title: 'Не удалось скопировать', color: 'error' });
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
        <template #fetchedTrafficUsedBytes-cell="{ row }">
          <span
            v-if="row.original.fetchedTrafficUsedBytes || row.original.fetchedTrafficTotalBytes"
            class="whitespace-nowrap tabular-nums text-sm"
            :title="`used=${row.original.fetchedTrafficUsedBytes ?? '—'} B, total=${row.original.fetchedTrafficTotalBytes ?? '—'} B`"
          >
            {{ formatTrafficUsageShort(row.original.fetchedTrafficUsedBytes, row.original.fetchedTrafficTotalBytes) }}
          </span>
          <span v-else class="text-muted text-sm">—</span>
        </template>

        <template #fetchedProfileTitle-cell="{ row }">
          <span
            v-if="row.original.fetchedProfileTitle?.trim()"
            class="text-sm max-w-[14rem] sm:max-w-xs truncate inline-block align-middle"
            :title="row.original.fetchedProfileTitle"
          >
            {{ row.original.fetchedProfileTitle }}
          </span>
          <span v-else class="text-muted text-sm">—</span>
        </template>

        <template #url-cell="{ row }">
          <UTooltip text="Скопировать саб ссылку">
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              icon="i-lucide-copy"
              @click="copyToClipboard(row.original.url)"
            />
          </UTooltip>
        </template>

        <template #sourceUrl-cell="{ row }">
          <UTooltip v-if="row.original.sourceUrl" text="Скопировать ссылку">
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              icon="i-lucide-copy"
              @click="copyToClipboard(row.original.sourceUrl)"
            />
          </UTooltip>
          <span v-else class="text-muted text-sm">—</span>
        </template>

        <template #fetchedSubscriptionExpiresAt-cell="{ row }">
          <span
            v-if="row.original.fetchedSubscriptionExpiresAt"
            class="whitespace-nowrap text-sm tabular-nums"
            :class="
              new Date(row.original.fetchedSubscriptionExpiresAt).getTime() < Date.now()
                ? 'text-error'
                : ''
            "
            :title="formatSubscriptionExpiresAt(row.original.fetchedSubscriptionExpiresAt)"
          >
            {{ formatSubscriptionExpiresLeft(row.original.fetchedSubscriptionExpiresAt) }}
          </span>
          <span v-else class="text-muted text-sm">—</span>
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
                @click="openEdit(row.original)"
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
          <UFormField
            label="Саб ссылка"
            description="URL ленты подписки, по которому получаем коннекты"
            required
          >
            <UInput v-model="formUrl" class="w-full" placeholder="https://sub.avtlk.ru/sub/..." />
          </UFormField>
          <UFormField
            label="Ссылка"
            description="Откуда получена саб ссылка (чат, сайт, панель провайдера и т.д.)"
            class="w-full"
          >
            <UInput
              v-model="formSourceUrl"
              class="w-full"
              placeholder="https://…"
              autocomplete="off"
            />
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
          <UFormField
            label="User-Agent"
            description="Если указано, при запросе к саб ссылке (кнопка «Получить коннекты» и автообновление в очереди) отправляется заголовок User-Agent."
            class="w-full"
          >
            <UInput
              v-model="formUserAgent"
              class="w-full font-mono text-sm"
              placeholder="Например: Happ/1.0"
              autocomplete="off"
            />
          </UFormField>
          <UFormField
            label="HWID"
            description="Если указано, к запросу к саб ссылке добавляется заголовок X-HWID (то же поведение вручную и в очереди)."
            class="w-full"
          >
            <UInput
              v-model="formHwid"
              class="w-full font-mono text-sm"
              placeholder="Идентификатор устройства"
              autocomplete="off"
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

