/* خادم مساعد تمكين على Google Apps Script — يعمل بحساب صاحب الأداة (Execute as: Me).
   - كل الملفات المرفوعة من أي مستخدم تُحفظ في Drive هذا الحساب داخل «أرشيف مساعد تمكين».
   - سجل الوارد والصادر المشترك محفوظ في ملف tamkeen-registry.json داخل المجلد نفسه، مع نسخة احتياطية يومية.
   - الوصول برمز المركز (KEY)، وصلاحيات المدير برمز المدير (ADMIN_KEY).
   بعد أي تعديل: Deploy ← Manage deployments ← Edit ← Version: New version ← Deploy (الرابط يبقى نفسه). */

const KEY = "PUT-CENTER-CODE-HERE";
const ADMIN_KEY = "PUT-ADMIN-CODE-HERE";
const ROOT_NAME = "أرشيف مساعد تمكين";
const DATA_NAME = "tamkeen-registry.json";
const BACKUP_FOLDER = "نسخ احتياطية للسجل";
const BACKUP_KEEP = 30;

function doGet() {
  return ContentService.createTextOutput("مساعد تمكين: الخادم يعمل.");
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return out_({ error: "طلب غير صالح" }); }
  if (!req || req.key !== KEY) return out_({ error: "UNAUTHORIZED" });
  try {
    switch (req.action) {
      case "ping": return out_({ ok: true, owner: Session.getEffectiveUser().getEmail(), root: ROOT_NAME, version: 2 });
      case "sync": return out_(sync_(req.records || [], req.deleted || {}));
      case "upload": return out_(upload_(req));
      case "file": return out_(file_(req.id));
      case "reserve": return out_(reserve_(req.head, req.count));
      case "search": return out_(search_(req.q));
      case "role": return out_({ admin: !!req.admin && req.admin === ADMIN_KEY });
      case "backups": return out_(listBackups_());
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

function subFolder_(parent, name) {
  const it = parent.getFoldersByName(String(name));
  return it.hasNext() ? it.next() : parent.createFolder(String(name));
}

function dataFile_() {
  const root = root_();
  const it = root.getFilesByName(DATA_NAME);
  return it.hasNext() ? it.next() : root.createFile(DATA_NAME, JSON.stringify({ records: [], deleted: {} }), "application/json");
}

function readData_(file) {
  try { return JSON.parse(file.getBlob().getDataAsString("UTF-8")); } catch (err) { return { records: [], deleted: {} }; }
}

const stamp_ = (r) => r.updatedAt || r.createdAt || "";

/* دمج سجل الجهاز مع السجل المشترك: الأحدث تعديلاً يفوز، والحذف يُسجَّل بتاريخه */
function sync_(records, deleted) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const file = dataFile_();
    const data = readData_(file);
    const del = Object.assign({}, data.deleted || {});
    Object.keys(deleted).forEach((id) => { if (!del[id] || deleted[id] > del[id]) del[id] = deleted[id]; });
    const map = {};
    (data.records || []).forEach((r) => { map[r.id] = r; });
    records.forEach((r) => { if (r && r.id && (!map[r.id] || stamp_(r) > stamp_(map[r.id]))) map[r.id] = r; });
    Object.keys(del).forEach((id) => { if (map[id] && stamp_(map[id]) <= del[id]) delete map[id]; });
    const merged = { records: Object.keys(map).map((k) => map[k]), deleted: del };
    const json = JSON.stringify(merged);
    if (json !== JSON.stringify({ records: data.records || [], deleted: data.deleted || {} })) {
      backupDaily_(file);
      file.setContent(json);
    }
    return merged;
  } finally {
    lock.releaseLock();
  }
}

/* نسخة احتياطية واحدة في اليوم قبل أول تعديل، ويُحتفظ بآخر 30 نسخة */
function backupDaily_(file) {
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty("LAST_BACKUP") === today) return;
  const folder = subFolder_(root_(), BACKUP_FOLDER);
  file.makeCopy(`سجل الوارد والصادر - ${today}.json`, folder);
  props.setProperty("LAST_BACKUP", today);
  const files = [];
  const it = folder.getFiles();
  while (it.hasNext()) files.push(it.next());
  files.sort((a, b) => b.getDateCreated() - a.getDateCreated());
  files.slice(BACKUP_KEEP).forEach((f) => f.setTrashed(true));
}

function listBackups_() {
  const folder = subFolder_(root_(), BACKUP_FOLDER);
  const list = [];
  const it = folder.getFiles();
  while (it.hasNext()) { const f = it.next(); list.push({ name: f.getName(), link: f.getUrl(), at: f.getDateCreated().toISOString() }); }
  list.sort((a, b) => (a.at < b.at ? 1 : -1));
  return { folder: folder.getUrl(), backups: list };
}

/* حجز أرقام تسلسلية من الخادم حتى لا يأخذ جهازان الرقم نفسه. head مثل «م ت/2026/» */
function reserve_(head, count) {
  count = Math.max(1, Math.min(500, Number(count) || 1));
  head = String(head || "");
  if (!head) throw new Error("بادئة الرقم مطلوبة");
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const props = PropertiesService.getScriptProperties();
    const counterKey = "SEQ:" + head;
    let max = Number(props.getProperty(counterKey) || 0);
    (readData_(dataFile_()).records || []).forEach((r) => {
      const n = String(r.number || "");
      if (n.indexOf(head) === 0) { const v = parseInt(n.slice(head.length), 10); if (!isNaN(v) && v > max) max = v; }
    });
    const fmt = (n) => head + (String(n).length < 3 ? ("00" + n).slice(-3) : String(n));
    const numbers = [];
    for (let i = 1; i <= count; i++) numbers.push(fmt(max + i));
    props.setProperty(counterKey, String(max + count));
    return { number: numbers[0], numbers };
  } finally {
    lock.releaseLock();
  }
}

/* بحث داخل محتوى الملفات (Word و PDF و Excel…) باستخدام فهرسة Drive — داخل الأرشيف فقط */
function search_(q) {
  q = String(q || "").trim();
  if (q.length < 2) return { ids: [] };
  const safe = q.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const it = DriveApp.searchFiles(`fullText contains '${safe}' and trashed = false`);
  const rootId = root_().getId();
  const ids = [];
  let checked = 0;
  while (it.hasNext() && checked < 200 && ids.length < 100) {
    const f = it.next();
    checked++;
    if (insideRoot_(f, rootId)) ids.push(f.getId());
  }
  return { ids };
}

/* رفع ملف إلى مسار داخل الأرشيف، مثل ["أحمد", "2026", "09", "الوارد", "خطابات"] */
function upload_(req) {
  let folder = root_();
  (req.path || []).forEach((name) => { folder = subFolder_(folder, name); });
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

function insideRoot_(file, rootId) {
  rootId = rootId || root_().getId();
  let parents = file.getParents();
  for (let depth = 0; depth < 12 && parents.hasNext(); depth++) {
    const p = parents.next();
    if (p.getId() === rootId) return true;
    parents = p.getParents();
  }
  return false;
}
