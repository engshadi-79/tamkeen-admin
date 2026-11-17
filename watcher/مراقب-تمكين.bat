@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Tamkeen folder watcher

rem ===== one self-contained file: extracts the watcher, then runs the Arabic setup =====

rem فحص Node.js يجري داخل setup.ps1 ويُعرض في نافذة رسومية

powershell -NoProfile -ExecutionPolicy Bypass -Command "$src=[IO.File]::ReadAllLines('%~f0',[Text.Encoding]::UTF8); $a=[Array]::IndexOf($src,':::JS:::'); $b=[Array]::IndexOf($src,':::PS1:::'); $c=[Array]::IndexOf($src,':::UI:::'); if($a -lt 0 -or $b -lt 0 -or $c -lt 0){exit 1}; [IO.File]::WriteAllLines((Join-Path '%~dp0' 'watch-folder.mjs'), $src[($a+1)..($b-1)], (New-Object Text.UTF8Encoding($false))); [IO.File]::WriteAllLines((Join-Path '%~dp0' 'setup.ps1'), $src[($b+1)..($c-1)], (New-Object Text.UTF8Encoding($true))); [IO.File]::WriteAllLines((Join-Path '%~dp0' 'watcher-ui.ps1'), $src[($c+1)..($src.Length-1)], (New-Object Text.UTF8Encoding($true)))"
if errorlevel 1 (
  echo   Could not extract the watcher files.
  pause
  exit /b 1
)

if /i "%~1"=="/extract" (
  echo   Extracted watch-folder.mjs, setup.ps1 and watcher-ui.ps1 next to this file.
  exit /b 0
)

start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0setup.ps1"
exit /b

rem ================== do not edit below this line ==================

:::JS:::
#!/usr/bin/env node
/* مراقب مجلدات «مساعد تمكين الإداري»
   برنامج صغير يعمل على الجهاز ويراقب مجلداً (أو أكثر)، وكل ملف جديد يستقرّ فيه
   يُرفع إلى أرشيف المركز ويُسجَّل في الوارد أو الصادر برقم محجوز من الخادم نفسه.
   يعمل والموقع مغلق، ولا يحتاج إلا Node.js 18 فأحدث.

   الاستعمال:
     node watch-folder.mjs           تشغيل المراقبة (حلقة مستمرة)
     node watch-folder.mjs --once    جولة فحص واحدة ثم خروج
     node watch-folder.mjs --login   تسجيل الدخول من جديد
     node watch-folder.mjs --status  عرض الحالة والإعدادات
     node watch-folder.mjs --drive-check  فحص الرفع المباشر إلى Google Drive
     node watch-folder.mjs --seed    اعتبار ما في المجلد الآن قديماً بلا رفع
     node watch-folder.mjs --unseed  نسيان ما رُفع سابقاً: كل ما في المجلد يُرفع من جديد
*/
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// ملف إعدادات بديل (يستعمله فحص الإعداد) حتى لا يُكتب فوق الإعدادات الحقيقية
const CONFIG_PATH = process.env.TAMKEEN_WATCH_CONFIG || path.join(HERE, "config.json");
const STATE_PATH = path.join(HERE, "state.json");
const LOG_PATH = path.join(HERE, "watcher.log");

const DEFAULTS = {
  url: "https://wvgrjnwowueoiphgcrhg.supabase.co/functions/v1/tamkeen",
  folders: [],
  type: "in",                 // in = وارد، out = صادر
  party: "",                  // الجهة الافتراضية
  outPrefix: "م ت",           // بادئة رقم الصادر كما في إعدادات الموقع
  intervalSeconds: 60,
  stableSeconds: 10,          // لا يُرفع الملف حتى يثبت حجمه هذه المدة (المسح الضوئي والتنزيل)
  maxMB: 45,
  subfolders: true,
  target: "registry",         // registry = سجل الوارد والصادر، drive = Google Drive، both = كلاهما
  drive: { url: "", key: "" },// رابط مساعد Google ورمز المراقب (setupWatchKey)
  colleagues: { enabled: false, by: "", only: false }, // رفع كل ما يضاف إلى «ملفات الزملاء» في تمكين باسم by (only = بلا سجل ولا نسخة المراقب)
};

const SKIP = /^(\.|~\$)|^(thumbs\.db|desktop\.ini)$|\.(tmp|crdownload|part|partial|lnk)$/i;
const IN_PREFIX = "و";
const DIR_FOLDER = { in: "وارد", out: "صادر" };

/* ===== ملفات الإعداد والحالة ===== */
const readJson = (p, fallback) => {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return fallback; }
};
const writeJson = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2), "utf8");

const config = Object.assign({}, DEFAULTS, readJson(CONFIG_PATH, {}));
const state = Object.assign({ token: "", user: "", seen: {} }, readJson(STATE_PATH, {}));
const saveState = () => writeJson(STATE_PATH, state);

function log(line) {
  const stamp = new Date().toLocaleString("ar-EG");
  const text = `[${stamp}] ${line}`;
  console.log(text);
  try { fs.appendFileSync(LOG_PATH, text + "\n", "utf8"); } catch (e) { /* السجل ليس حرجاً */ }
}

/* ===== الاتصال بخادم المركز (نفس بروتوكول الموقع) ===== */
async function call(action, payload) {
  if (!/^https?:\/\//.test(String(config.url || ""))) throw new Error("رابط خادم المركز غير صحيح في config.json");
  const res = await fetch(config.url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(Object.assign({ token: state.token, action }, payload || {})),
  });
  let data;
  try { data = await res.json(); } catch (e) { throw new Error(`رد غير متوقع من الخادم (${res.status})`); }
  if (data.error === "UNAUTHORIZED") { state.token = ""; saveState(); throw new Error("انتهت الجلسة — شغّل الأمر ‎--login‎"); }
  if (data.error) throw new Error(data.error);
  return data;
}

/* ===== الرفع المباشر إلى Google Drive عبر مساعد Google (Apps Script) ===== */
const driveOn = () => config.target !== "registry" && !!(config.drive && config.drive.url && config.drive.key);
const registryOn = () => config.target !== "drive";

async function driveCall(action, payload) {
  if (!/^https?:\/\//.test(String((config.drive || {}).url || ""))) throw new Error("رابط مساعد Google غير صحيح في الإعدادات");
  const res = await fetch(config.drive.url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(Object.assign({ key: config.drive.key, action }, payload || {})),
    redirect: "follow",
  });
  let data;
  try { data = await res.json(); } catch (e) { throw new Error(`رد غير متوقع من مساعد Google (${res.status})`); }
  if (data.error) throw new Error(data.error);
  return data;
}

/* رفع ملف إلى Drive بنفس شجرة المجلدات داخل المجلد المراقَب */
async function driveUpload(f, data) {
  const rel = path.dirname(f.rel);
  const parts = rel === "." ? [] : rel.split("/").filter(Boolean);
  // أكثر من مجلد مراقَب: يُسبق المسار باسم مجلده حتى لا تختلط الملفات في Drive
  if ((config.folders || []).length > 1 && f.rootName) parts.unshift(f.rootName);
  return driveCall("watchUpload", { name: f.name, mime: mimeOf(f.name), path: parts, data });
}

const ask = (q, hidden) => new Promise((resolve) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) {
    // كلمة المرور لا تظهر على الشاشة
    const write = rl._writeToOutput.bind(rl);
    rl._writeToOutput = (s) => write(s.includes(q) ? s : "");
  }
  rl.question(q, (v) => { rl.close(); if (hidden) process.stdout.write("\n"); resolve(v.trim()); });
});

async function login() {
  console.log(`\nالدخول إلى خادم المركز: ${config.url}`);
  const username = await ask("اسم المستخدم: ");
  const password = await ask("كلمة المرور: ", true);
  const r = await call("login", { username, password });
  state.token = r.token;
  state.user = (r.user && r.user.name) || username;
  saveState();
  log(`تم الدخول باسم ${state.user}. رمز الجلسة محفوظ في state.json (صالح ٣٠ يوماً).`);
}

/* الدخول من برنامج التجهيز الرسومي: سطر JSON واحد على المدخل القياسي
   {"username":"…","password":"…"} — لا تظهر كلمة المرور على الشاشة ولا تُحفظ. */
async function loginFromStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  let cred = {};
  try { cred = JSON.parse(Buffer.concat(chunks).toString("utf8").trim() || "{}"); } catch (e) { throw new Error("بيانات دخول غير صالحة"); }
  if (!cred.username || !cred.password) throw new Error("اسم المستخدم وكلمة المرور مطلوبان");
  const r = await call("login", { username: cred.username, password: cred.password });
  state.token = r.token;
  state.user = (r.user && r.user.name) || cred.username;
  saveState();
  log(`تم الدخول باسم ${state.user}.`);
}

async function ensureSession() {
  if (!state.token) { await login(); return; }
  try {
    const r = await call("ping");
    if (r.user && r.user.name) { state.user = r.user.name; saveState(); }
  } catch (e) {
    log("الجلسة غير صالحة: " + e.message);
    await login();
  }
}

/* ===== تخمين بيانات القيد من اسم الملف ومجلده (نفس قواعد الموقع) ===== */
function guessCategory(name) {
  const n = String(name).toLowerCase();
  if (/محضر|محاضر|اجتماع|minutes|meeting/.test(n)) return "محاضر اجتماعات";
  if (/تقرير|تقارير|report/.test(n)) return "تقارير";
  if (/عقد|عقود|اتفاقي|تفاهم|contract|agreement|mou/.test(n)) return "عقود واتفاقيات";
  if (/فاتور|فواتير|سند|سندات|مالي|ايصال|إيصال|invoice|receipt/.test(n)) return "فواتير ومالية";
  if (/كشف|كشوف|جدول|حضور|درجات|قائمة|\.(xlsx?|xlsm|csv|ods)$/.test(n)) return "كشوف وجداول";
  if (/خطاب|كتاب|مراسل|رسالة|تعميم|letter/.test(n)) return "خطابات";
  if (/\.(jpe?g|png|gif|webp|heic|bmp|tiff?)$|^(صور|الصور|images|photos|pictures)$/.test(n)) return "صور";
  return "أخرى";
}

const pad = (n) => String(n).padStart(2, "0");
const localISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const validDate = (y, m, d) => y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31;

function dateFromText(text) {
  const n = String(text).replace(/[٠-٩]/g, (c) => "٠١٢٣٤٥٦٧٨٩".indexOf(c));
  let m = n.match(/(\d{4})[-_.\/](\d{1,2})[-_.\/](\d{1,2})/);
  if (m && validDate(+m[1], +m[2], +m[3])) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = n.match(/(\d{1,2})[-_.\/](\d{1,2})[-_.\/](\d{4})/);
  if (m && validDate(+m[3], +m[2], +m[1])) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  return null;
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const mimeOf = (name) => ({
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
  webp: "image/webp", heic: "image/heic", tif: "image/tiff", tiff: "image/tiff", bmp: "image/bmp",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain", csv: "text/csv", zip: "application/zip",
}[(name.split(".").pop() || "").toLowerCase()] || "application/octet-stream");

/* ===== قراءة المجلدات ===== */
async function listFiles(root) {
  const out = [];
  async function walk(dir, depth) {
    if (depth > 8) return;
    let entries = [];
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      if (SKIP.test(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (config.subfolders) await walk(full, depth + 1); continue; }
      if (!e.isFile()) continue;
      const st = await fsp.stat(full).catch(() => null);
      if (!st || !st.size) continue;
      out.push({ full, name: e.name, size: st.size, mtime: Math.round(st.mtimeMs), birth: Math.round(st.birthtimeMs || 0), rel: path.relative(root, full).replace(/\\/g, "/"), rootName: path.basename(root) });
    }
  }
  await walk(root, 0);
  return out;
}

const keyOf = (f) => `${f.full}|${f.size}|${f.mtime}`;

/* ===== الرفع إلى «ملفات الزملاء» في تمكين =====
   كل ملف يُضاف إلى المجلد المراقَب يظهر في تاب الشخص المحدد (colleagues.by) داخل التصنيف المناسب.
   الرفع مباشر إلى Drive على دفعات 8 ميغابايت (حتى 1 غيغابايت)، وتاريخ إنشاء الملف الأصلي يُحفظ تاريخاً لإضافته.
   لا يلزم رمز: صفحة الرفع العامة نفسها. ويُختم أول مرة كل ما في المجلد الآن (لا يُرفع ما كان موجوداً). */
const collOn = () => !!(config.colleagues && config.colleagues.enabled && config.drive && /^https?:\/\//.test(String(config.drive.url || "")));
const collBy = () => String((config.colleagues || {}).by || state.user || "المراقب").trim().slice(0, 60);
const COLL_MAX = 1024 * 1024 * 1024;
const COLL_CHUNK = 8 * 1024 * 1024;
let collCats = null;

async function dropPublic(action, payload) {
  const res = await fetch(config.drive.url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(Object.assign({ action }, payload || {})),
    redirect: "follow",
  });
  let data;
  try { data = await res.json(); } catch (e) { throw new Error(`رد غير متوقع من مساعد Google (${res.status})`); }
  if (data.error) throw new Error(data.error);
  return data;
}

async function collCategories() {
  if (collCats) return collCats;
  try { collCats = (await dropPublic("dropCats")).cats || []; } catch (e) { collCats = []; }
  if (!collCats.length) collCats = ["تقارير", "كتب ومراجع", "نماذج", "خطابات", "صور", "أخرى"];
  return collCats;
}

const normCat = (t) => String(t || "").replace(/[ً-ْ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/\s+/g, " ").trim();

/* التصنيف: اسم مجلد فرعي يطابق تصنيفاً أولاً، ثم نوع الملف واسمه، وإلا «أخرى» */
function collCategory(f, cats) {
  const pick = (name) => cats.find((c) => normCat(c) === normCat(name));
  const segs = path.dirname(f.rel) === "." ? [] : path.dirname(f.rel).split("/").filter(Boolean).reverse();
  for (const s of segs) { const c = pick(s); if (c) return c; }
  const n = f.name.toLowerCase();
  const rules = [
    [/\.(jpe?g|png|gif|webp|heic|bmp|tiff?)$/, "صور"],
    [/تقرير|تقارير|report/, "تقارير"],
    [/خطاب|مراسل|رسالة|تعميم|letter/, "خطابات"],
    [/نموذج|استمار|template|form/, "نماذج"],
    [/كتاب|كتب|دليل|مرجع|book|manual|guide/, "كتب ومراجع"],
  ];
  for (const [re, name] of rules) if (re.test(n)) { const c = pick(name); if (c) return c; }
  return pick("أخرى") || pick("غير مصنف") || cats[cats.length - 1];
}

async function collUpload(f) {
  if (f.size > COLL_MAX) { log(`تُخطّي «${f.name}» للزملاء: أكبر من 1 غيغابايت`); return true; }
  const cats = await collCategories();
  const cat = collCategory(f, cats);
  const created = new Date(f.birth || f.mtime);
  const init = await dropPublic("dropInit", {
    name: f.name, mime: mimeOf(f.name), size: f.size, by: collBy(), cat, title: "",
    origin: "https://tamkeen-admin.vercel.app",
    createdTime: Number.isFinite(created.getTime()) ? created.toISOString() : undefined,
  });
  const fh = await fsp.open(f.full, "r");
  try {
    for (let start = 0; start < f.size; start += COLL_CHUNK) {
      const len = Math.min(COLL_CHUNK, f.size - start);
      const buf = Buffer.alloc(len);
      const { bytesRead } = await fh.read(buf, 0, len, start);
      if (bytesRead !== len) throw new Error("تغيّر الملف أثناء الرفع، سيُعاد لاحقاً");
      let ok = false, last = null;
      for (let t = 0; t < 4 && !ok; t++) {
        try {
          const r = await fetch(init.url, { method: "PUT", redirect: "manual", headers: { "Content-Range": `bytes ${start}-${start + len - 1}/${f.size}` }, body: buf });
          if ([200, 201, 308].includes(r.status)) ok = true; else last = new Error(`رفض Google الدفعة (${r.status})`);
        } catch (e) { last = e; }
        if (!ok) await new Promise((res) => setTimeout(res, 1500 * (t + 1)));
      }
      if (!ok) throw last || new Error("انقطع الرفع");
    }
  } finally { await fh.close(); }
  log(`👥 الزملاء — ${collBy()} / ${cat} — ${f.rel}`);
  return true;
}

/* أول تشغيل: ما في المجلدات الآن يُختم ولا يُرفع، فيُرفع كل ما يضاف بعده فقط */
async function collSeedOnce() {
  if (!collOn() || state.collSeeded) return;
  state.coll = state.coll || {};
  for (const root of (config.folders || []).filter(Boolean)) {
    if (!fs.existsSync(root)) continue;
    for (const f of await listFiles(root)) state.coll[keyOf(f)] = Date.now();
  }
  state.collSeeded = true;
  saveState();
  log(`فعّلتُ الرفع إلى ملفات الزملاء (${collBy()}): ختمتُ ${Object.keys(state.coll).length} ملفاً موجوداً؛ يُرفع ما يُضاف بعد الآن.`);
}

/* ===== رفع ملف واحد وتسجيله ===== */
async function handleFile(f) {
  const key = keyOf(f);
  if (collOn()) {
    if (!(state.coll && state.coll[key])) {
      await collUpload(f);
      state.coll = state.coll || {};
      state.coll[key] = Date.now();
      saveState();
    }
    // «only»: وجهة الزملاء وحدها، فلا سجل ولا نسخة في مجلد المراقبة (حتى للملفات المختومة)
    if (config.colleagues.only) return true;
  }
  return handleFileMain(f);
}

async function handleFileMain(f) {
  const maxBytes = config.maxMB * 1024 * 1024;
  if (f.size > maxBytes) { log(`تُخطّي «${f.name}»: أكبر من ${config.maxMB} ميغابايت`); return false; }

  // الرفع المباشر إلى Drive: نسخة طبق الأصل من المجلد، والملف المعدَّل يستبدل نسخته
  if (driveOn()) {
    const data = (await fsp.readFile(f.full)).toString("base64");
    const up = await driveUpload(f, data);
    log(`☁ Drive — ${f.rel}`);
    if (!registryOn()) return true;
  }

  const type = config.type === "out" ? "out" : "in";
  const folderText = path.dirname(f.rel) === "." ? "" : path.dirname(f.rel);
  const date = dateFromText(f.name) || dateFromText(folderText) || localISO(new Date(f.mtime));
  const category = guessCategory(f.name) === "أخرى" && folderText ? guessCategory(folderText) : guessCategory(f.name);
  const head = `${type === "out" ? String(config.outPrefix).trim() : IN_PREFIX}/${date.slice(0, 4)}/`;

  const number = (await call("reserve", { head, count: 1 })).number;
  const data = (await fsp.readFile(f.full)).toString("base64");
  const owner = state.user || "";
  const drivePath = [owner, date.slice(0, 4), date.slice(5, 7), DIR_FOLDER[type], category].filter(Boolean);
  const safeNum = String(number).replace(/[\\/:*?"<>|]+/g, "-");
  const up = await call("upload", { name: `${safeNum} - ${f.name}`, mime: mimeOf(f.name), path: drivePath, data });

  const now = new Date().toISOString();
  const rec = {
    id: uid(),
    createdAt: now,
    updatedAt: now,
    source: "upload",
    owner,
    type,
    date,
    number,
    category,
    track: "",
    party: config.party || "",
    subject: f.name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim(),
    notes: folderText ? `من المجلد المراقَب: ${folderText}` : "من المجلد المراقَب",
    fileId: uid(),                  // الملف ليس على هذا المتصفح؛ المعرّف ليُظهر الموقع خانة المرفق
    fileName: f.name,
    fileDate: localISO(new Date(f.mtime)),
    driveId: up.id,
    driveLink: up.link,
    driveFolderId: up.folderId || "",
    drivePath,
    drivePending: false,
    history: [{ at: now, by: owner || "مراقب المجلد", action: `رفع تلقائي من المجلد المراقَب: ${f.name}` }],
  };
  await call("sync", { records: [rec], deleted: {} });
  log(`✔ ${number} — ${f.name}${folderText ? ` (${folderText})` : ""}`);
  return true;
}

/* ===== جولة فحص ===== */
async function round(seedOnly) {
  try { await collSeedOnce(); } catch (e) { log("تعذّر ختم الملفات الحالية للزملاء: " + e.message); }
  const folders = (config.folders || []).filter(Boolean);
  if (!folders.length) { log("لا توجد مجلدات في config.json — أضف مسار المجلد في folders"); return; }

  for (const root of folders) {
    if (!fs.existsSync(root)) { log(`المجلد غير موجود: ${root}`); continue; }
    const files = await listFiles(root);
    for (const f of files) {
      const key = keyOf(f);
      if (state.seen[key]) continue;
      if (seedOnly) { state.seen[key] = Date.now(); continue; }

      // لا يُرفع ملف ما زال يُنسخ أو يُمسح ضوئياً: ينتظر حتى يمضي على آخر تعديل وقتٌ كافٍ
      if (Date.now() - f.mtime < config.stableSeconds * 1000) continue;

      try {
        const done = await handleFile(f);
        state.seen[key] = Date.now();
        if (done) saveState();
      } catch (e) {
        log(`✖ تعذّر رفع «${f.name}»: ${e.message}`); // بلا تعليم: يُعاد في الجولة القادمة
        if (/الجلسة/.test(e.message)) return;
      }
    }
  }
  // تنظيف سجل الملفات المعروفة من القديم جداً (سنة)
  const year = Date.now() - 365 * 24 * 3600 * 1000;
  for (const k of Object.keys(state.seen)) if (state.seen[k] < year) delete state.seen[k];
  for (const k of Object.keys(state.coll || {})) if (state.coll[k] < year) delete state.coll[k];
  saveState();
}

/* ===== التشغيل ===== */
async function main() {
  const args = new Set(process.argv.slice(2));

  if (!fs.existsSync(CONFIG_PATH)) {
    writeJson(CONFIG_PATH, DEFAULTS);
    console.log(`أُنشئ ملف الإعدادات: ${CONFIG_PATH}\nافتحه وأضف مسار المجلد في folders ثم شغّل البرنامج من جديد.`);
    return;
  }

  if (args.has("--status")) {
    console.log(`الخادم: ${config.url}`);
    console.log(`المستخدم: ${state.user || "— لم يسجّل الدخول بعد —"}`);
    console.log(`المجلدات: ${(config.folders || []).join(" | ") || "—"}`);
    console.log(`النوع: ${config.type === "out" ? "صادر" : "وارد"} · كل ${config.intervalSeconds} ثانية`);
    console.log(`الوجهة: ${config.target === "drive" ? "Google Drive" : config.target === "both" ? "سجل المركز و Google Drive" : "سجل المركز"}`);
    console.log(`ملفات معروفة: ${Object.keys(state.seen).length}`);
    if (collOn()) console.log(`ملفات الزملاء: مفعّلة باسم «${collBy()}»${config.colleagues.only ? " (وحدها)" : ""} · ملفات مختومة ${Object.keys(state.coll || {}).length}`);
    return;
  }

  // نسيان السجل: يُستعمل عند تغيير الوجهة (إلى Drive مثلاً) ليُرفع ما في المجلد من جديد
  if (args.has("--unseed")) {
    const had = Object.keys(state.seen || {}).length;
    state.seen = {};
    saveState();
    log(`نُسي ${had} ملفاً كان مسجّلاً؛ سيُرفع كل ما في المجلد في الجولة القادمة.`);
    return;
  }

  // ختم الملفات الحالية لا يحتاج اتصالاً بالخادم
  if (args.has("--seed")) {
    await round(true);
    saveState();
    log("سُجّل ما في المجلدات الآن كملفات قديمة؛ لن تُرفع.");
    return;
  }

  // فحص إعداد Drive: يتحقق من الرابط والرمز ويطبع رابط المجلد
  if (args.has("--drive-check")) {
    if (!(config.drive && config.drive.url && config.drive.key)) { console.log(JSON.stringify({ ok: false, error: "رابط المساعد أو الرمز ناقص" })); process.exitCode = 1; return; }
    try {
      const r = await driveCall("watchPing");
      console.log(JSON.stringify({ ok: true, folder: r.folder }));
    } catch (e) {
      console.log(JSON.stringify({ ok: false, error: e.message }));
      process.exitCode = 1;
    }
    return;
  }

  if (args.has("--login-stdin")) { await loginFromStdin(); return; }
  if (args.has("--login")) { await login(); return; }
  if (registryOn()) await ensureSession();

  if (args.has("--once")) { await round(false); return; }

  log(`بدأت المراقبة: ${(config.folders || []).join(" | ")} — كل ${config.intervalSeconds} ثانية — الوجهة ${config.target === "drive" ? "Google Drive" : config.target === "both" ? "السجل و Drive" : "سجل المركز"}`);
  const tick = async () => {
    try { await round(false); } catch (e) { log("خطأ في الجولة: " + e.message); }
  };
  await tick();
  setInterval(tick, Math.max(10, Number(config.intervalSeconds) || 60) * 1000);
}

main().catch((e) => { log("توقّف البرنامج: " + e.message); process.exitCode = 1; });










:::PS1:::
#requires -version 5
<#
  تجهيز مراقب المجلدات — مساعد تمكين الإداري
  كل الأسئلة تظهر في نوافذ رسومية، لأن نافذة الأوامر في ويندوز
  لا تعرض العربية باتجاهها الصحيح.
#>
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$TITLE = "مراقب مجلدات تمكين"
$SERVER_URL = "https://wvgrjnwowueoiphgcrhg.supabase.co/functions/v1/tamkeen"
$FONT = New-Object System.Drawing.Font("Segoe UI", 11)

# ===== نوافذ عربية =====
function Show-Msg($text, $icon = "Information", $buttons = "OK") {
  return [System.Windows.Forms.MessageBox]::Show(
    $text, $TITLE,
    [System.Windows.Forms.MessageBoxButtons]::$buttons,
    [System.Windows.Forms.MessageBoxIcon]::$icon,
    [System.Windows.Forms.MessageBoxDefaultButton]::Button1,
    ([System.Windows.Forms.MessageBoxOptions]::RtlReading -bor [System.Windows.Forms.MessageBoxOptions]::RightAlign))
}

function New-Dialog($height) {
  $f = New-Object System.Windows.Forms.Form
  $f.Text = $TITLE
  $f.RightToLeft = "Yes"
  $f.RightToLeftLayout = $true
  $f.Font = $FONT
  $f.ClientSize = New-Object System.Drawing.Size(460, $height)
  $f.FormBorderStyle = "FixedDialog"
  $f.StartPosition = "CenterScreen"
  $f.MaximizeBox = $false
  $f.MinimizeBox = $false
  $f.TopMost = $true
  return $f
}

# ارتفاع النص كما يُرسم فعلاً داخل عرض النافذة
function Text-Height($text) {
  $size = [System.Windows.Forms.TextRenderer]::MeasureText(
    $text, $FONT, (New-Object System.Drawing.Size(428, 0)),
    ([System.Windows.Forms.TextFormatFlags]::WordBreak -bor [System.Windows.Forms.TextFormatFlags]::TextBoxControl))
  return [Math]::Max(24, $size.Height + 6)
}

function New-Label($text, $y, $height = 0) {
  $l = New-Object System.Windows.Forms.Label
  $l.Text = $text
  if ($height -le 0) { $height = Text-Height $text }
  $l.SetBounds(16, $y, 428, $height)
  return $l
}

function New-Btn($text, $x, $y, $result) {
  $b = New-Object System.Windows.Forms.Button
  $b.Text = $text
  $b.SetBounds($x, $y, 130, 34)
  $b.DialogResult = $result
  return $b
}

# سؤال بنص يُكتب
function Ask-Text($prompt, $default = "", $password = $false) {
  $lh = Text-Height $prompt
  $f = New-Dialog (16 + $lh + 12 + 30 + 18 + 34 + 16)
  $f.Controls.Add((New-Label $prompt 16 $lh))
  $t = New-Object System.Windows.Forms.TextBox
  $t.SetBounds(16, (16 + $lh + 12), 428, 30)
  $t.Text = $default
  if ($password) { $t.UseSystemPasswordChar = $true }
  $f.Controls.Add($t)
  $btnY = 16 + $lh + 12 + 30 + 18
  $ok = New-Btn "متابعة" 16 $btnY ([System.Windows.Forms.DialogResult]::OK)
  $cancel = New-Btn "إلغاء" 160 $btnY ([System.Windows.Forms.DialogResult]::Cancel)
  $f.Controls.AddRange(@($ok, $cancel))
  $f.AcceptButton = $ok; $f.CancelButton = $cancel
  $f.Add_Shown({ $t.Focus() })
  $r = $f.ShowDialog()
  $v = $t.Text
  $f.Dispose()
  if ($r -ne [System.Windows.Forms.DialogResult]::OK) { return $null }
  return $v
}

# سؤال باختيار من خيارين
function Ask-Choice($prompt, $first, $second) {
  $lh = Text-Height $prompt
  $top = 16 + $lh + 10
  $f = New-Dialog ($top + 60 + 18 + 34 + 16)
  $f.Controls.Add((New-Label $prompt 16 $lh))
  $r1 = New-Object System.Windows.Forms.RadioButton
  $r1.Text = $first; $r1.SetBounds(20, $top, 424, 28); $r1.Checked = $true
  $r2 = New-Object System.Windows.Forms.RadioButton
  $r2.Text = $second; $r2.SetBounds(20, ($top + 30), 424, 28)
  $btnY = $top + 60 + 18
  $ok = New-Btn "متابعة" 16 $btnY ([System.Windows.Forms.DialogResult]::OK)
  $cancel = New-Btn "إلغاء" 160 $btnY ([System.Windows.Forms.DialogResult]::Cancel)
  $f.Controls.AddRange(@($r1, $r2, $ok, $cancel))
  $f.AcceptButton = $ok; $f.CancelButton = $cancel
  $r = $f.ShowDialog()
  $one = $r1.Checked
  $f.Dispose()
  if ($r -ne [System.Windows.Forms.DialogResult]::OK) { return 0 }
  if ($one) { return 1 } else { return 2 }
}

# سؤال باختيار من ثلاثة خيارات
function Ask-Choice3($prompt, $first, $second, $third) {
  $lh = Text-Height $prompt
  $top = 16 + $lh + 10
  $f = New-Dialog ($top + 90 + 18 + 34 + 16)
  $f.Controls.Add((New-Label $prompt 16 $lh))
  $r1 = New-Object System.Windows.Forms.RadioButton
  $r1.Text = $first; $r1.SetBounds(20, $top, 424, 28); $r1.Checked = $true
  $r2 = New-Object System.Windows.Forms.RadioButton
  $r2.Text = $second; $r2.SetBounds(20, ($top + 30), 424, 28)
  $r3 = New-Object System.Windows.Forms.RadioButton
  $r3.Text = $third; $r3.SetBounds(20, ($top + 60), 424, 28)
  $btnY = $top + 90 + 18
  $ok = New-Btn "متابعة" 16 $btnY ([System.Windows.Forms.DialogResult]::OK)
  $cancel = New-Btn "إلغاء" 160 $btnY ([System.Windows.Forms.DialogResult]::Cancel)
  $f.Controls.AddRange(@($r1, $r2, $r3, $ok, $cancel))
  $f.AcceptButton = $ok; $f.CancelButton = $cancel
  $r = $f.ShowDialog()
  $pick = if ($r1.Checked) { 1 } elseif ($r2.Checked) { 2 } else { 3 }
  $f.Dispose()
  if ($r -ne [System.Windows.Forms.DialogResult]::OK) { return 0 }
  return $pick
}

# نافذة المجلدات المراقَبة: إضافة وحذف بلا حد
function Ask-Folders($start) {
  $f = New-Dialog 330
  $f.Controls.Add((New-Label "المجلدات التي تُراقَب — أضف ما شئت منها:" 12 28))
  $list = New-Object System.Windows.Forms.ListBox
  $list.SetBounds(16, 46, 428, 170)
  $list.HorizontalScrollbar = $true
  foreach ($d in $start) { if ($d) { [void]$list.Items.Add($d) } }
  $add = New-Btn "➕ إضافة مجلد" 16 224 ([System.Windows.Forms.DialogResult]::None)
  $add.Width = 160
  $del = New-Btn "➖ حذف المحدَّد" 186 224 ([System.Windows.Forms.DialogResult]::None)
  $del.Width = 150
  $ok = New-Btn "متابعة" 16 272 ([System.Windows.Forms.DialogResult]::OK)
  $cancel = New-Btn "إلغاء" 160 272 ([System.Windows.Forms.DialogResult]::Cancel)
  $add.Add_Click({
    $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
    $dlg.Description = "اختر مجلداً تريد رفع ملفاته تلقائياً"
    $dlg.ShowNewFolderButton = $true
    if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
      $picked = $dlg.SelectedPath
      if (-not $list.Items.Contains($picked)) { [void]$list.Items.Add($picked) }
    }
  })
  $del.Add_Click({ if ($list.SelectedIndex -ge 0) { $list.Items.RemoveAt($list.SelectedIndex) } })
  $f.Controls.AddRange(@($list, $add, $del, $ok, $cancel))
  $f.AcceptButton = $ok; $f.CancelButton = $cancel
  # قائمة فارغة: تُفتح نافذة الاختيار مباشرة
  if ($list.Items.Count -eq 0) { $f.Add_Shown({ $add.PerformClick() }) }
  $r = $f.ShowDialog()
  $out = @($list.Items)
  $f.Dispose()
  if ($r -ne [System.Windows.Forms.DialogResult]::OK) { return $null }
  return $out
}

# نافذة الدخول: اسم المستخدم وكلمة المرور معاً
function Ask-Login() {
  $intro = "سجّل الدخول باسم المستخدم وكلمة المرور نفسيهما في الموقع.`nكلمة المرور لا تُحفظ في أي ملف؛ يُحفظ رمز جلسة صالح ٣٠ يوماً."
  $ih = Text-Height $intro
  $f = New-Dialog (250 + [Math]::Max(0, $ih - 60))
  $f.Controls.Add((New-Label $intro 12 $ih))
  $lu = New-Object System.Windows.Forms.Label; $lu.Text = "اسم المستخدم"; $lu.SetBounds(16, 80, 428, 22)
  $tu = New-Object System.Windows.Forms.TextBox; $tu.SetBounds(16, 104, 428, 30)
  $lp = New-Object System.Windows.Forms.Label; $lp.Text = "كلمة المرور"; $lp.SetBounds(16, 142, 428, 22)
  $tp = New-Object System.Windows.Forms.TextBox; $tp.SetBounds(16, 166, 428, 30); $tp.UseSystemPasswordChar = $true
  $ok = New-Btn "دخول" 16 205 ([System.Windows.Forms.DialogResult]::OK)
  $cancel = New-Btn "إلغاء" 160 205 ([System.Windows.Forms.DialogResult]::Cancel)
  $f.Controls.AddRange(@($lu, $tu, $lp, $tp, $ok, $cancel))
  $f.AcceptButton = $ok; $f.CancelButton = $cancel
  $f.Add_Shown({ $tu.Focus() })
  $r = $f.ShowDialog()
  $out = @{ user = $tu.Text; pass = $tp.Text }
  $f.Dispose()
  if ($r -ne [System.Windows.Forms.DialogResult]::OK) { return $null }
  return $out
}

# تشغيل أمر node بلا نافذة، وإعادة مخرجاته
function Run-Node($nodeArgs, $stdinText = $null, $configPath = $null) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = "node"
  $psi.Arguments = $nodeArgs
  $psi.WorkingDirectory = $here
  # الفحص يجري على ملف إعدادات مؤقت، فلا يمسّ إعدادات المستخدم
  if ($configPath) { $psi.EnvironmentVariables["TAMKEEN_WATCH_CONFIG"] = $configPath }
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
  $psi.StandardErrorEncoding = [System.Text.Encoding]::UTF8
  if ($null -ne $stdinText) { $psi.RedirectStandardInput = $true }
  $p = [System.Diagnostics.Process]::Start($psi)
  if ($null -ne $stdinText) {
    $p.StandardInput.WriteLine($stdinText)
    $p.StandardInput.Close()
  }
  $out = $p.StandardOutput.ReadToEnd() + $p.StandardError.ReadToEnd()
  $p.WaitForExit()
  return @{ code = $p.ExitCode; text = $out.Trim() }
}

# ===== ١) Node.js =====
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Show-Msg "لم أجد Node.js على الجهاز، وهو مطلوب لتشغيل المراقب.`n`nسأفتح لك صفحة التحميل: نزّل نسخة LTS، ثبّتها (التالي… التالي… تم)، ثم شغّل هذا الملف من جديد." "Warning" | Out-Null
  Start-Process "https://nodejs.org/ar/download"
  exit 1
}

# ===== ٢) المجلد المراقَب =====
$cfgPath = Join-Path $here "config.json"
$old = $null
if (Test-Path $cfgPath) {
  try { $old = Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json } catch { $old = $null }
}
$previous = @()
if ($old -and $old.folders) { $previous = @($old.folders | Where-Object { $_ }) }
if ($previous.Count -eq 0) {
  Show-Msg "اختر المجلدات التي تريد مراقبتها — مجلد الماسح الضوئي مثلاً.`n`nيمكنك إضافة أكثر من مجلد، وكل ملف جديد في أيٍّ منها يُرفع تلقائياً." | Out-Null
}
$folders = Ask-Folders $previous
if ($null -eq $folders -or $folders.Count -eq 0) {
  Show-Msg "لم تختر أي مجلد، فأُلغي التجهيز." "Warning" | Out-Null
  exit 1
}
$folder = $folders[0]
$folderText = if ($folders.Count -eq 1) { $folders[0] } else { ($folders | ForEach-Object { "• " + $_ }) -join "`n" }

# ===== ٣) إلى أين تُرفع الملفات؟ =====
$dest = Ask-Choice3 ("ملفات " + $(if ($folders.Count -gt 1) { "هذه المجلدات" } else { "هذا المجلد" }) + ":`n" + $folderText + "`n`nتُرفع إلى:") `
  "سجل الوارد والصادر في الموقع" "Google Drive مباشرة" "الاثنين معاً"
if ($dest -eq 0) { exit 1 }
$target = @{ 1 = "registry"; 2 = "drive"; 3 = "both" }[$dest]
$toRegistry = $target -ne "drive"
$toDrive = $target -ne "registry"

# ===== ٤) إعداد الرفع المباشر إلى Drive =====
$driveUrl = $(if ($old -and $old.drive) { $old.drive.url } else { "" })
$driveKey = $(if ($old -and $old.drive) { $old.drive.key } else { "" })
if ($toDrive) {
  $okDrive = $false
  for ($i = 0; $i -lt 3 -and -not $okDrive; $i++) {
    $u = Ask-Text "رابط «مساعد Google» (رابط النشر تطبيق ويب المنتهي بـ ‎/exec‎):" $driveUrl
    if ($null -eq $u) { exit 1 }
    $k = Ask-Text "رمز المراقب:`n(شغّل الدالة setupWatchKey في محرر Apps Script وانسخ الرمز من السجل)" $driveKey $true
    if ($null -eq $k) { exit 1 }
    $driveUrl = $u.Trim(); $driveKey = $k.Trim()
    $probePath = Join-Path $env:TEMP ("tamkeen-watch-probe-" + [guid]::NewGuid().ToString("N") + ".json")
    $probe = [ordered]@{ url = $SERVER_URL; folders = @($folders); type = "in"; party = ""; outPrefix = "م ت"; intervalSeconds = 60; stableSeconds = 10; maxMB = 45; subfolders = $true; target = "drive"; drive = [ordered]@{ url = $driveUrl; key = $driveKey } }
    [System.IO.File]::WriteAllText($probePath, ($probe | ConvertTo-Json -Depth 5), (New-Object System.Text.UTF8Encoding($false)))
    $r = Run-Node "watch-folder.mjs --drive-check" $null $probePath
    Remove-Item -LiteralPath $probePath -Force -ErrorAction SilentlyContinue
    if ($r.code -eq 0) {
      $okDrive = $true
      try { $driveFolder = ($r.text | ConvertFrom-Json).folder } catch { $driveFolder = "" }
    } else {
      Show-Msg ("تعذّر الوصول إلى مساعد Google:`n`n" + $r.text + "`n`nالأسباب الشائعة:`n١) لصقت السكربت ولم تنشره: نشر ← إدارة عمليات النشر ← ✏ تعديل ← الإصدار: إصدار جديد ← نشر.`n٢) لم تُشغّل الدالة setupWatchKey بعد، فلا يوجد رمز.`n٣) الرمز نُسخ ناقصاً أو معه كلمات السطر أو مسافة.`n٤) شغّلت setupWatchKey في مشروع سكربت غير صاحب هذا الرابط.") "Error" | Out-Null
    }
  }
  if (-not $okDrive) { exit 1 }
}

# ===== ٥) وارد أم صادر =====
$type = "in"
if ($toRegistry) {
  $c = Ask-Choice "تُسجَّل ملفات هذا المجلد في:" "الوارد" "الصادر"
  if ($c -eq 0) { exit 1 }
  $type = if ($c -eq 2) { "out" } else { "in" }
}

# ===== ٦) الجهة والمدة والبادئة =====
$party = ""
if ($toRegistry) {
  $party = Ask-Text "الجهة الافتراضية التي تُكتب في القيد:`n(اتركها فارغة إن اختلفت من ملف لآخر)" $(if ($old) { $old.party } else { "" })
  if ($null -eq $party) { exit 1 }
}

$everyText = Ask-Text "كل كم ثانية يفحص المجلد؟" $(if ($old -and $old.intervalSeconds) { [string]$old.intervalSeconds } else { "60" })
if ($null -eq $everyText) { exit 1 }
$every = 60
if ($everyText -match '^\s*\d+\s*$' -and [int]$everyText.Trim() -ge 10) { $every = [int]$everyText.Trim() }

$prefix = "م ت"
if ($old -and $old.outPrefix) { $prefix = $old.outPrefix }
if ($toRegistry -and $type -eq "out") {
  $p = Ask-Text "بادئة رقم الصادر كما في إعدادات الموقع:" $prefix
  if ($null -eq $p) { exit 1 }
  if ($p.Trim()) { $prefix = $p.Trim() }
}

# ===== ٥) حفظ الإعدادات =====
$config = [ordered]@{
  url             = $SERVER_URL
  folders         = @($folders)
  type            = $type
  party           = $party.Trim()
  outPrefix       = $prefix
  intervalSeconds = $every
  stableSeconds   = 10
  maxMB           = 45
  subfolders      = $true
  target          = $target
  drive           = [ordered]@{ url = $driveUrl; key = $driveKey }
}
# خادم مختلف محفوظ سابقاً يُحترم، أما قيمة معطوبة فتُتجاهل ويعود الرابط الأصلي
if ($old -and $old.url -and $old.url -match '^https?://') { $config.url = $old.url }
[System.IO.File]::WriteAllText($cfgPath, ($config | ConvertTo-Json -Depth 5), (New-Object System.Text.UTF8Encoding($false)))

# ===== ٦) الملفات الموجودة الآن =====
$existing = 0
foreach ($d in $folders) { $existing += @(Get-ChildItem -LiteralPath $d -File -Recurse -ErrorAction SilentlyContinue).Count }
$seedAns = Ask-Choice ("المجلد فيه الآن " + $existing + " ملفاً.`n`nماذا أفعل بها؟") "اعتبرها قديمة، وارفع الجديد فقط (الأسلم)" "ارفعها كلها إلى السجل الآن"
if ($seedAns -eq 0) { exit 1 }
if ($seedAns -eq 1) { Run-Node "watch-folder.mjs --seed" | Out-Null }
# «ارفعها كلها»: يُنسى ما سُجّل في تشغيل سابق وإلا لن يُعاد رفع شيء
else { Run-Node "watch-folder.mjs --unseed" | Out-Null }

# ===== ٧) الدخول (لسجل المركز فقط) =====
$signed = -not $toRegistry
for ($i = 0; $i -lt 3 -and -not $signed; $i++) {
  $cred = Ask-Login
  if ($null -eq $cred) { exit 1 }
  $payload = (@{ username = $cred.user; password = $cred.pass } | ConvertTo-Json -Compress)
  $r = Run-Node "watch-folder.mjs --login-stdin" $payload
  if ($r.code -eq 0) { $signed = $true }
  else { Show-Msg ("تعذّر الدخول:`n`n" + $r.text) "Error" | Out-Null }
}
if (-not $signed) { exit 1 }

# ===== ملف التشغيل السريع: يُنشأ إن لم يكن موجوداً (مثلاً عند نسخ ملف الباتش وحده) =====
$runCmd = Join-Path $here "تشغيل-المراقب.cmd"
if (-not (Test-Path $runCmd)) {
  $runText = @(
    '@echo off',
    'cd /d "%~dp0"',
    'start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0watcher-ui.ps1"',
    'exit /b'
  ) -join "`r`n"
  [System.IO.File]::WriteAllText($runCmd, $runText, (New-Object System.Text.ASCIIEncoding))
}

# ===== ٨) التشغيل مع إقلاع ويندوز =====
$startup = [Environment]::GetFolderPath("Startup")
$lnk = Join-Path $startup "مراقب مجلدات تمكين.lnk"
$auto = Show-Msg "أشغّل المراقب تلقائياً مع تشغيل الجهاز؟" "Question" "YesNo"
if ($auto -eq [System.Windows.Forms.DialogResult]::Yes) {
  $ws = New-Object -ComObject WScript.Shell
  $sc = $ws.CreateShortcut($lnk)
  $sc.TargetPath = $runCmd
  $sc.WorkingDirectory = $here
  $sc.WindowStyle = 7
  $sc.Description = "مراقب مجلدات مساعد تمكين الإداري"
  $sc.Save()
} elseif (Test-Path $lnk) {
  Remove-Item $lnk -Force -ErrorAction SilentlyContinue
}

# ===== ٩) التشغيل الآن =====
Start-Process -FilePath $runCmd -WorkingDirectory $here

$summary = @(
  "المراقبة تعمل الآن ✔",
  "",
  ($(if ($folders.Count -gt 1) { "المجلدات:`n" + $folderText } else { "المجلد: " + $folders[0] })),
  ("الوجهة: " + $(if ($target -eq "drive") { "Google Drive" } elseif ($target -eq "both") { "سجل المركز و Google Drive" } else { "سجل المركز" })),
  ("النوع: " + $(if ($toRegistry) { if ($type -eq "out") { "صادر" } else { "وارد" } } else { "—" })),
  ("الفحص: كل " + $every + " ثانية"),
  ("مع إقلاع ويندوز: " + $(if ($auto -eq [System.Windows.Forms.DialogResult]::Yes) { "نعم" } else { "لا" })),
  "",
  "تفتح نافذة «مراقب مجلدات تمكين» وتعرض ما يجري أولاً بأول — إغلاقها يوقف المراقبة.",
  "وكل ما يجري مكتوب في الملف watcher.log بجانب البرنامج.",
  "",
  $(if ($toDrive -and $driveFolder) { "هل تريد فتح مجلد المراقبة في Google Drive الآن؟" } else { "هل تريد فتح مجلد البرنامج الآن؟" })
) -join "`n"
if ((Show-Msg $summary "Information" "YesNo") -eq [System.Windows.Forms.DialogResult]::Yes) {
  if ($toDrive -and $driveFolder) { Start-Process $driveFolder } else { Start-Process explorer.exe $here }
}


:::UI:::
#requires -version 5
<#
  نافذة مراقب المجلدات: تشغّل البرنامج في الخلفية وتعرض ما يجري بالعربية.
  نافذة الأوامر السوداء لا تعرض العربية باتجاهها الصحيح، فهذه بديلها.
#>
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$logPath = Join-Path $here "watcher.log"
$TITLE = "مراقب مجلدات تمكين"

function Show-Msg($text, $icon = "Information", $buttons = "OK") {
  return [System.Windows.Forms.MessageBox]::Show(
    $text, $TITLE,
    [System.Windows.Forms.MessageBoxButtons]::$buttons,
    [System.Windows.Forms.MessageBoxIcon]::$icon,
    [System.Windows.Forms.MessageBoxDefaultButton]::Button1,
    ([System.Windows.Forms.MessageBoxOptions]::RtlReading -bor [System.Windows.Forms.MessageBoxOptions]::RightAlign))
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Show-Msg "لم أجد Node.js على الجهاز، وهو مطلوب لتشغيل المراقب." "Warning" | Out-Null
  exit 1
}
if (-not (Test-Path (Join-Path $here "config.json"))) {
  Show-Msg "لا توجد إعدادات بعد. شغّل ملف التجهيز أولاً (مراقب-تمكين.bat)." "Warning" | Out-Null
  exit 1
}

# ===== تشغيل البرنامج بلا نافذة أوامر =====
function Start-Watcher {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = "node"
  $psi.Arguments = "watch-folder.mjs"
  $psi.WorkingDirectory = $here
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  return [System.Diagnostics.Process]::Start($psi)
}
$proc = Start-Watcher

# ===== النافذة =====
$form = New-Object System.Windows.Forms.Form
$form.Text = $TITLE
$form.RightToLeft = "Yes"
$form.RightToLeftLayout = $true
$form.Font = New-Object System.Drawing.Font("Segoe UI", 10)
$form.ClientSize = New-Object System.Drawing.Size(620, 420)
$form.MinimumSize = New-Object System.Drawing.Size(520, 330)
$form.StartPosition = "CenterScreen"

$state = New-Object System.Windows.Forms.Label
$state.SetBounds(12, 10, 596, 26)
$state.Anchor = "Top,Left,Right"
$state.Text = "جارٍ التشغيل…"
$state.ForeColor = [System.Drawing.Color]::FromArgb(0, 110, 60)

$box = New-Object System.Windows.Forms.TextBox
$box.Multiline = $true
$box.ReadOnly = $true
$box.ScrollBars = "Vertical"
$box.BackColor = [System.Drawing.Color]::White
$box.SetBounds(12, 42, 596, 320)
$box.TabStop = $false
$box.Anchor = "Top,Bottom,Left,Right"

$btnLog = New-Object System.Windows.Forms.Button
$btnLog.Text = "فتح ملف السجل"
$btnLog.SetBounds(12, 372, 150, 34)
$btnLog.Anchor = "Bottom,Right"

$btnFolder = New-Object System.Windows.Forms.Button
$btnFolder.Text = "فتح مجلد البرنامج"
$btnFolder.SetBounds(172, 372, 160, 34)
$btnFolder.Anchor = "Bottom,Right"

$btnStop = New-Object System.Windows.Forms.Button
$btnStop.Text = "إيقاف المراقبة"
$btnStop.SetBounds(458, 372, 150, 34)
$btnStop.Anchor = "Bottom,Left"

$form.Controls.AddRange(@($state, $box, $btnLog, $btnFolder, $btnStop))

# ===== عرض آخر السجل =====
$script:lastStamp = [datetime]::MinValue
function Refresh-Log {
  if (Test-Path $logPath) {
    $info = Get-Item $logPath
    if ($info.LastWriteTime -ne $script:lastStamp) {
      $script:lastStamp = $info.LastWriteTime
      $lines = Get-Content -LiteralPath $logPath -Tail 200 -Encoding UTF8
      $box.Lines = $lines
      $box.SelectionStart = $box.TextLength
      $box.ScrollToCaret()
    }
  } else {
    $box.Text = "لم يُكتب في السجل شيء بعد."
  }
  if ($proc -and -not $proc.HasExited) {
    $state.Text = "المراقبة تعمل ✔   —   إغلاق هذه النافذة يوقفها"
    $state.ForeColor = [System.Drawing.Color]::FromArgb(0, 110, 60)
  } else {
    $state.Text = "المراقبة متوقفة ✖   —   أغلق النافذة وشغّلها من جديد"
    $state.ForeColor = [System.Drawing.Color]::FromArgb(170, 30, 30)
  }
}

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 2000
$timer.Add_Tick({ Refresh-Log })

$btnLog.Add_Click({ if (Test-Path $logPath) { Start-Process notepad.exe $logPath } })
$btnFolder.Add_Click({ Start-Process explorer.exe $here })
$btnStop.Add_Click({
  if ((Show-Msg "إيقاف المراقبة الآن؟" "Question" "YesNo") -eq [System.Windows.Forms.DialogResult]::Yes) {
    $form.Close()
  }
})
$form.Add_FormClosing({
  $timer.Stop()
  if ($proc -and -not $proc.HasExited) { try { $proc.Kill() } catch { } }
})
$form.Add_Shown({ Refresh-Log; $timer.Start() })

[void]$form.ShowDialog()
