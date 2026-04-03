<template>
  <div class="sub-layout cosmic-shell relative">
    <CosmicBackdrop />
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
