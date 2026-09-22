/* POST /api/logout — hapus sesi di server + bersihkan cookie. */

"use strict";

const {
  initDb,
  destroySession,
  clearSessionCookie,
  sendDbError,
} = require("../lib/db");

function send(res, status, body) {
  res.status(status).json(body);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "Metode tidak diizinkan." });
  }

  let dbError = null;
  try {
    await initDb();
    await destroySession(req);
  } catch (err) {
    dbError = err;
  }

  // Cookie selalu dibersihkan agar pengguna keluar dari sisi browser.
  res.setHeader("Set-Cookie", clearSessionCookie());

  if (dbError) {
    sendDbError(res, dbError);
    return;
  }
  return send(res, 200, { ok: true });
};
