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
            <button type="button" class="btn primary">Anlegen</button>
          </div>
          <div class="tbx-picker-error"></div>
          <div class="tbx-picker-foot">
            <button type="button" class="btn tbx-picker-cancel">Ohne Projekt fortfahren</button>
            <button type="button" class="btn tbx-picker-back">Zurück zu den Werkzeugen</button>
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
              <button type="button" class="btn primary tbx-picker-open">Öffnen</button>
              <button type="button" class="btn tbx-picker-rename">Umbenennen</button>
              <button type="button" class="btn tbx-picker-share"></button>
              <button type="button" class="btn danger tbx-picker-delete">Löschen</button>
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
