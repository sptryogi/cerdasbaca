/* ============================================================
   CerdasBaca — interaksi vanilla JS
   - Navbar sticky + hamburger
   - Smooth-scroll (fallback) & penanda section aktif
   - Modal Login / Daftar → API (/api/login, /api/register) → dashboard
   - Animasi counter statistik
   - Form kontak → POST /api/contact (kirim email ke tim)
   ============================================================ */

(function () {
  "use strict";

  // Hormati preferensi reduced-motion (m3)
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  function prefersReducedMotion() {
    return motionQuery.matches;
  }

  /* ---------- 1. Header: bayangan saat scroll ---------- */
  const header = document.querySelector(".site-header");

  function onScrollHeader() {
    if (!header) return;
    header.classList.toggle("is-scrolled", window.scrollY > 8);
  }

  window.addEventListener("scroll", onScrollHeader, { passive: true });
  onScrollHeader();

  /* ---------- 2. Navigasi mobile (hamburger) ---------- */
  const navToggle = document.getElementById("nav-toggle");
  const navMenu = document.getElementById("nav-menu");

  function setMenu(open) {
    if (!navToggle || !navMenu) return;
    navToggle.setAttribute("aria-expanded", String(open));
    navToggle.setAttribute("aria-label", open ? "Tutup menu navigasi" : "Buka menu navigasi");
    navMenu.classList.toggle("is-open", open);
  }

  if (navToggle && navMenu) {
    navToggle.addEventListener("click", function () {
      const open = navToggle.getAttribute("aria-expanded") !== "true";
      setMenu(open);
    });

    // Tutup menu setelah klik link (mobile)
    navMenu.querySelectorAll('a[href^="#"]').forEach(function (link) {
      link.addEventListener("click", function () {
        if (window.matchMedia("(max-width: 899px)").matches) {
          setMenu(false);
        }
      });
    });

    // Tutup menu saat resize ke desktop
    window.addEventListener("resize", function () {
      if (window.matchMedia("(min-width: 900px)").matches) {
        setMenu(false);
      }
    });

    // m2: Escape menutup menu mobile
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && navMenu.classList.contains("is-open")) {
        setMenu(false);
        navToggle.focus();
      }
    });

    // m2: klik di luar menu menutupnya
    document.addEventListener("click", function (event) {
      if (!navMenu.classList.contains("is-open")) return;
      if (navMenu.contains(event.target) || navToggle.contains(event.target)) return;
      setMenu(false);
    });
  }

  /* ---------- 3. Smooth-scroll fallback (dengan offset header) ---------- */
  function headerOffset() {
    return (header ? header.offsetHeight : 68) + 12;
  }

  document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
    anchor.addEventListener("click", function (event) {
      const href = anchor.getAttribute("href");
      // m4: cegah lompat ke atas pada link placeholder (href="#")
      if (!href || href === "#") {
        event.preventDefault();
        return;
      }

      const target = document.querySelector(href);
      if (!target) return;

      event.preventDefault();
      const top = target.getBoundingClientRect().top + window.scrollY - headerOffset();
      window.scrollTo({ top: top, behavior: prefersReducedMotion() ? "auto" : "smooth" });

      // Pindahkan fokus keyboard ke section (a11y)
      if (!target.hasAttribute("tabindex")) {
        target.setAttribute("tabindex", "-1");
      }
      target.focus({ preventScroll: true });
      // m7: pushState bisa gagal di file:// — bungkus try/catch
      try {
        history.pushState(null, "", href);
      } catch (err) {
        /* abaikan */
      }
    });
  });

  /* ---------- 4. Penanda section aktif di navbar ---------- */
  const navLinks = Array.from(document.querySelectorAll(".nav-links a[href^='#']"));
  const sections = navLinks
    .map(function (link) {
      return document.querySelector(link.getAttribute("href"));
    })
    .filter(Boolean);

  if ("IntersectionObserver" in window && sections.length) {
    const spy = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          const id = "#" + entry.target.id;
          navLinks.forEach(function (link) {
            const active = link.getAttribute("href") === id;
            link.classList.toggle("is-active", active);
            // m5: tandai section aktif untuk screen reader
            if (active) {
              link.setAttribute("aria-current", "true");
            } else {
              link.removeAttribute("aria-current");
            }
          });
        });
      },
      { rootMargin: "-40% 0px -55% 0px", threshold: 0 }
    );

    sections.forEach(function (section) {
      spy.observe(section);
    });
  }

  /* ---------- 5. Modal Login & Daftar ---------- */
  let lastFocused = null;
  const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function openModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;

    // Simpan fokus SEBELUM menutup menu mobile (m13),
    // agar lastFocused bukan elemen yang sudah tersembunyi
    lastFocused = document.activeElement;

    // Pastikan menu mobile tertutup saat modal dibuka
    if (typeof setMenu === "function") {
      setMenu(false);
    }

    modal.hidden = false;
    document.body.style.overflow = "hidden";

    // n5: fokuskan field input pertama (bukan tombol close) untuk form;
    // dialog non-form fallback ke tombol close
    const firstField = modal.querySelector("input, select, textarea");
    const focusTarget = firstField || modal.querySelector("button.modal-close");
    if (focusTarget) focusTarget.focus();
  }

  function closeModal(modal) {
    if (!modal || modal.hidden) return;
    modal.hidden = true;

    // Buka kembali body scroll hanya jika tidak ada modal lain
    const anyOpen = document.querySelector(".modal:not([hidden])");
    if (!anyOpen) {
      document.body.style.overflow = "";
    }

    if (lastFocused && typeof lastFocused.focus === "function") {
      // m13/R3-1: pemicu di navMenu tertutup → redirect ke navToggle,
      // TAPI hanya bila navToggle benar-benar terlihat (offsetParent !== null).
      // Di desktop navToggle display:none → navToggle.focus() no-op → fokus hilang ke body.
      if (navMenu && navMenu.contains(lastFocused) && !navMenu.classList.contains("is-open")
          && navToggle && navToggle.offsetParent !== null) {
        navToggle.focus();
      } else {
        lastFocused.focus();
      }
    }
    lastFocused = null;
  }

  // Buka modal via [data-modal-open]
  document.querySelectorAll("[data-modal-open]").forEach(function (trigger) {
    trigger.addEventListener("click", function (event) {
      event.preventDefault();
      openModal(trigger.getAttribute("data-modal-open"));
    });
  });

  // Tutup modal via [data-modal-close]
  document.querySelectorAll("[data-modal-close]").forEach(function (el) {
    el.addEventListener("click", function () {
      closeModal(el.closest(".modal"));
    });
  });

  // Ganti modal (mis. dari login → daftar)
  document.querySelectorAll("[data-modal-switch]").forEach(function (link) {
    link.addEventListener("click", function (event) {
      event.preventDefault();
      const current = link.closest(".modal");
      const next = link.getAttribute("data-modal-switch");
      closeModal(current);
      openModal(next);
    });
  });

  // ESC untuk tutup + focus trap sederhana
  document.addEventListener("keydown", function (event) {
    const open = document.querySelector(".modal:not([hidden])");
    if (!open) return;

    if (event.key === "Escape") {
      closeModal(open);
      return;
    }

    if (event.key === "Tab") {
      const items = Array.from(open.querySelectorAll(FOCUSABLE)).filter(function (el) {
        return el.offsetParent !== null;
      });
      if (!items.length) return;

      const first = items[0];
      const last = items[items.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  /* ---------- 6. Animasi counter statistik ---------- */
  const counters = document.querySelectorAll(".counter");

  function animateCounter(el) {
    const target = parseInt(el.getAttribute("data-target"), 10) || 0;

    // m3: langsung tampilkan angka akhir bila reduced-motion
    if (prefersReducedMotion()) {
      el.textContent = target.toLocaleString("id-ID");
      return;
    }

    const duration = 1400;
    const start = performance.now();

    function tick(now) {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      const value = Math.round(target * eased);
      el.textContent = value.toLocaleString("id-ID");
      if (progress < 1) requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
  }

  if ("IntersectionObserver" in window && counters.length) {
    const counterObserver = new IntersectionObserver(
      function (entries, observer) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            animateCounter(entry.target);
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.4 }
    );

    counters.forEach(function (el) {
      counterObserver.observe(el);
    });
  } else {
    counters.forEach(function (el) {
      el.textContent = (parseInt(el.getAttribute("data-target"), 10) || 0).toLocaleString("id-ID");
    });
  }

  /* ---------- 7. Form ---------- */
  function setStatus(el, message, isError) {
    if (!el) return;
    el.textContent = message;
    el.classList.toggle("is-error", Boolean(isError));
  }

  // Fetch dengan timeout agar UI tidak hang bila server lambat/mati.
  // AbortController membatalkan request setelah timeoutMs (default 10 dtk).
  function fetchWithTimeout(url, options, timeoutMs) {
    const opts = options || {};
    const ms = timeoutMs || 10000;
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller
      ? setTimeout(function () {
          controller.abort();
        }, ms)
      : null;
    const finalOpts = Object.assign({}, opts);
    if (controller) finalOpts.signal = controller.signal;
    return fetch(url, finalOpts).finally(function () {
      if (timer) clearTimeout(timer);
    });
  }

  // Pesan error yang ramah untuk timeout vs gangguan koneksi.
  function networkErrorMessage(err) {
    if (err && err.name === "AbortError") {
      return "Timeout — server lambat. Coba lagi.";
    }
    return "Tidak dapat terhubung ke server. Periksa koneksi Anda.";
  }

  // Form kontak → POST /api/contact (server meneruskan pesan ke email tim).
  function bindContactForm() {
    const form = document.getElementById("contact-form");
    const status = document.getElementById("contact-status");
    if (!form) return;

    form.addEventListener("submit", async function (event) {
      // Browser memvalidasi dulu; cek ulang sebagai jaring pengaman.
      if (!form.checkValidity()) {
        event.preventDefault();
        setStatus(status, "Mohon lengkapi semua kolom yang wajib diisi.", true);
        form.reportValidity();
        return;
      }

      event.preventDefault();

      const button = form.querySelector('button[type="submit"]');
      if (button) button.disabled = true;
      setStatus(status, "Mengirim pesan…", false);

      const payload = {
        name: String((form.elements.nama && form.elements.nama.value) || "").trim(),
        email: String((form.elements.email && form.elements.email.value) || "").trim(),
        school: String((form.elements.sekolah && form.elements.sekolah.value) || "").trim(),
        message: String((form.elements.pesan && form.elements.pesan.value) || "").trim(),
      };

      try {
        const res = await fetchWithTimeout(
          "/api/contact",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify(payload),
          },
          10000
        );

        let data = null;
        try {
          data = await res.json();
        } catch (err) {
          if (err && err.name === "AbortError") throw err;
          data = null;
        }

        // Pesan sukses yang jujur hanya bila API benar-benar merespons ok.
        if (res.ok && data && data.ok) {
          setStatus(status, "✅ " + (data.message || "Pesan terkirim ke tim kami."), false);
          form.reset();
        } else {
          setStatus(
            status,
            (data && data.error) ||
              (res.status === 503
                ? "Layanan belum siap. Silakan coba lagi nanti."
                : "Pesan gagal terkirim. Silakan coba lagi."),
            true
          );
        }
      } catch (err) {
        setStatus(status, networkErrorMessage(err), true);
      }

      if (button) button.disabled = false;
    });
  }

  bindContactForm();

  /* ---------- 7b. Form auth → API (/api/register, /api/login) ---------- */
  async function postJson(url, payload) {
    const res = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(payload),
      },
      10000
    );
    let data = null;
    try {
      data = await res.json();
    } catch (err) {
      if (err && err.name === "AbortError") throw err;
      data = null;
    }
    return { ok: res.ok, status: res.status, data: data };
  }

  function bindAuthForm(formId, statusId, endpoint, buildPayload, successText) {
    const form = document.getElementById(formId);
    const status = document.getElementById(statusId);
    if (!form) return;

    form.addEventListener("submit", async function (event) {
      event.preventDefault();

      if (!form.checkValidity()) {
        setStatus(status, "Mohon lengkapi semua kolom yang wajib diisi.", true);
        form.reportValidity();
        return;
      }

      const button = form.querySelector('button[type="submit"]');
      if (button) button.disabled = true;
      setStatus(status, "Mohon tunggu…", false);

      try {
        const result = await postJson(endpoint, buildPayload(form));

        if (result.ok) {
          setStatus(status, successText, false);
          // Arahkan sesuai role: admin → panel kelola, siswa → dashboard.
          const role =
            result.data && result.data.user && result.data.user.role;
          const target = role === "admin" ? "admin.html" : "dashboard.html";
          window.setTimeout(function () {
            window.location.href = target;
          }, 500);
          return;
        }

        setStatus(
          status,
          (result.data && result.data.error) ||
            (result.status === 503
              ? "Database belum terhubung. Coba lagi nanti."
              : "Permintaan gagal. Silakan coba lagi."),
          true
        );
      } catch (err) {
        setStatus(status, networkErrorMessage(err), true);
      }

      if (button) button.disabled = false;
    });
  }

  bindAuthForm(
    "login-form",
    "login-status",
    "/api/login",
    function (form) {
      return {
        email: String(form.email.value || "").trim(),
        password: String(form.password.value || ""),
      };
    },
    "✅ Berhasil masuk. Mengalihkan…"
  );

  bindAuthForm(
    "daftar-form",
    "daftar-status",
    "/api/register",
    function (form) {
      return {
        name: String(form.nama.value || "").trim(),
        email: String(form.email.value || "").trim(),
        level: String(form.jenjang.value || ""),
        password: String(form.password.value || ""),
      };
    },
    "✅ Akun dibuat. Mengalihkan…"
  );

  /* ---------- 7c. Testimoni gabungan (template + API) ---------- */
  // Semua testimoni (API + template) untuk diisi ke modal saat tombol diklik.
  let allTestimonials = [];

  /** Normalisasi quote untuk dedupe (buang tanda kutip & huruf kecil semua). */
  function normalizeQuote(value) {
    return String(value || "")
      .trim()
      .replace(/^[“"'"]+|[”"'"]+$/g, "")
      .trim()
      .toLowerCase();
  }

  /** Baca kartu testimoni statis dari DOM SEBELUM grid diubah. */
  function readTemplateItems(grid) {
    return Array.from(grid.querySelectorAll(".quote-card")).map(function (card) {
      const quoteEl = card.querySelector("blockquote p");
      const nameEl = card.querySelector(".quote-author strong");
      const roleEl = card.querySelector(".quote-author small");
      const avatarEl = card.querySelector(".avatar");
      return {
        quote: quoteEl ? quoteEl.textContent.trim() : "",
        name: nameEl ? nameEl.textContent.trim() : "",
        roleLabel: roleEl ? roleEl.textContent.trim() : "",
        isTemplate: true,
        avatarClass: avatarEl ? avatarEl.getAttribute("class") : "avatar",
      };
    });
  }

  /**
   * Render satu kartu testimoni (anti-XSS: textContent/createElement saja).
   * mode "grid" → <figure> (valid di dalam role=list grid);
   * mode "modal" → <div> (valid di dalam div.testi-modal-list).
   */
  function renderQuoteCard(item, mode) {
    const card = document.createElement(mode === "modal" ? "div" : "figure");
    card.className = "quote-card";
    card.setAttribute("role", "listitem");

    const stars = document.createElement("div");
    stars.className = "quote-stars";
    stars.setAttribute("role", "img");
    stars.setAttribute("aria-label", "Rating 5 dari 5");
    stars.textContent = "⭐⭐⭐⭐⭐";

    const blockquote = document.createElement("blockquote");
    const p = document.createElement("p");
    p.textContent = "“" + String(item.quote || "") + "”";
    blockquote.appendChild(p);

    const caption = document.createElement(mode === "modal" ? "div" : "figcaption");
    caption.className = "quote-author";

    const name = item.name || "Pengguna CerdasBaca";
    const initials = String(name)
      .split(/\s+/)
      .slice(0, 2)
      .map(function (w) {
        return w.charAt(0).toUpperCase();
      })
      .join("");

    const avatar = document.createElement("span");
    avatar.className = item.avatarClass || "avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = initials || "CB";

    const who = document.createElement("span");
    const strong = document.createElement("strong");
    strong.textContent = name;
    const small = document.createElement("small");
    small.textContent = item.roleLabel || "Pengguna CerdasBaca";
    who.appendChild(strong);
    who.appendChild(small);

    caption.appendChild(avatar);
    caption.appendChild(who);

    card.appendChild(stars);
    card.appendChild(blockquote);
    card.appendChild(caption);
    return card;
  }

  async function loadTestimonials() {
    const grid = document.getElementById("testimoni-grid");
    if (!grid) return;

    const moreBtn = document.getElementById("btn-testi-more");
    const moreCount = document.getElementById("testi-more-count");

    // 1. Simpan 3 template asli dari DOM sebelum grid diubah.
    const templateItems = readTemplateItems(grid);
    allTestimonials = templateItems;

    try {
      const res = await fetchWithTimeout("/api/testimonials", {}, 8000);
      if (!res.ok) return; // gagal → fallback statis tetap tampil, tombol more tersembunyi
      let data = null;
      try {
        data = await res.json();
      } catch (err) {
        if (err && err.name === "AbortError") throw err;
        data = null;
      }
      const apiItems = data && Array.isArray(data.items) ? data.items : [];
      if (!apiItems.length) return; // kosong → biarkan template, tombol more tersembunyi

      // 2. Dedupe: lewati item API yang quote-nya sama dengan salah satu template.
      const templateQuotes = {};
      templateItems.forEach(function (t) {
        templateQuotes[normalizeQuote(t.quote)] = true;
      });
      const freshApi = apiItems.filter(function (item) {
        return !templateQuotes[normalizeQuote(item.quote)];
      });

      // 3. Gabung: API dulu (lebih baru), lalu template.
      const merged = freshApi.concat(templateItems);
      allTestimonials = merged;

      // 4. Grid tampilkan maksimal 3 kartu.
      grid.innerHTML = ""; // hanya kosongkan; render data via createElement/textContent
      merged.slice(0, 3).forEach(function (item) {
        grid.appendChild(renderQuoteCard(item, "grid"));
      });

      // 5. Tombol "lihat lain" hanya bila total > 3.
      const showMore = merged.length > 3;
      if (moreBtn) moreBtn.hidden = !showMore;
      if (moreCount) {
        moreCount.hidden = !showMore;
        moreCount.textContent = showMore
          ? "Menampilkan 3 dari " + merged.length + " testimoni."
          : "";
      }
    } catch (err) {
      /* offline / API mati / timeout → fallback statis tetap tampil */
    }
  }

  // Buka modal "Semua Testimoni" berisi SELURUH gabungan (template + API).
  const testiMoreBtn = document.getElementById("btn-testi-more");
  if (testiMoreBtn) {
    testiMoreBtn.addEventListener("click", function () {
      const list = document.getElementById("testi-modal-list");
      const sub = document.getElementById("testi-modal-sub");
      if (list) {
        list.innerHTML = ""; // hanya kosongkan; render data via createElement/textContent
        allTestimonials.forEach(function (item) {
          list.appendChild(renderQuoteCard(item, "modal"));
        });
      }
      if (sub) {
        sub.textContent =
          allTestimonials.length +
          " cerita dari guru, siswa, dan orang tua CerdasBaca.";
      }
      // Buka memakai mekanisme modal yang sama (focus trap, ESC, data-modal-close).
      openModal("modal-testi");
    });
  }

  if (document.getElementById("testimoni-grid")) {
    loadTestimonials();
  }

  /* ---------- 8. Tahun copyright ---------- */
  const yearEl = document.getElementById("year");
  if (yearEl) {
    yearEl.textContent = String(new Date().getFullYear());
  }
})();
