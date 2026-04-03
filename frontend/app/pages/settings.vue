<script setup lang="ts">
import type { AccordionItem } from '@nuxt/ui';
import * as yup from 'yup';

definePageMeta({
  layout: 'dashboard'
});

const settingsAccordionItems: AccordionItem[] = [
  {
    label: 'Название',
    icon: 'i-lucide-tags',
    value: 'group-titles',
    slot: 'group-titles',
  },
  {
    label: 'Приложения',
    icon: 'i-lucide-app-window',
    value: 'app-links',
    slot: 'app-links',
  },
];

type GroupItem = {
  id: string;
  name: string;
  createdAt: string;
  subscriptionDisplayName: string | null;
};

const titleFieldSchema = yup.string().max(200, 'Не более 200 символов');

const appLinkFormSchema = yup.object({
  name: yup.string().trim().required('Укажите название').max(120, 'Не более 120 символов'),
  urlTemplate: yup
    .string()
    .trim()
    .required('Укажите ссылку')
    .max(2000, 'Не более 2000 символов'),
});

type AppLinkItem = {
  id: string;
  name: string;
  urlTemplate: string;
  sortOrder: number;
  createdAt: string;
};

const config = useRuntimeConfig();
const toast = useToast();
const groups = ref<GroupItem[]>([]);
const loading = ref(false);
const draftTitles = ref<Record<string, string>>({});
const savingId = ref<string | null>(null);

const appLinks = ref<AppLinkItem[]>([]);
const appLinksLoading = ref(false);
const appLinkSavingId = ref<string | null>(null);
const appLinkDeletingId = ref<string | null>(null);
const newAppLink = ref({ name: '', urlTemplate: '' });
const newAppLinkSaving = ref(false);

onMounted(() => {
  loadGroups();
  loadAppLinks();
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

async function loadAppLinks() {
  appLinksLoading.value = true;
  try {
    appLinks.value = await $fetch<AppLinkItem[]>(
      `${config.public.apiBaseUrl}/subscription-app-links`,
    );
  } catch {
    toast.add({ title: 'Не удалось загрузить приложения', color: 'error' });
  } finally {
    appLinksLoading.value = false;
  }
}

async function saveAppLink(link: AppLinkItem) {
  try {
    await appLinkFormSchema.validate({
      name: link.name,
      urlTemplate: link.urlTemplate,
    });
  } catch (e) {
    if (e instanceof yup.ValidationError) {
      toast.add({ title: e.message, color: 'error' });
      return;
    }
    throw e;
  }
  appLinkSavingId.value = link.id;
  try {
    await $fetch(`${config.public.apiBaseUrl}/subscription-app-links/${link.id}`, {
      method: 'PATCH',
      body: {
        name: link.name.trim(),
        urlTemplate: link.urlTemplate.trim(),
      },
    });
    toast.add({ title: 'Сохранено', color: 'success' });
    await loadAppLinks();
  } catch {
    toast.add({ title: 'Не удалось сохранить', color: 'error' });
  } finally {
    appLinkSavingId.value = null;
  }
}

async function deleteAppLink(id: string) {
  appLinkDeletingId.value = id;
  try {
    await $fetch(`${config.public.apiBaseUrl}/subscription-app-links/${id}`, {
      method: 'DELETE',
    });
    toast.add({ title: 'Удалено', color: 'success' });
    await loadAppLinks();
  } catch {
    toast.add({ title: 'Не удалось удалить', color: 'error' });
  } finally {
    appLinkDeletingId.value = null;
  }
}

async function createAppLink() {
  try {
    await appLinkFormSchema.validate(newAppLink.value);
  } catch (e) {
    if (e instanceof yup.ValidationError) {
      toast.add({ title: e.message, color: 'error' });
      return;
    }
    throw e;
  }
  newAppLinkSaving.value = true;
  try {
    await $fetch(`${config.public.apiBaseUrl}/subscription-app-links`, {
      method: 'POST',
      body: {
        name: newAppLink.value.name.trim(),
        urlTemplate: newAppLink.value.urlTemplate.trim(),
      },
    });
    toast.add({ title: 'Приложение добавлено', color: 'success' });
    newAppLink.value = { name: '', urlTemplate: '' };
    await loadAppLinks();
  } catch {
    toast.add({ title: 'Не удалось добавить', color: 'error' });
  } finally {
    newAppLinkSaving.value = false;
  }
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
  <div class="cosmic-app space-y-6">
    <div>
      <h2 class="cosmic-h2">
        Настройки
      </h2>
      <p class="mt-1 text-sm text-muted">
        Разделы свёрнуты в аккордеон; откройте нужный, чтобы изменить настройки.
      </p>
    </div>

    <UAccordion
      type="multiple"
      :items="settingsAccordionItems"
      :unmount-on-hide="false"
      class="w-full space-y-3"
      :ui="{
        item: 'border border-default rounded-xl overflow-hidden bg-elevated/30',
        header: 'px-4 py-3 sm:px-5',
        trigger: 'text-base font-semibold',
        body: 'px-4 pb-4 pt-0 sm:px-5 border-t border-default/60',
      }"
    >
      <template #group-titles-body>
        <div class="space-y-4 pt-4">
          <p class="text-sm text-muted">
            Для пользователей панели по группе (<code class="text-xs font-mono text-highlighted">groupName</code>): заголовок
            <code class="text-xs font-mono text-highlighted">/sub/…</code>,
            <code class="text-xs font-mono text-highlighted">profile-title</code>
            и
            <code class="text-xs font-mono text-highlighted">#profile-title</code>
            в ленте Happ — из этого поля (до 25 символов). Имена серверов в URI — из коннектов.
            Объявление Happ и интервал обновления настраиваются на странице «Группы».
          </p>
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
                description="Профиль подписки: /sub и profile-title; имена в строках ленты — из коннектов"
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
        </div>
      </template>

      <template #app-links-body>
        <div class="space-y-4 pt-4">
          <p class="text-sm text-muted">
            Ссылки на публичной странице
            <code class="text-xs font-mono text-highlighted">/sub/…</code>.
            <code class="text-xs font-mono text-highlighted">{link}</code> — URL подписки без секрета;
            <code class="text-xs font-mono text-highlighted">{crypto}</code> —
            <code class="text-xs font-mono text-highlighted">happ://…</code>
            из crypto.happ.su. Плейсхолдеры необязательны.
          </p>
          <div v-if="appLinksLoading" class="space-y-3">
            <USkeleton class="h-20 w-full rounded-lg" />
          </div>
          <div v-else class="space-y-4">
            <UCard
              v-for="link in appLinks"
              :key="link.id"
            >
              <div class="space-y-3">
                <UFormField
                  label="Название"
                  class="w-full"
                >
                  <UInput
                    v-model="link.name"
                    class="w-full"
                    placeholder="Например: Happ"
                  />
                </UFormField>
                <UFormField
                  label="Ссылка"
                  description="{link} — URL подписки; {crypto} — happ://… из crypto.happ.su для этого пользователя"
                  class="w-full"
                >
                  <UInput
                    v-model="link.urlTemplate"
                    class="w-full font-mono text-sm"
                    placeholder="happ://import-remote-profile?url={crypto}"
                  />
                </UFormField>
              </div>
              <template #footer>
                <div class="flex flex-wrap gap-2 justify-end w-full">
                  <UButton
                    color="error"
                    variant="ghost"
                    size="sm"
                    :loading="appLinkDeletingId === link.id"
                    :disabled="appLinkSavingId === link.id"
                    @click="deleteAppLink(link.id)"
                  >
                    Удалить
                  </UButton>
                  <UButton
                    size="sm"
                    :loading="appLinkSavingId === link.id"
                    :disabled="appLinkDeletingId === link.id"
                    @click="saveAppLink(link)"
                  >
                    Сохранить
                  </UButton>
                </div>
              </template>
            </UCard>

            <UCard>
              <p class="text-sm font-medium text-muted mb-3">
                Добавить приложение
              </p>
              <div class="space-y-3">
                <UFormField
                  label="Название"
                  class="w-full"
                >
                  <UInput
                    v-model="newAppLink.name"
                    class="w-full"
                    placeholder="Название"
                  />
                </UFormField>
                <UFormField
                  label="Ссылка"
                  description="{link} и/или {crypto} — см. текст выше"
                  class="w-full"
                >
                  <UInput
                    v-model="newAppLink.urlTemplate"
                    class="w-full font-mono text-sm"
                    placeholder="happ://import-remote-profile?url={crypto}"
                  />
                </UFormField>
              </div>
              <template #footer>
                <div class="flex justify-end">
                  <UButton
                    :loading="newAppLinkSaving"
                    @click="createAppLink"
                  >
                    Добавить
                  </UButton>
                </div>
              </template>
            </UCard>
          </div>
        </div>
      </template>
    </UAccordion>
  </div>
</template>
