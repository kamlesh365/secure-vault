/**
 * Secure Vault — client-side encrypted password manager
 * All data is encrypted with AES-GCM and stored in localStorage.
 */

const USERS_INDEX_KEY = 'secure_vault_users';
const LAST_USER_KEY = 'secure_vault_last_user';
const LEGACY_STORAGE_KEY = 'secure_vault_data';
const PBKDF2_ITERATIONS = 310000;

const AVATAR_COLORS = [
  '#4f9cf9', '#8b5cf6', '#ec4899', '#f97316',
  '#14b8a6', '#eab308', '#6366f1', '#06b6d4',
];

// ── State ──
let vault = { applications: [] };
let currentUsername = '';
let masterPassword = '';
let saveTimer = null;
let searchQuery = '';

// ── DOM refs ──
const $ = (sel) => document.querySelector(sel);

const lockScreen = $('#lock-screen');
const appEl = $('#app');
const unlockForm = $('#unlock-form');
const usernameInput = $('#username');
const existingUsersEl = $('#existing-users');
const userChipsEl = $('#user-chips');
const masterPasswordInput = $('#master-password');
const confirmPasswordGroup = $('#confirm-password-group');
const confirmPasswordInput = $('#confirm-password');
const lockError = $('#lock-error');
const unlockBtn = $('#unlock-btn');
const searchInput = $('#search-input');
const appGrid = $('#app-grid');
const emptyState = $('#empty-state');
const noResults = $('#no-results');
const appCount = $('#app-count');
const saveStatus = $('#save-status');
const currentUserBadge = $('#current-user-badge');
const toast = $('#toast');

// ── Utilities ──
function uid() {
  return crypto.randomUUID();
}

function encodeBase64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function decodeBase64(str) {
  const bin = atob(str);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf;
}

function avatarColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.remove('hidden');
  toast.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.classList.add('hidden'), 300);
  }, 2200);
}

function setSaveStatus(state) {
  saveStatus.className = `save-status ${state}`;
  const labels = { saved: 'Saved', saving: 'Saving…', error: 'Save failed' };
  saveStatus.textContent = labels[state] || state;
}

// ── Crypto ──
async function deriveKey(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encrypt(data, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const enc = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(JSON.stringify(data))
  );
  return {
    salt: encodeBase64(salt),
    iv: encodeBase64(iv),
    data: encodeBase64(ciphertext),
    version: 1,
  };
}

async function decrypt(blob, password) {
  const salt = decodeBase64(blob.salt);
  const iv = decodeBase64(blob.iv);
  const ciphertext = decodeBase64(blob.data);
  const key = await deriveKey(password, salt);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );
  return JSON.parse(new TextDecoder().decode(plain));
}

function normalizeUsername(name) {
  return name.trim().toLowerCase();
}

function userStorageKey(username) {
  return `secure_vault_${normalizeUsername(username)}`;
}

function getUsersList() {
  try {
    return JSON.parse(localStorage.getItem(USERS_INDEX_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveUsersList(users) {
  localStorage.setItem(USERS_INDEX_KEY, JSON.stringify(users));
}

function addUserToIndex(displayName) {
  const key = normalizeUsername(displayName);
  const users = getUsersList();
  if (!users.some((u) => u.key === key)) {
    users.push({ key, displayName: displayName.trim() });
    saveUsersList(users);
  }
}

function getUserDisplayName(username) {
  const key = normalizeUsername(username);
  const user = getUsersList().find((u) => u.key === key);
  return user?.displayName || username.trim();
}

function hasStoredVault(username) {
  if (!username.trim()) return false;
  return localStorage.getItem(userStorageKey(username)) !== null;
}

function hasLegacyVault() {
  return localStorage.getItem(LEGACY_STORAGE_KEY) !== null;
}

function updateLockMode() {
  const username = usernameInput.value.trim();
  const userExists = username && hasStoredVault(username);
  const isLegacy = username && !userExists && hasLegacyVault() && getUsersList().length === 0;
  const isNew = username && !userExists && !isLegacy;

  if (isNew) {
    confirmPasswordGroup.classList.remove('hidden');
    unlockBtn.textContent = 'Create Vault';
  } else {
    confirmPasswordGroup.classList.add('hidden');
    unlockBtn.textContent = isLegacy ? 'Migrate to Username' : 'Unlock Vault';
  }
}

function renderUserChips() {
  const users = getUsersList();
  userChipsEl.innerHTML = '';

  if (users.length === 0) {
    existingUsersEl.classList.add('hidden');
    return;
  }

  existingUsersEl.classList.remove('hidden');
  users.forEach((user) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'user-chip';
    const initial = user.displayName.charAt(0).toUpperCase();
    const color = avatarColor(user.displayName);
    chip.innerHTML = `
      <span class="user-chip-avatar" style="background:${color}">${initial}</span>
      ${escapeHtml(user.displayName)}
    `;
    chip.addEventListener('click', () => {
      usernameInput.value = user.displayName;
      updateLockMode();
      masterPasswordInput.focus();
    });
    userChipsEl.appendChild(chip);
  });
}

async function saveVault() {
  if (!masterPassword || !currentUsername) return;
  setSaveStatus('saving');
  try {
    const encrypted = await encrypt(vault, masterPassword);
    localStorage.setItem(userStorageKey(currentUsername), JSON.stringify(encrypted));
    localStorage.setItem(LAST_USER_KEY, normalizeUsername(currentUsername));
    setSaveStatus('saved');
  } catch {
    setSaveStatus('error');
    showToast('Failed to save vault');
  }
}

function scheduleSave() {
  setSaveStatus('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveVault, 400);
}

// ── Vault operations ──
function defaultFields() {
  return [
    { id: uid(), label: 'Username', value: '', secret: false },
    { id: uid(), label: 'Password', value: '', secret: true },
    { id: uid(), label: 'URL', value: '', secret: false },
    { id: uid(), label: 'Notes', value: '', secret: false },
  ];
}

function createApplication(name = 'New Application') {
  return {
    id: uid(),
    name,
    fields: defaultFields(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function getFilteredApps() {
  const q = searchQuery.trim().toLowerCase();
  if (!q) return vault.applications;
  return vault.applications.filter((app) => {
    if (app.name.toLowerCase().includes(q)) return true;
    return app.fields.some(
      (f) => f.label.toLowerCase().includes(q) || f.value.toLowerCase().includes(q)
    );
  });
}

function generatePassword(length = 20) {
  const chars = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*';
  const arr = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(arr, (b) => chars[b % chars.length]).join('');
}

// ── Lock / Unlock ──
function showLockScreen() {
  masterPassword = '';
  currentUsername = '';
  vault = { applications: [] };
  lockScreen.classList.remove('hidden');
  appEl.classList.add('hidden');
  usernameInput.value = '';
  masterPasswordInput.value = '';
  confirmPasswordInput.value = '';
  lockError.classList.add('hidden');
  currentUserBadge.textContent = '';
  currentUserBadge.dataset.initial = '';

  renderUserChips();

  const lastUserKey = localStorage.getItem(LAST_USER_KEY);
  if (lastUserKey) {
    const lastUser = getUsersList().find((u) => u.key === lastUserKey);
    if (lastUser) usernameInput.value = lastUser.displayName;
  }

  updateLockMode();
  usernameInput.focus();
}

function showApp() {
  lockScreen.classList.add('hidden');
  appEl.classList.remove('hidden');
  const displayName = getUserDisplayName(currentUsername);
  currentUserBadge.textContent = displayName;
  currentUserBadge.dataset.initial = displayName.charAt(0).toUpperCase();
  currentUserBadge.style.setProperty('--badge-color', avatarColor(displayName));
  render();
  searchInput.focus();
}

async function handleUnlock(e) {
  e.preventDefault();
  const username = usernameInput.value.trim();
  const password = masterPasswordInput.value;
  const userExists = hasStoredVault(username);
  const isLegacy = !userExists && hasLegacyVault() && getUsersList().length === 0;
  const isNew = !userExists && !isLegacy;

  lockError.classList.add('hidden');

  if (!username || username.length < 2) {
    lockError.textContent = 'Username must be at least 2 characters.';
    lockError.classList.remove('hidden');
    return;
  }

  if (!password || password.length < 8) {
    lockError.textContent = 'Master password must be at least 8 characters.';
    lockError.classList.remove('hidden');
    return;
  }

  if (isNew) {
    if (password !== confirmPasswordInput.value) {
      lockError.textContent = 'Passwords do not match.';
      lockError.classList.remove('hidden');
      return;
    }
    currentUsername = username;
    masterPassword = password;
    vault = { applications: [] };
    addUserToIndex(username);
    await saveVault();
    showApp();
    showToast(`Vault created for ${getUserDisplayName(username)}`);
    return;
  }

  try {
    let stored;
    if (isLegacy) {
      stored = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY));
    } else {
      stored = JSON.parse(localStorage.getItem(userStorageKey(username)));
    }

    vault = await decrypt(stored, password);
    if (!vault.applications) vault.applications = [];

    currentUsername = username;
    masterPassword = password;

    if (isLegacy) {
      addUserToIndex(username);
      await saveVault();
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      showToast('Vault migrated to your username');
    }

    showApp();
  } catch {
    lockError.textContent = isLegacy || userExists
      ? 'Incorrect master password.'
      : 'Could not unlock vault. Check username and password.';
    lockError.classList.remove('hidden');
  }
}

function lockVault() {
  clearTimeout(saveTimer);
  showLockScreen();
}

// ── Rendering ──
function render() {
  const filtered = getFilteredApps();
  const total = vault.applications.length;

  appCount.textContent = `${total} application${total !== 1 ? 's' : ''}`;

  const isEmpty = total === 0;
  const noMatch = !isEmpty && filtered.length === 0;

  emptyState.classList.toggle('hidden', !isEmpty);
  noResults.classList.toggle('hidden', !noMatch);
  appGrid.classList.toggle('hidden', isEmpty || noMatch);

  appGrid.innerHTML = '';
  filtered.forEach((app, i) => {
    appGrid.appendChild(buildAppCard(app, i));
  });
}

function buildAppCard(app, index) {
  const card = document.createElement('article');
  card.className = 'app-card';
  card.dataset.id = app.id;
  card.style.animationDelay = `${index * 50}ms`;

  const initial = (app.name || '?').charAt(0).toUpperCase();
  const color = avatarColor(app.name || '');

  card.innerHTML = `
    <div class="app-card-header">
      <div class="app-avatar" style="background:${color}">${initial}</div>
      <div class="app-name" contenteditable="true" spellcheck="false" role="textbox" aria-label="Application name">${escapeHtml(app.name)}</div>
      <div class="app-card-actions">
        <button class="icon-btn delete-app-btn" title="Delete application" aria-label="Delete application">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
        </button>
      </div>
    </div>
    <div class="app-card-body"></div>
  `;

  const nameEl = card.querySelector('.app-name');
  const body = card.querySelector('.app-card-body');

  nameEl.addEventListener('input', () => {
    app.name = nameEl.textContent.trim() || 'Untitled';
    app.updatedAt = Date.now();
    card.querySelector('.app-avatar').textContent = app.name.charAt(0).toUpperCase();
    card.querySelector('.app-avatar').style.background = avatarColor(app.name);
    scheduleSave();
  });

  nameEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); }
  });

  app.fields.forEach((field) => {
    body.appendChild(buildFieldRow(app, field));
  });

  const addBtn = document.createElement('button');
  addBtn.className = 'add-field-btn';
  addBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg> Add field`;
  addBtn.addEventListener('click', () => {
    const field = { id: uid(), label: 'Custom', value: '', secret: false };
    app.fields.push(field);
    app.updatedAt = Date.now();
    body.insertBefore(buildFieldRow(app, field), addBtn);
    scheduleSave();
  });
  body.appendChild(addBtn);

  card.querySelector('.delete-app-btn').addEventListener('click', () => {
    if (confirm(`Delete "${app.name}"? This cannot be undone.`)) {
      vault.applications = vault.applications.filter((a) => a.id !== app.id);
      scheduleSave();
      render();
      showToast('Application deleted');
    }
  });

  return card;
}

function buildFieldRow(app, field) {
  const row = document.createElement('div');
  row.className = 'field-row';
  row.dataset.fieldId = field.id;

  row.innerHTML = `
    <div class="field-label" contenteditable="true" spellcheck="false" role="textbox" aria-label="Field label">${escapeHtml(field.label)}</div>
    <div class="field-value-wrap">
      <div class="field-value${field.secret ? ' secret' : ''}" contenteditable="true" spellcheck="false" role="textbox" aria-label="Field value">${escapeHtml(field.value)}</div>
    </div>
    <div class="field-actions">
      ${field.secret ? `
        <button class="icon-btn toggle-secret-btn" title="Show/hide" aria-label="Toggle visibility">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        </button>
        <button class="icon-btn generate-btn" title="Generate password" aria-label="Generate password">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2l-2 2M3 21l2-2M12 2v4M12 18v4M2 12h4M18 12h4"/><circle cx="12" cy="12" r="4"/></svg>
        </button>
      ` : ''}
      <button class="icon-btn copy-btn" title="Copy" aria-label="Copy value">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
      </button>
      <button class="icon-btn delete-field-btn" title="Remove field" aria-label="Remove field">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>
  `;

  const labelEl = row.querySelector('.field-label');
  const valueEl = row.querySelector('.field-value');

  labelEl.addEventListener('input', () => {
    field.label = labelEl.textContent.trim() || 'Field';
    app.updatedAt = Date.now();
    scheduleSave();
  });

  labelEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); labelEl.blur(); }
  });

  valueEl.addEventListener('input', () => {
    field.value = valueEl.textContent;
    app.updatedAt = Date.now();
    scheduleSave();
  });

  valueEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); valueEl.blur(); }
  });

  const toggleBtn = row.querySelector('.toggle-secret-btn');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      valueEl.classList.toggle('revealed');
    });
  }

  const genBtn = row.querySelector('.generate-btn');
  if (genBtn) {
    genBtn.addEventListener('click', () => {
      field.value = generatePassword();
      valueEl.textContent = field.value;
      valueEl.classList.add('revealed');
      app.updatedAt = Date.now();
      scheduleSave();
      showToast('Password generated');
    });
  }

  row.querySelector('.copy-btn').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(field.value);
      showToast('Copied to clipboard');
    } catch {
      showToast('Copy failed');
    }
  });

  row.querySelector('.delete-field-btn').addEventListener('click', () => {
    if (app.fields.length <= 1) {
      showToast('Each application needs at least one field');
      return;
    }
    app.fields = app.fields.filter((f) => f.id !== field.id);
    app.updatedAt = Date.now();
    row.remove();
    scheduleSave();
  });

  return row;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Export / Import ──
async function exportVault() {
  const stored = localStorage.getItem(userStorageKey(currentUsername));
  if (!stored) return;
  const slug = normalizeUsername(currentUsername);
  const blob = new Blob([stored], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `secure-vault-${slug}-${new Date().toISOString().slice(0, 10)}.vault`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Backup downloaded');
}

async function importVault(file) {
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (!parsed.salt || !parsed.iv || !parsed.data) throw new Error('Invalid format');

    const testVault = await decrypt(parsed, masterPassword);
    localStorage.setItem(userStorageKey(currentUsername), text);
    vault = testVault;
    if (!vault.applications) vault.applications = [];
    render();
    showToast('Backup imported successfully');
  } catch {
    showToast('Import failed — wrong password or invalid file');
  }
}

// ── Event listeners ──
unlockForm.addEventListener('submit', handleUnlock);

usernameInput.addEventListener('input', updateLockMode);

document.querySelectorAll('.toggle-password').forEach((btn) => {
  btn.addEventListener('click', () => {
    const input = document.getElementById(btn.dataset.target);
    input.type = input.type === 'password' ? 'text' : 'password';
  });
});

$('#add-app-btn').addEventListener('click', addNewApp);
$('#empty-add-btn').addEventListener('click', addNewApp);

function addNewApp() {
  const app = createApplication();
  vault.applications.unshift(app);
  scheduleSave();
  searchQuery = '';
  searchInput.value = '';
  render();
  showToast('Application created');

  requestAnimationFrame(() => {
    const card = appGrid.querySelector(`[data-id="${app.id}"]`);
    if (card) {
      const nameEl = card.querySelector('.app-name');
      nameEl.focus();
      document.getSelection()?.selectAllChildren(nameEl);
    }
  });
}

searchInput.addEventListener('input', (e) => {
  searchQuery = e.target.value;
  render();
});

$('#lock-btn').addEventListener('click', lockVault);

$('#export-btn').addEventListener('click', exportVault);

$('#import-btn').addEventListener('click', () => $('#import-file').click());

$('#import-file').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) importVault(file);
  e.target.value = '';
});

document.addEventListener('keydown', (e) => {
  const appOpen = lockScreen.classList.contains('hidden') && !appEl.classList.contains('hidden');
  if (e.key === '/' && appOpen && document.activeElement !== searchInput) {
    if (document.activeElement?.isContentEditable) return;
    e.preventDefault();
    searchInput.focus();
  }
});

// ── Init ──
showLockScreen();
