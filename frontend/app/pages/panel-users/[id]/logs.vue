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
  logs: AccessLogRow[];
};

const route = useRoute();
const config = useRuntimeConfig();
const toast = useToast();

const panelUserId = computed(() => String(route.params.id ?? ''));

const loading = ref(true);
const payload = ref<LogsResponse | null>(null);
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

async function load() {
  const id = panelUserId.value;
  if (!id) {
    return;
  }
  loading.value = true;
  payload.value = null;
  try {
    payload.value = await $fetch<LogsResponse>(
      `${config.public.apiBaseUrl}/panel-users/${encodeURIComponent(id)}/subscription-access-logs?limit=300`,
    );
  } catch {
    toast.add({ title: 'Не удалось загрузить логи', color: 'error' });
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void load();
});

watch(panelUserId, () => {
  void load();
});

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
  </div>
</template>
