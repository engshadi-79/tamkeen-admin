/* نافذة إعدادات Google Drive ومساعد الاتصال المشترك بين الصفحات */
(function (App) {
  const { ui } = App;
  const $ = (id) => document.getElementById(id);
  const listeners = [];

  function status() {
    const d = App.drive;
    if (d.viaCloud()) {
      const c = App.cloud.settings();
      return { text: `✓ متصل بأرشيف المركز${c.owner ? ` (${c.owner})` : ""}: كل الملفات تُحفظ في Drive هذا الحساب، والسجل مشترك بين كل الأجهزة.`, cls: "ok" };
    }
    if (!d.supportedOrigin()) return { text: "⚠ الأداة مفتوحة كملف مباشرة. للأرشفة شغّلها من «تشغيل.bat» (http://localhost:4180).", cls: "error" };
    if (!d.isConfigured()) return { text: "غير مُعدّ: أدخل مُعرّف العميل (Client ID).", cls: "" };
    const email = d.settings().email;
    if (d.hasToken()) return { text: `✓ متصل بـ Google Drive${email ? ` (${email})` : ""}.`, cls: "ok" };
    if (email) return { text: `مُعدّ بحساب ${email}. يتصل تلقائياً عند أول رفع.`, cls: "" };
    return { text: "مُعدّ، وغير متصل في هذه الجلسة. اضغط «اتصال».", cls: "" };
  }

  function renderStatus() {
    const s = status();
    $("drv-status").textContent = s.text;
    $("drv-status").className = "drv-status " + s.cls;
    $("drv-origin").textContent = location.origin && location.origin !== "null" ? location.origin : "http://localhost:4180";
    listeners.forEach((fn) => fn());
  }

  function renderUsers() {
    const list = App.drive.users();
    const me = App.drive.settings().email;
    $("drv-users").innerHTML = list.length
      ? list.map((u) => `<li><bdi dir="ltr">${ui.esc(u.email)}</bdi>${u.email === me ? ` <span class="drv-tag ok">المتصل الآن</span>` : ""}${u.inGoogle ? "" : ` <span class="drv-tag">لم يُضف في Google بعد</span>`}
          <button type="button" class="conv-link danger" data-user-del="${ui.esc(u.email)}" title="إزالة">✕</button></li>`).join("")
      : `<li class="conv-hint">لا توجد قيود: أي حساب مضاف في Google Cloud يستطيع الاتصال.</li>`;
    const pending = list.filter((u) => !u.inGoogle).length;
    $("drv-users-google").textContent = pending ? `إضافتهم في Google (${ui.fmt(pending)})` : "فتح قائمة المستخدمين في Google";
  }

  function addUsersFromInput() {
    const input = $("drv-user-input");
    if (!input.value.trim()) return;
    const { added, invalid } = App.drive.addUsers(input.value);
    input.value = invalid.join(" ");
    renderUsers();
    if (invalid.length) ui.toast(`بريد غير صحيح: ${invalid.join("، ")}`);
    else if (added.length) ui.toast(added.length === 1 ? `أُضيف ${added[0]}` : `أُضيف ${ui.fmt(added.length)} مستخدمين`);
    else ui.toast("البريد مضاف مسبقاً");
  }

  /* Google لا تتيح إضافة المستخدمين برمجياً: نُسخ القائمة وتُفتح صفحتها للصق */
  async function openGoogleUsers() {
    const pending = App.drive.users().filter((u) => !u.inGoogle).map((u) => u.email);
    if (pending.length) await ui.copyText(pending.join(", "));
    window.open(App.drive.audienceUrl(), "_blank", "noopener");
    if (pending.length && confirm(`نُسخت الإيميلات (${pending.length}).\nفي صفحة Google: Audience ← Test users ← «+ Add users»، ألصقها ثم اضغط Save.\n\nهل أتممت الإضافة في Google؟`)) {
      App.drive.markInGoogle();
      renderUsers();
    }
  }

  function open() {
    const s = App.drive.settings();
    $("drv-client").value = s.clientId;
    const c = App.cloud.settings();
    $("cloud-url").value = c.url;
    $("cloud-key").value = c.key;
    $("drv-email").value = s.email || "";
    $("drv-root").value = s.rootName;
    $("drv-auto").checked = s.autoArchive;
    $("drv-project").value = s.projectId || "";
    renderStatus();
    renderUsers();
    $("drv-modal").classList.add("open");
  }
  const close = () => $("drv-modal").classList.remove("open");

  function persist() {
    const clientId = $("drv-client").value.trim();
    const prev = App.drive.settings();
    const rootName = $("drv-root").value.trim() || "أرشيف مساعد تمكين";
    const email = $("drv-email").value.trim().toLowerCase();
    if (email !== (prev.email || "") && App.drive.hasToken()) App.drive.disconnect(); // تغيير حساب الجهاز
    App.drive.saveSettings({
      clientId,
      rootName,
      email,
      autoArchive: $("drv-auto").checked,
      projectId: $("drv-project").value.trim() || "tamkeen-archive",
      // تغيير الحساب أو اسم المجلد يُبطل ذاكرة المجلدات
      folders: clientId !== prev.clientId || rootName !== prev.rootName ? {} : prev.folders,
    });
  }

  /* يضمن الاتصال؛ يُستدعى من ضغطة زر فقط. يرجع true عند النجاح */
  async function ensureConnected() {
    if (App.drive.hasToken()) return true;
    if (!App.drive.isConfigured() || !App.drive.supportedOrigin()) { open(); return false; }
    try {
      await App.drive.connect();
      renderStatus();
      ui.toast("تم الاتصال بـ Google Drive");
      return true;
    } catch (e) {
      ui.toast(e.message);
      renderStatus();
      return false;
    }
  }

  function init() {
    $("drv-save").addEventListener("click", () => { persist(); renderStatus(); ui.toast("تم حفظ إعدادات Drive"); });
    $("drv-connect").addEventListener("click", async () => {
      persist();
      try { await App.drive.connect(); ui.toast("تم الاتصال بـ Google Drive"); } catch (e) { ui.toast(e.message); }
      renderStatus();
    });
    $("drv-disconnect").addEventListener("click", () => { App.drive.disconnect(); renderStatus(); ui.toast("تم قطع الاتصال في هذه الجلسة"); });
    $("drv-close").addEventListener("click", close);
    $("drv-modal").addEventListener("click", (e) => { if (e.target.id === "drv-modal") close(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
    document.querySelectorAll("[data-drive-settings]").forEach((b) => b.addEventListener("click", open));
    $("cloud-connect").addEventListener("click", async () => {
      const url = $("cloud-url").value.trim();
      const key = $("cloud-key").value.trim();
      if (!/^https:\/\/script\.google\.com\//.test(url)) { ui.toast("أدخل رابط خادم المركز (يبدأ بـ https://script.google.com/)"); return; }
      if (!key) { ui.toast("أدخل رمز المركز"); return; }
      $("cloud-connect").disabled = true;
      try {
        await App.cloud.test(url, key);
        ui.toast("تم الاتصال بأرشيف المركز");
        renderStatus();
        App.registry.syncShared(true);
      } catch (e) { ui.toast(e.message); }
      $("cloud-connect").disabled = false;
    });
    $("cloud-disconnect").addEventListener("click", () => {
      if (!confirm("إيقاف الاتصال بأرشيف المركز على هذا الجهاز؟ السجل الموجود على الجهاز يبقى.")) return;
      App.cloud.saveSettings({ key: "", owner: "" });
      $("cloud-key").value = "";
      renderStatus();
    });
    $("drv-user-add").addEventListener("click", addUsersFromInput);
    $("drv-user-input").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addUsersFromInput(); } });
    $("drv-users-google").addEventListener("click", () => { persist(); openGoogleUsers(); });
    $("drv-users").addEventListener("click", (e) => {
      const b = e.target.closest("[data-user-del]");
      if (!b || !confirm(`إزالة ${b.dataset.userDel} من المستخدمين المسموح لهم؟`)) return;
      App.drive.removeUser(b.dataset.userDel);
      renderUsers();
    });
  }

  App.driveUI = { init, open, ensureConnected, onChange: (fn) => listeners.push(fn) };
})(window.App = window.App || {});
