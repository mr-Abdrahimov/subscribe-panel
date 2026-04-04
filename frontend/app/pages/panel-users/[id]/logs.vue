<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui';

definePageMeta({
  layout: 'dashboard',
});

type AccessLogRow = {
  id: string;
  clientIp: string | null;
  userAgent: string | null;
  hwid: string | null;
  accept: string | null;
  acceptLanguage: string | null;
  referer: string | null;
  queryParams: unknown;
  extraHeaders: unknown;
  /** false — заглушка (отказ); true или отсутствие — полная лента (старые записи) */
  success?: boolean;
  createdAt: string;
};

type LogsResponse = {
  user: { name: string; code: string };
  hwids: string[];
  logs: AccessLogRow[];
};

const route = useRoute();
const config = useRuntimeConfig();
const toast = useToast();

const panelUserId = computed(() => String(route.params.id ?? ''));

/** null — все HWID */
const filterHwid = ref<string | null>(null);

const hwidFilterItems = computed(() => {
  const rest = (payload.value?.hwids ?? []).map((h) => ({
    label: h.length > 72 ? `${h.slice(0, 72)}…` : h,
    id: h,
  }));
  return [{ label: 'Все HWID', id: null as string | null }, ...rest];
});

const loading = ref(true);
const payload = ref<LogsResponse | null>(null);
const deleteByHwidLoading = ref(false);
const confirmDeleteHwidOpen = ref(false);
const detailLog = ref<AccessLogRow | null>(null);
const isDetailOpen = computed({
  get: () => detailLog.value !== null,
  set: (v) => {
    if (!v) {
      detailLog.value = null;
    }
  },
});

const columns: TableColumn<AccessLogRow>[] = [
  {
    accessorKey: 'createdAt',
    header: 'Время',
  },
  {
    accessorKey: 'clientIp',
    header: 'IP',
  },
  {
    id: 'outcome',
    header: 'Результат',
  },
  {
    accessorKey: 'hwid',
    header: 'HWID',
  },
  {
    accessorKey: 'userAgent',
    header: 'User-Agent',
  },
  {
    accessorKey: 'referer',
    header: 'Referer',
  },
  {
    id: 'queryShort',
    header: 'Query',
  },
  {
    id: 'actions',
    header: '',
    meta: {
      class: {
        th: 'w-px',
        td: 'w-px whitespace-nowrap',
      },
    },
  },
];

function fetchErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'data' in err) {
    const d = (err as { data?: { message?: unknown } }).data?.message;
    if (typeof d === 'string') {
      return d;
    }
    if (Array.isArray(d)) {
      return d.join(', ');
    }
  }
  return fallback;
}

async function load() {
  const id = panelUserId.value;
  if (!id) {
    return;
  }
  loading.value = true;
  payload.value = null;
  try {
    const q = new URLSearchParams({ limit: '300' });
    const h = filterHwid.value?.trim();
    if (h) {
      q.set('hwid', h);
    }
    payload.value = await $fetch<LogsResponse>(
      `${config.public.apiBaseUrl}/panel-users/${encodeURIComponent(id)}/subscription-access-logs?${q.toString()}`,
    );
  } catch {
    toast.add({ title: 'Не удалось загрузить логи', color: 'error' });
  } finally {
    loading.value = false;
  }
}

watch(panelUserId, (_id, prev) => {
  if (prev !== undefined) {
    filterHwid.value = null;
  }
});

watch(
  [panelUserId, filterHwid],
  () => {
    void load();
  },
  { immediate: true },
);

async function deleteLogsBySelectedHwid() {
  const id = panelUserId.value;
  const h = filterHwid.value?.trim();
  if (!id || !h) {
    return;
  }
  deleteByHwidLoading.value = true;
  try {
    const q = new URLSearchParams({ hwid: h });
    const res = await $fetch<{ deleted: number }>(
      `${config.public.apiBaseUrl}/panel-users/${encodeURIComponent(id)}/subscription-access-logs?${q.toString()}`,
      { method: 'DELETE' },
    );
    toast.add({
      title: 'Логи удалены',
      description: `Удалено записей: ${res.deleted}`,
      color: 'success',
    });
    confirmDeleteHwidOpen.value = false;
    filterHwid.value = null;
  } catch (e) {
    toast.add({
      title: 'Не удалось удалить логи',
      description: fetchErrorMessage(e, ''),
      color: 'error',
    });
  } finally {
    deleteByHwidLoading.value = false;
  }
}

function formatDt(iso: string) {
  try {
    return new Date(iso).toLocaleString('ru-RU', {
      dateStyle: 'short',
      timeStyle: 'medium',
    });
  } catch {
    return iso;
  }
}

function jsonPreview(v: unknown, max = 96): string {
  if (v == null) {
    return '—';
  }
  if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0) {
    return '—';
  }
  const s = JSON.stringify(v);
  if (s.length <= max) {
    return s;
  }
  return `${s.slice(0, max)}…`;
}

function jsonPretty(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function openDetail(row: AccessLogRow) {
  detailLog.value = row;
}

function truncateText(s: string | null | undefined, max: number): string {
  if (!s) {
    return '—';
  }
  const t = s.trim();
  if (!t) {
    return '—';
  }
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

/** Первый адрес из цепочки (X-Forwarded-For и т.д.) — страница ipinfo.io */
function ipinfoLookupUrl(clientIp: string | null | undefined): string | null {
  if (!clientIp) {
    return null;
  }
  const first = clientIp.split(',')[0]?.trim();
  if (!first) {
    return null;
  }
  return `https://ipinfo.io/${encodeURIComponent(first)}`;
}

/** Старые логи без поля success считаем успешной выдачей */
function logOutcomeLabel(success: boolean | undefined): { label: string; color: 'success' | 'error' | 'neutral' } {
  if (success === false) {
    return { label: 'Отказ', color: 'error' };
  }
  return { label: 'Лента', color: 'success' };
}
</script>

<template>
  <div class="cosmic-app space-y-4">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div class="space-y-1 min-w-0">
        <UButton
          to="/"
          color="neutral"
          variant="ghost"
          icon="i-lucide-arrow-left"
          class="mb-1 -ml-2"
        >
          К списку пользователей
        </UButton>
        <h2 class="cosmic-h2 truncate !normal-case !tracking-tight">
          Логи подписки
        </h2>
        <p
          v-if="payload?.user"
          class="text-sm text-muted truncate"
        >
          {{ payload.user.name }}
          <span class="font-mono text-xs">· {{ payload.user.code }}</span>
        </p>
      </div>
    </div>

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <div
        class="flex flex-col gap-3 border-b border-default p-4 sm:flex-row sm:flex-wrap sm:items-end"
      >
        <UFormField
          label="HWID"
          description="Показать только обращения с выбранным идентификатором устройства"
          class="w-full min-w-0 sm:max-w-xl sm:flex-1"
        >
          <USelectMenu
            v-model="filterHwid"
            :items="hwidFilterItems"
            value-key="id"
            label-key="label"
            placeholder="Все HWID"
            class="w-full"
            clear
          />
        </UFormField>
        <UButton
          color="error"
          variant="soft"
          icon="i-lucide-trash-2"
          class="w-full shrink-0 sm:w-auto"
          :disabled="!filterHwid || loading"
          @click="confirmDeleteHwidOpen = true"
        >
          Удалить логи с этим HWID
        </UButton>
      </div>
      <UTable
        :data="payload?.logs ?? []"
        :columns="columns"
        :loading="loading"
        empty="Записей пока нет — появятся при обновлении подписки в Happ и других клиентах"
        class="w-full"
      >
        <template #createdAt-cell="{ row }">
          <span class="text-sm whitespace-nowrap">{{ formatDt(row.original.createdAt) }}</span>
        </template>

        <template #clientIp-cell="{ row }">
          <div class="flex items-center gap-0.5 max-w-[11rem] sm:max-w-none">
            <span class="font-mono text-xs truncate min-w-0">{{ row.original.clientIp || '—' }}</span>
            <UTooltip
              v-if="ipinfoLookupUrl(row.original.clientIp)"
              text="Открыть сведения об IP на ipinfo.io (новая вкладка)"
            >
              <UButton
                :to="ipinfoLookupUrl(row.original.clientIp)!"
                target="_blank"
                external
                color="neutral"
                variant="ghost"
                size="xs"
                icon="i-lucide-external-link"
                class="rounded-lg p-1.5 min-w-8 min-h-8 shrink-0"
                aria-label="Открыть IP на ipinfo.io"
              />
            </UTooltip>
          </div>
        </template>

        <template #outcome-cell="{ row }">
          <UBadge
            size="sm"
            variant="subtle"
            :color="logOutcomeLabel(row.original.success).color"
          >
            {{ logOutcomeLabel(row.original.success).label }}
          </UBadge>
        </template>

        <template #hwid-cell="{ row }">
          <span class="font-mono text-xs break-all max-w-[8rem] sm:max-w-[12rem] inline-block">{{
            row.original.hwid || '—'
          }}</span>
        </template>

        <template #userAgent-cell="{ row }">
          <span
            class="text-xs text-muted max-w-[10rem] sm:max-w-xs md:max-w-md inline-block break-all"
            :title="row.original.userAgent ?? undefined"
          >{{ truncateText(row.original.userAgent, 120) }}</span>
        </template>

        <template #referer-cell="{ row }">
          <span
            class="text-xs text-muted max-w-[8rem] sm:max-w-[14rem] inline-block break-all"
            :title="row.original.referer ?? undefined"
          >{{ truncateText(row.original.referer, 80) }}</span>
        </template>

        <template #queryShort-cell="{ row }">
          <code class="text-[0.65rem] text-muted break-all max-w-[6rem] sm:max-w-[10rem] inline-block align-top">{{
            jsonPreview(row.original.queryParams)
          }}</code>
        </template>

        <template #actions-cell="{ row }">
          <UTooltip text="Подробности записи">
            <UButton
              color="neutral"
              variant="ghost"
              size="xs"
              icon="i-lucide-file-json-2"
              class="rounded-lg p-1.5 min-w-8 min-h-8"
              aria-label="Подробности"
              @click="openDetail(row.original)"
            />
          </UTooltip>
        </template>
      </UTable>
    </UCard>

    <UModal
      v-model:open="isDetailOpen"
      title="Запись лога"
      :description="detailLog ? formatDt(detailLog.createdAt) : undefined"
    >
      <template v-if="detailLog" #body>
        <div class="space-y-3 text-sm max-h-[70vh] overflow-y-auto">
          <div>
            <p class="text-xs text-muted mb-1">
              Результат
            </p>
            <UBadge
              size="sm"
              variant="subtle"
              :color="logOutcomeLabel(detailLog.success).color"
            >
              {{ logOutcomeLabel(detailLog.success).label }}
            </UBadge>
            <p
              v-if="detailLog.success === false"
              class="text-xs text-muted mt-1"
            >
              Заглушка (лимит HWID, только crypto, UA и т.д.) — не учитывается в счётчике устройств и «последней активности».
            </p>
          </div>
          <div>
            <p class="text-xs text-muted mb-1">
              IP
            </p>
            <div class="flex flex-wrap items-center gap-1.5">
              <p class="font-mono text-xs break-all min-w-0">
                {{ detailLog.clientIp || '—' }}
              </p>
              <UTooltip
                v-if="ipinfoLookupUrl(detailLog.clientIp)"
                text="Открыть сведения об IP на ipinfo.io (новая вкладка)"
              >
                <UButton
                  :to="ipinfoLookupUrl(detailLog.clientIp)!"
                  target="_blank"
                  external
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  icon="i-lucide-external-link"
                  class="rounded-lg p-1.5 min-w-8 min-h-8 shrink-0"
                  aria-label="Открыть IP на ipinfo.io"
                />
              </UTooltip>
            </div>
          </div>
          <div>
            <p class="text-xs text-muted mb-1">
              HWID
            </p>
            <p class="font-mono text-xs break-all">
              {{ detailLog.hwid || '—' }}
            </p>
          </div>
          <div>
            <p class="text-xs text-muted mb-1">
              User-Agent
            </p>
            <p class="font-mono text-xs break-all whitespace-pre-wrap">
              {{ detailLog.userAgent || '—' }}
            </p>
          </div>
          <div>
            <p class="text-xs text-muted mb-1">
              Accept / Accept-Language
            </p>
            <p class="font-mono text-xs break-all whitespace-pre-wrap">
              {{ detailLog.accept || '—' }}
            </p>
            <p class="font-mono text-xs break-all whitespace-pre-wrap mt-1">
              {{ detailLog.acceptLanguage || '—' }}
            </p>
          </div>
          <div>
            <p class="text-xs text-muted mb-1">
              Referer
            </p>
            <p class="font-mono text-xs break-all whitespace-pre-wrap">
              {{ detailLog.referer || '—' }}
            </p>
          </div>
          <div>
            <p class="text-xs text-muted mb-1">
              Query (JSON)
            </p>
            <pre class="text-xs font-mono bg-elevated p-3 rounded-lg overflow-x-auto whitespace-pre-wrap break-all">{{ jsonPretty(detailLog.queryParams) }}</pre>
          </div>
          <div>
            <p class="text-xs text-muted mb-1">
              Доп. заголовки (JSON)
            </p>
            <pre class="text-xs font-mono bg-elevated p-3 rounded-lg overflow-x-auto whitespace-pre-wrap break-all">{{ jsonPretty(detailLog.extraHeaders) }}</pre>
          </div>
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="confirmDeleteHwidOpen"
      title="Удалить логи по HWID?"
      :description="
        filterHwid
          ? `Будут удалены все записи лога с этим HWID для пользователя. Действие необратимо.`
          : undefined
      "
    >
      <template #body>
        <p
          v-if="filterHwid"
          class="text-sm font-mono break-all bg-elevated rounded-lg p-3"
        >
          {{ filterHwid }}
        </p>
      </template>
      <template #footer>
        <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <UButton
            color="neutral"
            variant="ghost"
            class="w-full sm:w-auto"
            :disabled="deleteByHwidLoading"
            @click="confirmDeleteHwidOpen = false"
          >
            Отмена
          </UButton>
          <UButton
            color="error"
            class="w-full sm:w-auto"
            :loading="deleteByHwidLoading"
            :disabled="!filterHwid"
            @click="deleteLogsBySelectedHwid"
          >
            Удалить
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
