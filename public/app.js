/* Architektur-Toolbox – Dashboard-Logik */
'use strict';

const state = {
  tools: [],
  category: 'Alle',
  query: '',
};

const els = {
  grid: document.getElementById('grid'),
  empty: document.getElementById('empty'),
  filters: document.getElementById('filters'),
  search: document.getElementById('search'),
  count: document.getElementById('tool-count'),
  themeToggle: document.getElementById('theme-toggle'),
  modal: document.getElementById('modal'),
  modalTitle: document.getElementById('modal-title'),
  modalStatus: document.getElementById('modal-status'),
  modalOutput: document.getElementById('modal-output'),
  modalClose: document.getElementById('modal-close'),
  authBtn: document.getElementById('auth-btn'),
  authUsernameLabel: document.getElementById('auth-username-label'),
  authMenu: document.getElementById('auth-menu'),
  authMenuName: document.getElementById('auth-menu-name'),
  authMenuAdmin: document.getElementById('auth-menu-admin'),
  authMenuLogout: document.getElementById('auth-menu-logout'),
  authModal: document.getElementById('auth-modal'),
  authModalClose: document.getElementById('auth-modal-close'),
  authTabLogin: document.getElementById('auth-tab-login'),
  authTabRegister: document.getElementById('auth-tab-register'),
  authForm: document.getElementById('auth-form'),
  authUsername: document.getElementById('auth-username'),
  authPassword: document.getElementById('auth-password'),
  authMessage: document.getElementById('auth-message'),
  authSubmit: document.getElementById('auth-submit'),
};

const TYPE_LABEL = { link: 'Link', page: 'Web-Tool', script: 'Script' };

// ---------- Theme ----------
function initTheme() {
  const saved = localStorage.getItem('toolbox-theme');
  const theme = saved || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = theme;
}
els.themeToggle.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('toolbox-theme', next);
});

// ---------- Daten laden ----------
async function loadTools() {
  try {
    const res = await fetch('/api/tools');
    const data = await res.json();
    state.tools = data.tools || [];
  } catch (err) {
    state.tools = [];
    console.error('Tools konnten nicht geladen werden:', err);
  }
  renderFilters();
  render();
}

// ---------- Kategorie-Filter ----------
function renderFilters() {
  const cats = ['Alle', ...new Set(state.tools.map((t) => t.category))];
  els.filters.innerHTML = '';
  for (const cat of cats) {
    const chip = document.createElement('button');
    chip.className = 'chip' + (cat === state.category ? ' active' : '');
    chip.textContent = cat;
    chip.addEventListener('click', () => {
      state.category = cat;
      renderFilters();
      render();
    });
    els.filters.appendChild(chip);
  }
}

// ---------- Filtern ----------
function filtered() {
  const q = state.query.trim().toLowerCase();
  return state.tools.filter((t) => {
    if (state.category !== 'Alle' && t.category !== state.category) return false;
    if (!q) return true;
    const haystack = [t.name, t.description, t.category, ...(t.tags || [])]
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  });
}

// ---------- Rendern ----------
function render() {
  const items = filtered();
  els.grid.innerHTML = '';
  els.empty.hidden = items.length > 0;

  for (const tool of items) {
    els.grid.appendChild(card(tool));
  }

  const total = state.tools.length;
  els.count.textContent = `${total} Tool${total === 1 ? '' : 's'} verfügbar`;
}

function card(tool) {
  const el = document.createElement(tool.type === 'link' || tool.type === 'page' ? 'a' : 'div');
  el.className = 'card';

  if (tool.type === 'link') {
    el.href = tool.url || '#';
    el.target = '_blank';
    el.rel = 'noopener';
  } else if (tool.type === 'page') {
    el.href = `/tools/${tool.id}/${tool.entry}`;
    el.target = '_blank';
    el.rel = 'noopener';
  } else if (tool.type === 'script') {
    el.addEventListener('click', () => runScript(tool));
  }

  const cta =
    tool.type === 'link' ? 'Öffnen ↗' :
    tool.type === 'page' ? 'Starten ↗' :
    tool.runnable ? 'Ausführen ▸' : 'Nicht ausführbar';

  el.innerHTML = `
    <div class="card-top">
      <div class="card-icon">${tool.icon}</div>
      <span class="card-type">${TYPE_LABEL[tool.type] || tool.type}</span>
    </div>
    <h3></h3>
    <p></p>
    <div class="card-tags"></div>
    <div class="card-foot">
      <span class="foot-meta">
        <span class="foot-cat"></span>
        <span class="foot-ver"></span>
      </span>
      <span class="card-cta">${cta}</span>
    </div>
  `;
  el.querySelector('h3').textContent = tool.name;
  el.querySelector('p').textContent = tool.description;
  el.querySelector('.foot-cat').textContent = tool.category;

  const verEl = el.querySelector('.foot-ver');
  if (tool.version) verEl.textContent = 'v' + tool.version;
  else verEl.remove();

  const tagsEl = el.querySelector('.card-tags');
  for (const tag of (tool.tags || []).slice(0, 4)) {
    const t = document.createElement('span');
    t.className = 'tag';
    t.textContent = tag;
    tagsEl.appendChild(t);
  }

  return el;
}

// ---------- Script ausführen ----------
async function runScript(tool) {
  if (!tool.runnable) return;
  openModal(tool.name, 'run', 'Wird ausgeführt…', '');
  try {
    const res = await fetch(`/api/run/${encodeURIComponent(tool.id)}`, { method: 'POST' });
    const data = await res.json();
    const out = [data.stdout, data.stderr].filter(Boolean).join('\n').trim();
    if (data.ok) {
      openModal(tool.name, 'ok', `✓ Erfolgreich (${data.durationMs} ms)`, out || '(keine Ausgabe)');
    } else {
      const msg = data.error ? `Fehler: ${data.error}` : `Beendet mit Code ${data.code}`;
      openModal(tool.name, 'err', `✗ ${msg}`, out || '(keine Ausgabe)');
    }
  } catch (err) {
    openModal(tool.name, 'err', '✗ Server nicht erreichbar', String(err));
  }
}

function openModal(title, statusClass, statusText, output) {
  els.modalTitle.textContent = title;
  els.modalStatus.className = 'modal-status ' + statusClass;
  els.modalStatus.textContent = statusText;
  els.modalOutput.textContent = output;
  els.modal.hidden = false;
}
function closeModal() { els.modal.hidden = true; }

els.modalClose.addEventListener('click', closeModal);
els.modal.addEventListener('click', (e) => { if (e.target === els.modal) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

// ---------- Suche ----------
els.search.addEventListener('input', (e) => {
  state.query = e.target.value;
  render();
});

// ---------- Auth ----------
let authMode = 'login'; // 'login' | 'register'

function setAuthMode(mode) {
  authMode = mode;
  els.authTabLogin.classList.toggle('active', mode === 'login');
  els.authTabRegister.classList.toggle('active', mode === 'register');
  document.getElementById('auth-modal-title').textContent = mode === 'login' ? 'Anmelden' : 'Registrieren';
  els.authSubmit.textContent = mode === 'login' ? 'Anmelden' : 'Registrieren';
  els.authPassword.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  els.authMessage.hidden = true;
}

function openAuthModal() {
  els.authMenu.hidden = true;
  setAuthMode('login');
  els.authForm.reset();
  els.authModal.hidden = false;
  els.authUsername.focus();
}
function closeAuthModal() { els.authModal.hidden = true; }

function showAuthMessage(text, isError) {
  els.authMessage.hidden = false;
  els.authMessage.textContent = text;
  els.authMessage.className = 'auth-message ' + (isError ? 'err' : 'ok');
}

async function refreshAuthUI() {
  const session = await Toolbox.getSession();
  els.authBtn.textContent = '👤';
  if (session.loggedIn) {
    els.authUsernameLabel.textContent = session.user.username;
    els.authUsernameLabel.hidden = false;
    els.authBtn.title = 'Konto';
    els.authMenuName.textContent = session.user.username + (session.user.role === 'admin' ? ' (Admin)' : '');
    els.authMenuAdmin.hidden = session.user.role !== 'admin';
  } else {
    els.authUsernameLabel.hidden = true;
    els.authBtn.title = 'Anmelden';
  }
}

els.authBtn.addEventListener('click', async () => {
  const session = await Toolbox.getSession();
  if (session.loggedIn) {
    els.authMenu.hidden = !els.authMenu.hidden;
  } else {
    openAuthModal();
  }
});

document.addEventListener('click', (e) => {
  if (!els.authMenu.hidden && !els.authMenu.contains(e.target) && e.target !== els.authBtn) {
    els.authMenu.hidden = true;
  }
});

els.authMenuLogout.addEventListener('click', async () => {
  await Toolbox.logout();
  els.authMenu.hidden = true;
  refreshAuthUI();
});

els.authTabLogin.addEventListener('click', () => setAuthMode('login'));
els.authTabRegister.addEventListener('click', () => setAuthMode('register'));
els.authModalClose.addEventListener('click', closeAuthModal);
els.authModal.addEventListener('click', (e) => { if (e.target === els.authModal) closeAuthModal(); });

els.authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = els.authUsername.value.trim();
  const password = els.authPassword.value;
  els.authSubmit.disabled = true;
  try {
    if (authMode === 'login') {
      const data = await Toolbox.login(username, password);
      if (data.ok) {
        closeAuthModal();
        refreshAuthUI();
      } else {
        showAuthMessage(data.error || 'Anmeldung fehlgeschlagen.', true);
      }
    } else {
      const data = await Toolbox.register(username, password);
      if (data.ok) {
        showAuthMessage(data.message || 'Account erstellt.', false);
        if (data.status === 'active') {
          setTimeout(async () => {
            const loginData = await Toolbox.login(username, password);
            if (loginData.ok) { closeAuthModal(); refreshAuthUI(); }
          }, 600);
        }
      } else {
        showAuthMessage(data.error || 'Registrierung fehlgeschlagen.', true);
      }
    }
  } catch (err) {
    showAuthMessage('Server nicht erreichbar.', true);
  } finally {
    els.authSubmit.disabled = false;
  }
});

// ---------- Start ----------
initTheme();
loadTools();
refreshAuthUI();
