<template>
  <div class="sub-layout">
    <div class="sub-layout__bg" aria-hidden="true" />
    <div class="sub-layout__grid" aria-hidden="true" />
    <div class="sub-layout__scan" aria-hidden="true" />
    <UMain class="sub-layout__main">
      <slot />
    </UMain>
  </div>
</template>

<style scoped>
.sub-layout {
  --cp-bg: #05060a;
  --cp-grid: rgba(0, 245, 255, 0.04);
  min-height: 100dvh;
  position: relative;
  background: var(--cp-bg);
  color: #e8f4ff;
  overflow-x: hidden;
}

.sub-layout__bg {
  position: fixed;
  inset: 0;
  background:
    radial-gradient(ellipse 120% 80% at 50% -20%, rgba(255, 0, 128, 0.12), transparent 50%),
    radial-gradient(ellipse 80% 50% at 100% 50%, rgba(0, 245, 255, 0.06), transparent 45%),
    radial-gradient(ellipse 60% 40% at 0% 80%, rgba(188, 19, 254, 0.08), transparent 50%),
    var(--cp-bg);
  pointer-events: none;
  z-index: 0;
}

.sub-layout__grid {
  position: fixed;
  inset: 0;
  background-image:
    linear-gradient(var(--cp-grid) 1px, transparent 1px),
    linear-gradient(90deg, var(--cp-grid) 1px, transparent 1px);
  background-size: 48px 48px;
  mask-image: radial-gradient(ellipse 70% 70% at 50% 40%, black 20%, transparent 70%);
  pointer-events: none;
  z-index: 0;
}

.sub-layout__scan {
  position: fixed;
  inset: 0;
  background: repeating-linear-gradient(
    0deg,
    transparent,
    transparent 2px,
    rgba(0, 0, 0, 0.03) 2px,
    rgba(0, 0, 0, 0.03) 4px
  );
  pointer-events: none;
  z-index: 1;
  animation: sub-scan 10s linear infinite;
}

@keyframes sub-scan {
  0% {
    opacity: 0.5;
  }
  50% {
    opacity: 0.85;
  }
  100% {
    opacity: 0.5;
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
</style>
