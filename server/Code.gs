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
const LOG_FOLDER = "سجل أحداث النظام";
const BACKUP_KEEP = 180; // 30 يوماً × 6 ملفات
const SESSION_DAYS = 30;

/* صفحة التحقق من صحة خطاب صادر: تُفتح بمسح رمز QR المطبوع عليه، بلا تسجيل دخول */
function doGet(e) {
  const code = e && e.parameter && e.parameter.v;
  if (!code) return HtmlService.createHtmlOutput(page_("مساعد تمكين", "<p>الخادم يعمل.</p>"));
  const rec = (readData_(dataFile_()).records || []).find((r) => r.verifyId === code && !r.deletedAt);
  if (!rec) return HtmlService.createHtmlOutput(page_("تحقق من خطاب", "<p class='bad'>لا يوجد خطاب بهذا الرمز. تأكد من مسح الرمز كاملاً.</p>"));
  const row = (k, v) => (v ? `<tr><th>${esc_(k)}</th><td>${esc_(v)}</td></tr>` : "");
  return HtmlService.createHtmlOutput(page_("تحقق من خطاب", `
    <p class="ok">✓ خطاب صادر فعلاً من مركز مسارات التمكين</p>
    <table>
      ${row("رقم الصادر", rec.number)}
      ${row("التاريخ", rec.date)}
      ${row("الموضوع", rec.subject)}
      ${row("الجهة", rec.party)}
      ${row("أصدره", rec.owner)}
    </table>`));
}

const esc_ = (t) => String(t == null ? "" : t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function page_(title, body) {
  return `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc_(title)}</title>
    <style>body{font-family:Tahoma,Arial;background:#f4f6fa;margin:0;padding:24px;color:#1b2433}
    .card{max-width:520px;margin:0 auto;background:#fff;border-radius:14px;padding:22px;box-shadow:0 2px 12px rgba(0,0,0,.08)}
    h1{font-size:19px;color:#0b1f3a;margin:0 0 14px}.ok{color:#0f8b8d;font-weight:700}.bad{color:#c0392b;font-weight:700}
    table{width:100%;border-collapse:collapse;margin-top:10px}th,td{border-bottom:1px solid #e6eaf0;padding:8px;text-align:right}
    th{width:35%;color:#5f6b7d;font-weight:700}</style></head>
    <body><div class="card"><h1>مساعد تمكين الإداري — التحقق من المراسلات</h1>${body}</div></body></html>`;
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return out_({ error: "طلب غير صالح" }); }
  if (!req) return out_({ error: "طلب غير صالح" });
  try {
    // إجراءات قبل الدخول
    switch (req.action) {
      case "status": return out_({ ok: true, version: 12, hasUsers: Object.keys(users_()).length > 0, webUrl: ScriptApp.getService().getUrl() });
      case "setup": return out_(setup_(req));
      case "login": {
        const res = login_(req.username, req.password);
        log_(res.user.name, "دخول", "");
        return out_(res);
      }
      case "forgot": return out_(forgot_(req.username));
      case "reset": return out_(reset_(req.username, req.code, req.password));
    }
    const user = session_(req.token);
    if (!user) return out_({ error: "UNAUTHORIZED" });
    logRequest_(user, req);
    switch (req.action) {
      case "ping": return out_({ ok: true, owner: Session.getEffectiveUser().getEmail(), root: ROOT_NAME, version: 12, user: publicUser_(user), webUrl: ScriptApp.getService().getUrl() });
      case "logout": return out_(logout_(req.token));
      case "password": return out_(changePassword_(user, req.current, req.password));
      case "logoutAll": return out_((cleanSessions_(user.username), { ok: true }));
      case "sync": return out_(sync_(req.records || [], req.deleted || {}, user));
      case "syncAll": return out_(syncAll_(req.cols || {}));
      case "people": return out_({ people: Object.keys(users_()).map((u) => users_()[u]).filter((u) => u.active !== false).map((u) => ({ name: u.name, username: u.username })) });
      case "ocr": return out_(ocr_(req));
      case "upload": return out_(upload_(req));
      case "file": return out_(file_(req.id));
      case "reserve": return out_(reserve_(req.head, req.count));
      case "search": return out_(search_(req.q));
      case "backups": return out_(Object.assign(listBackups_(), { digest: digestState_(), logFolder: subFolder_(root_(), LOG_FOLDER).getUrl() }));
      case "events": return out_({ events: readLog_(Number(req.days) || 3, Number(req.limit) || 300) });
    }
    if (!user.admin) return out_({ error: "هذا الإجراء للمدير فقط" });
    switch (req.action) {
      case "users": return out_({ users: Object.keys(users_()).map((u) => publicUser_(users_()[u])) });
      case "digest": return out_(setupDigest_(req.enabled, req.hour));
      case "saveUser": return out_(saveUser_(req.user, user));
      case "adopt": return out_(adopt_(req.cols || {}, user));
      case "backupDays": return out_({ days: backupDays_() });
      case "restoreDay": return out_(restoreDay_(req.day, user));
      case "exportUsers": return out_(exportUsers_());
      case "importUsers": return out_(importUsers_(req.users, user));
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
const publicUser_ = (u) => ({
  username: u.username, name: u.name, email: u.email || "", admin: !!u.admin,
  active: u.active !== false, lastLogin: u.lastLogin || "",
  views: u.views || [],   // الصفحات المسموح له بها (فارغ = الكل)
  perms: u.perms || {},   // صلاحيات إضافية مثل الحذف والرفع والتصدير
});

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
    saveUsers_({ [username]: { username, name: String(req.name || username).trim(), email: String(req.email || "").trim(), admin: true, active: true, salt, hash: hash_(req.password, salt) } });
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

/* نسيت كلمة المرور: رمز من 6 أرقام يصل إلى بريد المستخدم المسجّل، صالح 30 دقيقة */
function forgot_(username) {
  const u = users_()[normUser_(username)];
  // الرد نفسه دائماً حتى لا يُكشف وجود الحساب أو بريده
  const answer = { ok: true, message: "إن كان الحساب موجوداً وله بريد مسجّل فسيصلك رمز خلال دقائق." };
  if (!u || !u.email || u.active === false) return answer;
  const code = String(Math.floor(100000 + Math.random() * 900000));
  PropertiesService.getScriptProperties().setProperty("RESET:" + u.username, JSON.stringify({ code, exp: Date.now() + 30 * 60000 }));
  MailApp.sendEmail({
    to: u.email,
    subject: "مساعد تمكين: رمز استعادة كلمة المرور",
    htmlBody: `<div dir="rtl" style="font-family:Tahoma,Arial"><p>مرحباً ${esc_(u.name)},</p>
      <p>رمز استعادة كلمة المرور الخاص بك هو: <b style="font-size:20px;letter-spacing:3px">${code}</b></p>
      <p>الرمز صالح لمدة 30 دقيقة. إن لم تطلبه فتجاهل هذه الرسالة.</p></div>`,
  });
  return answer;
}

function reset_(username, code, password) {
  const key = "RESET:" + normUser_(username);
  const props = PropertiesService.getScriptProperties();
  let saved;
  try { saved = JSON.parse(props.getProperty(key) || "null"); } catch (err) { saved = null; }
  if (!saved || saved.exp < Date.now() || String(code || "").trim() !== saved.code) throw new Error("الرمز غير صحيح أو منتهي الصلاحية");
  checkPassword_(password);
  const all = users_();
  const u = all[normUser_(username)];
  if (!u) throw new Error("الحساب غير موجود");
  const salt = Utilities.getUuid();
  Object.assign(u, { salt, hash: hash_(password, salt) });
  saveUsers_(all);
  props.deleteProperty(key);
  cleanSessions_(u.username); // خروج من كل الأجهزة بعد تغيير كلمة المرور
  return login_(username, password);
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
    if (data.email !== undefined) u.email = String(data.email || "").trim();
    if (data.views !== undefined) u.views = (data.views || []).map(String).slice(0, 40);
    if (data.perms !== undefined) u.perms = data.perms || {};
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

/* اعتماد بيانات جهاز كاملة على هذا الخادم (للنقل بين الخوادم):
   يُكتب كل سجل بلا مقارنة وقت، وتُزال شواهد الحذف عن معرّفاته. للمدير وحده. */
function adopt_(cols, user) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(45000)) throw new Error("الخادم مشغول، أعد المحاولة بعد لحظات");
  try {
    const adopted = {};
    Object.keys(cols || {}).forEach((name) => {
      if (name !== "registry" && !isCol_(name)) return;
      const recs = (cols[name].records || []).filter((r) => r && r.id);
      adopted[name] = 0;
      if (!recs.length) return;
      const file = name === "registry" ? dataFile_() : colFile_(name);
      const data = readData_(file);
      const map = {};
      (data.records || []).forEach((r) => { map[r.id] = r; });
      const del = Object.assign({}, data.deleted || {});
      // قيد بلا صاحب يُنسب لمن اعتمد النقل
      recs.forEach((r) => { if (!r.owner) r.owner = user.name; map[r.id] = r; delete del[r.id]; });
      file.setContent(JSON.stringify({ records: Object.keys(map).map((k) => map[k]), deleted: del }));
      adopted[name] = recs.length;
    });
    log_(user.name, "اعتماد بيانات جهاز", Object.keys(adopted).map((k) => k + ": " + adopted[k]).join(" · "));
    return { adopted: adopted };
  } finally {
    lock.releaseLock();
  }
}

/* تصدير الحسابات لنقلها إلى خادم آخر: تُنقل بصمة كلمة المرور لا الكلمة نفسها،
   فيدخل كل مستخدم بكلمته القديمة كما هي. */
function exportUsers_() {
  const all = users_();
  return {
    algo: "gas300",
    users: Object.keys(all).map((k) => {
      const u = all[k];
      return {
        username: u.username, name: u.name, email: u.email || "", admin: !!u.admin,
        active: u.active !== false, salt: u.salt, hash: u.hash, algo: "gas300",
        views: u.views || [], perms: u.perms || {}, lastLogin: u.lastLogin || "",
      };
    }),
  };
}

/* استيراد حسابات من خادم آخر: الموجود لا يُستبدل، وحساب المستورِد لا يُمسّ */
function importUsers_(list, by) {
  if (!Array.isArray(list) || !list.length) throw new Error("لا توجد حسابات في الملف");
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const all = users_();
    const skipped = [];
    let added = 0;
    list.forEach((u) => {
      const username = normUser_(u && u.username);
      if (username.length < 3 || !u.salt || !u.hash) { skipped.push({ username: (u && u.username) || "?", why: "بيانات ناقصة" }); return; }
      if (all[username]) { skipped.push({ username, why: "موجود مسبقاً" }); return; }
      // هذا الخادم لا يفهم إلا تشفيره؛ كلمة مرور بتشفير آخر لا يمكن التحقق منها
      if (u.algo && u.algo !== "gas300") { skipped.push({ username, why: "تشفير كلمة المرور غير مدعوم هنا" }); return; }
      all[username] = {
        username, name: String(u.name || username).trim(), email: String(u.email || "").trim(),
        admin: !!u.admin, active: u.active !== false, salt: u.salt, hash: u.hash,
        views: u.views || [], perms: u.perms || {},
      };
      added++;
    });
    saveUsers_(all);
    log_(by.name, "استيراد حسابات", `أُضيف ${added}، وتُخطّي ${skipped.length}`);
    return { added, skipped };
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
const RESURRECT_MS = 24 * 3600 * 1000;
/* سجل حُذف قبل قليل لا يعود إلا إذا أُعيد إنشاؤه فعلاً بعد الحذف بمدة كافية
   (جهاز قديم يعيد رفع نسخته يختم سجلاته بوقت جديد، فيبدو أحدث من الحذف) */
function resurrects_(rec, delAt) {
  if (!delAt) return false;
  const t = Date.parse(stamp_(rec));
  const d = Date.parse(delAt);
  return !(t && d) || t - d < RESURRECT_MS;
}

/* دمج سجل الجهاز مع السجل المشترك: الأحدث تعديلاً يفوز، والحذف يُسجَّل بتاريخه */
function sync_(records, deleted, user) {
  // بلا تغييرات: قراءة فقط بلا قفل
  if (!records.length && !Object.keys(deleted).length) return readData_(dataFile_());
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(45000)) throw new Error("الخادم مشغول بمزامنة أخرى، أعد المحاولة بعد لحظات");
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
      if (del[r.id] && resurrects_(r, del[r.id])) return; // قيد محذوف حديثاً لا يعود
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

/* ===== الأقسام المشتركة الأخرى: كل قسم ملف JSON مستقل، والدمج بنفس قاعدة السجل ===== */
// أقسام مشتركة: أي اسم لاتيني قصير مسموح، فلا يحتاج كل قسم جديد تحديث الخادم
const COL_NAME = /^[A-Za-z][A-Za-z0-9]{2,24}$/;
const isCol_ = (name) => COL_NAME.test(String(name || ""));

function colFile_(name) {
  const root = root_();
  const fname = `tamkeen-${name}.json`;
  const it = root.getFilesByName(fname);
  return it.hasNext() ? it.next() : root.createFile(fname, JSON.stringify({ records: [], deleted: {} }), "application/json");
}

function syncAll_(cols) {
  const result = {};
  const names = Object.keys(cols).filter(isCol_);
  // قسم بلا تغييرات: قراءة فقط، بلا قفل ولا كتابة (يخفّف الازدحام كثيراً)
  const writes = names.filter((n) => ((cols[n].records || []).length || Object.keys(cols[n].deleted || {}).length));
  names.filter((n) => writes.indexOf(n) === -1).forEach((n) => { result[n] = readData_(colFile_(n)); });
  if (!writes.length) return result;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(45000)) throw new Error("الخادم مشغول بمزامنة أخرى، أعد المحاولة بعد لحظات");
  try {
    writes.forEach((name) => {
      const file = colFile_(name);
      const data = readData_(file);
      const incoming = cols[name] || {};
      const del = Object.assign({}, data.deleted || {});
      Object.keys(incoming.deleted || {}).forEach((id) => { if (!del[id] || incoming.deleted[id] > del[id]) del[id] = incoming.deleted[id]; });
      const map = {};
      (data.records || []).forEach((r) => { map[r.id] = r; });
      (incoming.records || []).forEach((r) => {
        if (!r || !r.id) return;
        if (del[r.id] && resurrects_(r, del[r.id])) return; // محذوف حديثاً: يُتجاهل
        if (!map[r.id] || stamp_(r) > stamp_(map[r.id])) map[r.id] = r;
      });
      Object.keys(del).forEach((id) => { if (map[id] && stamp_(map[id]) <= del[id]) delete map[id]; });
      const merged = { records: Object.keys(map).map((k) => map[k]), deleted: del };
      const json = JSON.stringify(merged);
      if (json !== JSON.stringify({ records: data.records || [], deleted: data.deleted || {} })) file.setContent(json);
      result[name] = merged;
    });
    return result;
  } finally {
    lock.releaseLock();
  }
}

/* ===== قراءة خطاب ممسوح ضوئياً (OCR) عبر تحويله إلى مستند Google مؤقت ===== */
function ocr_(req) {
  const token = ScriptApp.getOAuthToken();
  const boundary = "tamkeenocr" + Utilities.getUuid();
  const meta = JSON.stringify({ name: "OCR " + (req.name || "ملف"), mimeType: "application/vnd.google-apps.document" });
  const payload = Utilities.newBlob(
    "--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + meta + "\r\n" +
    "--" + boundary + "\r\nContent-Type: " + (req.mime || "application/pdf") + "\r\nContent-Transfer-Encoding: base64\r\n\r\n" + req.data + "\r\n" +
    "--" + boundary + "--"
  ).getBytes();
  const up = UrlFetchApp.fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&ocrLanguage=" + encodeURIComponent(req.lang || "ar"), {
    method: "post",
    contentType: "multipart/related; boundary=" + boundary,
    payload: payload,
    headers: { Authorization: "Bearer " + token },
    muteHttpExceptions: true,
  });
  if (up.getResponseCode() >= 300) throw new Error("تعذّرت قراءة الملف: " + up.getContentText().slice(0, 150));
  const id = JSON.parse(up.getContentText()).id;
  try {
    const res = UrlFetchApp.fetch(`https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=text/plain`, {
      headers: { Authorization: "Bearer " + token },
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() >= 300) throw new Error("تعذّر استخراج النص");
    return { text: res.getContentText().slice(0, 20000) };
  } finally {
    try { DriveApp.getFileById(id).setTrashed(true); } catch (err) { /* الملف المؤقت */ }
  }
}

/* ===== الملخص اليومي بالبريد ===== */
function setupDigest_(enabled, hour) {
  ScriptApp.getProjectTriggers().forEach((t) => { if (t.getHandlerFunction() === "dailyDigest") ScriptApp.deleteTrigger(t); });
  const props = PropertiesService.getScriptProperties();
  if (!enabled) { props.deleteProperty("DIGEST"); return { enabled: false }; }
  const h = Math.min(23, Math.max(0, Number(hour) || 7));
  ScriptApp.newTrigger("dailyDigest").timeBased().atHour(h).everyDays(1).create();
  props.setProperty("DIGEST", String(h));
  return { enabled: true, hour: h };
}

function digestState_() {
  const h = PropertiesService.getScriptProperties().getProperty("DIGEST");
  return { enabled: h !== null, hour: Number(h || 7) };
}

/* يُرسل تلقائياً كل يوم: الوارد المتأخر والمهام المستحقة لكل مستخدم، والمدير يرى الجميع */
function dailyDigest() {
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  const reg = (readData_(dataFile_()).records || []).filter((r) => !r.deletedAt);
  const tasks = (readData_(colFile_("tasks")).records || []).filter((t) => !t.done);
  const lateIn = reg.filter((r) => r.type === "in" && r.dueDate && !r.done && r.dueDate <= today);
  const lateTasks = tasks.filter((t) => t.dueDate && t.dueDate <= today);
  const users = users_();
  Object.keys(users).forEach((k) => {
    const u = users[k];
    if (!u.email || u.active === false) return;
    const mine = (list, field) => (u.admin ? list : list.filter((x) => (x[field] || "") === u.name));
    const rows = mine(lateIn, "owner");
    const myTasks = mine(lateTasks, "owner");
    if (!rows.length && !myTasks.length) return;
    const li = (t) => `<li>${t}</li>`;
    const html = `<div dir="rtl" style="font-family:Tahoma,Arial">
      <h3>مساعد تمكين: متابعة ${today}</h3>
      ${rows.length ? `<p><b>وارد بحاجة إلى رد أو معالجة (${rows.length}):</b></p><ul>${rows.map((r) => li(`${r.number} — ${r.subject || ""} ${r.party ? "(" + r.party + ")" : ""} — حتى ${r.dueDate}`)).join("")}</ul>` : ""}
      ${myTasks.length ? `<p><b>مهام مستحقة (${myTasks.length}):</b></p><ul>${myTasks.map((t) => li(`${t.text} — حتى ${t.dueDate}${t.owner ? " — " + t.owner : ""}`)).join("")}</ul>` : ""}
      <p style="color:#5f6b7d;font-size:12px">رسالة تلقائية من مساعد تمكين الإداري.</p></div>`;
    MailApp.sendEmail({ to: u.email, subject: `مساعد تمكين: ${rows.length + myTasks.length} بند يحتاج متابعة`, htmlBody: html });
  });
}

/* ===== سجل أحداث النظام على Drive: ملف CSV لكل يوم يفتحه Excel مباشرة ===== */
function logFile_(day) {
  const folder = subFolder_(root_(), LOG_FOLDER);
  const name = `أحداث ${day}.csv`;
  const it = folder.getFilesByName(name);
  if (it.hasNext()) return it.next();
  // BOM ليقرأ Excel العربية بشكل صحيح
  return folder.createFile(name, "\ufeffالوقت,المستخدم,الإجراء,التفاصيل\n", "text/csv");
}

const csv_ = (v) => `"${String(v == null ? "" : v).replace(/"/g, "\"\"").replace(/[\r\n]+/g, " ")}"`;

function log_(who, action, details) {
  try {
    const tz = Session.getScriptTimeZone();
    const now = new Date();
    const file = logFile_(Utilities.formatDate(now, tz, "yyyy-MM-dd"));
    const line = [csv_(Utilities.formatDate(now, tz, "yyyy-MM-dd HH:mm:ss")), csv_(who), csv_(action), csv_(details)].join(",") + "\n";
    file.setContent(file.getBlob().getDataAsString("UTF-8") + line);
  } catch (err) { /* السجل لا يعطّل العمل */ }
}

/* وصف مختصر لكل طلب يصل من الأداة */
function logRequest_(user, req) {
  const a = req.action;
  if (a === "ping" || a === "status" || a === "people" || a === "events" || a === "backups") return;
  if (a === "sync") {
    const n = (req.records || []).length;
    const d = Object.keys(req.deleted || {}).length;
    if (!n && !d) return; // قراءة فقط
    log_(user.name, "تعديل سجل الوارد والصادر", `${n} قيد مُرسل، ${d} حذف`);
    return;
  }
  if (a === "syncAll") {
    const parts = [];
    Object.keys(req.cols || {}).forEach((k) => {
      const n = (req.cols[k].records || []).length;
      const d = Object.keys(req.cols[k].deleted || {}).length;
      if (n || d) parts.push(`${k}: ${n} سجل${d ? ` و${d} حذف` : ""}`);
    });
    if (parts.length) log_(user.name, "تعديل الأقسام", parts.join(" · "));
    return;
  }
  const labels = {
    upload: "رفع ملف", file: "فتح ملف", ocr: "قراءة ضوئية", reserve: "حجز رقم", search: "بحث في المحتوى",
    logout: "خروج", logoutAll: "خروج من كل الأجهزة", password: "تغيير كلمة المرور",
    saveUser: "حفظ مستخدم", deleteUser: "حذف مستخدم", digest: "إعداد الملخص اليومي",
  };
  const details = a === "upload" ? `${req.name || ""} → ${(req.path || []).join("/")}`
    : a === "saveUser" ? (req.user || {}).username || ""
    : a === "deleteUser" ? req.username || ""
    : a === "search" ? req.q || ""
    : a === "ocr" ? req.name || "" : "";
  log_(user.name, labels[a] || a, details);
}

/* قراءة آخر الأحداث لعرضها داخل الأداة */
function readLog_(days, limit) {
  const tz = Session.getScriptTimeZone();
  const out = [];
  for (let i = 0; i < Math.max(1, days); i++) {
    const day = Utilities.formatDate(new Date(Date.now() - i * 86400000), tz, "yyyy-MM-dd");
    const folder = subFolder_(root_(), LOG_FOLDER);
    const it = folder.getFilesByName(`أحداث ${day}.csv`);
    if (!it.hasNext()) continue;
    const text = it.next().getBlob().getDataAsString("UTF-8").replace(/^\ufeff/, "");
    const lines = text.split("\n").slice(1).filter(Boolean);
    lines.reverse().forEach((l) => {
      if (out.length >= limit) return;
      const cells = (l.match(/"(?:[^"]|"")*"/g) || []).map((c) => c.slice(1, -1).replace(/""/g, '"'));
      if (cells.length >= 3) out.push({ at: cells[0], user: cells[1], action: cells[2], details: cells[3] || "" });
    });
    if (out.length >= limit) break;
  }
  return out;
}

/* نسخة احتياطية واحدة في اليوم قبل أول تعديل، ويُحتفظ بآخر 30 نسخة */
function backupDaily_(file) {
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty("LAST_BACKUP") === today) return;
  const folder = subFolder_(root_(), BACKUP_FOLDER);
  file.makeCopy(`سجل الوارد والصادر - ${today}.json`, folder);
  // نسخ احتياطية لكل ملفات الأقسام الموجودة في مجلد الأرشيف
  const it2 = root_().getFiles();
  while (it2.hasNext()) {
    const f = it2.next();
    if (/^tamkeen-.+\.json$/.test(f.getName()) && f.getName() !== DATA_NAME) {
      try { f.makeCopy(`${f.getName().replace(/\.json$/, "")} - ${today}.json`, folder); } catch (err) { /* تجاهل */ }
    }
  }
  props.setProperty("LAST_BACKUP", today);
  const files = [];
  const it = folder.getFiles();
  while (it.hasNext()) files.push(it.next());
  files.sort((a, b) => b.getDateCreated() - a.getDateCreated());
  files.slice(BACKUP_KEEP).forEach((f) => f.setTrashed(true));
}

/* التواريخ التي توجد لها نسخ احتياطية، وعدد سجلات كل نسخة */
function backupDays_() {
  const folder = subFolder_(root_(), BACKUP_FOLDER);
  const days = {};
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    const m = /(\d{4}-\d{2}-\d{2})\.json$/.exec(f.getName());
    if (!m) continue;
    const day = m[1];
    days[day] = days[day] || { day: day, files: 0, records: 0 };
    days[day].files++;
    try {
      const data = JSON.parse(f.getBlob().getDataAsString("UTF-8"));
      days[day].records += (data.records || []).length;
    } catch (err) { /* ملف تالف يُتجاهل */ }
  }
  return Object.keys(days).sort().reverse().map((d) => days[d]);
}

/* استعادة نسخة يوم معيّن: تُضاف السجلات الناقصة ولا يُحذف شيء موجود،
   وتُزال شواهد الحذف عن المستعاد حتى لا تعود المزامنة فتحذفه. للمدير وحده. */
function restoreDay_(day, user) {
  day = String(day || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("اختر تاريخ النسخة");
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(45000)) throw new Error("الخادم مشغول، أعد المحاولة بعد لحظات");
  try {
    const folder = subFolder_(root_(), BACKUP_FOLDER);
    const restored = {};
    const it = folder.getFiles();
    while (it.hasNext()) {
      const f = it.next();
      const name = f.getName();
      if (name.indexOf(" - " + day + ".json") === -1) continue;
      let data;
      try { data = JSON.parse(f.getBlob().getDataAsString("UTF-8")); } catch (err) { continue; }
      if (!data || !Array.isArray(data.records)) continue;
      // اسم الملف يحدّد وجهته: السجل الرئيسي أو قسم من الأقسام
      const colMatch = /^tamkeen-(.+) - \d{4}-\d{2}-\d{2}\.json$/.exec(name);
      const label = colMatch ? colMatch[1] : "registry";
      if (colMatch && !isCol_(label)) continue;
      const file = colMatch ? colFile_(label) : dataFile_();
      const current = readData_(file);
      const map = {};
      (current.records || []).forEach((r) => { map[r.id] = r; });
      const del = Object.assign({}, current.deleted || {});
      let added = 0;
      data.records.forEach((r) => {
        if (!r || !r.id) return;
        delete del[r.id];
        if (map[r.id]) return;   // الموجود لا يُستبدل
        map[r.id] = r;
        added++;
      });
      if (added || Object.keys(del).length !== Object.keys(current.deleted || {}).length) {
        file.setContent(JSON.stringify({ records: Object.keys(map).map((k) => map[k]), deleted: del }));
      }
      restored[label] = added;
    }
    if (!Object.keys(restored).length) throw new Error("لا توجد نسخة بهذا التاريخ");
    log_(user.name, "استعادة نسخة احتياطية", day + " — " + Object.keys(restored).map((k) => k + ": " + restored[k]).join(" · "));
    return { day: day, restored: restored };
  } finally {
    lock.releaseLock();
  }
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
