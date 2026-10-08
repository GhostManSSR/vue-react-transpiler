<script setup lang="ts">
defineProps<{
  msg: string
  disabled: boolean
  type: 'button' | 'submit' | 'reset' | undefined
}>()

const emit = defineEmits<{
  (event: 'click'): void
}>()
</script>

<template>
  <button
      :type="type"
      :disabled="disabled"
      @click="emit('click')"
  >
    {{ msg }}
  </button>
</template>

<style scoped>
button {
  cursor: pointer;
}
</style>