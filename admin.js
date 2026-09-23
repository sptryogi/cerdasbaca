/* ============================================================
   CerdasBaca — Panel Admin
   - Guard role=admin via GET /api/me (redirect bila bukan admin)
   - Statistik via GET /api/admin/stats
   - CRUD buku via /api/books (POST/PUT/DELETE)
   - Kelas & lomba via POST /api/classes, /api/competitions
   - Moderasi testimoni via GET /api/testimonials/admin + PUT
   Render memakai textContent / createElement (anti-XSS).
   ============================================================ */

(function () {
  "use strict";

  /* ---------- Elemen ---------- */
  const alertBox = document.getElementById("admin-alert");
  const alertText = document.getElementById("admin-alert-text");
  const metaEl = document.getElementById("admin-meta");
  const statsWrap = document.getElementById("admin-stats");
  const logoutBtn = document.getElementById("btn-logout");

  const bookForm = document.getElementById("book-form");
  const bookStatus = document.getElementById("book-status");
  const classForm = document.getElementById("class-form");
  const classStatus = document.getElementById("class-status");
  const compForm = document.getElementById("comp-form");
  const compStatus = document.getElementById("comp-status");

  const bookListEl = document.getElementById("book-list");
  const bookListCount = document.getElementById("booklist-count");
  const bookListEmpty = document.getElementById("booklist-empty");

  const testiListEl = document.getElementById("testi-list");
  const testiCount = document.getElementById("testi-count");
  const testiEmpty = document.getElementById("testi-empty");

  const STAT_IDS = {
    users: "st-users",
    books: "st-books",
    classes: "st-classes",
    competitions: "st-competitions",
    enrollments: "st-enrollments",
    competitionEntries: "st-entries",
    testimonials: "st-testimonials",
    testimonialsPending: "st-pending",
  };

  /* ---------- Helper ---------- */
  function showAlert(message) {
    if (!alertBox || !alertText) return;
    alertText.textContent = message;
    alertBox.hidden = false;
  }

  function hideAlert() {
    if (alertBox) alertBox.hidden = true;
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

  function clampInt(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  }

  async function postJson(url, payload, method) {
    return fetchJson(url, {
      method: method || "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  /* ---------- Statistik ---------- */
  async function loadStats() {
    try {
      const result = await fetchJson("/api/admin/stats");
      if (!result.ok) {
        if (statsWrap) statsWrap.hidden = true;
        return;
      }
      const stats = (result.data && result.data.stats) || {};
      Object.keys(STAT_IDS).forEach(function (key) {
        const el = document.getElementById(STAT_IDS[key]);
        if (el) el.textContent = String(stats[key] || 0);
      });
      if (statsWrap) statsWrap.hidden = false;
    } catch (err) {
      if (statsWrap) statsWrap.hidden = true;
    }
  }

  /* ---------- Katalog buku ---------- */
  async function loadBooks() {
    if (!bookListEl) return;
    try {
      const result = await fetchJson("/api/books");
      if (!result.ok) {
        bookListEl.innerHTML = "";
        if (bookListCount) bookListCount.textContent = errorMessage(result.data && result.data.error);
        return;
      }
      const items = Array.isArray(result.data && result.data.items) ? result.data.items : [];
      bookListEl.innerHTML = "";

      items.forEach(function (book) {
        const li = document.createElement("li");
        li.className = "admin-item";

        const title = document.createElement("p");
        title.className = "testi-quote";
        title.textContent = (book.coverEmoji || "📘") + " " + (book.title || "(Tanpa judul)");

        const meta = document.createElement("p");
        meta.className = "admin-meta";
        meta.textContent = [
          book.author || "Tanpa penulis",
          book.level || "",
          book.pages ? book.pages + " hal" : "",
        ]
          .filter(Boolean)
          .join(" · ");

        const actions = document.createElement("div");
        actions.className = "admin-actions";

        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "btn btn-outline";
        delBtn.textContent = "Hapus";
        delBtn.addEventListener("click", function () {
          deleteBook(book.id, delBtn);
        });
        actions.appendChild(delBtn);

        li.appendChild(title);
        li.appendChild(meta);
        li.appendChild(actions);
        bookListEl.appendChild(li);
      });

      if (bookListEmpty) bookListEmpty.hidden = items.length > 0;
      if (bookListCount) {
        bookListCount.textContent = items.length
          ? items.length + " judul di katalog."
          : "Katalog kosong.";
      }
    } catch (err) {
      if (bookListCount) bookListCount.textContent = "Tidak dapat memuat katalog.";
    }
  }

  async function deleteBook(id, button) {
    if (!window.confirm("Hapus buku ini dari katalog?")) return;
    if (button) button.disabled = true;
    try {
      const result = await fetchJson("/api/books?id=" + encodeURIComponent(id), {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: id }),
      });
      if (result.ok) {
        await loadBooks();
        await loadStats();
      } else {
        showAlert(errorMessage(result.data && result.data.error));
        if (button) button.disabled = false;
      }
    } catch (err) {
      showAlert("Tidak dapat terhubung ke server.");
      if (button) button.disabled = false;
    }
  }

  if (bookForm) {
    bookForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      if (!bookForm.checkValidity()) {
        setStatus(bookStatus, "Mohon lengkapi kolom yang wajib diisi.", true);
        bookForm.reportValidity();
        return;
      }

      const payload = {
        title: String(bookForm.elements.title.value || "").trim(),
        author: String(bookForm.elements.author.value || "").trim(),
        description: String(bookForm.elements.description.value || "").trim(),
        level: String(bookForm.elements.level.value || "semua"),
        pages: clampInt(bookForm.elements.pages.value, 0, 100000, 0),
        cover_emoji: String(bookForm.elements.cover_emoji.value || "📘").trim(),
        cover_color: String(bookForm.elements.cover_color.value || "#4361ee").trim(),
      };

      const button = bookForm.querySelector('button[type="submit"]');
      if (button) button.disabled = true;
      setStatus(bookStatus, "Menyimpan…", false);

      try {
        const result = await postJson("/api/books", payload, "POST");
        if (result.ok) {
          setStatus(bookStatus, "✅ Buku tersimpan.", false);
          bookForm.reset();
          bookForm.elements.cover_emoji.value = "📘";
          bookForm.elements.cover_color.value = "#4361ee";
          bookForm.elements.level.value = "semua";
          bookForm.elements.pages.value = "0";
          await loadBooks();
          await loadStats();
        } else {
          setStatus(bookStatus, errorMessage(result.data && result.data.error), true);
        }
      } catch (err) {
        setStatus(bookStatus, "Tidak dapat terhubung ke server.", true);
      } finally {
        if (button) button.disabled = false;
      }
    });
  }

  /* ---------- Kelas ---------- */
  if (classForm) {
    classForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      if (!classForm.checkValidity()) {
        setStatus(classStatus, "Mohon lengkapi kolom yang wajib diisi.", true);
        classForm.reportValidity();
        return;
      }

      const payload = {
        title: String(classForm.elements.title.value || "").trim(),
        description: String(classForm.elements.description.value || "").trim(),
        level: String(classForm.elements.level.value || "semua"),
        schedule_text: String(classForm.elements.schedule_text.value || "").trim(),
        capacity: clampInt(classForm.elements.capacity.value, 1, 500, 20),
        teacher_name: String(classForm.elements.teacher_name.value || "").trim(),
      };

      const button = classForm.querySelector('button[type="submit"]');
      if (button) button.disabled = true;
      setStatus(classStatus, "Menyimpan…", false);

      try {
        const result = await postJson("/api/classes", payload, "POST");
        if (result.ok) {
          setStatus(classStatus, "✅ Kelas tersimpan.", false);
          classForm.reset();
          classForm.elements.level.value = "semua";
          classForm.elements.capacity.value = "20";
          await loadStats();
        } else {
          setStatus(classStatus, errorMessage(result.data && result.data.error), true);
        }
      } catch (err) {
        setStatus(classStatus, "Tidak dapat terhubung ke server.", true);
      } finally {
        if (button) button.disabled = false;
      }
    });
  }

  /* ---------- Lomba ---------- */
  if (compForm) {
    compForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      if (!compForm.checkValidity()) {
        setStatus(compStatus, "Mohon lengkapi kolom yang wajib diisi.", true);
        compForm.reportValidity();
        return;
      }

      const payload = {
        title: String(compForm.elements.title.value || "").trim(),
        description: String(compForm.elements.description.value || "").trim(),
        rules: String(compForm.elements.rules.value || "").trim(),
        level: String(compForm.elements.level.value || "semua"),
        start_date: String(compForm.elements.start_date.value || "").trim(),
        end_date: String(compForm.elements.end_date.value || "").trim(),
      };

      const button = compForm.querySelector('button[type="submit"]');
      if (button) button.disabled = true;
      setStatus(compStatus, "Menyimpan…", false);

      try {
        const result = await postJson("/api/competitions", payload, "POST");
        if (result.ok) {
          setStatus(compStatus, "✅ Lomba tersimpan.", false);
          compForm.reset();
          compForm.elements.level.value = "semua";
          await loadStats();
        } else {
          setStatus(compStatus, errorMessage(result.data && result.data.error), true);
        }
      } catch (err) {
        setStatus(compStatus, "Tidak dapat terhubung ke server.", true);
      } finally {
        if (button) button.disabled = false;
      }
    });
  }

  /* ---------- Testimoni ---------- */
  const STATUS_BADGE = {
    pending: "badge-pending",
    approved: "badge-approved",
    rejected: "badge-rejected",
  };

  const STATUS_LABEL = {
    pending: "Pending",
    approved: "Disetujui",
    rejected: "Ditolak",
  };

  async function loadTestimonials() {
    if (!testiListEl) return;
    try {
      const result = await fetchJson("/api/testimonials/admin");
      if (!result.ok) {
        testiListEl.innerHTML = "";
        if (testiCount) testiCount.textContent = errorMessage(result.data && result.data.error);
        return;
      }
      const items = Array.isArray(result.data && result.data.items) ? result.data.items : [];
      testiListEl.innerHTML = "";

      items.forEach(function (item) {
        const li = document.createElement("li");
        li.className = "testi-item";

        const quote = document.createElement("p");
        quote.className = "testi-quote";
        quote.textContent = "“" + (item.quote || "") + "”";

        const meta = document.createElement("p");
        meta.className = "testi-meta";
        meta.textContent = [
          item.name || "Tanpa nama",
          item.roleLabel || "",
          item.status ? STATUS_LABEL[item.status] || item.status : "",
        ]
          .filter(Boolean)
          .join(" · ");

        const badge = document.createElement("span");
        badge.className = "badge " + (STATUS_BADGE[item.status] || "");
        badge.textContent = STATUS_LABEL[item.status] || item.status || "";

        const actions = document.createElement("div");
        actions.className = "testi-actions";

        if (item.status !== "approved") {
          const approveBtn = document.createElement("button");
          approveBtn.type = "button";
          approveBtn.className = "btn btn-primary";
          approveBtn.textContent = "Setujui";
          approveBtn.addEventListener("click", function () {
            moderate(item.id, "approve", approveBtn);
          });
          actions.appendChild(approveBtn);
        }

        if (item.status !== "rejected") {
          const rejectBtn = document.createElement("button");
          rejectBtn.type = "button";
          rejectBtn.className = "btn btn-outline";
          rejectBtn.textContent = "Tolak";
          rejectBtn.addEventListener("click", function () {
            moderate(item.id, "reject", rejectBtn);
          });
          actions.appendChild(rejectBtn);
        }

        li.appendChild(quote);
        li.appendChild(meta);
        li.appendChild(badge);
        li.appendChild(actions);
        testiListEl.appendChild(li);
      });

      if (testiEmpty) testiEmpty.hidden = items.length > 0;
      if (testiCount) {
        testiCount.textContent = items.length
          ? items.length + " testimoni."
          : "Belum ada testimoni masuk.";
      }
    } catch (err) {
      if (testiCount) testiCount.textContent = "Tidak dapat memuat testimoni.";
    }
  }

  async function moderate(id, action, button) {
    if (button) button.disabled = true;
    try {
      const result = await fetchJson("/api/testimonials", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: id, action: action }),
      });
      if (result.ok) {
        await loadTestimonials();
        await loadStats();
      } else {
        showAlert(errorMessage(result.data && result.data.error));
        if (button) button.disabled = false;
      }
    } catch (err) {
      showAlert("Tidak dapat terhubung ke server.");
      if (button) button.disabled = false;
    }
  }

  /* ---------- Boot ---------- */
  async function boot() {
    let me;
    try {
      me = await fetchJson("/api/me");
    } catch (err) {
      showAlert("Tidak dapat terhubung ke server. Periksa koneksi Anda.");
      if (metaEl) metaEl.textContent = "Gagal memuat data admin.";
      return;
    }

    if (me.status === 401) {
      showAlert("Anda belum masuk. Mengalihkan ke beranda…");
      if (metaEl) metaEl.textContent = "Sesi tidak ditemukan.";
      window.setTimeout(function () {
        window.location.replace("index.html");
      }, 2000);
      return;
    }

    if (!me.ok) {
      if (metaEl) metaEl.textContent = "Gagal memuat data admin.";
      showAlert(errorMessage(me.data && me.data.error));
      return;
    }

    const user = me.data.user || {};
    if (user.role !== "admin") {
      showAlert("Akses ditolak: khusus admin. Mengalihkan ke dashboard…");
      if (metaEl) metaEl.textContent = "Anda bukan admin.";
      window.setTimeout(function () {
        window.location.replace("dashboard.html");
      }, 2000);
      return;
    }

    hideAlert();
    if (metaEl) metaEl.textContent = [user.name, user.email].filter(Boolean).join(" · ");

    await Promise.all([loadStats(), loadBooks(), loadTestimonials()]);
  }

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
