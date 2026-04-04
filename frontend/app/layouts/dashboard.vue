<script setup lang="ts">
const isSidebarOpen = ref(false);
</script>

<template>
  <div class="cosmic-shell relative min-h-[100dvh] overflow-x-hidden">
    <CosmicBackdrop />
    <UMain class="relative z-10 min-h-[100dvh]">
      <div
        class="min-h-[100dvh] md:grid md:grid-cols-[minmax(260px,288px)_1fr] md:items-start"
      >
        <aside
          class="cosmic-sidebar-col hidden md:block md:sticky md:top-0 md:self-start md:h-[100dvh] md:max-h-[100dvh] md:min-h-0 md:w-full md:overflow-hidden"
        >
          <DashboardSidebar />
        </aside>

        <section class="cosmic-app min-h-[100dvh] w-full min-w-0 p-4 sm:p-6 md:p-8 md:pb-10">
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
          <div
            class="flex h-full max-h-[100dvh] min-h-0 flex-1 flex-col overflow-hidden"
          >
            <DashboardSidebar @navigate="isSidebarOpen = false" />
          </div>
        </template>
      </UModal>
    </UMain>
  </div>
</template>
