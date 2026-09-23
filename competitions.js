/* ============================================================
   CerdasBaca — Lomba Baca
   - Muat daftar lomba via GET /api/competitions
   - Daftar lomba via POST /api/competitions (action=register)
   Render memakai textContent / createElement (anti-XSS).
   ============================================================ */

(function () {
  "use strict";

  const gridEl = document.getElementById("comp-grid");
  const emptyEl = document.getElementById("comp-empty");
  const alertBox = document.getElementById("comp-alert");
  const alertText = document.getElementById("comp-alert-text");

  let loggedIn = false;

  function showAlert(message, isError) {
    if (!alertBox || !alertText) return;
    alertText.textContent = message;
    alertBox.hidden = false;
    if (isError) {
      alertBox.classList.remove("is-info");
      alertBox.style.background = "#fef2f2";
      alertBox.style.borderLeftColor = "#be123c";
      alertBox.style.color = "#9f1239";
    } else {
      alertBox.classList.add("is-info");
      alertBox.style.background = "";
      alertBox.style.borderLeftColor = "";
      alertBox.style.color = "";
    }
  }

  function hideAlert() {
    if (alertBox) alertBox.hidden = true;
  }

  async function fetchJson(url, options) {
    const res = await fetch(url, options);
    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      data = null;
    }
    return { ok: res.ok, status: res.status, data: data };
  }

  function errorMessage(fallback) {
    return fallback || "Terjadi kesalahan. Silakan coba lagi.";
  }

  const LEVEL_LABEL = {
    sd: "SD",
    smp: "SMP",
    sma: "SMA",
    semua: "Semua jenjang",
  };

  function formatDate(value) {
    if (!value) return "";
    try {
      return new Date(value).toLocaleDateString("id-ID", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    } catch (e) {
      return String(value);
    }
  }

  function renderCompetitions(items) {
    if (!gridEl) return;
    gridEl.innerHTML = "";

    const safeItems = Array.isArray(items) ? items : [];

    safeItems.forEach(function (item) {
      const li = document.createElement("li");
      li.className = "item-card";

      const tag = document.createElement("p");
      tag.className = "level-tag";
      tag.textContent = LEVEL_LABEL[item.level] || item.level || "Semua";

      const title = document.createElement("h3");
      title.textContent = item.title || "(Tanpa judul)";

      const desc = document.createElement("p");
      desc.className = "item-desc";
      desc.textContent = item.description || "";

      const rules = document.createElement("p");
      rules.className = "item-rules";
      rules.textContent = item.rules ? "Aturan: " + item.rules : "";

      const meta = document.createElement("p");
      meta.className = "item-meta";
      const parts = [];
      if (item.startDate) parts.push("Mulai " + formatDate(item.startDate));
      if (item.endDate) parts.push("Selesai " + formatDate(item.endDate));
      parts.push((Number(item.entriesCount) || 0) + " peserta");
      meta.textContent = parts.join(" · ");

      const action = document.createElement("button");
      action.type = "button";
      action.className = "btn " + (item.registered ? "btn-outline" : "btn-primary");
      action.textContent = item.registered ? "Sudah Terdaftar" : "Daftar Lomba";
      action.disabled = Boolean(item.registered);
      if (!item.registered) {
        action.addEventListener("click", function () {
          register(item.id, action);
        });
      }

      li.appendChild(tag);
      li.appendChild(title);
      if (item.description) li.appendChild(desc);
      if (item.rules) li.appendChild(rules);
      li.appendChild(meta);
      li.appendChild(action);
      gridEl.appendChild(li);
    });

    if (emptyEl) emptyEl.hidden = safeItems.length > 0;
  }

  async function register(competitionId, button) {
    hideAlert();
    if (button) button.disabled = true;
    try {
      const result = await fetchJson("/api/competitions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "register", competition_id: competitionId }),
      });
      if (result.ok) {
        showAlert("✅ Pendaftaran lomba berhasil!", false);
        await loadCompetitions();
      } else if (result.status === 401) {
        if (button) button.disabled = false;
        showAlert("Masuk terlebih dahulu untuk mendaftar lomba.", true);
      } else {
        showAlert(errorMessage(result.data && result.data.error), true);
        await loadCompetitions();
      }
    } catch (err) {
      showAlert("Tidak dapat terhubung ke server. Periksa koneksi Anda.", true);
      if (button) button.disabled = false;
    }
  }

  async function loadCompetitions() {
    try {
      const result = await fetchJson("/api/competitions");
      if (!result.ok) {
        renderCompetitions([]);
        showAlert(errorMessage(result.data && result.data.error), true);
        return;
      }
      renderCompetitions(result.data && result.data.items);
    } catch (err) {
      renderCompetitions([]);
      showAlert("Tidak dapat terhubung ke server. Periksa koneksi Anda.", true);
    }
  }

  async function checkSession() {
    try {
      const me = await fetchJson("/api/me");
      loggedIn = me.ok;
    } catch (err) {
      loggedIn = false;
    }
  }

  (async function boot() {
    await checkSession();
    await loadCompetitions();
  })();
})();
