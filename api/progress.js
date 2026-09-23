/* /api/progress — jurnal & progres baca milik pengguna yang sedang masuk.
   GET  → daftar progres (termasuk note & read_date)
   POST → tambah / perbarui progres per judul (jurnal baca)
*/

"use strict";

const {
  initDb,
  getSql,
  sendApiError,
  toRows,
  requireUser,
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
    note: row.note || "",
    readDate: row.read_date || null,
    updatedAt: row.updated_at || row.updatedAt || null,
  };
}

function toIntInRange(value, min, max, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return NaN;
  if (n < min || n > max) return NaN;
  return n;
}

/** "" / null → null; "YYYY-MM-DD" valid → string itu sendiri; salah → NaN. */
function toReadDate(value) {
  if (value === undefined || value === null || value === "") return null;
  const s = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) return NaN;
  return s;
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return send(res, 405, { error: "Metode tidak diizinkan." });
  }

  try {
    await initDb();
    const user = await requireUser(req);
    const sql = getSql();

    if (req.method === "GET") {
      const rows = toRows(await sql`
        SELECT id, title, status, pages, percent, note, read_date, updated_at
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
    const note = String(body.note == null ? "" : body.note).trim().slice(0, 1000);
    const readDate = toReadDate(body.read_date);

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
    if (Number.isNaN(readDate)) {
      return send(res, 400, { error: "Tanggal baca tidak valid (format YYYY-MM-DD)." });
    }
    if (status === "finished") percent = 100;

    // Upsert atomik per (user_id, title) — aman dari race condition.
    const rows = toRows(await sql`
      INSERT INTO reading_progress
        (user_id, title, status, pages, percent, note, read_date)
      VALUES (${user.id}, ${title}, ${status}, ${pages}, ${percent}, ${note}, ${readDate})
      ON CONFLICT (user_id, title) DO UPDATE
        SET status = EXCLUDED.status,
            pages = EXCLUDED.pages,
            percent = EXCLUDED.percent,
            note = EXCLUDED.note,
            read_date = EXCLUDED.read_date,
            updated_at = now()
      RETURNING id, title, status, pages, percent, note, read_date, updated_at
    `);

    const item = rows[0];
    if (!item) {
      return send(res, 500, { error: "Gagal menyimpan catatan. Coba lagi." });
    }
    return send(res, 200, { ok: true, item: mapProgress(item) });
  } catch (err) {
    sendApiError(res, err);
  }
};
