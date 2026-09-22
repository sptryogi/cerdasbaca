/* POST /api/register — buat akun baru, lalu set sesi. */

"use strict";

const {
  initDb,
  getSql,
  sendDbError,
  toRows,
  hashPassword,
  createSession,
  sessionCookie,
  publicUser,
} = require("../lib/db");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

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

  const rawName = body.name != null ? body.name : body.nama;
  const rawLevel = body.level != null ? body.level : body.jenjang;
  const rawSchool = body.school != null ? body.school : body.sekolah;

  const name = String(rawName || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const level = String(rawLevel || "").trim().toLowerCase();
  const school = String(rawSchool || "").trim();

  if (name.length < 2 || name.length > 100) {
    return send(res, 400, { error: "Nama lengkap harus 2–100 karakter." });
  }
  if (email.length > 200 || !EMAIL_RE.test(email)) {
    return send(res, 400, { error: "Format email tidak valid." });
  }
  if (password.length < 6 || password.length > 128) {
    return send(res, 400, { error: "Kata sandi minimal 6 karakter." });
  }
  if (level !== "sd" && level !== "smp" && level !== "sma") {
    return send(res, 400, { error: "Pilih jenjang SD, SMP, atau SMA." });
  }
  if (school.length > 120) {
    return send(res, 400, { error: "Nama sekolah maksimal 120 karakter." });
  }

  try {
    await initDb();
    const sql = getSql();

    const existing = toRows(
      await sql`SELECT id FROM users WHERE email = ${email} LIMIT 1`
    );
    if (existing.length) {
      return send(res, 409, { error: "Email sudah terdaftar. Silakan masuk." });
    }

    let inserted;
    try {
      inserted = toRows(
        await sql`
          INSERT INTO users (name, email, password_hash, level, school)
          VALUES (${name}, ${email}, ${hashPassword(password)}, ${level}, ${
            school ? school : null
          })
          RETURNING id, name, email, level, school, created_at
        `
      );
    } catch (err) {
      // 23505 = unique_violation (balapan dengan pengecekan di atas)
      if (err && String(err.code) === "23505") {
        return send(res, 409, {
          error: "Email sudah terdaftar. Silakan masuk.",
        });
      }
      throw err;
    }

    const user = inserted[0];
    if (!user) {
      return send(res, 500, { error: "Gagal membuat akun. Coba lagi." });
    }

    const token = await createSession(user.id);
    res.setHeader("Set-Cookie", sessionCookie(token));
    return send(res, 201, { ok: true, user: publicUser(user) });
  } catch (err) {
    sendDbError(res, err);
  }
};
