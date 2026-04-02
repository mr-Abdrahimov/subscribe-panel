<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui';
import { useSortable, moveArrayElement } from '@vueuse/integrations/useSortable';

definePageMeta({
  layout: 'dashboard'
});

type ConnectRow = {
  id: string;
  name: string;
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

const config = useRuntimeConfig();
const toast = useToast();
const loading = ref(false);
const connects = ref<ConnectRow[]>([]);

const isTagModalOpen = ref(false);
const tagValue = ref('');
const selectedConnectId = ref<string | null>(null);

onMounted(() => {
  loadConnects();
});

useSortable('.connects-table-tbody', connects, {
  handle: '.connect-drag-handle',
  animation: 150,
  onUpdate: async (e) => {
    moveArrayElement(connects, e.oldIndex!, e.newIndex!, e);
    await nextTick();
    await syncOrder();
  }
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
    accessorKey: 'subscription',
    header: 'Подписка'
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
  <div class="space-y-4">
    <div class="flex items-center justify-between gap-3">
      <h2 class="text-xl font-semibold">
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
      <UTable
        :data="connects"
        :columns="columns"
        :loading="loading"
        empty="Коннектов пока нет"
        :ui="{ tbody: 'connects-table-tbody' }"
        class="w-full"
      >
        <template #drag-cell>
          <div class="connect-drag-handle inline-flex cursor-grab active:cursor-grabbing text-muted">
            <UIcon name="i-lucide-grip-vertical" class="size-4" />
          </div>
        </template>

        <template #subscription-cell="{ row }">
          {{ row.original.subscription.title }}
        </template>

        <template #status-cell="{ row }">
          <UButton
            size="xs"
            color="neutral"
            variant="ghost"
            :icon="row.original.status === 'ACTIVE' ? 'i-lucide-eye' : 'i-lucide-eye-off'"
            @click="toggleStatus(row.original.id)"
          />
        </template>

        <template #protocol-cell="{ row }">
          {{ row.original.protocol.toUpperCase() }}
        </template>

        <template #createdAt-cell="{ row }">
          <span class="whitespace-nowrap">
            {{ new Date(row.original.createdAt).toLocaleString('ru-RU') }}
          </span>
        </template>

        <template #actions-cell="{ row }">
          <div class="flex flex-wrap items-center gap-2">
            <UButton size="xs" color="error" variant="soft" @click="removeConnect(row.original.id)">
              Удалить
            </UButton>
            <UButton size="xs" color="primary" variant="soft" @click="openAddTag(row.original.id)">
              Добавить тэг
            </UButton>
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
  </div>
</template>
