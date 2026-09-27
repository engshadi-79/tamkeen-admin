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
