<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui';
import * as yup from 'yup';

definePageMeta({
  layout: 'dashboard'
});

type GroupItem = {
  id: string;
  name: string;
  createdAt: string;
  subscriptionDisplayName?: string | null;
  subscriptionAnnounce?: string | null;
  profileUpdateInterval?: number | null;
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
  .max(200, 'Не более 200 символов');

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
  subscriptionDisplayName: '',
  subscriptionAnnounce: '',
  profileUpdateInterval: ''
});

const editForm = ref({
  subscriptionDisplayName: '',
  subscriptionAnnounce: '',
  profileUpdateInterval: ''
});

const createSaving = ref(false);
const editSaving = ref(false);

const defaultAnnounceDraft = ref('');
const defaultIntervalDraft = ref('');
const defaultLoading = ref(false);
const defaultAnnounceSaving = ref(false);
const defaultIntervalSaving = ref(false);

const columns: TableColumn<GroupItem>[] = [
  { accessorKey: 'name', header: 'Название' },
  { accessorKey: 'createdAt', header: 'Дата добавления' },
  { id: 'actions', header: 'Действия' }
];

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
    subscriptionDisplayName: '',
    subscriptionAnnounce: '',
    profileUpdateInterval: ''
  };
  isCreateOpen.value = true;
}

function openEdit(row: GroupItem) {
  editing.value = row;
  editForm.value = {
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

  const body: Record<string, unknown> = { name };
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

async function saveEdit() {
  if (!editing.value) {
    return;
  }
  try {
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

  const subTitle = editForm.value.subscriptionDisplayName.trim();
  const ann = editForm.value.subscriptionAnnounce.trim();
  const ir = editForm.value.profileUpdateInterval.trim();

  const body: Record<string, unknown> = {
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
      <UTable
        :data="groups"
        :columns="columns"
        :loading="loading"
        empty="Групп пока нет"
        class="w-full"
      >
        <template #createdAt-cell="{ row }">
          <span class="whitespace-nowrap">
            {{ new Date(row.original.createdAt).toLocaleString('ru-RU') }}
          </span>
        </template>

        <template #actions-cell="{ row }">
          <div class="flex flex-wrap items-center gap-0.5">
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
          <p class="text-sm text-muted">
            Группа: <span class="font-medium text-highlighted">{{ editing.name }}</span>
          </p>
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
