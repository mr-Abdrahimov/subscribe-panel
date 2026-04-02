<script setup lang="ts">
const colorMode = useColorMode();

const isDark = computed({
  get: () => colorMode.value === 'dark',
  set: (v) => {
    colorMode.preference = v ? 'dark' : 'light';
  },
});

const label = computed(() =>
  isDark.value ? 'Светлая тема' : 'Тёмная тема',
);
</script>

<template>
  <UTooltip :text="label">
    <USwitch
      v-model="isDark"
      :aria-label="label"
      size="md"
      unchecked-icon="i-lucide-sun"
      checked-icon="i-lucide-moon"
      color="primary"
    />
  </UTooltip>
</template>
