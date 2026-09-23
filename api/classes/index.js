/* /api/classes — kelas membaca.
   GET    → daftar publik + seats_taken (+ enrolled bila login)
   POST   → admin: buat kelas (tanpa field action)
          → login + body.action="enroll": ikuti kelas (tolak bila penuh/duplikat)
   DELETE → login: batal ikut kelas (class_id dari body atau query)
*/

"use strict";

const {
  initDb,
  getSql,
  sendApiError,
  toRows,
  getSessionToken,
  getUserFromRequest,
  requireUser,
  requireAdmin,
  httpError,
} = require("../../lib/db");

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

/** class_id dari body, fallback ke query string. */
function classIdFrom(req) {
  const body = readJsonBody(req);
  const raw =
    body.class_id !== undefined && body.class_id !== null && body.class_id !== ""
      ? body.class_id
      : req.query && req.query.class_id;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw httpError(400, "class_id tidak valid.");
  }
  return n;
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

/** POST tanpa action → admin: buat kelas. */
async function handleCreate(req, res) {
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

/** Ambil kelas; 404 bila tidak ada. */
async function loadClassOr404(classId) {
  const sql = getSql();
  const kelas = toRows(await sql`
    SELECT id, capacity FROM reading_classes WHERE id = ${classId}
  `)[0];
  if (!kelas) throw httpError(404, "Kelas tidak ditemukan.");
  return kelas;
}

/** POST action=enroll → ikuti kelas (login). */
async function handleEnroll(req, res) {
  const user = await requireUser(req);
  const sql = getSql();
  const classId = classIdFrom(req);
  await loadClassOr404(classId);

  // Insert atomik: hanya sisipkan bila masih ada kursi kosong.
  const inserted = toRows(await sql`
    INSERT INTO class_enrollments (class_id, user_id)
    SELECT ${classId}, ${user.id}
    WHERE (
      SELECT COUNT(*) FROM class_enrollments WHERE class_id = ${classId}
    ) < (
      SELECT capacity FROM reading_classes WHERE id = ${classId}
    )
    ON CONFLICT (class_id, user_id) DO NOTHING
    RETURNING id
  `);
  if (!inserted.length) {
    const already = toRows(await sql`
      SELECT 1 FROM class_enrollments
      WHERE class_id = ${classId} AND user_id = ${user.id}
    `)[0];
    if (already) {
      throw httpError(409, "Anda sudah terdaftar di kelas ini.");
    }
    throw httpError(409, "Kelas sudah penuh.");
  }
  return send(res, 201, { ok: true });
}

/** DELETE → batal ikut kelas (login). */
async function handleUnenroll(req, res) {
  const user = await requireUser(req);
  const sql = getSql();
  const classId = classIdFrom(req);
  await loadClassOr404(classId);

  const deleted = toRows(await sql`
    DELETE FROM class_enrollments
    WHERE class_id = ${classId} AND user_id = ${user.id}
    RETURNING id
  `);
  if (!deleted.length) {
    throw httpError(404, "Anda belum terdaftar di kelas ini.");
  }
  return send(res, 200, { ok: true });
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET") return await handleGet(req, res);
    if (req.method === "POST") {
      await initDb();
      const body = readJsonBody(req);
      const action = String(body.action || "").trim().toLowerCase();
      if (action === "enroll") return await handleEnroll(req, res);
      return await handleCreate(req, res);
    }
    if (req.method === "DELETE") {
      await initDb();
      return await handleUnenroll(req, res);
    }
    res.setHeader("Allow", "GET, POST, DELETE");
    return send(res, 405, { error: "Metode tidak diizinkan." });
  } catch (err) {
    sendApiError(res, err);
  }
};
