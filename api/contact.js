/* POST /api/contact — teruskan pesan form kontak (index.html) ke email tim.
   Tujuan : dianrakyatdigital@gmail.com
   Urutan pengiriman (tanpa dependency npm baru, tanpa API key hardcode):
     1. bila env RESEND_API_KEY ada  → fetch Resend API (global fetch Node 18+)
     2. fallback / tanpa key         → fetch FormSubmit (AJAX, tanpa API key)
     3. keduanya gagal               → simpan ke tabel contact_messages (DB)
        dan tetap balas 200 agar pesan pengguna tidak hilang.
*/

"use strict";

const {
  initDb,
  getSql,
  sendApiError,
  httpError,
} = require("../lib/db");

const TARGET_EMAIL = "dianrakyatdigital@gmail.com";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

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

function buildMessageText(fields) {
  return [
    "Pesan baru dari form kontak CerdasBaca",
    "",
    "Nama    : " + fields.name,
    "Email   : " + fields.email,
    "Sekolah : " + (fields.school || "-"),
    "",
    "Pesan:",
    fields.message,
  ].join("\n");
}

/** Kirim lewat Resend API — hanya bila RESEND_API_KEY tersedia (env, bukan hardcode). */
async function sendViaResend(fields, apiKey) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "CerdasBaca <onboarding@resend.dev>",
      to: [TARGET_EMAIL],
      reply_to: fields.email,
      subject: "Pesan Kontak CerdasBaca — " + fields.name,
      text: buildMessageText(fields),
    }),
  });
  if (!res.ok) {
    throw new Error("Resend merespons HTTP " + res.status);
  }
  return true;
}

/** Kirim lewat FormSubmit endpoint AJAX — tanpa API key. */
async function sendViaFormSubmit(fields) {
  const res = await fetch(
    "https://formsubmit.co/ajax/" + encodeURIComponent(TARGET_EMAIL),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        _subject: "Pesan Kontak CerdasBaca — " + fields.name,
        _template: "table",
        Nama: fields.name,
        Email: fields.email,
        Sekolah: fields.school || "-",
        Pesan: fields.message,
      }),
    }
  );
  if (!res.ok) {
    throw new Error("FormSubmit merespons HTTP " + res.status);
  }
  return true;
}

/** Fallback terakhir: simpan pesan ke DB (tabel dibuat idempoten di ensureSchema). */
async function saveToDb(fields) {
  await initDb();
  const sql = getSql();
  await sql`
    INSERT INTO contact_messages (name, email, school, message)
    VALUES (${fields.name}, ${fields.email}, ${
      fields.school ? fields.school : null
    }, ${fields.message})
  `;
  return true;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "Metode tidak diizinkan." });
  }

  try {
    const body = readJsonBody(req);

    const rawName = body.name != null ? body.name : body.nama;
    const rawSchool = body.school != null ? body.school : body.sekolah;
    const rawMessage = body.message != null ? body.message : body.pesan;

    const fields = {
      name: String(rawName || "").trim(),
      email: String(body.email || "").trim().toLowerCase(),
      school: String(rawSchool || "").trim(),
      message: String(rawMessage || "").trim(),
    };

    /* Validasi wajib: nama, email, pesan (panjang wajar). */
    if (fields.name.length < 2 || fields.name.length > 100) {
      throw httpError(400, "Nama lengkap harus 2–100 karakter.");
    }
    if (fields.email.length > 200 || !EMAIL_RE.test(fields.email)) {
      throw httpError(400, "Format email tidak valid.");
    }
    if (fields.message.length < 5 || fields.message.length > 2000) {
      throw httpError(400, "Pesan harus 5–2000 karakter.");
    }
    if (fields.school.length > 120) {
      throw httpError(400, "Nama sekolah maksimal 120 karakter.");
    }

    /* --- 1 & 2: kirim email (Resend bila key ada, lalu/atau FormSubmit) --- */
    const resendKey = (process.env.RESEND_API_KEY || "").trim();
    const attempts = [];
    if (resendKey) {
      attempts.push(function () {
        return sendViaResend(fields, resendKey);
      });
    }
    attempts.push(function () {
      return sendViaFormSubmit(fields);
    });

    let emailed = false;
    for (let i = 0; i < attempts.length && !emailed; i++) {
      try {
        await attempts[i]();
        emailed = true;
      } catch (err) {
        /* provider berikutnya dicoba; jangan log isi pesan */
        console.warn("[contact] provider email ke-" + (i + 1) + " gagal.");
      }
    }

    if (emailed) {
      return send(res, 200, {
        ok: true,
        delivered: "email",
        message: "Pesan terkirim ke tim kami.",
      });
    }

    /* --- 3: fallback DB agar pesan tidak hilang --- */
    try {
      await saveToDb(fields);
      return send(res, 200, {
        ok: true,
        delivered: "db",
        message:
          "Pesan diterima dan kami simpan. Tim kami akan menindaklanjuti.",
      });
    } catch (dbErr) {
      // Kirim error standar (DB belum terhubung / server error).
      return sendApiError(res, dbErr);
    }
  } catch (err) {
    return sendApiError(res, err);
  }
};
