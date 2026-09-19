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
  const get = () => ({ name: name(), admin: isAdmin() });
  const ensure = () => Promise.resolve(name());
  const notify = () => { renderBadges(); listeners.forEach((fn) => fn()); };

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
    if (!username || !password) { $("login-error").textContent = "أدخل اسم المستخدم وكلمة المرور"; return; }
    $("login-submit").disabled = true;
    $("login-error").textContent = "";
    try {
      if (setupMode) {
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

  /* ===== حسابي ===== */
  function open() {
    const u = user();
    if (!u) return;
    $("acc-name").textContent = u.name;
    $("acc-username").textContent = u.username;
    $("acc-role").textContent = u.admin ? "مدير: يعدّل ويحذف كل القيود ويدير المستخدمين" : "مستخدم: يعدّل ويحذف قيوده فقط";
    $("acc-users").hidden = !u.admin;
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

  /* ===== إدارة المستخدمين (للمدير) ===== */
  let usersCache = [];

  async function openUsers() {
    close();
    $("users-modal").classList.add("open");
    resetUserForm();
    await loadUsers();
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
          <td class="reg-actions"><button class="act-btn edit" data-uedit>✎ تعديل</button>${u.username === (user() || {}).username ? "" : ` <button class="act-btn del" data-udel>🗑 حذف</button>`}</td>
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

  function renderBadges() {
    const u = user();
    document.querySelectorAll("[data-profile]").forEach((b) => { b.textContent = u ? `👤 ${u.name}${u.admin ? " (مدير)" : ""}` : "👤 حسابي"; });
  }

  function init() {
    $("login-form").addEventListener("submit", submitLogin);
    $("acc-password-form").addEventListener("submit", changePassword);
    $("acc-logout").addEventListener("click", logout);
    $("acc-users").addEventListener("click", openUsers);
    $("profile-close").addEventListener("click", close);
    $("profile-modal").addEventListener("click", (e) => { if (e.target.id === "profile-modal") close(); });
    document.querySelectorAll("[data-profile]").forEach((b) => b.addEventListener("click", open));

    $("user-form").addEventListener("submit", saveUserForm);
    $("uf-cancel").addEventListener("click", () => resetUserForm());
    $("uf-generate").addEventListener("click", suggestPassword);
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
    if (!App.cloud.ready()) showLogin();
    else App.cloud.refreshUser().then(notify).catch(() => { /* بلا إنترنت: تبقى الجلسة المحفوظة */ });
  }

  App.profile = { init, get, name, isAdmin, ensure, open, onChange: (fn) => listeners.push(fn) };
})(window.App = window.App || {});
