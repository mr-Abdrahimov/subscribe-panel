<script setup lang="ts">
definePageMeta({
  layout: 'dashboard'
});

const { items, load, add, update, remove } = useSubscriptions();
const toast = useToast();

const isModalOpen = ref(false);
const editId = ref<string | null>(null);
const formTitle = ref('');
const formUrl = ref('');

onMounted(() => {
  load();
});

function openCreate() {
  editId.value = null;
  formTitle.value = '';
  formUrl.value = '';
  isModalOpen.value = true;
}

function openEdit(id: string, title: string, url: string) {
  editId.value = id;
  formTitle.value = title;
  formUrl.value = url;
  isModalOpen.value = true;
}

function submit() {
  const title = formTitle.value.trim();
  const value = formUrl.value.trim();
  if (!title) {
    toast.add({ title: 'Введите название', color: 'error' });
    return;
  }

  if (!value) {
    toast.add({ title: 'Введите ссылку', color: 'error' });
    return;
  }

  try {
    const parsed = new URL(value);
    if (!(parsed.protocol === 'http:' || parsed.protocol === 'https:')) {
      throw new Error('invalid');
    }
  } catch {
    toast.add({ title: 'Некорректный формат ссылки', color: 'error' });
    return;
  }

  if (editId.value) {
    update(editId.value, title, value);
    toast.add({ title: 'Подписка обновлена', color: 'success' });
  } else {
    add(title, value);
    toast.add({ title: 'Подписка добавлена', color: 'success' });
  }

  isModalOpen.value = false;
}

function removeItem(id: string) {
  remove(id);
  toast.add({ title: 'Подписка удалена', color: 'success' });
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between gap-3">
      <h2 class="text-xl font-semibold">
        Подписки
      </h2>

      <UButton icon="i-lucide-plus" @click="openCreate">
        Добавить
      </UButton>
    </div>

    <UCard>
      <div class="hidden md:block overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b">
              <th class="text-left font-medium py-3 pr-4">
                Название
              </th>
              <th class="text-left font-medium py-3 pr-4">
                Ссылка
              </th>
              <th class="text-left font-medium py-3 pr-4">
                Дата добавления
              </th>
              <th class="text-left font-medium py-3">
                Действия
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="items.length === 0">
              <td colspan="4" class="py-6 text-center text-muted">
                Подписок пока нет
              </td>
            </tr>
            <tr v-for="item in items" :key="item.id" class="border-b last:border-b-0">
              <td class="py-3 pr-4 align-top whitespace-nowrap">
                {{ item.title }}
              </td>
              <td class="py-3 pr-4 align-top">
                <a :href="item.url" target="_blank" rel="noreferrer" class="text-primary hover:underline break-all">
                  {{ item.url }}
                </a>
              </td>
              <td class="py-3 pr-4 whitespace-nowrap align-top">
                {{ new Date(item.createdAt).toLocaleString('ru-RU') }}
              </td>
              <td class="py-3 align-top">
                <div class="flex items-center gap-2">
                  <UButton
                    size="xs"
                    color="neutral"
                    variant="soft"
                    icon="i-lucide-pencil"
                    @click="openEdit(item.id, item.title, item.url)"
                  >
                    Редактировать
                  </UButton>
                  <UButton
                    size="xs"
                    color="error"
                    variant="soft"
                    icon="i-lucide-trash"
                    @click="removeItem(item.id)"
                  >
                    Удалить
                  </UButton>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="md:hidden space-y-3">
        <div v-if="items.length === 0" class="py-4 text-center text-sm text-muted">
          Подписок пока нет
        </div>

        <UCard v-for="item in items" :key="item.id" variant="subtle">
          <div class="space-y-2">
            <p class="text-xs text-muted">
              Название
            </p>
            <p class="font-medium">
              {{ item.title }}
            </p>

            <p class="text-xs text-muted mt-2">
              Ссылка
            </p>
            <a :href="item.url" target="_blank" rel="noreferrer" class="text-primary hover:underline break-all">
              {{ item.url }}
            </a>

            <p class="text-xs text-muted mt-2">
              Дата добавления
            </p>
            <p>{{ new Date(item.createdAt).toLocaleString('ru-RU') }}</p>

            <div class="flex flex-wrap gap-2 pt-2">
              <UButton
                size="xs"
                color="neutral"
                variant="soft"
                icon="i-lucide-pencil"
                @click="openEdit(item.id, item.title, item.url)"
              >
                Редактировать
              </UButton>
              <UButton
                size="xs"
                color="error"
                variant="soft"
                icon="i-lucide-trash"
                @click="removeItem(item.id)"
              >
                Удалить
              </UButton>
            </div>
          </div>
        </UCard>
      </div>
    </UCard>

    <UModal v-model:open="isModalOpen" :title="editId ? 'Редактировать подписку' : 'Добавить подписку'">
      <template #body>
        <div class="space-y-3">
          <UFormField label="Название" required>
            <UInput v-model="formTitle" class="w-full" placeholder="Например: Основная VPN подписка" />
          </UFormField>
          <UFormField label="Ссылка на VPN подписку" required>
            <UInput v-model="formUrl" class="w-full" placeholder="https://sub.avtlk.ru/sub/..." />
          </UFormField>
        </div>
      </template>

      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton color="neutral" variant="ghost" @click="isModalOpen = false">
            Отмена
          </UButton>
          <UButton @click="submit">
            Сохранить
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>

