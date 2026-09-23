/* /api/competitions — lomba baca.
   GET  → daftar publik (+ registered bila login)
   POST → admin: buat lomba
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
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

function cleanDate(value, field) {
  if (value === undefined || value === null || value === "") return null;
  const s = String(value).trim();
  if (!DATE_RE.test(s) || Number.isNaN(Date.parse(s))) {
    throw httpError(400, (field || "Tanggal") + " tidak valid (YYYY-MM-DD).");
  }
  return s;
}

function mapCompetition(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    level: row.level,
    rules: row.rules,
    startDate: row.start_date || null,
    endDate: row.end_date || null,
    registered: Boolean(row.registered),
    entriesCount: Number(row.entries_count) || 0,
    createdAt: row.created_at || null,
  };
}

async function handleGet(req, res) {
  await initDb();
  const sql = getSql();

  let user = null;
  if (getSessionToken(req)) {
    user = await getUserFromRequest(req);
  }
  const uid = user ? user.id : -1;

  const rows = toRows(await sql`
    SELECT c.id, c.title, c.description, c.level, c.rules,
           c.start_date, c.end_date, c.created_at,
           EXISTS(
             SELECT 1 FROM competition_entries ce
             WHERE ce.competition_id = c.id AND ce.user_id = ${uid}
           ) AS registered,
           (SELECT COUNT(*)::int FROM competition_entries ce2
             WHERE ce2.competition_id = c.id) AS entries_count
    FROM competitions c
    ORDER BY c.created_at DESC, c.id DESC
  `);

  return send(res, 200, { items: rows.map(mapCompetition) });
}

async function handlePost(req, res) {
  await requireAdmin(req);
  const sql = getSql();
  const body = readJsonBody(req);

  const title = cleanStr(body.title, "Judul lomba", 3, 150);
  const description = String(body.description == null ? "" : body.description).trim().slice(0, 1500);
  const rules = String(body.rules == null ? "" : body.rules).trim().slice(0, 3000);

  let level = String(body.level == null ? "semua" : body.level).trim().toLowerCase();
  if (LEVELS.indexOf(level) === -1) throw httpError(400, "Level harus sd, sma, smp, atau semua.");

  const startDate = cleanDate(body.start_date, "Tanggal mulai");
  const endDate = cleanDate(body.end_date, "Tanggal selesai");
  if (startDate && endDate && endDate < startDate) {
    throw httpError(400, "Tanggal selesai tidak boleh sebelum tanggal mulai.");
  }

  const rows = toRows(await sql`
    INSERT INTO competitions (title, description, level, rules, start_date, end_date)
    VALUES (${title}, ${description}, ${level}, ${rules}, ${startDate}, ${endDate})
    RETURNING id, title, description, level, rules, start_date, end_date, created_at
  `);

  const item = rows[0];
  if (!item) throw httpError(500, "Gagal menyimpan lomba.");
  return send(res, 201, {
    ok: true,
    item: mapCompetition(Object.assign({}, item, { registered: false, entries_count: 0 })),
  });
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET") return await handleGet(req, res);
    if (req.method === "POST") {
      await initDb();
      return await handlePost(req, res);
    }
    res.setHeader("Allow", "GET, POST");
    return send(res, 405, { error: "Metode tidak diizinkan." });
  } catch (err) {
    sendApiError(res, err);
  }
};
