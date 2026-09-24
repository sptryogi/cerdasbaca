/* ============================================================
   CerdasBaca — Panel Admin
   - Guard role=admin via GET /api/me (redirect bila bukan admin)
   - Statistik via GET /api/admin/stats
   - CRUD buku via /api/books (POST/PUT/DELETE) + katalog
   - Daftar kelas via GET /api/classes, tambah via POST /api/classes
   - Daftar lomba via GET /api/competitions, tambah via POST /api/competitions
   - Monitoring jurnal siswa via GET /api/progress?admin=1
   - Moderasi testimoni via GET /api/testimonials?admin=1 + PUT
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
  const bookFormTitle = document.getElementById("book-form-title");
  const bookSubmitBtn = document.getElementById("book-submit-btn");
  const bookCancelEditBtn = document.getElementById("book-cancel-edit");
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

  const classListEl = document.getElementById("class-list");
  const classListCount = document.getElementById("classlist-count");
  const classListEmpty = document.getElementById("classlist-empty");

  const compListEl = document.getElementById("comp-list");
  const compListCount = document.getElementById("complist-count");
  const compListEmpty = document.getElementById("complist-empty");

  const jurnalListEl = document.getElementById("jurnal-list");
  const jurnalListCount = document.getElementById("jurnallist-count");
  const jurnalListEmpty = document.getElementById("jurnallist-empty");

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

  // Fetch JSON dengan timeout (AbortController) agar UI tidak hang.
  // Default 8 dtk; bisa di-override via options.timeoutMs (dihapus sebelum fetch).
  async function fetchJson(url, options) {
    const opts = options || {};
    const timeoutMs = opts.timeoutMs || 8000;
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller
      ? setTimeout(function () {
          controller.abort();
        }, timeoutMs)
      : null;
    const finalOpts = Object.assign({}, opts);
    delete finalOpts.timeoutMs;
    if (controller) finalOpts.signal = controller.signal;
    try {
      const res = await fetch(url, finalOpts);
      let data = null;
      try {
        data = await res.json();
      } catch (e) {
        // AbortError saat baca body = timeout → jangan telan jadi data:null
        // (ok:true + data:null membuat boot TypeError di me.data.user).
        if (e && e.name === "AbortError") throw e;
        data = null;
      }
      return { ok: res.ok, status: res.status, data: data };
    } catch (err) {
      if (err && err.name === "AbortError") {
        return { ok: false, status: 0, data: { error: "Timeout — server lambat. Coba lagi." } };
      }
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function errorMessage(fallback) {
    return fallback || "Terjadi kesalahan. Silakan coba lagi.";
  }

  function clampInt(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  }

  /** Potong teks panjang (catatan jurnal) agar rapi di daftar. */
  function truncateText(value, max) {
    const s = String(value || "");
    return s.length > max ? s.slice(0, max - 1) + "…" : s;
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

  /* ---------- Daftar kelas ---------- */
  async function loadClasses() {
    if (!classListEl) return;
    try {
      const result = await fetchJson("/api/classes");
      if (!result.ok) {
        classListEl.innerHTML = "";
        if (classListCount) classListCount.textContent = errorMessage(result.data && result.data.error);
        return;
      }
      const items = Array.isArray(result.data && result.data.items) ? result.data.items : [];
      classListEl.innerHTML = "";

      items.forEach(function (item) {
        const li = document.createElement("li");
        li.className = "admin-item";

        const title = document.createElement("p");
        title.className = "testi-quote";
        title.textContent = item.title || "(Tanpa judul)";

        const meta = document.createElement("p");
        meta.className = "admin-meta";
        meta.textContent = [
          item.level || "",
          item.scheduleText || "Tanpa jadwal",
          item.teacherName ? "Pengajar: " + item.teacherName : "",
          item.capacity ? "Kuota: " + item.capacity : "",
          typeof item.seatsTaken === "number" ? item.seatsTaken + " terdaftar" : "",
        ]
          .filter(Boolean)
          .join(" · ");

        li.appendChild(title);
        li.appendChild(meta);
        classListEl.appendChild(li);
      });

      if (classListEmpty) classListEmpty.hidden = items.length > 0;
      if (classListCount) {
        classListCount.textContent = items.length
          ? items.length + " kelas aktif."
          : "Belum ada kelas.";
      }
    } catch (err) {
      if (classListCount) classListCount.textContent = "Tidak dapat memuat daftar kelas.";
    }
  }

  /* ---------- Daftar lomba ---------- */
  async function loadCompetitions() {
    if (!compListEl) return;
    try {
      const result = await fetchJson("/api/competitions");
      if (!result.ok) {
        compListEl.innerHTML = "";
        if (compListCount) compListCount.textContent = errorMessage(result.data && result.data.error);
        return;
      }
      const items = Array.isArray(result.data && result.data.items) ? result.data.items : [];
      compListEl.innerHTML = "";

      items.forEach(function (item) {
        const li = document.createElement("li");
        li.className = "admin-item";

        const title = document.createElement("p");
        title.className = "testi-quote";
        title.textContent = item.title || "(Tanpa judul)";

        const meta = document.createElement("p");
        meta.className = "admin-meta";
        const dates = [item.startDate, item.endDate].filter(Boolean).join(" → ");
        meta.textContent = [item.level || "", dates || "Tanpa tanggal", item.entriesCount ? item.entriesCount + " peserta" : ""]
          .filter(Boolean)
          .join(" · ");

        li.appendChild(title);
        li.appendChild(meta);
        compListEl.appendChild(li);
      });

      if (compListEmpty) compListEmpty.hidden = items.length > 0;
      if (compListCount) {
        compListCount.textContent = items.length
          ? items.length + " lomba terdaftar."
          : "Belum ada lomba.";
      }
    } catch (err) {
      if (compListCount) compListCount.textContent = "Tidak dapat memuat daftar lomba.";
    }
  }

  /* ---------- Monitoring jurnal siswa ---------- */
  const JURNAL_STATUS_LABEL = {
    reading: "Membaca",
    finished: "Selesai",
  };

  async function loadJurnal() {
    if (!jurnalListEl) return;
    try {
      const result = await fetchJson("/api/progress?admin=1");
      if (!result.ok) {
        jurnalListEl.innerHTML = "";
        if (jurnalListEmpty) jurnalListEmpty.hidden = true;
        if (jurnalListCount) {
          if (result.status === 401) {
            jurnalListCount.textContent = "Silakan masuk kembali untuk melihat jurnal.";
          } else if (result.status === 403) {
            jurnalListCount.textContent = "Akses ditolak: khusus admin.";
          } else {
            jurnalListCount.textContent = errorMessage(result.data && result.data.error);
          }
        }
        return;
      }
      const items = Array.isArray(result.data && result.data.items) ? result.data.items : [];
      jurnalListEl.innerHTML = "";

      items.forEach(function (item) {
        const li = document.createElement("li");
        li.className = "admin-item";

        const who = document.createElement("p");
        who.className = "testi-quote";
        who.textContent = [
          item.userName || item.userEmail || "Siswa",
          item.title || "(Tanpa judul)",
        ].join(" — ");

        const badge = document.createElement("span");
        badge.className = "badge " + (item.status === "finished" ? "badge-approved" : "badge-pending");
        badge.textContent = JURNAL_STATUS_LABEL[item.status] || item.status || "";

        const meta = document.createElement("p");
        meta.className = "admin-meta";
        meta.textContent = [
          item.userEmail || "",
          Number(item.percent) + "%",
          item.pages ? item.pages + " hal" : "",
          item.readDate || "",
        ]
          .filter(Boolean)
          .join(" · ");

        li.appendChild(who);
        li.appendChild(badge);
        li.appendChild(meta);

        if (item.note) {
          const note = document.createElement("p");
          note.className = "admin-meta";
          note.textContent = truncateText(item.note, 140);
          li.appendChild(note);
        }

        jurnalListEl.appendChild(li);
      });

      if (jurnalListEmpty) jurnalListEmpty.hidden = items.length > 0;
      if (jurnalListCount) {
        jurnalListCount.textContent = items.length
          ? items.length + " catatan jurnal (maks. 200 terbaru)."
          : "Belum ada catatan jurnal.";
      }
    } catch (err) {
      if (jurnalListCount) jurnalListCount.textContent = "Tidak dapat memuat jurnal siswa.";
    }
  }

  /* ---------- Katalog buku ---------- */
  let editingBookId = null;

  /** Mode tambah: kosongkan form & sembunyikan tombol batal. */
  function resetBookForm() {
    editingBookId = null;
    if (!bookForm) return;
    bookForm.reset();
    bookForm.elements.cover_emoji.value = "📘";
    bookForm.elements.cover_color.value = "#4361ee";
    bookForm.elements.level.value = "semua";
    bookForm.elements.pages.value = "0";
    if (bookFormTitle) bookFormTitle.textContent = "Tambah Buku";
    if (bookSubmitBtn) bookSubmitBtn.textContent = "Simpan Buku";
    if (bookCancelEditBtn) bookCancelEditBtn.hidden = true;
    setStatus(bookStatus, "", false);
  }

  /** Mode edit: isi form dari data buku lalu tunggu submit → PUT. */
  function startEditBook(book) {
    if (!bookForm || !book) return;
    editingBookId = book.id;
    bookForm.elements.title.value = book.title || "";
    bookForm.elements.author.value = book.author || "";
    bookForm.elements.description.value = book.description || "";
    bookForm.elements.level.value = book.level || "semua";
    bookForm.elements.pages.value = String(book.pages || 0);
    bookForm.elements.cover_emoji.value = book.coverEmoji || "📘";
    bookForm.elements.cover_color.value = book.coverColor || "#4361ee";
    if (bookFormTitle) bookFormTitle.textContent = "Ubah Buku";
    if (bookSubmitBtn) bookSubmitBtn.textContent = "Simpan Perubahan";
    if (bookCancelEditBtn) bookCancelEditBtn.hidden = false;
    setStatus(bookStatus, "Mode ubah: " + (book.title || "buku tanpa judul"), false);
    bookForm.scrollIntoView({ block: "nearest" });
    bookForm.elements.title.focus();
  }

  if (bookCancelEditBtn) {
    bookCancelEditBtn.addEventListener("click", function () {
      resetBookForm();
    });
  }

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

        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "btn btn-outline";
        editBtn.textContent = "Edit";
        editBtn.addEventListener("click", function () {
          startEditBook(book);
        });
        actions.appendChild(editBtn);

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
        // Bila buku yang sedang diedit ikut terhapus → kembali ke mode tambah
        if (editingBookId === id) resetBookForm();
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

      const isEdit = editingBookId !== null;
      if (isEdit) {
        payload.id = editingBookId;
      }

      const button = bookForm.querySelector('button[type="submit"]');
      if (button) button.disabled = true;
      setStatus(bookStatus, "Menyimpan…", false);

      try {
        const result = await postJson("/api/books", payload, isEdit ? "PUT" : "POST");
        if (result.ok) {
          setStatus(bookStatus, isEdit ? "✅ Buku diperbarui." : "✅ Buku tersimpan.", false);
          resetBookForm();
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
          await Promise.all([loadClasses(), loadStats()]);
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
          await Promise.all([loadCompetitions(), loadStats()]);
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
      const result = await fetchJson("/api/testimonials?admin=1");
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

    await Promise.all([
      loadStats(),
      loadBooks(),
      loadTestimonials(),
      loadClasses(),
      loadCompetitions(),
      loadJurnal(),
    ]);
  }

  if (logoutBtn) {
    logoutBtn.addEventListener("click", function () {
      if (logoutBtn.disabled) return;
      logoutBtn.disabled = true;
      // keepalive: request boleh jalan setelah navigasi; tidak menunggu response
      try {
        fetch("/api/logout", {
          method: "POST",
          keepalive: true,
          headers: { "Content-Type": "application/json" },
        }).catch(function () {});
      } catch (e) {}
      // redirect langsung — tidak menunggu API
      window.location.replace("index.html");
    });
  }

  boot();
})();
