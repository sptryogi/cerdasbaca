/* ============================================================
   lib/db.js — koneksi & helper database CerdasBaca
   Runtime : Vercel Serverless (Node.js)
   Database: Vercel Postgres (@vercel/postgres)
   - Skema idempoten : users, sessions, reading_progress
   - Hash kata sandi : crypto.scryptSync  format "salt:hash"
   - Sesi            : token acak 64 hex, cookie httpOnly
   ============================================================ */

"use strict";

const crypto = require("crypto");

const SESSION_COOKIE = "cb_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 hari (detik)

/* ---------- 1. Koneksi ---------- */

function hasDatabaseEnv() {
  return Boolean(
    process.env.POSTGRES_URL ||
      process.env.POSTGRES_PRISMA_URL ||
      process.env.POSTGRES_URL_NON_POOLING ||
      process.env.DATABASE_URL
  );
}

function getSql() {
  if (!hasDatabaseEnv()) {
    const err = new Error(
      "Database belum terhubung. Setel variabel POSTGRES_URL di project Vercel lalu deploy ulang."
    );
    err.code = "DB_MISSING";
    throw err;
  }
  // Lazy require: file tetap bisa di-require saat env belum tersedia.
  return require("@vercel/postgres").sql;
}

function isDbMissing(err) {
  return Boolean(err && err.code === "DB_MISSING");
}

/** Kirim respons error standar untuk kegagalan database/server. */
function sendDbError(res, err) {
  if (isDbMissing(err)) {
    res.status(503).json({
      error:
        "Database belum terhubung. Setel variabel POSTGRES_URL di project Vercel lalu deploy ulang.",
    });
    return;
  }
  console.error("[api] error:", err);
  res.status(500).json({
    error: "Terjadi kesalahan di server. Silakan coba lagi.",
  });
}

/** Samakan bentuk hasil query menjadi array baris. */
function toRows(result) {
  if (!result) return [];
  if (Array.isArray(result)) return result;
  if (Array.isArray(result.rows)) return result.rows;
  return [];
}

/* ---------- 2. Skema (idempoten) ---------- */

let schemaPromise = null;

function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = (async function () {
      const sql = getSql();

      await sql`
        CREATE TABLE IF NOT EXISTS users (
          id            SERIAL PRIMARY KEY,
          name          TEXT        NOT NULL,
          email         TEXT        NOT NULL UNIQUE,
          password_hash TEXT        NOT NULL,
          level         TEXT        NOT NULL,
          school        TEXT,
          created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS sessions (
          token      TEXT        PRIMARY KEY,
          user_id    INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS reading_progress (
          id         SERIAL PRIMARY KEY,
          user_id    INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          title      TEXT        NOT NULL,
          status     TEXT        NOT NULL DEFAULT 'reading',
          pages      INTEGER     NOT NULL DEFAULT 0,
          percent    INTEGER     NOT NULL DEFAULT 0,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;

      await sql`CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id)`;
      await sql`CREATE INDEX IF NOT EXISTS reading_progress_user_id_idx ON reading_progress (user_id)`;
    })();

    // Biar bisa dicoba ulang pada request berikutnya bila gagal.
    schemaPromise.catch(function () {
      schemaPromise = null;
    });
  }
  return schemaPromise;
}

/** Pastikan skema siap; lempar error bila gagal. */
async function initDb() {
  await ensureSchema();
}

/* ---------- 3. Kata sandi ---------- */

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return salt + ":" + hash;
}

function verifyPassword(password, stored) {
  const parts = String(stored || "").split(":");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
  const salt = parts[0];
  const expected = Buffer.from(parts[1], "hex");
  if (expected.length !== 64) return false;
  const actual = crypto.scryptSync(String(password), salt, 64);
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

/* ---------- 4. Cookie & sesi ---------- */

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  const parts = String(header).split(";");
  for (let i = 0; i < parts.length; i++) {
    const eq = parts[i].indexOf("=");
    if (eq === -1) continue;
    const key = parts[i].slice(0, eq).trim();
    const raw = parts[i].slice(eq + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(raw);
    } catch (e) {
      out[key] = raw;
    }
  }
  return out;
}

function getSessionToken(req) {
  const cookies = parseCookies(req.headers && req.headers.cookie);
  return cookies[SESSION_COOKIE] || null;
}

function sessionCookie(token) {
  return (
    SESSION_COOKIE +
    "=" +
    token +
    "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" +
    SESSION_MAX_AGE
  );
}

function clearSessionCookie() {
  return SESSION_COOKIE + "=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
}

async function createSession(userId) {
  const sql = getSql();
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE * 1000).toISOString();
  await sql`
    INSERT INTO sessions (token, user_id, expires_at)
    VALUES (${token}, ${userId}, ${expiresAt})
  `;
  return token;
}

async function destroySession(req) {
  const token = getSessionToken(req);
  if (!token) return;
  const sql = getSql();
  await sql`DELETE FROM sessions WHERE token = ${token}`;
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    level: row.level,
    school: row.school || null,
    createdAt: row.created_at || row.createdAt || null,
  };
}

/** Ambil pengguna dari cookie sesi; null bila tidak valid/kedaluwarsa. */
async function getUserFromRequest(req) {
  const token = getSessionToken(req);
  if (!token) return null;

  const sql = getSql();
  const rows = toRows(await sql`
    SELECT u.id, u.name, u.email, u.level, u.school, u.created_at,
           s.token, s.expires_at
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ${token}
  `);

  const row = rows[0];
  if (!row) return null;

  const expiresAt = new Date(row.expires_at).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    await sql`DELETE FROM sessions WHERE token = ${token}`;
    return null;
  }

  return publicUser(row);
}

module.exports = {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  getSql,
  isDbMissing,
  sendDbError,
  toRows,
  ensureSchema,
  initDb,
  hashPassword,
  verifyPassword,
  parseCookies,
  getSessionToken,
  sessionCookie,
  clearSessionCookie,
  createSession,
  destroySession,
  getUserFromRequest,
  publicUser,
};
