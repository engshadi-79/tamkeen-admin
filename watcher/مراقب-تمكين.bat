@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Tamkeen folder watcher

rem ===== one self-contained file: extracts the watcher, then runs the Arabic setup =====

rem فحص Node.js يجري داخل setup.ps1 ويُعرض في نافذة رسومية

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

  if (args.has("--login-stdin")) { await loginFromStdin(); return; }
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

function New-Label($text, $y, $height = 46) {
  $l = New-Object System.Windows.Forms.Label
  $l.Text = $text
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
  $f = New-Dialog 170
  $f.Controls.Add((New-Label $prompt 16))
  $t = New-Object System.Windows.Forms.TextBox
  $t.SetBounds(16, 68, 428, 30)
  $t.Text = $default
  if ($password) { $t.UseSystemPasswordChar = $true }
  $f.Controls.Add($t)
  $ok = New-Btn "متابعة" 16 115 ([System.Windows.Forms.DialogResult]::OK)
  $cancel = New-Btn "إلغاء" 160 115 ([System.Windows.Forms.DialogResult]::Cancel)
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
  $f = New-Dialog 190
  $f.Controls.Add((New-Label $prompt 16 60))
  $r1 = New-Object System.Windows.Forms.RadioButton
  $r1.Text = $first; $r1.SetBounds(20, 80, 424, 28); $r1.Checked = $true
  $r2 = New-Object System.Windows.Forms.RadioButton
  $r2.Text = $second; $r2.SetBounds(20, 110, 424, 28)
  $ok = New-Btn "متابعة" 16 145 ([System.Windows.Forms.DialogResult]::OK)
  $cancel = New-Btn "إلغاء" 160 145 ([System.Windows.Forms.DialogResult]::Cancel)
  $f.Controls.AddRange(@($r1, $r2, $ok, $cancel))
  $f.AcceptButton = $ok; $f.CancelButton = $cancel
  $r = $f.ShowDialog()
  $one = $r1.Checked
  $f.Dispose()
  if ($r -ne [System.Windows.Forms.DialogResult]::OK) { return 0 }
  if ($one) { return 1 } else { return 2 }
}

# نافذة الدخول: اسم المستخدم وكلمة المرور معاً
function Ask-Login() {
  $f = New-Dialog 250
  $f.Controls.Add((New-Label "سجّل الدخول باسم المستخدم وكلمة المرور نفسيهما في الموقع.`nكلمة المرور لا تُحفظ في أي ملف؛ يُحفظ رمز جلسة صالح ٣٠ يوماً." 12 60))
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
function Run-Node($nodeArgs, $stdinText = $null) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = "node"
  $psi.Arguments = $nodeArgs
  $psi.WorkingDirectory = $here
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
$folder = $null
if ($old -and $old.folders -and $old.folders.Count -gt 0) {
  $keep = Ask-Choice ("يوجد إعداد سابق للمجلد:`n" + ($old.folders -join "  |  ")) "أبقِ هذا المجلد" "اختيار مجلد آخر"
  if ($keep -eq 0) { exit 1 }
  if ($keep -eq 1) { $folder = $old.folders[0] }
}

if (-not $folder) {
  Show-Msg "اختر المجلد الذي تريد مراقبته — مجلد الماسح الضوئي مثلاً.`n`nكل ملف جديد يظهر فيه سيُرفع تلقائياً إلى أرشيف المركز." | Out-Null
  $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
  $dlg.Description = "اختر المجلد الذي تريد رفع ملفاته تلقائياً"
  $dlg.ShowNewFolderButton = $true
  if ($dlg.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
    Show-Msg "لم تختر مجلداً، فأُلغي التجهيز." "Warning" | Out-Null
    exit 1
  }
  $folder = $dlg.SelectedPath
}

# ===== ٣) وارد أم صادر =====
$c = Ask-Choice ("ملفات هذا المجلد:`n" + $folder + "`n`nتُسجَّل في:") "الوارد" "الصادر"
if ($c -eq 0) { exit 1 }
$type = if ($c -eq 2) { "out" } else { "in" }

# ===== ٤) الجهة والمدة والبادئة =====
$party = Ask-Text "الجهة الافتراضية التي تُكتب في القيد:`n(اتركها فارغة إن اختلفت من ملف لآخر)" $(if ($old) { $old.party } else { "" })
if ($null -eq $party) { exit 1 }

$everyText = Ask-Text "كل كم ثانية يفحص المجلد؟" $(if ($old -and $old.intervalSeconds) { [string]$old.intervalSeconds } else { "60" })
if ($null -eq $everyText) { exit 1 }
$every = 60
if ($everyText -match '^\s*\d+\s*$' -and [int]$everyText.Trim() -ge 10) { $every = [int]$everyText.Trim() }

$prefix = "م ت"
if ($old -and $old.outPrefix) { $prefix = $old.outPrefix }
if ($type -eq "out") {
  $p = Ask-Text "بادئة رقم الصادر كما في إعدادات الموقع:" $prefix
  if ($null -eq $p) { exit 1 }
  if ($p.Trim()) { $prefix = $p.Trim() }
}

# ===== ٥) حفظ الإعدادات =====
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
[System.IO.File]::WriteAllText($cfgPath, ($config | ConvertTo-Json -Depth 5), (New-Object System.Text.UTF8Encoding($false)))

# ===== ٦) الملفات الموجودة الآن =====
$existing = @(Get-ChildItem -LiteralPath $folder -File -Recurse -ErrorAction SilentlyContinue).Count
$seedAns = Ask-Choice ("المجلد فيه الآن " + $existing + " ملفاً.`n`nماذا أفعل بها؟") "اعتبرها قديمة، وارفع الجديد فقط (الأسلم)" "ارفعها كلها إلى السجل الآن"
if ($seedAns -eq 0) { exit 1 }
if ($seedAns -eq 1) { Run-Node "watch-folder.mjs --seed" | Out-Null }

# ===== ٧) الدخول =====
$signed = $false
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
    'chcp 65001 >nul',
    'cd /d "%~dp0"',
    'title Tamkeen folder watcher',
    'node watch-folder.mjs',
    'pause'
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
Start-Process -FilePath $runCmd -WorkingDirectory $here -WindowStyle Minimized

$summary = @(
  "المراقبة تعمل الآن ✔",
  "",
  ("المجلد: " + $folder),
  ("النوع: " + $(if ($type -eq "out") { "صادر" } else { "وارد" })),
  ("الفحص: كل " + $every + " ثانية"),
  ("مع إقلاع ويندوز: " + $(if ($auto -eq [System.Windows.Forms.DialogResult]::Yes) { "نعم" } else { "لا" })),
  "",
  "نافذة المراقب مصغّرة في شريط المهام — إغلاقها يوقف المراقبة.",
  "وكل ما يجري مكتوب في الملف watcher.log بجانب البرنامج.",
  "",
  "هل تريد فتح مجلد البرنامج الآن؟"
) -join "`n"
if ((Show-Msg $summary "Information" "YesNo") -eq [System.Windows.Forms.DialogResult]::Yes) {
  Start-Process explorer.exe $here
}
