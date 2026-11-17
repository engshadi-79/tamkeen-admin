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
  colleagues: { enabled: false, by: "", only: false, defaultCat: "" }, // رفع كل ما يضاف إلى «ملفات الزملاء» في تمكين باسم by (only = بلا سجل ولا نسخة المراقب)
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
/* config.ignore: أسماء أو مسارات (نسبةً إلى المجلد المراقَب) تُتجاهل مع ما تحتها، مثل ["ملفات الزملاء","نماذجي"] */
const isIgnored = (rel) => (config.ignore || []).some((x) => {
  const g = String(x || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  return g && (rel === g || rel.startsWith(g + "/"));
});

async function listFiles(root) {
  const out = [];
  async function walk(dir, depth) {
    if (depth > 8) return;
    let entries = [];
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      if (SKIP.test(e.name)) continue;
      const full = path.join(dir, e.name);
      if (isIgnored(path.relative(root, full).replace(/\\/g, "/"))) continue;
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
  return pick((config.colleagues || {}).defaultCat) || pick("أخرى") || pick("غير مصنف") || cats[cats.length - 1];
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
  if (!collOn()) return;
  state.coll = state.coll || {};
  // مجلد ختمه الإصدار القديم (collSeeded) له مفاتيح في state.coll تبدأ بمساره
  const sealed = new Set(state.collRoots || []);
  const hadAny = (root) => Object.keys(state.coll).some((k) => k.startsWith(root + path.sep) || k.startsWith(root + "/"));
  const cutoff = Date.parse((config.colleagues || {}).sealBefore || "");
  let added = 0, fresh = [];
  for (const root of (config.folders || []).filter(Boolean)) {
    if (sealed.has(root) || (state.collSeeded && !state.collRoots && hadAny(root))) { sealed.add(root); continue; }
    if (!fs.existsSync(root)) continue;
    for (const f of await listFiles(root)) {
      if (Number.isFinite(cutoff) && f.mtime >= cutoff) continue;      // أحدث من sealBefore: يُعدّ جديداً ويُرفع
      state.coll[keyOf(f)] = Date.now(); added++;
    }
    sealed.add(root); fresh.push(root);
  }
  if (!fresh.length && state.collSeeded) { state.collRoots = [...sealed]; return; }
  state.collRoots = [...sealed];
  state.collSeeded = true;
  saveState();
  if (fresh.length) log(`فعّلتُ الرفع إلى ملفات الزملاء (${collBy()}) للمجلد: ${fresh.join(" | ")} — ختمتُ ${added} ملفاً موجوداً؛ يُرفع ما يُضاف بعد الآن.`);
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









