<script setup lang="ts">
import type { PublicUserResponse } from '~/types/api'
import { useDebounceFn } from '@vueuse/core'
import {
  useSortable,
  moveArrayElement,
} from '@vueuse/integrations/useSortable'

definePageMeta({
  layout: 'sub',
  middleware: ['sub-public-segment'],
  /** Только тёмная тема на публичной странице подписки (без переключателя) */
  colorMode: 'dark',
})

const route = useRoute()
const config = useRuntimeConfig()
const requestURL = useRequestURL()

const cryptoPathSegment = computed(() =>
  String(config.public.subscriptionCryptoPath ?? 'sub2128937123')
    .trim()
    .replace(/^\/+|\/+$/g, ''),
)

const subSegment = computed(() => String(route.params.subSegment ?? '').trim())
const code = computed(() => String(route.params.code ?? ''))

const isCryptoPageRoute = computed(
  () => subSegment.value === cryptoPathSegment.value,
)

const publicUserUrl = computed(() => {
  const base = String(config.public.apiBaseUrl ?? '').replace(/\/$/, '')
  return `${base}/public/users/${encodeURIComponent(code.value)}`
})

const { data, pending, error } = await useFetch<PublicUserResponse>(publicUserUrl, {
  watch: [code],
})

type SubscriptionGroupPref = { name: string; include: boolean }

const displayName = computed(() => data.value?.name ?? '')
const groupLabels = computed(() => data.value?.groups ?? [])

/** Активные коннекты с тегом группы (как в ленте Happ). */
function activeConnectCountForGroup(groupName: string): number {
  const m = data.value?.groupActiveConnectCountByName
  if (!m || typeof m !== 'object') {
    return 0
  }
  const n = m[groupName]
  return typeof n === 'number' && Number.isFinite(n) ? n : 0
}

const membershipGroups = computed(
  () => data.value?.subscriptionGroups ?? ([] as SubscriptionGroupPref[]),
)

const localGroupPrefs = ref<SubscriptionGroupPref[]>([])
const sortableGroupsEl = ref<HTMLElement | null>(null)
const groupPrefsSaving = ref(false)
const groupPrefsSaveError = ref<string | null>(null)

watch(
  () => [code.value, data.value?.subscriptionGroups] as const,
  () => {
    const list = data.value?.subscriptionGroups
    if (list?.length) {
      localGroupPrefs.value = list.map((g) => ({
        name: g.name,
        include: g.include !== false,
      }))
    } else {
      localGroupPrefs.value = []
    }
  },
  { immediate: true },
)

const sortableGroupList = useSortable(sortableGroupsEl, localGroupPrefs, {
  handle: '.cp__group-drag',
  animation: 160,
  onUpdate: (e) => {
    moveArrayElement(localGroupPrefs, e.oldIndex!, e.newIndex!, e)
    void nextTick(() => schedulePersistGroupPrefs())
  },
})

watch(
  () => membershipGroups.value.length > 0,
  (ok) => {
    void nextTick(() => {
      try {
        sortableGroupList.option('disabled', !ok)
      } catch {
        /* список ещё не смонтирован */
      }
    })
  },
  { immediate: true },
)

const persistGroupPrefs = useDebounceFn(async () => {
  if (!localGroupPrefs.value.length) {
    return
  }
  const base = String(config.public.apiBaseUrl ?? '').replace(/\/$/, '')
  const url = `${base}/public/users/${encodeURIComponent(code.value)}/subscription-group-prefs`
  groupPrefsSaving.value = true
  groupPrefsSaveError.value = null
  try {
    const res = await $fetch<{ subscriptionGroups: SubscriptionGroupPref[] }>(url, {
      method: 'PATCH',
      body: { groups: localGroupPrefs.value },
    })
    if (data.value && res.subscriptionGroups?.length) {
      data.value.subscriptionGroups = res.subscriptionGroups.map((g) => ({
        name: g.name,
        include: g.include !== false,
      }))
    }
  } catch (err: unknown) {
    let msg = ''
    if (err && typeof err === 'object') {
      const d = (err as { data?: { message?: unknown } }).data?.message
      if (Array.isArray(d)) {
        msg = d.join(', ')
      } else if (typeof d === 'string') {
        msg = d
      }
    }
    groupPrefsSaveError.value = msg || 'Не удалось сохранить настройки групп.'
    useToast().add({
      title: 'Ошибка сохранения групп',
      description: groupPrefsSaveError.value,
      color: 'error',
    })
  } finally {
    groupPrefsSaving.value = false
  }
}, 500)

function schedulePersistGroupPrefs() {
  void persistGroupPrefs()
}

function onToggleGroupInclude() {
  schedulePersistGroupPrefs()
}
const appLinks = computed(() => data.value?.appLinks ?? [])
const cryptoOnlySubscription = computed(
  () => data.value?.cryptoOnlySubscription === true,
)

const happCryptoUrl = computed(() => {
  const u = (data.value?.happCryptoUrl ?? '').trim()
  return u.startsWith('happ://') ? u : ''
})

const cryptoInputPlaceholder = 'Нет happ:// — создайте в панели'

const headTitle = computed(() => {
  const u = displayName.value
  return u ? `${u} — VPN-подписка` : 'VPN-подписка'
})

const pageOrigin = computed(() => {
  const fromEnv = String(config.public.siteUrl || '').replace(/\/$/, '')
  if (fromEnv) {
    return fromEnv
  }
  return requestURL.origin
})

const canonicalUrl = computed(() => {
  const seg = isCryptoPageRoute.value ? cryptoPathSegment.value : 'sub'
  return `${pageOrigin.value}/${seg}/${encodeURIComponent(code.value)}`
})

const seoDescription = computed(() =>
  displayName.value
    ? `Персональная страница VPN-подписки: ${displayName.value}. Добавьте ссылку в Happ или другом клиенте; здесь — группы серверов и приложения.`
    : 'Персональная страница VPN-подписки. Добавьте ссылку в приложении-клиенте для импорта профиля.',
)

const ogImageAbsolute = computed(() => `${pageOrigin.value}/og-share.jpg`)

useHead({
  title: headTitle,
  link: [{ rel: 'canonical', href: canonicalUrl }],
})

useSeoMeta({
  title: headTitle,
  description: seoDescription,
  ogTitle: headTitle,
  ogDescription: seoDescription,
  ogType: 'website',
  ogUrl: canonicalUrl,
  ogLocale: 'ru_RU',
  ogSiteName: 'Subscribe Panel',
  ogImage: ogImageAbsolute,
  twitterCard: 'summary_large_image',
  twitterTitle: headTitle,
  twitterDescription: seoDescription,
  twitterImage: ogImageAbsolute,
})

function selectCryptoInput(ev: FocusEvent) {
  const el = ev.target
  if (el instanceof HTMLInputElement) {
    el.select()
  }
}

async function copyCryptoLink() {
  const url = happCryptoUrl.value
  if (!url) {
    useToast().add({
      title: 'Нет happ:// ссылки — создайте crypto в панели администратора',
      color: 'warning',
    })
    return
  }
  try {
    await navigator.clipboard.writeText(url)
    useToast().add({ title: 'Crypto-ссылка (happ://) скопирована', color: 'success' })
  } catch {
    useToast().add({ title: 'Не удалось скопировать', color: 'error' })
  }
}
</script>

<template>
  <div class="cp">
    <div v-if="pending" class="cp__state">
      <div class="cp__loader">
        <span class="cp__loader-ring" />
        <span class="cp__loader-text">СИНХРОНИЗАЦИЯ…</span>
      </div>
    </div>

    <div v-else-if="error || !data" class="cp__state cp__state--err">
      <div class="cp__panel cp__panel--narrow">
        <p class="cp__err-code">ERR_404</p>
        <h1 class="cp__err-title">НЕТ ДАННЫХ</h1>
        <p class="cp__err-hint">Проверьте ссылку или обратитесь к администратору.</p>
      </div>
    </div>

    <div v-else class="cp__content">
      <header class="cp__header">
        <div class="cp__brand">
          <span class="cp__brand-dot" />
          <span class="cp__brand-label">SUB.NET // PUBLIC NODE</span>
        </div>
        <div class="cp__header-meta">
          <span class="cp__chip cp__chip--cyan">LIVE</span>
          <span class="cp__chip cp__chip--muted">{{ code.slice(0, 8) }}…</span>
        </div>
      </header>

      <div class="cp__panel">
        <div class="cp__panel-corner cp__panel-corner--tl" />
        <div class="cp__panel-corner cp__panel-corner--tr" />
        <div class="cp__panel-corner cp__panel-corner--bl" />
        <div class="cp__panel-corner cp__panel-corner--br" />

        <div class="cp__hero">
          <p class="cp__eyebrow">ОПЕРАТОР</p>
          <h1 class="cp__title">{{ displayName || '—' }}</h1>
          <p class="cp__sub">Канал подписки · шифрование end-to-edge</p>
        </div>

        <div
          v-if="cryptoOnlySubscription && !isCryptoPageRoute"
          class="cp__notice"
          role="status"
        >
          <p class="cp__notice-title">Только Cripto</p>
          <p class="cp__notice-text">
            Рабочий импорт в Happ — через
            <strong class="cp__notice-strong">happ:// crypto-ссылку</strong>
          </p>
        </div>

        <div class="cp__url-block">
          <label class="cp__label" for="cp-happ-crypto-input">ENDPOINT · HAPP CRYPTO</label>
          <div class="cp__url-row">
            <input
              id="cp-happ-crypto-input"
              type="text"
              class="cp__url-input"
              readonly
              tabindex="0"
              :value="happCryptoUrl"
              :placeholder="cryptoInputPlaceholder"
              aria-label="Happ crypto-ссылка для копирования"
              @focus="selectCryptoInput"
            />
            <button type="button" class="cp__btn cp__btn--ghost" @click="copyCryptoLink">
              КОПИРОВАТЬ
            </button>
          </div>
          <p class="cp__url-hint">
            Импорт в Happ — вставьте скопированную happ:// ссылку; обычный https здесь не используется.
          </p>
        </div>

        <section class="cp__section cp__section--apps" aria-labelledby="cp-apps-heading">
          <div class="cp__apps-shell">
            <h2 id="cp-apps-heading" class="cp__section-title cp__section-title--lg">
              <span class="cp__section-marker cp__section-marker--magenta" />
              ПРИЛОЖЕНИЯ
            </h2>
            <p class="cp__section-desc">
              Быстрые ссылки для скачивания и установки профиля в Happ и другие клиенты.
            </p>

            <ul v-if="appLinks.length" class="cp__apps">
              <li v-for="(app, i) in appLinks" :key="`${app.name}-${i}`" class="cp__app">
                <a
                  class="cp__app-row"
                  :href="app.url"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span class="cp__app-name">{{ app.name }}</span>
                  <span class="cp__app-cta">
                    ОТКРЫТЬ
                    <span class="cp__app-arrow" aria-hidden="true">↗</span>
                  </span>
                </a>
              </li>
            </ul>

            <div v-else class="cp__apps-empty">
              <p class="cp__apps-empty-title">
                ССЫЛОК НЕТ
              </p>
              <p class="cp__apps-empty-text">
                Администратор может добавить их в панели:
                <strong class="cp__apps-empty-strong">Настройки</strong>
                →
                <strong class="cp__apps-empty-strong">Приложения</strong>
                — они появятся здесь для страниц подписки
                <span class="cp__code-inline">/sub/…</span>
              </p>
            </div>
          </div>
        </section>

        <section
          v-if="membershipGroups.length || groupLabels.length"
          class="cp__section"
          aria-labelledby="cp-groups-heading"
        >
          <h2 id="cp-groups-heading" class="cp__section-title">
            <span class="cp__section-marker" />
            ГРУППЫ
          </h2>
          <p v-if="membershipGroups.length" class="cp__section-desc cp__section-desc--tight cp__section-desc--groups">
            Потяните за ручку слева, чтобы поменять порядок. «В подписке» — показывать коннекты группы в ленте;
            если коннект в нескольких группах, он попадёт в первую включённую по списку.
          </p>

          <p v-if="groupPrefsSaveError && membershipGroups.length" class="cp__group-save-err">
            {{ groupPrefsSaveError }}
          </p>

          <div
            v-if="membershipGroups.length"
            class="cp__group-list-shell"
          >
            <Transition name="cp-group-saving-chip">
              <div
                v-if="groupPrefsSaving"
                class="cp__group-saving-chip"
                role="status"
                aria-live="polite"
              >
                <span class="cp__group-saving-dot" aria-hidden="true" />
                Сохранение
              </div>
            </Transition>
            <ul
              ref="sortableGroupsEl"
              class="cp__group-list"
              aria-label="Группы, порядок и включение в подписку"
            >
            <li
              v-for="g in localGroupPrefs"
              :key="g.name"
              class="cp__group-card"
            >
              <button
                type="button"
                class="cp__group-drag"
                aria-label="Переместить группу"
              >
                <span class="cp__group-drag-icon" aria-hidden="true">⋮⋮</span>
              </button>
              <div class="cp__group-name-block">
                <span class="cp__group-name">{{ g.name }}</span>
                <span
                  class="cp__group-connect-count"
                  :aria-label="`${activeConnectCountForGroup(g.name)} доступных коннектов`"
                >
                  {{ activeConnectCountForGroup(g.name) }}
                </span>
              </div>
              <UCheckbox
                :model-value="g.include"
                class="cp__group-check"
                :ui="{ label: 'text-[0.7rem] uppercase tracking-wider text-white/80' }"
                label="В подписке"
                @update:model-value="
                  (v) => {
                    if (typeof v === 'boolean') {
                      g.include = v
                      onToggleGroupInclude()
                    }
                  }
                "
              />
            </li>
          </ul>
          </div>

          <ul v-else class="cp__tags">
            <li v-for="tag in groupLabels" :key="tag" class="cp__tag">
              <span class="cp__tag-label">{{ tag }}</span>
              <span
                class="cp__tag-count"
                :aria-label="`${activeConnectCountForGroup(tag)} доступных коннектов`"
              >
                {{ activeConnectCountForGroup(tag) }}
              </span>
            </li>
          </ul>
        </section>

        <footer class="cp__footer">
          <span class="cp__footer-line" />
          <p class="cp__footer-text">© 2030 · NEURAL UPLINK INTERFACE</p>
        </footer>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cp {
  width: 100%;
  max-width: 36rem;
  font-family: 'Rajdhani', system-ui, sans-serif;
  --cp-cyan: #00f5ff;
  --cp-magenta: #ff00aa;
  --cp-yellow: #f5e000;
  --cp-violet: #bc13fe;
  --cp-surface: rgba(8, 12, 24, 0.75);
  --cp-border: rgba(0, 245, 255, 0.35);
  --cp-glow: 0 0 24px rgba(0, 245, 255, 0.15);
}

.cp__state {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 40vh;
  width: 100%;
}

.cp__loader {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.25rem;
}

.cp__loader-ring {
  width: 3rem;
  height: 3rem;
  border: 2px solid rgba(0, 245, 255, 0.2);
  border-top-color: var(--cp-cyan);
  border-radius: 50%;
  animation: cp-spin 0.9s linear infinite;
  box-shadow: var(--cp-glow);
}

@keyframes cp-spin {
  to {
    transform: rotate(360deg);
  }
}

.cp__loader-text {
  font-family: 'Share Tech Mono', monospace;
  font-size: 0.75rem;
  letter-spacing: 0.2em;
  color: var(--cp-cyan);
  text-shadow: 0 0 12px rgba(0, 245, 255, 0.5);
}

.cp__state--err .cp__err-code {
  font-family: 'Share Tech Mono', monospace;
  font-size: 0.8rem;
  color: var(--cp-magenta);
  margin: 0 0 0.5rem;
  letter-spacing: 0.15em;
}

.cp__err-title {
  font-family: 'Orbitron', sans-serif;
  font-weight: 900;
  font-size: 1.5rem;
  margin: 0 0 0.75rem;
  color: #fff;
  text-shadow: 0 0 20px rgba(255, 0, 170, 0.4);
}

.cp__err-hint {
  margin: 0;
  font-size: 1rem;
  color: rgba(232, 244, 255, 0.65);
  line-height: 1.5;
}

.cp__content {
  width: 100%;
}

.cp__header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 1.25rem;
}

.cp__brand {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.cp__brand-dot {
  width: 0.5rem;
  height: 0.5rem;
  background: var(--cp-cyan);
  border-radius: 1px;
  box-shadow: 0 0 10px var(--cp-cyan);
  animation: cp-pulse 2s ease-in-out infinite;
}

@keyframes cp-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}

.cp__brand-label {
  font-family: 'Share Tech Mono', monospace;
  font-size: 0.65rem;
  letter-spacing: 0.18em;
  color: rgba(232, 244, 255, 0.55);
}

.cp__header-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.cp__chip {
  font-family: 'Share Tech Mono', monospace;
  font-size: 0.65rem;
  padding: 0.25rem 0.5rem;
  border: 1px solid rgba(255, 255, 255, 0.15);
  letter-spacing: 0.1em;
}

.cp__chip--cyan {
  border-color: var(--cp-cyan);
  color: var(--cp-cyan);
  box-shadow: inset 0 0 12px rgba(0, 245, 255, 0.08);
}

.cp__chip--muted {
  color: rgba(232, 244, 255, 0.45);
}

.cp__panel {
  position: relative;
  background: var(--cp-surface);
  border: 1px solid var(--cp-border);
  padding: clamp(1.25rem, 4vw, 2rem);
  backdrop-filter: blur(12px);
  box-shadow:
    var(--cp-glow),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);
}

.cp__panel--narrow {
  max-width: 22rem;
  margin: 0 auto;
}

.cp__panel-corner {
  position: absolute;
  width: 12px;
  height: 12px;
  border-color: var(--cp-cyan);
  border-style: solid;
  pointer-events: none;
  opacity: 0.85;
}

.cp__panel-corner--tl {
  top: -1px;
  left: -1px;
  border-width: 2px 0 0 2px;
}

.cp__panel-corner--tr {
  top: -1px;
  right: -1px;
  border-width: 2px 2px 0 0;
}

.cp__panel-corner--bl {
  bottom: -1px;
  left: -1px;
  border-width: 0 0 2px 2px;
}

.cp__panel-corner--br {
  bottom: -1px;
  right: -1px;
  border-width: 0 2px 2px 0;
}

.cp__notice {
  margin-bottom: 1.25rem;
  padding: 0.85rem 1rem;
  border: 1px solid rgba(245, 224, 0, 0.45);
  background: rgba(245, 224, 0, 0.06);
  box-shadow: 0 0 20px rgba(245, 224, 0, 0.08);
}

.cp__notice-title {
  margin: 0 0 0.4rem;
  font-family: 'Orbitron', sans-serif;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  color: var(--cp-yellow);
}

.cp__notice-text {
  margin: 0;
  font-size: 0.85rem;
  line-height: 1.55;
  color: rgba(232, 244, 255, 0.72);
}

.cp__notice-strong {
  color: #fff;
  font-weight: 600;
}

.cp__hero {
  margin-bottom: 1.5rem;
  padding-bottom: 1.25rem;
  border-bottom: 1px solid rgba(0, 245, 255, 0.12);
}

.cp__eyebrow {
  font-family: 'Share Tech Mono', monospace;
  font-size: 0.7rem;
  letter-spacing: 0.25em;
  color: var(--cp-magenta);
  margin: 0 0 0.35rem;
}

.cp__title {
  font-family: 'Orbitron', sans-serif;
  font-weight: 700;
  font-size: clamp(1.5rem, 5vw, 2rem);
  line-height: 1.15;
  margin: 0 0 0.5rem;
  color: #fff;
  text-shadow:
    0 0 40px rgba(0, 245, 255, 0.25),
    0 0 2px rgba(255, 255, 255, 0.3);
}

.cp__sub {
  margin: 0;
  font-size: 0.95rem;
  color: rgba(232, 244, 255, 0.55);
  font-weight: 500;
}

.cp__url-block {
  margin-bottom: 1.5rem;
}

.cp__url-hint {
  margin: 0.55rem 0 0;
  font-size: 0.78rem;
  line-height: 1.45;
  color: rgba(232, 244, 255, 0.48);
  font-weight: 500;
}

.cp__label {
  display: block;
  font-family: 'Share Tech Mono', monospace;
  font-size: 0.65rem;
  letter-spacing: 0.2em;
  color: rgba(232, 244, 255, 0.45);
  margin-bottom: 0.5rem;
}

.cp__url-row {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  align-items: stretch;
  gap: 0.45rem;
  min-width: 0;
}

.cp__url-input {
  box-sizing: border-box;
  flex: 1 1 0;
  min-width: 0;
  width: 0;
  height: 2.25rem;
  padding: 0 0.5rem;
  font-family: 'Share Tech Mono', monospace;
  font-size: 0.65rem;
  line-height: 1.2;
  color: var(--cp-cyan);
  background: rgba(0, 0, 0, 0.45);
  border: 1px solid rgba(0, 245, 255, 0.2);
  border-radius: 2px;
  outline: none;
  white-space: nowrap;
  overflow-x: auto;
  overflow-y: hidden;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: thin;
}

.cp__url-input::placeholder {
  color: rgba(232, 244, 255, 0.38);
  font-size: 0.62rem;
}

.cp__url-input:focus {
  border-color: rgba(0, 245, 255, 0.42);
  box-shadow: 0 0 0 1px rgba(0, 245, 255, 0.12);
}

.cp__url-row .cp__btn {
  flex: 0 0 auto;
  align-self: stretch;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding-left: 0.65rem;
  padding-right: 0.65rem;
}

.cp__btn {
  font-family: 'Orbitron', sans-serif;
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  padding: 0.65rem 1rem;
  border: none;
  cursor: pointer;
  white-space: nowrap;
  transition:
    transform 0.15s ease,
    box-shadow 0.15s ease;
}

.cp__btn--ghost {
  background: linear-gradient(135deg, rgba(255, 0, 170, 0.2), rgba(188, 19, 254, 0.15));
  color: var(--cp-yellow);
  border: 1px solid rgba(255, 0, 170, 0.5);
  box-shadow: 0 0 16px rgba(255, 0, 170, 0.15);
}

.cp__btn--ghost:hover {
  transform: translateY(-1px);
  box-shadow: 0 0 24px rgba(255, 0, 170, 0.35);
}

.cp__btn--ghost:active {
  transform: translateY(0);
}

.cp__section {
  margin-bottom: 1.5rem;
}

.cp__section-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-family: 'Orbitron', sans-serif;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.2em;
  color: rgba(232, 244, 255, 0.9);
  margin: 0 0 0.85rem;
}

.cp__section-marker {
  width: 3px;
  height: 1rem;
  background: var(--cp-cyan);
  box-shadow: 0 0 10px var(--cp-cyan);
}

.cp__section-marker--magenta {
  background: var(--cp-magenta);
  box-shadow: 0 0 10px var(--cp-magenta);
}

.cp__section--apps {
  margin-bottom: 1.5rem;
}

.cp__apps-shell {
  padding: 1rem 1rem 1.1rem;
  border: 1px solid rgba(255, 0, 170, 0.45);
  background:
    linear-gradient(145deg, rgba(188, 19, 254, 0.09) 0%, transparent 55%),
    rgba(0, 0, 0, 0.35);
  box-shadow:
    0 0 0 1px rgba(0, 245, 255, 0.08),
    0 0 32px rgba(255, 0, 170, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.04);
}

.cp__section-title--lg {
  font-size: 0.82rem;
  margin-bottom: 0.6rem;
}

.cp__section-desc {
  margin: 0 0 1.1rem;
  font-size: 0.82rem;
  line-height: 1.55;
  color: rgba(232, 244, 255, 0.62);
  font-weight: 500;
}

.cp__code-inline {
  font-family: 'Share Tech Mono', monospace;
  font-size: 0.78em;
  padding: 0.1em 0.35em;
  border: 1px solid rgba(0, 245, 255, 0.35);
  color: var(--cp-cyan);
  background: rgba(0, 245, 255, 0.06);
  white-space: nowrap;
}

.cp__apps-empty {
  padding: 1rem 0.85rem;
  text-align: center;
  border: 1px dashed rgba(0, 245, 255, 0.28);
  background: rgba(0, 0, 0, 0.25);
}

.cp__apps-empty-title {
  margin: 0 0 0.5rem;
  font-family: 'Orbitron', sans-serif;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  color: rgba(232, 244, 255, 0.5);
}

.cp__apps-empty-text {
  margin: 0;
  font-size: 0.88rem;
  line-height: 1.5;
  color: rgba(232, 244, 255, 0.55);
}

.cp__apps-empty-strong {
  color: rgba(232, 244, 255, 0.88);
  font-weight: 600;
}

.cp__tags {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.cp__tag {
  display: inline-flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.35rem 0.5rem;
  font-size: 0.9rem;
  font-weight: 600;
  padding: 0.35rem 0.75rem;
  border: 1px solid rgba(0, 245, 255, 0.35);
  color: rgba(232, 244, 255, 0.9);
  background: rgba(0, 245, 255, 0.06);
}

.cp__tag-label {
  flex: 1;
  min-width: 0;
}

.cp__tag-count {
  font-family: 'Share Tech Mono', monospace;
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: rgba(0, 245, 255, 0.75);
  font-variant-numeric: tabular-nums;
}

.cp__section-desc--tight {
  margin-bottom: 0.75rem;
}

.cp__section-desc--groups {
  margin-bottom: 1rem;
}

.cp__section-desc--muted {
  color: rgba(232, 244, 255, 0.48);
}

.cp__group-save-err {
  margin: 0 0 0.65rem;
  font-size: 0.82rem;
  line-height: 1.45;
  color: var(--cp-magenta);
}

.cp__group-list-shell {
  position: relative;
}

.cp__group-saving-chip {
  position: absolute;
  z-index: 4;
  right: 0;
  bottom: 100%;
  margin-bottom: 0.35rem;
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.25rem 0.55rem;
  font-family: 'Share Tech Mono', monospace;
  font-size: 0.6rem;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--cp-cyan);
  background: rgba(8, 12, 24, 0.94);
  border: 1px solid rgba(0, 245, 255, 0.4);
  border-radius: 2px;
  pointer-events: none;
  box-shadow:
    0 0 14px rgba(0, 245, 255, 0.18),
    inset 0 1px 0 rgba(255, 255, 255, 0.05);
}

.cp__group-saving-dot {
  flex-shrink: 0;
  width: 0.4rem;
  height: 0.4rem;
  border-radius: 50%;
  background: var(--cp-cyan);
  box-shadow: 0 0 10px var(--cp-cyan);
  animation: cp-saving-dot-pulse 0.9s ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce) {
  .cp__group-saving-dot {
    animation: none;
    opacity: 0.85;
  }
}

@keyframes cp-saving-dot-pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.35;
    transform: scale(0.88);
  }
}

.cp-group-saving-chip-enter-active,
.cp-group-saving-chip-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}

.cp-group-saving-chip-enter-from,
.cp-group-saving-chip-leave-to {
  opacity: 0;
  transform: translateY(0.2rem);
}

.cp__group-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.cp__group-card {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.65rem 0.75rem;
  padding: 0.65rem 0.75rem;
  border: 1px solid rgba(0, 245, 255, 0.3);
  background: rgba(0, 245, 255, 0.05);
  touch-action: none;
}

.cp__group-drag {
  flex-shrink: 0;
  width: 2.25rem;
  min-height: 2.25rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(0, 245, 255, 0.35);
  background: rgba(0, 0, 0, 0.35);
  color: var(--cp-cyan);
  cursor: grab;
  padding: 0;
  line-height: 1;
}

.cp__group-drag:active {
  cursor: grabbing;
}

.cp__group-drag-icon {
  font-family: 'Share Tech Mono', monospace;
  font-size: 0.75rem;
  letter-spacing: -0.12em;
  opacity: 0.9;
  pointer-events: none;
}

.cp__group-name-block {
  flex: 1;
  min-width: 8rem;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.35rem 0.55rem;
}

.cp__group-name {
  font-weight: 600;
  font-size: 0.95rem;
  color: #fff;
}

.cp__group-connect-count {
  font-family: 'Share Tech Mono', monospace;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: rgba(0, 245, 255, 0.78);
  padding: 0.12rem 0.4rem;
  border: 1px solid rgba(0, 245, 255, 0.28);
  background: rgba(0, 0, 0, 0.25);
  border-radius: 2px;
  font-variant-numeric: tabular-nums;
}

.cp__group-check {
  flex-shrink: 0;
  margin-left: auto;
  display: flex;
  align-items: center;
}

@media (max-width: 420px) {
  .cp__group-card {
    flex-direction: column;
    align-items: stretch;
  }

  .cp__group-check {
    margin-left: 0;
  }

  .cp__group-drag {
    align-self: flex-start;
  }
}

.cp__apps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.cp__app {
  position: relative;
}

.cp__app::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: linear-gradient(180deg, var(--cp-violet), var(--cp-magenta));
  opacity: 0.95;
  border-radius: 1px;
  z-index: 1;
  pointer-events: none;
}

.cp__app-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  min-height: 3.25rem;
  padding: 0.85rem 1rem 0.85rem 1.1rem;
  margin-left: 3px;
  text-decoration: none;
  color: inherit;
  background: rgba(188, 19, 254, 0.08);
  border: 1px solid rgba(188, 19, 254, 0.35);
  border-left: none;
  transition:
    background 0.15s ease,
    box-shadow 0.15s ease,
    transform 0.15s ease;
}

.cp__app-row:hover {
  background: rgba(188, 19, 254, 0.14);
  box-shadow: 0 0 20px rgba(0, 245, 255, 0.12);
}

.cp__app-row:active {
  transform: scale(0.99);
}

.cp__app-name {
  font-size: 1.08rem;
  font-weight: 600;
  color: #fff;
  flex: 1;
  min-width: 0;
}

.cp__app-cta {
  font-family: 'Orbitron', sans-serif;
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.15em;
  color: var(--cp-cyan);
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.5rem 0.65rem;
  border: 1px solid rgba(0, 245, 255, 0.45);
  background: rgba(0, 245, 255, 0.06);
  flex-shrink: 0;
  transition:
    color 0.15s ease,
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}

.cp__app-row:hover .cp__app-cta {
  color: #fff;
  border-color: var(--cp-cyan);
  box-shadow: 0 0 14px rgba(0, 245, 255, 0.25);
}

.cp__app-arrow {
  font-size: 0.9rem;
  line-height: 1;
}

.cp__footer {
  margin-top: 0.5rem;
  padding-top: 1rem;
}

.cp__footer-line {
  display: block;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--cp-cyan), transparent);
  opacity: 0.35;
  margin-bottom: 0.75rem;
}

.cp__footer-text {
  margin: 0;
  font-family: 'Share Tech Mono', monospace;
  font-size: 0.6rem;
  letter-spacing: 0.2em;
  color: rgba(232, 244, 255, 0.35);
  text-align: center;
}
</style>
