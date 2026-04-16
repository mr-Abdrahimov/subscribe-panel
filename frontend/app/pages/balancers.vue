<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui';
import * as yup from 'yup';

definePageMeta({
  layout: 'dashboard'
});

type ConnectOption = {
  id: string;
  name: string;
  protocol: string;
  groupNames: string[];
  raw: string;
  status: string;
};

type BalancerItem = {
  id: string;
  name: string;
  connectIds: string[];
  createdAt: string;
  updatedAt: string;
};

const config = useRuntimeConfig();
const toast = useToast();

const balancers = ref<BalancerItem[]>([]);
const connects = ref<ConnectOption[]>([]);
const loading = ref(false);
const isModalOpen = ref(false);
const editId = ref<string | null>(null);
const isDeleteConfirmOpen = ref(false);
const deleteId = ref<string | null>(null);

const formName = ref('');
const formConnectIds = ref<string[]>([]);
const formErrors = ref<Record<string, string>>({});
const saving = ref(false);

// Фильтры в форме
const filterSearch = ref('');
const filterGroup = ref<string | null>(null);

const schema = yup.object({
  name: yup
    .string()
    .trim()
    .required('Укажите название')
    .max(200, 'Не более 200 символов'),
  connectIds: yup
    .array()
    .of(yup.string().required())
    .min(1, 'Выберите хотя бы один коннект'),
});

const columns: TableColumn<BalancerItem>[] = [
  { accessorKey: 'name', header: 'Название' },
  { accessorKey: 'connectIds', header: 'Коннектов в пуле' },
  { accessorKey: 'createdAt', header: 'Создан' },
  { id: 'actions', header: 'Действия' },
];

/** Коннекты без балансировщиков для выбора в пул */
const availableConnects = computed(() =>
  connects.value.filter(
    (c) => !c.raw.startsWith('balancer://') && c.status === 'ACTIVE',
  ),
);

/** Уникальные группы из доступных коннектов */
const groupOptions = computed(() => {
  const groups = new Set<string>();
  for (const c of availableConnects.value) {
    for (const g of c.groupNames) groups.add(g);
  }
  return Array.from(groups).sort((a, b) => a.localeCompare(b, 'ru'));
});

/** Отфильтрованные коннекты с учётом поиска и выбранной группы */
const filteredConnects = computed(() => {
  const search = filterSearch.value.trim().toLowerCase();
  return availableConnects.value.filter((c) => {
    if (filterGroup.value && !c.groupNames.includes(filterGroup.value)) return false;
    if (search && !c.name.toLowerCase().includes(search)) return false;
    return true;
  });
});

/** Варианты для списка коннектов */
const connectOptions = computed(() =>
  filteredConnects.value.map((c) => ({
    value: c.id,
    label: c.name,
    description: [c.protocol, c.groupNames.join(', ')].filter(Boolean).join(' · '),
  })),
);

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function fetchBalancers() {
  loading.value = true;
  try {
    balancers.value = await $fetch<BalancerItem[]>(`${config.public.apiBaseUrl}/balancers`);
  } catch {
    toast.add({ title: 'Ошибка загрузки балансировщиков', color: 'error' });
  } finally {
    loading.value = false;
  }
}

async function fetchConnects() {
  try {
    connects.value = await $fetch<ConnectOption[]>(`${config.public.apiBaseUrl}/connects`);
  } catch {
    toast.add({ title: 'Не удалось загрузить коннекты', color: 'error' });
  }
}

function openCreate() {
  editId.value = null;
  formName.value = '';
  formConnectIds.value = [];
  formErrors.value = {};
  filterSearch.value = '';
  filterGroup.value = null;
  isModalOpen.value = true;
}

function openEdit(item: BalancerItem) {
  editId.value = item.id;
  formName.value = item.name;
  formConnectIds.value = [...item.connectIds];
  formErrors.value = {};
  filterSearch.value = '';
  filterGroup.value = null;
  isModalOpen.value = true;
}

async function save() {
  formErrors.value = {};
  try {
    await schema.validate(
      { name: formName.value, connectIds: formConnectIds.value },
      { abortEarly: false },
    );
  } catch (err) {
    if (err instanceof yup.ValidationError) {
      for (const e of err.inner) {
        if (e.path) formErrors.value[e.path] = e.message;
      }
    }
    return;
  }

  saving.value = true;
  try {
    const body = { name: formName.value.trim(), connectIds: formConnectIds.value };
    if (editId.value) {
      await $fetch(`${config.public.apiBaseUrl}/balancers/${editId.value}`, {
        method: 'PATCH',
        body,
      });
      toast.add({ title: 'Балансировщик обновлён', color: 'success' });
    } else {
      await $fetch(`${config.public.apiBaseUrl}/balancers`, {
        method: 'POST',
        body,
      });
      toast.add({ title: 'Балансировщик создан', color: 'success' });
    }
    isModalOpen.value = false;
    await fetchBalancers();
  } catch (e: unknown) {
    const msg =
      e && typeof e === 'object' && 'data' in e
        ? (e as { data?: { message?: string } }).data?.message
        : null;
    toast.add({ title: msg ?? 'Ошибка сохранения', color: 'error' });
  } finally {
    saving.value = false;
  }
}

function askDelete(id: string) {
  deleteId.value = id;
  isDeleteConfirmOpen.value = true;
}

async function confirmDelete() {
  if (!deleteId.value) return;
  try {
    await $fetch(`${config.public.apiBaseUrl}/balancers/${deleteId.value}`, {
      method: 'DELETE',
    });
    toast.add({ title: 'Балансировщик удалён', color: 'success' });
    isDeleteConfirmOpen.value = false;
    deleteId.value = null;
    await fetchBalancers();
  } catch {
    toast.add({ title: 'Ошибка удаления', color: 'error' });
  }
}

/** Названия выбранных коннектов для отображения в форме */
const selectedConnectLabels = computed(() =>
  formConnectIds.value
    .map((id) => connects.value.find((c) => c.id === id)?.name ?? id)
    .join(', '),
);

onMounted(() => {
  fetchBalancers();
  fetchConnects();
});
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold tracking-tight">Балансеры</h1>
        <p class="mt-1 text-sm text-[var(--cosmic-fg-muted)]">
          Балансировщик объединяет несколько коннектов и выбирает самое быстрое соединение в JSON-ленте.
        </p>
      </div>
      <UButton
        icon="i-lucide-plus"
        color="primary"
        @click="openCreate"
      >
        Добавить
      </UButton>
    </div>

    <UCard>
      <UTable
        :data="balancers"
        :columns="columns"
        :loading="loading"
        :empty-state="{ label: 'Балансировщиков нет', icon: 'i-lucide-git-branch-plus' }"
      >
        <template #connectIds-cell="{ row }">
          <UBadge color="neutral" variant="soft">
            {{ row.original.connectIds.length }}
          </UBadge>
        </template>

        <template #createdAt-cell="{ row }">
          <span class="text-sm text-[var(--cosmic-fg-muted)]">
            {{ formatDate(row.original.createdAt) }}
          </span>
        </template>

        <template #actions-cell="{ row }">
          <div class="flex items-center justify-end gap-1">
            <UTooltip text="Редактировать">
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-lucide-pencil"
                @click="openEdit(row.original)"
              />
            </UTooltip>
            <UTooltip text="Удалить">
              <UButton
                size="xs"
                color="error"
                variant="ghost"
                icon="i-lucide-trash"
                @click="askDelete(row.original.id)"
              />
            </UTooltip>
          </div>
        </template>
      </UTable>
    </UCard>

    <!-- Боковая панель создания / редактирования -->
    <USlideover
      v-model:open="isModalOpen"
      :title="editId ? 'Редактировать балансировщик' : 'Добавить балансировщик'"
      side="right"
      :ui="{ body: 'flex-1 overflow-y-auto' }"
    >
      <template #body>
        <div class="space-y-5 p-4">
          <UFormField
            label="Название"
            required
            :error="formErrors['name']"
          >
            <UInput
              v-model="formName"
              class="w-full"
              placeholder="Например: Быстрый пул"
              autofocus
            />
          </UFormField>

          <UFormField
            label="Коннекты в пуле"
            description="Выберите коннекты, между которыми балансировщик будет выбирать самый быстрый. Коннекты-балансировщики не доступны для выбора."
            required
            :error="formErrors['connectIds']"
          >
            <div class="space-y-2">
              <!-- Фильтры -->
              <div class="flex gap-2">
                <UInput
                  v-model="filterSearch"
                  class="flex-1 min-w-0"
                  placeholder="Поиск по названию..."
                  icon="i-lucide-search"
                  size="sm"
                />
                <USelectMenu
                  v-model="filterGroup"
                  :items="[{ label: 'Все группы', id: null }, ...groupOptions.map(g => ({ label: g, id: g }))]"
                  value-key="id"
                  label-key="label"
                  placeholder="Все группы"
                  size="sm"
                  class="w-40 shrink-0"
                />
              </div>

              <!-- Список коннектов -->
              <div
                v-if="availableConnects.length === 0"
                class="text-sm text-[var(--cosmic-fg-muted)]"
              >
                Нет доступных коннектов
              </div>
              <div v-else class="space-y-1 rounded-lg border border-[var(--cosmic-border)] p-2">
                <div
                  v-if="connectOptions.length === 0"
                  class="py-4 text-center text-sm text-[var(--cosmic-fg-muted)]"
                >
                  Ничего не найдено
                </div>
                <label
                  v-for="opt in connectOptions"
                  :key="opt.value"
                  class="flex cursor-pointer items-start gap-3 rounded-md px-2 py-1.5 hover:bg-[var(--cosmic-sidebar-accent)] transition-colors"
                >
                  <UCheckbox
                    :model-value="formConnectIds.includes(opt.value)"
                    class="mt-0.5 shrink-0"
                    @update:model-value="(v) => {
                      if (v) formConnectIds.push(opt.value);
                      else formConnectIds = formConnectIds.filter((id) => id !== opt.value);
                    }"
                  />
                  <div class="min-w-0">
                    <p class="text-sm font-medium leading-snug truncate">{{ opt.label }}</p>
                    <p v-if="opt.description" class="text-xs text-[var(--cosmic-fg-muted)] truncate">{{ opt.description }}</p>
                  </div>
                </label>
              </div>
              <p v-if="formConnectIds.length > 0" class="text-xs text-[var(--cosmic-fg-muted)]">
                Выбрано: {{ formConnectIds.length }}
                <template v-if="filterSearch || filterGroup">
                  · показано {{ connectOptions.length }} из {{ availableConnects.length }}
                </template>
              </p>
            </div>
          </UFormField>
        </div>
      </template>

      <template #footer>
        <div class="flex justify-end gap-2 p-4 border-t border-[var(--cosmic-border)]">
          <UButton color="neutral" variant="ghost" @click="isModalOpen = false">
            Отмена
          </UButton>
          <UButton
            color="primary"
            :loading="saving"
            @click="save"
          >
            {{ editId ? 'Сохранить' : 'Создать' }}
          </UButton>
        </div>
      </template>
    </USlideover>

    <!-- Подтверждение удаления -->
    <UModal v-model:open="isDeleteConfirmOpen" title="Удалить балансировщик?">
      <template #body>
        <p class="text-sm text-[var(--cosmic-fg-muted)]">
          Балансировщик будет удалён вместе с коннектом в группе «Без группы». Это действие нельзя отменить.
        </p>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="isDeleteConfirmOpen = false">
            Отмена
          </UButton>
          <UButton color="error" @click="confirmDelete">
            Удалить
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
