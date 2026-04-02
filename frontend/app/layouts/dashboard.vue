<script setup lang="ts">
const isSidebarOpen = ref(false);
const isMobile = ref(false);

function syncViewport() {
  if (!import.meta.client) {
    return;
  }
  isMobile.value = window.innerWidth < 768;
}

onMounted(() => {
  syncViewport();
  window.addEventListener('resize', syncViewport);
});

onBeforeUnmount(() => {
  if (!import.meta.client) {
    return;
  }
  window.removeEventListener('resize', syncViewport);
});
</script>

<template>
  <UMain>
    <div class="min-h-[100dvh] bg-(--ui-bg) md:grid md:grid-cols-[300px_1fr]">
      <div class="hidden md:block">
        <DashboardSidebar />
      </div>

      <section class="p-4 sm:p-6 md:p-8">
        <div class="md:hidden mb-4">
          <UButton
            color="neutral"
            variant="soft"
            icon="i-lucide-menu"
            @click="isSidebarOpen = true"
          >
            Меню
          </UButton>
        </div>
        <slot />
      </section>

      <USlideover
        v-if="isMobile"
        v-model:open="isSidebarOpen"
        side="left"
        :overlay="true"
        :ui="{ content: 'w-full max-w-[320px]' }"
      >
        <DashboardSidebar @navigate="isSidebarOpen = false" />
      </USlideover>
    </div>
  </UMain>
</template>

