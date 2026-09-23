/* Kelas membaca — pendaftaran & pembatalan.
   POST   → login: ikuti kelas (tolak bila penuh/duplikat)
   DELETE → login: batal ikut kelas
*/

"use strict";

const {
  initDb,
  getSql,
  sendApiError,
  toRows,
  requireUser,
  httpError,
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

module.exports = async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "DELETE") {
    res.setHeader("Allow", "POST, DELETE");
    return send(res, 405, { error: "Metode tidak diizinkan." });
  }

  try {
    await initDb();
    const user = await requireUser(req);
    const sql = getSql();
    const classId = classIdFrom(req);

    const kelas = toRows(await sql`
      SELECT id, capacity FROM reading_classes WHERE id = ${classId}
    `)[0];
    if (!kelas) throw httpError(404, "Kelas tidak ditemukan.");

    if (req.method === "POST") {
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

    // DELETE → batal ikut
    const deleted = toRows(await sql`
      DELETE FROM class_enrollments
      WHERE class_id = ${classId} AND user_id = ${user.id}
      RETURNING id
    `);
    if (!deleted.length) {
      throw httpError(404, "Anda belum terdaftar di kelas ini.");
    }
    return send(res, 200, { ok: true });
  } catch (err) {
    sendApiError(res, err);
  }
};
