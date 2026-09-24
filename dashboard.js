/* ============================================================
   CerdasBaca — Dashboard Siswa
   - Cek sesi via GET /api/me (401 → kembali ke beranda)
   - Muat & simpan progres baca via /api/progress
   - Keluar via POST /api/logout
   - Admin yang membuka dashboard siswa dialihkan ke panel admin
   ============================================================ */

(function () {
  "use strict";

  /* ---------- Elemen ---------- */
  const alertBox = document.getElementById("dash-alert");
  const alertText = document.getElementById("dash-alert-text");
  const nameEl = document.getElementById("user-name");
  const metaEl = document.getElementById("user-meta");
  const statTotal = document.getElementById("stat-total");
  const statFinished = document.getElementById("stat-finished");
  const statReading = document.getElementById("stat-reading");
  const statAvg = document.getElementById("stat-avg");
  const form = document.getElementById("progress-form");
  const formStatus = document.getElementById("progress-status");
  const listEl = document.getElementById("progress-list");
  const emptyEl = document.getElementById("progress-empty");
  const listCount = document.getElementById("list-count");
  const logoutBtn = document.getElementById("btn-logout");
  const testiForm = document.getElementById("testi-form");
  const testiStatus = document.getElementById("testi-status");

  const LEVEL_LABEL = {
    sd: "Jenjang SD",
    smp: "Jenjang SMP",
    sma: "Jenjang SMA",
  };

  const STATUS_LABEL = {
    reading: "Sedang dibaca",
    finished: "Selesai",
  };

  /* ---------- Helper ---------- */
  function showAlert(message, opts) {
    if (!alertBox || !alertText) return;
    alertText.textContent = message;
    alertBox.hidden = false;
    alertBox.classList.toggle("is-info", Boolean(opts && opts.info));
  }

  function hideAlert() {
    if (!alertBox) return;
    alertBox.hidden = true;
  }

  function setStatus(el, message, isError) {
    if (!el) return;
    el.textContent = message;
    el.classList.toggle("is-error", Boolean(isError));
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

  function formatDate(value) {
    if (!value) return "";
    try {
      return new Date(value).toLocaleDateString("id-ID", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    } catch (e) {
      return "";
    }
  }

  function clampInt(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  }

  /* ---------- Render ---------- */
  function renderUser(user) {
    if (nameEl) nameEl.textContent = user.name || "Pembaca!";
    if (metaEl) {
      const parts = [
        user.email,
        LEVEL_LABEL[user.level] || user.level,
        user.school,
      ].filter(Boolean);
      metaEl.textContent = parts.join(" · ");
    }
  }

  /* ---------- Testimoni ---------- */
  if (testiForm) {
    testiForm.addEventListener("submit", async function (event) {
      event.preventDefault();

      if (!testiForm.checkValidity()) {
        setStatus(testiStatus, "Testimoni harus 10–500 karakter.", true);
        testiForm.reportValidity();
        return;
      }

      const payload = {
        quote: String(testiForm.elements.quote.value || "").trim(),
        role_label: String(testiForm.elements.role_label.value || "lainnya"),
      };

      const button = testiForm.querySelector('button[type="submit"]');
      if (button) button.disabled = true;
      setStatus(testiStatus, "Mengirim…", false);

      try {
        const result = await fetchJson("/api/testimonials", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (result.ok) {
          setStatus(testiStatus, "✅ Testimoni terkirim. Menunggu persetujuan admin.", false);
          testiForm.reset();
        } else {
          setStatus(
            testiStatus,
            errorMessage(result.data && result.data.error),
            true
          );
        }
      } catch (err) {
        setStatus(
          testiStatus,
          "Tidak dapat terhubung ke server. Periksa koneksi Anda.",
          true
        );
      } finally {
        if (button) button.disabled = false;
      }
    });
  }

  function renderProgress(items) {
    if (!listEl) return;
    listEl.innerHTML = "";

    const safeItems = Array.isArray(items) ? items : [];

    safeItems.forEach(function (item) {
      const li = document.createElement("li");
      li.className = "pg-item";

      const top = document.createElement("div");
      top.className = "pg-item-top";

      const main = document.createElement("div");

      const title = document.createElement("p");
      title.className = "pg-item-title";
      title.textContent = item.title || "(Tanpa judul)";

      const meta = document.createElement("p");
      meta.className = "pg-item-meta";
      const statusLabel = STATUS_LABEL[item.status] || item.status || "";
      const percent = clampInt(item.percent, 0, 100, 0);
      const pages = clampInt(item.pages, 0, 100000, 0);
      const dateText = formatDate(item.readDate || item.updatedAt);
      meta.textContent = [percent + "%", pages + " halaman", dateText]
        .filter(Boolean)
        .join(" · ");

      main.appendChild(title);
      main.appendChild(meta);

      if (item.note) {
        const note = document.createElement("p");
        note.className = "pg-item-note";
        note.textContent = "Catatan: " + item.note;
        main.appendChild(note);
      }

      const badge = document.createElement("span");
      badge.className =
        "pg-badge " +
        (item.status === "finished" ? "pg-badge-finished" : "pg-badge-reading");
      badge.textContent =
        item.status === "finished" ? "Selesai" : statusLabel || "Membaca";

      top.appendChild(main);
      top.appendChild(badge);

      const bar = document.createElement("div");
      bar.className = "pg-bar";
      bar.setAttribute("aria-hidden", "true");
      const fill = document.createElement("span");
      fill.className = "pg-bar-fill";
      fill.style.width = percent + "%";
      bar.appendChild(fill);

      li.appendChild(top);
      li.appendChild(bar);
      listEl.appendChild(li);
    });

    if (emptyEl) emptyEl.hidden = safeItems.length > 0;
    if (listCount) {
      listCount.textContent = safeItems.length
        ? safeItems.length + " judul tersimpan."
        : "Belum ada catatan.";
    }

    // Statistik
    const total = safeItems.length;
    const finished = safeItems.filter(function (i) {
      return i.status === "finished";
    }).length;
    const reading = total - finished;
    const avg = total
      ? Math.round(
          safeItems.reduce(function (sum, i) {
            return sum + clampInt(i.percent, 0, 100, 0);
          }, 0) / total
        )
      : 0;

    if (statTotal) statTotal.textContent = String(total);
    if (statFinished) statFinished.textContent = String(finished);
    if (statReading) statReading.textContent = String(reading);
    if (statAvg) statAvg.textContent = avg + "%";
  }

  /* ---------- Muat data ---------- */
  async function loadProgress() {
    try {
      const result = await fetchJson("/api/progress");
      if (!result.ok) {
        renderProgress([]);
        showAlert(
          errorMessage(
            result.data && result.data.error
          )
        );
        return;
      }
      hideAlert();
      renderProgress(result.data && result.data.items);
    } catch (err) {
      renderProgress([]);
      showAlert("Tidak dapat terhubung ke server. Periksa koneksi Anda.");
    }
  }

  async function boot() {
    let me;
    try {
      me = await fetchJson("/api/me");
    } catch (err) {
      showAlert("Tidak dapat terhubung ke server. Periksa koneksi Anda.");
      if (metaEl) metaEl.textContent = "Gagal memuat data akun.";
      return;
    }

    if (me.status === 401) {
      showAlert("Anda belum masuk. Mengalihkan ke halaman beranda…", {
        info: true,
      });
      if (metaEl) metaEl.textContent = "Sesi tidak ditemukan.";
      window.setTimeout(function () {
        window.location.replace("index.html");
      }, 2000);
      return;
    }

    if (!me.ok) {
      if (metaEl) metaEl.textContent = "Gagal memuat data akun.";
      showAlert(
        errorMessage(
          me.data && me.data.error
        )
      );
      return;
    }

    hideAlert();
    const user = me.data.user || {};
    // Admin tidak pakai dashboard siswa — langsung ke panel kelola.
    if (user.role === "admin") {
      window.location.replace("admin.html");
      return;
    }
    renderUser(user);
    await loadProgress();
  }

  /* ---------- Simpan bacaan ---------- */
  if (form) {
    form.addEventListener("submit", async function (event) {
      event.preventDefault();

      if (!form.checkValidity()) {
        setStatus(formStatus, "Mohon lengkapi kolom judul terlebih dahulu.", true);
        form.reportValidity();
        return;
      }

      const statusValue =
        (form.elements.status && form.elements.status.value) || "reading";
      const percentValue =
        statusValue === "finished"
          ? 100
          : clampInt(form.elements.percent.value, 0, 100, 0);
      const pagesValue = clampInt(form.elements.pages.value, 0, 100000, 0);
      const readDateValue = form.elements.read_date
        ? String(form.elements.read_date.value || "").trim()
        : "";
      const noteValue = form.elements.note
        ? String(form.elements.note.value || "").trim().slice(0, 1000)
        : "";

      const payload = {
        title: String(form.elements.title.value || "").trim(),
        status: statusValue,
        percent: percentValue,
        pages: pagesValue,
        read_date: readDateValue,
        note: noteValue,
      };

      const button = form.querySelector('button[type="submit"]');
      if (button) button.disabled = true;
      setStatus(formStatus, "Menyimpan…", false);

      try {
        const result = await fetchJson("/api/progress", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (result.ok) {
          setStatus(formStatus, "✅ Tersimpan.", false);
          form.reset();
          await loadProgress();
        } else {
          setStatus(
            formStatus,
            errorMessage(result.data && result.data.error),
            true
          );
        }
      } catch (err) {
        setStatus(
          formStatus,
          "Tidak dapat terhubung ke server. Periksa koneksi Anda.",
          true
        );
      } finally {
        if (button) button.disabled = false;
      }
    });
  }

  /* ---------- Keluar ---------- */
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async function () {
      logoutBtn.disabled = true;
      try {
        await fetchJson("/api/logout", { method: "POST" });
      } catch (err) {
        /* cookie tetap dibersihkan bila server sempat merespons */
      }
      window.location.replace("index.html");
    });
  }

  boot();
})();
