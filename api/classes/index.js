/* /api/classes — kelas membaca.
   GET  → daftar publik + seats_taken (+ enrolled bila login)
   POST → admin: buat kelas
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

function mapClass(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    level: row.level,
    scheduleText: row.schedule_text,
    capacity: Number(row.capacity) || 0,
    seatsTaken: Number(row.seats_taken) || 0,
    teacherName: row.teacher_name,
    enrolled: Boolean(row.enrolled),
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
    SELECT c.id, c.title, c.description, c.level, c.schedule_text,
           c.capacity, c.teacher_name, c.created_at,
           COUNT(e.id)::int AS seats_taken,
           EXISTS(
             SELECT 1 FROM class_enrollments e2
             WHERE e2.class_id = c.id AND e2.user_id = ${uid}
           ) AS enrolled
    FROM reading_classes c
    LEFT JOIN class_enrollments e ON e.class_id = c.id
    GROUP BY c.id
    ORDER BY c.created_at DESC, c.id DESC
  `);

  return send(res, 200, { items: rows.map(mapClass) });
}

async function handlePost(req, res) {
  await requireAdmin(req);
  const sql = getSql();
  const body = readJsonBody(req);

  const title = cleanStr(body.title, "Judul kelas", 3, 120);
  const description = String(body.description == null ? "" : body.description).trim().slice(0, 1000);
  const scheduleText = String(body.schedule_text == null ? "" : body.schedule_text).trim().slice(0, 120);
  const teacherName = String(body.teacher_name == null ? "" : body.teacher_name).trim().slice(0, 80);

  let level = String(body.level == null ? "semua" : body.level).trim().toLowerCase();
  if (LEVELS.indexOf(level) === -1) throw httpError(400, "Level harus sd, sma, smp, atau semua.");

  const capacityRaw = body.capacity === undefined || body.capacity === "" ? 20 : Number(body.capacity);
  if (!Number.isInteger(capacityRaw) || capacityRaw < 1 || capacityRaw > 500) {
    throw httpError(400, "Kuota harus 1–500.");
  }

  const rows = toRows(await sql`
    INSERT INTO reading_classes (title, description, level, schedule_text, capacity, teacher_name)
    VALUES (${title}, ${description}, ${level}, ${scheduleText}, ${capacityRaw}, ${teacherName})
    RETURNING id, title, description, level, schedule_text, capacity, teacher_name, created_at
  `);

  const item = rows[0];
  if (!item) throw httpError(500, "Gagal menyimpan kelas.");
  return send(res, 201, {
    ok: true,
    item: mapClass(Object.assign({}, item, { seats_taken: 0, enrolled: false })),
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
