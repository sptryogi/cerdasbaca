/* /api/testimonials — testimoni (publik approved + submit user + aksi admin).
   GET    → hanya status approved (untuk landing)
   POST   → login: kirim testimoni (status pending)
   PUT    → admin: approve / reject
*/

"use strict";

const {
  initDb,
  getSql,
  sendApiError,
  toRows,
  requireUser,
  requireAdmin,
  httpError,
} = require("../lib/db");

const ROLE_LABELS = ["siswa", "guru", "orang tua", "lainnya", ""];

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

function mapTestimonial(row) {
  if (!row) return null;
  return {
    id: row.id,
    quote: row.quote,
    roleLabel: row.role_label || "",
    status: row.status,
    name: row.name || null,
    createdAt: row.created_at || null,
  };
}

async function handleGet(req, res) {
  await initDb();
  const sql = getSql();
  const rows = toRows(await sql`
    SELECT t.id, t.quote, t.role_label, t.status, t.created_at,
           u.name
    FROM testimonials t
    LEFT JOIN users u ON u.id = t.user_id
    WHERE t.status = 'approved'
    ORDER BY t.created_at DESC, t.id DESC
    LIMIT 30
  `);
  return send(res, 200, { items: rows.map(mapTestimonial) });
}

async function handlePost(req, res) {
  await initDb();
  const user = await requireUser(req);
  const sql = getSql();

  const body = readJsonBody(req);
  const quote = String(body.quote || "").trim();
  let roleLabel = String(body.role_label == null ? "" : body.role_label).trim().toLowerCase();

  if (quote.length < 10 || quote.length > 500) {
    throw httpError(400, "Testimoni harus 10–500 karakter.");
  }
  if (ROLE_LABELS.indexOf(roleLabel) === -1) {
    roleLabel = "lainnya";
  }

  const rows = toRows(await sql`
    INSERT INTO testimonials (user_id, quote, role_label, status)
    VALUES (${user.id}, ${quote}, ${roleLabel}, 'pending')
    RETURNING id, quote, role_label, status, created_at
  `);

  const item = rows[0];
  if (!item) throw httpError(500, "Gagal menyimpan testimoni.");
  return send(res, 201, { ok: true, item: mapTestimonial(item) });
}

async function handlePut(req, res) {
  await initDb();
  await requireAdmin(req);
  const sql = getSql();

  const body = readJsonBody(req);
  const id = Number(body.id);
  const action = String(body.action || "").trim().toLowerCase();

  if (!Number.isInteger(id) || id < 1) {
    throw httpError(400, "ID testimoni tidak valid.");
  }
  if (action !== "approve" && action !== "reject") {
    throw httpError(400, "action harus 'approve' atau 'reject'.");
  }

  const status = action === "approve" ? "approved" : "rejected";
  const rows = toRows(await sql`
    UPDATE testimonials SET status = ${status}
    WHERE id = ${id}
    RETURNING id, quote, role_label, status, created_at
  `);
  if (!rows.length) throw httpError(404, "Testimoni tidak ditemukan.");

  return send(res, 200, { ok: true, item: mapTestimonial(rows[0]) });
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET") return await handleGet(req, res);
    if (req.method === "POST") return await handlePost(req, res);
    if (req.method === "PUT") return await handlePut(req, res);
    res.setHeader("Allow", "GET, POST, PUT");
    return send(res, 405, { error: "Metode tidak diizinkan." });
  } catch (err) {
    sendApiError(res, err);
  }
};
