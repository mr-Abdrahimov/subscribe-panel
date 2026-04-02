<template>
  <div class="cosmic-shell relative min-h-[100dvh] overflow-x-hidden">
    <CosmicBackdrop />
    <div class="absolute right-4 top-4 z-20 flex items-center gap-2">
      <span
        class="cosmic-mono hidden text-[0.65rem] uppercase tracking-[0.2em] text-[var(--cosmic-fg-muted)] sm:inline"
      >Тема</span>
      <ThemeToggle />
    </div>
    <UMain class="relative z-10 flex min-h-[100dvh] items-center justify-center px-4 py-8">
      <slot />
    </UMain>
  </div>
</template>
