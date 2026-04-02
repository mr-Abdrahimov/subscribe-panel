<script setup lang="ts">
const isSidebarOpen = ref(false);
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

      <!-- default slot = trigger (inline). Навигация только в #body -->
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
    </div>
  </UMain>
</template>

