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
  };
})();
