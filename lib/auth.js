'use strict';

/*
 * Auth-Helfer: Passwort-Hashing, Session-Cookies, Zugriffsprüfung.
 * Bewusst ohne externe Bibliotheken – Bedrohungsmodell ist ein lokal
 * betriebenes Tool ohne 2FA-/Brute-Force-Anforderung, daher reichen
 * Node-Bordmittel (crypto.scrypt, randomBytes, timingSafeEqual).
 */

const crypto = require('crypto');
const db = require('./db');

const SESSION_COOKIE = 'toolbox_sess';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 Tage
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nStr, rStr, pStr, saltHex, hashHex] = parts;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, salt, expected.length, {
    N: Number(nStr),
    r: Number(rStr),
    p: Number(pStr),
  });
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  }
  return out;
}

function buildSessionCookie(sessionId, req) {
  const secure = req.socket && req.socket.encrypted ? '; Secure' : '';
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return `${SESSION_COOKIE}=${sessionId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`;
}

function buildClearCookie(req) {
  const secure = req.socket && req.socket.encrypted ? '; Secure' : '';
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`;
}

function createSessionForUser(userId, req) {
  const sessionId = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.createSession(sessionId, userId, expiresAt);
  return { sessionId, cookie: buildSessionCookie(sessionId, req) };
}

/** Liest die Session aus dem Request-Cookie und liefert den zugehörigen aktiven User, oder null. */
function requireAuth(req) {
  const cookies = parseCookies(req);
  const sessionId = cookies[SESSION_COOKIE];
  if (!sessionId) return null;

  const session = db.getSession(sessionId);
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    db.deleteSession(sessionId);
    return null;
  }

  const user = db.getUserById(session.user_id);
  if (!user || user.status !== 'active') return null;
  return { user, sessionId };
}

function requireAdmin(req) {
  const auth = requireAuth(req);
  if (!auth || auth.user.role !== 'admin') return null;
  return auth;
}

function publicUser(user) {
  return { id: user.id, username: user.username, role: user.role, status: user.status };
}

module.exports = {
  SESSION_COOKIE,
  hashPassword,
  verifyPassword,
  parseCookies,
  createSessionForUser,
  buildClearCookie,
  requireAuth,
  requireAdmin,
  publicUser,
};
