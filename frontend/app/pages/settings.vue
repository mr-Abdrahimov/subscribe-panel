<script setup lang="ts">
import type { AccordionItem } from '@nuxt/ui';
import * as yup from 'yup';

definePageMeta({
  layout: 'dashboard'
});

const settingsAccordionItems: AccordionItem[] = [
  {
    label: 'Приложения',
    icon: 'i-lucide-app-window',
    value: 'app-links',
    slot: 'app-links',
  },
  {
    label: 'Телеграм',
    icon: 'i-lucide-send',
    value: 'telegram',
    slot: 'telegram',
  },
  {
    label: 'Routing',
    icon: 'i-lucide-route',
    value: 'routing',
    slot: 'routing',
  },
];

const appLinkFormSchema = yup.object({
  name: yup.string().trim().required('Укажите название').max(120, 'Не более 120 символов'),
  urlTemplate: yup
    .string()
    .trim()
    .required('Укажите ссылку')
    .max(2000, 'Не более 2000 символов'),
});

const telegramSecretSchema = yup.string().max(256, 'Не более 256 символов');
const telegramGroupIdSchema = yup.string().max(64, 'Не более 64 символов');
const routingConfigSchema = yup.string().max(8000, 'Не более 8000 символов');

type PanelGlobalSettingsPayload = {
  subscriptionAnnounce: string | null;
  profileUpdateInterval: number | null;
  telegramBotSecret: string | null;
  telegramGroupId: string | null;
  routingConfig: string | null;
};

type AppLinkItem = {
  id: string;
  name: string;
  urlTemplate: string;
  sortOrder: number;
  createdAt: string;
};

const config = useRuntimeConfig();
const toast = useToast();
const appLinks = ref<AppLinkItem[]>([]);
const appLinksLoading = ref(false);
const appLinkSavingId = ref<string | null>(null);
const appLinkDeletingId = ref<string | null>(null);
const newAppLink = ref({ name: '', urlTemplate: '' });
const newAppLinkSaving = ref(false);

const telegramDraft = ref({ secret: '', groupId: '' });
const routingDraft = ref('');
const panelGlobalFormsLoading = ref(false);
const telegramSaving = ref(false);
const telegramTestLoading = ref(false);
const routingSaving = ref(false);

onMounted(() => {
  loadAppLinks();
  loadPanelGlobalSettingsForms();
});

async function loadPanelGlobalSettingsForms() {
  panelGlobalFormsLoading.value = true;
  try {
    const data = await $fetch<PanelGlobalSettingsPayload>(
      `${config.public.apiBaseUrl}/panel-global-settings`,
    );
    telegramDraft.value = {
      secret: data.telegramBotSecret ?? '',
      groupId: data.telegramGroupId ?? '',
    };
    routingDraft.value = data.routingConfig ?? '';
  } catch {
    toast.add({ title: 'Не удалось загрузить настройки панели', color: 'error' });
  } finally {
    panelGlobalFormsLoading.value = false;
  }
}

async function saveTelegramSettings() {
  try {
    await telegramSecretSchema.validate(telegramDraft.value.secret);
    await telegramGroupIdSchema.validate(telegramDraft.value.groupId);
  } catch (e) {
    if (e instanceof yup.ValidationError) {
      toast.add({ title: e.message, color: 'error' });
      return;
    }
    throw e;
  }
  telegramSaving.value = true;
  try {
    await $fetch<PanelGlobalSettingsPayload>(
      `${config.public.apiBaseUrl}/panel-global-settings`,
      {
        method: 'PATCH',
        body: {
          telegramBotSecret: telegramDraft.value.secret.trim(),
          telegramGroupId: telegramDraft.value.groupId.trim(),
        },
      },
    );
    toast.add({ title: 'Настройки Telegram сохранены', color: 'success' });
    await loadPanelGlobalSettingsForms();
  } catch {
    toast.add({ title: 'Не удалось сохранить', color: 'error' });
  } finally {
    telegramSaving.value = false;
  }
}

async function sendTelegramTest() {
  telegramTestLoading.value = true;
  try {
    await $fetch(`${config.public.apiBaseUrl}/panel-global-settings/telegram-test`, {
      method: 'POST',
      body: {},
    });
    toast.add({ title: 'Тестовое сообщение отправлено в Telegram', color: 'success' });
  } catch (err: unknown) {
    let msg = 'Проверьте токен, ID группы и что бот добавлен в чат';
    if (err && typeof err === 'object' && 'data' in err) {
      const d = (err as { data?: { message?: unknown } }).data?.message;
      if (typeof d === 'string') {
        msg = d;
      }
    }
    toast.add({ title: 'Ошибка отправки', description: msg, color: 'error' });
  } finally {
    telegramTestLoading.value = false;
  }
}

async function saveRoutingSettings() {
  try {
    await routingConfigSchema.validate(routingDraft.value);
  } catch (e) {
    if (e instanceof yup.ValidationError) {
      toast.add({ title: e.message, color: 'error' });
      return;
    }
    throw e;
  }
  routingSaving.value = true;
  try {
    await $fetch<PanelGlobalSettingsPayload>(
      `${config.public.apiBaseUrl}/panel-global-settings`,
      {
        method: 'PATCH',
        body: {
          routingConfig: routingDraft.value.trim(),
        },
      },
    );
    toast.add({ title: 'Routing сохранён', color: 'success' });
    await loadPanelGlobalSettingsForms();
  } catch {
    toast.add({ title: 'Не удалось сохранить', color: 'error' });
  } finally {
    routingSaving.value = false;
  }
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

      <template #telegram-body>
        <div class="space-y-4 pt-4">
          <p class="text-sm text-muted">
            Токен бота выдаётся в
            <a
              href="https://t.me/BotFather"
              target="_blank"
              rel="noopener noreferrer"
              class="text-primary underline underline-offset-2"
            >@BotFather</a>.
            ID группы (часто вида
            <code class="text-xs font-mono text-highlighted">-100…</code>) можно узнать через ботов вроде
            @userinfobot / @getidsbot, либо из ответов Bot API. Бот должен быть участником группы и иметь право писать сообщения.
          </p>
          <div v-if="panelGlobalFormsLoading" class="space-y-3">
            <USkeleton class="h-14 w-full rounded-lg" />
            <USkeleton class="h-14 w-full rounded-lg" />
          </div>
          <UCard v-else>
            <div class="space-y-3">
              <UFormField
                label="TG Secret"
                description="Секретный токен Telegram-бота (не публикуйте в открытый доступ)"
                class="w-full"
              >
                <UInput
                  v-model="telegramDraft.secret"
                  type="password"
                  class="w-full font-mono text-sm"
                  autocomplete="off"
                  placeholder="123456789:AAH…"
                />
              </UFormField>
              <UFormField
                label="TG group ID"
                description="Чат или группа, куда бот будет отправлять сообщения"
                class="w-full"
              >
                <UInput
                  v-model="telegramDraft.groupId"
                  class="w-full font-mono text-sm"
                  autocomplete="off"
                  placeholder="-1001234567890"
                />
              </UFormField>
            </div>
            <template #footer>
              <div class="flex flex-wrap items-center gap-2 justify-end w-full">
                <UButton
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  :disabled="telegramSaving || telegramTestLoading"
                  @click="loadPanelGlobalSettingsForms"
                >
                  Сбросить из сервера
                </UButton>
                <UButton
                  color="neutral"
                  variant="outline"
                  size="sm"
                  :loading="telegramTestLoading"
                  :disabled="telegramSaving || panelGlobalFormsLoading"
                  @click="sendTelegramTest"
                >
                  Отправить тест
                </UButton>
                <UButton
                  size="sm"
                  :loading="telegramSaving"
                  :disabled="telegramTestLoading || panelGlobalFormsLoading"
                  @click="saveTelegramSettings"
                >
                  Сохранить
                </UButton>
              </div>
            </template>
          </UCard>
        </div>
      </template>

      <template #routing-body>
        <div class="space-y-4 pt-4">
          <p class="text-sm text-muted">
            Ссылка Happ вида
            <code class="text-xs font-mono text-highlighted">happ://routing/…</code>
            (например с
            <a
              href="https://routing.happ.su/"
              target="_blank"
              rel="noopener noreferrer"
              class="text-primary underline underline-offset-2"
            >routing.happ.su</a>):
            при каждом обновлении подписки клиент получит её в HTTP-заголовке
            <code class="text-xs font-mono text-highlighted">routing</code>
            и в начале тела ленты (см.
            <a
              href="https://www.happ.su/main/ru/dev-docs/routing"
              target="_blank"
              rel="noopener noreferrer"
              class="text-primary underline underline-offset-2"
            >документацию Happ</a>).
            Несколько строк — каждая в теле ленты; в заголовок попадает первая непустая строка.
          </p>
          <div v-if="panelGlobalFormsLoading" class="space-y-3">
            <USkeleton class="h-32 w-full rounded-lg" />
          </div>
          <UCard v-else>
            <div class="space-y-3">
              <UFormField
                label="Конфигурация"
                description="До 8000 символов; пустое поле при сохранении очистит значение в БД"
                class="w-full"
              >
                <UTextarea
                  v-model="routingDraft"
                  :rows="8"
                  autoresize
                  class="w-full font-mono text-sm min-h-32"
                  placeholder="Вставьте или введите текст…"
                />
              </UFormField>
            </div>
            <template #footer>
              <div class="flex flex-wrap items-center gap-2 justify-end w-full">
                <UButton
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  :disabled="routingSaving"
                  @click="loadPanelGlobalSettingsForms"
                >
                  Сбросить из сервера
                </UButton>
                <UButton
                  size="sm"
                  :loading="routingSaving"
                  :disabled="panelGlobalFormsLoading"
                  @click="saveRoutingSettings"
                >
                  Сохранить
                </UButton>
              </div>
            </template>
          </UCard>
        </div>
      </template>
    </UAccordion>
  </div>
</template>
