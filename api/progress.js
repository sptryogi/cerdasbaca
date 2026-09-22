/* /api/progress — progres baca milik pengguna yang sedang masuk.
   GET  → daftar progres
   POST → tambah / perbarui progres (berdasarkan judul)
*/

"use strict";

const {
  initDb,
  getSql,
  sendDbError,
  toRows,
  getSessionToken,
  getUserFromRequest,
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

function mapProgress(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    pages: Number(row.pages) || 0,
    percent: Number(row.percent) || 0,
    updatedAt: row.updated_at || row.updatedAt || null,
  };
}

/** Wajib masuk; lempar 401 lewat res (return null) atau error DB (throw). */
async function requireUser(req, res) {
  if (!getSessionToken(req)) {
    send(res, 401, { error: "Anda belum masuk." });
    return null;
  }
  await initDb();
  const user = await getUserFromRequest(req);
  if (!user) {
    send(res, 401, { error: "Anda belum masuk." });
    return null;
  }
  return user;
}

function toIntInRange(value, min, max, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return NaN;
  if (n < min || n > max) return NaN;
  return n;
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return send(res, 405, { error: "Metode tidak diizinkan." });
  }

  try {
    const user = await requireUser(req, res);
    if (!user) return; // 401 sudah dikirim

    const sql = getSql();

    if (req.method === "GET") {
      const rows = toRows(await sql`
        SELECT id, title, status, pages, percent, updated_at
        FROM reading_progress
        WHERE user_id = ${user.id}
        ORDER BY updated_at DESC, id DESC
      `);
      return send(res, 200, { items: rows.map(mapProgress) });
    }

    // POST — validasi input
    const body = readJsonBody(req);
    const title = String(body.title || "").trim();
    const status = String(body.status || "reading").trim().toLowerCase();
    const pages = toIntInRange(body.pages, 0, 100000, 0);
    let percent = toIntInRange(body.percent, 0, 100, 0);

    if (title.length < 1 || title.length > 200) {
      return send(res, 400, {
        error: "Judul buku wajib diisi (maksimal 200 karakter).",
      });
    }
    if (status !== "reading" && status !== "finished") {
      return send(res, 400, { error: "Status harus 'reading' atau 'finished'." });
    }
    if (Number.isNaN(pages)) {
      return send(res, 400, { error: "Jumlah halaman harus 0–100000." });
    }
    if (Number.isNaN(percent)) {
      return send(res, 400, { error: "Progres harus 0–100." });
    }
    if (status === "finished") percent = 100;

    // Perbarui dulu bila judul sudah ada; kalau belum, sisipkan baru.
    let rows = toRows(await sql`
      UPDATE reading_progress
      SET status = ${status}, pages = ${pages}, percent = ${percent},
          updated_at = now()
      WHERE user_id = ${user.id} AND title = ${title}
      RETURNING id, title, status, pages, percent, updated_at
    `);

    if (!rows.length) {
      rows = toRows(await sql`
        INSERT INTO reading_progress (user_id, title, status, pages, percent)
        VALUES (${user.id}, ${title}, ${status}, ${pages}, ${percent})
        RETURNING id, title, status, pages, percent, updated_at
      `);
    }

    const item = rows[0];
    if (!item) {
      return send(res, 500, { error: "Gagal menyimpan catatan. Coba lagi." });
    }
    return send(res, 200, { ok: true, item: mapProgress(item) });
  } catch (err) {
    sendDbError(res, err);
  }
};
