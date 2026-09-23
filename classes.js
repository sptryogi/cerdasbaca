/* ============================================================
   CerdasBaca — Kelas Membaca
   - Muat daftar kelas via GET /api/classes
   - Daftar / batal via POST (action=enroll) & DELETE /api/classes
   Render memakai textContent / createElement (anti-XSS).
   ============================================================ */

(function () {
  "use strict";

  const gridEl = document.getElementById("class-grid");
  const emptyEl = document.getElementById("class-empty");
  const alertBox = document.getElementById("class-alert");
  const alertText = document.getElementById("class-alert-text");

  let loggedIn = false;

  function showAlert(message, isError) {
    if (!alertBox || !alertText) return;
    alertText.textContent = message;
    alertBox.hidden = false;
    alertBox.classList.toggle("is-info", !isError);
    alertBox.classList.toggle("is-error", Boolean(isError));
    if (isError) {
      alertBox.hidden = false;
      alertBox.classList.remove("is-info");
      alertBox.style.background = "#fef2f2";
      alertBox.style.borderLeftColor = "#be123c";
      alertBox.style.color = "#9f1239";
    } else {
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

  function renderClasses(items) {
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

      const meta = document.createElement("p");
      meta.className = "item-meta";
      const seats = Number(item.seatsTaken) || 0;
      const capacity = Number(item.capacity) || 0;
      const parts = [];
      if (item.scheduleText) parts.push("📅 " + item.scheduleText);
      if (item.teacherName) parts.push("👩‍🏫 " + item.teacherName);
      parts.push(seats + "/" + capacity + " peserta");
      meta.textContent = parts.join(" · ");

      const action = document.createElement("button");
      action.type = "button";
      action.className = "btn " + (item.enrolled ? "btn-outline" : "btn-primary");

      if (item.enrolled) {
        action.textContent = "Batal Ikut";
        action.addEventListener("click", function () {
          enrollToggle(item.id, false, action);
        });
      } else {
        const full = capacity > 0 && seats >= capacity;
        action.textContent = full ? "Kelas Penuh" : "Ikuti Kelas";
        action.disabled = full;
        action.addEventListener("click", function () {
          enrollToggle(item.id, true, action);
        });
      }

      li.appendChild(tag);
      li.appendChild(title);
      if (item.description) li.appendChild(desc);
      li.appendChild(meta);
      li.appendChild(action);
      gridEl.appendChild(li);
    });

    if (emptyEl) emptyEl.hidden = safeItems.length > 0;
  }

  async function enrollToggle(classId, isEnroll, button) {
    hideAlert();
    if (button) button.disabled = true;
    try {
      const options = {
        method: isEnroll ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: isEnroll ? "enroll" : "unenroll",
          class_id: classId,
        }),
      };
      const qs = "?class_id=" + encodeURIComponent(classId);
      const result = await fetchJson("/api/classes" + qs, options);
      if (result.ok) {
        showAlert(isEnroll ? "✅ Berhasil mendaftar kelas." : "Pendaftaran dibatalkan.", false);
        await loadClasses();
      } else if (result.status === 401) {
        if (button) button.disabled = false;
        showAlert("Masuk terlebih dahulu untuk ikut kelas.", true);
      } else {
        showAlert(errorMessage(result.data && result.data.error), true);
        await loadClasses();
      }
    } catch (err) {
      showAlert("Tidak dapat terhubung ke server. Periksa koneksi Anda.", true);
      if (button) button.disabled = false;
    }
  }

  async function loadClasses() {
    try {
      const result = await fetchJson("/api/classes");
      if (!result.ok) {
        renderClasses([]);
        showAlert(errorMessage(result.data && result.data.error), true);
        return;
      }
      renderClasses(result.data && result.data.items);
    } catch (err) {
      renderClasses([]);
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
    await loadClasses();
  })();
})();
