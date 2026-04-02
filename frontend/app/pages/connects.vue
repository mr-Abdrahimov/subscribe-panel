<script setup lang="ts">
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
const dragId = ref<string | null>(null);
const dragOverId = ref<string | null>(null);

onMounted(() => {
  loadConnects();
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

function onDragStart(id: string) {
  dragId.value = id;
}

function onDragOver(event: DragEvent) {
  event.preventDefault();
}

function onDragEnter(targetId: string) {
  if (dragId.value && dragId.value !== targetId) {
    dragOverId.value = targetId;
  }
}

function onDragLeave() {
  dragOverId.value = null;
}

async function onDrop(targetId: string) {
  if (!dragId.value || dragId.value === targetId) {
    dragId.value = null;
    dragOverId.value = null;
    return;
  }

  const fromIndex = connects.value.findIndex((item) => item.id === dragId.value);
  const toIndex = connects.value.findIndex((item) => item.id === targetId);
  if (fromIndex === -1 || toIndex === -1) {
    dragId.value = null;
    return;
  }

  const copy = [...connects.value];
  const [moved] = copy.splice(fromIndex, 1);
  copy.splice(toIndex, 0, moved);
  connects.value = copy;
  dragId.value = null;
  dragOverId.value = null;

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
      <div class="hidden md:block px-4 pb-4">
        <div class="grid grid-cols-[1fr_1.2fr_1fr_.7fr_1fr_1.4fr] gap-3 border-b py-3 text-sm font-medium">
          <div>Подписка</div>
          <div>Название</div>
          <div>Статус</div>
          <div>Протокол</div>
          <div>Дата добавления</div>
          <div>Действия</div>
        </div>

        <div v-if="connects.length === 0" class="py-6 text-center text-muted">
          Коннектов пока нет
        </div>

        <div
          v-for="row in connects"
          :key="row.id"
          draggable="true"
          class="grid grid-cols-[1fr_1.2fr_1fr_.7fr_1fr_1.4fr] gap-3 border-b last:border-b-0 py-3 text-sm items-start cursor-grab active:cursor-grabbing transition-colors"
          :class="{
            'opacity-50 bg-primary/5': dragId === row.id,
            'ring-2 ring-primary/40 bg-primary/10': dragOverId === row.id
          }"
          @dragstart="onDragStart(row.id)"
          @dragenter="onDragEnter(row.id)"
          @dragover="onDragOver"
          @dragleave="onDragLeave"
          @drop="onDrop(row.id)"
        >
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-grip-vertical" class="text-muted size-4" />
            <span>{{ row.subscription.title }}</span>
          </div>
          <div>
            {{ row.name }}
          </div>
          <div>
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              :icon="row.status === 'ACTIVE' ? 'i-lucide-eye' : 'i-lucide-eye-off'"
              @click="toggleStatus(row.id)"
            />
          </div>
          <div>{{ row.protocol.toUpperCase() }}</div>
          <div class="whitespace-nowrap">
            {{ new Date(row.createdAt).toLocaleString('ru-RU') }}
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <UButton size="xs" color="error" variant="soft" @click="removeConnect(row.id)">
              Удалить
            </UButton>
            <UButton size="xs" color="primary" variant="soft" @click="openAddTag(row.id)">
              Добавить тэг
            </UButton>
          </div>
        </div>
      </div>

      <div class="md:hidden space-y-3 p-4">
        <div v-if="connects.length === 0" class="py-4 text-center text-sm text-muted">
          Коннектов пока нет
        </div>
        <UCard v-for="row in connects" :key="row.id" variant="subtle">
          <div class="space-y-2">
            <p><span class="text-muted">Подписка:</span> {{ row.subscription.title }}</p>
            <p>
              <span class="text-muted">Название:</span> {{ row.name }}
            </p>
            <p><span class="text-muted">Протокол:</span> {{ row.protocol.toUpperCase() }}</p>
            <p><span class="text-muted">Дата:</span> {{ new Date(row.createdAt).toLocaleString('ru-RU') }}</p>
            <div class="flex flex-wrap gap-2 pt-2">
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                :icon="row.status === 'ACTIVE' ? 'i-lucide-eye' : 'i-lucide-eye-off'"
                @click="toggleStatus(row.id)"
              />
              <UButton size="xs" color="error" variant="soft" @click="removeConnect(row.id)">
                Удалить
              </UButton>
              <UButton size="xs" color="primary" variant="soft" @click="openAddTag(row.id)">
                Добавить тэг
              </UButton>
            </div>
          </div>
        </UCard>
      </div>
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

