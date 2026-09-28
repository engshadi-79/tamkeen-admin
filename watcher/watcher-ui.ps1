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
