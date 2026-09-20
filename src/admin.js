/* لوحة التحكم (للمدير): المستخدمون وصلاحياتهم، والصفحات التي تظهر لكل واحد،
   مع حالة النظام وروابط النسخ الاحتياطية وسجل الأحداث على Drive. */
(function (App) {
  const { store, ui } = App;
  const $ = (id) => document.getElementById(id);
  const esc = ui.esc;

  /* الصفحات التي يمكن منحها أو منعها */
  const VIEWS = [
    { id: "dashboard", label: "اللوحة الرئيسية" },
    { id: "tracks", label: "المسارات" },
    { id: "letters", label: "المراسلات" },
    { id: "report", label: "التقارير" },
    { id: "meetings", label: "محاضر الاجتماعات" },
    { id: "registry", label: "الوارد والصادر" },
    { id: "roster", label: "المستفيدون والتعهدات" },
    { id: "rtl", label: "تصحيح اتجاه Word" },
    { id: "converter", label: "تحويل ملف حسب قالب" },
    { id: "tasks", label: "المهام والمتابعات" },
  ];

  /* صلاحيات إضافية داخل الصفحات */
  const PERMS = [
    { id: "upload", label: "رفع الملفات إلى الأرشيف" },
    { id: "delete", label: "حذف القيود والسجلات" },
    { id: "export", label: "التصدير والطباعة" },
    { id: "ai", label: "استخدام الذكاء الاصطناعي" },
  ];

  let users = [];
  let editing = null;
  let info = {};

  const viewLabel = (id) => (VIEWS.find((v) => v.id === id) || {}).label || id;
  const LABEL = { registry: "الوارد والصادر", tracks: "المسارات", tasks: "المهام", meetings: "المحاضر", customTemplates: "القوالب", roster: "المستفيدون", settings: "الإعدادات" };

  async function load() {
    if (!App.profile.isAdmin()) return;
    $("adm-users").innerHTML = `<tr><td colspan="6" class="empty">جارٍ التحميل…</td></tr>`;
    try {
      users = await App.cloud.listUsers();
      users.sort((a, b) => (b.admin - a.admin) || a.name.localeCompare(b.name, "ar"));
      renderUsers();
    } catch (e) {
      $("adm-users").innerHTML = `<tr><td colspan="6" class="empty">${esc(e.message)}</td></tr>`;
    }
    try {
      info = await App.cloud.backups();
      $("adm-log").href = info.logFolder || "#";
      $("adm-backups").href = info.folder || "#";
      $("adm-log").hidden = !info.logFolder;
      $("adm-backups").hidden = !info.folder;
      $("adm-digest-on").checked = !!(info.digest || {}).enabled;
      $("adm-digest-hour").value = String((info.digest || {}).hour || 7);
    } catch (e) { /* يظهر الخطأ في قائمة المستخدمين */ }
    renderStats();
  }

  function renderStats() {
    const s = store.get();
    const reg = (s.registry || []).filter((r) => !r.deletedAt);
    $("adm-stats").innerHTML = `
      <div class="stat"><div class="label">المستخدمون</div><div class="value">${ui.fmt(users.length)}</div>
        <div class="sub">${ui.fmt(users.filter((u) => u.admin).length)} مدير · ${ui.fmt(users.filter((u) => !u.active).length)} موقوف</div></div>
      <div class="stat"><div class="label">الوارد والصادر</div><div class="value">${ui.fmt(reg.length)}</div>
        <div class="sub">${ui.fmt(reg.filter((r) => r.driveLink).length)} ملف في الأرشيف</div></div>
      <div class="stat"><div class="label">المستفيدون</div><div class="value">${ui.fmt((s.roster || []).length)}</div>
        <div class="sub">${ui.fmt(((s.rosterMeta || {}).columns || []).length)} عمود</div></div>
      <div class="stat"><div class="label">المهام والمحاضر</div><div class="value">${ui.fmt((s.tasks || []).length)}</div>
        <div class="sub">${ui.fmt((s.meetings || []).length)} محضر</div></div>`;
  }

  function renderUsers() {
    $("adm-users").innerHTML = users.map((u) => {
      const all = !u.views || !u.views.length;
      const pages = all ? "كل الصفحات" : u.views.map(viewLabel).join("، ");
      return `<tr data-u="${esc(u.username)}" class="${u.active ? "" : "user-off"}">
        <td><b>${esc(u.name)}</b>${u.email ? `<div class="reg-kind" dir="ltr">${esc(u.email)}</div>` : ""}</td>
        <td dir="ltr" style="text-align:right">${esc(u.username)}</td>
        <td>${u.admin ? "<b>مدير</b>" : "مستخدم"}${u.active ? "" : " · موقوف"}</td>
        <td class="reg-kind">${esc(pages)}</td>
        <td class="reg-kind nowrap">${u.lastLogin ? esc(ui.formatDate(u.lastLogin.slice(0, 10))) : "لم يدخل"}</td>
        <td class="reg-actions nowrap">
          <button class="act-btn edit" data-edit>✎ تعديل</button>
          ${u.username === (App.cloud.user() || {}).username ? "" : `<button class="act-btn del" data-del>🗑 حذف</button>`}
        </td>
      </tr>`;
    }).join("") || `<tr><td colspan="6" class="empty">لا يوجد مستخدمون.</td></tr>`;
  }

  function openForm(u) {
    editing = u || null;
    $("adm-form-title").textContent = u ? `تعديل: ${u.name}` : "إضافة مستخدم جديد";
    $("adm-name").value = u ? u.name : "";
    $("adm-username").value = u ? u.username : "";
    $("adm-username").readOnly = !!u;
    $("adm-email").value = u ? u.email || "" : "";
    $("adm-password").value = "";
    $("adm-password").placeholder = u ? "اتركه فارغاً للإبقاء على كلمة المرور" : "6 أحرف على الأقل";
    $("adm-admin").checked = !!(u && u.admin);
    $("adm-active").checked = !u || u.active;
    const views = (u && u.views) || [];
    $("adm-views").innerHTML = VIEWS.map((v) => `<label class="conv-check">
        <input type="checkbox" data-view="${v.id}" ${!views.length || views.includes(v.id) ? "checked" : ""}> ${esc(v.label)}
      </label>`).join("");
    const perms = (u && u.perms) || {};
    $("adm-perms").innerHTML = PERMS.map((p) => `<label class="conv-check">
        <input type="checkbox" data-perm="${p.id}" ${perms[p.id] !== false ? "checked" : ""}> ${esc(p.label)}
      </label>`).join("");
    $("adm-cancel").hidden = !u;
    syncAdminToggle();
    $("adm-name").focus();
  }

  /* المدير يرى كل الصفحات دائماً */
  function syncAdminToggle() {
    const isAdmin = $("adm-admin").checked;
    $("adm-access").style.opacity = isAdmin ? ".5" : "1";
    $("adm-access").querySelectorAll("input").forEach((b) => { b.disabled = isAdmin; if (isAdmin) b.checked = true; });
    $("adm-access-note").textContent = isAdmin ? "المدير يرى كل الصفحات ويستطيع كل شيء." : "اختر ما يظهر لهذا المستخدم.";
  }

  async function save(e) {
    e.preventDefault();
    const checkedViews = [...$("adm-views").querySelectorAll("[data-view]")].filter((b) => b.checked).map((b) => b.dataset.view);
    const data = {
      username: $("adm-username").value.trim(),
      name: $("adm-name").value.trim(),
      email: $("adm-email").value.trim(),
      password: $("adm-password").value,
      admin: $("adm-admin").checked,
      active: $("adm-active").checked,
      views: $("adm-admin").checked || checkedViews.length === VIEWS.length ? [] : checkedViews,
      perms: $("adm-admin").checked ? {} : PERMS.reduce((acc, p) => {
        acc[p.id] = $("adm-perms").querySelector(`[data-perm="${p.id}"]`).checked;
        return acc;
      }, {}),
    };
    if (!data.name) { ui.toast("اكتب الاسم الظاهر"); return; }
    $("adm-save").disabled = true;
    try {
      await App.cloud.saveUser(data);
      ui.toast(editing ? `حُفظت صلاحيات ${data.name}` : `أُضيف ${data.name} — أعطه اسم المستخدم وكلمة المرور`);
      openForm(null);
      await load();
    } catch (err) { ui.toast(err.message); }
    $("adm-save").disabled = false;
  }

  /* نقل الحسابات بين الخادمين: ملف فيه بصمات كلمات المرور، لا الكلمات نفسها */
  async function exportUsers() {
    $("adm-export").disabled = true;
    try {
      const list = await App.cloud.exportUsers();
      if (!list.length) throw new Error("لا توجد حسابات للتصدير");
      const blob = new Blob([JSON.stringify({ at: new Date().toISOString(), users: list }, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `حسابات مساعد تمكين - ${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      ui.toast(`صُدِّر ${ui.fmt(list.length)} حساباً — الملف يحوي بصمات كلمات المرور، احذفه بعد الاستيراد`);
    } catch (e) { ui.toast(e.message); }
    $("adm-export").disabled = false;
  }

  async function importUsers(file) {
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const list = Array.isArray(data) ? data : data.users;
      if (!Array.isArray(list) || !list.length) throw new Error("الملف لا يحوي حسابات");
      if (!confirm(`استيراد ${ui.fmt(list.length)} حساباً إلى هذا الخادم؟\nالحسابات الموجودة لن تُستبدل، وكلمات المرور تبقى كما هي عند أصحابها.`)) return;
      const r = await App.cloud.importUsers(list);
      const why = (r.skipped || []).map((s) => `${s.username}: ${s.why}`).join("\n");
      ui.toast(`أُضيف ${ui.fmt(r.added)} حساباً${r.skipped && r.skipped.length ? `، وتُخطّي ${ui.fmt(r.skipped.length)}` : ""}`);
      if (why) console.info("حسابات لم تُستورد:\n" + why);
      await load();
    } catch (e) { ui.toast(e.message); }
  }

  /* رفع كل بيانات هذا الجهاز إلى الخادم الحالي واعتمادها — للنقل بين الخوادم */
  async function adoptDevice() {
    const s = store.get();
    const cols = App.shared.collect();
    cols.registry = { records: (s.registry || []).filter((r) => !r.deletedAt) };
    const total = Object.keys(cols).reduce((n, k) => n + cols[k].records.length, 0);
    if (!total) { ui.toast("لا توجد بيانات على هذا الجهاز"); return; }
    const detail = Object.keys(cols).filter((k) => cols[k].records.length)
      .map((k) => `${LABEL[k] || k}: ${ui.fmt(cols[k].records.length)}`).join("\n");
    if (!confirm(`رفع بيانات هذا الجهاز إلى الخادم الحالي واعتمادها؟\n\n${detail}\n\nما على الخادم من هذه القيود يُستبدل بنسخة هذا الجهاز.`)) return;
    $("adm-adopt").disabled = true;
    try {
      const r = await App.cloud.adopt(cols);
      const n = Object.keys(r.adopted || {}).reduce((a, k) => a + r.adopted[k], 0);
      // بصمات المزامنة بعد الاعتماد تبدأ من جديد
      App.shared.resetSnap();
      try { localStorage.removeItem("tamkeen-admin:reg-sync"); } catch (e) { /* تخزين غير متاح */ }
      ui.toast(`اُعتُمد ${ui.fmt(n)} سجلاً على هذا الخادم`);
      await App.shared.sync(true);
      await App.registry.syncShared(true);
      renderStats();
    } catch (e) { ui.toast(e.message); }
    $("adm-adopt").disabled = false;
  }

  function suggestPassword() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
    const a = new Uint32Array(10);
    crypto.getRandomValues(a);
    $("adm-password").value = [...a].map((n) => chars[n % chars.length]).join("");
    $("adm-password").type = "text";
  }

  async function saveDigest() {
    try {
      const r = await App.cloud.digest($("adm-digest-on").checked, Number($("adm-digest-hour").value));
      ui.toast(r.enabled ? `الملخص اليومي مفعّل الساعة ${String(r.hour).padStart(2, "0")}:00` : "أُوقف الملخص اليومي");
    } catch (e) { ui.toast(e.message); }
  }

  function render() {
    const admin = App.profile.isAdmin();
    $("adm-denied").hidden = admin;
    $("adm-body").hidden = !admin;
    if (admin && !users.length) load(); else if (admin) { renderUsers(); renderStats(); }
  }

  function init() {
    $("adm-digest-hour").innerHTML = Array.from({ length: 24 }, (_, h) => `<option value="${h}">${String(h).padStart(2, "0")}:00</option>`).join("");
    $("adm-form").addEventListener("submit", save);
    $("adm-cancel").addEventListener("click", () => openForm(null));
    $("adm-generate").addEventListener("click", suggestPassword);
    $("adm-admin").addEventListener("change", syncAdminToggle);
    $("adm-refresh").addEventListener("click", load);
    $("adm-export").addEventListener("click", exportUsers);
    $("adm-adopt").addEventListener("click", adoptDevice);
    $("adm-import").addEventListener("click", () => $("adm-import-file").click());
    $("adm-import-file").addEventListener("change", (e) => { importUsers(e.target.files[0]); e.target.value = ""; });
    $("adm-digest-save").addEventListener("click", saveDigest);
    $("adm-users").addEventListener("click", async (e) => {
      const tr = e.target.closest("tr[data-u]");
      if (!tr) return;
      const u = users.find((x) => x.username === tr.dataset.u);
      if (e.target.closest("[data-edit]")) { openForm(u); $("adm-form").scrollIntoView({ behavior: "smooth", block: "center" }); }
      if (e.target.closest("[data-del]") && confirm(`حذف حساب ${u.name}؟ لن يستطيع الدخول بعدها (قيوده وملفاته تبقى).`)) {
        try { await App.cloud.deleteUser(u.username); ui.toast(`حُذف حساب ${u.name}`); load(); } catch (err) { ui.toast(err.message); }
      }
    });
    openForm(null);
  }

  App.admin = { init, render, load, VIEWS, PERMS };
})(window.App = window.App || {});
