/* ============================================================
   CerdasBaca — Perpustakaan Digital
   - Muat katalog via GET /api/books
   - Filter jenjang (query ?level=)
   - Rating bintang 1–5 via POST /api/ratings (wajib login)
   Render memakai textContent / createElement (anti-XSS).
   ============================================================ */

(function () {
  "use strict";

  const gridEl = document.getElementById("book-grid");
  const emptyEl = document.getElementById("book-empty");
  const countEl = document.getElementById("book-count");
  const alertBox = document.getElementById("lib-alert");
  const alertText = document.getElementById("lib-alert-text");
  const filterEl = document.getElementById("filter-level");

  let loggedIn = false;

  function showAlert(message) {
    if (!alertBox || !alertText) return;
    alertText.textContent = message;
    alertBox.hidden = false;
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
    semua: "Semua level",
  };

  function starLabel(n) {
    return "Bintang " + n + " dari 5";
  }

  function renderStars(book) {
    const wrap = document.createElement("div");
    wrap.className = "rating";
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", "Rating buku " + (book.title || ""));

    const my = Number(book.myRating) || 0;
    const avg = Number(book.avgRating) || 0;

    for (let n = 1; n <= 5; n++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "rating-star";
      btn.textContent = n <= Math.round(my || avg) ? "★" : "☆";
      btn.setAttribute("aria-label", starLabel(n));
      if (my && n <= my) btn.classList.add("is-active");

      if (loggedIn) {
        btn.addEventListener("click", function () {
          rateBook(book.id, n, btn);
        });
      } else {
        btn.disabled = true;
        btn.title = "Masuk untuk memberi rating";
      }
      wrap.appendChild(btn);
    }

    const meta = document.createElement("span");
    meta.className = "rating-meta";
    meta.textContent =
      (avg ? avg.toFixed(1) : "–") +
      " · " +
      (Number(book.ratingCount) || 0) +
      " rating";
    wrap.appendChild(meta);

    return wrap;
  }

  async function rateBook(bookId, rating, btn) {
    hideAlert();
    const buttons = gridEl ? gridEl.querySelectorAll(".rating-star") : [];
    buttons.forEach(function (b) {
      b.disabled = true;
    });
    try {
      const result = await fetchJson("/api/ratings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ book_id: bookId, rating: rating }),
      });
      if (result.ok) {
        await loadBooks();
      } else if (result.status === 401) {
        buttons.forEach(function (b) {
          b.disabled = false;
        });
        showAlert("Masuk terlebih dahulu untuk memberi rating.");
      } else {
        showAlert(errorMessage(result.data && result.data.error));
        await loadBooks();
      }
    } catch (err) {
      showAlert("Tidak dapat terhubung ke server. Periksa koneksi Anda.");
      await loadBooks();
    }
  }

  function renderBooks(items) {
    if (!gridEl) return;
    gridEl.innerHTML = "";

    const safeItems = Array.isArray(items) ? items : [];

    safeItems.forEach(function (book) {
      const li = document.createElement("li");
      li.className = "book-card";

      const cover = document.createElement("div");
      cover.className = "book-cover";
      cover.style.background = book.coverColor || "#4361ee";
      cover.setAttribute("aria-hidden", "true");
      cover.textContent = book.coverEmoji || "📘";

      const body = document.createElement("div");
      body.className = "book-body";

      const tag = document.createElement("p");
      tag.className = "level-tag";
      tag.textContent = LEVEL_LABEL[book.level] || book.level || "Semua";

      const title = document.createElement("h3");
      title.textContent = book.title || "(Tanpa judul)";

      const author = document.createElement("p");
      author.className = "book-author";
      author.textContent = book.author ? "oleh " + book.author : "";

      const desc = document.createElement("p");
      desc.className = "book-desc";
      desc.textContent = book.description || "";

      const meta = document.createElement("p");
      meta.className = "book-meta";
      meta.textContent = book.pages ? book.pages + " halaman" : "";

      body.appendChild(tag);
      body.appendChild(title);
      if (book.author) body.appendChild(author);
      if (book.description) body.appendChild(desc);
      if (book.pages) body.appendChild(meta);
      body.appendChild(renderStars(book));

      li.appendChild(cover);
      li.appendChild(body);
      gridEl.appendChild(li);
    });

    if (emptyEl) emptyEl.hidden = safeItems.length > 0;
    if (countEl) {
      countEl.textContent = safeItems.length
        ? safeItems.length + " judul tersedia."
        : "Katalog kosong.";
    }
  }

  async function loadBooks() {
    hideAlert();
    if (countEl) countEl.textContent = "Memuat katalog…";
    const level = filterEl && filterEl.value ? filterEl.value : "";
    const url = "/api/books" + (level ? "?level=" + encodeURIComponent(level) : "");
    try {
      const result = await fetchJson(url);
      if (!result.ok) {
        renderBooks([]);
        showAlert(errorMessage(result.data && result.data.error));
        return;
      }
      renderBooks(result.data && result.data.items);
    } catch (err) {
      renderBooks([]);
      showAlert("Tidak dapat terhubung ke server. Periksa koneksi Anda.");
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

  if (filterEl) {
    filterEl.addEventListener("change", function () {
      loadBooks();
    });
  }

  (async function boot() {
    await checkSession();
    await loadBooks();
  })();
})();
