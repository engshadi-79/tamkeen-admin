/* نقطة التشغيل: التنقل بين الأقسام، النسخ الاحتياطي، وربط الوحدات */
(function (App) {
  const { store, ui } = App;
  const VIEWS = ["dashboard", "tracks", "letters", "report", "meetings", "registry", "rtl", "converter", "tasks"];

  function show(view) {
    if (!VIEWS.includes(view)) view = "dashboard";
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
    if (view === "rtl") App.rtlPage.render();
    if (view === "converter") App.converter.render();
    if (view === "tasks") App.tasks.render();
    if (location.hash.slice(1) !== view) history.replaceState(null, "", "#" + view);
    window.scrollTo(0, 0);
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
    App.registry.init();
    App.rtlPage.init();
    App.meetings.init();
    App.report.init();
    App.converter.init();
    initBackup();

    // تحديث الأقسام التي لا تحتوي على حقول قيد التحرير
    store.onChange(() => {
      App.dashboard.render();
      App.tasks.render();
    });

    document.querySelectorAll("[data-view]").forEach((btn) =>
      btn.addEventListener("click", () => show(btn.dataset.view))
    );
    window.addEventListener("hashchange", () => show(location.hash.slice(1)));
    show(location.hash.slice(1));
  });
})(window.App = window.App || {});
