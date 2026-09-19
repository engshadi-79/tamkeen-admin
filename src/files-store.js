/* الملفات المرفقة (خطابات صادرة، مراسلات واردة...) داخل المتصفح (IndexedDB) على هذا الجهاز فقط */
(function (App) {
  const DB_NAME = "tamkeen-files";
  const STORE = "files";
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
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req && "result" in req ? req.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  async function put(blob, name) {
    const id = App.store.uid();
    await tx("readwrite", (s) => s.put({ id, name, blob, savedAt: new Date().toISOString() }));
    return id;
  }

  const get = (id) => tx("readonly", (s) => s.get(id));
  const remove = (id) => tx("readwrite", (s) => s.delete(id));

  async function open(id) {
    const f = await get(id);
    if (!f) { App.ui.toast("الملف غير موجود على هذا الجهاز"); return; }
    App.ui.download(f.name, f.blob);
  }

  App.filesStore = { put, get, remove, open };
})(window.App = window.App || {});
