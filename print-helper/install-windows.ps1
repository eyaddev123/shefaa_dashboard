# ═══════ تثبيت وسيط الطباعة على ويندوز — يعمل تلقائياً عند الدخول ═══════
#
#   انقر بالزرّ الأيمن على هذا الملفّ ← «تشغيل باستخدام PowerShell»
#   أو من PowerShell:  .\install-windows.ps1
#
# لا يحتاج صلاحية مسؤول: المهمّة تُسجَّل للمستخدم الحالي وحده.

$ErrorActionPreference = 'Stop'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$TaskName = 'ShefaaPrintHelper'

function Say($msg, $color = 'White') { Write-Host $msg -ForegroundColor $color }

Say "═══ وسيط طباعة بطاقات الشفاء ═══" Cyan
Say ""

# ── ① Node موجود؟ ──
$node = (Get-Command node -ErrorAction SilentlyContinue)
if (-not $node) {
  Say "✘ Node غير مثبّت. نزّله من https://nodejs.org ثمّ أعد المحاولة." Red
  Read-Host "اضغط Enter للإغلاق"; exit 1
}
$nodePath = $node.Source
$ver = (& node --version)
$major = [int]($ver -replace '^v(\d+)\..*', '$1')
if ($major -lt 18) {
  Say "✘ Node $ver قديم — المطلوب ١٨ فأعلى." Red
  Read-Host "اضغط Enter للإغلاق"; exit 1
}
Say "✔ Node $ver — $nodePath" Green

# ── ② الطابعة ──
$cfgPath = Join-Path $Here 'config.json'
$cfg = Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
$printer = $cfg.printer

Say ""
Say "الطابعات المثبّتة على هذا الجهاز:" Cyan
$printers = Get-CimInstance Win32_Printer | Select-Object -ExpandProperty Name
$printers | ForEach-Object { Say "     - $_" }

if ($printers -contains $printer) {
  Say "✔ الطابعة «$printer» موجودة" Green
} else {
  Say ""
  Say "⚠ الطابعة «$printer» المذكورة في config.json غير موجودة." Yellow
  $pick = Read-Host "اكتب اسم الطابعة الصحيح بالضبط (أو اترك فارغاً للإبقاء)"
  if ($pick) {
    $cfg.printer = $pick
    # ★ بلا BOM: Node يرفض JSON يبدأ بـ BOM فيسقط الوسيط عند الإقلاع
    [IO.File]::WriteAllText($cfgPath, ($cfg | ConvertTo-Json -Depth 5),
      (New-Object Text.UTF8Encoding $false))
    Say "✔ حُفظ الاسم «$pick» في config.json" Green
    $printer = $pick
  }
}

# ── ③ مهمّةٌ مجدولة تعمل عند الدخول ──
$serverJs = Join-Path $Here 'src\server.js'
$action  = New-ScheduledTaskAction -Execute $nodePath -Argument "`"$serverJs`"" -WorkingDirectory $Here
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit (New-TimeSpan -Seconds 0)

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Settings $settings -Description 'وسيط طباعة بطاقات جمعية الشفاء' | Out-Null
Say "✔ سُجّلت المهمّة «$TaskName» (تعمل عند كلّ دخول)" Green

# ── ④ التشغيل الآن ──
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 3

$port = if ($cfg.port) { $cfg.port } else { 17625 }
Say ""
try {
  $health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/health" -TimeoutSec 5
  Say "✔ الوسيط يعمل على المنفذ $port" Green
  Say ""
  Say "   الطابعة : $($health.printer)"
  Say "   جاهزة   : $($health.printer_ready)"
  Say ""
  Say "افتح صفحة «إعداد الطابعة» في النظام — يجب أن تصير اللافتة خضراء." Cyan
} catch {
  Say "✘ الوسيط لم يستجب. راجع السجلّ:" Red
  Say "   $env:LOCALAPPDATA\shefaa-print\shefaa-print.log"
  Say ""
  Say "   وللتشغيل يدوياً لرؤية الخطأ:" Yellow
  Say "   node `"$serverJs`""
}

Say ""
Read-Host "اضغط Enter للإغلاق"
