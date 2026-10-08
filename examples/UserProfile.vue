<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';

interface User {
  id: number;
  name: string;
}

interface UserProfileProps {
  userId: number;
  onLoaded?: (user: User) => void;
}

const {
  userId,
  onLoaded
} = defineProps<UserProfileProps>();

const user = ref<User | null>(null);

const loading = ref(false);

const error = ref<string | null>(null);

const __runEffect0 = () => {
const controller = new AbortController();
const loadUser = async () => {
  loading.value = true;
  error.value = null;
  try {
    const response = await fetch(`/api/users/${userId}`, {
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error('Unable to load user');
    }
    const nextUser: User = await response.json();
    user.value = nextUser;
    onLoaded?.(nextUser);
  } catch (cause) {
    if (!controller.signal.aborted) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    }
  } finally {
    if (!controller.signal.aborted) {
      loading.value = false;
    }
  }
};
void loadUser();

return () => {
  controller.abort();
};
};

let __cleanupEffect0: (() => void) | undefined;

onMounted(() => { __cleanupEffect0 = __runEffect0(); });

watch(() => [userId, onLoaded], () => { __cleanupEffect0?.(); __cleanupEffect0 = __runEffect0(); }, { flush: 'post' });

onUnmounted(() => { __cleanupEffect0?.(); });
</script>

<template>
  <section><p>{{ loading ? 'Loading...' : user?.name ?? 'User not found' }}</p><p>{{ error }}</p><button :disabled="loading" @click="() => user = null">Clear</button></section>
</template>
