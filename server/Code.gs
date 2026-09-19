/* خادم مساعد تمكين على Google Apps Script — يعمل بحساب صاحب الأداة (Execute as: Me).
   - كل الملفات المرفوعة من أي مستخدم تُحفظ في Drive هذا الحساب داخل «أرشيف مساعد تمكين».
   - سجل الوارد والصادر المشترك محفوظ في ملف tamkeen-registry.json داخل المجلد نفسه، مع نسخة احتياطية يومية.
   - الدخول باسم مستخدم وكلمة مرور لكل شخص؛ كلمات المرور تُحفظ مُشفّرة (SHA-256 مع ملح) في خصائص السكربت.
   - رمز المدير (ADMIN_KEY) يُستخدم مرة واحدة فقط لإنشاء أول حساب مدير.
   بعد أي تعديل: Deploy ← Manage deployments ← Edit ← Version: New version ← Deploy (الرابط يبقى نفسه). */

const ADMIN_KEY = "PUT-ADMIN-CODE-HERE";
const ROOT_NAME = "أرشيف مساعد تمكين";
const DATA_NAME = "tamkeen-registry.json";
const BACKUP_FOLDER = "نسخ احتياطية للسجل";
const BACKUP_KEEP = 30;
const SESSION_DAYS = 30;

function doGet() {
  return ContentService.createTextOutput("مساعد تمكين: الخادم يعمل.");
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return out_({ error: "طلب غير صالح" }); }
  if (!req) return out_({ error: "طلب غير صالح" });
  try {
    // إجراءات قبل الدخول
    switch (req.action) {
      case "status": return out_({ ok: true, version: 3, hasUsers: Object.keys(users_()).length > 0 });
      case "setup": return out_(setup_(req));
      case "login": return out_(login_(req.username, req.password));
    }
    const user = session_(req.token);
    if (!user) return out_({ error: "UNAUTHORIZED" });
    switch (req.action) {
      case "ping": return out_({ ok: true, owner: Session.getEffectiveUser().getEmail(), root: ROOT_NAME, version: 3, user: publicUser_(user) });
      case "logout": return out_(logout_(req.token));
      case "password": return out_(changePassword_(user, req.current, req.password));
      case "sync": return out_(sync_(req.records || [], req.deleted || {}, user));
      case "upload": return out_(upload_(req));
      case "file": return out_(file_(req.id));
      case "reserve": return out_(reserve_(req.head, req.count));
      case "search": return out_(search_(req.q));
      case "backups": return out_(listBackups_());
    }
    if (!user.admin) return out_({ error: "هذا الإجراء للمدير فقط" });
    switch (req.action) {
      case "users": return out_({ users: Object.keys(users_()).map((u) => publicUser_(users_()[u])) });
      case "saveUser": return out_(saveUser_(req.user, user));
      case "deleteUser": return out_(deleteUser_(req.username, user));
    }
    return out_({ error: "إجراء غير معروف" });
  } catch (err) {
    return out_({ error: String((err && err.message) || err) });
  }
}

/* ===== الحسابات ===== */
const normUser_ = (u) => String(u || "").trim().toLowerCase();

function users_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty("USERS") || "{}"); } catch (err) { return {}; }
}
function saveUsers_(all) { PropertiesService.getScriptProperties().setProperty("USERS", JSON.stringify(all)); }
const publicUser_ = (u) => ({ username: u.username, name: u.name, admin: !!u.admin, active: u.active !== false, lastLogin: u.lastLogin || "" });

function hash_(password, salt) {
  let h = salt + "|" + password;
  for (let i = 0; i < 300; i++) {
    h = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + salt, Utilities.Charset.UTF_8));
  }
  return h;
}

function checkPassword_(password) {
  if (String(password || "").length < 6) throw new Error("كلمة المرور يجب أن تكون 6 أحرف على الأقل");
}

/* إنشاء أول حساب مدير برمز المدير — مرة واحدة فقط */
function setup_(req) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (Object.keys(users_()).length) throw new Error("يوجد حساب مدير مسبقاً؛ سجّل الدخول به");
    if (req.adminKey !== ADMIN_KEY) throw new Error("رمز المدير غير صحيح");
    const username = normUser_(req.username);
    if (username.length < 3) throw new Error("اسم المستخدم 3 أحرف على الأقل");
    checkPassword_(req.password);
    const salt = Utilities.getUuid();
    saveUsers_({ [username]: { username, name: String(req.name || username).trim(), admin: true, active: true, salt, hash: hash_(req.password, salt) } });
  } finally {
    lock.releaseLock();
  }
  return login_(req.username, req.password);
}

function login_(username, password) {
  const all = users_();
  const u = all[normUser_(username)];
  // نفس الرسالة للحالتين حتى لا تُكشف أسماء المستخدمين
  if (!u || u.active === false || hash_(String(password || ""), u.salt) !== u.hash) {
    Utilities.sleep(800);
    throw new Error("اسم المستخدم أو كلمة المرور غير صحيحة");
  }
  const token = Utilities.getUuid() + Utilities.getUuid();
  const props = PropertiesService.getScriptProperties();
  props.setProperty("SESS:" + token, JSON.stringify({ u: u.username, exp: Date.now() + SESSION_DAYS * 86400000 }));
  u.lastLogin = new Date().toISOString();
  saveUsers_(all);
  cleanSessions_();
  return { token, user: publicUser_(u) };
}

function session_(token) {
  if (!token) return null;
  let s;
  try { s = JSON.parse(PropertiesService.getScriptProperties().getProperty("SESS:" + token) || "null"); } catch (err) { return null; }
  if (!s || s.exp < Date.now()) return null;
  const u = users_()[s.u];
  return u && u.active !== false ? u : null;
}

function logout_(token) {
  PropertiesService.getScriptProperties().deleteProperty("SESS:" + token);
  return { ok: true };
}

/* الجلسات المنتهية أو لحسابات محذوفة تُزال */
function cleanSessions_(onlyUser) {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  const users = users_();
  Object.keys(all).forEach((k) => {
    if (k.indexOf("SESS:") !== 0) return;
    let s;
    try { s = JSON.parse(all[k]); } catch (err) { s = null; }
    if (!s || s.exp < Date.now() || !users[s.u] || users[s.u].active === false || (onlyUser && s.u === onlyUser)) props.deleteProperty(k);
  });
}

function changePassword_(user, current, password) {
  if (hash_(String(current || ""), user.salt) !== user.hash) throw new Error("كلمة المرور الحالية غير صحيحة");
  checkPassword_(password);
  const all = users_();
  const salt = Utilities.getUuid();
  Object.assign(all[user.username], { salt, hash: hash_(password, salt) });
  saveUsers_(all);
  return { ok: true };
}

/* إضافة مستخدم أو تعديله (المدير): الاسم، والصلاحية، والتفعيل، وكلمة مرور جديدة عند الحاجة */
function saveUser_(data, by) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const all = users_();
    const username = normUser_(data && data.username);
    if (username.length < 3) throw new Error("اسم المستخدم 3 أحرف على الأقل");
    const existing = all[username];
    if (!existing && !data.password) throw new Error("كلمة المرور مطلوبة للمستخدم الجديد");
    if (username === by.username && (data.admin === false || data.active === false)) throw new Error("لا يمكنك إلغاء صلاحيتك أو إيقاف حسابك بنفسك");
    const u = existing || { username };
    u.name = String(data.name || u.name || username).trim();
    u.admin = !!data.admin;
    u.active = data.active !== false;
    if (data.password) {
      checkPassword_(data.password);
      u.salt = Utilities.getUuid();
      u.hash = hash_(data.password, u.salt);
    }
    all[username] = u;
    saveUsers_(all);
    if (data.password || u.active === false) cleanSessions_(existing ? username : null); // كلمة مرور جديدة أو إيقاف: خروج من كل الأجهزة
    return { user: publicUser_(u) };
  } finally {
    lock.releaseLock();
  }
}

function deleteUser_(username, by) {
  username = normUser_(username);
  if (username === by.username) throw new Error("لا يمكنك حذف حسابك بنفسك");
  const all = users_();
  delete all[username];
  saveUsers_(all);
  cleanSessions_(username);
  return { ok: true };
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
function sync_(records, deleted, user) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const file = dataFile_();
    const data = readData_(file);
    const del = Object.assign({}, data.deleted || {});
    const map = {};
    (data.records || []).forEach((r) => { map[r.id] = r; });
    // المستخدم يعدّل ويحذف قيوده فقط، والمدير كل القيود (القيد بلا صاحب للمدير)
    const mayEdit = (r) => user.admin || (r.owner && r.owner === user.name);
    Object.keys(deleted).forEach((id) => {
      if (map[id] && !mayEdit(map[id])) return;
      if (!del[id] || deleted[id] > del[id]) del[id] = deleted[id];
    });
    records.forEach((r) => {
      if (!r || !r.id) return;
      const cur = map[r.id];
      if (!cur) { if (!user.admin || !r.owner) r.owner = user.name; map[r.id] = r; return; }
      if (stamp_(r) <= stamp_(cur)) return;
      if (mayEdit(cur)) { map[r.id] = r; return; }
      // تعديل غير مسموح على قيد الغير: يُقبل فقط ربط الرد (رُدّ عليه) دون غيره
      if (r.replyId && !cur.replyId) map[r.id] = Object.assign({}, cur, { done: true, replyId: r.replyId, replyNumber: r.replyNumber, history: r.history, updatedAt: r.updatedAt });
      else if (r.driveId && !cur.driveId) map[r.id] = Object.assign({}, cur, { driveId: r.driveId, driveLink: r.driveLink, driveFolderId: r.driveFolderId, drivePath: r.drivePath, drivePending: false, updatedAt: r.updatedAt });
    });
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
