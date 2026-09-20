/* الخادم المشترك (Google Apps Script بحساب المركز): كل الملفات في Drive حساب واحد،
   وسجل الوارد والصادر مشترك بين كل الأجهزة. الدخول باسم مستخدم وكلمة مرور؛ الجلسة تُحفظ على الجهاز 30 يوماً. */
(function (App) {
  const STORAGE = "tamkeen-admin:cloud";
  const DEFAULT_URL = "https://script.google.com/macros/s/AKfycbyvEVh6eb827Ue-sgDtQNz1bHt-9wakgLZiVD1YNN0lIRofr5Q5CbxPBs_6jqVQsLwFbg/exec"; // خادم المركز (بحساب ostoraplus2017)
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
    saveSettings({ user: r.user, owner: r.owner || "" });
    return r.user;
  }
  const changePassword = (current, password) => call("password", { current, password });
  const listUsers = async () => (await call("users")).users || [];
  const saveUser = (u) => call("saveUser", { user: u });
  const deleteUser = (username) => call("deleteUser", { username });

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

  const sync = (records, deleted) => call("sync", { records, deleted });
  const syncAll = (cols) => call("syncAll", { cols });
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

  App.cloud = {
    settings, saveSettings, ready, user, status, login, setup, logout, refreshUser, changePassword,
    listUsers, saveUser, deleteUser, upload, download, sync, syncAll, people, ocr, digest, reserve, search, backups, events, forgot, reset, logoutAll,
    onAuth: (fn) => listeners.push(fn),
  };
})(window.App = window.App || {});
