<template>
  <div class="sub-layout">
    <div class="sub-layout__void" aria-hidden="true" />
    <div class="sub-layout__nebula" aria-hidden="true" />
    <div class="sub-layout__aurora" aria-hidden="true" />
    <div class="sub-layout__aurora sub-layout__aurora--b" aria-hidden="true" />
    <div class="sub-layout__stars" aria-hidden="true" />
    <div class="sub-layout__grid" aria-hidden="true" />
    <div class="sub-layout__scan" aria-hidden="true" />
    <UMain class="sub-layout__main">
      <slot />
    </UMain>
  </div>
</template>

<style scoped>
.sub-layout {
  --cp-bg: #03040c;
  --cp-grid: rgba(0, 245, 255, 0.045);
  min-height: 100dvh;
  position: relative;
  background: var(--cp-bg);
  color: #e8f4ff;
  overflow-x: hidden;
}

/* Глубокий космос */
.sub-layout__void {
  position: fixed;
  inset: 0;
  background:
    radial-gradient(ellipse 140% 100% at 50% 120%, rgba(20, 10, 48, 0.9), transparent 55%),
    radial-gradient(ellipse 100% 60% at 50% -10%, rgba(8, 20, 40, 0.95), transparent 50%),
    var(--cp-bg);
  pointer-events: none;
  z-index: 0;
}

/* Медленно вращающаяся туманность */
.sub-layout__nebula {
  position: fixed;
  inset: -60%;
  z-index: 0;
  pointer-events: none;
  background: conic-gradient(
    from 0deg at 50% 50%,
    rgba(188, 19, 254, 0.14),
    transparent 16%,
    rgba(0, 245, 255, 0.1),
    transparent 34%,
    rgba(255, 0, 170, 0.09),
    transparent 52%,
    rgba(100, 80, 255, 0.11),
    transparent 70%,
    rgba(188, 19, 254, 0.12),
    transparent 88%,
    rgba(188, 19, 254, 0.14)
  );
  filter: blur(55px);
  opacity: 0.75;
  animation: sub-nebula-spin 90s linear infinite;
}

@keyframes sub-nebula-spin {
  to {
    transform: rotate(360deg);
  }
}

/* Переливающиеся космические пятна */
.sub-layout__aurora {
  position: fixed;
  inset: -25%;
  z-index: 0;
  pointer-events: none;
  background:
    radial-gradient(ellipse 55% 45% at 25% 30%, rgba(120, 90, 255, 0.35), transparent 55%),
    radial-gradient(ellipse 50% 40% at 75% 65%, rgba(0, 245, 255, 0.22), transparent 50%),
    radial-gradient(ellipse 45% 50% at 50% 95%, rgba(255, 0, 170, 0.18), transparent 45%);
  filter: blur(48px);
  mix-blend-mode: screen;
  opacity: 0.85;
  animation: sub-aurora-a 22s ease-in-out infinite;
}

.sub-layout__aurora--b {
  animation: sub-aurora-b 28s ease-in-out infinite;
  animation-delay: -8s;
  background:
    radial-gradient(ellipse 50% 42% at 70% 25%, rgba(0, 200, 255, 0.28), transparent 52%),
    radial-gradient(ellipse 48% 48% at 15% 70%, rgba(255, 0, 140, 0.2), transparent 48%),
    radial-gradient(ellipse 40% 38% at 90% 85%, rgba(180, 100, 255, 0.25), transparent 50%);
}

@keyframes sub-aurora-a {
  0%,
  100% {
    transform: translate(0, 0) scale(1) rotate(0deg);
    opacity: 0.75;
  }
  33% {
    transform: translate(6%, -4%) scale(1.08) rotate(4deg);
    opacity: 0.95;
  }
  66% {
    transform: translate(-5%, 5%) scale(0.96) rotate(-3deg);
    opacity: 0.8;
  }
}

@keyframes sub-aurora-b {
  0%,
  100% {
    transform: translate(0, 0) scale(1.02) rotate(0deg);
    opacity: 0.65;
  }
  50% {
    transform: translate(-7%, 6%) scale(1.12) rotate(-5deg);
    opacity: 0.9;
  }
}

/* Звёздное поле + мерцание */
.sub-layout__stars {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background-image:
    radial-gradient(1px 1px at 8% 12%, rgba(255, 255, 255, 0.95), transparent),
    radial-gradient(1px 1px at 22% 8%, rgba(200, 230, 255, 0.8), transparent),
    radial-gradient(1.2px 1.2px at 35% 28%, rgba(255, 255, 255, 0.9), transparent),
    radial-gradient(1px 1px at 48% 15%, rgba(255, 255, 255, 0.65), transparent),
    radial-gradient(1px 1px at 62% 22%, rgba(180, 220, 255, 0.85), transparent),
    radial-gradient(1px 1px at 78% 10%, rgba(255, 255, 255, 0.75), transparent),
    radial-gradient(1.2px 1.2px at 92% 18%, rgba(255, 255, 255, 0.9), transparent),
    radial-gradient(1px 1px at 12% 38%, rgba(255, 255, 255, 0.55), transparent),
    radial-gradient(1px 1px at 28% 45%, rgba(220, 240, 255, 0.8), transparent),
    radial-gradient(1px 1px at 55% 42%, rgba(255, 255, 255, 0.7), transparent),
    radial-gradient(1.2px 1.2px at 72% 38%, rgba(255, 255, 255, 0.95), transparent),
    radial-gradient(1px 1px at 88% 48%, rgba(200, 220, 255, 0.6), transparent),
    radial-gradient(1px 1px at 5% 58%, rgba(255, 255, 255, 0.7), transparent),
    radial-gradient(1px 1px at 42% 62%, rgba(255, 255, 255, 0.85), transparent),
    radial-gradient(1px 1px at 65% 55%, rgba(180, 200, 255, 0.75), transparent),
    radial-gradient(1.2px 1.2px at 95% 62%, rgba(255, 255, 255, 0.9), transparent),
    radial-gradient(1px 1px at 18% 72%, rgba(255, 255, 255, 0.6), transparent),
    radial-gradient(1px 1px at 38% 82%, rgba(230, 245, 255, 0.8), transparent),
    radial-gradient(1px 1px at 58% 78%, rgba(255, 255, 255, 0.75), transparent),
    radial-gradient(1.2px 1.2px at 82% 85%, rgba(255, 255, 255, 0.9), transparent),
    radial-gradient(1px 1px at 15% 92%, rgba(200, 220, 255, 0.65), transparent),
    radial-gradient(1px 1px at 50% 88%, rgba(255, 255, 255, 0.8), transparent),
    radial-gradient(1px 1px at 70% 92%, rgba(255, 255, 255, 0.55), transparent);
  background-repeat: no-repeat;
  background-size: 100% 100%;
  opacity: 0.5;
  animation: sub-stars-twinkle 7s ease-in-out infinite alternate;
}

@keyframes sub-stars-twinkle {
  0% {
    opacity: 0.38;
    filter: brightness(0.92);
  }
  100% {
    opacity: 0.58;
    filter: brightness(1.18);
  }
}

.sub-layout__grid {
  position: fixed;
  inset: 0;
  background-image:
    linear-gradient(var(--cp-grid) 1px, transparent 1px),
    linear-gradient(90deg, var(--cp-grid) 1px, transparent 1px);
  background-size: 48px 48px;
  mask-image: radial-gradient(ellipse 75% 75% at 50% 42%, black 15%, transparent 72%);
  pointer-events: none;
  z-index: 1;
}

.sub-layout__scan {
  position: fixed;
  inset: 0;
  background: repeating-linear-gradient(
    0deg,
    transparent,
    transparent 2px,
    rgba(0, 0, 0, 0.04) 2px,
    rgba(0, 0, 0, 0.04) 4px
  );
  pointer-events: none;
  z-index: 1;
  animation: sub-scan 10s linear infinite;
}

@keyframes sub-scan {
  0% {
    opacity: 0.45;
  }
  50% {
    opacity: 0.78;
  }
  100% {
    opacity: 0.45;
  }
}

.sub-layout__main {
  position: relative;
  z-index: 2;
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: clamp(1rem, 4vw, 2.5rem);
}

@media (prefers-reduced-motion: reduce) {
  .sub-layout__nebula,
  .sub-layout__aurora,
  .sub-layout__aurora--b,
  .sub-layout__stars,
  .sub-layout__scan {
    animation: none;
  }
}
</style>
