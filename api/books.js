/* /api/books — katalog perpustakaan digital.
   GET    → daftar publik (+ avg_rating, rating_count, my_rating bila login)
   POST   → admin: tambah buku
   PUT    → admin: ubah buku
   DELETE → admin: hapus buku
*/

"use strict";

const {
  initDb,
  getSql,
  sendApiError,
  toRows,
  getSessionToken,
  getUserFromRequest,
  requireAdmin,
  httpError,
} = require("../lib/db");

const LEVELS = ["sd", "smp", "sma", "semua"];
const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

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

function cleanStr(value, field, min, max) {
  const s = String(value == null ? "" : value).trim();
  if (s.length < min || s.length > max) {
    throw httpError(400, field + " harus " + min + "–" + max + " karakter.");
  }
  return s;
}

function cleanLevel(value) {
  const s = String(value == null ? "semua" : value).trim().toLowerCase();
  if (LEVELS.indexOf(s) === -1) {
    throw httpError(400, "Level harus sd, smp, sma, atau semua.");
  }
  return s;
}

function cleanPages(value) {
  if (value === undefined || value === null || value === "") return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 100000) {
    throw httpError(400, "Jumlah halaman harus 0–100000.");
  }
  return n;
}

function cleanEmoji(value) {
  const s = String(value == null ? "📘" : value).trim();
  if (!s) return "📘";
  if (s.length > 16) throw httpError(400, "Ikon cover terlalu panjang.");
  return s;
}

function cleanColor(value) {
  const s = String(value == null ? "#4361ee" : value).trim();
  if (!HEX_RE.test(s)) throw httpError(400, "Warna cover harus hex (#4361ee).");
  return s;
}

function toIntId(value, field) {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    throw httpError(400, (field || "ID") + " tidak valid.");
  }
  return n;
}

function mapBook(row) {
  if (!row) return null;
  const avg = Number(row.avg_rating);
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    description: row.description,
    coverEmoji: row.cover_emoji,
    coverColor: row.cover_color,
    level: row.level,
    pages: Number(row.pages) || 0,
    avgRating: Number.isFinite(avg) ? Math.round(avg * 10) / 10 : 0,
    ratingCount: Number(row.rating_count) || 0,
    myRating: Number(row.my_rating) || 0,
    createdBy: row.created_by || null,
    createdAt: row.created_at || null,
  };
}

async function handleGet(req, res) {
  await initDb();
  const sql = getSql();

  const level = String((req.query && req.query.level) || "").trim().toLowerCase();
  if (level && LEVELS.indexOf(level) === -1) {
    throw httpError(400, "Level harus sd, smp, sma, atau semua.");
  }

  // Login opsional untuk menampilkan rating milik user.
  let user = null;
  if (getSessionToken(req)) {
    user = await getUserFromRequest(req);
  }
  const uid = user ? user.id : -1;

  let rows;
  if (level) {
    rows = toRows(await sql`
      SELECT
        b.id, b.title, b.author, b.description, b.cover_emoji, b.cover_color,
        b.level, b.pages, b.created_by, b.created_at,
        COALESCE(AVG(r.rating), 0)::float AS avg_rating,
        COUNT(r.id)::int AS rating_count,
        (SELECT rr.rating FROM ratings rr
          WHERE rr.book_id = b.id AND rr.user_id = ${uid}) AS my_rating
      FROM books b
      LEFT JOIN ratings r ON r.book_id = b.id
      WHERE b.level = ${level}
      GROUP BY b.id
      ORDER BY b.created_at DESC, b.id DESC
    `);
  } else {
    rows = toRows(await sql`
      SELECT
        b.id, b.title, b.author, b.description, b.cover_emoji, b.cover_color,
        b.level, b.pages, b.created_by, b.created_at,
        COALESCE(AVG(r.rating), 0)::float AS avg_rating,
        COUNT(r.id)::int AS rating_count,
        (SELECT rr.rating FROM ratings rr
          WHERE rr.book_id = b.id AND rr.user_id = ${uid}) AS my_rating
      FROM books b
      LEFT JOIN ratings r ON r.book_id = b.id
      GROUP BY b.id
      ORDER BY b.created_at DESC, b.id DESC
    `);
  }

  return send(res, 200, { items: rows.map(mapBook) });
}

async function handlePost(req, res) {
  const admin = await requireAdmin(req);
  const sql = getSql();
  const body = readJsonBody(req);

  const title = cleanStr(body.title, "Judul", 1, 200);
  const author = String(body.author == null ? "" : body.author).trim().slice(0, 120);
  const description = String(body.description == null ? "" : body.description).trim().slice(0, 2000);
  const level = cleanLevel(body.level);
  const pages = cleanPages(body.pages);
  const emoji = cleanEmoji(body.cover_emoji);
  const color = cleanColor(body.cover_color);

  const rows = toRows(await sql`
    INSERT INTO books (title, author, description, cover_emoji, cover_color, level, pages, created_by)
    VALUES (${title}, ${author}, ${description}, ${emoji}, ${color}, ${level}, ${pages}, ${admin.id})
    RETURNING id, title, author, description, cover_emoji, cover_color, level, pages,
              created_by, created_at
  `);

  const book = rows[0];
  if (!book) throw httpError(500, "Gagal menyimpan buku.");

  return send(res, 201, {
    ok: true,
    book: mapBook(Object.assign({}, book, { avg_rating: 0, rating_count: 0, my_rating: 0 })),
  });
}

async function handlePut(req, res) {
  await requireAdmin(req);
  const sql = getSql();
  const body = readJsonBody(req);
  const id = toIntId(body.id, "ID buku");

  const existing = toRows(await sql`SELECT * FROM books WHERE id = ${id}`)[0];
  if (!existing) throw httpError(404, "Buku tidak ditemukan.");

  const title =
    body.title !== undefined ? cleanStr(body.title, "Judul", 1, 200) : existing.title;
  const author =
    body.author !== undefined
      ? String(body.author).trim().slice(0, 120)
      : existing.author;
  const description =
    body.description !== undefined
      ? String(body.description).trim().slice(0, 2000)
      : existing.description;
  const level = body.level !== undefined ? cleanLevel(body.level) : existing.level;
  const pages = body.pages !== undefined ? cleanPages(body.pages) : existing.pages;
  const emoji =
    body.cover_emoji !== undefined ? cleanEmoji(body.cover_emoji) : existing.cover_emoji;
  const color =
    body.cover_color !== undefined ? cleanColor(body.cover_color) : existing.cover_color;

  const rows = toRows(await sql`
    UPDATE books
    SET title = ${title}, author = ${author}, description = ${description},
        cover_emoji = ${emoji}, cover_color = ${color}, level = ${level}, pages = ${pages}
    WHERE id = ${id}
    RETURNING id, title, author, description, cover_emoji, cover_color, level, pages,
              created_by, created_at
  `);

  const book = rows[0];
  if (!book) throw httpError(500, "Gagal memperbarui buku.");
  return send(res, 200, {
    ok: true,
    book: mapBook(Object.assign({}, book, { avg_rating: 0, rating_count: 0, my_rating: 0 })),
  });
}

async function handleDelete(req, res) {
  await requireAdmin(req);
  const sql = getSql();
  const body = readJsonBody(req);
  const rawId =
    body.id !== undefined && body.id !== null && body.id !== ""
      ? body.id
      : (req.query && (req.query.id || req.query.book_id)) || "";
  const id = toIntId(rawId, "ID buku");

  const rows = toRows(await sql`DELETE FROM books WHERE id = ${id} RETURNING id`);
  if (!rows.length) throw httpError(404, "Buku tidak ditemukan.");
  return send(res, 200, { ok: true });
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET") return await handleGet(req, res);

    await initDb();
    if (req.method === "POST") return await handlePost(req, res);
    if (req.method === "PUT") return await handlePut(req, res);
    if (req.method === "DELETE") return await handleDelete(req, res);

    res.setHeader("Allow", "GET, POST, PUT, DELETE");
    return send(res, 405, { error: "Metode tidak diizinkan." });
  } catch (err) {
    sendApiError(res, err);
  }
};
