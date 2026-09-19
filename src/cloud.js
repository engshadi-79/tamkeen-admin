/* الخادم المشترك (Google Apps Script بحساب المركز): كل الملفات في Drive حساب واحد،
   وسجل الوارد والصادر مشترك بين كل الأجهزة. الدخول برمز المركز مرة واحدة لكل جهاز، بلا نوافذ Google. */
(function (App) {
  const STORAGE = "tamkeen-admin:cloud";
  const DEFAULT_URL = "https://script.google.com/macros/s/AKfycbyvEVh6eb827Ue-sgDtQNz1bHt-9wakgLZiVD1YNN0lIRofr5Q5CbxPBs_6jqVQsLwFbg/exec"; // خادم المركز (بحساب ostoraplus2017)

  function settings() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(STORAGE) || "{}"); } catch (e) { /* تخزين غير متاح */ }
    return Object.assign({ url: DEFAULT_URL, key: "", owner: "" }, s);
  }
  function saveSettings(patch) {
    const s = Object.assign(settings(), patch);
    try { localStorage.setItem(STORAGE, JSON.stringify(s)); } catch (e) { /* تخزين غير متاح */ }
    return s;
  }

  const ready = () => { const s = settings(); return !!(s.url && s.key); };

  async function call(action, payload, override) {
    const s = Object.assign(settings(), override || {});
    if (!s.url || !s.key) throw new Error("الخادم المشترك غير مُعدّ: أدخل رمز المركز من إعدادات Google Drive.");
    let res;
    try {
      // text/plain يتجنّب طلب التحقق المسبق (CORS) الذي لا يدعمه Apps Script
      res = await fetch(s.url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(Object.assign({ key: s.key, action }, payload || {})) });
    } catch (e) {
      throw new Error("تعذّر الوصول إلى خادم المركز. تحقق من الإنترنت.");
    }
    let data;
    try { data = await res.json(); } catch (e) { throw new Error(`رد غير متوقع من خادم المركز (${res.status}).`); }
    if (data.error === "UNAUTHORIZED") throw new Error("رمز المركز غير صحيح.");
    if (data.error) throw new Error(`خادم المركز: ${data.error}`);
    return data;
  }

  /* يتحقق من الرابط والرمز قبل حفظهما */
  async function test(url, key) {
    const r = await call("ping", null, { url, key });
    saveSettings({ url, key, owner: r.owner || "" });
    return r;
  }

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
  const reserve = async (head, count) => (await call("reserve", { head, count: count || 1 })).numbers;
  const search = async (q) => (await call("search", { q })).ids || [];
  const checkAdmin = async (admin) => !!(await call("role", { admin })).admin;
  const backups = () => call("backups");

  App.cloud = { settings, saveSettings, ready, test, upload, download, sync, reserve, search, checkAdmin, backups };
})(window.App = window.App || {});
