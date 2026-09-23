/* نقطة التشغيل: التنقل بين الأقسام، النسخ الاحتياطي، وربط الوحدات */
(function (App) {
  const { store, ui } = App;
  const VIEWS = ["dashboard", "tracks", "letters", "report", "meetings", "registry", "roster", "rtl", "converter", "hospitality", "sheets", "tasks", "history", "admin"];

  function show(view) {
    if (!VIEWS.includes(view)) view = "dashboard";
    // صفحة ممنوعة على هذا المستخدم: يُنقل إلى أول صفحة مسموحة
    if (App.profile && !App.profile.canView(view)) view = App.profile.firstView();
    VIEWS.forEach((v) => {
      document.getElementById("view-" + v).classList.toggle("active", v === view);
      document.querySelector(`[data-view="${v}"]`).classList.toggle("active", v === view);
    });
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
    if (view === "history") App.history.render();
    if (view === "admin") App.admin.render();
    if (location.hash.slice(1) !== view) history.replaceState(null, "", "#" + view);
    window.scrollTo(0, 0);
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
    App.registry.init();
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
    // تثبيت الأداة كتطبيق والعمل عند ضعف الإنترنت
    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
      navigator.serviceWorker.register("sw.js").catch(() => { /* غير متاح */ });
    }
    window.addEventListener("hashchange", () => show(location.hash.slice(1)));
    show(location.hash.slice(1));
  });
})(window.App = window.App || {});
