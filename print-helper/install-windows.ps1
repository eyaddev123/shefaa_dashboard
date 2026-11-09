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

# ── ② الطابعة: على الشبكة (printer_ip) أم معرّفة في ويندوز (printer)؟ ──
$cfgPath = Join-Path $Here 'config.json'
$cfg = Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
$printer = $cfg.printer
$printerIp = if ($cfg.printer_ip) { ([string]$cfg.printer_ip).Trim() } else { '' }
$printerPort = if ($cfg.printer_port) { [int]$cfg.printer_port } else { 9100 }

Say ""
if ($printerIp) {
  # وضع الشبكة: لا تعريف طابعة في ويندوز أصلاً — فلا Win32_Printer ولا سؤال عن الاسم،
  # بل فحص الاتصال نفسه بالطابعة على الشبكة
  Say "✔ وضع الشبكة: الطابعة على ${printerIp}:${printerPort} (اسم printer مُتجاهَل)" Green
  Say "   جارٍ فحص الاتصال بالطابعة (قد يأخذ ثوانيَ)…"
  $tcp = Test-NetConnection -ComputerName $printerIp -Port $printerPort `
    -WarningAction SilentlyContinue -InformationLevel Quiet
  if ($tcp) {
    Say "✔ الاتصال بالطابعة على ${printerIp}:${printerPort} نجح" Green
  } else {
    Say "⚠ تعذّر الاتصال بالطابعة على ${printerIp}:${printerPort}" Yellow
    Say "   تأكّد أنّها مشغّلة وموصولة بكبل الشبكة، وأنّ هذا الجهاز على شبكة الشفاء،"
    Say "   وأنّ العنوان في config.json مطابقٌ لورقة الفحص الذاتي (Self Test)."
    Say "   (التثبيت يكمل — الوسيط يعمل ويعيد المحاولة عند كلّ طباعة.)"
  }
} else {
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
}

# ── ③ مهمّةٌ مجدولة تعمل عند الدخول ──
$serverJs = Join-Path $Here 'src\server.js'
$action  = New-ScheduledTaskAction -Execute $nodePath -Argument "`"$serverJs`"" -WorkingDirectory $Here
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit (New-TimeSpan -Seconds 0)

# ★ أوقف النسخة العاملة أوّلاً: إلغاء التسجيل لا يُنهي العملية الجارية، فتبقى
#   النسخة القديمة ممسكةً بالمنفذ وتسقط الجديدة بـ«المنفذ مشغول» — تحديثٌ صامتٌ لا يحدث.
Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
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
  Say "   جاهزة   : $($health.printer_ready) — $($health.printer_state)"
  Say ""
  Say "افتح صفحة «إعداد الطابعة» في النظام — يجب أن تصير اللافتة خضراء." Cyan
  Say ""
  # ★ السطر الأخير: بأيّ وضعٍ اشتغل الوسيط فعلاً (من ردّه هو، لا من قراءتنا للإعداد)
  if ($health.mode -eq 'network') {
    Say "═══ الوسيط يعمل بوضع: الشبكة — الطابعة $($health.printer_ip):$($health.printer_port) ═══" Green
  } else {
    Say "═══ الوسيط يعمل بوضع: نظام التشغيل — الطابعة «$($health.printer)» ═══" Green
  }
} catch {
  Say "✘ الوسيط لم يستجب. راجع السجلّ:" Red
  Say "   $env:LOCALAPPDATA\shefaa-print\shefaa-print.log"
  Say ""
  Say "   وللتشغيل يدوياً لرؤية الخطأ:" Yellow
  Say "   node `"$serverJs`""
}

Say ""
Read-Host "اضغط Enter للإغلاق"
