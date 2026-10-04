/* نقطة التشغيل: التنقل بين الأقسام، النسخ الاحتياطي، وربط الوحدات */
(function (App) {
  const { store, ui } = App;
  const VIEWS = ["dashboard", "tracks", "letters", "report", "meetings", "registry", "roster", "rtl", "converter", "hospitality", "sheets", "screen", "reports", "tasks", "history", "admin"];

  function show(view) {
    if (!VIEWS.includes(view)) view = "dashboard";
    // صفحة ممنوعة على هذا المستخدم: يُنقل إلى أول صفحة مسموحة
    if (App.profile && !App.profile.canView(view)) view = App.profile.firstView();
    const sidebar = document.querySelector(".sidebar");
    const menu = document.getElementById("mobile-menu-toggle");
    if (sidebar && menu && window.matchMedia("(max-width: 760px)").matches) {
      sidebar.classList.remove("nav-open");
      menu.setAttribute("aria-expanded", "false");
      const nav = document.getElementById("primary-nav");
      nav.inert = true;
      nav.setAttribute("aria-hidden", "true");
    }
    VIEWS.forEach((v) => {
      document.getElementById("view-" + v).classList.toggle("active", v === view);
      document.querySelector(`[data-view="${v}"]`).classList.toggle("active", v === view);
    });
    openGroupOf(view);
    if (view === "dashboard") App.dashboard.render();
    if (view === "tracks") App.tracks.render();
    if (view === "letters") App.letters.render();
    if (view === "report") App.report.render();
    if (view === "meetings") App.meetings.render();
    if (view === "registry") App.registry.render();
    if (view === "roster") App.roster.render();
    if (view === "rtl") App.rtlPage.render();
    if (view === "converter") App.converter.render();
    if (view === "hospitality") App.hospitality.render();
    if (view === "tasks") App.tasks.render();
    if (view === "sheets") App.sheets.render();
    if (view === "screen") App.screen.show();
    else if (App.screen) App.screen.hide();
    if (view === "reports" && App.reports) App.reports.render();
    if (view === "history") App.history.render();
    if (view === "admin") App.admin.render();
    if (location.hash.slice(1) !== view) history.replaceState(null, "", "#" + view);
    window.scrollTo(0, 0);
  }

  /* أقسام القائمة الجانبية: ستة عشر بنداً في عمود واحد يصعب تصفّحها، فتُجمع وتُطوى.
     القسم الذي فيه الصفحة المفتوحة يُفتح دائماً، وبقيّة الأقسام تتذكّر حالتها. */
  const GROUPS_KEY = "tamkeen-admin:nav-groups";
  const readGroups = () => { try { return JSON.parse(localStorage.getItem(GROUPS_KEY) || "{}") || {}; } catch (e) { return {}; } };
  const writeGroups = (v) => { try { localStorage.setItem(GROUPS_KEY, JSON.stringify(v)); } catch (e) { /* ممتلئ */ } };

  function openGroupOf(view) {
    const btn = document.querySelector(`[data-view="${view}"]`);
    const group = btn && btn.closest(".nav-group");
    if (group) group.classList.add("open");
  }

  function initGroups() {
    const state = readGroups();
    document.querySelectorAll(".nav-group").forEach((g) => {
      const name = g.dataset.group;
      // أول مرة: الأقسام مطويّة إلا ما فيه الصفحة المفتوحة
      if (state[name]) g.classList.add("open");
      const head = g.querySelector(".nav-head");
      if (!head) return;
      head.addEventListener("click", () => {
        g.classList.toggle("open");
        const next = readGroups();
        next[name] = g.classList.contains("open");
        writeGroups(next);
      });
    });
  }

  /* رقم النسخة التي يشغّلها هذا المتصفح فعلاً، وزر يمسح المخزَّن ويجلب الأحدث.
     بدونه لا يعرف المستخدم (ولا نحن) أنه ما زال على إصدار قديم. */
  function showVersion() {
    const src = (document.querySelector('script[src*="src/app.js"]') || {}).src || "";
    const v = (src.match(/[?&]v=(\d+)/) || [])[1];
    const out = document.getElementById("foot-version");
    if (out && v) out.textContent = `النسخة ${v}`;
    const btn = document.getElementById("foot-refresh");
    if (btn) btn.addEventListener("click", async () => {
      try {
        if ("serviceWorker" in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map((r) => r.unregister()));
        }
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch (e) { /* متصفح بلا تخزين مؤقت */ }
      location.reload(true);
    });
  }

  /* ===== الوضع الليلي (رموز قالب Gentelella) ===== */
  const THEME_KEY = "tamkeen-admin:theme";
  function applyTheme(mode) {
    document.documentElement.setAttribute("data-theme", mode);
    const btn = document.getElementById("theme-toggle");
    if (btn) { btn.textContent = mode === "dark" ? "☀" : "🌙"; btn.title = mode === "dark" ? "الوضع النهاري" : "الوضع الليلي"; }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", mode === "dark" ? "#0f1623" : "#1a2332");
  }
  function initTheme() {
    let mode = "";
    try { mode = localStorage.getItem(THEME_KEY) || ""; } catch (e) { /* تخزين غير متاح */ }
    if (!mode) mode = "light";   // الافتراضي نهاري؛ الوضع الليلي باختيار المستخدم من زر 🌙
    applyTheme(mode);
    const btn = document.getElementById("theme-toggle");
    if (!btn) return;
    btn.addEventListener("click", () => {
      const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
      applyTheme(next);
      try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* تخزين غير متاح */ }
    });
  }

  /* زر «تثبيت التطبيق»: يظهر حين يسمح المتصفح بالتثبيت (كروم وإيدج وأندرويد) */
  function initInstall() {
    let prompt = null;
    const btn = document.getElementById("pwa-install");
    window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); prompt = e; btn.hidden = false; });
    window.addEventListener("appinstalled", () => { btn.hidden = true; ui.toast("ثُبّت مساعد تمكين على هذا الجهاز"); });
    btn.addEventListener("click", async () => {
      if (!prompt) return;
      prompt.prompt();
      await prompt.userChoice.catch(() => null);
      prompt = null;
      btn.hidden = true;
    });
  }

  function initBackup() {
    document.getElementById("btn-export").addEventListener("click", () => {
      ui.download(`نسخة-احتياطية-تمكين-${ui.todayISO()}.json`, store.exportJSON(), "application/json");
      ui.toast("تم تنزيل النسخة الاحتياطية");
    });

    const fileInput = document.getElementById("import-file");
    document.getElementById("btn-import").addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files[0];
      fileInput.value = "";
      if (!file || !confirm("سيتم استبدال جميع البيانات الحالية بمحتوى الملف. هل تريد المتابعة؟")) return;
      try {
        store.importJSON(await file.text());
        show(location.hash.slice(1));
        ui.toast("تمت استعادة البيانات بنجاح");
      } catch (e) {
        ui.toast("الملف غير صالح أو تالف");
      }
    });

    document.getElementById("btn-reset").addEventListener("click", () => {
      if (!confirm("سيتم حذف جميع البيانات والعودة إلى القيم الافتراضية. يُنصح بتنزيل نسخة احتياطية أولاً. هل تريد المتابعة؟")) return;
      store.reset();
      show(location.hash.slice(1));
      ui.toast("تمت إعادة الضبط");
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    store.load();
    App.tracks.init();
    App.tasks.init();
    App.letters.init();
    App.driveUI.init();
    App.profile.init();
    App.shared.init();
    App.ai.migrateToShared();
    initTheme();
    App.registry.init();
    if (App.screen) App.screen.init();
    if (App.reports) App.reports.init();
    showVersion();
    if (App.watch) App.watch.init();
    App.roster.init();
    App.admin.init();
    App.rtlPage.init();
    App.meetings.init();
    App.aiAssist.attach();
    App.report.init();
    App.converter.init();
    App.hospitality.init();
    App.sheets.init();
    App.history.init();
    App.notify.init();
    App.rosterAudit.init();
    App.search.init();
    initInstall();
    initBackup();

    // تحديث الأقسام التي لا تحتوي على حقول قيد التحرير
    store.onChange(() => {
      App.dashboard.render();
      App.tasks.render();
    });

    document.querySelectorAll("[data-view]").forEach((btn) =>
      btn.addEventListener("click", () => show(btn.dataset.view))
    );
    initGroups();
    const menu = document.getElementById("mobile-menu-toggle");
    const nav = document.getElementById("primary-nav");
    const mobile = window.matchMedia("(max-width: 760px)");
    nav.inert = mobile.matches;
    nav.setAttribute("aria-hidden", String(mobile.matches));
    menu.addEventListener("click", () => {
      const open = document.querySelector(".sidebar").classList.toggle("nav-open");
      menu.setAttribute("aria-expanded", String(open));
      nav.inert = !open;
      nav.setAttribute("aria-hidden", String(!open));
    });
    window.addEventListener("resize", () => {
      const isMobile = mobile.matches;
      if (!isMobile) {
        document.querySelector(".sidebar").classList.remove("nav-open");
        nav.inert = false;
        nav.removeAttribute("aria-hidden");
        menu.setAttribute("aria-expanded", "false");
      } else if (!document.querySelector(".sidebar").classList.contains("nav-open")) {
        nav.inert = true;
        nav.setAttribute("aria-hidden", "true");
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      const sidebar = document.querySelector(".sidebar");
      if (sidebar.classList.contains("nav-open")) {
        sidebar.classList.remove("nav-open");
        menu.setAttribute("aria-expanded", "false");
        nav.inert = true;
        nav.setAttribute("aria-hidden", "true");
        menu.focus();
      }
    });
    // تثبيت الأداة كتطبيق والعمل عند ضعف الإنترنت
    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
      navigator.serviceWorker.register("sw.js").catch(() => { /* غير متاح */ });
    }
    window.addEventListener("hashchange", () => show(location.hash.slice(1)));
    show(location.hash.slice(1));
  });
})(window.App = window.App || {});
