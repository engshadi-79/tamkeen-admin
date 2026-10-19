/* الحساب: شاشة الدخول (اسم مستخدم وكلمة مرور لكل شخص)، وحسابي وتغيير كلمة المرور، وإدارة المستخدمين للمدير.
   اسم الحساب يُسجَّل على كل ما يرفعه المستخدم، ويكون مجلده في أرشيف المركز. الملفات متاحة للجميع. */
(function (App) {
  const { ui, store } = App;
  const $ = (id) => document.getElementById(id);
  const esc = ui.esc;
  const listeners = [];

  const user = () => (App.cloud && App.cloud.ready() ? App.cloud.user() : null);
  const name = () => (user() && user().name) || "";
  /* المدير يعدّل ويحذف كل القيود؛ المستخدم قيوده فقط (ويطبّق الخادم القاعدة نفسها) */
  const isAdmin = () => !!(user() && user().admin);
  /* الصفحات المسموحة: الفارغ يعني الكل، ولوحة التحكم للمدير وحده */
  const canView = (view) => {
    const u = user();
    if (!u) return true;
    if (view === "admin") return !!u.admin;
    if (u.admin) return true;
    const list = u.views || [];
    return !list.length || list.includes(view);
  };
  const firstView = () => {
    const order = ["dashboard", "registry", "roster", "letters", "report", "meetings", "tasks", "tracks", "rtl", "converter", "hospitality", "sheets", "screen", "history"];
    return order.find(canView) || "dashboard";
  };
  const can = (perm) => {
    const u = user();
    if (!u || u.admin) return true;
    if (perm === "approve") return (u.perms || {}).approve === true;
    return (u.perms || {})[perm] !== false;
  };

  /* إخفاء أزرار القائمة الجانبية لما لا يُسمح به */
  /* بطاقة المستخدم في أعلى الشريط الجانبي */
  function renderSideUser() {
    const box = document.getElementById("side-user");
    if (!box) return;
    const who = name();
    box.hidden = !who;
    if (!who) return;
    document.getElementById("side-user-name").textContent = who;
    document.getElementById("side-user-role").textContent = isAdmin() ? "مدير النظام" : "مستخدم";
    document.getElementById("side-avatar").textContent = who.trim().charAt(0) || "؟";
  }

  function applyAccess() {
    renderSideUser();
    // القائمة الجانبية وحدها: تبويبات داخل الصفحات تستعمل data-view أيضاً
    document.querySelectorAll(".sidebar [data-view]").forEach((b) => { b.hidden = !canView(b.dataset.view); });
    document.querySelectorAll("[data-admin-only]").forEach((b) => { b.hidden = !isAdmin(); });
    document.querySelectorAll("[data-perm]").forEach((b) => { b.hidden = !can(b.dataset.perm); });
  }
  /* مسارات الجرد المسموح بها لهذا المستخدم: قائمة فارغة تعني كل المسارات */
  const invLocs = () => {
    const u = user();
    if (!u || u.admin) return [];
    const list = (u.perms || {}).invLocs;
    return Array.isArray(list) ? list : [];
  };
  const get = () => ({ name: name(), admin: isAdmin() });
  const ensure = () => Promise.resolve(name());
  const notify = () => { renderBadges(); applyAccess(); listeners.forEach((fn) => fn()); };

  /* ===== شاشة الدخول ===== */
  let setupMode = false;

  async function showLogin(message) {
    document.body.classList.add("locked");
    $("login-screen").hidden = false;
    $("login-error").textContent = message || "";
    $("login-password").value = "";
    try {
      const st = await App.cloud.status();
      setupMode = !st.hasUsers;
    } catch (e) {
      setupMode = false;
      $("login-error").textContent = e.message;
    }
    $("login-setup").hidden = !setupMode;
    $("login-title").textContent = setupMode ? "إنشاء حساب المدير" : "تسجيل الدخول";
    $("login-submit").textContent = setupMode ? "إنشاء الحساب والدخول" : "دخول";
    $("login-sub").textContent = setupMode
      ? "أول مرة: أنشئ حساب المدير باستخدام رمز المدير. بعدها تضيف حسابات المستخدمين من «👥 المستخدمون»."
      : "أدخل اسم المستخدم وكلمة المرور التي أعطاك إياها مدير النظام.";
    setTimeout(() => $(setupMode ? "login-admin-key" : "login-username").focus(), 50);
  }

  function hideLogin() {
    $("login-screen").hidden = true;
    document.body.classList.remove("locked");
  }

  async function submitLogin(e) {
    e.preventDefault();
    const username = $("login-username").value.trim();
    const password = $("login-password").value;
    if (!resetUser && (!username || !password)) { $("login-error").textContent = "أدخل اسم المستخدم وكلمة المرور"; return; }
    $("login-submit").disabled = true;
    $("login-error").textContent = "";
    try {
      if (resetUser) {
        const pw = $("reset-password").value;
        if (pw.length < 6) { $("login-error").textContent = "كلمة المرور 6 أحرف على الأقل"; return; }
        await App.cloud.reset(resetUser, $("reset-code").value.trim(), pw);
        resetUser = "";
        $("login-reset").hidden = true;
        $("login-fields").hidden = false;
      } else if (setupMode) {
        await App.cloud.setup({ adminKey: $("login-admin-key").value.trim(), name: $("login-name").value.trim(), username, password });
      } else {
        await App.cloud.login(username, password);
      }
      hideLogin();
      notify();
      ui.toast(`أهلاً ${name()}`);
      if (App.registry) App.registry.syncShared(true);
    } catch (err) {
      $("login-error").textContent = err.message;
      $("login-password").select();
    } finally {
      $("login-submit").disabled = false;
    }
  }

  /* الخروج: تُمسح بيانات السجل المشترك من هذا المتصفح حتى لا يراها غير المسجّل */
  function clearSharedCache() {
    store.get().registry = [];
    store.save();
    try { localStorage.removeItem("tamkeen-admin:reg-sync"); } catch (e) { /* تخزين غير متاح */ }
  }

  async function logout() {
    if (!confirm("تسجيل الخروج من هذا الجهاز؟")) return;
    await App.cloud.logout();
  }

  /* ===== نسيت كلمة المرور: رمز إلى البريد ثم كلمة مرور جديدة ===== */
  let resetUser = "";

  function showReset(username) {
    resetUser = username;
    $("login-reset").hidden = false;
    $("login-fields").hidden = true;
    $("login-title").textContent = "استعادة كلمة المرور";
    $("login-sub").textContent = `أُرسل رمز من ستة أرقام إلى بريد الحساب «${username}» إن كان مسجّلاً. اكتب الرمز وكلمة المرور الجديدة.`;
    $("login-submit").textContent = "تعيين كلمة المرور والدخول";
    setTimeout(() => $("reset-code").focus(), 50);
  }

  function hideReset() {
    resetUser = "";
    $("login-reset").hidden = true;
    $("login-fields").hidden = false;
    showLogin();
  }

  async function forgot() {
    const username = $("login-username").value.trim();
    if (!username) { $("login-error").textContent = "اكتب اسم المستخدم أولاً ثم اضغط «نسيت كلمة المرور»"; $("login-username").focus(); return; }
    $("login-error").textContent = "";
    try {
      const r = await App.cloud.forgot(username);
      ui.toast(r.message || "أُرسل الرمز إن كان الحساب موجوداً");
      showReset(username);
    } catch (e) { $("login-error").textContent = e.message; }
  }

  /* ===== حسابي ===== */
  function open() {
    const u = user();
    if (!u) return;
    $("acc-name").textContent = u.name;
    $("acc-username").textContent = u.username;
    $("acc-role").textContent = u.admin ? "مدير: يعدّل ويحذف كل القيود ويدير المستخدمين" : "مستخدم: يعدّل ويحذف قيوده فقط";
    $("acc-users").hidden = !u.admin;
    $("acc-events").hidden = !u.admin;
    ["acc-current", "acc-new", "acc-new2"].forEach((id) => { $(id).value = ""; });
    $("profile-modal").classList.add("open");
  }
  const close = () => $("profile-modal").classList.remove("open");

  async function changePassword(e) {
    e.preventDefault();
    const current = $("acc-current").value;
    const next = $("acc-new").value;
    if (next.length < 6) { ui.toast("كلمة المرور الجديدة 6 أحرف على الأقل"); return; }
    if (next !== $("acc-new2").value) { ui.toast("تأكيد كلمة المرور غير مطابق"); return; }
    try {
      await App.cloud.changePassword(current, next);
      ui.toast("تم تغيير كلمة المرور");
      ["acc-current", "acc-new", "acc-new2"].forEach((id) => { $(id).value = ""; });
    } catch (err) { ui.toast(err.message); }
  }

  /* ===== سجل أحداث النظام (محفوظ على Drive) ===== */
  async function openEvents() {
    close();
    $("sys-modal").classList.add("open");
    $("sys-list").innerHTML = `<li class="conv-hint">جارٍ التحميل…</li>`;
    try {
      const [events, info] = await Promise.all([App.cloud.events(Number($("sys-days").value) || 3, 400), App.cloud.backups()]);
      $("sys-folder").href = info.logFolder || "#";
      $("sys-folder").hidden = !info.logFolder;
      $("sys-backups").href = info.folder || "#";
      $("sys-backups").hidden = !info.folder;
      $("sys-list").innerHTML = events.length ? events.map((e) => `<li>
          <span class="act-when">${esc(e.at)}</span>
          <b>${esc(e.user)}</b> — ${esc(e.action)}
          ${e.details ? `<span class="reg-kind">${esc(e.details)}</span>` : ""}
        </li>`).join("") : `<li class="conv-hint">لا توجد أحداث في هذه المدة.</li>`;
      $("sys-count").textContent = events.length ? `${ui.fmt(events.length)} حدث` : "";
    } catch (err) {
      $("sys-list").innerHTML = `<li class="conv-hint">${esc(err.message)}</li>`;
    }
  }

  /* ===== إدارة المستخدمين (للمدير) ===== */
  let usersCache = [];

  async function openUsers() {
    close();
    $("users-modal").classList.add("open");
    $("digest-hour").innerHTML = Array.from({ length: 24 }, (_, h) => `<option value="${h}">${String(h).padStart(2, "0")}:00</option>`).join("");
    resetUserForm();
    await loadUsers();
    loadDigest();
  }

  /* الملخص اليومي: يرسله الخادم تلقائياً كل يوم */
  async function loadDigest() {
    $("digest-status").textContent = "";
    try {
      const r = await App.cloud.backups();
      const d = r.digest || { enabled: false, hour: 7 };
      $("digest-on").checked = !!d.enabled;
      $("digest-hour").value = String(d.hour || 7);
      $("digest-status").textContent = d.enabled ? `مفعّل يومياً الساعة ${String(d.hour).padStart(2, "0")}:00` : "غير مفعّل";
      if (r.folder) $("digest-status").title = "نسخ السجل الاحتياطية في Drive";
    } catch (e) { $("digest-status").textContent = e.message; }
  }

  async function saveDigest() {
    $("digest-save").disabled = true;
    try {
      const r = await App.cloud.digest($("digest-on").checked, Number($("digest-hour").value));
      $("digest-status").textContent = r.enabled ? `مفعّل يومياً الساعة ${String(r.hour).padStart(2, "0")}:00` : "غير مفعّل";
      ui.toast(r.enabled ? "سيصل الملخص يومياً لمن له بريد مسجّل" : "أُوقف الملخص اليومي");
    } catch (e) { ui.toast(e.message); }
    $("digest-save").disabled = false;
  }

  async function loadUsers() {
    $("users-list").innerHTML = `<tr><td colspan="5" class="empty">جارٍ التحميل…</td></tr>`;
    try {
      usersCache = await App.cloud.listUsers();
      usersCache.sort((a, b) => (b.admin - a.admin) || a.name.localeCompare(b.name, "ar"));
      $("users-list").innerHTML = usersCache.map((u) => `<tr data-u="${esc(u.username)}" class="${u.active ? "" : "user-off"}">
          <td><b>${esc(u.name)}</b></td>
          <td dir="ltr" style="text-align:right">${esc(u.username)}</td>
          <td>${u.admin ? "مدير" : "مستخدم"}${u.active ? "" : " · موقوف"}</td>
          <td class="reg-kind">${u.lastLogin ? esc(ui.formatDate(u.lastLogin.slice(0, 10))) : "لم يدخل بعد"}</td>
          <td class="reg-actions"><button class="act-btn edit" data-uedit><span class="material-symbols-outlined btn-ico">edit</span>تعديل</button>${u.username === (user() || {}).username ? "" : ` <button class="act-btn del" data-udel><span class="material-symbols-outlined btn-ico">delete</span>حذف</button>`}</td>
        </tr>`).join("");
    } catch (err) {
      $("users-list").innerHTML = `<tr><td colspan="5" class="empty">${esc(err.message)}</td></tr>`;
    }
  }

  function resetUserForm(u) {
    $("uf-title").textContent = u ? `تعديل: ${u.name}` : "إضافة مستخدم";
    $("uf-username").value = u ? u.username : "";
    $("uf-username").readOnly = !!u;
    $("uf-name").value = u ? u.name : "";
    $("uf-email").value = u ? u.email || "" : "";
    $("uf-password").value = "";
    $("uf-password").placeholder = u ? "اتركه فارغاً للإبقاء على كلمة المرور الحالية" : "6 أحرف على الأقل";
    $("uf-admin").checked = !!(u && u.admin);
    $("uf-active").checked = !u || u.active;
    $("uf-cancel").hidden = !u;
  }

  async function saveUserForm(e) {
    e.preventDefault();
    const data = {
      username: $("uf-username").value.trim(),
      name: $("uf-name").value.trim(),
      email: $("uf-email").value.trim(),
      password: $("uf-password").value,
      admin: $("uf-admin").checked,
      active: $("uf-active").checked,
    };
    if (!data.name) { ui.toast("اكتب الاسم الظاهر"); return; }
    $("uf-save").disabled = true;
    try {
      await App.cloud.saveUser(data);
      ui.toast(data.password ? `تم حفظ ${data.name}. أعطه اسم المستخدم «${data.username.toLowerCase()}» وكلمة المرور` : `تم حفظ ${data.name}`);
      resetUserForm();
      await loadUsers();
    } catch (err) { ui.toast(err.message); }
    $("uf-save").disabled = false;
  }

  function suggestPassword() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
    const a = new Uint32Array(10);
    crypto.getRandomValues(a);
    $("uf-password").value = [...a].map((n) => chars[n % chars.length]).join("");
    $("uf-password").type = "text";
  }

  /* ===== نسخة احتياطية شاملة: السجل وكل الأقسام، مع الملفات اختيارياً ===== */
  async function fullBackup() {
    if (typeof JSZip === "undefined") { ui.toast("تعذّر تحميل مكتبة الضغط"); return; }
    const withFiles = confirm("هل تريد تضمين ملفات الأرشيف نفسها؟\n«موافق» = السجل + كل الملفات (قد يستغرق وقتاً طويلاً)\n«إلغاء» = السجل والبيانات فقط");
    const btn = $("acc-backup");
    btn.disabled = true;
    const label = btn.textContent;
    try {
      const zip = new JSZip();
      const data = App.store.get();
      zip.file("البيانات/النسخة-الكاملة.json", App.store.exportJSON());
      zip.file("البيانات/الوارد-والصادر.json", JSON.stringify(data.registry || [], null, 2));
      if (withFiles) {
        const recs = (data.registry || []).filter((r) => !r.deletedAt && (r.driveId || r.fileId));
        for (let i = 0; i < recs.length; i++) {
          btn.textContent = `جارٍ التنزيل ${ui.fmt(i + 1)} من ${ui.fmt(recs.length)}…`;
          try {
            const f = await App.registry.fileOf(recs[i]);
            if (f) zip.file(`الملفات/${String(recs[i].number).replace(/[\\/:*?"<>|]+/g, "-")} - ${f.name}`, f.blob);
          } catch (e) { /* ملف تعذّر جلبه */ }
        }
      }
      btn.textContent = "جارٍ الضغط…";
      ui.download(`نسخة احتياطية - مساعد تمكين - ${ui.todayISO()}.zip`, await zip.generateAsync({ type: "blob" }));
      ui.toast("تم تنزيل النسخة الاحتياطية");
    } catch (e) { ui.toast(e.message); }
    btn.textContent = label;
    btn.disabled = false;
  }

  function renderBadges() {
    const u = user();
    const name = u ? u.name : "حسابي";
    const role = u ? (u.admin ? "مدير النظام" : "مستخدم معتمد") : "غير مسجَّل";
    document.querySelectorAll("[data-profile]").forEach((b) => {
      // زر الترويسة فيه اسم وصفة وصورة؛ نملأ خاناته ولا نمسح بنيته
      const slot = b.querySelector(".tt-user-copy b");
      if (slot) {
        slot.textContent = name;
        const sub = b.querySelector(".tt-user-copy small");
        if (sub) sub.textContent = role;
      } else {
        b.innerHTML = `<span class="material-symbols-outlined btn-ico">person</span>`;
        b.appendChild(document.createTextNode(u ? `${u.name}${u.admin ? " (مدير)" : ""}` : "حسابي"));
      }
    });
    const out = $("tt-logout");
    if (out) out.hidden = !u;
  }

  function init() {
    $("login-form").addEventListener("submit", submitLogin);
    $("acc-password-form").addEventListener("submit", changePassword);
    $("acc-logout").addEventListener("click", logout);
    $("tt-logout").addEventListener("click", logout);
    $("acc-logout-all").addEventListener("click", async () => {
      if (!confirm("تسجيل الخروج من كل الأجهزة التي دخلت منها؟")) return;
      try { await App.cloud.logoutAll(); ui.toast("تم الخروج من كل الأجهزة"); await App.cloud.logout(); } catch (e) { ui.toast(e.message); }
    });
    $("login-forgot").addEventListener("click", forgot);
    $("reset-cancel").addEventListener("click", hideReset);
    $("acc-backup").addEventListener("click", fullBackup);
    $("acc-users").addEventListener("click", () => { close(); location.hash = "admin"; });
    $("acc-events").addEventListener("click", openEvents);
    $("sys-days").addEventListener("change", openEvents);
    $("sys-close").addEventListener("click", () => $("sys-modal").classList.remove("open"));
    $("sys-modal").addEventListener("click", (e) => { if (e.target.id === "sys-modal") $("sys-modal").classList.remove("open"); });
    $("profile-close").addEventListener("click", close);
    $("profile-modal").addEventListener("click", (e) => { if (e.target.id === "profile-modal") close(); });
    document.querySelectorAll("[data-profile]").forEach((b) => b.addEventListener("click", open));

    $("user-form").addEventListener("submit", saveUserForm);
    $("uf-cancel").addEventListener("click", () => resetUserForm());
    $("uf-generate").addEventListener("click", suggestPassword);
    $("digest-save").addEventListener("click", saveDigest);
    $("users-close").addEventListener("click", () => $("users-modal").classList.remove("open"));
    $("users-modal").addEventListener("click", (e) => { if (e.target.id === "users-modal") $("users-modal").classList.remove("open"); });
    $("users-list").addEventListener("click", async (e) => {
      const tr = e.target.closest("tr[data-u]");
      if (!tr) return;
      const u = usersCache.find((x) => x.username === tr.dataset.u);
      if (e.target.closest("[data-uedit]")) { resetUserForm(u); $("uf-name").focus(); }
      if (e.target.closest("[data-udel]") && confirm(`حذف حساب ${u.name}؟ لن يستطيع الدخول بعد الآن (قيوده وملفاته تبقى).`)) {
        try { await App.cloud.deleteUser(u.username); ui.toast(`حُذف حساب ${u.name}`); loadUsers(); } catch (err) { ui.toast(err.message); }
      }
    });

    App.cloud.onAuth((kind) => {
      if (kind === "login") return;
      clearSharedCache();
      notify();
      close();
      showLogin(kind === "expired" ? "انتهت الجلسة أو تغيّرت كلمة المرور؛ سجّل الدخول من جديد." : "");
    });

    renderBadges();
    applyAccess();
    if (!App.cloud.ready()) showLogin(App.cloud.consumeMovedNotice ? App.cloud.consumeMovedNotice() : "");
    else App.cloud.refreshUser().then(notify).catch(() => { /* بلا إنترنت: تبقى الجلسة المحفوظة */ });
  }

  App.profile = { init, get, name, isAdmin, canView, firstView, can, invLocs, applyAccess, ensure, open, onChange: (fn) => listeners.push(fn) };
})(window.App = window.App || {});
