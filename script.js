const API = 'https://taskflow-backend-6syn.onrender.com';
const $ = (id) => document.getElementById(id);

const authView = $('authView');
const taskView = $('taskView');
const authForm = $('authForm');
const nameInput = $('nameInput');
const emailInput = $('emailInput');
const passwordInput = $('passwordInput');
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
const taskList = $('taskList');
const emptyState = $('emptyState');
const totalTasksElement = $('totalTasks');
const completedTasksElement = $('completedTasks');
const progressNumber = $('progressNumber');
const filterButtons = document.querySelectorAll('.filter[data-filter]');

let mode = 'login';
let user = null;
let tasks = [];
let currentFilter = 'all';

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a operação');
  return data;
}

function setMode(next) {
  mode = next;
  const register = mode === 'register';
  loginTab.classList.toggle('active', !register);
  registerTab.classList.toggle('active', register);
  nameInput.classList.toggle('hidden', !register);
  passwordInput.autocomplete = register ? 'new-password' : 'current-password';
  authSubmit.textContent = register ? 'Criar conta' : 'Entrar';
  authMessage.textContent = '';
}

loginTab.addEventListener('click', () => setMode('login'));
registerTab.addEventListener('click', () => setMode('register'));

authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  authMessage.textContent = '';
  try {
    const body = { email: emailInput.value.trim(), password: passwordInput.value };
    if (mode === 'register') body.name = nameInput.value.trim();
    const data = await api(`/api/auth/${mode === 'register' ? 'register' : 'login'}`, { method: 'POST', body: JSON.stringify(body) });
    user = data.user;
    await enterApp();
  } catch (error) {
    authMessage.textContent = error.message;
  }
});

async function enterApp() {
  authView.classList.add('hidden');
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
    taskView.classList.add('hidden');
  }
}

logoutButton.addEventListener('click', async () => {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
  user = null;
  tasks = [];
  authView.classList.remove('hidden');
  taskView.classList.add('hidden');
  emailInput.value = '';
  passwordInput.value = '';
});

async function loadTasks() {
  const data = await api('/api/tasks');
  tasks = data.tasks.map(task => ({ id: task.id, text: task.title, completed: task.completed }));
  renderTasks();
}

taskForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const title = taskInput.value.trim();
  if (!title) return;
  await api('/api/tasks', { method: 'POST', body: JSON.stringify({ title }) });
  taskInput.value = '';
  await loadTasks();
  taskInput.focus();
});

async function toggleTask(id, completed) {
  await api(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ completed: !completed }) });
  await loadTasks();
}

async function deleteTask(id) {
  await api(`/api/tasks/${id}`, { method: 'DELETE' });
  await loadTasks();
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
    checkbox.addEventListener('click', () => toggleTask(task.id, task.completed));
    const text = document.createElement('span');
    text.className = 'task-text';
    text.textContent = task.text;
    const remove = document.createElement('button');
    remove.className = 'delete-button';
    remove.textContent = 'Excluir';
    remove.addEventListener('click', () => deleteTask(task.id));
    li.append(checkbox, text, remove);
    taskList.appendChild(li);
  });
  const completed = tasks.filter(task => task.completed).length;
  totalTasksElement.textContent = tasks.length;
  completedTasksElement.textContent = completed;
  progressNumber.textContent = `${tasks.length ? Math.round((completed / tasks.length) * 100) : 0}%`;
  emptyState.classList.toggle('hidden', filtered.length > 0);
}

filterButtons.forEach(button => button.addEventListener('click', () => {
  filterButtons.forEach(item => item.classList.remove('active'));
  button.classList.add('active');
  currentFilter = button.dataset.filter;
  renderTasks();
}));

adminButton.addEventListener('click', async () => {
  userArea.classList.add('hidden');
  adminArea.classList.remove('hidden');
  const [overview, users] = await Promise.all([api('/api/admin/overview'), api('/api/admin/users')]);
  $('adminStats').innerHTML = `
    <div class="stat-card"><strong>${overview.users.total}</strong><span>usuários</span></div>
    <div class="stat-card"><strong>${overview.users.active}</strong><span>usuários ativos</span></div>
    <div class="stat-card"><strong>${overview.tasks.total}</strong><span>tarefas</span></div>
    <div class="stat-card"><strong>${overview.tasks.completed}</strong><span>concluídas</span></div>`;
  renderUsers(users.users);
});

backToTasks.addEventListener('click', () => {
  adminArea.classList.add('hidden');
  userArea.classList.remove('hidden');
});

function renderUsers(users) {
  $('usersTable').innerHTML = '';
  users.forEach(item => {
    const tr = document.createElement('tr');
    const action = item.role === 'USER' ? `<button class="secondary user-toggle" data-id="${item.id}" data-active="${item.active}">${item.active ? 'Desativar' : 'Ativar'}</button>` : '—';
    tr.innerHTML = `<td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.email)}</td><td>${item.role === 'ADMIN' ? 'Administrador' : 'Usuário'}</td><td>${item.active ? 'Ativo' : 'Inativo'}</td><td>${action}</td>`;
    $('usersTable').appendChild(tr);
  });
  document.querySelectorAll('.user-toggle').forEach(button => button.addEventListener('click', async () => {
    await api(`/api/admin/users/${button.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ active: button.dataset.active !== 'true' }) });
    adminButton.click();
  }));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

restoreSession();
