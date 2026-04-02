<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui';
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
  subscriptionDisplayName?: string | null;
};

type UserItem = {
  id: string;
  name: string;
  code: string;
  groupName: string;
  enabled: boolean;
  createdAt: string;
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

const columns: TableColumn<UserItem>[] = [
  {
    accessorKey: 'name',
    header: 'Имя'
  },
  {
    accessorKey: 'code',
    header: 'Код'
  },
  {
    accessorKey: 'groupName',
    header: 'Группа'
  },
  {
    id: 'subscriptionTitle',
    header: 'Заголовок группы'
  },
  {
    id: 'enabled',
    header: 'Статус'
  },
  {
    id: 'actions',
    header: '',
    meta: {
      class: {
        th: 'w-px',
        td: 'w-px whitespace-nowrap'
      }
    }
  }
];

const groupOptions = computed(() => groups.value.map(group => group.name));

function normalizeGroupKey(s: string) {
  return s.trim().normalize('NFC');
}

/** Сопоставление как на бэкенде: точное имя группы и без учёта регистра */
function getSubscriptionDisplayForGroup(panelGroupName: string): string | null {
  const t = normalizeGroupKey(panelGroupName);
  if (!t) {
    return null;
  }
  const tl = t.toLowerCase();
  const g =
    groups.value.find((x) => normalizeGroupKey(x.name) === t) ??
    groups.value.find(
      (x) => normalizeGroupKey(x.name).toLowerCase() === tl,
    );
  const v = g?.subscriptionDisplayName?.trim();
  return v || null;
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
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between gap-3">
      <h2 class="text-xl font-semibold">
        Пользователи
      </h2>

      <UButton icon="i-lucide-plus" @click="openCreate">
        Добавить
      </UButton>
    </div>

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <UTable
        :data="users"
        :columns="columns"
        :loading="loading"
        empty="Пользователей пока нет"
        class="w-full"
      >
        <template #code-cell="{ row }">
          <div class="flex items-center gap-1.5 min-w-0 max-w-full">
            <code class="text-xs truncate">{{ row.original.code }}</code>
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

        <template #subscriptionTitle-cell="{ row }">
          <span
            :class="getSubscriptionDisplayForGroup(row.original.groupName) ? 'text-sm' : 'text-xs text-muted'"
          >
            {{ getSubscriptionDisplayForGroup(row.original.groupName) || '—' }}
          </span>
        </template>

        <template #enabled-cell="{ row }">
          <USwitch
            :model-value="row.original.enabled"
            @update:model-value="toggleUser(row.original, $event)"
          />
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
  </div>
</template>
