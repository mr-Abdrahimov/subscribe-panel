<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui';
import type { RowSelectionState } from '@tanstack/table-core';
import * as yup from 'yup';

definePageMeta({
  layout: 'dashboard'
});

const userFormSchema = yup.object({
  name: yup.string().trim().required('Введите имя').max(200, 'Не более 200 символов'),
  groupName: yup.string().required('Выберите группу')
});

type GroupItem = {
  id: string;
  name: string;
  createdAt: string;
};

type UserItem = {
  id: string;
  name: string;
  code: string;
  groupName: string;
  enabled: boolean;
  /** happ://… от crypto.happ.su, подстановка {crypto} в приложениях */
  happCryptoUrl?: string | null;
  allowAllUserAgents?: boolean;
  requireHwid?: boolean;
  requireNoHwid?: boolean;
  /** Лимит уникальных HWID (0 — не проверять) */
  maxUniqueHwids?: number;
  /** Уникальных HWID в логах GET /public/sub (из API) */
  subscriptionUniqueHwidCount?: number;
  createdAt: string;
  /** ISO-8601, последний запрос подписки из логов */
  lastSubscriptionActivityAt?: string | null;
};

const toast = useToast();
const config = useRuntimeConfig();
const loading = ref(false);
const users = ref<UserItem[]>([]);
const groups = ref<GroupItem[]>([]);

const isModalOpen = ref(false);
const editingUserId = ref<string | null>(null);
const formName = ref('');
const formCode = ref('');
const formGroupName = ref('');
const isDeleteConfirmOpen = ref(false);
const pendingDeleteUserId = ref<string | null>(null);
const isClearLogsConfirmOpen = ref(false);
const pendingClearLogsUserId = ref<string | null>(null);

const rowSelection = ref<RowSelectionState>({});
const bulkLoading = ref(false);
const bulkAssignGroupName = ref<string>('');
const bulkTransferFromGroup = ref<string>('');
const bulkTransferToGroup = ref<string>('');
const bulkMaxUniqueHwidsInput = ref<string>('0');
const isBulkClearLogsOpen = ref(false);

const selectedUsersCount = computed(
  () => Object.values(rowSelection.value).filter(Boolean).length,
);

/** Единый стиль заголовков таблицы: размер шрифта и выравнивание по центру */
const thBase = 'text-center text-xs font-semibold align-middle';

const columns: TableColumn<UserItem>[] = [
  {
    id: 'select',
    header: '',
    meta: {
      class: {
        th: 'w-12',
        td: 'w-12',
      },
    },
  },
  {
    accessorKey: 'name',
    header: 'Имя',
    meta: {
      class: {
        th: thBase,
      },
    },
  },
  {
    accessorKey: 'lastSubscriptionActivityAt',
    header: 'Последняя активность',
    meta: {
      class: {
        th: `${thBase} whitespace-nowrap`,
        td: 'text-sm whitespace-nowrap',
      },
    },
  },
  {
    accessorKey: 'code',
    header: 'Ссылка',
    meta: {
      class: {
        th: `${thBase} w-px`,
        td: 'w-px whitespace-nowrap',
      },
    },
  },
  {
    accessorKey: 'groupName',
    header: 'Группа',
    meta: {
      class: {
        th: thBase,
        td: 'text-center align-middle',
      },
    },
  },
  {
    id: 'allowAllUserAgents',
    header: 'Все приложения',
    meta: {
      class: {
        th: `${thBase} max-w-[6.5rem] whitespace-normal`,
        td: 'align-middle',
      },
    },
  },
  {
    id: 'hwidPolicy',
    header: 'HWID',
    meta: {
      class: {
        th: `${thBase} max-w-[8.5rem] whitespace-normal`,
        td: 'align-middle',
      },
    },
  },
  {
    id: 'hwidLimit',
    header: 'Уник. HWID / лимит',
    meta: {
      class: {
        th: `${thBase} max-w-[7rem] whitespace-normal`,
        td: 'align-middle',
      },
    },
  },
  {
    id: 'enabled',
    header: 'Статус',
    meta: {
      class: {
        th: thBase,
        td: 'align-middle',
      },
    },
  },
  {
    id: 'actions',
    header: '',
    meta: {
      class: {
        th: `${thBase} w-px`,
        td: 'w-px whitespace-nowrap',
      },
    },
  },
];

const groupOptions = computed(() => groups.value.map(group => group.name));

type HwidPolicy = 'require' | 'forbid' | 'any';

const HWID_POLICY_OPTIONS: {
  value: HwidPolicy;
  label: string;
  icon: string;
  tooltip: string;
}[] = [
  {
    value: 'require',
    label: 'Нужен',
    icon: 'i-lucide-fingerprint',
    tooltip: 'HWID обязателен: без него — заглушка «Нет подключений»',
  },
  {
    value: 'forbid',
    label: 'Запрет',
    icon: 'i-lucide-ban',
    tooltip: 'HWID запрещён: если передан — заглушка «Отключите HWID»',
  },
  {
    value: 'any',
    label: 'Любой',
    icon: 'i-lucide-circle-minus',
    tooltip: 'HWID не проверяется — выдаётся обычная подписка',
  },
];

function hwidPolicyFromUser(user: UserItem): HwidPolicy {
  if (user.requireNoHwid) {
    return 'forbid';
  }
  if (user.requireHwid) {
    return 'require';
  }
  return 'any';
}

async function setHwidPolicy(user: UserItem, policy: HwidPolicy) {
  if (hwidPolicyFromUser(user) === policy) {
    return;
  }
  const body =
    policy === 'require'
      ? { requireHwid: true, requireNoHwid: false }
      : policy === 'forbid'
        ? { requireHwid: false, requireNoHwid: true }
        : { requireHwid: false, requireNoHwid: false };
  try {
    await $fetch(`${config.public.apiBaseUrl}/panel-users/${user.id}`, {
      method: 'PATCH',
      body,
    });
    user.requireHwid = body.requireHwid;
    user.requireNoHwid = body.requireNoHwid;
  } catch {
    toast.add({ title: 'Не удалось сохранить политику HWID', color: 'error' });
    await loadData();
  }
}

function formatLastSubscriptionActivity(iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  try {
    return new Date(iso).toLocaleString('ru-RU', {
      dateStyle: 'short',
      timeStyle: 'short',
    });
  } catch {
    return '—';
  }
}

onMounted(async () => {
  await loadData();
});

async function loadData() {
  loading.value = true;
  try {
    const [groupsData, usersData] = await Promise.all([
      $fetch<GroupItem[]>(`${config.public.apiBaseUrl}/groups`),
      $fetch<UserItem[]>(`${config.public.apiBaseUrl}/panel-users`)
    ]);
    groups.value = groupsData;
    users.value = usersData;
  } catch {
    toast.add({ title: 'Не удалось загрузить данные пользователей', color: 'error' });
  } finally {
    loading.value = false;
  }
}

function generateCode(length = 32) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function openCreate() {
  if (groups.value.length === 0) {
    toast.add({ title: 'Сначала создайте группу', color: 'error' });
    return;
  }

  editingUserId.value = null;
  formName.value = '';
  formCode.value = generateCode(32);
  formGroupName.value = groups.value[0]?.name ?? '';
  isModalOpen.value = true;
}

function openEdit(user: UserItem) {
  if (groups.value.length === 0) {
    toast.add({ title: 'Сначала создайте группу', color: 'error' });
    return;
  }
  editingUserId.value = user.id;
  formName.value = user.name;
  formCode.value = user.code;
  formGroupName.value = user.groupName;
  isModalOpen.value = true;
}

function closeUserModal() {
  isModalOpen.value = false;
  editingUserId.value = null;
}

const modalTitle = computed(() =>
  editingUserId.value ? 'Редактировать пользователя' : 'Добавить пользователя',
);

async function submitUser() {
  const groupName =
    typeof formGroupName.value === 'string'
      ? formGroupName.value
      : String(formGroupName.value ?? '');
  try {
    await userFormSchema.validate({
      name: formName.value,
      groupName
    });
  } catch (e) {
    if (e instanceof yup.ValidationError) {
      toast.add({ title: e.message, color: 'error' });
      return;
    }
    throw e;
  }

  const name = formName.value.trim();

  try {
    if (editingUserId.value) {
      await $fetch(
        `${config.public.apiBaseUrl}/panel-users/${editingUserId.value}`,
        {
          method: 'PATCH',
          body: {
            name,
            groupName
          }
        }
      );
      toast.add({ title: 'Пользователь обновлён', color: 'success' });
    } else {
      await $fetch(`${config.public.apiBaseUrl}/panel-users`, {
        method: 'POST',
        body: {
          name,
          code: formCode.value,
          groupName
        }
      });
      toast.add({ title: 'Пользователь добавлен', color: 'success' });
    }
    closeUserModal();
    await loadData();
  } catch {
    toast.add({
      title: editingUserId.value
        ? 'Не удалось сохранить изменения'
        : 'Не удалось добавить пользователя',
      color: 'error'
    });
  }
}

function askRemoveUser(id: string) {
  pendingDeleteUserId.value = id;
  isDeleteConfirmOpen.value = true;
}

function cancelDeleteConfirm() {
  isDeleteConfirmOpen.value = false;
  pendingDeleteUserId.value = null;
}

async function confirmRemoveUser() {
  if (!pendingDeleteUserId.value) {
    return;
  }
  const id = pendingDeleteUserId.value;
  try {
    await $fetch(`${config.public.apiBaseUrl}/panel-users/${id}`, {
      method: 'DELETE'
    });
    toast.add({ title: 'Пользователь удалён', color: 'success' });
    cancelDeleteConfirm();
    await loadData();
  } catch {
    toast.add({ title: 'Не удалось удалить пользователя', color: 'error' });
  }
}

function askClearSubscriptionLogs(user: UserItem) {
  pendingClearLogsUserId.value = user.id;
  isClearLogsConfirmOpen.value = true;
}

function cancelClearLogsConfirm() {
  isClearLogsConfirmOpen.value = false;
  pendingClearLogsUserId.value = null;
}

async function confirmClearSubscriptionLogs() {
  const id = pendingClearLogsUserId.value;
  if (!id) {
    return;
  }
  try {
    await $fetch(
      `${config.public.apiBaseUrl}/panel-users/${id}/subscription-access-logs`,
      { method: 'DELETE' },
    );
    toast.add({ title: 'Логи подписки очищены', color: 'success' });
    cancelClearLogsConfirm();
    await loadData();
  } catch {
    toast.add({ title: 'Не удалось очистить логи', color: 'error' });
  }
}

watch(isModalOpen, (open) => {
  if (!open) {
    editingUserId.value = null;
  }
});

async function toggleUser(user: UserItem, value: boolean | 'indeterminate') {
  if (Boolean(value) === user.enabled) {
    return;
  }
  try {
    await $fetch(`${config.public.apiBaseUrl}/panel-users/${user.id}/toggle`, {
      method: 'PATCH'
    });
    user.enabled = Boolean(value);
  } catch {
    toast.add({ title: 'Не удалось изменить статус пользователя', color: 'error' });
    await loadData();
  }
}

async function patchAccessFlags(
  user: UserItem,
  patch: { allowAllUserAgents: boolean },
) {
  try {
    await $fetch(`${config.public.apiBaseUrl}/panel-users/${user.id}`, {
      method: 'PATCH',
      body: patch,
    });
    user.allowAllUserAgents = patch.allowAllUserAgents;
  } catch {
    toast.add({ title: 'Не удалось сохранить настройки доступа', color: 'error' });
    await loadData();
  }
}

function clampMaxUniqueHwids(n: number): number {
  if (!Number.isFinite(n) || n < 0) {
    return 0;
  }
  return Math.min(10_000, Math.floor(n));
}

async function patchMaxUniqueHwids(user: UserItem, raw: string) {
  const parsed = Number.parseInt(String(raw).trim(), 10);
  const n = clampMaxUniqueHwids(Number.isFinite(parsed) ? parsed : 0);
  if (n === (user.maxUniqueHwids ?? 0)) {
    return;
  }
  try {
    await $fetch(`${config.public.apiBaseUrl}/panel-users/${user.id}`, {
      method: 'PATCH',
      body: { maxUniqueHwids: n },
    });
    user.maxUniqueHwids = n;
  } catch {
    toast.add({ title: 'Не удалось сохранить лимит HWID', color: 'error' });
    await loadData();
  }
}

function subscriptionUrl(code: string) {
  if (!import.meta.client) {
    return '';
  }
  return `${window.location.origin}/sub/${encodeURIComponent(code)}`;
}

async function copySubscriptionLink(code: string) {
  if (!import.meta.client) {
    return;
  }
  const url = subscriptionUrl(code);
  try {
    await navigator.clipboard.writeText(url);
    toast.add({ title: 'Ссылка на подписку скопирована', color: 'success' });
  } catch {
    toast.add({ title: 'Не удалось скопировать в буфер', color: 'error' });
  }
}

function getUserRowId(row: UserItem) {
  return row.id;
}

function getSelectedUserIds(): string[] {
  return Object.entries(rowSelection.value)
    .filter(([, selected]) => selected)
    .map(([id]) => id);
}

function clearRowSelection() {
  rowSelection.value = {};
}

async function runBulkUpdate(body: Record<string, unknown>) {
  const ids = getSelectedUserIds();
  if (!ids.length) {
    toast.add({ title: 'Выберите пользователей', color: 'warning' });
    return;
  }
  bulkLoading.value = true;
  try {
    const res = await $fetch<{ updated: number; deletedLogs: number }>(
      `${config.public.apiBaseUrl}/panel-users/bulk-update`,
      { method: 'POST', body: { ids, ...body } },
    );
    const hadDataPatch =
      body.groupName !== undefined ||
      body.enabled !== undefined ||
      body.allowAllUserAgents !== undefined ||
      body.maxUniqueHwids !== undefined;
    const hadClear = body.clearSubscriptionAccessLogs === true;
    if (hadDataPatch && res.updated === 0 && !hadClear) {
      toast.add({
        title:
          'Никто из выбранных не обновлён (проверьте фильтр «из группы» или состав выбора)',
        color: 'warning',
      });
      await loadData();
      return;
    }
    const parts: string[] = [];
    if (res.updated > 0) {
      parts.push(`Обновлено записей: ${res.updated}`);
    }
    if (hadClear) {
      parts.push(
        res.deletedLogs > 0
          ? `Удалено записей логов: ${res.deletedLogs}`
          : 'Записей логов не было',
      );
    }
    toast.add({
      title: parts.length ? parts.join('. ') : 'Готово',
      color: 'success',
    });
    clearRowSelection();
    await loadData();
  } catch {
    toast.add({ title: 'Массовая операция не выполнена', color: 'error' });
  } finally {
    bulkLoading.value = false;
  }
}

async function bulkAssignGroup() {
  const name =
    typeof bulkAssignGroupName.value === 'string'
      ? bulkAssignGroupName.value.trim()
      : String(bulkAssignGroupName.value ?? '').trim();
  if (!name) {
    toast.add({ title: 'Выберите группу', color: 'warning' });
    return;
  }
  if (groups.value.length === 0) {
    toast.add({ title: 'Сначала создайте группу', color: 'error' });
    return;
  }
  await runBulkUpdate({ groupName: name });
}

async function bulkTransferFromGroupAction() {
  const from =
    typeof bulkTransferFromGroup.value === 'string'
      ? bulkTransferFromGroup.value.trim()
      : String(bulkTransferFromGroup.value ?? '').trim();
  const to =
    typeof bulkTransferToGroup.value === 'string'
      ? bulkTransferToGroup.value.trim()
      : String(bulkTransferToGroup.value ?? '').trim();
  if (!from || !to) {
    toast.add({ title: 'Укажите группу «из» и «в»', color: 'warning' });
    return;
  }
  if (from === to) {
    toast.add({ title: 'Выберите разные группы', color: 'warning' });
    return;
  }
  if (groups.value.length === 0) {
    toast.add({ title: 'Сначала создайте группу', color: 'error' });
    return;
  }
  await runBulkUpdate({
    groupName: to,
    restrictToCurrentGroupName: from,
  });
}

async function bulkSetEnabled(enabled: boolean) {
  await runBulkUpdate({ enabled });
}

async function bulkSetAllowAllUserAgents(value: boolean) {
  await runBulkUpdate({ allowAllUserAgents: value });
}

async function bulkApplyMaxUniqueHwids() {
  const parsed = Number.parseInt(String(bulkMaxUniqueHwidsInput.value).trim(), 10);
  const n = clampMaxUniqueHwids(Number.isFinite(parsed) ? parsed : 0);
  await runBulkUpdate({ maxUniqueHwids: n });
}

function askBulkClearLogs() {
  if (!getSelectedUserIds().length) {
    toast.add({ title: 'Выберите пользователей', color: 'warning' });
    return;
  }
  isBulkClearLogsOpen.value = true;
}

function cancelBulkClearLogs() {
  isBulkClearLogsOpen.value = false;
}

async function confirmBulkClearLogs() {
  const ids = getSelectedUserIds();
  if (!ids.length) {
    cancelBulkClearLogs();
    return;
  }
  isBulkClearLogsOpen.value = false;
  await runBulkUpdate({ clearSubscriptionAccessLogs: true });
}
</script>

<template>
  <div class="cosmic-app space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="cosmic-h2">
        Пользователи
      </h2>

      <UButton icon="i-lucide-plus" @click="openCreate">
        Добавить
      </UButton>
    </div>

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <div
        v-if="selectedUsersCount > 0"
        class="flex flex-col gap-4 border-b border-default p-4"
      >
        <p class="text-sm text-muted">
          Выбрано пользователей:
          <span class="font-medium text-highlighted">{{ selectedUsersCount }}</span>
        </p>

        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div class="space-y-2 rounded-lg border border-default/60 bg-elevated/30 p-3">
            <p class="text-xs font-semibold text-highlighted">
              Группа
            </p>
            <UFormField label="Назначить всем выбранным">
              <USelectMenu
                v-model="bulkAssignGroupName"
                :items="groupOptions"
                placeholder="Группа"
                class="w-full"
              />
            </UFormField>
            <UButton
              size="sm"
              class="w-full sm:w-auto"
              :loading="bulkLoading"
              :disabled="!bulkAssignGroupName"
              @click="bulkAssignGroup"
            >
              Назначить группу
            </UButton>
            <UFormField
              label="Перенести из группы"
              description="Только выбранные, у кого сейчас эта группа"
            >
              <USelectMenu
                v-model="bulkTransferFromGroup"
                :items="groupOptions"
                placeholder="Из группы"
                class="w-full"
              />
            </UFormField>
            <UFormField label="В группу">
              <USelectMenu
                v-model="bulkTransferToGroup"
                :items="groupOptions"
                placeholder="В группу"
                class="w-full"
              />
            </UFormField>
            <UButton
              size="sm"
              color="neutral"
              variant="soft"
              class="w-full sm:w-auto"
              :loading="bulkLoading"
              :disabled="!bulkTransferFromGroup || !bulkTransferToGroup"
              @click="bulkTransferFromGroupAction"
            >
              Перенести (исключить из одной группы)
            </UButton>
          </div>

          <div class="space-y-2 rounded-lg border border-default/60 bg-elevated/30 p-3">
            <p class="text-xs font-semibold text-highlighted">
              Статус и доступ
            </p>
            <div class="flex flex-wrap gap-2">
              <UButton
                size="sm"
                :loading="bulkLoading"
                @click="bulkSetEnabled(true)"
              >
                Включить
              </UButton>
              <UButton
                size="sm"
                color="neutral"
                variant="soft"
                :loading="bulkLoading"
                @click="bulkSetEnabled(false)"
              >
                Отключить
              </UButton>
            </div>
            <p class="text-xs text-muted pt-1">
              Все приложения (User-Agent)
            </p>
            <div class="flex flex-wrap gap-2">
              <UButton
                size="sm"
                :loading="bulkLoading"
                @click="bulkSetAllowAllUserAgents(true)"
              >
                Включить
              </UButton>
              <UButton
                size="sm"
                color="neutral"
                variant="soft"
                :loading="bulkLoading"
                @click="bulkSetAllowAllUserAgents(false)"
              >
                Выключить
              </UButton>
            </div>
          </div>

          <div class="space-y-2 rounded-lg border border-default/60 bg-elevated/30 p-3 sm:col-span-2 lg:col-span-1">
            <p class="text-xs font-semibold text-highlighted">
              Лимит уникальных HWID
            </p>
            <div class="flex flex-wrap items-end gap-2">
              <UFormField label="Значение для всех выбранных" class="min-w-[8rem] flex-1">
                <UInput
                  v-model="bulkMaxUniqueHwidsInput"
                  type="number"
                  min="0"
                  max="10000"
                  class="w-full"
                />
              </UFormField>
              <UButton
                size="sm"
                :loading="bulkLoading"
                @click="bulkApplyMaxUniqueHwids"
              >
                Применить лимит
              </UButton>
            </div>
            <UButton
              size="sm"
              color="warning"
              variant="soft"
              :loading="bulkLoading"
              @click="askBulkClearLogs"
            >
              Очистить логи HWID
            </UButton>
            <UButton
              size="sm"
              color="neutral"
              variant="ghost"
              :disabled="bulkLoading"
              @click="clearRowSelection"
            >
              Снять выбор
            </UButton>
          </div>
        </div>
      </div>

      <UTable
        v-model:row-selection="rowSelection"
        :data="users"
        :columns="columns"
        :loading="loading"
        :get-row-id="getUserRowId"
        empty="Пользователей пока нет"
        class="w-full"
      >
        <template #select-header="{ table }">
          <div class="flex justify-center" @click.stop>
            <UCheckbox
              :model-value="
                table.getIsAllPageRowsSelected()
                  ? true
                  : table.getIsSomePageRowsSelected()
                    ? 'indeterminate'
                    : false
              "
              @update:model-value="(value) => table.toggleAllPageRowsSelected(!!value)"
            />
          </div>
        </template>

        <template #select-cell="{ row }">
          <div class="flex justify-center" @click.stop>
            <UCheckbox
              :model-value="row.getIsSelected()"
              @update:model-value="(value) => row.toggleSelected(!!value)"
            />
          </div>
        </template>

        <template #lastSubscriptionActivityAt-cell="{ row }">
          <span
            class="text-muted tabular-nums"
            :title="row.original.lastSubscriptionActivityAt ?? undefined"
          >{{ formatLastSubscriptionActivity(row.original.lastSubscriptionActivityAt) }}</span>
        </template>

        <template #code-cell="{ row }">
          <div class="flex items-center justify-center">
            <UTooltip text="Скопировать ссылку на подписку">
              <UButton
                color="primary"
                variant="soft"
                size="xs"
                class="shrink-0 rounded-lg p-1.5 min-w-8 min-h-8"
                icon="i-lucide-link-2"
                aria-label="Скопировать ссылку на подписку"
                @click="copySubscriptionLink(row.original.code)"
              />
            </UTooltip>
          </div>
        </template>

        <template #allowAllUserAgents-cell="{ row }">
          <UTooltip
            text="Подписка по ссылке /sub/… для любого User-Agent. Иначе только клиенты с User-Agent, начинающимся с «Happ»"
          >
            <div class="flex justify-center">
              <USwitch
                :model-value="Boolean(row.original.allowAllUserAgents)"
                @update:model-value="
                  patchAccessFlags(row.original, { allowAllUserAgents: Boolean($event) })
                "
              />
            </div>
          </UTooltip>
        </template>

        <template #hwidPolicy-cell="{ row }">
          <div
            class="flex justify-center"
            role="radiogroup"
            :aria-label="'Политика HWID для ' + row.original.name"
          >
            <div
              class="inline-flex flex-row items-stretch gap-0.5 rounded-lg border border-default bg-elevated/50 p-0.5"
            >
              <UTooltip
                v-for="opt in HWID_POLICY_OPTIONS"
                :key="opt.value"
                :text="opt.tooltip"
              >
                <UButton
                  size="xs"
                  :icon="opt.icon"
                  :variant="
                    hwidPolicyFromUser(row.original) === opt.value ? 'solid' : 'ghost'
                  "
                  :color="
                    hwidPolicyFromUser(row.original) === opt.value ? 'primary' : 'neutral'
                  "
                  class="min-w-8 min-h-8 justify-center rounded-md sm:min-w-9"
                  :aria-label="opt.label"
                  :aria-checked="hwidPolicyFromUser(row.original) === opt.value"
                  role="radio"
                  @click="setHwidPolicy(row.original, opt.value)"
                />
              </UTooltip>
            </div>
          </div>
        </template>

        <template #hwidLimit-cell="{ row }">
          <UTooltip
            text="Слева — уникальные HWID в логах подписки. Справа — лимит: при превышении клиент получит «Превышен лимит HWID» (не действует в режиме «Запрет HWID»). 0 — без лимита."
          >
            <div
              class="flex flex-wrap items-center justify-center gap-x-1 gap-y-0.5 text-sm tabular-nums"
            >
              <span class="min-w-[1.25rem] text-center">{{
                row.original.subscriptionUniqueHwidCount ?? 0
              }}</span>
              <span class="text-muted">/</span>
              <UInput
                :key="`hwid-max-${row.original.id}-${row.original.maxUniqueHwids ?? 0}`"
                :default-value="row.original.maxUniqueHwids ?? 0"
                type="number"
                min="0"
                max="10000"
                size="xs"
                class="w-14 shrink-0"
                @blur="
                  patchMaxUniqueHwids(
                    row.original,
                    ($event.target as HTMLInputElement).value,
                  )
                "
              />
            </div>
          </UTooltip>
        </template>

        <template #enabled-cell="{ row }">
          <div class="flex justify-center">
            <USwitch
              :model-value="row.original.enabled"
              @update:model-value="toggleUser(row.original, $event)"
            />
          </div>
        </template>

        <template #actions-cell="{ row }">
          <div class="inline-flex items-center gap-0.5 sm:gap-1">
            <UTooltip text="Логи обращений к подписке">
              <UButton
                :to="`/panel-users/${row.original.id}/logs`"
                color="neutral"
                variant="ghost"
                size="xs"
                icon="i-lucide-scroll-text"
                class="rounded-lg p-1.5 min-w-8 min-h-8"
                aria-label="Логи подписки"
              />
            </UTooltip>
            <UTooltip text="Очистить логи подписки (список HWID)">
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                icon="i-lucide-eraser"
                class="rounded-lg p-1.5 min-w-8 min-h-8"
                aria-label="Очистить логи HWID"
                @click="askClearSubscriptionLogs(row.original)"
              />
            </UTooltip>
            <UTooltip text="Редактировать">
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                icon="i-lucide-pencil"
                class="rounded-lg p-1.5 min-w-8 min-h-8"
                aria-label="Редактировать"
                @click="openEdit(row.original)"
              />
            </UTooltip>
            <UTooltip text="Удалить">
              <UButton
                color="error"
                variant="ghost"
                size="xs"
                icon="i-lucide-trash-2"
                class="rounded-lg p-1.5 min-w-8 min-h-8"
                aria-label="Удалить"
                @click="askRemoveUser(row.original.id)"
              />
            </UTooltip>
          </div>
        </template>
      </UTable>
    </UCard>

    <UModal v-model:open="isModalOpen" :title="modalTitle">
      <template #body>
        <div class="space-y-3">
          <UFormField label="Имя" required>
            <UInput v-model="formName" class="w-full" placeholder="Введите имя пользователя" />
          </UFormField>

          <UFormField
            label="Код подписки"
            :description="editingUserId ? 'Код в ссылке /sub/… не меняется' : undefined"
          >
            <UInput v-model="formCode" class="w-full" readonly />
          </UFormField>

          <UFormField label="Группа" required>
            <USelectMenu
              v-model="formGroupName"
              :items="groupOptions"
              placeholder="Выберите группу"
              class="w-full"
            />
          </UFormField>
        </div>
      </template>

      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton color="neutral" variant="ghost" @click="closeUserModal">
            Отмена
          </UButton>
          <UButton @click="submitUser">
            Сохранить
          </UButton>
        </div>
      </template>
    </UModal>

    <UModal v-model:open="isDeleteConfirmOpen" title="Удалить пользователя?">
      <template #body>
        <p class="text-sm text-muted">
          Ссылка на подписку перестанет работать. Действие необратимо.
        </p>
      </template>
      <template #footer>
        <div class="flex flex-wrap justify-end gap-2 w-full">
          <UButton color="neutral" variant="ghost" @click="cancelDeleteConfirm">
            Отмена
          </UButton>
          <UButton color="error" @click="confirmRemoveUser">
            Удалить
          </UButton>
        </div>
      </template>
    </UModal>

    <UModal v-model:open="isClearLogsConfirmOpen" title="Очистить логи подписки?">
      <template #body>
        <p class="text-sm text-muted">
          Будут удалены все записи обращений к base64-подписке (HWID, IP, User-Agent). Счётчик
          уникальных HWID обнулится.
        </p>
      </template>
      <template #footer>
        <div class="flex flex-wrap justify-end gap-2 w-full">
          <UButton color="neutral" variant="ghost" @click="cancelClearLogsConfirm">
            Отмена
          </UButton>
          <UButton color="warning" @click="confirmClearSubscriptionLogs">
            Очистить
          </UButton>
        </div>
      </template>
    </UModal>

    <UModal v-model:open="isBulkClearLogsOpen" title="Очистить логи у выбранных пользователей?">
      <template #body>
        <p class="text-sm text-muted">
          Для
          <span class="font-medium text-highlighted">{{ selectedUsersCount }}</span>
          выбранных пользователей будут удалены все записи логов подписки (HWID, IP, User-Agent).
          Счётчики уникальных HWID обнулятся после обновления списка.
        </p>
      </template>
      <template #footer>
        <div class="flex flex-wrap justify-end gap-2 w-full">
          <UButton color="neutral" variant="ghost" @click="cancelBulkClearLogs">
            Отмена
          </UButton>
          <UButton color="warning" :loading="bulkLoading" @click="confirmBulkClearLogs">
            Очистить у всех выбранных
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
