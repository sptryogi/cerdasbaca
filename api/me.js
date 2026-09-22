/* GET /api/me — info pengguna dari cookie sesi. 401 bila belum masuk. */

"use strict";

const {
  initDb,
  getUserFromRequest,
  getSessionToken,
  sendDbError,
} = require("../lib/db");

function send(res, status, body) {
  res.status(status).json(body);
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return send(res, 405, { error: "Metode tidak diizinkan." });
  }

  // Tanpa cookie → 401 langsung, tanpa menyentuh database.
  if (!getSessionToken(req)) {
    return send(res, 401, { error: "Anda belum masuk." });
  }

  try {
    await initDb();
    const user = await getUserFromRequest(req);
    if (!user) {
      return send(res, 401, { error: "Anda belum masuk." });
    }
    return send(res, 200, { user });
  } catch (err) {
    sendDbError(res, err);
  }
};
