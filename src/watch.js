/* مراقبة مجلد على الجهاز: كل ملف جديد أو معدَّل فيه يدخل قائمة مراجعة الوارد والصادر تلقائياً.
   يعمل بصلاحية «اختيار مجلد» في المتصفح (كروم وإيدج على الكمبيوتر). المجلد يبقى على جهازك،
   والمتصفح يطلب إذنك مرة، ويُعاد طلبه بعد إغلاق الموقع وفتحه. لا شيء يُرفع إلا ما تعتمده أنت،
   إلا إذا فعّلت «رفع تلقائي بلا مراجعة». */
(function (App) {
  const { ui } = App;
  const $ = (id) => document.getElementById(id);

  const SEEN_KEY = "tamkeen-admin:watch-seen";
  const AUTO_KEY = "tamkeen-admin:watch-auto";
  const DB = "tamkeen-watch";
  const EVERY = 60000; // فحص كل دقيقة
  const SKIP = /^~\$|^\.|\.(tmp|crdownload|part)$/i;

  let handle = null;
  let timer = null;
  let scanning = false;
  let lastScan = 0;

  const supported = () => typeof window.showDirectoryPicker === "function";
  const readSeen = () => { try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || "[]")); } catch (e) { return new Set(); } };
  const writeSeen = (s) => { try { localStorage.setItem(SEEN_KEY, JSON.stringify([...s].slice(-4000))); } catch (e) { /* تخزين ممتلئ */ } };
  const autoOn = () => { try { return localStorage.getItem(AUTO_KEY) === "on"; } catch (e) { return false; } };

  /* مقبض المجلد يُحفظ في IndexedDB ليعود بعد إعادة فتح الموقع */
  function idb(mode, fn) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore("h");
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const tx = req.result.transaction("h", mode);
        const out = fn(tx.objectStore("h"));
        tx.oncomplete = () => { req.result.close(); resolve(out && out.result !== undefined ? out.result : out); };
        tx.onerror = () => { req.result.close(); reject(tx.error); };
      };
    });
  }
  const saveHandle = (h) => idb("readwrite", (s) => s.put(h, "dir"));
  const loadHandle = () => idb("readonly", (s) => s.get("dir"));
  const clearHandle = () => idb("readwrite", (s) => s.delete("dir"));

  const permission = async (h, ask) => {
    if (!h || typeof h.queryPermission !== "function") return "denied";
    const opts = { mode: "read" };
    const cur = await h.queryPermission(opts);
    if (cur === "granted" || !ask) return cur;
    return h.requestPermission(opts);
  };

  /* كل الملفات في المجلد ومجلداته الفرعية */
  async function walk(dir, path, out, depth) {
    if ((depth || 0) > 6 || out.length > 3000) return out;
    for await (const [name, entry] of dir.entries()) {
      if (SKIP.test(name)) continue;
      if (entry.kind === "file") {
        const file = await entry.getFile().catch(() => null);
        if (file && file.size > 0) {
          file.relPath = path + name;
          out.push(file);
        }
      } else if (entry.kind === "directory") {
        await walk(entry, `${path}${name}/`, out, (depth || 0) + 1);
      }
    }
    return out;
  }

  const keyOf = (f) => `${f.relPath || f.name}|${f.size}|${f.lastModified}`;

  async function scan(manual) {
    if (!handle || scanning) return;
    const state = await permission(handle, !!manual);
    if (state !== "granted") { render(state); return; }
    scanning = true;
    render();
    try {
      const files = await walk(handle, "", [], 0);
      const seen = readSeen();
      const fresh = files.filter((f) => !seen.has(keyOf(f)));
      lastScan = Date.now();
      if (fresh.length) {
        fresh.forEach((f) => seen.add(keyOf(f)));
        writeSeen(seen);
        App.registry.addWatchedFiles(fresh, { auto: autoOn() });
        ui.toast(`المجلد المراقَب: ${ui.fmt(fresh.length)} ملفاً جديداً`);
      }
    } catch (e) {
      console.warn("مراقبة المجلد:", e);
      ui.toast("تعذّرت قراءة المجلد المراقَب: " + e.message);
    }
    scanning = false;
    render();
  }

  async function pick() {
    if (!supported()) { ui.toast("هذه الميزة تحتاج كروم أو إيدج على الكمبيوتر"); return; }
    try {
      const h = await window.showDirectoryPicker({ mode: "read", id: "tamkeen-watch" });
      handle = h;
      await saveHandle(h);
      // أول فحص يعدّ الموجود «معروفاً» فلا تُرفع ملفات قديمة دفعة واحدة
      const files = await walk(h, "", [], 0);
      const seen = new Set(files.map(keyOf));
      writeSeen(seen);
      lastScan = Date.now();
      start();
      render();
      ui.toast(`يُراقَب المجلد «${h.name}» — ${ui.fmt(files.length)} ملفاً موجوداً سابقاً لن يُرفع`);
    } catch (e) {
      if (e && e.name !== "AbortError") ui.toast(e.message);
    }
  }

  async function stop() {
    if (!confirm("إيقاف مراقبة المجلد؟")) return;
    handle = null;
    clearTimeout(timer);
    timer = null;
    await clearHandle().catch(() => {});
    try { localStorage.removeItem(SEEN_KEY); } catch (e) { /* تخزين غير متاح */ }
    render();
  }

  function start() {
    clearInterval(timer);
    timer = setInterval(() => scan(false), EVERY);
  }

  function render(state) {
    const box = $("reg-watch");
    if (!box) return;
    if (!supported()) { box.hidden = true; return; }
    box.hidden = false;
    const on = !!handle;
    $("reg-watch-start").hidden = on;
    $("reg-watch-stop").hidden = !on;
    $("reg-watch-now").hidden = !on;
    $("reg-watch-auto-wrap").hidden = !on;
    $("reg-watch-auto").checked = autoOn();
    const when = lastScan ? new Date(lastScan).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" }) : "";
    $("reg-watch-info").textContent = !on
      ? "لا يوجد مجلد مراقَب"
      : state && state !== "granted"
        ? `المجلد «${handle.name}» — اضغط «فحص الآن» للسماح بالقراءة بعد إعادة فتح الموقع`
        : `يراقب «${handle.name}»${scanning ? " — جارٍ الفحص…" : when ? ` — آخر فحص ${when}` : ""}`;
  }

  async function init() {
    if (!supported()) { render(); return; }
    try {
      handle = (await loadHandle()) || null;
    } catch (e) { handle = null; }
    // مقبض قديم غير صالح (متصفح لا يدعم إعادته): يُنسى بهدوء
    if (handle && typeof handle.queryPermission !== "function") { handle = null; await clearHandle().catch(() => {}); }
    if (handle) {
      const state = await permission(handle, false);
      if (state === "denied") { handle = null; await clearHandle().catch(() => {}); render(); }
      else { render(state); if (state === "granted") { start(); scan(false); } }
    } else render();
    $("reg-watch-start").addEventListener("click", pick);
    $("reg-watch-now").addEventListener("click", () => scan(true));
    $("reg-watch-stop").addEventListener("click", stop);
    $("reg-watch-auto").addEventListener("change", (e) => {
      try { localStorage.setItem(AUTO_KEY, e.target.checked ? "on" : "off"); } catch (err) { /* تخزين غير متاح */ }
      ui.toast(e.target.checked ? "الملفات الجديدة ستُرفع مباشرة بلا مراجعة" : "الملفات الجديدة ستدخل قائمة المراجعة");
    });
  }

  App.watch = { init, scan, supported };
})(window.App = window.App || {});
