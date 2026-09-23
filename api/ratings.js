/* POST /api/ratings — beri rating buku 1–5 (upsert per user+book). */

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
    const bookId = Number(body.book_id);
    const rating = Number(body.rating);

    if (!Number.isInteger(bookId) || bookId < 1) {
      throw httpError(400, "book_id tidak valid.");
    }
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw httpError(400, "Rating harus bilangan bulat 1–5.");
    }

    const book = toRows(await sql`SELECT id FROM books WHERE id = ${bookId}`)[0];
    if (!book) throw httpError(404, "Buku tidak ditemukan.");

    // Upsert: satu rating per user per buku.
    await sql`
      INSERT INTO ratings (book_id, user_id, rating)
      VALUES (${bookId}, ${user.id}, ${rating})
      ON CONFLICT (book_id, user_id)
      DO UPDATE SET rating = EXCLUDED.rating, created_at = now()
    `;

    const agg = toRows(await sql`
      SELECT COALESCE(AVG(rating), 0)::float AS avg_rating, COUNT(*)::int AS rating_count
      FROM ratings
      WHERE book_id = ${bookId}
    `)[0];

    const avg = Number(agg && agg.avg_rating) || 0;
    return send(res, 200, {
      ok: true,
      rating: rating,
      avgRating: Math.round(avg * 10) / 10,
      ratingCount: Number(agg && agg.rating_count) || 0,
    });
  } catch (err) {
    sendApiError(res, err);
  }
};
