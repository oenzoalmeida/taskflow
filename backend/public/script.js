const API = '';
const $ = (id) => document.getElementById(id);

const authView = $('authView');
const taskView = $('taskView');
const authForm = $('authForm');
const nameInput = $('nameInput');
const emailInput = $('emailInput');
const passwordInput = $('passwordInput');
const passwordHint = $('passwordHint');
const authSubmit = $('authSubmit');
const authMessage = $('authMessage');
const loginTab = $('loginTab');
const registerTab = $('registerTab');
const logoutButton = $('logoutButton');
const adminButton = $('adminButton');
const userArea = $('userArea');
const adminArea = $('adminArea');
const backToTasks = $('backToTasks');
const welcomeText = $('welcomeText');
const taskForm = $('taskForm');
const taskInput = $('taskInput');
const taskFormSubmit = taskForm.querySelector('button[type="submit"]');
const taskList = $('taskList');
const loadingState = $('loadingState');
const taskError = $('taskError');
const emptyState = $('emptyState');
const totalTasksElement = $('totalTasks');
const totalTasksLabelElement = $('totalTasksLabel');
const completedTasksLabelElement = $('completedTasksLabel');
const completedTasksElement = $('completedTasks');
const progressNumber = $('progressNumber');
const filterButtons = document.querySelectorAll('.filter[data-filter]');
const deleteAccountButton = $('deleteAccountButton');
const passwordView = $('passwordView');
const passwordForm = $('passwordForm');
const currentPasswordInput = $('currentPasswordInput');
const newPasswordInput = $('newPasswordInput');
const confirmPasswordInput = $('confirmPasswordInput');
const passwordSubmit = $('passwordSubmit');
const passwordMessage = $('passwordMessage');

let mode = 'login';
let user = null;
let tasks = [];
let currentFilter = 'all';

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'Não foi possível concluir a operação');
    error.code = data.code;
    if (error.code === 'MUST_CHANGE_PASSWORD' && user) {
      user.must_change_password = true;
      showPasswordView();
    }
    throw error;
  }
  return data;
}

function showTaskError(message) {
  taskError.textContent = message;
  taskError.classList.remove('hidden');
}

function clearTaskError() {
  taskError.classList.add('hidden');
  taskError.textContent = '';
}

function setMode(next) {
  mode = next;
  const register = mode === 'register';
  loginTab.classList.toggle('active', !register);
  registerTab.classList.toggle('active', register);
  nameInput.classList.toggle('hidden', !register);
  passwordHint.classList.toggle('hidden', !register);
  passwordInput.autocomplete = register ? 'new-password' : 'current-password';
  authSubmit.textContent = register ? 'Criar conta' : 'Entrar';
  authMessage.textContent = '';
}

loginTab.addEventListener('click', () => setMode('login'));
registerTab.addEventListener('click', () => setMode('register'));

authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  authMessage.textContent = '';
  authSubmit.disabled = true;
  try {
    const body = { email: emailInput.value.trim(), password: passwordInput.value };
    if (mode === 'register') body.name = nameInput.value.trim();
    const data = await api(`/api/auth/${mode === 'register' ? 'register' : 'login'}`, { method: 'POST', body: JSON.stringify(body) });
    user = data.user;
    await enterApp();
  } catch (error) {
    authMessage.textContent = error.message;
  } finally {
    authSubmit.disabled = false;
  }
});

async function enterApp() {
  authView.classList.add('hidden');
  if (user.must_change_password) return showPasswordView();
  passwordView.classList.add('hidden');
  taskView.classList.remove('hidden');
  welcomeText.textContent = `Olá, ${user.name}. Organize suas tarefas e acompanhe seu progresso.`;
  adminButton.classList.toggle('hidden', user.role !== 'ADMIN');
  userArea.classList.remove('hidden');
  adminArea.classList.add('hidden');
  await loadTasks();
}

async function restoreSession() {
  try {
    const data = await api('/api/auth/me');
    user = data.user;
    await enterApp();
  } catch {
    authView.classList.remove('hidden');
  }
}

function showPasswordView() {
  taskView.classList.add('hidden');
  passwordView.classList.remove('hidden');
  passwordMessage.textContent = '';
}

passwordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  passwordMessage.textContent = '';
  if (newPasswordInput.value !== confirmPasswordInput.value) {
    passwordMessage.textContent = 'A confirmação não confere com a nova senha.';
    return;
  }
  passwordSubmit.disabled = true;
  try {
    const data = await api('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ current_password: currentPasswordInput.value, new_password: newPasswordInput.value }) });
    user = data.user;
    currentPasswordInput.value = '';
    newPasswordInput.value = '';
    confirmPasswordInput.value = '';
    await enterApp();
  } catch (error) {
    passwordMessage.textContent = error.message;
  } finally {
    passwordSubmit.disabled = false;
  }
});

async function logoutToAuth() {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
  user = null;
  tasks = [];
  authView.classList.remove('hidden');
  taskView.classList.add('hidden');
  passwordView.classList.add('hidden');
  emailInput.value = '';
  passwordInput.value = '';
}

logoutButton.addEventListener('click', logoutToAuth);
$('passwordLogout').addEventListener('click', logoutToAuth);

async function loadTasks() {
  loadingState.classList.remove('hidden');
  emptyState.classList.add('hidden');
  clearTaskError();
  try {
    const data = await api('/api/tasks');
    tasks = data.tasks.map(task => ({ id: task.id, text: task.title, completed: task.completed }));
    renderTasks();
  } catch (error) {
    tasks = [];
    renderTasks();
    emptyState.classList.add('hidden');
    showTaskError(`${error.message} Recarregue a página para tentar novamente.`);
  } finally {
    loadingState.classList.add('hidden');
  }
}

taskForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const title = taskInput.value.trim();
  if (!title) return;
  taskFormSubmit.disabled = true;
  clearTaskError();
  try {
    await api('/api/tasks', { method: 'POST', body: JSON.stringify({ title }) });
    taskInput.value = '';
    await loadTasks();
    taskInput.focus();
  } catch (error) {
    showTaskError(error.message);
  } finally {
    taskFormSubmit.disabled = false;
  }
});

async function saveTaskTitle(task, newTitle) {
  clearTaskError();
  await api(`/api/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify({ title: newTitle }) });
  await loadTasks();
}

function startTaskEdit(li, task) {
  li.innerHTML = '';
  const form = document.createElement('form');
  form.className = 'task-edit-form';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'task-edit-input';
  input.value = task.text;
  input.maxLength = 240;
  input.required = true;
  input.setAttribute('aria-label', `Novo título da tarefa: ${task.text}`);
  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'edit-button';
  save.textContent = 'Salvar';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'edit-button';
  cancel.textContent = 'Cancelar';
  cancel.addEventListener('click', () => renderTasks());
  form.append(input, save, cancel);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const title = input.value.trim();
    if (!title) {
      showTaskError('Informe uma tarefa válida.');
      return;
    }
    if (title === task.text) {
      renderTasks();
      return;
    }
    save.disabled = true;
    try {
      await saveTaskTitle(task, title);
    } catch (error) {
      showTaskError(error.message);
      save.disabled = false;
    }
  });
  li.appendChild(form);
  input.focus();
  input.select();
}

async function toggleTask(id, completed) {
  clearTaskError();
  try {
    await api(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ completed: !completed }) });
    await loadTasks();
  } catch (error) {
    showTaskError(error.message);
  }
}

async function deleteTask(id) {
  clearTaskError();
  try {
    await api(`/api/tasks/${id}`, { method: 'DELETE' });
    await loadTasks();
  } catch (error) {
    showTaskError(error.message);
  }
}

function renderTasks() {
  taskList.innerHTML = '';
  const filtered = tasks.filter(task => currentFilter === 'pending' ? !task.completed : currentFilter === 'completed' ? task.completed : true);
  filtered.forEach(task => {
    const li = document.createElement('li');
    li.className = `task-item${task.completed ? ' completed' : ''}`;
    const checkbox = document.createElement('button');
    checkbox.className = 'task-checkbox';
    checkbox.textContent = task.completed ? '✓' : '';
    checkbox.setAttribute('aria-label', task.completed ? 'Marcar tarefa como pendente' : 'Marcar tarefa como concluída');
    checkbox.setAttribute('aria-pressed', String(task.completed));
    checkbox.addEventListener('click', () => toggleTask(task.id, task.completed));
    const text = document.createElement('span');
    text.className = 'task-text';
    text.textContent = task.text;
    const edit = document.createElement('button');
    edit.className = 'edit-button';
    edit.textContent = 'Editar';
    edit.setAttribute('aria-label', `Editar tarefa: ${task.text}`);
    edit.addEventListener('click', () => startTaskEdit(li, task));
    const remove = document.createElement('button');
    remove.className = 'delete-button';
    remove.textContent = 'Excluir';
    remove.setAttribute('aria-label', `Excluir tarefa: ${task.text}`);
    remove.addEventListener('click', () => deleteTask(task.id));
    li.append(checkbox, text, edit, remove);
    taskList.appendChild(li);
  });
  const completed = tasks.filter(task => task.completed).length;
  totalTasksElement.textContent = tasks.length;
  totalTasksLabelElement.textContent = pluralPt(tasks.length, 'tarefa', 'tarefas');
  completedTasksElement.textContent = completed;
  completedTasksLabelElement.textContent = pluralPt(completed, 'concluída', 'concluídas');
  progressNumber.textContent = `${tasks.length ? Math.round((completed / tasks.length) * 100) : 0}%`;
  emptyState.classList.toggle('hidden', filtered.length > 0);
}

filterButtons.forEach(button => button.addEventListener('click', () => {
  filterButtons.forEach(item => {
    item.classList.remove('active');
    item.setAttribute('aria-pressed', 'false');
  });
  button.classList.add('active');
  button.setAttribute('aria-pressed', 'true');
  currentFilter = button.dataset.filter;
  renderTasks();
}));

deleteAccountButton.addEventListener('click', async () => {
  if (!confirm('Excluir sua conta e todas as suas tarefas? Esta ação é definitiva.')) return;
  if (!confirm('Confirma novamente? Os dados não poderão ser recuperados.')) return;
  try {
    await api('/api/account', { method: 'DELETE' });
  } catch {
    authMessage.textContent = 'Não foi possível excluir a conta agora. Tente novamente.';
  }
  user = null;
  tasks = [];
  authView.classList.remove('hidden');
  taskView.classList.add('hidden');
  emailInput.value = '';
  passwordInput.value = '';
  authMessage.textContent = 'Conta excluída definitivamente.';
});

adminButton.addEventListener('click', async () => {
  userArea.classList.add('hidden');
  adminArea.classList.remove('hidden');
  try {
    const [overview, users] = await Promise.all([api('/api/admin/overview'), api('/api/admin/users')]);
    $('adminStats').innerHTML = `
      <div class="stat-card"><strong>${overview.users.total}</strong><span>usuários</span></div>
      <div class="stat-card"><strong>${overview.users.active}</strong><span>usuários ativos</span></div>
      <div class="stat-card"><strong>${overview.tasks.total}</strong><span>${pluralPt(overview.tasks.total, 'tarefa', 'tarefas')}</span></div>
      <div class="stat-card"><strong>${overview.tasks.completed}</strong><span>${pluralPt(overview.tasks.completed, 'concluída', 'concluídas')}</span></div>`;
    renderUsers(users.users);
  } catch (error) {
    $('adminStats').innerHTML = '';
    $('usersTable').innerHTML = '';
    showTaskError(error.message);
  }
});

backToTasks.addEventListener('click', () => {
  adminArea.classList.add('hidden');
  userArea.classList.remove('hidden');
});

function renderUsers(users) {
  $('usersTable').innerHTML = '';
  users.forEach(item => {
    const tr = document.createElement('tr');
    const isSelf = user && String(item.id) === String(user.id);
    const action = isSelf ? '—' : `<button class="secondary user-toggle" data-id="${item.id}" data-active="${item.active}">${item.active ? 'Desativar' : 'Ativar'}</button>`;
    tr.innerHTML = `<td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.email)}</td><td>${item.role === 'ADMIN' ? 'Administrador' : 'Usuário'}</td><td>${item.active ? 'Ativo' : 'Inativo'}</td><td>${action}</td>`;
    $('usersTable').appendChild(tr);
  });
  document.querySelectorAll('.user-toggle').forEach(button => button.addEventListener('click', async () => {
    try {
      await api(`/api/admin/users/${button.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ active: button.dataset.active !== 'true' }) });
      adminButton.click();
    } catch (error) {
      showTaskError(error.message);
    }
  }));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

restoreSession();

// Mostrar/ocultar senha: envolve cada campo de senha dos formulários de acesso
// com um botão-olho. Só visual - o input original mantém id, validação e
// autocomplete, e nada muda no envio.
document.querySelectorAll('.auth-form input[type="password"]').forEach((pwInput) => {
  const field = document.createElement('div');
  field.className = 'pw-field';
  pwInput.parentNode.insertBefore(field, pwInput);
  field.appendChild(pwInput);
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'pw-toggle';
  toggle.setAttribute('aria-label', 'Mostrar senha');
  toggle.setAttribute('aria-pressed', 'false');
  toggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/><line class="pw-eye-off" x1="4" y1="20" x2="20" y2="4"/></svg>';
  toggle.addEventListener('click', () => {
    const showing = pwInput.type === 'text';
    pwInput.type = showing ? 'password' : 'text';
    toggle.setAttribute('aria-label', showing ? 'Mostrar senha' : 'Ocultar senha');
    toggle.setAttribute('aria-pressed', String(!showing));
    pwInput.focus();
  });
  field.appendChild(toggle);
});
