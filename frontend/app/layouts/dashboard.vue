<script setup lang="ts">
const isSidebarOpen = ref(false);
</script>

<template>
  <div class="cosmic-shell relative min-h-[100dvh] overflow-x-hidden">
    <CosmicBackdrop />
    <UMain class="relative z-10 min-h-[100dvh]">
      <div class="min-h-[100dvh] md:grid md:grid-cols-[minmax(260px,288px)_1fr]">
        <aside class="cosmic-sidebar-col hidden h-full min-h-[100dvh] md:block">
          <DashboardSidebar />
        </aside>

        <section class="cosmic-app p-4 sm:p-6 md:p-8 md:pb-10">
          <div class="mb-4 flex items-center gap-3 md:hidden">
            <UButton
              color="primary"
              variant="soft"
              icon="i-lucide-menu"
              @click="isSidebarOpen = true"
            >
              Меню
            </UButton>
          </div>
          <slot />
        </section>
      </div>

      <UModal
        v-model:open="isSidebarOpen"
        class="md:hidden"
        fullscreen
        title="Меню"
        :dismissible="true"
      >
        <template #body>
          <DashboardSidebar @navigate="isSidebarOpen = false" />
        </template>
      </UModal>
    </UMain>
  </div>
</template>
