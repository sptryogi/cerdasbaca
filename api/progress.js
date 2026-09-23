/* /api/progress — jurnal & progres baca.
   GET              → daftar progres milik user login (note & read_date)
   GET ?admin=1     → admin: progres semua siswa (+ nama & email)
   POST             → tambah / perbarui progres per judul (jurnal baca)
*/

"use strict";

const {
  initDb,
  getSql,
  sendApiError,
  toRows,
  requireUser,
  requireAdmin,
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
  const item = {
    id: row.id,
    title: row.title,
    status: row.status,
    pages: Number(row.pages) || 0,
    percent: Number(row.percent) || 0,
    note: row.note || "",
    readDate: row.read_date || null,
    updatedAt: row.updated_at || row.updatedAt || null,
  };
  // Field tambahan hanya pada mode admin (bila ikut di-SELECT).
  if (row.user_name !== undefined) {
    item.userName = row.user_name || "";
    item.userEmail = row.user_email || "";
    item.userId = row.user_id;
  }
  return item;
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
    const sql = getSql();

    if (req.method === "GET") {
      const isAdminScope =
        req.query &&
        (req.query.admin === "1" ||
          req.query.admin === "true" ||
          req.query.scope === "admin");

      if (isAdminScope) {
        // Khusus admin: jurnal seluruh siswa (untuk monitoring panel).
        await requireAdmin(req);
        const rows = toRows(await sql`
          SELECT p.id, p.user_id, p.title, p.status, p.pages, p.percent,
                 p.note, p.read_date, p.updated_at,
                 u.name  AS user_name,
                 u.email AS user_email
          FROM reading_progress p
          JOIN users u ON u.id = p.user_id
          ORDER BY p.updated_at DESC, p.id DESC
          LIMIT 200
        `);
        return send(res, 200, { items: rows.map(mapProgress), scope: "admin" });
      }

      const user = await requireUser(req);
      const rows = toRows(await sql`
        SELECT id, title, status, pages, percent, note, read_date, updated_at
        FROM reading_progress
        WHERE user_id = ${user.id}
        ORDER BY updated_at DESC, id DESC
      `);
      return send(res, 200, { items: rows.map(mapProgress) });
    }

    // POST — wajib login + validasi input
    const user = await requireUser(req);
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
