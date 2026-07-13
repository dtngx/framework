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
  };

  let pickerStyleInjected = false;
  function injectPickerStyle() {
    if (pickerStyleInjected) return;
    pickerStyleInjected = true;
    const style = document.createElement('style');
    style.textContent = `
      .tbx-picker-backdrop {
        position: fixed; inset: 0; z-index: 9999;
        background: rgba(10,10,10,.6);
        display: flex; align-items: center; justify-content: center;
        padding: 24px;
      }
      .tbx-picker-box {
        width: min(480px, 100%); max-height: 82vh; overflow: auto;
        background: var(--bg-elev, #fff); color: var(--text, #111);
        border: 1px solid var(--border, #e6e5e3); border-radius: 10px;
        border-top: 3px solid var(--accent, #ff4f00);
        padding: 20px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      }
      .tbx-picker-box h2 { margin: 0 0 14px; font-size: 16px; font-weight: 700; text-transform: uppercase; letter-spacing: .03em; }
      .tbx-picker-list { list-style: none; margin: 0 0 16px; padding: 0; display: flex; flex-direction: column; gap: 8px; }
      .tbx-picker-item {
        display: flex; align-items: center; justify-content: space-between; gap: 10px;
        border: 1px solid var(--border, #e6e5e3); border-radius: 8px; padding: 10px 12px;
      }
      .tbx-picker-item-name { font-weight: 600; font-size: 14px; }
      .tbx-picker-item-date { font-size: 11.5px; color: var(--text-muted, #6b6b68); }
      .tbx-picker-item-actions { display: flex; gap: 6px; flex: none; }
      .tbx-picker-item-actions button, .tbx-picker-new button {
        border: 1px solid var(--border, #e6e5e3); background: var(--surface-2, #f5f5f4); color: var(--text, #111);
        border-radius: 6px; padding: 6px 10px; font-size: 12.5px; cursor: pointer;
      }
      .tbx-picker-item-actions button:hover, .tbx-picker-new button:hover { border-color: var(--accent, #ff4f00); color: var(--accent, #ff4f00); }
      .tbx-picker-open { font-weight: 600; }
      .tbx-picker-empty { color: var(--text-muted, #6b6b68); font-size: 13px; padding: 8px 0 16px; }
      .tbx-picker-new { display: flex; gap: 8px; }
      .tbx-picker-new input {
        flex: 1; border: 1px solid var(--border, #e6e5e3); background: var(--surface-2, #f5f5f4); color: var(--text, #111);
        border-radius: 6px; padding: 8px 10px; font-size: 14px;
      }
      .tbx-picker-error { color: var(--err, #d83a3a); font-size: 12.5px; margin-top: 8px; min-height: 16px; }
      .tbx-picker-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 14px; }
      .tbx-picker-head h2 { margin: 0; }
      .tbx-picker-close {
        border: 1px solid var(--border, #e6e5e3); background: var(--surface-2, #f5f5f4); color: var(--text, #111);
        border-radius: 6px; width: 28px; height: 28px; line-height: 1; font-size: 15px; cursor: pointer; flex: none;
      }
      .tbx-picker-close:hover { border-color: var(--accent, #ff4f00); color: var(--accent, #ff4f00); }
      .tbx-picker-foot { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; border-top: 1px solid var(--border, #e6e5e3); padding-top: 14px; }
      .tbx-picker-foot button {
        border: 1px solid var(--border, #e6e5e3); background: var(--surface-2, #f5f5f4); color: var(--text, #111);
        border-radius: 6px; padding: 8px 12px; font-size: 12.5px; cursor: pointer; flex: 1;
      }
      .tbx-picker-foot button:hover { border-color: var(--accent, #ff4f00); color: var(--accent, #ff4f00); }
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
            <button type="button" class="tbx-picker-close" title="Schließen" aria-label="Schließen">✕</button>
          </div>
          <ul class="tbx-picker-list"></ul>
          <div class="tbx-picker-new">
            <input type="text" placeholder="Name für neues Projekt" maxlength="80" />
            <button type="button">+ Neues Projekt</button>
          </div>
          <div class="tbx-picker-error"></div>
          <div class="tbx-picker-foot">
            <button type="button" class="tbx-picker-cancel">Ohne Projekt fortfahren</button>
            <button type="button" class="tbx-picker-back">Zurück zu den Werkzeugen</button>
          </div>
        `;
        backdrop.appendChild(box);
        document.body.appendChild(backdrop);

        const listEl = box.querySelector('.tbx-picker-list');
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
          if (!project) { showError('Projekt konnte nicht geladen werden.'); return; }
          document.removeEventListener('keydown', onKeydown);
          document.body.removeChild(backdrop);
          resolve({ project });
        }

        async function refresh() {
          const list = await projects.list(toolId);
          listEl.innerHTML = '';
          if (!list.length) {
            const empty = document.createElement('div');
            empty.className = 'tbx-picker-empty';
            empty.textContent = 'Noch keine Projekte vorhanden. Leg unten ein neues an.';
            listEl.appendChild(empty);
          }
          for (const p of list) {
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
                <button type="button" class="tbx-picker-delete">Löschen</button>
              </div>
            `;
            li.querySelector('.tbx-picker-item-name').textContent = p.name;
            li.querySelector('.tbx-picker-item-date').textContent = 'Zuletzt geändert: ' + fmtDate(p.updated_at);
            li.querySelector('.tbx-picker-open').addEventListener('click', () => openProject(p.id));
            li.querySelector('.tbx-picker-rename').addEventListener('click', async () => {
              const name = window.prompt('Neuer Projektname:', p.name);
              if (!name || !name.trim()) return;
              await projects.rename(toolId, p.id, name.trim());
              refresh();
            });
            li.querySelector('.tbx-picker-delete').addEventListener('click', async () => {
              if (!window.confirm(`Projekt "${p.name}" wirklich löschen?`)) return;
              await projects.remove(toolId, p.id);
              refresh();
            });
            listEl.appendChild(li);
          }
        }

        newBtn.addEventListener('click', async () => {
          const name = newInput.value.trim();
          if (!name) { showError('Bitte einen Namen eingeben.'); return; }
          try {
            const project = await projects.create(toolId, name);
            document.removeEventListener('keydown', onKeydown);
            document.body.removeChild(backdrop);
            resolve({ project });
          } catch (err) {
            showError(err.message || 'Projekt konnte nicht angelegt werden.');
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
