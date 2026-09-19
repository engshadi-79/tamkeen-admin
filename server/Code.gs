/* خادم مساعد تمكين على Google Apps Script — يعمل بحساب صاحب الأداة (Execute as: Me).
   - كل الملفات المرفوعة من أي مستخدم تُحفظ في Drive هذا الحساب داخل «أرشيف مساعد تمكين».
   - سجل الوارد والصادر المشترك محفوظ في ملف tamkeen-registry.json داخل المجلد نفسه.
   - الوصول برمز المركز فقط (KEY)؛ تغييره ثم «Deploy ← Manage deployments ← Edit ← New version» يُلغي كل الأجهزة القديمة.
   النشر: Deploy ← New deployment ← Web app ← Execute as: Me ← Who has access: Anyone. */

const KEY = "PUT-CENTER-CODE-HERE";
const ROOT_NAME = "أرشيف مساعد تمكين";
const DATA_NAME = "tamkeen-registry.json";

function doGet() {
  return ContentService.createTextOutput("مساعد تمكين: الخادم يعمل.");
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return out_({ error: "طلب غير صالح" }); }
  if (!req || req.key !== KEY) return out_({ error: "UNAUTHORIZED" });
  try {
    switch (req.action) {
      case "ping": return out_({ ok: true, owner: Session.getEffectiveUser().getEmail(), root: ROOT_NAME });
      case "sync": return out_(sync_(req.records || [], req.deleted || {}));
      case "upload": return out_(upload_(req));
      case "file": return out_(file_(req.id));
    }
    return out_({ error: "إجراء غير معروف" });
  } catch (err) {
    return out_({ error: String((err && err.message) || err) });
  }
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* مجلد الأرشيف (يُنشأ إن لم يوجد)؛ معرّفه محفوظ في خصائص السكربت */
function root_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty("ROOT_ID");
  if (id) {
    try { const f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (err) { /* حُذف المجلد */ }
  }
  const it = DriveApp.getRootFolder().getFoldersByName(ROOT_NAME);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(ROOT_NAME);
  props.setProperty("ROOT_ID", folder.getId());
  return folder;
}

function dataFile_() {
  const root = root_();
  const it = root.getFilesByName(DATA_NAME);
  return it.hasNext() ? it.next() : root.createFile(DATA_NAME, JSON.stringify({ records: [], deleted: {} }), "application/json");
}

const stamp_ = (r) => r.updatedAt || r.createdAt || "";

/* دمج سجل الجهاز مع السجل المشترك: الأحدث تعديلاً يفوز، والحذف يُسجَّل بتاريخه */
function sync_(records, deleted) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const file = dataFile_();
    let data;
    try { data = JSON.parse(file.getBlob().getDataAsString("UTF-8")); } catch (err) { data = { records: [], deleted: {} }; }
    const del = Object.assign({}, data.deleted || {});
    Object.keys(deleted).forEach((id) => { if (!del[id] || deleted[id] > del[id]) del[id] = deleted[id]; });
    const map = {};
    (data.records || []).forEach((r) => { map[r.id] = r; });
    records.forEach((r) => { if (r && r.id && (!map[r.id] || stamp_(r) > stamp_(map[r.id]))) map[r.id] = r; });
    Object.keys(del).forEach((id) => { if (map[id] && stamp_(map[id]) <= del[id]) delete map[id]; });
    const merged = { records: Object.keys(map).map((k) => map[k]), deleted: del };
    const json = JSON.stringify(merged);
    if (json !== JSON.stringify({ records: data.records || [], deleted: data.deleted || {} })) file.setContent(json);
    return merged;
  } finally {
    lock.releaseLock();
  }
}

/* رفع ملف إلى مسار داخل الأرشيف، مثل ["2026", "09", "الوارد", "خطابات"] */
function upload_(req) {
  let folder = root_();
  (req.path || []).forEach((name) => {
    const it = folder.getFoldersByName(String(name));
    folder = it.hasNext() ? it.next() : folder.createFolder(String(name));
  });
  const blob = Utilities.newBlob(Utilities.base64Decode(req.data), req.mime || "application/octet-stream", req.name || "ملف");
  const file = folder.createFile(blob);
  return { id: file.getId(), link: file.getUrl(), folderId: folder.getId() };
}

/* تنزيل ملف لعرضه على جهاز آخر — فقط الملفات الموجودة داخل مجلد الأرشيف */
function file_(id) {
  const file = DriveApp.getFileById(id);
  if (!insideRoot_(file)) throw new Error("الملف خارج مجلد الأرشيف");
  const blob = file.getBlob();
  return { name: file.getName(), mime: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()) };
}

function insideRoot_(file) {
  const rootId = root_().getId();
  let parents = file.getParents();
  for (let depth = 0; depth < 12 && parents.hasNext(); depth++) {
    const p = parents.next();
    if (p.getId() === rootId) return true;
    parents = p.getParents();
  }
  return false;
}
