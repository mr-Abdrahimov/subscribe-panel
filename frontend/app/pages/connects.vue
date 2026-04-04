<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui';
import type { RowSelectionState } from '@tanstack/table-core';
import {
  useSortable,
  moveArrayElement,
} from '@vueuse/integrations/useSortable';

definePageMeta({
  layout: 'dashboard'
});

/** Как на бэкенде: служебная группа для коннектов без явных тегов */
const UNGROUPED_CONNECT_GROUP_NAME = 'Без группы';

function isUngroupedGroupLabel(name: string): boolean {
  return name === UNGROUPED_CONNECT_GROUP_NAME;
}

type ConnectRow = {
  id: string;
  originalName: string;
  name: string;
  groupNames: string[];
  status: 'ACTIVE' | 'INACTIVE';
  protocol: string;
  createdAt: string;
  hidden: boolean;
  tags: string[];
  sortOrder: number;
  subscription: {
    id: string;
    title: string;
  };
};

type GroupItem = {
  id: string;
  name: string;
  createdAt: string;
  subscriptionDisplayName?: string | null;
};

const config = useRuntimeConfig();
const toast = useToast();
const loading = ref(false);
const connects = ref<ConnectRow[]>([]);
const groups = ref<GroupItem[]>([]);

const isTagModalOpen = ref(false);
const tagValue = ref('');
const selectedConnectId = ref<string | null>(null);
const isGroupModalOpen = ref(false);
const selectedGroupConnectId = ref<string | null>(null);
const selectedGroupNames = ref<string[]>([]);
const isNameModalOpen = ref(false);
const selectedNameConnectId = ref<string | null>(null);
const editNameValue = ref('');
const isDeleteConfirmOpen = ref(false);
const deleteConnectId = ref<string | null>(null);

const rowSelection = ref<RowSelectionState>({});
const bulkGroupNames = ref<string[]>([]);
const bulkLoading = ref(false);

/** null — все подписки */
const filterSubscriptionId = ref<string | null>(null);
const filterStatus = ref<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
/** null — любая группа (фильтр не задан) */
const filterGroupName = ref<string | null>(null);

const statusFilterItems = [
  { label: 'Любой', id: 'ALL' as const },
  { label: 'Включён', id: 'ACTIVE' as const },
  { label: 'Отключён', id: 'INACTIVE' as const },
];

const subscriptionFilterItems = computed(() => {
  const map = new Map<string, string>();
  for (const c of connects.value) {
    map.set(c.subscription.id, c.subscription.title);
  }
  const rest = [...map.entries()]
    .sort((a, b) => a[1].localeCompare(b[1], 'ru'))
    .map(([id, title]) => ({ label: title, id }));
  return [{ label: 'Все подписки', id: null }, ...rest];
});

const groupFilterItems = computed(() => {
  const rest = groups.value
    .map((g) => ({ label: g.name, id: g.name }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ru'));
  return [{ label: 'Любая группа', id: null }, ...rest];
});

const filtersActive = computed(
  () =>
    filterSubscriptionId.value != null ||
    filterStatus.value !== 'ALL' ||
    filterGroupName.value != null
);

const filteredConnects = computed(() => {
  let list = connects.value;
  if (filterSubscriptionId.value != null) {
    list = list.filter((c) => c.subscription.id === filterSubscriptionId.value);
  }
  if (filterStatus.value !== 'ALL') {
    list = list.filter((c) => c.status === filterStatus.value);
  }
  if (filterGroupName.value != null) {
    const g = filterGroupName.value;
    list = list.filter((c) => c.groupNames.includes(g));
  }
  return list;
});

const tableEmptyText = computed(() => {
  if (connects.value.length === 0) {
    return 'Коннектов пока нет';
  }
  if (filteredConnects.value.length === 0) {
    return 'Нет коннектов по выбранным фильтрам';
  }
  return 'Коннектов пока нет';
});

const selectedConnectsCount = computed(
  () => Object.values(rowSelection.value).filter(Boolean).length
);

const sortableList = useSortable('.connects-table-tbody', connects, {
  handle: '.connect-drag-handle',
  animation: 150,
  onUpdate: async (e) => {
    moveArrayElement(connects, e.oldIndex!, e.newIndex!, e);
    await nextTick();
    await syncOrder();
  },
});

function setSortableDisabled(active: boolean) {
  try {
    sortableList.option('disabled', active);
  } catch {
    /* sortable ещё не инициализирован */
  }
}

watch(filtersActive, (active) => {
  nextTick(() => setSortableDisabled(active));
});

onMounted(() => {
  loadConnects();
  loadGroups();
  nextTick(() => {
    nextTick(() => setSortableDisabled(filtersActive.value));
  });
});

async function loadConnects() {
  loading.value = true;
  try {
    connects.value = await $fetch<ConnectRow[]>(`${config.public.apiBaseUrl}/connects`);
  } catch {
    toast.add({ title: 'Не удалось загрузить коннекты', color: 'error' });
  } finally {
    loading.value = false;
  }
}

async function toggleStatus(id: string) {
  try {
    await $fetch(`${config.public.apiBaseUrl}/connects/${id}/toggle-status`, {
      method: 'PATCH',
    });
    toast.add({ title: 'Статус изменен', color: 'success' });
    await loadConnects();
  } catch {
    toast.add({ title: 'Не удалось изменить статус', color: 'error' });
  }
}

async function removeConnect(id: string) {
  try {
    await $fetch(`${config.public.apiBaseUrl}/connects/${id}`, {
      method: 'DELETE',
    });
    toast.add({ title: 'Коннект удален', color: 'success' });
    await loadConnects();
  } catch {
    toast.add({ title: 'Не удалось удалить коннект', color: 'error' });
  }
}

function askRemoveConnect(id: string) {
  deleteConnectId.value = id;
  isDeleteConfirmOpen.value = true;
}

async function confirmRemoveConnect() {
  if (!deleteConnectId.value) {
    return;
  }
  await removeConnect(deleteConnectId.value);
  isDeleteConfirmOpen.value = false;
  deleteConnectId.value = null;
}

function openAddTag(id: string) {
  selectedConnectId.value = id;
  tagValue.value = '';
  isTagModalOpen.value = true;
}

async function submitTag() {
  const tag = tagValue.value.trim();
  if (!selectedConnectId.value || !tag) {
    toast.add({ title: 'Введите тэг', color: 'error' });
    return;
  }

  try {
    await $fetch(`${config.public.apiBaseUrl}/connects/${selectedConnectId.value}/tags`, {
      method: 'POST',
      body: { tag },
    });
    toast.add({ title: 'Тэг добавлен', color: 'success' });
    isTagModalOpen.value = false;
    await loadConnects();
  } catch {
    toast.add({ title: 'Не удалось добавить тэг', color: 'error' });
  }
}

async function loadGroups() {
  try {
    groups.value = await $fetch<GroupItem[]>(`${config.public.apiBaseUrl}/groups`);
  } catch {
    toast.add({ title: 'Не удалось загрузить группы', color: 'error' });
  }
}

function getConnectGroups(id: string) {
  return connects.value.find(item => item.id === id)?.groupNames ?? [];
}

function openBindGroups(id: string) {
  if (groups.value.length === 0) {
    toast.add({ title: 'Сначала создайте группы', color: 'error' });
    return;
  }
  selectedGroupConnectId.value = id;
  selectedGroupNames.value = [...getConnectGroups(id)];
  isGroupModalOpen.value = true;
}

function openEditName(connect: ConnectRow) {
  selectedNameConnectId.value = connect.id;
  editNameValue.value = connect.name;
  isNameModalOpen.value = true;
}

async function saveConnectName() {
  const name = editNameValue.value.trim();
  if (!selectedNameConnectId.value || !name) {
    toast.add({ title: 'Введите название', color: 'error' });
    return;
  }

  try {
    await $fetch(`${config.public.apiBaseUrl}/connects/${selectedNameConnectId.value}/name`, {
      method: 'PATCH',
      body: { name },
    });
    toast.add({ title: 'Название обновлено', color: 'success' });
    isNameModalOpen.value = false;
    await loadConnects();
  } catch {
    toast.add({ title: 'Не удалось обновить название', color: 'error' });
  }
}

async function saveConnectGroups() {
  if (!selectedGroupConnectId.value) {
    return;
  }
  try {
    await $fetch(`${config.public.apiBaseUrl}/connects/${selectedGroupConnectId.value}/groups`, {
      method: 'PATCH',
      body: {
        groupNames: selectedGroupNames.value
      }
    });
    isGroupModalOpen.value = false;
    toast.add({ title: 'Группы для коннекта обновлены', color: 'success' });
    await loadConnects();
  } catch {
    toast.add({ title: 'Не удалось обновить группы коннекта', color: 'error' });
  }
}

function getSelectedConnectIds(): string[] {
  return Object.entries(rowSelection.value)
    .filter(([, selected]) => selected)
    .map(([id]) => id);
}

function clearRowSelection() {
  rowSelection.value = {};
}

async function bulkAddGroupsToSelection() {
  const ids = getSelectedConnectIds();
  const toAdd = bulkGroupNames.value.filter(Boolean);
  if (!ids.length) {
    return;
  }
  if (!toAdd.length) {
    toast.add({ title: 'Выберите группы', color: 'warning' });
    return;
  }
  if (groups.value.length === 0) {
    toast.add({ title: 'Сначала создайте группы', color: 'error' });
    return;
  }

  const snapshots = new Map(ids.map((id) => [id, [...getConnectGroups(id)]] as const));
  bulkLoading.value = true;
  try {
    await Promise.all(
      ids.map(async (id) => {
        const current = snapshots.get(id)!;
        const next = [...new Set([...current, ...toAdd])];
        await $fetch(`${config.public.apiBaseUrl}/connects/${id}/groups`, {
          method: 'PATCH',
          body: { groupNames: next }
        });
      })
    );
    toast.add({ title: 'Группы добавлены к выбранным коннектам', color: 'success' });
    bulkGroupNames.value = [];
    clearRowSelection();
    await loadConnects();
  } catch {
    toast.add({ title: 'Не удалось добавить группы', color: 'error' });
  } finally {
    bulkLoading.value = false;
  }
}

async function bulkRemoveGroupsFromSelection() {
  const ids = getSelectedConnectIds();
  const toRemove = new Set(bulkGroupNames.value.filter(Boolean));
  if (!ids.length) {
    return;
  }
  if (!toRemove.size) {
    toast.add({ title: 'Выберите группы для удаления', color: 'warning' });
    return;
  }

  const snapshots = new Map(ids.map((id) => [id, [...getConnectGroups(id)]] as const));
  bulkLoading.value = true;
  try {
    await Promise.all(
      ids.map(async (id) => {
        const current = snapshots.get(id)!;
        const next = current.filter((g) => !toRemove.has(g));
        await $fetch(`${config.public.apiBaseUrl}/connects/${id}/groups`, {
          method: 'PATCH',
          body: { groupNames: next }
        });
      })
    );
    toast.add({ title: 'Группы убраны у выбранных коннектов', color: 'success' });
    bulkGroupNames.value = [];
    clearRowSelection();
    await loadConnects();
  } catch {
    toast.add({ title: 'Не удалось убрать группы', color: 'error' });
  } finally {
    bulkLoading.value = false;
  }
}

function getConnectRowId(row: ConnectRow) {
  return row.id
}

async function syncOrder() {
  try {
    await $fetch(`${config.public.apiBaseUrl}/connects/reorder`, {
      method: 'PATCH',
      body: { ids: connects.value.map((item) => item.id) },
    });
    toast.add({ title: 'Порядок обновлен', color: 'success' });
  } catch {
    toast.add({ title: 'Не удалось сохранить порядок', color: 'error' });
    await loadConnects();
  }
}

const columns: TableColumn<ConnectRow>[] = [
  {
    id: 'drag',
    header: '',
    meta: {
      class: {
        th: 'w-10',
        td: 'w-10'
      }
    }
  },
  {
    id: 'select',
    header: '',
    meta: {
      class: {
        th: 'w-12',
        td: 'w-12'
      }
    }
  },
  {
    accessorKey: 'subscription',
    header: 'Подписка'
  },
  {
    accessorKey: 'originalName',
    header: 'Оригинальное название'
  },
  {
    accessorKey: 'name',
    header: 'Название'
  },
  {
    id: 'status',
    header: 'Статус'
  },
  {
    accessorKey: 'protocol',
    header: 'Протокол'
  },
  {
    id: 'groups',
    header: 'Группы'
  },
  {
    accessorKey: 'createdAt',
    header: 'Дата добавления'
  },
  {
    id: 'actions',
    header: 'Действия'
  }
];
</script>

<template>
  <div class="cosmic-app space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="cosmic-h2">
        Коннекты
      </h2>
      <UButton
        color="neutral"
        variant="soft"
        icon="i-lucide-refresh-cw"
        :loading="loading"
        @click="loadConnects"
      >
        Обновить
      </UButton>
    </div>

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <div class="space-y-3 border-b border-default p-4">
        <p class="text-xs font-semibold text-highlighted">
          Фильтры
        </p>
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <UFormField label="Подписка">
            <USelectMenu
              v-model="filterSubscriptionId"
              :items="subscriptionFilterItems"
              value-key="id"
              label-key="label"
              placeholder="Все подписки"
              class="w-full"
              clear
            />
          </UFormField>
          <UFormField label="Статус">
            <USelectMenu
              v-model="filterStatus"
              :items="statusFilterItems"
              value-key="id"
              label-key="label"
              placeholder="Любой"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Группа">
            <USelectMenu
              v-model="filterGroupName"
              :items="groupFilterItems"
              value-key="id"
              label-key="label"
              placeholder="Любая группа"
              class="w-full"
              clear
            />
          </UFormField>
        </div>
        <p v-if="filtersActive" class="text-xs text-muted">
          Порядок коннектов перетаскиванием отключён, пока включены фильтры.
        </p>
      </div>

      <div
        v-if="selectedConnectsCount > 0"
        class="flex flex-col gap-3 border-b border-default p-4 sm:flex-row sm:flex-wrap sm:items-end"
      >
        <p class="text-sm text-muted sm:mr-auto">
          Выбрано коннектов: <span class="font-medium text-highlighted">{{ selectedConnectsCount }}</span>
        </p>
        <UFormField label="Группы" class="w-full min-w-0 sm:max-w-md sm:flex-1">
          <USelectMenu
            v-model="bulkGroupNames"
            :items="groups.map((group) => group.name)"
            multiple
            class="w-full"
            placeholder="Выберите группы"
          />
        </UFormField>
        <div class="flex flex-wrap gap-2">
          <UButton
            size="sm"
            :loading="bulkLoading"
            :disabled="!bulkGroupNames.length"
            @click="bulkAddGroupsToSelection"
          >
            Добавить группы
          </UButton>
          <UButton
            size="sm"
            color="neutral"
            variant="soft"
            :loading="bulkLoading"
            :disabled="!bulkGroupNames.length"
            @click="bulkRemoveGroupsFromSelection"
          >
            Убрать группы
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

      <UTable
        v-model:row-selection="rowSelection"
        :data="filteredConnects"
        :columns="columns"
        :loading="loading"
        :get-row-id="getConnectRowId"
        :empty="tableEmptyText"
        :ui="{ tbody: 'connects-table-tbody' }"
        class="w-full"
      >
        <template #drag-cell>
          <div
            class="connect-drag-handle inline-flex text-muted"
            :class="
              filtersActive
                ? 'cursor-not-allowed opacity-40'
                : 'cursor-grab active:cursor-grabbing'
            "
          >
            <UIcon name="i-lucide-grip-vertical" class="size-4" />
          </div>
        </template>

        <template #select-header="{ table }">
          <div class="flex justify-center" @click.stop>
            <UCheckbox
              :model-value="table.getIsAllPageRowsSelected() ? true : table.getIsSomePageRowsSelected() ? 'indeterminate' : false"
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

        <template #subscription-cell="{ row }">
          {{ row.original.subscription.title }}
        </template>

        <template #name-cell="{ row }">
          <UButton
            size="xs"
            color="neutral"
            variant="ghost"
            class="px-0"
            @click="openEditName(row.original)"
          >
            {{ row.original.name }}
          </UButton>
        </template>

        <template #status-cell="{ row }">
          <UTooltip :text="row.original.status === 'ACTIVE' ? 'Отключить коннект' : 'Включить коннект'">
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              :icon="row.original.status === 'ACTIVE' ? 'i-lucide-eye' : 'i-lucide-eye-off'"
              @click="toggleStatus(row.original.id)"
            />
          </UTooltip>
        </template>

        <template #protocol-cell="{ row }">
          {{ row.original.protocol.toUpperCase() }}
        </template>

        <template #groups-cell="{ row }">
          <div class="flex flex-wrap gap-1.5 items-center">
            <UBadge
              v-for="group in getConnectGroups(row.original.id)"
              :key="`${row.original.id}-${group}`"
              :color="isUngroupedGroupLabel(group) ? 'warning' : 'neutral'"
              :variant="isUngroupedGroupLabel(group) ? 'solid' : 'subtle'"
              size="sm"
              :class="
                isUngroupedGroupLabel(group)
                  ? 'connects-ungrouped-badge font-semibold tracking-wide'
                  : ''
              "
            >
              {{ group }}
            </UBadge>
            <span v-if="getConnectGroups(row.original.id).length === 0" class="text-xs text-muted">Не привязан</span>
          </div>
        </template>

        <template #createdAt-cell="{ row }">
          <span class="whitespace-nowrap">
            {{ new Date(row.original.createdAt).toLocaleString('ru-RU') }}
          </span>
        </template>

        <template #actions-cell="{ row }">
          <div class="flex flex-wrap items-center gap-2">
            <UTooltip text="Добавить тэг">
              <UButton size="xs" color="primary" variant="ghost" icon="i-lucide-tag" @click="openAddTag(row.original.id)" />
            </UTooltip>
            <UTooltip text="Привязать к группам">
              <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-users-round" @click="openBindGroups(row.original.id)" />
            </UTooltip>
            <UTooltip text="Удалить коннект">
              <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash" @click="askRemoveConnect(row.original.id)" />
            </UTooltip>
          </div>
        </template>
      </UTable>
    </UCard>

    <UModal v-model:open="isTagModalOpen" title="Добавить тэг">
      <template #body>
        <UFormField label="Тэг" required>
          <UInput v-model="tagValue" class="w-full" placeholder="Например: work" />
        </UFormField>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton color="neutral" variant="ghost" @click="isTagModalOpen = false">
            Отмена
          </UButton>
          <UButton @click="submitTag">
            Сохранить
          </UButton>
        </div>
      </template>
    </UModal>

    <UModal v-model:open="isGroupModalOpen" title="Привязать коннект к группам">
      <template #body>
        <UFormField label="Группы">
          <USelectMenu
            v-model="selectedGroupNames"
            :items="groups.map(group => group.name)"
            multiple
            class="w-full"
            placeholder="Выберите группы"
          />
        </UFormField>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton color="neutral" variant="ghost" @click="isGroupModalOpen = false">
            Отмена
          </UButton>
          <UButton @click="saveConnectGroups">
            Сохранить
          </UButton>
        </div>
      </template>
    </UModal>

    <UModal v-model:open="isNameModalOpen" title="Редактировать название">
      <template #body>
        <UFormField label="Кастомное название" required>
          <UInput v-model="editNameValue" class="w-full" placeholder="Введите название" />
        </UFormField>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton color="neutral" variant="ghost" @click="isNameModalOpen = false">
            Отмена
          </UButton>
          <UButton @click="saveConnectName">
            Сохранить
          </UButton>
        </div>
      </template>
    </UModal>

    <UModal v-model:open="isDeleteConfirmOpen" title="Подтверждение удаления">
      <template #body>
        <p>Вы действительно хотите удалить этот коннект?</p>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton color="neutral" variant="ghost" @click="isDeleteConfirmOpen = false">
            Отмена
          </UButton>
          <UButton color="error" @click="confirmRemoveConnect">
            Да, удалить
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>

<style scoped>
/* «Без группы» — явный акцент в таблице коннектов */
.connects-ungrouped-badge {
  box-shadow:
    0 0 0 2px rgba(251, 191, 36, 0.65),
    0 0 18px rgba(245, 158, 11, 0.45);
}

@media (prefers-reduced-motion: no-preference) {
  .connects-ungrouped-badge {
    animation: connects-ungrouped-glow 2.4s ease-in-out infinite;
  }
}

@keyframes connects-ungrouped-glow {
  0%,
  100% {
    box-shadow:
      0 0 0 2px rgba(251, 191, 36, 0.55),
      0 0 14px rgba(245, 158, 11, 0.35);
  }
  50% {
    box-shadow:
      0 0 0 2px rgba(253, 224, 71, 0.85),
      0 0 22px rgba(251, 191, 36, 0.55);
  }
}
</style>
