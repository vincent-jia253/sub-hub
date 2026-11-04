<template>
  <div class="login-wrapper">
    <div class="login-card glass">
      <div class="login-header">
        <div class="logo-box">
          <Activity class="icon-pulse" :size="32" />
        </div>
        <h1>SUB Aggregator</h1>
        <p class="subtitle">全协议机场订阅聚合与节点管理系统</p>
      </div>

      <form @submit.prevent="handleLogin" class="login-form">
        <div class="form-group">
          <label>管理账号</label>
          <div class="input-with-icon">
            <User :size="18" class="input-icon" />
            <input v-model="form.username" type="text" placeholder="请输入管理账号" required autocomplete="username" />
          </div>
        </div>

        <div class="form-group">
          <label>访问密码</label>
          <div class="input-with-icon">
            <Lock :size="18" class="input-icon" />
            <input v-model="form.password" type="password" placeholder="请输入访问密码" required autocomplete="current-password" />
          </div>
        </div>

        <div v-if="error" class="error-msg">
          <AlertCircle :size="16" />
          <span>{{ error }}</span>
        </div>

        <button type="submit" class="btn btn-primary btn-block" :disabled="loading">
          <Loader2 v-if="loading" class="animate-spin" :size="18" />
          <span>{{ loading ? '登录中...' : '立即登录' }}</span>
        </button>
      </form>

      <div class="login-footer">
        <span>基于 Mihomo 内核 · 支持自动化定时更新</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue';
import { User, Lock, Activity, AlertCircle, Loader2 } from 'lucide-vue-next';
import api from '../api';

const emit = defineEmits(['login-success']);

const form = reactive({
  username: '',
  password: ''
});

const loading = ref(false);
const error = ref('');

const handleLogin = async () => {
  error.value = '';
  loading.value = true;
  try {
    const res = await api.post('/auth/login', form);
    localStorage.setItem('sub_token', res.token);
    localStorage.setItem('sub_user', res.username);
    emit('login-success', res);
  } catch (err) {
    error.value = err.message || '登录失败，请检查用户名或密码';
  } finally {
    loading.value = false;
  }
};
</script>

<style scoped>
.login-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 20px;
}

.login-card {
  width: 100%;
  max-width: 420px;
  padding: 40px 32px;
  display: flex;
  flex-direction: column;
  gap: 28px;
}

.login-header {
  text-align: center;
}

.logo-box {
  width: 60px;
  height: 60px;
  background: linear-gradient(135deg, #4f46e5 0%, #06b6d4 100%);
  border-radius: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: white;
  margin-bottom: 16px;
  box-shadow: 0 10px 25px -5px rgba(79, 70, 229, 0.5);
}

.login-header h1 {
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.5px;
  margin-bottom: 6px;
}

.subtitle {
  font-size: 13px;
  color: var(--text-muted);
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-group label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-muted);
}

.input-with-icon {
  position: relative;
  display: flex;
  align-items: center;
}

.input-icon {
  position: absolute;
  left: 12px;
  color: var(--text-dim);
}

.input-with-icon input {
  padding-left: 38px;
}

.btn-block {
  width: 100%;
  padding: 12px;
  font-size: 15px;
}

.error-msg {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: rgba(239, 68, 68, 0.15);
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: #f87171;
  border-radius: 8px;
  font-size: 13px;
}

.login-footer {
  text-align: center;
  font-size: 12px;
  color: var(--text-dim);
}
</style>
