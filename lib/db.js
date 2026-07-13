'use strict';

/*
 * DB-Layer für den KEKS Werkzeugkasten.
 * Nutzt Node's eingebautes node:sqlite (DatabaseSync) – bewusst gewählt,
 * damit das Projekt weiterhin ohne package.json/npm-Abhängigkeiten läuft.
 * Node gibt beim ersten Zugriff eine "experimental"-Warnung aus – erwartet
 * und unbedenklich für den lokalen Einsatzzweck dieses Tools.
 */

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

// Per DATA_DIR überschreibbar (z.B. um ein Docker-Volume an einen
// beliebigen Host-Pfad zu mounten), sonst wie bisher fest relativ zum
// Anwendungsverzeichnis.
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'toolbox.sqlite');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'user',
    status        TEXT NOT NULL DEFAULT 'pending',
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    approved_at   TEXT,
    approved_by   INTEGER REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tool_data (
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tool_id     TEXT NOT NULL,
    data_key    TEXT NOT NULL,
    value_json  TEXT NOT NULL,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, tool_id, data_key)
  );

  CREATE TABLE IF NOT EXISTS tool_migrations (
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tool_id     TEXT NOT NULL,
    decided_at  TEXT NOT NULL DEFAULT (datetime('now')),
    migrated    INTEGER NOT NULL,
    PRIMARY KEY (user_id, tool_id)
  );

  CREATE TABLE IF NOT EXISTS tool_projects (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tool_id     TEXT NOT NULL,
    name        TEXT NOT NULL,
    data_json   TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_tool_projects_user_tool ON tool_projects(user_id, tool_id);
`);

// Nachträgliche Spalte für bestehende Datenbanken (CREATE TABLE IF NOT EXISTS
// zieht bei bereits vorhandener Tabelle keine neuen Spalten nach).
const projectCols = db.prepare('PRAGMA table_info(tool_projects)').all();
if (!projectCols.some((c) => c.name === 'shared')) {
  db.exec('ALTER TABLE tool_projects ADD COLUMN shared INTEGER NOT NULL DEFAULT 0');
}

// ---------- Users ----------

function userCount() {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
}

function createUser({ username, passwordHash, role, status }) {
  const stmt = db.prepare(
    'INSERT INTO users (username, password_hash, role, status) VALUES (?, ?, ?, ?)'
  );
  const info = stmt.run(username, passwordHash, role, status);
  return getUserById(Number(info.lastInsertRowid));
}

function getUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username) || null;
}

function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
}

const PUBLIC_USER_FIELDS = 'id, username, role, status, created_at, approved_at, approved_by';

function listUsers() {
  return db.prepare(`SELECT ${PUBLIC_USER_FIELDS} FROM users ORDER BY created_at ASC`).all();
}

function getPublicUserById(id) {
  return db.prepare(`SELECT ${PUBLIC_USER_FIELDS} FROM users WHERE id = ?`).get(id) || null;
}

function setUserStatus(id, status, approvedBy) {
  if (status === 'active') {
    db.prepare(
      "UPDATE users SET status = ?, approved_at = datetime('now'), approved_by = ? WHERE id = ?"
    ).run(status, approvedBy, id);
  } else {
    db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, id);
  }
  return getUserById(id);
}

// ---------- Sessions ----------

function createSession(id, userId, expiresAtIso) {
  db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(
    id,
    userId,
    expiresAtIso
  );
}

function getSession(id) {
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) || null;
}

function deleteSession(id) {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
}

function deleteSessionsForUser(userId) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

function deleteExpiredSessions() {
  db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
}

// ---------- Tool-Daten (generischer Key-Value-Speicher) ----------

function getToolData(userId, toolId, key) {
  const row = db
    .prepare('SELECT value_json FROM tool_data WHERE user_id = ? AND tool_id = ? AND data_key = ?')
    .get(userId, toolId, key);
  return row ? row.value_json : null;
}

function putToolData(userId, toolId, key, valueJson) {
  db.prepare(
    `INSERT INTO tool_data (user_id, tool_id, data_key, value_json, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, tool_id, data_key)
     DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
  ).run(userId, toolId, key, valueJson);
}

function hasAnyToolData(userId, toolId) {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM tool_data WHERE user_id = ? AND tool_id = ?')
    .get(userId, toolId);
  return row.n > 0;
}

function getMigrationDecision(userId, toolId) {
  return (
    db
      .prepare('SELECT * FROM tool_migrations WHERE user_id = ? AND tool_id = ?')
      .get(userId, toolId) || null
  );
}

function setMigrationDecision(userId, toolId, migrated) {
  db.prepare(
    `INSERT INTO tool_migrations (user_id, tool_id, migrated)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id, tool_id) DO UPDATE SET migrated = excluded.migrated, decided_at = datetime('now')`
  ).run(userId, toolId, migrated ? 1 : 0);
}

// ---------- Projekte (mehrere benannte Arbeitsstände pro User+Tool) ----------

function listProjects(userId, toolId) {
  return db
    .prepare(
      `SELECT p.id, p.tool_id, p.name, p.created_at, p.updated_at, p.shared, p.user_id,
              u.username AS owner_username
       FROM tool_projects p JOIN users u ON u.id = p.user_id
       WHERE p.tool_id = ? AND (p.user_id = ? OR p.shared = 1)
       ORDER BY p.updated_at DESC`
    )
    .all(toolId, userId);
}

function getProject(id) {
  return db.prepare('SELECT * FROM tool_projects WHERE id = ?').get(id) || null;
}

function createProject(userId, toolId, name, dataJson) {
  const info = db
    .prepare('INSERT INTO tool_projects (user_id, tool_id, name, data_json) VALUES (?, ?, ?, ?)')
    .run(userId, toolId, name, dataJson);
  return getProject(Number(info.lastInsertRowid));
}

function updateProjectData(id, dataJson) {
  db.prepare("UPDATE tool_projects SET data_json = ?, updated_at = datetime('now') WHERE id = ?").run(
    dataJson,
    id
  );
}

function renameProject(id, name) {
  db.prepare("UPDATE tool_projects SET name = ?, updated_at = datetime('now') WHERE id = ?").run(
    name,
    id
  );
}

function deleteProject(id) {
  db.prepare('DELETE FROM tool_projects WHERE id = ?').run(id);
}

function setProjectShared(id, shared) {
  db.prepare('UPDATE tool_projects SET shared = ? WHERE id = ?').run(shared ? 1 : 0, id);
}

module.exports = {
  userCount,
  createUser,
  getUserByUsername,
  getUserById,
  getPublicUserById,
  listUsers,
  setUserStatus,
  createSession,
  getSession,
  deleteSession,
  deleteSessionsForUser,
  deleteExpiredSessions,
  getToolData,
  putToolData,
  hasAnyToolData,
  getMigrationDecision,
  setMigrationDecision,
  listProjects,
  getProject,
  createProject,
  updateProjectData,
  renameProject,
  deleteProject,
  setProjectShared,
};
