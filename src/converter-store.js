/* القوالب المحفوظة لـ«تحويل ملف حسب قالب» — داخل المتصفح (IndexedDB) على هذا الجهاز فقط */
(function (App) {
  const DB_NAME = "tamkeen-converter";
  const STORE = "templates";
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

  /* القائمة بدون محتوى الملفات، الأحدث أولاً */
  async function list() {
    const all = (await tx("readonly", (s) => s.getAll())) || [];
    return all
      .map(({ file, ...meta }) => meta)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  const get = (id) => tx("readonly", (s) => s.get(id));

  async function save({ name, format, headers, file }) {
    const record = { id: App.store.uid(), name, format, headers, defaultGroupBy: [], createdAt: new Date().toISOString(), file };
    await tx("readwrite", (s) => s.put(record));
    return record.id;
  }

  async function setDefaultGroupBy(id, columns) {
    const record = await get(id);
    if (!record) throw new Error("القالب غير موجود");
    record.defaultGroupBy = columns;
    await tx("readwrite", (s) => s.put(record));
  }

  const remove = (id) => tx("readwrite", (s) => s.delete(id));

  App.converterStore = { list, get, save, setDefaultGroupBy, remove };
})(window.App = window.App || {});
