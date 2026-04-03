<script setup lang="ts">
import type { PublicUserResponse } from '~/types/api'

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

const displayName = computed(() => data.value?.name ?? '')
const groupLabels = computed(() => data.value?.groups ?? [])
const appLinks = computed(() => data.value?.appLinks ?? [])
const cryptoOnlySubscription = computed(
  () => data.value?.cryptoOnlySubscription === true,
)

const happCryptoUrl = computed(() => {
  const u = (data.value?.happCryptoUrl ?? '').trim()
  return u.startsWith('happ://') ? u : ''
})

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
          <p class="cp__notice-title">Только crypto</p>
          <p class="cp__notice-text">
            Рабочий импорт в Happ — через
            <strong class="cp__notice-strong">happ:// crypto-ссылку</strong>
          </p>
        </div>

        <div class="cp__url-block">
          <label class="cp__label">ENDPOINT · HAPP CRYPTO</label>
          <div class="cp__url-row">
            <code class="cp__url">{{ happCryptoUrl || '— нет happ:// ссылки (создайте в панели) —' }}</code>
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
                и
                <span class="cp__code-inline">/{{ cryptoPathSegment }}/…</span>.
              </p>
            </div>
          </div>
        </section>

        <section v-if="groupLabels.length" class="cp__section">
          <h2 class="cp__section-title">
            <span class="cp__section-marker" />
            ГРУППЫ
          </h2>
          <ul class="cp__tags">
            <li v-for="g in groupLabels" :key="g" class="cp__tag">{{ g }}</li>
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
  flex-direction: column;
  gap: 0.75rem;
}

@media (min-width: 480px) {
  .cp__url-row {
    flex-direction: row;
    align-items: stretch;
  }
}

.cp__url {
  flex: 1;
  min-width: 0;
  display: block;
  padding: 0.65rem 0.85rem;
  font-family: 'Share Tech Mono', monospace;
  font-size: 0.7rem;
  line-height: 1.4;
  word-break: break-all;
  background: rgba(0, 0, 0, 0.45);
  border: 1px solid rgba(0, 245, 255, 0.2);
  color: var(--cp-cyan);
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
  font-size: 0.9rem;
  font-weight: 600;
  padding: 0.35rem 0.75rem;
  border: 1px solid rgba(0, 245, 255, 0.35);
  color: rgba(232, 244, 255, 0.9);
  background: rgba(0, 245, 255, 0.06);
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
