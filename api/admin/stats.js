/* GET /api/admin/stats — ringkasan data program, admin only. */

"use strict";

const {
  initDb,
  getSql,
  sendApiError,
  toRows,
  requireAdmin,
} = require("../../lib/db");

function send(res, status, body) {
  res.status(status).json(body);
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return send(res, 405, { error: "Metode tidak diizinkan." });
  }

  try {
    await initDb();
    await requireAdmin(req);
    const sql = getSql();

    const rows = toRows(await sql`
      SELECT
        (SELECT COUNT(*)::int FROM users)                              AS users,
        (SELECT COUNT(*)::int FROM users WHERE role = 'admin')         AS admins,
        (SELECT COUNT(*)::int FROM books)                              AS books,
        (SELECT COUNT(*)::int FROM ratings)                            AS ratings,
        (SELECT COUNT(*)::int FROM reading_classes)                    AS classes,
        (SELECT COUNT(*)::int FROM class_enrollments)                  AS enrollments,
        (SELECT COUNT(*)::int FROM competitions)                       AS competitions,
        (SELECT COUNT(*)::int FROM competition_entries)                AS competition_entries,
        (SELECT COUNT(*)::int FROM testimonials)                       AS testimonials,
        (SELECT COUNT(*)::int FROM testimonials WHERE status = 'pending')   AS testimonials_pending,
        (SELECT COUNT(*)::int FROM testimonials WHERE status = 'approved')  AS testimonials_approved,
        (SELECT COUNT(*)::int FROM reading_progress)                   AS progress_entries
    `);

    const s = rows[0] || {};
    return send(res, 200, {
      stats: {
        users: Number(s.users) || 0,
        admins: Number(s.admins) || 0,
        books: Number(s.books) || 0,
        ratings: Number(s.ratings) || 0,
        classes: Number(s.classes) || 0,
        enrollments: Number(s.enrollments) || 0,
        competitions: Number(s.competitions) || 0,
        competitionEntries: Number(s.competition_entries) || 0,
        testimonials: Number(s.testimonials) || 0,
        testimonialsPending: Number(s.testimonials_pending) || 0,
        testimonialsApproved: Number(s.testimonials_approved) || 0,
        progressEntries: Number(s.progress_entries) || 0,
      },
    });
  } catch (err) {
    sendApiError(res, err);
  }
};
