/* الملف الشخصي لمستخدم هذا الجهاز: اسمه يُسجَّل على كل ما يرفعه، ويصبح مجلده الخاص في أرشيف المركز.
   ملفات كل مستخدم تبقى متاحة للجميع؛ الملف الشخصي للتنظيم والتصفية فقط. */
(function (App) {
  const { ui } = App;
  const $ = (id) => document.getElementById(id);
  const STORAGE = "tamkeen-admin:profile";
  const listeners = [];
  let waiting = null;

  function get() {
    try { return Object.assign({ name: "", title: "" }, JSON.parse(localStorage.getItem(STORAGE) || "{}")); } catch (e) { return { name: "", title: "" }; }
  }
  // الاسم يصبح اسم مجلد في Drive: بلا شرطات مائلة أو رموز ممنوعة
  const clean = (s) => String(s || "").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  const name = () => get().name;

  function open(required) {
    const p = get();
    $("profile-name").value = p.name;
    $("profile-title").value = p.title;
    $("profile-hint").textContent = required
      ? "قبل الرفع: أنشئ ملفك الشخصي مرة واحدة. ملفاتك تُحفظ في مجلد باسمك، ويستطيع الجميع رؤيتها وتحميلها."
      : "اسمك يظهر على كل ما ترفعه، ويكون اسم مجلدك في أرشيف المركز. الملفات متاحة للجميع.";
    $("profile-cancel").hidden = !!required && !p.name;
    $("profile-modal").classList.add("open");
    setTimeout(() => $("profile-name").focus(), 50);
  }
  function close(result) {
    $("profile-modal").classList.remove("open");
    if (waiting) { waiting(result); waiting = null; }
  }

  /* يضمن وجود اسم قبل الرفع؛ يرجع الاسم أو "" إن أُلغي */
  function ensure() {
    if (name()) return Promise.resolve(name());
    open(true);
    return new Promise((resolve) => { waiting = resolve; });
  }

  function renderBadges() {
    const n = name();
    document.querySelectorAll("[data-profile]").forEach((b) => { b.textContent = n ? `👤 ${n}` : "👤 ملفي الشخصي"; });
  }

  function save(e) {
    e.preventDefault();
    const n = clean($("profile-name").value);
    if (n.length < 2) { ui.toast("اكتب اسمك (حرفان على الأقل)"); $("profile-name").focus(); return; }
    const prev = name();
    try { localStorage.setItem(STORAGE, JSON.stringify({ name: n, title: $("profile-title").value.trim() })); } catch (err) { /* تخزين غير متاح */ }
    renderBadges();
    listeners.forEach((fn) => fn());
    ui.toast(prev && prev !== n ? `تم تغيير الاسم إلى ${n}؛ الملفات الجديدة تُحفظ في مجلد «${n}»` : `أهلاً ${n}`);
    close(n);
  }

  function init() {
    $("profile-form").addEventListener("submit", save);
    $("profile-cancel").addEventListener("click", () => close(""));
    $("profile-modal").addEventListener("click", (e) => { if (e.target.id === "profile-modal" && !$("profile-cancel").hidden) close(""); });
    document.querySelectorAll("[data-profile]").forEach((b) => b.addEventListener("click", () => open(false)));
    renderBadges();
  }

  App.profile = { init, get, name, ensure, open, onChange: (fn) => listeners.push(fn) };
})(window.App = window.App || {});
