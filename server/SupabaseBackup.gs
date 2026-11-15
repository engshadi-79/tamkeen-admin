/* مساعد Google لمساعد تمكين: نسخة احتياطية يومية من Supabase إلى Drive، والقراءة الضوئية، والملخص اليومي بالبريد.
   ملف مستقل: يعمل في أي مشروع سكربت Google، جديد أو قديم، ولا يحتاج Code.gs.
   قبل التشغيل: في «إعدادات المشروع» أضف خاصية نص برمجي BACKUP_KEY قيمتها رمز المدير في Supabase.
   التشغيل مرة واحدة: اختر الدالة setupSupabaseBackup من الأعلى ثم «تشغيل» ووافق على الأذونات.
   بعدها يعمل وحده كل ليلة:
     - لقطة كاملة (كل الأقسام + الحسابات + فهرس الملفات) في «نسخ Supabase اليومية»، ويُبقى آخر 30 يوماً.
     - الملفات المرفوعة (الأرشيف والقوالب) تُنسخ مرة واحدة إلى «ملفات Supabase» بمجلداتها،
       ولا يُعاد نسخ ما نُسخ. إن طالت القائمة يكمل في دفعة بعد دقائق.
   المجلد: «أرشيف مساعد تمكين» في جذر Drive (يُستعمل الموجود أو يُنشأ).
   مراقب المجلدات على جهاز الموظف يرفع مباشرةً إلى «مجلد المراقبة» داخله:
     شغّل setupWatchKey مرة واحدة، وانسخ الرمز الظاهر في السجل إلى برنامج المراقبة.
   القراءة الضوئية تحتاج نشر المشروع «تطبيق ويب» (نشر ← إدارة عمليات النشر ← تعديل ← إصدار جديد)،
   ثم تشغيل setupSupabaseBackup مرة ليعرف الخادم رابطه. الملخص يُرسل من Gmail صاحب المشروع. */

const SB_ROOT = "أرشيف مساعد تمكين";
const SB_URL = "https://wvgrjnwowueoiphgcrhg.supabase.co/functions/v1/tamkeen";
// رابط النشر الحالي لهذا المشروع (كان الخادم القديم)؛ بعد تحديث النشر يصير رابط المساعد
const SB_KNOWN_EXEC = "https://script.google.com/macros/s/AKfycbyvEVh6eb827Ue-sgDtQNz1bHt-9wakgLZiVD1YNN0lIRofr5Q5CbxPBs_6jqVQsLwFbg/exec";
const SB_JSON_FOLDER = "نسخ Supabase اليومية";
const SB_FILES_FOLDER = "ملفات Supabase";
const SB_WATCH_FOLDER = "مجلد المراقبة";   // ما يرفعه مراقب المجلدات من جهاز الموظف
const SB_INDEX = "فهرس-الملفات.json";
const SB_KEEP = 30;
const SB_HOUR = 2;              // الثانية فجراً بتوقيت السكربت
const SB_BUDGET_MS = 4.5 * 60 * 1000; // حدّ Google لتشغيل السكربت 6 دقائق

function setupSupabaseBackup() {
  ScriptApp.getProjectTriggers().forEach((t) => {
    const h = t.getHandlerFunction();
    if (h === "supabaseBackup" || h === "supabaseBackupContinue" || h === "digestTick" || h === "dailyDigest") ScriptApp.deleteTrigger(t);
  });
  // أسبوعية (كل سبت) بدل يومية: كل لقطة تسحب بيانات النظام كلها فتستهلك حصة النقل في Supabase
  ScriptApp.newTrigger("supabaseBackup").timeBased().onWeekDay(ScriptApp.WeekDay.SATURDAY).atHour(SB_HOUR).create();
  ScriptApp.newTrigger("digestTick").timeBased().everyHours(1).create();
  // الخادم يتحقق من كل رابط قبل قبوله، فنجرّب المرشّحين بالترتيب
  let helper = false;
  for (const url of sbHelperCandidates_()) {
    if (sbCall_({ action: "helperHello", key: sbKey_(), url: url }).helper) { helper = true; break; }
  }
  Logger.log(helper ? "✓ القراءة الضوئية مفعّلة عبر هذا المشروع" : "القراءة الضوئية غير مفعّلة: حدّث نشر المشروع (إصدار جديد) ثم شغّل هذه الدالة مرة أخرى");
  const r = supabaseBackup();
  Logger.log("فُعّلت النسخة اليومية الساعة " + SB_HOUR + ":00 والملخص يُفحص كل ساعة — آخر نسخة: " + JSON.stringify(r));
}

/* رابط النشر (/exec) إن كان المشروع منشوراً تطبيق ويب */
function sbHelperUrl_() {
  try {
    const url = ScriptApp.getService().getUrl() || "";
    return /\/exec$/.test(url) ? url : "";
  } catch (e) { return ""; }
}

function sbHelperCandidates_() {
  const own = PropertiesService.getScriptProperties().getProperty("HELPER_URL");
  return [own, sbHelperUrl_(), SB_KNOWN_EXEC].filter((u, i, a) => u && a.indexOf(u) === i);
}

/* ===== طلبات الخادم إلى المساعد: القراءة الضوئية فقط، وبالرمز ===== */
function doPost(e) {
  let req = {};
  try { req = JSON.parse((e && e.postData && e.postData.contents) || "{}"); } catch (err) { return sbOut_({ error: "طلب غير صالح" }); }
  try {
    // مراقب المجلدات يرفع برمز منفصل (WATCH_KEY) لا يملك إلا الكتابة في مجلد المراقبة
    if (req.action === "watchUpload" || req.action === "watchPing") {
      if (String(req.key || "") !== sbWatchKey_()) { Utilities.sleep(1500); return sbOut_({ error: "رمز غير صحيح" }); }
      return sbOut_(req.action === "watchPing" ? sbWatchPing_() : sbWatchUpload_(req));
    }
    // أرشفة ملفات الزملاء: الرفع مفتوح لمن يعرف صفحة الرفع، والعرض والتنزيل برمز القراءة DROP_KEY
    if (req.action === "dropUpload") return sbOut_(sbDropUpload_(req));
    if (/^drop(List|File|Edit|Delete|RenameBy|DeleteBy)$/.test(String(req.action))) {
      if (String(req.key || "") !== sbDropKey_()) { Utilities.sleep(1500); return sbOut_({ error: "رمز القراءة غير صحيح" }); }
      if (req.action === "dropList") return sbOut_(sbDropList_());
      if (req.action === "dropFile") return sbOut_(sbDropFile_(req.id));
      if (req.action === "dropEdit") return sbOut_(sbDropEdit_(req));
      if (req.action === "dropDelete") return sbOut_(sbDropDelete_(req.id));
      if (req.action === "dropRenameBy") return sbOut_(sbDropRenameBy_(req.from, req.to));
      return sbOut_(sbDropDeleteBy_(req.by));
    }
    if (String(req.key || "") !== sbKey_()) { Utilities.sleep(1500); return sbOut_({ error: "رمز غير صحيح" }); }
    if (req.action === "ocr") return sbOut_(sbOcr_(req));
    if (req.action === "driveFile") return sbOut_(sbDriveFile_(req.id));
    return sbOut_({ error: "إجراء غير معروف" });
  } catch (err) {
    return sbOut_({ error: String(err.message || err) });
  }
}

/* ملف قديم من أرشيف Drive (رفعه الخادم القديم) يُرسل إلى Supabase ليُحفظ هناك */
function sbDriveFile_(id) {
  if (!/^[A-Za-z0-9_-]{20,}$/.test(String(id || ""))) throw new Error("معرّف غير صالح");
  let file;
  try { file = DriveApp.getFileById(id); } catch (e) { throw new Error("الملف غير موجود على Drive"); }
  if (file.isTrashed()) throw new Error("الملف في سلة مهملات Drive");
  if (file.getSize() > 40 * 1024 * 1024) throw new Error("الملف أكبر من 40 ميغابايت");
  const blob = file.getBlob();
  return { name: file.getName(), mime: blob.getContentType() || file.getMimeType(), data: Utilities.base64Encode(blob.getBytes()) };
}

/* ===== مجلد المراقبة: يرفع إليه البرنامج الصغير على جهاز الموظف كل ملف جديد أو معدَّل =====
   الشجرة نفسها داخل Drive: «أرشيف مساعد تمكين / مجلد المراقبة / …».
   الملف المعدَّل يستبدل نسخته السابقة بالاسم نفسه في المجلد نفسه. */
function sbWatchUpload_(req) {
  if (!req.data) throw new Error("لا يوجد محتوى");
  const name = String(req.name || "ملف").replace(/[\/\\]/g, "-").trim() || "ملف";
  const bytes = Utilities.base64Decode(String(req.data));
  if (bytes.length > 40 * 1024 * 1024) throw new Error("الملف أكبر من 40 ميغابايت");
  let folder = sbSub_(sbRoot_(), SB_WATCH_FOLDER);
  (req.path || []).forEach(function (p) {
    const part = String(p).replace(/[\/\\]/g, "-").trim();
    if (part && part !== "." && part !== "..") folder = sbSub_(folder, part);
  });
  const old = folder.getFilesByName(name);
  while (old.hasNext()) old.next().setTrashed(true);   // النسخة المحدَّثة تحلّ محل القديمة
  const blob = Utilities.newBlob(bytes, req.mime || "application/octet-stream", name);
  const file = folder.createFile(blob);
  return { id: file.getId(), link: file.getUrl(), folder: folder.getUrl(), name: name };
}

function sbWatchPing_() {
  const folder = sbSub_(sbRoot_(), SB_WATCH_FOLDER);
  return { ok: true, folder: folder.getUrl(), name: folder.getName() };
}

/* رمز المراقب: منفصل عن رمز المدير، وتوليده مرة واحدة بتشغيل setupWatchKey */
function sbWatchKey_() {
  const key = PropertiesService.getScriptProperties().getProperty("WATCH_KEY");
  if (!key || key.length < 12) throw new Error("لا يوجد رمز للمراقب: شغّل الدالة setupWatchKey مرة واحدة ثم انسخ الرمز من السجل");
  return key;
}

/* شغّلها مرة من محرر السكربت: تولّد رمز المراقب وتطبعه ليُنسخ إلى برنامج المراقبة */
function setupWatchKey() {
  const props = PropertiesService.getScriptProperties();
  let key = props.getProperty("WATCH_KEY");
  if (!key || key.length < 12) {
    key = Utilities.getUuid().replace(/-/g, "");
    props.setProperty("WATCH_KEY", key);
  }
  const folder = sbSub_(sbRoot_(), SB_WATCH_FOLDER);
  Logger.log("رمز المراقب: " + key);
  Logger.log("مجلد المراقبة: " + folder.getUrl());
  Logger.log("رابط المساعد: " + (sbHelperUrl_() || "انشر المشروع تطبيق ويب ثم أعد التشغيل"));
  return { key: key, folder: folder.getUrl() };
}

/* ===== أرشفة ملفات الزملاء =====
   الزميل يرفع من صفحة drop.html بلا دخول؛ الملفات في «أرشيف مساعد تمكين / ملفات الزملاء».
   العرض والتنزيل من تاب «النماذج الجاهزة» برمز القراءة: شغّل setupDropKey مرة وانسخ الرمز من السجل. */
const SB_DROP_FOLDER = "ملفات الزملاء";
const SB_DROP_MAX_MB = 15;   // أقصى حجم للملف الواحد
const SB_DROP_DAILY = 150;   // أقصى عدد ملفات في اليوم (حماية من الإساءة)

function sbDropFolder_() { return sbSub_(sbRoot_(), SB_DROP_FOLDER); }
function sbDropKey_() {
  const key = PropertiesService.getScriptProperties().getProperty("DROP_KEY");
  if (!key || key.length < 6) throw new Error("لا يوجد رمز قراءة: شغّل الدالة setupDropKey مرة واحدة ثم انسخ الرمز من السجل");
  return key;
}
/* شغّلها مرة من محرر السكربت: تولّد رمز القراءة وتطبعه ليُكتب في تاب «النماذج الجاهزة» */
function setupDropKey() {
  const props = PropertiesService.getScriptProperties();
  let key = props.getProperty("DROP_KEY");
  if (!key || key.length < 6) {
    key = Utilities.getUuid().replace(/-/g, "").slice(0, 12);
    props.setProperty("DROP_KEY", key);
  }
  Logger.log("رمز القراءة: " + key);
  Logger.log("مجلد ملفات الزملاء: " + sbDropFolder_().getUrl());
  return { key: key };
}
function sbDropUpload_(req) {
  const name = String(req.name || "").replace(/[\/:*?"<>|]+/g, " ").trim().slice(0, 120);
  if (!name || !req.data) throw new Error("اختر ملفاً أولاً");
  if (String(req.data).length > SB_DROP_MAX_MB * 1024 * 1024 * 1.37) throw new Error("الملف أكبر من " + SB_DROP_MAX_MB + " ميغابايت");
  const props = PropertiesService.getScriptProperties();
  const day = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  let cnt = {};
  try { cnt = JSON.parse(props.getProperty("DROP_COUNT") || "{}"); } catch (err) { /* يُعاد العدّ */ }
  const n = cnt.day === day ? cnt.n : 0;
  if (n >= SB_DROP_DAILY) throw new Error("بلغ الرفع حدّه اليومي، حاول غداً");
  const blob = Utilities.newBlob(Utilities.base64Decode(String(req.data)), req.mime || "application/octet-stream", name);
  const file = sbDropFolder_().createFile(blob);
  file.setDescription(JSON.stringify({ by: String(req.by || "").slice(0, 60), title: String(req.title || "").trim().slice(0, 120) }));
  props.setProperty("DROP_COUNT", JSON.stringify({ day: day, n: n + 1 }));
  return { ok: true, name: name };
}
function sbDropList_() {
  const out = [];
  const folder = sbDropFolder_();
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (f.isTrashed()) continue;
    let d = {};
    try { d = JSON.parse(f.getDescription() || "{}"); } catch (err) { /* وصف حر */ }
    out.push({ id: f.getId(), name: f.getName(), title: d.title || "", by: d.by || "", at: f.getDateCreated().toISOString(), size: f.getSize() });
  }
  out.sort(function (a, b) { return a.at < b.at ? 1 : -1; });
  return { files: out, folder: folder.getUrl() };
}
function sbDropFile_(id) {
  const file = DriveApp.getFileById(String(id || ""));
  const ps = file.getParents();
  if (!ps.hasNext() || ps.next().getId() !== sbDropFolder_().getId()) throw new Error("الملف خارج مجلد ملفات الزملاء");
  const blob = file.getBlob();
  return { name: file.getName(), mime: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()) };
}

/* ===== إدارة ملفات الزملاء (برمز القراءة): تعديل العنوان/الاسم، والحذف نقلٌ إلى سلة مهملات Drive (تُستعاد منها 30 يوماً) ===== */
function sbDropOwn_(id) {
  const file = DriveApp.getFileById(String(id || ""));
  const ps = file.getParents();
  if (!ps.hasNext() || ps.next().getId() !== sbDropFolder_().getId()) throw new Error("الملف خارج مجلد ملفات الزملاء");
  return file;
}
function sbDropMeta_(file) {
  try { return JSON.parse(file.getDescription() || "{}") || {}; } catch (err) { return {}; }
}
function sbDropEdit_(req) {
  const file = sbDropOwn_(req.id);
  const d = sbDropMeta_(file);
  if (req.title !== undefined) d.title = String(req.title || "").trim().slice(0, 120);
  if (req.by !== undefined && String(req.by).trim()) d.by = String(req.by).trim().slice(0, 60);
  file.setDescription(JSON.stringify(d));
  return { ok: true };
}
function sbDropDelete_(id) {
  sbDropOwn_(id).setTrashed(true);
  return { ok: true };
}
function sbDropEach_(by, fn) {
  const who = String(by || "");
  let n = 0;
  const it = sbDropFolder_().getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (f.isTrashed()) continue;
    const d = sbDropMeta_(f);
    if (String(d.by || "") === who) { fn(f, d); n++; }
  }
  return n;
}
function sbDropRenameBy_(from, to) {
  const name = String(to || "").trim().slice(0, 60);
  if (!name) throw new Error("اكتب الاسم الجديد");
  return { ok: true, count: sbDropEach_(from, function (f, d) { d.by = name; f.setDescription(JSON.stringify(d)); }) };
}
function sbDropDeleteBy_(by) {
  return { ok: true, count: sbDropEach_(by, function (f) { f.setTrashed(true); }) };
}

function doGet() {
  return sbOut_({ ok: true, name: "مساعد Google لمساعد تمكين", drop: 3 });
}

function sbOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* قراءة ملف ممسوح: يُحوَّل إلى مستند Google مؤقت ويُستخرج نصه ثم يُحذف */
function sbOcr_(req) {
  if (!req.data) throw new Error("لا يوجد ملف");
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
    const res = UrlFetchApp.fetch("https://www.googleapis.com/drive/v3/files/" + id + "/export?mimeType=text/plain", {
      headers: { Authorization: "Bearer " + token },
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() >= 300) throw new Error("تعذّر استخراج النص");
    return { text: res.getContentText().slice(0, 20000) };
  } finally {
    try { DriveApp.getFileById(id).setTrashed(true); } catch (err) { /* الملف المؤقت */ }
  }
}

/* ===== الملخص اليومي: يُفحص كل ساعة، ويُرسل مرة في اليوم في الساعة التي اختارها المدير ===== */
function digestTick() {
  // نرسل الساعة الحالية: الخادم لا يقرأ الوارد والمهام إلا في ساعة الإرسال (توفير حصة النقل)
  const d = sbCall_({ action: "digestData", key: sbKey_(), nowHour: Number(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "H")) });
  if (!d.enabled || d.notNow) return;
  const tz = Session.getScriptTimeZone();
  const now = new Date();
  if (Number(Utilities.formatDate(now, tz, "H")) !== Number(d.hour)) return;
  const today = Utilities.formatDate(now, tz, "yyyy-MM-dd");
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty("DIGEST_SENT") === today) return;
  props.setProperty("DIGEST_SENT", today);
  const lateIn = (d.lateIn || []).filter((r) => r.dueDate <= today);
  const lateTasks = (d.lateTasks || []).filter((t) => t.dueDate <= today);
  const esc = (v) => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  (d.users || []).forEach((u) => {
    const mine = (list) => (u.admin ? list : list.filter((x) => (x.owner || "") === u.name));
    const rows = mine(lateIn);
    const tasks = mine(lateTasks);
    if (!rows.length && !tasks.length) return;
    const li = (t) => "<li>" + t + "</li>";
    const html = '<div dir="rtl" style="font-family:Tahoma,Arial">' +
      "<h3>مساعد تمكين: متابعة " + today + "</h3>" +
      (rows.length ? "<p><b>وارد بحاجة إلى رد أو معالجة (" + rows.length + "):</b></p><ul>" +
        rows.map((r) => li(esc(r.number) + " — " + esc(r.subject) + (r.party ? " (" + esc(r.party) + ")" : "") + " — حتى " + esc(r.dueDate))).join("") + "</ul>" : "") +
      (tasks.length ? "<p><b>مهام مستحقة (" + tasks.length + "):</b></p><ul>" +
        tasks.map((t) => li(esc(t.text) + " — حتى " + esc(t.dueDate) + (t.owner ? " — " + esc(t.owner) : ""))).join("") + "</ul>" : "") +
      '<p><a href="https://tamkeen-admin.vercel.app/">فتح مساعد تمكين</a></p>' +
      '<p style="color:#5f6b7d;font-size:12px">رسالة تلقائية من مساعد تمكين الإداري.</p></div>';
    try {
      MailApp.sendEmail({ to: u.email, subject: "مساعد تمكين: " + (rows.length + tasks.length) + " بند يحتاج متابعة", htmlBody: html, name: "مساعد تمكين" });
    } catch (err) { console.warn("تعذّر الإرسال إلى " + u.email + ": " + err.message); }
  });
}

function supabaseBackup() { return sbRun_(false); }
function supabaseBackupContinue() { return sbRun_(true); }

function sbKey_() {
  const own = PropertiesService.getScriptProperties().getProperty("BACKUP_KEY");
  const key = own || (typeof ADMIN_KEY !== "undefined" ? ADMIN_KEY : "");
  if (!key || key === "PUT-ADMIN-CODE-HERE") throw new Error("لا يوجد رمز: أضف في «إعدادات المشروع» خاصية نص برمجي BACKUP_KEY قيمتها رمز المدير في Supabase");
  return key;
}

/* مجلد الأرشيف في جذر Drive؛ معرّفه يُحفظ حتى لا يتأثر بإعادة التسمية */
function sbRoot_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty("SB_ROOT_ID");
  if (id) {
    try { const f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (err) { /* حُذف المجلد */ }
  }
  const it = DriveApp.getRootFolder().getFoldersByName(SB_ROOT);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(SB_ROOT);
  props.setProperty("SB_ROOT_ID", folder.getId());
  return folder;
}

function sbSub_(parent, name) {
  const it = parent.getFoldersByName(String(name));
  return it.hasNext() ? it.next() : parent.createFolder(String(name));
}

function sbCall_(body) {
  const res = UrlFetchApp.fetch(SB_URL, {
    method: "post", contentType: "text/plain", payload: JSON.stringify(body), muteHttpExceptions: true,
  });
  let out;
  try { out = JSON.parse(res.getContentText("UTF-8")); } catch (e) { throw new Error("ردّ غير مفهوم من Supabase (" + res.getResponseCode() + ")"); }
  if (out && out.error) throw new Error(out.error);
  return out;
}

function sbRun_(filesOnly) {
  const started = Date.now();
  const key = sbKey_();
  const root = sbRoot_();
  const jsonFolder = sbSub_(root, SB_JSON_FOLDER);
  const filesFolder = sbSub_(root, SB_FILES_FOLDER);
  try {
    const snap = sbCall_({ action: "driveSnapshot", key: key });
    const day = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
    let records = 0;
    Object.keys(snap.data || {}).forEach((k) => { records += ((snap.data[k] || {}).records || []).length; });

    // ١. اللقطة اليومية (تُستبدل إن شُغّلت مرتين في اليوم نفسه)
    if (!filesOnly) {
      const name = "تمكين-" + day + ".json";
      const old = jsonFolder.getFilesByName(name);
      while (old.hasNext()) old.next().setTrashed(true);
      jsonFolder.createFile(name, JSON.stringify(snap), "application/json");
      sbPrune_(jsonFolder);
    }

    // ٢. الملفات الجديدة فقط
    const index = sbReadIndex_(filesFolder);
    const todo = (snap.files || []).filter((f) => !index[f.id]);
    let added = 0;
    for (let i = 0; i < todo.length; i += 20) {
      if (Date.now() - started > SB_BUDGET_MS) break;
      const part = todo.slice(i, i + 20);
      const urls = sbCall_({ action: "driveFileUrls", key: key, ids: part.map((f) => f.id) }).urls || {};
      for (const f of part) {
        if (Date.now() - started > SB_BUDGET_MS) break;
        const url = urls[f.id];
        if (!url) continue;
        const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
        if (res.getResponseCode() !== 200) continue;
        let folder = filesFolder;
        String(f.folder || "").split("/").filter(String).forEach((p) => { folder = sbSub_(folder, p); });
        const blob = res.getBlob().setName(f.name || f.id.split("/").pop());
        if (f.mime) blob.setContentType(f.mime);
        const file = folder.createFile(blob);
        file.setDescription("supabase:" + f.id);
        index[f.id] = file.getId();
        added++;
      }
      sbWriteIndex_(filesFolder, index); // يُحفظ بعد كل دفعة فلا يُعاد ما نُسخ إن انقطع التشغيل
    }
    const pending = (snap.files || []).filter((f) => !index[f.id]).length;
    sbContinueLater_(pending > 0);

    const info = {
      ok: true, day: day, records: records, users: (snap.users || []).length,
      filesTotal: Object.keys(index).length, filesNew: added, pending: pending, folder: root.getUrl(),
      helper: sbHelperUrl_(),
    };
    sbCall_({ action: "driveDone", key: key, info: info });
    return info;
  } catch (err) {
    try { sbCall_({ action: "driveDone", key: key, info: { ok: false, error: String(err.message || err), folder: root.getUrl() } }); } catch (e) { /* الخادم نفسه لا يرد */ }
    throw err;
  }
}

/* يُبقى آخر 30 لقطة، والأقدم إلى سلة المهملات (تُسترجع منها 30 يوماً) */
function sbPrune_(folder) {
  const list = [];
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (/^تمكين-\d{4}-\d{2}-\d{2}\.json$/.test(f.getName())) list.push(f);
  }
  list.sort((a, b) => (a.getName() < b.getName() ? 1 : -1));
  list.slice(SB_KEEP).forEach((f) => f.setTrashed(true));
}

function sbReadIndex_(folder) {
  const it = folder.getFilesByName(SB_INDEX);
  if (!it.hasNext()) return {};
  try { return JSON.parse(it.next().getBlob().getDataAsString("UTF-8")) || {}; } catch (e) { return {}; }
}

function sbWriteIndex_(folder, index) {
  const it = folder.getFilesByName(SB_INDEX);
  const text = JSON.stringify(index);
  if (it.hasNext()) it.next().setContent(text);
  else folder.createFile(SB_INDEX, text, "application/json");
}

/* دفعة تكميلية واحدة بعد 5 دقائق إن بقيت ملفات */
function sbContinueLater_(needed) {
  ScriptApp.getProjectTriggers().forEach((t) => {
    if (t.getHandlerFunction() === "supabaseBackupContinue") ScriptApp.deleteTrigger(t);
  });
  if (needed) ScriptApp.newTrigger("supabaseBackupContinue").timeBased().after(5 * 60 * 1000).create();
}
