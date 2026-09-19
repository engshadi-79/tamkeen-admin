/* الملف الشخصي لمستخدم هذا الجهاز: اسمه يُسجَّل على كل ما يرفعه، ويصبح مجلده الخاص في أرشيف المركز.
   ملفات كل مستخدم تبقى متاحة للجميع؛ الملف الشخصي للتنظيم والتصفية فقط. */
(function (App) {
  const { ui } = App;
  const $ = (id) => document.getElementById(id);
  const STORAGE = "tamkeen-admin:profile";
  const listeners = [];
  let waiting = null;

  function get() {
    try { return Object.assign({ name: "", title: "", admin: false }, JSON.parse(localStorage.getItem(STORAGE) || "{}")); } catch (e) { return { name: "", title: "", admin: false }; }
  }
  // الاسم يصبح اسم مجلد في Drive: بلا شرطات مائلة أو رموز ممنوعة
  const clean = (s) => String(s || "").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  const name = () => get().name;
  /* المدير يعدّل ويحذف كل القيود؛ المستخدم يعدّل قيوده فقط. بلا أرشيف مركز: الجميع مدير على جهازه */
  const isAdmin = () => !(App.cloud && App.cloud.ready()) || !!get().admin;
  const persist = (p) => { try { localStorage.setItem(STORAGE, JSON.stringify(p)); } catch (err) { /* تخزين غير متاح */ } };

  function open(required) {
    const p = get();
    $("profile-name").value = p.name;
    $("profile-title").value = p.title;
    $("profile-admin").value = "";
    $("profile-role").textContent = p.admin ? "الصلاحية: مدير ✓ (تعديل وحذف كل القيود)" : "الصلاحية: مستخدم (تعديل قيودك فقط). للمدير: أدخل رمز المدير.";
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

  async function save(e) {
    e.preventDefault();
    const n = clean($("profile-name").value);
    if (n.length < 2) { ui.toast("اكتب اسمك (حرفان على الأقل)"); $("profile-name").focus(); return; }
    const prev = name();
    let admin = get().admin;
    const code = $("profile-admin").value.trim();
    if (code) {
      try {
        admin = await App.cloud.checkAdmin(code);
        if (!admin) { ui.toast("رمز المدير غير صحيح"); $("profile-admin").select(); return; }
      } catch (err) { ui.toast(err.message); return; }
    }
    persist({ name: n, title: $("profile-title").value.trim(), admin });
    renderBadges();
    listeners.forEach((fn) => fn());
    if (code && admin) ui.toast("تم تفعيل صلاحية المدير على هذا الجهاز"); else ui.toast(prev && prev !== n ? `تم تغيير الاسم إلى ${n}؛ الملفات الجديدة تُحفظ في مجلد «${n}»` : `أهلاً ${n}`);
    close(n);
  }

  function init() {
    $("profile-form").addEventListener("submit", save);
    $("profile-cancel").addEventListener("click", () => close(""));
    $("profile-drop-admin").addEventListener("click", () => {
      persist(Object.assign(get(), { admin: false }));
      $("profile-role").textContent = "الصلاحية: مستخدم (تعديل قيودك فقط).";
      listeners.forEach((fn) => fn());
      ui.toast("أُلغيت صلاحية المدير على هذا الجهاز");
    });
    $("profile-modal").addEventListener("click", (e) => { if (e.target.id === "profile-modal" && !$("profile-cancel").hidden) close(""); });
    document.querySelectorAll("[data-profile]").forEach((b) => b.addEventListener("click", () => open(false)));
    renderBadges();
  }

  App.profile = { isAdmin, init, get, name, ensure, open, onChange: (fn) => listeners.push(fn) };
})(window.App = window.App || {});
