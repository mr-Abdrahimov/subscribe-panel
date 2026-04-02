<template>
  <div class="sub-layout cosmic-shell relative">
    <CosmicBackdrop />
    <div
      class="pointer-events-auto absolute right-3 top-3 z-30 rounded-full border border-[var(--cosmic-border)] bg-[var(--cosmic-glass)] p-1.5 shadow-sm backdrop-blur-md sm:right-4 sm:top-4"
    >
      <ThemeToggle />
    </div>
    <UMain class="sub-layout__main">
      <slot />
    </UMain>
  </div>
</template>

<style scoped>
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
