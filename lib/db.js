/* ============================================================
   lib/db.js — koneksi & helper database CerdasBaca
   Runtime : Vercel Serverless (Node.js)
   Database: Neon via @neondatabase/serverless
             (query HTTP stateless — neon() tagged template)
   - Skema idempoten : users, sessions, reading_progress
   - Hash kata sandi : crypto.scryptSync  format "salt:hash"
   - Sesi            : token acak 64 hex, cookie httpOnly
   ============================================================ */

"use strict";

const crypto = require("crypto");

const SESSION_COOKIE = "cb_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 hari (detik)

/* ---------- 1. Koneksi ---------- */

function getDatabaseUrl() {
  // Neon/Vercel integration biasanya menyetel DATABASE_URL atau POSTGRES_URL;
  // dukung juga var legacy Vercel Postgres agar kompatibel.
  return (
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.DATABASE_URL ||
    ""
  );
}

function hasDatabaseEnv() {
  return Boolean(getDatabaseUrl());
}

// Query function hasil neon(url) — di-cache per proses (HTTP stateless, aman di serverless).
let neonSql = null;

function getSql() {
  const url = getDatabaseUrl();
  if (!url) {
    const err = new Error(
      "Database belum terhubung. Setel variabel POSTGRES_URL (atau DATABASE_URL) di project Vercel lalu deploy ulang."
    );
    err.code = "DB_MISSING";
    throw err;
  }
  // Lazy require: file tetap bisa di-require saat env/pkg belum tersedia.
  if (!neonSql) {
    const { neon } = require("@neondatabase/serverless");
    // neon() mengembalikan fungsi tagged template: await sql`SELECT ... ${param}`
    // → array baris langsung (HTTP query, tanpa koneksi pool).
    neonSql = neon(url);
  }
  return neonSql;
}

function isDbMissing(err) {
  return Boolean(err && err.code === "DB_MISSING");
}

/** Kirim respons error standar untuk kegagalan database/server. */
function sendDbError(res, err) {
  if (isDbMissing(err)) {
    res.status(503).json({
      error:
        "Database belum terhubung. Setel variabel POSTGRES_URL (atau DATABASE_URL) di project Vercel lalu deploy ulang.",
    });
    return;
  }
  console.error("[api] error:", err);
  res.status(500).json({
    error: "Terjadi kesalahan di server. Silakan coba lagi.",
  });
}

/**
 * Samakan bentuk hasil query menjadi array baris.
 * - Neon neon(): array rows langsung
 * - Gaya Pool/query result: { rows: [...] }
 */
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
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS ux_reading_progress_user_title ON reading_progress(user_id, title)`;

      /* --- Ekstensi 4 pilar program literasi (semua idempoten) --- */

      // users.role (user|admin)
      await sql`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user'
      `;

      // reading_progress: kolom jurnal tambahan
      await sql`ALTER TABLE reading_progress ADD COLUMN IF NOT EXISTS note TEXT`;
      await sql`ALTER TABLE reading_progress ADD COLUMN IF NOT EXISTS read_date DATE`;

      // Perpustakaan digital
      await sql`
        CREATE TABLE IF NOT EXISTS books (
          id           SERIAL PRIMARY KEY,
          title        TEXT        NOT NULL,
          author       TEXT        NOT NULL DEFAULT '',
          description  TEXT        NOT NULL DEFAULT '',
          cover_emoji  TEXT        NOT NULL DEFAULT '📘',
          cover_color  TEXT        NOT NULL DEFAULT '#4361ee',
          level        TEXT        NOT NULL DEFAULT 'semua',
          pages        INTEGER     NOT NULL DEFAULT 0,
          created_by   INTEGER     REFERENCES users(id) ON DELETE SET NULL,
          created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS ratings (
          id         SERIAL PRIMARY KEY,
          book_id    INTEGER     NOT NULL REFERENCES books(id) ON DELETE CASCADE,
          user_id    INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          rating     INTEGER     NOT NULL CHECK (rating >= 1 AND rating <= 5),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (book_id, user_id)
        )
      `;

      // Testimoni
      await sql`
        CREATE TABLE IF NOT EXISTS testimonials (
          id         SERIAL PRIMARY KEY,
          user_id    INTEGER     REFERENCES users(id) ON DELETE SET NULL,
          quote      TEXT        NOT NULL,
          role_label TEXT        NOT NULL DEFAULT '',
          status     TEXT        NOT NULL DEFAULT 'pending',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;

      // Kelas membaca
      await sql`
        CREATE TABLE IF NOT EXISTS reading_classes (
          id            SERIAL PRIMARY KEY,
          title         TEXT        NOT NULL,
          description   TEXT        NOT NULL DEFAULT '',
          level         TEXT        NOT NULL DEFAULT 'semua',
          schedule_text TEXT        NOT NULL DEFAULT '',
          capacity      INTEGER     NOT NULL DEFAULT 20,
          teacher_name  TEXT        NOT NULL DEFAULT '',
          created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS class_enrollments (
          id         SERIAL PRIMARY KEY,
          class_id   INTEGER     NOT NULL REFERENCES reading_classes(id) ON DELETE CASCADE,
          user_id    INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (class_id, user_id)
        )
      `;

      // Lomba baca
      await sql`
        CREATE TABLE IF NOT EXISTS competitions (
          id          SERIAL PRIMARY KEY,
          title       TEXT        NOT NULL,
          description TEXT        NOT NULL DEFAULT '',
          level       TEXT        NOT NULL DEFAULT 'semua',
          rules       TEXT        NOT NULL DEFAULT '',
          start_date  DATE,
          end_date    DATE,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS competition_entries (
          id             SERIAL PRIMARY KEY,
          competition_id INTEGER     NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
          user_id        INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (competition_id, user_id)
        )
      `;

      // Pesan form kontak (fallback bila pengiriman email provider gagal)
      await sql`
        CREATE TABLE IF NOT EXISTS contact_messages (
          id         SERIAL PRIMARY KEY,
          name       TEXT        NOT NULL,
          email      TEXT        NOT NULL,
          school     TEXT,
          message    TEXT        NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;

      /* --- Admin default sistem (TANPA perlu env ADMIN_EMAIL) ---
         Email literal "admin" (tanpa @), kata sandi bawaan disediakan sistem.
         Idempoten: bila belum ada → INSERT; bila sudah ada → paksa
         role='admin' + set ulang hash ke kata sandi bawaan, agar akun selalu
         bisa masuk. (Jangan pernah log password/hash di sini.) */
      const DEFAULT_ADMIN_EMAIL = "admin";
      const DEFAULT_ADMIN_PASSWORD = "admincerdasbaca";
      const defaultAdminPasswordHash = hashPassword(DEFAULT_ADMIN_PASSWORD);
      await sql`
        INSERT INTO users (name, email, password_hash, level, school, role)
        VALUES ('Administrator', ${DEFAULT_ADMIN_EMAIL}, ${defaultAdminPasswordHash}, 'sma', NULL, 'admin')
        ON CONFLICT (email) DO UPDATE
          SET role = 'admin',
              password_hash = EXCLUDED.password_hash
      `;

      // Admin opsional dari env ADMIN_EMAIL (tetap didukung, bukan syarat utama).
      const adminEmail = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
      if (adminEmail && adminEmail !== DEFAULT_ADMIN_EMAIL) {
        await sql`
          UPDATE users SET role = 'admin'
          WHERE lower(email) = ${adminEmail} AND role <> 'admin'
        `;
      }
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

// Cookie Secure hanya di production (Vercel) agar dev localhost (http) tetap jalan.
function isProductionEnv() {
  return process.env.VERCEL_ENV === "production";
}

function secureAttr() {
  return isProductionEnv() ? "; Secure" : "";
}

function sessionCookie(token) {
  return (
    SESSION_COOKIE +
    "=" +
    token +
    "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" +
    SESSION_MAX_AGE +
    secureAttr()
  );
}

function clearSessionCookie() {
  return SESSION_COOKIE + "=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" + secureAttr();
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
    role: row.role === "admin" ? "admin" : "user",
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
    SELECT u.id, u.name, u.email, u.role, u.level, u.school, u.created_at,
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

/* ---------- 5. Guard auth (dipakai semua endpoint) ---------- */

/** Error HTTP berstatus (ditangani sendApiError). */
function httpError(status, message) {
  const err = new Error(message);
  err.statusCode = status;
  return err;
}

/** Kirim error: HTTP berstatus → responsnya; selain itu → error DB/500. */
function sendApiError(res, err) {
  if (err && err.statusCode) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  sendDbError(res, err);
}

/** Wajib login; lempar 401 (atau error DB bila koneksi gagal). */
async function requireUser(req) {
  const user = await getUserFromRequest(req);
  if (!user) throw httpError(401, "Anda belum masuk.");
  return user;
}

/** Wajib login DAN role=admin; lempar 401/403. */
async function requireAdmin(req) {
  const user = await requireUser(req);
  if (user.role !== "admin") {
    throw httpError(403, "Akses ditolak: khusus admin.");
  }
  return user;
}

/** Email ini cocok dengan env ADMIN_EMAIL? (bootstrap admin) */
function isAdminEmail(email) {
  const adminEmail = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  return Boolean(adminEmail) && String(email || "").trim().toLowerCase() === adminEmail;
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
  httpError,
  sendApiError,
  requireUser,
  requireAdmin,
  isAdminEmail,
};
