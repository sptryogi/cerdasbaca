/* POST /api/competitions/register — daftar lomba (login required). */

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

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "Metode tidak diizinkan." });
  }

  try {
    await initDb();
    const user = await requireUser(req);
    const sql = getSql();

    const body = readJsonBody(req);
    const competitionId = Number(body.competition_id);
    if (!Number.isInteger(competitionId) || competitionId < 1) {
      throw httpError(400, "competition_id tidak valid.");
    }

    const comp = toRows(await sql`
      SELECT id, end_date FROM competitions WHERE id = ${competitionId}
    `)[0];
    if (!comp) throw httpError(404, "Lomba tidak ditemukan.");

    // Tolak pendaftaran bila sudah lewat tanggal akhir.
    const open = toRows(await sql`
      SELECT id FROM competitions
      WHERE id = ${competitionId}
        AND (end_date IS NULL OR end_date >= CURRENT_DATE)
    `)[0];
    if (!open) throw httpError(409, "Pendaftaran lomba sudah ditutup.");

    const inserted = toRows(await sql`
      INSERT INTO competition_entries (competition_id, user_id)
      VALUES (${competitionId}, ${user.id})
      ON CONFLICT (competition_id, user_id) DO NOTHING
      RETURNING id
    `);
    if (!inserted.length) {
      throw httpError(409, "Anda sudah terdaftar di lomba ini.");
    }

    const count = toRows(await sql`
      SELECT COUNT(*)::int AS n FROM competition_entries WHERE competition_id = ${competitionId}
    `)[0];

    return send(res, 201, {
      ok: true,
      entriesCount: Number(count && count.n) || 0,
    });
  } catch (err) {
    sendApiError(res, err);
  }
};
