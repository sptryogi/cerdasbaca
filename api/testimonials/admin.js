/* GET /api/testimonials/admin — semua testimoni (semua status), admin only. */

"use strict";

const {
  initDb,
  getSql,
  sendApiError,
  toRows,
  requireAdmin,
} = require("../lib/db");

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
      SELECT t.id, t.quote, t.role_label, t.status, t.created_at,
             u.name, u.email
      FROM testimonials t
      LEFT JOIN users u ON u.id = t.user_id
      ORDER BY
        CASE t.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
        t.created_at DESC, t.id DESC
      LIMIT 200
    `);

    return send(res, 200, {
      items: rows.map(function (row) {
        return {
          id: row.id,
          quote: row.quote,
          roleLabel: row.role_label || "",
          status: row.status,
          name: row.name || null,
          email: row.email || null,
          createdAt: row.created_at || null,
        };
      }),
    });
  } catch (err) {
    sendApiError(res, err);
  }
};
