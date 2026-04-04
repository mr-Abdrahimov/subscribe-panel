<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui';
import {
  useSortable,
  moveArrayElement,
} from '@vueuse/integrations/useSortable';
import * as yup from 'yup';

definePageMeta({
  layout: 'dashboard'
});

/** Совпадает с backend: служебная группа для коннектов из подписки без тегов */
const UNGROUPED_CONNECT_GROUP_NAME = 'Без группы';

type GroupItem = {
  id: string;
  name: string;
  sortOrder: number;
  createdAt: string;
  /** Главная: у коннекта не более одной такой группы */
  isMainGroup?: boolean;
  subscriptionDisplayName?: string | null;
  subscriptionAnnounce?: string | null;
  profileUpdateInterval?: number | null;
  /** Активные коннекты, у которых в тегах есть эта группа */
  activeConnectCount: number;
  /** Пользователи панели, у которых группа есть в groupNames */
  panelUserCount: number;
};

type PanelGlobalSettingsResponse = {
  subscriptionAnnounce: string | null;
  profileUpdateInterval: number | null;
};

const announceSchema = yup.string().max(200, 'Не более 200 символов (лимит Happ для объявления)');

const intervalHoursSchema = yup
  .number()
  .integer('Укажите целое число часов')
  .min(1, 'Не менее 1 часа')
  .max(8760, 'Не более 8760 ч (~год)');

const groupNameSchema = yup
  .string()
  .trim()
  .required('Укажите название')
  .max(200, 'Не более 200 символов')
  .notOneOf(
    [UNGROUPED_CONNECT_GROUP_NAME],
    'Имя «Без группы» зарезервировано — группа создаётся автоматически',
  );

const titleFieldSchema = yup.string().max(200, 'Не более 200 символов');

const toast = useToast();
const config = useRuntimeConfig();

const groups = ref<GroupItem[]>([]);
const loading = ref(false);

const isCreateOpen = ref(false);
const isEditOpen = ref(false);
const editing = ref<GroupItem | null>(null);

const createForm = ref({
  name: '',
  isMainGroup: false,
  subscriptionDisplayName: '',
  subscriptionAnnounce: '',
  profileUpdateInterval: ''
});

const editForm = ref({
  name: '',
  isMainGroup: false,
  subscriptionDisplayName: '',
  subscriptionAnnounce: '',
  profileUpdateInterval: ''
});

const createSaving = ref(false);
const editSaving = ref(false);
const togglingMainGroupId = ref<string | null>(null);

const defaultAnnounceDraft = ref('');
const defaultIntervalDraft = ref('');
const defaultLoading = ref(false);
const defaultAnnounceSaving = ref(false);
const defaultIntervalSaving = ref(false);

const columns: TableColumn<GroupItem>[] = [
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
  { accessorKey: 'name', header: 'Название' },
  {
    id: 'isMainGroup',
    header: 'Главная',
    meta: {
      class: {
        th: 'text-center w-28',
        td: 'text-center'
      }
    }
  },
  {
    id: 'activeConnectCount',
    header: 'Коннекты',
    meta: {
      class: {
        th: 'text-center w-24',
        td: 'text-center tabular-nums'
      }
    }
  },
  {
    id: 'panelUserCount',
    header: 'Пользователи',
    meta: {
      class: {
        th: 'text-center w-28',
        td: 'text-center tabular-nums'
      }
    }
  },
  { accessorKey: 'createdAt', header: 'Дата добавления' },
  { id: 'actions', header: 'Действия' }
];

useSortable('.groups-table-tbody', groups, {
  handle: '.group-drag-handle',
  animation: 150,
  onUpdate: async (e) => {
    moveArrayElement(groups, e.oldIndex!, e.newIndex!, e);
    await nextTick();
    await syncGroupsOrder();
  }
});

onMounted(async () => {
  await Promise.all([loadGroups(), loadDefaults()]);
});

async function loadGroups() {
  loading.value = true;
  try {
    groups.value = await $fetch<GroupItem[]>(`${config.public.apiBaseUrl}/groups`);
  } catch {
    toast.add({ title: 'Не удалось загрузить группы', color: 'error' });
  } finally {
    loading.value = false;
  }
}

async function syncGroupsOrder() {
  try {
    await $fetch(`${config.public.apiBaseUrl}/groups/reorder`, {
      method: 'PATCH',
      body: { ids: groups.value.map((g) => g.id) }
    });
    toast.add({ title: 'Порядок групп сохранён', color: 'success' });
  } catch {
    toast.add({ title: 'Не удалось сохранить порядок', color: 'error' });
    await loadGroups();
  }
}

async function loadDefaults() {
  defaultLoading.value = true;
  try {
    const data = await $fetch<PanelGlobalSettingsResponse>(
      `${config.public.apiBaseUrl}/panel-global-settings`
    );
    defaultAnnounceDraft.value = data.subscriptionAnnounce ?? '';
    defaultIntervalDraft.value =
      data.profileUpdateInterval != null ? String(data.profileUpdateInterval) : '';
  } catch {
    toast.add({ title: 'Не удалось загрузить значения по умолчанию', color: 'error' });
  } finally {
    defaultLoading.value = false;
  }
}

function openCreate() {
  createForm.value = {
    name: '',
    isMainGroup: false,
    subscriptionDisplayName: '',
    subscriptionAnnounce: '',
    profileUpdateInterval: ''
  };
  isCreateOpen.value = true;
}

function openEdit(row: GroupItem) {
  editing.value = row;
  editForm.value = {
    name: row.name,
    isMainGroup: row.isMainGroup === true,
    subscriptionDisplayName: row.subscriptionDisplayName ?? '',
    subscriptionAnnounce: row.subscriptionAnnounce ?? '',
    profileUpdateInterval:
      row.profileUpdateInterval != null ? String(row.profileUpdateInterval) : ''
  };
  isEditOpen.value = true;
}

function parseIntervalField(raw: string): number | null {
  const t = raw.trim();
  if (t === '') {
    return null;
  }
  if (!/^\d+$/.test(t)) {
    throw new Error('INT');
  }
  const n = Number.parseInt(t, 10);
  return n;
}

async function addGroup() {
  try {
    await groupNameSchema.validate(createForm.value.name);
    await titleFieldSchema.validate(createForm.value.subscriptionDisplayName);
    await announceSchema.validate(createForm.value.subscriptionAnnounce);
    let profileUpdateInterval: number | null = null;
    const ir = createForm.value.profileUpdateInterval.trim();
    if (ir !== '') {
      const n = parseIntervalField(ir);
      if (n === null) {
        throw new Error('INT');
      }
      await intervalHoursSchema.validate(n);
      profileUpdateInterval = n;
    }
  } catch (e) {
    if (e instanceof yup.ValidationError) {
      toast.add({ title: e.message, color: 'error' });
      return;
    }
    if (e instanceof Error && e.message === 'INT') {
      toast.add({ title: 'Интервал: целое число часов или пусто', color: 'error' });
      return;
    }
    throw e;
  }

  const name = createForm.value.name.trim();
  const subTitle = createForm.value.subscriptionDisplayName.trim();
  const ann = createForm.value.subscriptionAnnounce.trim();

  const body: Record<string, unknown> = {
    name,
    isMainGroup: createForm.value.isMainGroup === true
  };
  if (subTitle !== '') {
    body.subscriptionDisplayName = subTitle;
  }
  if (ann !== '') {
    body.subscriptionAnnounce = ann;
  }
  const ir = createForm.value.profileUpdateInterval.trim();
  if (ir !== '') {
    body.profileUpdateInterval = Number.parseInt(ir, 10);
  }

  createSaving.value = true;
  try {
    await $fetch(`${config.public.apiBaseUrl}/groups`, {
      method: 'POST',
      body
    });
    isCreateOpen.value = false;
    toast.add({ title: 'Группа добавлена', color: 'success' });
    await loadGroups();
  } catch {
    toast.add({ title: 'Не удалось добавить группу', color: 'error' });
  } finally {
    createSaving.value = false;
  }
}

function isSystemUngroupedGroup(row: Pick<GroupItem, 'name'>): boolean {
  return row.name === UNGROUPED_CONNECT_GROUP_NAME;
}

async function saveEdit() {
  if (!editing.value) {
    return;
  }
  try {
    if (!isSystemUngroupedGroup(editing.value)) {
      await groupNameSchema.validate(editForm.value.name);
    }
    await titleFieldSchema.validate(editForm.value.subscriptionDisplayName);
    await announceSchema.validate(editForm.value.subscriptionAnnounce);
    let profileUpdateInterval: number | null = null;
    const ir = editForm.value.profileUpdateInterval.trim();
    if (ir !== '') {
      const n = parseIntervalField(ir);
      if (n === null) {
        throw new Error('INT');
      }
      await intervalHoursSchema.validate(n);
      profileUpdateInterval = n;
    }
  } catch (e) {
    if (e instanceof yup.ValidationError) {
      toast.add({ title: e.message, color: 'error' });
      return;
    }
    if (e instanceof Error && e.message === 'INT') {
      toast.add({ title: 'Интервал: целое число часов или пусто', color: 'error' });
      return;
    }
    throw e;
  }

  const newName = editForm.value.name.trim();
  const subTitle = editForm.value.subscriptionDisplayName.trim();
  const ann = editForm.value.subscriptionAnnounce.trim();
  const ir = editForm.value.profileUpdateInterval.trim();

  const body: Record<string, unknown> = {
    name: newName,
    isMainGroup: editForm.value.isMainGroup === true,
    subscriptionDisplayName: subTitle === '' ? null : subTitle,
    subscriptionAnnounce: ann === '' ? null : ann,
    profileUpdateInterval: ir === '' ? null : Number.parseInt(ir, 10)
  };

  editSaving.value = true;
  try {
    await $fetch(`${config.public.apiBaseUrl}/groups/${editing.value.id}`, {
      method: 'PATCH',
      body
    });
    isEditOpen.value = false;
    editing.value = null;
    toast.add({ title: 'Группа обновлена', color: 'success' });
    await loadGroups();
  } catch {
    toast.add({ title: 'Не удалось сохранить', color: 'error' });
  } finally {
    editSaving.value = false;
  }
}

async function toggleGroupMain(row: GroupItem, value: boolean) {
  if (isSystemUngroupedGroup(row)) {
    return;
  }
  togglingMainGroupId.value = row.id;
  try {
    await $fetch(`${config.public.apiBaseUrl}/groups/${row.id}`, {
      method: 'PATCH',
      body: { isMainGroup: value }
    });
    toast.add({
      title: value ? 'Группа отмечена как главная' : 'Флаг «Главная» снят',
      color: 'success'
    });
    await loadGroups();
  } catch {
    toast.add({ title: 'Не удалось обновить флаг', color: 'error' });
  } finally {
    togglingMainGroupId.value = null;
  }
}

async function removeGroup(id: string) {
  try {
    await $fetch(`${config.public.apiBaseUrl}/groups/${id}`, {
      method: 'DELETE'
    });
    toast.add({ title: 'Группа удалена', color: 'success' });
    await loadGroups();
  } catch {
    toast.add({ title: 'Не удалось удалить группу', color: 'error' });
  }
}

async function saveDefaultAnnounce() {
  try {
    await announceSchema.validate(defaultAnnounceDraft.value);
  } catch (e) {
    if (e instanceof yup.ValidationError) {
      toast.add({ title: e.message, color: 'error' });
      return;
    }
    throw e;
  }
  defaultAnnounceSaving.value = true;
  try {
    await $fetch(`${config.public.apiBaseUrl}/panel-global-settings`, {
      method: 'PATCH',
      body: { subscriptionAnnounce: defaultAnnounceDraft.value.trim() }
    });
    toast.add({ title: 'Сохранено', color: 'success' });
    await loadDefaults();
  } catch {
    toast.add({ title: 'Не удалось сохранить', color: 'error' });
  } finally {
    defaultAnnounceSaving.value = false;
  }
}

async function saveDefaultInterval() {
  const raw = defaultIntervalDraft.value.trim();
  let profileUpdateInterval: number | null = null;
  if (raw !== '') {
    if (!/^\d+$/.test(raw)) {
      toast.add({ title: 'Введите целое число часов', color: 'error' });
      return;
    }
    const n = Number.parseInt(raw, 10);
    try {
      await intervalHoursSchema.validate(n);
      profileUpdateInterval = n;
    } catch (e) {
      if (e instanceof yup.ValidationError) {
        toast.add({ title: e.message, color: 'error' });
        return;
      }
      throw e;
    }
  }
  defaultIntervalSaving.value = true;
  try {
    await $fetch(`${config.public.apiBaseUrl}/panel-global-settings`, {
      method: 'PATCH',
      body: { profileUpdateInterval }
    });
    toast.add({ title: 'Сохранено', color: 'success' });
    await loadDefaults();
  } catch {
    toast.add({ title: 'Не удалось сохранить', color: 'error' });
  } finally {
    defaultIntervalSaving.value = false;
  }
}
</script>

<template>
  <div class="cosmic-app space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="cosmic-h2">
        Группы
      </h2>
      <UButton icon="i-lucide-plus" @click="openCreate">
        Добавить
      </UButton>
    </div>

    <UCard>
      <template #header>
        <div class="space-y-1">
          <p class="font-semibold text-highlighted">
            По умолчанию (наследование)
          </p>
          <p class="text-sm text-muted">
            Если у группы поле объявления или интервала пустое, подставляются эти значения. Для Happ см.
            <a
              href="https://www.happ.su/main/ru/dev-docs/app-management"
              target="_blank"
              rel="noopener noreferrer"
              class="text-primary underline underline-offset-2"
            >документацию</a>.
          </p>
        </div>
      </template>
      <div class="grid gap-6 lg:grid-cols-2">
        <div v-if="defaultLoading" class="space-y-2">
          <USkeleton class="h-24 w-full rounded-lg" />
        </div>
        <div v-else class="space-y-3">
          <UFormField
            label="Текст объявления"
            description="Пусто в группе — использовать это; здесь пусто и сохранить — отключить объявление"
            class="w-full"
          >
            <UTextarea
              v-model="defaultAnnounceDraft"
              class="w-full min-h-[5rem]"
              :rows="3"
              autoresize
              placeholder="Глобальное объявление"
            />
          </UFormField>
          <div class="flex justify-end">
            <UButton
              size="sm"
              :loading="defaultAnnounceSaving"
              @click="saveDefaultAnnounce"
            >
              Сохранить объявление
            </UButton>
          </div>
        </div>
        <div v-if="defaultLoading" class="space-y-2">
          <USkeleton class="h-14 w-full max-w-xs rounded-lg" />
        </div>
        <div v-else class="space-y-3">
          <UFormField
            label="Часов между обновлениями"
            description="Пусто в группе — использовать это; пусто здесь — отключить интервал"
            class="w-full max-w-xs"
          >
            <UInput
              v-model="defaultIntervalDraft"
              type="text"
              inputmode="numeric"
              class="w-full font-mono tabular-nums"
              placeholder="Например: 1"
              autocomplete="off"
            />
          </UFormField>
          <div class="flex justify-end">
            <UButton
              size="sm"
              :loading="defaultIntervalSaving"
              @click="saveDefaultInterval"
            >
              Сохранить интервал
            </UButton>
          </div>
        </div>
      </div>
    </UCard>

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <p class="border-b border-default px-4 py-3 text-xs text-muted">
        Порядок строк можно менять перетаскиванием за иконку слева (как на странице «Коннекты»). Группа
        «{{ UNGROUPED_CONNECT_GROUP_NAME }}» создаётся системой: в неё попадают новые коннекты после
        «Получить коннекты» на странице «Подписки», если у строки в подписке ещё нет групп.
        Переименовать или удалить её нельзя. Галочка «Главная» у группы означает: у одного коннекта на странице
        «Коннекты» не может быть двух главных групп одновременно.
      </p>
      <UTable
        :data="groups"
        :columns="columns"
        :loading="loading"
        empty="Групп пока нет"
        :ui="{ tbody: 'groups-table-tbody' }"
        class="w-full"
      >
        <template #drag-cell>
          <div
            class="group-drag-handle inline-flex cursor-grab text-muted active:cursor-grabbing"
          >
            <UIcon name="i-lucide-grip-vertical" class="size-4" />
          </div>
        </template>

        <template #name-cell="{ row }">
          <div class="flex flex-wrap items-center gap-2 min-w-0">
            <span class="font-medium truncate">{{ row.original.name }}</span>
            <UBadge
              v-if="isSystemUngroupedGroup(row.original)"
              color="neutral"
              variant="subtle"
              size="xs"
            >
              Системная
            </UBadge>
            <UBadge
              v-else-if="row.original.isMainGroup === true"
              color="primary"
              variant="subtle"
              size="xs"
            >
              Главная
            </UBadge>
          </div>
        </template>

        <template #isMainGroup-cell="{ row }">
          <UTooltip
            :text="
              isSystemUngroupedGroup(row.original)
                ? 'Служебная группа не может быть главной'
                : 'Главная: не более одной на коннект (страница «Коннекты»)'
            "
          >
            <UCheckbox
              :model-value="row.original.isMainGroup === true"
              :disabled="
                isSystemUngroupedGroup(row.original) ||
                  togglingMainGroupId === row.original.id
              "
              @update:model-value="
                (v) => {
                  if (typeof v === 'boolean') {
                    toggleGroupMain(row.original, v)
                  }
                }
              "
            />
          </UTooltip>
        </template>

        <template #activeConnectCount-cell="{ row }">
          {{ row.original.activeConnectCount ?? 0 }}
        </template>

        <template #panelUserCount-cell="{ row }">
          {{ row.original.panelUserCount ?? 0 }}
        </template>

        <template #createdAt-cell="{ row }">
          <span class="whitespace-nowrap">
            {{ new Date(row.original.createdAt).toLocaleString('ru-RU') }}
          </span>
        </template>

        <template #actions-cell="{ row }">
          <div class="flex flex-wrap items-center gap-0.5">
            <UTooltip
              :text="
                isSystemUngroupedGroup(row.original)
                  ? 'Настройки подписки (имя группы нельзя менять)'
                  : 'Редактировать'
              "
            >
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
            <UTooltip
              v-if="!isSystemUngroupedGroup(row.original)"
              text="Удалить"
            >
              <UButton
                color="error"
                variant="ghost"
                size="xs"
                icon="i-lucide-trash-2"
                class="rounded-lg p-1.5 min-w-8 min-h-8"
                aria-label="Удалить"
                @click="removeGroup(row.original.id)"
              />
            </UTooltip>
          </div>
        </template>
      </UTable>
    </UCard>

    <UModal v-model:open="isCreateOpen" title="Добавить группу">
      <template #body>
        <div class="space-y-4">
          <UFormField label="Название группы" required>
            <UInput
              v-model="createForm.name"
              class="w-full"
              placeholder="Например: Основная"
            />
          </UFormField>
          <UFormField
            label="Главная группа"
            description="У одного коннекта не может быть двух главных групп на странице «Коннекты»"
            class="w-full"
          >
            <UCheckbox v-model="createForm.isMainGroup" label="Пометить как главную" />
          </UFormField>
          <UFormField
            label="Название для публичной подписки"
            description="Необязательно; /sub и profile-title"
            class="w-full"
          >
            <UInput
              v-model="createForm.subscriptionDisplayName"
              class="w-full"
              placeholder="Оставьте пустым, чтобы не задавать"
            />
          </UFormField>
          <UFormField
            label="Объявление Happ"
            description="Необязательно; пусто — брать из блока «По умолчанию» выше"
            class="w-full"
          >
            <UTextarea
              v-model="createForm.subscriptionAnnounce"
              class="w-full min-h-[4.5rem]"
              :rows="3"
              autoresize
            />
          </UFormField>
          <UFormField
            label="Интервал обновления (часы)"
            description="Необязательно; пусто — из «По умолчанию»"
            class="w-full max-w-xs"
          >
            <UInput
              v-model="createForm.profileUpdateInterval"
              type="text"
              inputmode="numeric"
              class="w-full font-mono tabular-nums"
              placeholder="Пусто = наследование"
            />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton color="neutral" variant="ghost" @click="isCreateOpen = false">
            Отмена
          </UButton>
          <UButton :loading="createSaving" @click="addGroup">
            Сохранить
          </UButton>
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="isEditOpen"
      title="Редактировать группу"
    >
      <template #body>
        <div v-if="editing" class="space-y-4">
          <UFormField
            label="Название группы"
            required
            :description="
              isSystemUngroupedGroup(editing)
                ? 'Служебное имя; переименование через API запрещено.'
                : 'Используется как тег у коннектов и в списке групп пользователей. При смене имя обновится везде автоматически.'
            "
            class="w-full"
          >
            <UInput
              v-model="editForm.name"
              class="w-full"
              placeholder="Уникальное имя"
              :readonly="isSystemUngroupedGroup(editing)"
            />
          </UFormField>
          <UFormField
            label="Главная группа"
            description="У одного коннекта не может быть двух главных групп на странице «Коннекты»"
            class="w-full"
          >
            <UCheckbox
              v-model="editForm.isMainGroup"
              :disabled="isSystemUngroupedGroup(editing)"
              label="Пометить как главную"
            />
          </UFormField>
          <UFormField
            label="Название для публичной подписки"
            description="Пусто — сбросить"
            class="w-full"
          >
            <UInput
              v-model="editForm.subscriptionDisplayName"
              class="w-full"
            />
          </UFormField>
          <UFormField
            label="Объявление Happ"
            description="Пусто — наследовать из «По умолчанию»"
            class="w-full"
          >
            <UTextarea
              v-model="editForm.subscriptionAnnounce"
              class="w-full min-h-[4.5rem]"
              :rows="3"
              autoresize
            />
          </UFormField>
          <UFormField
            label="Интервал обновления (часы)"
            description="Пусто — наследовать из «По умолчанию»"
            class="w-full max-w-xs"
          >
            <UInput
              v-model="editForm.profileUpdateInterval"
              type="text"
              inputmode="numeric"
              class="w-full font-mono tabular-nums"
            />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton color="neutral" variant="ghost" @click="isEditOpen = false">
            Отмена
          </UButton>
          <UButton :loading="editSaving" @click="saveEdit">
            Сохранить
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
