/* الخادم المشترك: Supabase (Postgres + تخزين الملفات)، والسابق كان Google Apps Script على Drive.
   الدخول باسم مستخدم وكلمة مرور؛ الجلسة تُحفظ على الجهاز 30 يوماً. */
(function (App) {
  const STORAGE = "tamkeen-admin:cloud";
  const DEFAULT_URL = "https://wvgrjnwowueoiphgcrhg.supabase.co/functions/v1/tamkeen"; // خادم المركز (Supabase)
  // الخادم السابق على Drive: يبقى كما هو ويمكن الرجوع إليه بـ ?server=رابطه
  const OLD_URL = "https://script.google.com/macros/s/AKfycbyvEVh6eb827Ue-sgDtQNz1bHt-9wakgLZiVD1YNN0lIRofr5Q5CbxPBs_6jqVQsLwFbg/exec";
  const listeners = [];

  function settings() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(STORAGE) || "{}"); } catch (e) { /* تخزين غير متاح */ }
    s = Object.assign({ url: DEFAULT_URL, token: "", user: null, owner: "" }, s);
    delete s.key; // رمز المركز القديم لم يعد مستخدماً
    return s;
  }
  function saveSettings(patch) {
    const s = Object.assign(settings(), patch);
    try { localStorage.setItem(STORAGE, JSON.stringify(s)); } catch (e) { /* تخزين غير متاح */ }
    return s;
  }

  const ready = () => { const s = settings(); return !!(s.url && s.token); };
  const user = () => settings().user;
  const isTrial = () => settings().url !== DEFAULT_URL;

  /* تحويل هذا الجهاز وحده إلى خادم آخر (النسخة التجريبية على Supabase مثلاً):
     يُفتح الموقع بـ ‎?server=<الرابط>‎ ، والعودة بـ ‎?server=‎ فارغاً.
     رمز الجلسة لا ينتقل بين الخادمين، فيُمسح عند التحويل. */
  function useServer(url) {
    const next = String(url || "").trim() || DEFAULT_URL;
    if (next === settings().url) return false;
    saveSettings({ url: next, token: "", user: null, owner: "" });
    // بصمات المزامنة تخصّ الخادم السابق. لولا مسحها لظنّ الجهاز أنه رفع بياناته
    // إلى الخادم الجديد فلا يرفع شيئاً، ثم يستبدل بياناته المحلية بردّه الفارغ.
    ["tamkeen-admin:sync2", "tamkeen-admin:reg-sync"].forEach((k) => {
      try { localStorage.removeItem(k); } catch (e) { /* تخزين غير متاح */ }
    });
    return true;
  }

  /* الانتقال إلى Supabase: كل جهاز محفوظ على الخادم السابق يُنقل مرة واحدة، ويُطلب منه الدخول بكلمة مروره نفسها.
     إلا من اختار الخادم السابق صراحة (بـ ?server=) فيبقى عليه. */
  function moveToDefault() {
    const s = settings();
    if (s.url !== OLD_URL || s.pinned) return;
    useServer(DEFAULT_URL);
    saveSettings({ moved: true });
  }

  const consumeMovedNotice = () => {
    if (!settings().moved) return "";
    saveSettings({ moved: false });
    return "انتقل النظام إلى خادم جديد أسرع. سجّل الدخول مرة واحدة باسم المستخدم وكلمة المرور نفسيهما.";
  };

  function applyOverride() {
    const q = new URLSearchParams(location.search);
    if (!q.has("server")) return;
    useServer(q.get("server"));
    saveSettings({ pinned: settings().url !== DEFAULT_URL });
    q.delete("server");
    const rest = q.toString();
    history.replaceState(null, "", location.pathname + (rest ? "?" + rest : "") + location.hash);
  }

  /* شريط ظاهر حتى لا ينسى أحد أنه يعمل على خادم تجريبي */
  function banner() {
    if (!isTrial()) return;
    const bar = document.createElement("div");
    bar.className = "trial-bar no-print";
    bar.innerHTML = `<span>⚗ أنت على ${settings().url === OLD_URL ? "الخادم السابق (Drive)" : "خادم غير الخادم الرئيسي"} — بياناته منفصلة عن الخادم الرئيسي.</span>`;
    const back = document.createElement("button");
    back.type = "button";
    back.textContent = "العودة إلى الخادم الرئيسي";
    back.addEventListener("click", () => { useServer(""); saveSettings({ pinned: false }); location.reload(); });
    bar.append(back);
    document.body.prepend(bar);
    document.body.classList.add("has-trial-bar");
  }

  applyOverride();
  moveToDefault();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", banner);
  else banner();

  /* انتهاء الجلسة أو إيقاف الحساب: خروج على هذا الجهاز */
  function expire() {
    if (!settings().token) return;
    saveSettings({ token: "", user: null });
    listeners.forEach((fn) => fn("expired"));
  }

  async function call(action, payload) {
    const s = settings();
    if (!s.url) throw new Error("رابط خادم المركز غير مُعدّ.");
    let res;
    try {
      // text/plain يتجنّب طلب التحقق المسبق (CORS) الذي لا يدعمه Apps Script
      res = await fetch(s.url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(Object.assign({ token: s.token, action }, payload || {})) });
    } catch (e) {
      throw new Error("تعذّر الوصول إلى خادم المركز. تحقق من الإنترنت.");
    }
    let data;
    try { data = await res.json(); } catch (e) { throw new Error(`رد غير متوقع من خادم المركز (${res.status}).`); }
    if (data.error === "UNAUTHORIZED") {
      if (!s.token) throw new Error("خادم المركز لم يُحدَّث بعد إلى نظام الحسابات؛ حدّثه من Apps Script (النسخة 3).");
      expire();
      throw new Error("انتهت الجلسة؛ سجّل الدخول من جديد.");
    }
    if (data.error) throw new Error(data.error);
    return data;
  }

  /* ===== الدخول والحسابات ===== */
  const status = () => call("status");
  function signedIn(r) {
    saveSettings({ token: r.token, user: r.user });
    listeners.forEach((fn) => fn("login"));
    return r.user;
  }
  const login = async (username, password) => signedIn(await call("login", { username, password }));
  const setup = async (data) => signedIn(await call("setup", data));
  async function logout() {
    try { await call("logout"); } catch (e) { /* الخروج محلياً في كل الأحوال */ }
    saveSettings({ token: "", user: null });
    listeners.forEach((fn) => fn("logout"));
  }
  async function refreshUser() {
    const r = await call("ping");
    saveSettings({ user: r.user, owner: r.owner || "", realtime: r.realtime || null });
    return r.user;
  }
  const changePassword = (current, password) => call("password", { current, password });
  const listUsers = async () => (await call("users")).users || [];
  const saveUser = (u) => call("saveUser", { user: u });
  const deleteUser = (username) => call("deleteUser", { username });
  const exportUsers = async () => (await call("exportUsers")).users || [];
  const importUsers = (list) => call("importUsers", { users: list });
  const adopt = (cols) => call("adopt", { cols });
  const backupDays = async () => (await call("backupDays")).days || [];
  const restoreDay = (day) => call("restoreDay", { day });

  /* ===== الملفات والسجل ===== */
  const toBase64 = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

  async function upload(blob, name, path) {
    if (blob.size > 45 * 1024 * 1024) throw new Error(`الملف «${name}» أكبر من 45 ميغابايت.`);
    return call("upload", { name, mime: blob.type || "application/octet-stream", path, data: await toBase64(blob) });
  }

  async function download(id) {
    const r = await call("file", { id });
    const bytes = Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0));
    return { name: r.name, blob: new Blob([bytes], { type: r.mime || "application/octet-stream" }) };
  }

  const sync = (records, deleted, mark) => call("sync", { records, deleted, mark: mark || "" });
  const syncAll = (cols, marks) => call("syncAll", { cols, marks: marks || {} });
  const people = async () => (await call("people")).people || [];
  const ocr = (data, mime, name) => call("ocr", { data, mime, name });
  const digest = (enabled, hour) => call("digest", { enabled, hour });
  const reserve = async (head, count) => (await call("reserve", { head, count: count || 1 })).numbers;
  const search = async (q) => (await call("search", { q })).ids || [];
  const backups = () => call("backups");
  const events = async (days, limit) => (await call("events", { days, limit })).events || [];
  const forgot = (username) => call("forgot", { username });
  const reset = async (username, code, password) => signedIn(await call("reset", { username, code, password }));
  const logoutAll = () => call("logoutAll");
  const history = async (opts) => (await call("history", opts || {})).revisions || [];
  const revert = (revId) => call("revert", { revId });
  const legacyCopy = (id) => call("legacyCopy", { id });
  // شاشة إحصاءات نظام المركز: قراءة اللقطة، ورمز الدفع للمدير
  const stats = () => call("stats");
  const setStatsPeriod = (from, to) => call("setStatsPeriod", { from, to });
  const statsKey = () => call("statsKey");
  // جداول إكسل المستوردة لمنشئ التقارير
  const imports = () => call("imports");
  const putImport = (name, fields, rows) => call("putImport", { name, fields, rows });
  const dropImport = (name) => call("dropImport", { name });
  /* واتساب للأعمال (للمدير): الحالة والإعداد والإرسال المباشر من الخادم */
  const waStatus = () => call("waStatus");
  const waConfig = (cfg) => call("waConfig", cfg);
  const waSend = (p) => call("waSend", p);

  App.cloud = {
    settings, saveSettings, ready, user, status, login, setup, logout, refreshUser, changePassword,
    listUsers, saveUser, deleteUser, upload, download, sync, syncAll, people, ocr, digest, reserve, search, backups, events, forgot, reset, logoutAll,
    toBase64, isTrial, useServer, defaultUrl: DEFAULT_URL, oldUrl: OLD_URL, consumeMovedNotice, exportUsers, importUsers, adopt, backupDays, restoreDay, history, revert, legacyCopy, stats, statsKey, setStatsPeriod, imports, putImport, dropImport, waStatus, waConfig, waSend,
    onAuth: (fn) => listeners.push(fn),
  };
})(window.App = window.App || {});
