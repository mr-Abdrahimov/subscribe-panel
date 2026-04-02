<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui';

definePageMeta({
  layout: 'dashboard'
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
  createdAt: string;
};

const toast = useToast();
const config = useRuntimeConfig();
const loading = ref(false);
const users = ref<UserItem[]>([]);
const groups = ref<GroupItem[]>([]);

const isModalOpen = ref(false);
const formName = ref('');
const formCode = ref('');
const formGroupName = ref('');

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
    id: 'enabled',
    header: 'Статус'
  },
  {
    id: 'actions',
    header: 'Действия'
  }
];

const groupOptions = computed(() => groups.value.map(group => group.name));

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

  formName.value = '';
  formCode.value = generateCode(32);
  formGroupName.value = groups.value[0]?.name ?? '';
  isModalOpen.value = true;
}

async function submitUser() {
  const name = formName.value.trim();
  if (!name) {
    toast.add({ title: 'Введите имя пользователя', color: 'error' });
    return;
  }

  if (!formGroupName.value) {
    toast.add({ title: 'Выберите группу', color: 'error' });
    return;
  }

  try {
    await $fetch(`${config.public.apiBaseUrl}/panel-users`, {
      method: 'POST',
      body: {
        name,
        code: formCode.value,
        groupName: formGroupName.value
      }
    });
    isModalOpen.value = false;
    toast.add({ title: 'Пользователь добавлен', color: 'success' });
    await loadData();
  } catch {
    toast.add({ title: 'Не удалось добавить пользователя', color: 'error' });
  }
}

async function removeUser(id: string) {
  try {
    await $fetch(`${config.public.apiBaseUrl}/panel-users/${id}`, {
      method: 'DELETE'
    });
    toast.add({ title: 'Пользователь удален', color: 'success' });
    await loadData();
  } catch {
    toast.add({ title: 'Не удалось удалить пользователя', color: 'error' });
  }
}

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
          <code class="text-xs">{{ row.original.code }}</code>
        </template>

        <template #enabled-cell="{ row }">
          <USwitch
            :model-value="row.original.enabled"
            @update:model-value="toggleUser(row.original, $event)"
          />
        </template>

        <template #actions-cell="{ row }">
          <UButton
            size="xs"
            color="error"
            variant="soft"
            icon="i-lucide-trash"
            @click="removeUser(row.original.id)"
          >
            Удалить
          </UButton>
        </template>
      </UTable>
    </UCard>

    <UModal v-model:open="isModalOpen" title="Добавить пользователя">
      <template #body>
        <div class="space-y-3">
          <UFormField label="Имя" required>
            <UInput v-model="formName" class="w-full" placeholder="Введите имя пользователя" />
          </UFormField>

          <UFormField label="Код (32 символа)">
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
          <UButton color="neutral" variant="ghost" @click="isModalOpen = false">
            Отмена
          </UButton>
          <UButton @click="submitUser">
            Сохранить
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
