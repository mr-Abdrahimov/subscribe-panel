<script setup lang="ts">
import * as yup from 'yup';

definePageMeta({
  layout: 'dashboard'
});

type GroupItem = {
  id: string;
  name: string;
  createdAt: string;
  subscriptionDisplayName: string | null;
};

const titleFieldSchema = yup.string().max(200, 'Не более 200 символов');

const config = useRuntimeConfig();
const toast = useToast();
const groups = ref<GroupItem[]>([]);
const loading = ref(false);
const draftTitles = ref<Record<string, string>>({});
const savingId = ref<string | null>(null);

onMounted(() => {
  loadGroups();
});

async function loadGroups() {
  loading.value = true;
  try {
    const data = await $fetch<GroupItem[]>(`${config.public.apiBaseUrl}/groups`);
    groups.value = data;
    const next: Record<string, string> = {};
    for (const g of data) {
      next[g.id] = g.subscriptionDisplayName ?? '';
    }
    draftTitles.value = next;
  } catch {
    toast.add({ title: 'Не удалось загрузить группы', color: 'error' });
  } finally {
    loading.value = false;
  }
}

function resetDraft(group: GroupItem) {
  draftTitles.value = {
    ...draftTitles.value,
    [group.id]: group.subscriptionDisplayName ?? ''
  };
}

async function saveGroupTitle(groupId: string) {
  const raw = draftTitles.value[groupId] ?? '';
  try {
    await titleFieldSchema.validate(raw);
  } catch (e) {
    if (e instanceof yup.ValidationError) {
      toast.add({ title: e.message, color: 'error' });
      return;
    }
    throw e;
  }
  const trimmed = raw.trim();
  const toSend = trimmed === '' ? null : trimmed;

  savingId.value = groupId;
  try {
    await $fetch(`${config.public.apiBaseUrl}/groups/${groupId}`, {
      method: 'PATCH',
      body: { subscriptionDisplayName: toSend }
    });
    toast.add({ title: 'Настройки группы сохранены', color: 'success' });
    await loadGroups();
  } catch {
    toast.add({ title: 'Не удалось сохранить настройки', color: 'error' });
  } finally {
    savingId.value = null;
  }
}
</script>

<template>
  <div class="space-y-6">
    <div>
      <h2 class="text-xl font-semibold">
        Настройки
      </h2>
      <p class="mt-1 text-sm text-muted">
        Параметры ниже задаются отдельно для каждой группы пользователей панели.
      </p>
    </div>

    <UCard>
      <template #header>
        <div class="space-y-1">
          <h3 class="text-base font-semibold">
            Название
          </h3>
          <p class="text-sm text-muted">
            Используется как «название подписки»: заголовок страницы <code class="text-xs font-mono text-highlighted">/sub/…</code>, при запросе ленты — <code class="text-xs font-mono text-highlighted">profile-title*</code> (RFC 5987) и при необходимости <code class="text-xs font-mono text-highlighted">profile-title</code> (только ASCII).
            Имена отдельных серверов в клиенте (фрагмент # в каждой строке) всегда берутся из поля «Название» коннекта в панели (БД).
          </p>
        </div>
      </template>

      <div v-if="loading" class="space-y-3">
        <USkeleton class="h-24 w-full rounded-lg" />
        <USkeleton class="h-24 w-full rounded-lg" />
      </div>

      <div v-else-if="groups.length === 0" class="text-sm text-muted">
        Сначала создайте группы на странице «Группы».
      </div>

      <div v-else class="space-y-4">
        <UCard
          v-for="group in groups"
          :key="group.id"
        >
          <template #header>
            <div class="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p class="text-xs text-muted">
                  Группа
                </p>
                <p class="font-medium">
                  {{ group.name }}
                </p>
              </div>
            </div>
          </template>

          <UFormField
            label="Название для публичной подписки"
            description="Подписка / profile-title и страница /sub, не подменяет имена коннектов в ленте"
            class="w-full"
          >
            <UInput
              v-model="draftTitles[group.id]"
              class="w-full"
              placeholder="Например: Рабочий VPN"
            />
          </UFormField>

          <template #footer>
            <div class="flex flex-wrap gap-2 justify-end w-full">
              <UButton
                color="neutral"
                variant="ghost"
                size="sm"
                :disabled="savingId === group.id"
                @click="resetDraft(group)"
              >
                Сбросить
              </UButton>
              <UButton
                size="sm"
                :loading="savingId === group.id"
                @click="saveGroupTitle(group.id)"
              >
                Сохранить
              </UButton>
            </div>
          </template>
        </UCard>
      </div>
    </UCard>
  </div>
</template>
