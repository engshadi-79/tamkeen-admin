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

  /* استعادة من النسخ الاحتياطية اليومية على Drive — تُضيف الناقص ولا تحذف شيئاً */
  async function openRestore() {
    $("adm-restore").disabled = true;
    try {
      const days = await App.cloud.backupDays();
      if (!days.length) throw new Error("لا توجد نسخ احتياطية على هذا الخادم");
      $("adm-restore-day").innerHTML = days.map((d) =>
        `<option value="${esc(d.day)}">${esc(d.day)} — ${ui.fmt(d.records)} سجلاً في ${ui.fmt(d.files)} ملفاً</option>`).join("");
      $("adm-restore-modal").classList.add("open");
    } catch (e) { ui.toast(e.message); }
    $("adm-restore").disabled = false;
  }

  async function runRestore() {
    const day = $("adm-restore-day").value;
    if (!confirm(`استعادة نسخة ${day}؟\nتُضاف السجلات الناقصة فقط، ولا يُحذف أو يُستبدل شيء موجود.`)) return;
    $("adm-restore-run").disabled = true;
    try {
      const r = await App.cloud.restoreDay(day);
      const n = Object.keys(r.restored || {}).reduce((a, k) => a + r.restored[k], 0);
      $("adm-restore-modal").classList.remove("open");
      ui.toast(n ? `استُعيد ${ui.fmt(n)} سجلاً من نسخة ${day}` : `نسخة ${day} لا تحوي سجلات ناقصة`);
      App.shared.resetSnap();
      try { localStorage.removeItem("tamkeen-admin:reg-sync"); } catch (e) { /* تخزين غير متاح */ }
      await App.shared.sync(true);
      await App.registry.syncShared(true);
      renderStats();
    } catch (e) { ui.toast(e.message); }
    $("adm-restore-run").disabled = false;
  }

  /* ===== نقل كل شيء إلى خادم Supabase من داخل الخادم الحالي =====
     الملفات تُنسخ واحداً واحداً (ويُحفظ ما نُسخ فلا يعاد عند التكرار)،
     ثم تُرسل البيانات كاملة والقيود تشير إلى النسخ الجديدة، ثم الحسابات. الخادم الحالي لا يُمسّ. */
  const MOVE_TARGET = "https://wvgrjnwowueoiphgcrhg.supabase.co/functions/v1/tamkeen";
  const MOVE_MAP = "tamkeen-admin:move-map";

  function moveLog(text, cls) {
    const li = document.createElement("li");
    li.textContent = text;
    if (cls) li.className = cls;
    $("mv-log").append(li);
    li.scrollIntoView({ block: "nearest" });
  }

  function openMove() {
    const s = store.get();
    const reg = s.registry || [];
    const files = reg.filter((r) => r.driveId).length;
    const cols = App.shared.collect();
    $("mv-url").value = $("mv-url").value || MOVE_TARGET;
    $("mv-summary").innerHTML = [
      `الوارد والصادر: <b>${ui.fmt(reg.length)}</b> قيداً، منها <b>${ui.fmt(files)}</b> بمرفق`,
      ...Object.keys(cols).filter((k) => cols[k].records.length).map((k) => `${esc(LABEL[k] || k)}: <b>${ui.fmt(cols[k].records.length)}</b>`),
    ].map((t) => `<li>${t}</li>`).join("");
    $("mv-log").innerHTML = "";
    $("mv-bar").style.width = "0";
    $("mv-modal").classList.add("open");
  }

  async function runMove() {
    const url = $("mv-url").value.trim();
    const username = $("mv-user").value.trim();
    const password = $("mv-pass").value;
    if (!/^https:\/\/.+/.test(url)) { ui.toast("رابط الخادم الجديد غير صحيح"); return; }
    if (url === App.cloud.settings().url) { ui.toast("هذا هو الخادم الذي أنت عليه الآن"); return; }
    if (!username || !password) { ui.toast("اكتب اسم المستخدم وكلمة المرور على الخادم الجديد"); return; }
    $("mv-run").disabled = true;
    $("mv-log").innerHTML = "";
    let token = "";
    const remote = async (action, payload) => {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(Object.assign({ token, action }, payload || {})) });
      const data = await res.json();
      if (data.error) throw new Error(data.error === "UNAUTHORIZED" ? "انتهت الجلسة على الخادم الجديد" : data.error);
      return data;
    };
    try {
      // 1) الدخول إلى الخادم الجديد
      const login = await remote("login", { username, password });
      token = login.token;
      $("mv-pass").value = "";
      if (!login.user.admin) throw new Error("الحساب على الخادم الجديد ليس مديراً");
      moveLog(`✓ دخول إلى الخادم الجديد باسم ${login.user.name}`, "ok");

      // 2) الملفات: من الخادم الحالي إلى الجديد، واحداً واحداً
      let map = {};
      try { map = JSON.parse(localStorage.getItem(MOVE_MAP) || "{}"); } catch (e) { map = {}; }
      if (map.__target !== url) map = { __target: url };
      const saveMap = () => { try { localStorage.setItem(MOVE_MAP, JSON.stringify(map)); } catch (e) { /* تخزين غير متاح */ } };
      const withFiles = (store.get().registry || []).filter((r) => r.driveId);
      const failed = [];
      let done = 0;
      for (const r of withFiles) {
        done++;
        $("mv-bar").style.width = `${Math.round((done / Math.max(1, withFiles.length)) * 90)}%`;
        $("mv-step").textContent = `المرفقات ${ui.fmt(done)} / ${ui.fmt(withFiles.length)}`;
        if (map[r.driveId]) continue; // نُسخ في محاولة سابقة
        try {
          const f = await App.cloud.download(r.driveId);
          const path = Array.isArray(r.drivePath) ? r.drivePath : String(r.drivePath || "أرشيف").split("/").map((x) => x.trim()).filter(Boolean);
          const up = await remote("upload", { name: r.fileName || f.name, mime: f.blob.type || "application/octet-stream", path, data: await App.cloud.toBase64(f.blob) });
          map[r.driveId] = { id: up.id, link: up.link };
          saveMap();
        } catch (e) {
          failed.push(r);
          moveLog(`✗ ${r.number || ""} — ${r.fileName || ""}: ${e.message}`, "bad");
        }
      }
      moveLog(`${failed.length ? "⚠" : "✓"} المرفقات: نُسخ ${ui.fmt(withFiles.length - failed.length)} من ${ui.fmt(withFiles.length)}`, failed.length ? "warn" : "ok");

      // 3) البيانات: القيود تشير إلى النسخ الجديدة، وكل قسم يصبح نسخة مطابقة
      $("mv-step").textContent = "البيانات…";
      const registry = (store.get().registry || []).map((r) => {
        const m = r.driveId && map[r.driveId];
        return m ? Object.assign({}, r, { driveId: m.id, driveLink: m.link, driveFolderId: "", legacyDriveId: r.driveId }) : r;
      });
      const cols = App.shared.collect();
      cols.registry = { records: registry };
      const ad = await remote("adopt", { cols, replace: true });
      Object.keys(ad.adopted || {}).forEach((k) => {
        if (ad.adopted[k] || (ad.removed || {})[k]) moveLog(`✓ ${LABEL[k] || k}: ${ui.fmt(ad.adopted[k])}${(ad.removed || {})[k] ? ` (وحُذف ${ui.fmt(ad.removed[k])} زائداً)` : ""}`, "ok");
      });

      // 4) الحسابات
      $("mv-step").textContent = "الحسابات…";
      const users = await App.cloud.exportUsers();
      const imp = await remote("importUsers", { users });
      moveLog(`✓ الحسابات: أُضيف ${ui.fmt(imp.added)}، وكان موجوداً ${ui.fmt((imp.skipped || []).length)}`, "ok");

      try { await remote("logout"); } catch (e) { /* الجلسة تنتهي وحدها */ }
      $("mv-bar").style.width = "100%";
      $("mv-step").textContent = failed.length ? `انتهى — ${ui.fmt(failed.length)} مرفقاً لم يُنسخ، أعد التشغيل لإكمالها` : "انتهى النقل بنجاح";
      moveLog("الخادم الحالي لم يُمسّ، وما زال يعمل للجميع.", "");
    } catch (e) {
      moveLog(`✗ ${e.message}`, "bad");
      $("mv-step").textContent = "توقّف النقل — يمكن إعادة التشغيل ويكمل من حيث توقّف";
    }
    $("mv-run").disabled = false;
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
    $("adm-move").addEventListener("click", openMove);
    $("mv-run").addEventListener("click", runMove);
    $("mv-cancel").addEventListener("click", () => $("mv-modal").classList.remove("open"));
    $("adm-restore").addEventListener("click", openRestore);
    $("adm-restore-run").addEventListener("click", runRestore);
    $("adm-restore-cancel").addEventListener("click", () => $("adm-restore-modal").classList.remove("open"));
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
