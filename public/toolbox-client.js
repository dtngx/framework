/* Toolbox-Client – gemeinsamer Helfer für Login-Status & Datenspeicherung.
   Wird von der Dashboard-Seite und von einzelnen Tool-Seiten eingebunden. */
'use strict';

(function () {
  let sessionPromise = null;

  async function fetchSession() {
    try {
      const res = await fetch('/api/auth/me');
      return await res.json();
    } catch (_) {
      return { loggedIn: false };
    }
  }

  function getSession() {
    if (!sessionPromise) sessionPromise = fetchSession();
    return sessionPromise;
  }

  function resetSessionCache() {
    sessionPromise = null;
  }

  async function isLoggedIn() {
    const s = await getSession();
    return !!s.loggedIn;
  }

  async function login(username, password) {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (data.ok) resetSessionCache();
    return data;
  }

  async function register(username, password) {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    return res.json();
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    resetSessionCache();
  }

  async function loadKey(toolId, key, fallbackLocalStorageKey) {
    const session = await getSession();
    if (session.loggedIn) {
      try {
        const res = await fetch(`/api/data/${encodeURIComponent(toolId)}/${encodeURIComponent(key)}`);
        if (!res.ok) return null;
        const data = await res.json();
        return data.value;
      } catch (_) {
        return null;
      }
    }
    const raw = localStorage.getItem(fallbackLocalStorageKey);
    return raw ? JSON.parse(raw) : null;
  }

  async function saveKey(toolId, key, value, fallbackLocalStorageKey) {
    const session = await getSession();
    if (session.loggedIn) {
      try {
        await fetch(`/api/data/${encodeURIComponent(toolId)}/${encodeURIComponent(key)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value }),
        });
      } catch (err) {
        console.error('[toolbox] Speichern fehlgeschlagen:', err);
      }
      return;
    }
    localStorage.setItem(fallbackLocalStorageKey, JSON.stringify(value));
  }

  /**
   * Bietet einmalig an, vorhandene localStorage-Daten in den Account zu übernehmen.
   * localStorageKeys: Array von Keys, die für dieses Tool im Browser stehen könnten.
   * Gibt true zurück, wenn Daten übernommen wurden (Aufrufer sollte dann aus der DB neu laden).
   */
  async function maybeOfferMigration(toolId, localStorageKeys) {
    const session = await getSession();
    if (!session.loggedIn) return false;

    try {
      const statusRes = await fetch(`/api/data/${encodeURIComponent(toolId)}/migration-status`);
      const status = await statusRes.json();
      if (status.decided) return false;
    } catch (_) {
      return false;
    }

    const payload = {};
    let hasData = false;
    for (const key of localStorageKeys) {
      const raw = localStorage.getItem(key);
      if (raw && raw !== '[]' && raw !== '{}' && raw !== 'null') {
        try {
          payload[key] = JSON.parse(raw);
          hasData = true;
        } catch (_) {
          /* kein gültiges JSON, ignorieren */
        }
      }
    }

    if (!hasData) {
      await fetch(`/api/data/${encodeURIComponent(toolId)}/migrate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'no' }),
      });
      return false;
    }

    const wantsMigration = window.confirm(
      'Du hast in diesem Browser bereits gespeicherte Daten für dieses Tool.\n\n' +
      'Möchtest du diese Daten jetzt einmalig in dein Konto übernehmen, damit du sie auch auf anderen Geräten siehst?'
    );

    await fetch(`/api/data/${encodeURIComponent(toolId)}/migrate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: wantsMigration ? 'yes' : 'no', payload: wantsMigration ? payload : undefined }),
    });

    return wantsMigration;
  }

  // ---------- Projekte (mehrere benannte Arbeitsstände pro Tool) ----------

  const projects = {
    async list(toolId) {
      const res = await fetch(`/api/projects/${encodeURIComponent(toolId)}`);
      if (!res.ok) return [];
      const data = await res.json();
      return data.projects || [];
    },
    async create(toolId, name) {
      const res = await fetch(`/api/projects/${encodeURIComponent(toolId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Projekt konnte nicht angelegt werden.');
      return data.project;
    },
    async get(toolId, id) {
      const res = await fetch(`/api/projects/${encodeURIComponent(toolId)}/${id}`);
      if (!res.ok) return null;
      const data = await res.json();
      return data.project;
    },
    async save(toolId, id, data) {
      try {
        await fetch(`/api/projects/${encodeURIComponent(toolId)}/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data }),
        });
      } catch (err) {
        console.error('[toolbox] Projekt speichern fehlgeschlagen:', err);
      }
    },
    async rename(toolId, id, name) {
      const res = await fetch(`/api/projects/${encodeURIComponent(toolId)}/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      return res.ok;
    },
    async remove(toolId, id) {
      const res = await fetch(`/api/projects/${encodeURIComponent(toolId)}/${id}`, { method: 'DELETE' });
      return res.ok;
    },
    async setShared(toolId, id, shared) {
      const res = await fetch(`/api/projects/${encodeURIComponent(toolId)}/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shared }),
      });
      return res.ok;
    },
  };

  let pickerStyleInjected = false;
  function injectPickerStyle() {
    if (pickerStyleInjected) return;
    pickerStyleInjected = true;
    const style = document.createElement('style');
    style.textContent = `
      .tbx-picker-backdrop {
        /* Tools heißen ihre Variablen --panel/--panel2/--muted, das Dashboard --bg-elev/--surface-2/--text-muted */
        --p-bg: var(--bg-elev, var(--panel, #fff));
        --p-raised: var(--surface-2, var(--panel2, #f4f4f3));
        --p-border: var(--border, #e7e6e3);
        --p-text: var(--text, #111);
        --p-muted: var(--text-muted, var(--muted, #6b6b68));
        --p-btn-bg: var(--btn-bg, var(--text, #111));
        --p-btn-fg: var(--btn-fg, var(--bg, #fff));
        --p-ease: cubic-bezier(.22, 1, .36, 1);
        position: fixed; inset: 0; z-index: 9999;
        background: rgba(10,10,10,.5);
        display: flex; align-items: center; justify-content: center;
        padding: 24px;
      }
      .tbx-picker-box {
        width: min(520px, 100%); max-height: 82vh; overflow: auto;
        background: var(--p-bg); color: var(--p-text);
        border: 1px solid var(--p-border); border-radius: 16px;
        box-shadow: 0 1px 2px rgba(0,0,0,.05), 0 8px 24px rgba(0,0,0,.08);
        padding: 24px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        font-size: 14px; line-height: 1.5;
        animation: tbx-rise .3s var(--p-ease);
      }
      @keyframes tbx-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
      .tbx-picker-box button, .tbx-picker-box input { font-family: inherit; }
      .tbx-picker-box :focus-visible { outline: 2px solid var(--accent, #ff4f00); outline-offset: 2px; }
      .tbx-picker-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 20px; }
      .tbx-picker-head h2 { margin: 0; font-size: 18px; font-weight: 500; line-height: 1.3; }
      .tbx-picker-section-label { font-size: 12px; font-weight: 500; color: var(--p-muted); margin: 24px 0 8px; }
      .tbx-picker-section-label:first-of-type { margin-top: 0; }
      .tbx-picker-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
      .tbx-picker-item {
        display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
        border: 1px solid var(--p-border); border-radius: 10px; padding: 12px;
      }
      .tbx-picker-item-name { font-weight: 500; font-size: 14px; }
      .tbx-picker-item-date {
        font-family: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px; color: var(--p-muted); font-variant-numeric: tabular-nums;
      }
      .tbx-picker-item-owner { color: var(--p-text); }
      .tbx-picker-item-actions { display: flex; gap: 4px; flex-wrap: wrap; }
      .tbx-picker-box button {
        height: 32px; border: 1px solid var(--p-border); background: var(--p-raised); color: var(--p-text);
        border-radius: 8px; padding: 0 12px; font-size: 13px; cursor: pointer;
        transition: border-color .15s var(--p-ease), opacity .15s var(--p-ease);
      }
      .tbx-picker-box button:hover { border-color: color-mix(in srgb, var(--p-text) 25%, var(--p-border)); }
      .tbx-picker-box button.tbx-picker-open, .tbx-picker-new button {
        background: var(--p-btn-bg); border-color: var(--p-btn-bg); color: var(--p-btn-fg); font-weight: 500;
      }
      .tbx-picker-box button.tbx-picker-open:hover, .tbx-picker-new button:hover { opacity: .88; }
      .tbx-picker-item-actions .tbx-picker-delete:hover { border-color: var(--err, #dc2626); color: var(--err, #dc2626); }
      .tbx-picker-empty { color: var(--p-muted); font-size: 13px; padding: 4px 0; }
      .tbx-picker-new { display: flex; gap: 8px; margin-top: 24px; }
      .tbx-picker-new input {
        flex: 1; height: 36px; border: 1px solid var(--p-border); background: var(--p-raised); color: var(--p-text);
        border-radius: 8px; padding: 0 12px; font-size: 14px; outline: none;
      }
      .tbx-picker-new input:focus { border-color: color-mix(in srgb, var(--p-text) 25%, var(--p-border)); }
      .tbx-picker-new button { height: 36px; }
      .tbx-picker-error { color: var(--err, #dc2626); font-size: 13px; margin-top: 8px; min-height: 20px; }
      .tbx-picker-box button.tbx-picker-close {
        width: 32px; height: 32px; padding: 0; display: grid; place-items: center; flex: none;
        background: transparent; border-color: transparent; color: var(--p-muted);
      }
      .tbx-picker-box button.tbx-picker-close:hover { background: var(--p-raised); color: var(--p-text); }
      .tbx-picker-foot { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; border-top: 1px solid var(--p-border); padding-top: 16px; }
      .tbx-picker-foot button { flex: 1; }
    `;
    document.head.appendChild(style);
  }

  function fmtDate(iso) {
    if (!iso) return '';
    return iso.replace('T', ' ').slice(0, 16);
  }

  /**
   * Zeigt eine Vollbild-Projektauswahl (Öffnen/Umbenennen/Löschen/Neu anlegen).
   * Löst auf mit { anonymous: true } wenn nicht eingeloggt (zeigt dann nichts an),
   * mit { cancelled: true } wenn der Dialog geschlossen wurde ohne ein Projekt zu wählen,
   * sonst mit { project: {id, name, data} } sobald ein Projekt gewählt/angelegt wurde.
   */
  function showProjectPicker(toolId, opts) {
    const options = opts || {};
    return getSession().then((session) => {
      if (!session.loggedIn) return { anonymous: true };

      injectPickerStyle();
      return new Promise((resolve) => {
        const backdrop = document.createElement('div');
        backdrop.className = 'tbx-picker-backdrop';
        const box = document.createElement('div');
        box.className = 'tbx-picker-box';
        box.innerHTML = `
          <div class="tbx-picker-head">
            <h2>${options.title ? escapeHtml(options.title) : 'Projekt wählen'}</h2>
            <button type="button" class="tbx-picker-close" title="Schließen" aria-label="Schließen"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>
          </div>
          <div class="tbx-picker-section-label">Meine Projekte</div>
          <ul class="tbx-picker-list tbx-picker-list-mine"></ul>
          <div class="tbx-picker-section-label tbx-picker-shared-label" hidden>Geteilt von Kollegen</div>
          <ul class="tbx-picker-list tbx-picker-list-shared"></ul>
          <div class="tbx-picker-new">
            <input type="text" placeholder="Name für neues Projekt" maxlength="80" />
            <button type="button">Anlegen</button>
          </div>
          <div class="tbx-picker-error"></div>
          <div class="tbx-picker-foot">
            <button type="button" class="tbx-picker-cancel">Ohne Projekt fortfahren</button>
            <button type="button" class="tbx-picker-back">Zurück zu den Werkzeugen</button>
          </div>
        `;
        backdrop.appendChild(box);
        document.body.appendChild(backdrop);

        const listMineEl = box.querySelector('.tbx-picker-list-mine');
        const listSharedEl = box.querySelector('.tbx-picker-list-shared');
        const sharedLabelEl = box.querySelector('.tbx-picker-shared-label');
        const errorEl = box.querySelector('.tbx-picker-error');
        const newInput = box.querySelector('.tbx-picker-new input');
        const newBtn = box.querySelector('.tbx-picker-new button');
        const closeBtn = box.querySelector('.tbx-picker-close');
        const cancelBtn = box.querySelector('.tbx-picker-cancel');
        const backBtn = box.querySelector('.tbx-picker-back');

        function showError(msg) { errorEl.textContent = msg || ''; }

        function cancel() {
          document.removeEventListener('keydown', onKeydown);
          document.body.removeChild(backdrop);
          resolve({ cancelled: true });
        }

        function goBack() {
          window.location.href = '/';
        }

        function onKeydown(e) {
          if (e.key === 'Escape') cancel();
        }

        closeBtn.addEventListener('click', cancel);
        cancelBtn.addEventListener('click', cancel);
        backBtn.addEventListener('click', goBack);
        backdrop.addEventListener('click', (e) => { if (e.target === backdrop) cancel(); });
        document.addEventListener('keydown', onKeydown);

        async function openProject(id) {
          const project = await projects.get(toolId, id);
          if (!project) { showError('Projekt konnte nicht geladen werden'); return; }
          document.removeEventListener('keydown', onKeydown);
          document.body.removeChild(backdrop);
          resolve({ project });
        }

        function renderItem(p, mine) {
          const li = document.createElement('li');
          li.className = 'tbx-picker-item';
          li.innerHTML = `
            <div>
              <div class="tbx-picker-item-name"></div>
              <div class="tbx-picker-item-date"></div>
            </div>
            <div class="tbx-picker-item-actions">
              <button type="button" class="tbx-picker-open">Öffnen</button>
              <button type="button" class="tbx-picker-rename">Umbenennen</button>
              <button type="button" class="tbx-picker-share"></button>
              <button type="button" class="tbx-picker-delete">Löschen</button>
            </div>
          `;
          li.querySelector('.tbx-picker-item-name').textContent = p.name;
          const dateEl = li.querySelector('.tbx-picker-item-date');
          const dateText = 'Geändert ' + fmtDate(p.updated_at);
          if (mine) {
            dateEl.textContent = dateText + (p.shared ? ' · geteilt' : '');
          } else {
            dateEl.innerHTML = '';
            dateEl.append(dateText + ' · von ');
            const ownerSpan = document.createElement('span');
            ownerSpan.className = 'tbx-picker-item-owner';
            ownerSpan.textContent = p.owner_username;
            dateEl.append(ownerSpan);
          }
          li.querySelector('.tbx-picker-open').addEventListener('click', () => openProject(p.id));
          li.querySelector('.tbx-picker-rename').addEventListener('click', async () => {
            const name = window.prompt('Neuer Projektname:', p.name);
            if (!name || !name.trim()) return;
            await projects.rename(toolId, p.id, name.trim());
            refresh();
          });
          const shareBtn = li.querySelector('.tbx-picker-share');
          shareBtn.textContent = p.shared ? 'Freigabe aufheben' : 'Teilen';
          shareBtn.addEventListener('click', async () => {
            await projects.setShared(toolId, p.id, !p.shared);
            refresh();
          });
          li.querySelector('.tbx-picker-delete').addEventListener('click', async () => {
            if (!window.confirm(`Projekt "${p.name}" wirklich löschen?`)) return;
            await projects.remove(toolId, p.id);
            refresh();
          });
          return li;
        }

        async function refresh() {
          const list = await projects.list(toolId);
          const mineList = list.filter((p) => p.user_id === session.user.id);
          const sharedList = list.filter((p) => p.user_id !== session.user.id);

          listMineEl.innerHTML = '';
          if (!mineList.length) {
            const empty = document.createElement('div');
            empty.className = 'tbx-picker-empty';
            empty.textContent = 'Noch keine eigenen Projekte. Leg unten ein neues an.';
            listMineEl.appendChild(empty);
          }
          for (const p of mineList) listMineEl.appendChild(renderItem(p, true));

          sharedLabelEl.hidden = sharedList.length === 0;
          listSharedEl.innerHTML = '';
          for (const p of sharedList) listSharedEl.appendChild(renderItem(p, false));
        }

        newBtn.addEventListener('click', async () => {
          const name = newInput.value.trim();
          if (!name) { showError('Bitte einen Namen eingeben'); return; }
          try {
            const project = await projects.create(toolId, name);
            document.removeEventListener('keydown', onKeydown);
            document.body.removeChild(backdrop);
            resolve({ project });
          } catch (err) {
            showError(err.message || 'Projekt konnte nicht angelegt werden');
          }
        });
        newInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') newBtn.click();
        });

        refresh();
      });
    });
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  window.Toolbox = {
    getSession,
    resetSessionCache,
    isLoggedIn,
    login,
    register,
    logout,
    loadKey,
    saveKey,
    maybeOfferMigration,
    projects,
    showProjectPicker,
  };
})();
