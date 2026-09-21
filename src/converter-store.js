/* القوالب المحفوظة لـ«تحويل ملف حسب قالب» — مشتركة بين كل المستخدمين.
   بيانات القالب (الاسم والأعمدة والتجميع الافتراضي) قسمٌ مُزامَن كبقية الأقسام (convTemplates)،
   وملف القالب نفسه يُرفع إلى تخزين الخادم. تبقى نسخة من الملف في المتصفح (IndexedDB)
   حتى يعمل القالب بسرعة وبلا إنترنت. القوالب القديمة المحفوظة على جهاز واحد تُرفع تلقائياً. */
(function (App) {
  const DB_NAME = "tamkeen-converter";
  const STORE = "templates";
  const FOLDER = ["قوالب التحويل"];
  let dbPromise;

  function db() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        let req;
        try { req = indexedDB.open(DB_NAME, 1); } catch (e) { reject(e); return; }
        req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  async function tx(mode, fn) {
    const database = await db();
    return new Promise((resolve, reject) => {
      const t = database.transaction(STORE, mode);
      const result = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(result && "result" in result ? result.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  const now = () => new Date().toISOString();
  const cloudOn = () => !!(App.cloud && App.cloud.ready());
  const meta = () => (App.store.get().convTemplates = App.store.get().convTemplates || []);
  const find = (id) => meta().find((t) => t.id === id);
  const me = () => ((App.cloud && App.cloud.user()) || {}).name || "";

  /* القائمة المشتركة، الأحدث أولاً */
  async function list() {
    return meta()
      .map((t) => Object.assign({}, t))
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  }

  /* القالب مع ملفه: من نسخة المتصفح، وإلا من الخادم (ثم يُحفظ هنا) */
  async function get(id) {
    const m = find(id);
    if (!m) return null;
    let local = await tx("readonly", (s) => s.get(id));
    if (!local || !local.file) {
      if (!m.fileId) throw new Error(`ملف القالب «${m.name}» لم يُرفع بعد من جهاز من حفظه`);
      if (!cloudOn()) throw new Error("سجّل الدخول لتحميل ملف القالب");
      const f = await App.cloud.download(m.fileId);
      local = Object.assign({}, m, { file: f.blob, migrated: true });
      await tx("readwrite", (s) => s.put(local));
    }
    return Object.assign({}, m, { file: local.file });
  }

  /* رفع ملف القالب إلى الخادم، مرة واحدة لكل قالب */
  const uploading = new Set();
  async function uploadFile(id, file) {
    const m = find(id);
    if (!m || m.fileId || !cloudOn() || uploading.has(id)) return false;
    uploading.add(id);
    try {
      const res = await App.cloud.upload(file, `${m.name}.${m.format === "docx" ? "docx" : "xlsx"}`, FOLDER);
      const cur = find(id);
      if (!cur) return; // حُذف أثناء الرفع
      cur.fileId = res.id;
      cur.updatedAt = now();
      App.store.save();
      return true;
    } finally {
      uploading.delete(id);
    }
  }

  async function save({ name, format, headers, file }) {
    const m = { id: App.store.uid(), name, format, headers, defaultGroupBy: [], createdAt: now(), updatedAt: now(), fileId: null, owner: me() };
    await tx("readwrite", (s) => s.put(Object.assign({}, m, { file, migrated: true })));
    meta().push(m);
    App.store.save();
    uploadFile(m.id, file).catch((e) => console.warn("رفع القالب:", e.message));
    return m.id;
  }

  async function setDefaultGroupBy(id, columns) {
    const m = find(id);
    if (!m) throw new Error("القالب غير موجود");
    m.defaultGroupBy = columns;
    m.updatedAt = now();
    App.store.save();
  }

  async function remove(id) {
    App.store.get().convTemplates = meta().filter((t) => t.id !== id);
    App.store.save();
    await tx("readwrite", (s) => s.delete(id));
  }

  /* مطابقة نسخة المتصفح مع القائمة المشتركة:
     - قالب قديم محفوظ على هذا الجهاز وحده يُضاف إلى القائمة ويُرفع ملفه (مرة واحدة، بعلامة migrated)
     - قالب في القائمة بلا ملف على الخادم ونسخته هنا (انقطاع أثناء الحفظ) يُرفع الآن */
  let reconciling = null;
  function reconcile() {
    if (!cloudOn()) return Promise.resolve({ skipped: "سجّل الدخول أولاً حتى تُرفع القوالب إلى الخادم" });
    if (!reconciling) reconciling = run().finally(() => { reconciling = null; });
    return reconciling;
  }

  async function run() {
    const report = { added: 0, uploaded: 0, errors: [] };
    try {
      const all = (await tx("readonly", (s) => s.getAll())) || [];
      for (const r of all) {
        if (!r.migrated) {
          if (!find(r.id)) {
            // وقت المشاركة لا وقت الإنشاء الأصلي، حتى تحتفظ به أول مزامنة على الجهاز
            meta().push({ id: r.id, name: r.name, format: r.format, headers: r.headers || [], defaultGroupBy: r.defaultGroupBy || [], createdAt: now(), updatedAt: now(), fileId: null, owner: me() });
            report.added++;
          }
          await tx("readwrite", (s) => s.put(Object.assign({}, r, { migrated: true })));
        }
        const cur = find(r.id);
        if (cur && !cur.fileId && r.file) {
          try { if (await uploadFile(r.id, r.file)) report.uploaded++; } catch (e) { report.errors.push(`${cur.name}: ${e.message}`); }
        }
      }
      if (report.added) App.store.save();
      if ((report.added || report.uploaded) && App.converter && App.converter.refresh) App.converter.refresh();
    } catch (e) {
      report.errors.push(e.message);
    }
    return report;
  }

  /* حالة القوالب على هذا الجهاز: كم منها لم يصل الخادم بعد */
  async function status() {
    let local = [];
    try { local = (await tx("readonly", (s) => s.getAll())) || []; } catch (e) { /* IndexedDB غير متاح */ }
    const waiting = local.filter((r) => r.file && (!r.migrated || (find(r.id) && !find(r.id).fileId))).length;
    const remoteMissing = meta().filter((t) => !t.fileId && !local.some((r) => r.id === t.id)).length;
    // محفوظة هنا وليست في القائمة المشتركة: حُذفت منها (عمداً أو بخطأ)
    const orphans = local.filter((r) => r.migrated && r.file && !find(r.id)).length;
    return { signedIn: cloudOn(), waiting, remoteMissing, orphans, total: meta().length };
  }

  /* إعادة مشاركة قوالب هذا الجهاز التي خرجت من القائمة المشتركة — بمعرّفات جديدة،
     لأن الخادم يرفض إعادة معرّف حُذف خلال 24 ساعة. بطلب صريح من المستخدم فقط. */
  async function reshare() {
    if (!cloudOn()) throw new Error("سجّل الدخول أولاً");
    const local = (await tx("readonly", (s) => s.getAll())) || [];
    const orphans = local.filter((r) => r.migrated && r.file && !find(r.id));
    let done = 0;
    for (const r of orphans) {
      const m = { id: App.store.uid(), name: r.name, format: r.format, headers: r.headers || [], defaultGroupBy: r.defaultGroupBy || [], createdAt: now(), updatedAt: now(), fileId: null, owner: me() };
      await tx("readwrite", (s) => { s.delete(r.id); s.put(Object.assign({}, m, { file: r.file, migrated: true })); });
      meta().push(m);
      App.store.save();
      await uploadFile(m.id, r.file);
      done++;
    }
    return done;
  }

  let timer = null;
  const schedule = (ms) => { clearTimeout(timer); timer = setTimeout(reconcile, ms); };
  App.store.onChange(() => schedule(2000));
  if (App.cloud) App.cloud.onAuth((kind) => { if (kind === "login") schedule(4000); });
  schedule(4000);

  App.converterStore = { list, get, save, setDefaultGroupBy, remove, reconcile, status, reshare };
})(window.App = window.App || {});
