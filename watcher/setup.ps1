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

# ===== ٣) إلى أين تُرفع الملفات؟ =====
$dest = Ask-Choice3 ("ملفات هذا المجلد:`n" + $folder + "`n`nتُرفع إلى:") `
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
    $probe = [ordered]@{ url = $SERVER_URL; folders = @($folder); type = "in"; party = ""; outPrefix = "م ت"; intervalSeconds = 60; stableSeconds = 10; maxMB = 45; subfolders = $true; target = "drive"; drive = [ordered]@{ url = $driveUrl; key = $driveKey } }
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
  folders         = @($folder)
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
$existing = @(Get-ChildItem -LiteralPath $folder -File -Recurse -ErrorAction SilentlyContinue).Count
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
  ("الوجهة: " + $(if ($target -eq "drive") { "Google Drive" } elseif ($target -eq "both") { "سجل المركز و Google Drive" } else { "سجل المركز" })),
  ("النوع: " + $(if ($toRegistry) { if ($type -eq "out") { "صادر" } else { "وارد" } } else { "—" })),
  ("الفحص: كل " + $every + " ثانية"),
  ("مع إقلاع ويندوز: " + $(if ($auto -eq [System.Windows.Forms.DialogResult]::Yes) { "نعم" } else { "لا" })),
  "",
  "نافذة المراقب مصغّرة في شريط المهام — إغلاقها يوقف المراقبة.",
  "وكل ما يجري مكتوب في الملف watcher.log بجانب البرنامج.",
  "",
  $(if ($toDrive -and $driveFolder) { "هل تريد فتح مجلد المراقبة في Google Drive الآن؟" } else { "هل تريد فتح مجلد البرنامج الآن؟" })
) -join "`n"
if ((Show-Msg $summary "Information" "YesNo") -eq [System.Windows.Forms.DialogResult]::Yes) {
  if ($toDrive -and $driveFolder) { Start-Process $driveFolder } else { Start-Process explorer.exe $here }
}
