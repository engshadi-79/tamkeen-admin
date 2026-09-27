@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Tamkeen folder watcher

rem ===== one self-contained file: extracts the watcher, then runs the Arabic setup =====

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is required and was not found on this machine.
  echo   Opening the download page: install the LTS version, then run this file again.
  echo.
  start https://nodejs.org/ar/download
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "$src=[IO.File]::ReadAllLines('%~f0',[Text.Encoding]::UTF8); $a=[Array]::IndexOf($src,':::JS:::'); $b=[Array]::IndexOf($src,':::PS1:::'); if($a -lt 0 -or $b -lt 0){exit 1}; [IO.File]::WriteAllLines((Join-Path '%~dp0' 'watch-folder.mjs'), $src[($a+1)..($b-1)], (New-Object Text.UTF8Encoding($false))); [IO.File]::WriteAllLines((Join-Path '%~dp0' 'setup.ps1'), $src[($b+1)..($src.Length-1)], (New-Object Text.UTF8Encoding($true)))"
if errorlevel 1 (
  echo   Could not extract the watcher files.
  pause
  exit /b 1
)

if /i "%~1"=="/extract" (
  echo   Extracted watch-folder.mjs and setup.ps1 next to this file.
  exit /b 0
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
if errorlevel 1 pause
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
     node watch-folder.mjs --seed    اعتبار ما في المجلد الآن قديماً بلا رفع
*/
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(HERE, "config.json");
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
      out.push({ full, name: e.name, size: st.size, mtime: Math.round(st.mtimeMs), rel: path.relative(root, full).replace(/\\/g, "/") });
    }
  }
  await walk(root, 0);
  return out;
}

const keyOf = (f) => `${f.full}|${f.size}|${f.mtime}`;

/* ===== رفع ملف واحد وتسجيله ===== */
async function handleFile(f) {
  const maxBytes = config.maxMB * 1024 * 1024;
  if (f.size > maxBytes) { log(`تُخطّي «${f.name}»: أكبر من ${config.maxMB} ميغابايت`); return false; }

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
    console.log(`ملفات معروفة: ${Object.keys(state.seen).length}`);
    return;
  }

  // ختم الملفات الحالية لا يحتاج اتصالاً بالخادم
  if (args.has("--seed")) {
    await round(true);
    saveState();
    log("سُجّل ما في المجلدات الآن كملفات قديمة؛ لن تُرفع.");
    return;
  }

  if (args.has("--login")) { await login(); return; }
  await ensureSession();

  if (args.has("--once")) { await round(false); return; }

  log(`بدأت المراقبة: ${(config.folders || []).join(" | ")} — كل ${config.intervalSeconds} ثانية — النوع ${config.type === "out" ? "صادر" : "وارد"}`);
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
  يسألك أسئلة قليلة ثم يجهّز كل شيء ويشغّل المراقبة.
  لا تحتاج قبله إلا تثبيت Node.js من https://nodejs.org
#>
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

function Say($text, $color = "White") { Write-Host $text -ForegroundColor $color }
function Line { Say ("-" * 60) "DarkGray" }

Say ""
Say "   مراقب المجلدات — مساعد تمكين الإداري" "Cyan"
Line
Say "هذا البرنامج يراقب مجلداً على جهازك، وكل ملف جديد فيه يُرفع إلى أرشيف"
Say "المركز ويُسجَّل في الوارد والصادر برقم من الخادم — والموقع مغلق."
Line
Say ""

# ===== 1) التحقق من Node.js =====
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Say "لم أجد Node.js على الجهاز، وهو مطلوب لتشغيل المراقب." "Yellow"
  Say "سأفتح لك صفحة التحميل: نزّل نسخة LTS، ثبّتها (التالي… التالي… تم)،"
  Say "ثم شغّل هذا الملف من جديد." "Yellow"
  Start-Process "https://nodejs.org/ar/download"
  Read-Host "اضغط Enter للخروج"
  exit 1
}
Say ("✔ Node.js موجود: " + (node -v)) "Green"

# ===== 2) اختيار المجلد المراقَب =====
$cfgPath = Join-Path $here "config.json"
$old = $null
if (Test-Path $cfgPath) {
  try { $old = Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json } catch { $old = $null }
}
if ($old -and $old.folders -and $old.folders.Count -gt 0) {
  Say ""
  Say ("يوجد إعداد سابق للمجلد: " + ($old.folders -join " | ")) "Yellow"
  $keep = Read-Host "هل تبقيه كما هو؟ (Enter = نعم / n = اختيار مجلد جديد)"
  if ($keep -notmatch '^[nNلغ]') { $folder = $old.folders[0] }
}

if (-not $folder) {
  Say ""
  Say "اختر المجلد الذي تريد مراقبته (مجلد المسح الضوئي مثلاً)…" "Cyan"
  Add-Type -AssemblyName System.Windows.Forms
  $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
  $dlg.Description = "اختر المجلد الذي تريد رفع ملفاته تلقائياً"
  $dlg.ShowNewFolderButton = $true
  if ($dlg.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
    Say "لم تختر مجلداً. أُلغي التجهيز." "Yellow"
    Read-Host "اضغط Enter للخروج"
    exit 1
  }
  $folder = $dlg.SelectedPath
}
Say ("المجلد: " + $folder) "Green"

# ===== 3) وارد أم صادر =====
Say ""
Say "ملفات هذا المجلد تُسجَّل في:"
Say "   1 = الوارد   (الافتراضي)"
Say "   2 = الصادر"
$t = Read-Host "اكتب 1 أو 2"
$type = if ($t -eq "2") { "out" } else { "in" }
Say ("النوع: " + $(if ($type -eq "out") { "صادر" } else { "وارد" })) "Green"

# ===== 4) الجهة الافتراضية ومدة الفحص =====
$party = Read-Host "الجهة الافتراضية في القيد (اتركها فارغة إن اختلفت من ملف لآخر)"
$everyText = Read-Host "كل كم ثانية يفحص المجلد؟ (Enter = 60)"
$every = 60
if ($everyText -match '^\d+$' -and [int]$everyText -ge 10) { $every = [int]$everyText }

$prefix = "م ت"
if ($type -eq "out") {
  $p = Read-Host "بادئة رقم الصادر كما في إعدادات الموقع (Enter = م ت)"
  if ($p.Trim()) { $prefix = $p.Trim() }
}

# ===== 5) كتابة الإعدادات =====
$config = [ordered]@{
  url             = "https://wvgrjnwowueoiphgcrhg.supabase.co/functions/v1/tamkeen"
  folders         = @($folder)
  type            = $type
  party           = $party.Trim()
  outPrefix       = $prefix
  intervalSeconds = $every
  stableSeconds   = 10
  maxMB           = 45
  subfolders      = $true
}
if ($old -and $old.url) { $config.url = $old.url }
$json = $config | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText($cfgPath, $json, (New-Object System.Text.UTF8Encoding($false)))
Say ""
Say "✔ حُفظت الإعدادات في config.json" "Green"

# ===== 6) الملفات الموجودة الآن: تُرفع أم تُعتبر قديمة؟ =====
$existing = @(Get-ChildItem -LiteralPath $folder -File -Recurse -ErrorAction SilentlyContinue).Count
Say ""
Say ("المجلد فيه الآن " + $existing + " ملفاً.") "Yellow"
Say "   1 = اعتبرها قديمة، وارفع الجديد فقط  (الافتراضي والأسلم)"
Say "   2 = ارفعها كلها إلى السجل الآن"
$seedAns = Read-Host "اكتب 1 أو 2"
if ($seedAns -ne "2") {
  node watch-folder.mjs --seed
  Say "✔ الملفات الحالية لن تُرفع؛ المراقبة تبدأ مما بعدها." "Green"
} else {
  Say "ستُرفع كل ملفات المجلد بعد تسجيل الدخول." "Yellow"
}

# ===== 7) تسجيل الدخول =====
Say ""
Line
Say "سجّل الدخول باسم المستخدم وكلمة المرور نفسيهما في الموقع." "Cyan"
Say "كلمة المرور لا تُحفظ في أي ملف؛ يُحفظ رمز جلسة صالح ٣٠ يوماً." "DarkGray"
Line
node watch-folder.mjs --login
if ($LASTEXITCODE -ne 0) {
  Say "لم يتم الدخول. شغّل الملف من جديد وحاول مرة أخرى." "Red"
  Read-Host "اضغط Enter للخروج"
  exit 1
}

# ===== 8) التشغيل مع إقلاع ويندوز =====
Say ""
$auto = Read-Host "أشغّل المراقب تلقائياً مع تشغيل الجهاز؟ (y = نعم / n = لا)"
if ($auto -match '^[yY]') {
  $startup = [Environment]::GetFolderPath("Startup")
  $lnk = Join-Path $startup "مراقب مجلدات تمكين.lnk"
  $ws = New-Object -ComObject WScript.Shell
  $sc = $ws.CreateShortcut($lnk)
  $sc.TargetPath = Join-Path $here "تشغيل-المراقب.cmd"
  $sc.WorkingDirectory = $here
  $sc.Description = "مراقب مجلدات مساعد تمكين الإداري"
  $sc.Save()
  Say ("✔ أُضيف إلى بدء التشغيل: " + $lnk) "Green"
  Say "   لإيقافه لاحقاً: احذف هذا الاختصار (Win+R ثم shell:startup)." "DarkGray"
}

# ===== 9) التشغيل =====
Say ""
Line
Say "كل شيء جاهز. ستبدأ المراقبة الآن، واترك هذه النافذة مفتوحة." "Cyan"
Say "لإيقاف المراقبة: أغلق النافذة. ولتشغيلها لاحقاً: تشغيل-المراقب.cmd" "DarkGray"
Say "كل ما يجري يُكتب أيضاً في watcher.log بجانب البرنامج." "DarkGray"
Line
Say ""
node watch-folder.mjs
Read-Host "توقّف المراقب. اضغط Enter للإغلاق"
