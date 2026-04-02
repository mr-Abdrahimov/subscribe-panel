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

const toast = useToast();
const groups = ref<GroupItem[]>([]);
const loading = ref(false);
const isModalOpen = ref(false);
const groupName = ref('');

const columns: TableColumn<GroupItem>[] = [
  {
    accessorKey: 'name',
    header: 'Название'
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

onMounted(() => {
  loadGroups();
});

function loadGroups() {
  loading.value = true;
  try {
    if (import.meta.client) {
      const raw = localStorage.getItem('groups');
      groups.value = raw ? JSON.parse(raw) as GroupItem[] : [];
    }
  } catch {
    toast.add({ title: 'Не удалось загрузить группы', color: 'error' });
  } finally {
    loading.value = false;
  }
}

function persistGroups() {
  if (import.meta.client) {
    localStorage.setItem('groups', JSON.stringify(groups.value));
  }
}

function openCreate() {
  groupName.value = '';
  isModalOpen.value = true;
}

function addGroup() {
  const name = groupName.value.trim();
  if (!name) {
    toast.add({ title: 'Введите название группы', color: 'error' });
    return;
  }

  groups.value.unshift({
    id: crypto.randomUUID(),
    name,
    createdAt: new Date().toISOString()
  });
  persistGroups();
  isModalOpen.value = false;
  toast.add({ title: 'Группа добавлена', color: 'success' });
}

function removeGroup(id: string) {
  groups.value = groups.value.filter(item => item.id !== id);
  persistGroups();
  toast.add({ title: 'Группа удалена', color: 'success' });
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between gap-3">
      <h2 class="text-xl font-semibold">
        Группы
      </h2>

      <UButton icon="i-lucide-plus" @click="openCreate">
        Добавить
      </UButton>
    </div>

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
          <UButton
            size="xs"
            color="error"
            variant="soft"
            icon="i-lucide-trash"
            @click="removeGroup(row.original.id)"
          >
            Удалить
          </UButton>
        </template>
      </UTable>
    </UCard>

    <UModal v-model:open="isModalOpen" title="Добавить группу">
      <template #body>
        <UFormField label="Название группы" required>
          <UInput v-model="groupName" class="w-full" placeholder="Например: Основная группа" />
        </UFormField>
      </template>

      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton color="neutral" variant="ghost" @click="isModalOpen = false">
            Отмена
          </UButton>
          <UButton @click="addGroup">
            Сохранить
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>

