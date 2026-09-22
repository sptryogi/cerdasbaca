/* POST /api/login — verifikasi email & kata sandi, lalu set sesi. */

"use strict";

const {
  initDb,
  getSql,
  sendDbError,
  toRows,
  verifyPassword,
  createSession,
  sessionCookie,
  publicUser,
} = require("../lib/db");

function send(res, status, body) {
  res.status(status).json(body);
}

function readJsonBody(req) {
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (e) {
      body = null;
    }
  }
  if (!body || typeof body !== "object") return {};
  return body;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "Metode tidak diizinkan." });
  }

  const body = readJsonBody(req);
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");

  if (!email || !password) {
    return send(res, 400, { error: "Email dan kata sandi wajib diisi." });
  }

  try {
    await initDb();
    const sql = getSql();

    const rows = toRows(await sql`
      SELECT id, name, email, password_hash, level, school, created_at
      FROM users
      WHERE email = ${email}
      LIMIT 1
    `);

    const user = rows[0];
    // Pesan generik — jangan bocorkan apakah email terdaftar.
    if (!user || !verifyPassword(password, user.password_hash)) {
      return send(res, 401, { error: "Email atau password salah." });
    }

    const token = await createSession(user.id);
    res.setHeader("Set-Cookie", sessionCookie(token));
    return send(res, 200, { ok: true, user: publicUser(user) });
  } catch (err) {
    sendDbError(res, err);
  }
};
