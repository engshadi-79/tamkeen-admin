/* نسخة احتياطية يومية من Supabase إلى Google Drive.
   يُضاف هذا الملف إلى مشروع سكربت Google نفسه (بجانب Code.gs) ويستعمل دواله: root_() و subFolder_().
   التشغيل مرة واحدة: اختر الدالة setupSupabaseBackup من الأعلى ثم «تشغيل» ووافق على الأذونات.
   بعدها يعمل وحده كل ليلة:
     - لقطة كاملة (كل الأقسام + الحسابات + فهرس الملفات) في «نسخ Supabase اليومية»، ويُبقى آخر 30 يوماً.
     - الملفات المرفوعة (الأرشيف والقوالب) تُنسخ مرة واحدة إلى «ملفات Supabase» بمجلداتها،
       ولا يُعاد نسخ ما نُسخ. إن طالت القائمة يكمل في دفعة بعد دقائق.
   الرمز: رمز المدير (ADMIN_KEY في Code.gs)، أو خاصية سكربت باسم BACKUP_KEY إن كانا مختلفين. */

const SB_URL = "https://wvgrjnwowueoiphgcrhg.supabase.co/functions/v1/tamkeen";
const SB_JSON_FOLDER = "نسخ Supabase اليومية";
const SB_FILES_FOLDER = "ملفات Supabase";
const SB_INDEX = "فهرس-الملفات.json";
const SB_KEEP = 30;
const SB_HOUR = 2;              // الثانية فجراً بتوقيت السكربت
const SB_BUDGET_MS = 4.5 * 60 * 1000; // حدّ Google لتشغيل السكربت 6 دقائق

function setupSupabaseBackup() {
  ScriptApp.getProjectTriggers().forEach((t) => {
    const h = t.getHandlerFunction();
    if (h === "supabaseBackup" || h === "supabaseBackupContinue") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("supabaseBackup").timeBased().atHour(SB_HOUR).everyDays(1).create();
  const r = supabaseBackup();
  Logger.log("فُعّلت النسخة اليومية الساعة " + SB_HOUR + ":00 — أول نسخة: " + JSON.stringify(r));
}

function supabaseBackup() { return sbRun_(false); }
function supabaseBackupContinue() { return sbRun_(true); }

function sbKey_() {
  const own = PropertiesService.getScriptProperties().getProperty("BACKUP_KEY");
  const key = own || (typeof ADMIN_KEY !== "undefined" ? ADMIN_KEY : "");
  if (!key || key === "PUT-ADMIN-CODE-HERE") throw new Error("لا يوجد رمز: ضع رمز المدير في ADMIN_KEY أو أضف خاصية BACKUP_KEY");
  return key;
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
  const root = root_();
  const jsonFolder = subFolder_(root, SB_JSON_FOLDER);
  const filesFolder = subFolder_(root, SB_FILES_FOLDER);
  const key = sbKey_();
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
        String(f.folder || "").split("/").filter(String).forEach((p) => { folder = subFolder_(folder, p); });
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
