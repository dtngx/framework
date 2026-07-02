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
  '.otf': 'font/otf',
  '.ttf': 'font/ttf',
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

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
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

  // --- Page-Tools: /tools/<id>/... aus dem Tool-Ordner ausliefern ---
  if (pathname.startsWith('/tools/')) {
    const rel = pathname.slice('/tools/'.length);
    return serveStatic(res, TOOLS_DIR, rel);
  }

  // --- Dashboard / statische Dateien ---
  const relPath = pathname === '/' ? 'index.html' : pathname.slice(1);
  return serveStatic(res, PUBLIC_DIR, relPath, path.join(PUBLIC_DIR, 'index.html'));
});

server.listen(PORT, () => {
  const tools = discoverTools();
  console.log('\n  🟧 KEKS Werkzeugkasten');
  console.log(`  ➜  Dashboard läuft auf  http://localhost:${PORT}`);
  console.log(`  ➜  ${tools.length} Tool(s) erkannt${tools.length ? ': ' + tools.map((t) => t.name).join(', ') : ''}\n`);
});
