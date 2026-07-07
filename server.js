#!/usr/bin/env node
'use strict';

/*
 * KEKS Werkzeugkasten – Dashboard-Server
 * -------------------------------------------------------------
 * Reiner Node.js-Server ohne externe Abhängigkeiten.
 * Start:  node server.js   (optional: PORT=8080 node server.js)
 *
 * Aufgaben:
 *   - liefert das Dashboard (public/) aus
 *   - erkennt Tools automatisch aus tools/<id>/tool.json
 *   - liefert "page"-Tools (eigenes HTML/JS) aus tools/<id>/ aus
 *   - führt "script"-Tools serverseitig aus und gibt die Ausgabe zurück
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const db = require('./lib/db');
const auth = require('./lib/auth');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const TOOLS_DIR = path.join(ROOT, 'tools');
const PORT = process.env.PORT || 4000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
};

function mimeFor(file) {
  return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

// -------------------------------------------------------------
// Tool-Erkennung
// -------------------------------------------------------------

/** Liest alle tools/<id>/tool.json ein und gibt normalisierte Tool-Objekte zurück. */
function discoverTools() {
  let entries = [];
  try {
    entries = fs.readdirSync(TOOLS_DIR, { withFileTypes: true });
  } catch (_) {
    return [];
  }

  const tools = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const id = entry.name;
    if (id.startsWith('_') || id.startsWith('.')) continue; // Vorlagen/versteckte Ordner überspringen
    const manifestPath = path.join(TOOLS_DIR, id, 'tool.json');
    if (!fs.existsSync(manifestPath)) continue;

    try {
      const raw = fs.readFileSync(manifestPath, 'utf8');
      const meta = JSON.parse(raw);
      tools.push({
        id,
        name: meta.name || id,
        description: meta.description || '',
        category: meta.category || 'Allgemein',
        icon: meta.icon || '🧩',
        type: meta.type || 'page', // link | page | script
        version: meta.version || null,
        url: meta.url || null,
        entry: meta.entry || 'index.html',
        tags: Array.isArray(meta.tags) ? meta.tags : [],
        author: meta.author || '',
        // command wird bewusst NICHT ans Frontend geschickt (Sicherheit)
        runnable: meta.type === 'script' && !!meta.command,
      });
    } catch (err) {
      console.warn(`[toolbox] tool.json in "${id}" konnte nicht gelesen werden: ${err.message}`);
    }
  }

  tools.sort((a, b) =>
    a.category.localeCompare(b.category, 'de') || a.name.localeCompare(b.name, 'de')
  );
  return tools;
}

/** Liest das rohe Manifest eines Tools (inkl. command) – nur serverseitig. */
function readManifest(id) {
  const manifestPath = path.join(TOOLS_DIR, id, 'tool.json');
  if (!isInside(TOOLS_DIR, manifestPath) || !fs.existsSync(manifestPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (_) {
    return null;
  }
}

// -------------------------------------------------------------
// Hilfsfunktionen
// -------------------------------------------------------------

/** Schutz gegen Path-Traversal: liegt target wirklich innerhalb von base? */
function isInside(base, target) {
  const rel = path.relative(base, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function sendJson(res, status, data, extraHeaders) {
  const body = JSON.stringify(data);
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  }, extraHeaders || {}));
  res.end(body);
}

/** Liest den Request-Body ein und parst ihn als JSON (max. 1 MB). */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let tooBig = false;
    const LIMIT = 1024 * 1024;
    req.on('data', (chunk) => {
      if (tooBig) return;
      body += chunk;
      if (body.length > LIMIT) {
        tooBig = true;
        reject(new Error('Payload zu groß'));
      }
    });
    req.on('end', () => {
      if (tooBig) return;
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 – Datei nicht gefunden');
      return;
    }
    res.writeHead(200, { 'Content-Type': mimeFor(filePath) });
    res.end(data);
  });
}

/** Liefert eine Datei aus einem Basisverzeichnis sicher aus. */
function serveStatic(res, baseDir, relPath, fallback) {
  let target = path.join(baseDir, decodeURIComponent(relPath));
  if (!isInside(baseDir, target)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 – Zugriff verweigert');
    return;
  }
  fs.stat(target, (err, stat) => {
    if (!err && stat.isDirectory()) target = path.join(target, 'index.html');
    fs.stat(target, (err2, stat2) => {
      if (err2 || !stat2.isFile()) {
        if (fallback) return sendFile(res, fallback);
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 – nicht gefunden');
        return;
      }
      sendFile(res, target);
    });
  });
}

// -------------------------------------------------------------
// Script-Tools ausführen
// -------------------------------------------------------------

function runTool(id, res) {
  const meta = readManifest(id);
  if (!meta || meta.type !== 'script' || !meta.command) {
    return sendJson(res, 400, { ok: false, error: 'Kein ausführbares Tool.' });
  }

  const cwd = path.join(TOOLS_DIR, id);
  const started = Date.now();

  // Kommando wird über die Shell gestartet, damit "python3 x.py" o.ä. direkt
  // aus dem Manifest übernommen werden kann. Quelle ist die versionierte
  // tool.json im Repo (vertrauenswürdig), keine Nutzereingabe.
  const child = spawn(meta.command, {
    cwd,
    shell: true,
    env: process.env,
  });

  let stdout = '';
  let stderr = '';
  const LIMIT = 512 * 1024; // 512 KB Ausgabe-Limit

  child.stdout.on('data', (d) => {
    if (stdout.length < LIMIT) stdout += d.toString();
  });
  child.stderr.on('data', (d) => {
    if (stderr.length < LIMIT) stderr += d.toString();
  });

  const timeout = setTimeout(() => {
    child.kill('SIGKILL');
    stderr += '\n[toolbox] Abgebrochen: Zeitlimit (60s) überschritten.';
  }, 60_000);

  child.on('error', (err) => {
    clearTimeout(timeout);
    sendJson(res, 500, { ok: false, error: err.message, stdout, stderr });
  });

  child.on('close', (code) => {
    clearTimeout(timeout);
    sendJson(res, 200, {
      ok: code === 0,
      code,
      stdout,
      stderr,
      durationMs: Date.now() - started,
    });
  });
}

// -------------------------------------------------------------
// Auth- und Daten-API
// -------------------------------------------------------------
//
// Sicherheitshinweise (bewusste Entscheidungen für dieses lokale Tool ohne
// 2FA-/Brute-Force-Anforderung):
//  - Passwort-Hashing über crypto.scrypt (lib/auth.js), Vergleich mit
//    timingSafeEqual.
//  - Session-Cookie ist HttpOnly + SameSite=Strict. Dadurch tragen
//    Cross-Site-Requests das Cookie gar nicht erst mit – das reicht als
//    CSRF-Schutz für dieses Bedrohungsmodell, ein zusätzliches CSRF-Token
//    wäre hier unnötige Komplexität.
//  - Login liefert bei falschem Nutzernamen UND falschem Passwort dieselbe
//    generische Fehlermeldung, um Username-Enumeration zu vermeiden.
//  - Admin-Rechte werden bei jedem Request neu aus der DB gelesen (nicht aus
//    dem Cookie), damit ein deaktivierter/entfernter Admin sofort die Rechte
//    verliert.

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;
const PASSWORD_MIN_LEN = 8;
const DATA_KEY_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function knownToolIds() {
  return new Set(discoverTools().map((t) => t.id));
}

async function handleAuthAndDataRoutes(req, res, pathname, method) {
  // --- Registrierung ---
  if (pathname === '/api/auth/register' && method === 'POST') {
    const body = await readJsonBody(req);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    if (!USERNAME_RE.test(username)) {
      sendJson(res, 400, { ok: false, error: 'Ungültiger Benutzername (3–32 Zeichen, Buchstaben/Zahlen/._-).' });
      return true;
    }
    if (password.length < PASSWORD_MIN_LEN) {
      sendJson(res, 400, { ok: false, error: `Passwort muss mindestens ${PASSWORD_MIN_LEN} Zeichen haben.` });
      return true;
    }
    if (db.getUserByUsername(username)) {
      sendJson(res, 409, { ok: false, error: 'Dieser Benutzername ist bereits vergeben.' });
      return true;
    }

    const isFirstUser = db.userCount() === 0;
    const passwordHash = auth.hashPassword(password);
    const user = db.createUser({
      username,
      passwordHash,
      role: isFirstUser ? 'admin' : 'user',
      status: isFirstUser ? 'active' : 'pending',
    });
    sendJson(res, 200, {
      ok: true,
      status: user.status,
      message: isFirstUser
        ? 'Account erstellt und als erster Account automatisch als Admin freigeschaltet.'
        : 'Account erstellt. Ein Administrator muss ihn noch freischalten, bevor du dich einloggen kannst.',
    });
    return true;
  }

  // --- Login ---
  if (pathname === '/api/auth/login' && method === 'POST') {
    const body = await readJsonBody(req);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const genericError = 'Benutzername oder Passwort falsch.';

    const user = db.getUserByUsername(username);
    if (!user || !auth.verifyPassword(password, user.password_hash)) {
      sendJson(res, 401, { ok: false, error: genericError });
      return true;
    }
    if (user.status === 'pending') {
      sendJson(res, 403, { ok: false, error: 'Dein Account wartet noch auf Freischaltung durch einen Administrator.' });
      return true;
    }
    if (user.status !== 'active') {
      sendJson(res, 403, { ok: false, error: 'Dieser Account ist deaktiviert.' });
      return true;
    }

    const { cookie } = auth.createSessionForUser(user.id, req);
    sendJson(res, 200, { ok: true, user: auth.publicUser(user) }, { 'Set-Cookie': cookie });
    return true;
  }

  // --- Logout ---
  if (pathname === '/api/auth/logout' && method === 'POST') {
    const cookies = auth.parseCookies(req);
    const sessionId = cookies[auth.SESSION_COOKIE];
    if (sessionId) db.deleteSession(sessionId);
    sendJson(res, 200, { ok: true }, { 'Set-Cookie': auth.buildClearCookie(req) });
    return true;
  }

  // --- Aktuelle Session ---
  if (pathname === '/api/auth/me' && method === 'GET') {
    const session = auth.requireAuth(req);
    if (!session) {
      sendJson(res, 200, { loggedIn: false });
    } else {
      sendJson(res, 200, { loggedIn: true, user: auth.publicUser(session.user) });
    }
    return true;
  }

  // --- Admin: Userliste ---
  if (pathname === '/api/admin/users' && method === 'GET') {
    const admin = auth.requireAdmin(req);
    if (!admin) {
      sendJson(res, 403, { ok: false, error: 'Nur für Administratoren.' });
      return true;
    }
    sendJson(res, 200, { users: db.listUsers() });
    return true;
  }

  // --- Admin: Userstatus ändern ---
  const statusMatch = pathname.match(/^\/api\/admin\/users\/(\d+)\/status$/);
  if (statusMatch && method === 'POST') {
    const admin = auth.requireAdmin(req);
    if (!admin) {
      sendJson(res, 403, { ok: false, error: 'Nur für Administratoren.' });
      return true;
    }
    const targetId = Number(statusMatch[1]);
    const body = await readJsonBody(req);
    const allowed = ['active', 'rejected', 'disabled'];
    if (!allowed.includes(body.status)) {
      sendJson(res, 400, { ok: false, error: 'Ungültiger Status.' });
      return true;
    }
    const target = db.getUserById(targetId);
    if (!target) {
      sendJson(res, 404, { ok: false, error: 'User nicht gefunden.' });
      return true;
    }
    db.setUserStatus(targetId, body.status, admin.user.id);
    if (body.status !== 'active') {
      db.deleteSessionsForUser(targetId); // sofortige Sperre
    }
    sendJson(res, 200, { ok: true, user: db.getPublicUserById(targetId) });
    return true;
  }

  // --- Migration: Status abfragen ---
  // Hinweis: Diese beiden migrationsspezifischen Routen müssen VOR der
  // generischen /api/data/:toolId/:key-Route stehen, da "migration-status"
  // und "migrate" sonst als ganz normale (falsche) Datenschlüssel behandelt
  // würden – das generische Muster matcht sonst zuerst.
  const migStatusMatch = pathname.match(/^\/api\/data\/([^/]+)\/migration-status$/);
  if (migStatusMatch && method === 'GET') {
    const toolId = decodeURIComponent(migStatusMatch[1]);
    const session = auth.requireAuth(req);
    if (!session) {
      sendJson(res, 401, { ok: false, error: 'Bitte einloggen.' });
      return true;
    }
    if (!knownToolIds().has(toolId)) {
      sendJson(res, 400, { ok: false, error: 'Unbekanntes Tool.' });
      return true;
    }
    const decision = db.getMigrationDecision(session.user.id, toolId);
    sendJson(res, 200, { decided: !!decision, migrated: decision ? !!decision.migrated : null });
    return true;
  }

  // --- Migration: Entscheidung + optionale Datenübernahme ---
  const migrateMatch = pathname.match(/^\/api\/data\/([^/]+)\/migrate$/);
  if (migrateMatch && method === 'POST') {
    const toolId = decodeURIComponent(migrateMatch[1]);
    const session = auth.requireAuth(req);
    if (!session) {
      sendJson(res, 401, { ok: false, error: 'Bitte einloggen.' });
      return true;
    }
    if (!knownToolIds().has(toolId)) {
      sendJson(res, 400, { ok: false, error: 'Unbekanntes Tool.' });
      return true;
    }
    const body = await readJsonBody(req);
    const decision = body.decision === 'yes';

    if (decision && body.payload && typeof body.payload === 'object') {
      // Nur übernehmen, wenn für dieses Tool noch keine DB-Daten existieren,
      // damit ein versehentlicher zweiter Aufruf nichts überschreibt.
      if (!db.hasAnyToolData(session.user.id, toolId)) {
        for (const [key, value] of Object.entries(body.payload)) {
          if (!DATA_KEY_RE.test(key)) continue;
          db.putToolData(session.user.id, toolId, key, JSON.stringify(value));
        }
      }
    }
    db.setMigrationDecision(session.user.id, toolId, decision);
    sendJson(res, 200, { ok: true });
    return true;
  }

  // --- Daten-API: einzelnen Wert lesen/schreiben ---
  const dataMatch = pathname.match(/^\/api\/data\/([^/]+)\/([^/]+)$/);
  if (dataMatch && (method === 'GET' || method === 'PUT')) {
    const toolId = decodeURIComponent(dataMatch[1]);
    const key = decodeURIComponent(dataMatch[2]);
    const session = auth.requireAuth(req);
    if (!session) {
      sendJson(res, 401, { ok: false, error: 'Bitte einloggen.' });
      return true;
    }
    if (!knownToolIds().has(toolId)) {
      sendJson(res, 400, { ok: false, error: 'Unbekanntes Tool.' });
      return true;
    }
    if (!DATA_KEY_RE.test(key)) {
      sendJson(res, 400, { ok: false, error: 'Ungültiger Schlüssel.' });
      return true;
    }

    if (method === 'GET') {
      const raw = db.getToolData(session.user.id, toolId, key);
      sendJson(res, 200, { value: raw ? JSON.parse(raw) : null });
      return true;
    }

    // PUT
    const body = await readJsonBody(req);
    const value = 'value' in body ? body.value : body;
    db.putToolData(session.user.id, toolId, key, JSON.stringify(value));
    sendJson(res, 200, { ok: true });
    return true;
  }

  // --- Projekte: Liste + Anlegen ---
  const projectsListMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (projectsListMatch && method === 'GET') {
    const toolId = decodeURIComponent(projectsListMatch[1]);
    const session = auth.requireAuth(req);
    if (!session) {
      sendJson(res, 401, { ok: false, error: 'Bitte einloggen.' });
      return true;
    }
    if (!knownToolIds().has(toolId)) {
      sendJson(res, 400, { ok: false, error: 'Unbekanntes Tool.' });
      return true;
    }
    sendJson(res, 200, { projects: db.listProjects(session.user.id, toolId) });
    return true;
  }

  if (projectsListMatch && method === 'POST') {
    const toolId = decodeURIComponent(projectsListMatch[1]);
    const session = auth.requireAuth(req);
    if (!session) {
      sendJson(res, 401, { ok: false, error: 'Bitte einloggen.' });
      return true;
    }
    if (!knownToolIds().has(toolId)) {
      sendJson(res, 400, { ok: false, error: 'Unbekanntes Tool.' });
      return true;
    }
    const body = await readJsonBody(req);
    const name = String(body.name || '').trim();
    if (!name || name.length > 80) {
      sendJson(res, 400, { ok: false, error: 'Projektname muss 1–80 Zeichen lang sein.' });
      return true;
    }
    const initialData = body.data && typeof body.data === 'object' ? body.data : {};
    const project = db.createProject(session.user.id, toolId, name, JSON.stringify(initialData));
    sendJson(res, 200, { project: { id: project.id, name: project.name, data: initialData } });
    return true;
  }

  // --- Projekte: einzelnes Projekt lesen/speichern/löschen ---
  const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)\/(\d+)$/);
  if (projectMatch) {
    const toolId = decodeURIComponent(projectMatch[1]);
    const projectId = Number(projectMatch[2]);
    const session = auth.requireAuth(req);
    if (!session) {
      sendJson(res, 401, { ok: false, error: 'Bitte einloggen.' });
      return true;
    }
    if (!knownToolIds().has(toolId)) {
      sendJson(res, 400, { ok: false, error: 'Unbekanntes Tool.' });
      return true;
    }
    const project = db.getProject(projectId);
    if (!project || project.tool_id !== toolId) {
      sendJson(res, 404, { ok: false, error: 'Projekt nicht gefunden.' });
      return true;
    }
    if (project.user_id !== session.user.id) {
      sendJson(res, 403, { ok: false, error: 'Kein Zugriff auf dieses Projekt.' });
      return true;
    }

    if (method === 'GET') {
      sendJson(res, 200, {
        project: { id: project.id, name: project.name, data: JSON.parse(project.data_json) },
      });
      return true;
    }

    if (method === 'PUT') {
      const body = await readJsonBody(req);
      if (typeof body.name === 'string') {
        const name = body.name.trim();
        if (!name || name.length > 80) {
          sendJson(res, 400, { ok: false, error: 'Projektname muss 1–80 Zeichen lang sein.' });
          return true;
        }
        db.renameProject(projectId, name);
      }
      if ('data' in body) {
        db.updateProjectData(projectId, JSON.stringify(body.data));
      }
      sendJson(res, 200, { ok: true });
      return true;
    }

    if (method === 'DELETE') {
      db.deleteProject(projectId);
      sendJson(res, 200, { ok: true });
      return true;
    }
  }

  return false;
}

// -------------------------------------------------------------
// Router
// -------------------------------------------------------------

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // --- API: Tool-Liste ---
  if (pathname === '/api/tools' && req.method === 'GET') {
    return sendJson(res, 200, { tools: discoverTools() });
  }

  // --- API: Script-Tool ausführen ---
  const runMatch = pathname.match(/^\/api\/run\/([^/]+)$/);
  if (runMatch && req.method === 'POST') {
    return runTool(decodeURIComponent(runMatch[1]), res);
  }

  // --- API: Auth & Userdaten ---
  if (
    pathname.startsWith('/api/auth/') ||
    pathname.startsWith('/api/admin/') ||
    pathname.startsWith('/api/data/') ||
    pathname.startsWith('/api/projects/')
  ) {
    handleAuthAndDataRoutes(req, res, pathname, req.method).then((handled) => {
      if (!handled) sendJson(res, 404, { ok: false, error: 'Unbekannte API-Route.' });
    }).catch((err) => {
      console.error('[toolbox] API-Fehler:', err.message);
      if (!res.headersSent) sendJson(res, 400, { ok: false, error: 'Ungültige Anfrage.' });
    });
    return;
  }

  // --- Page-Tools: /tools/<id>/... aus dem Tool-Ordner ausliefern ---
  if (pathname.startsWith('/tools/')) {
    const rel = pathname.slice('/tools/'.length);
    return serveStatic(res, TOOLS_DIR, rel);
  }

  // --- Dashboard / statische Dateien ---
  const relPath = pathname === '/' ? 'index.html' : pathname.slice(1);
  return serveStatic(res, PUBLIC_DIR, relPath, path.join(PUBLIC_DIR, 'index.html'));
});

// -------------------------------------------------------------
// Admin-Bootstrap über Umgebungsvariablen (z.B. für Docker)
// -------------------------------------------------------------
//
// Setzt ADMIN_USERNAME/ADMIN_PASSWORD nur beim allerersten Start um, damit
// ein Container ohne manuelle Registrierung über die Weboberfläche direkt
// mit einem nutzbaren Admin-Account startet. Existiert der Account bereits
// (z.B. nach einem Neustart, oder weil das Passwort später im Dashboard
// geändert wurde), wird NICHTS überschrieben – Env-Variablen sind hier
// bewusst nur ein einmaliger Seed, keine dauerhafte Quelle der Wahrheit.
function ensureAdminFromEnv() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username && !password) return;

  if (!username || !password) {
    console.error('[toolbox] ADMIN_USERNAME und ADMIN_PASSWORD müssen zusammen gesetzt werden – Admin-Bootstrap übersprungen.');
    return;
  }
  if (!USERNAME_RE.test(username)) {
    console.error('[toolbox] ADMIN_USERNAME ungültig (3–32 Zeichen, Buchstaben/Zahlen/._-) – Admin-Bootstrap übersprungen.');
    return;
  }
  if (password.length < PASSWORD_MIN_LEN) {
    console.error(`[toolbox] ADMIN_PASSWORD zu kurz (mind. ${PASSWORD_MIN_LEN} Zeichen) – Admin-Bootstrap übersprungen.`);
    return;
  }
  if (db.getUserByUsername(username)) {
    console.log(`[toolbox] Admin-Account "${username}" existiert bereits – ADMIN_PASSWORD wird nicht erneut angewandt.`);
    return;
  }

  const passwordHash = auth.hashPassword(password);
  db.createUser({ username, passwordHash, role: 'admin', status: 'active' });
  console.log(`[toolbox] Admin-Account "${username}" aus ADMIN_USERNAME/ADMIN_PASSWORD angelegt.`);
}

ensureAdminFromEnv();

server.listen(PORT, () => {
  const tools = discoverTools();
  console.log('\n  🟧 KEKS Werkzeugkasten');
  console.log(`  ➜  Dashboard läuft auf  http://localhost:${PORT}`);
  console.log(`  ➜  ${tools.length} Tool(s) erkannt${tools.length ? ': ' + tools.map((t) => t.name).join(', ') : ''}\n`);
});
