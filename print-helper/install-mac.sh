#!/bin/bash
# ═══════ تثبيت وسيط الطباعة على ماك — يعمل تلقائياً عند الدخول ═══════
# يُشغَّل مرّةً واحدة:  ./install-mac.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LABEL="com.shefaa.print"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOGDIR="$HOME/Library/Logs"

echo "═══ وسيط طباعة بطاقات الشفاء ═══"
echo

# ── ① Node موجود؟ ──
if ! command -v node >/dev/null 2>&1; then
  echo "✘ Node غير مثبّت. نزّله من https://nodejs.org ثمّ أعد المحاولة."
  exit 1
fi
NODE="$(command -v node)"
NODE_V="$(node --version)"
MAJOR="$(echo "$NODE_V" | sed 's/^v\([0-9]*\).*/\1/')"
if [ "$MAJOR" -lt 18 ]; then
  echo "✘ Node $NODE_V قديم — المطلوب ١٨ فأعلى."
  exit 1
fi
echo "✔ Node $NODE_V — $NODE"

# ── قراءة config.json بـ Node نفسه (موجودٌ يقيناً بعد ①؛ python3 على ماكٍ جديد
#    قد يكون مجرّد نافذة «ثبّت أدوات المطوّر») — والـ BOM يُنزع كما في الوسيط ──
cfg_get() {
  "$NODE" -e '
    try {
      const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8").replace(/^\uFEFF/, ""))
      const v = c[process.argv[2]]
      process.stdout.write(v === undefined || v === null ? "" : String(v).trim())
    } catch { process.stdout.write("") }' "$HERE/config.json" "$1"
}

# ── ② الطابعة: على الشبكة (printer_ip) أم معرّفة في النظام (printer)؟ ──
PRINTER_IP="$(cfg_get printer_ip)"
PRINTER_PORT="$(cfg_get printer_port)"
if [ -z "$PRINTER_PORT" ]; then PRINTER_PORT=9100; fi

if [ -n "$PRINTER_IP" ]; then
  # وضع الشبكة: لا تعريف طابعة في النظام أصلاً، فلا lpstat — نفحص الاتصال نفسه
  echo "✔ وضع الشبكة: الطابعة على ${PRINTER_IP}:${PRINTER_PORT} (اسم printer مُتجاهَل)"
  if "$NODE" -e '
      const s = require("net").connect({ host: process.argv[1], port: Number(process.argv[2]) })
      const t = setTimeout(() => { console.log("     المهلة انتهت (3 ثوانٍ)"); process.exit(1) }, 3000)
      s.on("connect", () => { clearTimeout(t); s.destroy(); process.exit(0) })
      s.on("error", (e) => { clearTimeout(t); console.log("     " + e.code); process.exit(1) })' \
      "$PRINTER_IP" "$PRINTER_PORT"; then
    echo "✔ الاتصال بالطابعة على ${PRINTER_IP}:${PRINTER_PORT} نجح"
  else
    echo "⚠ تعذّر الاتصال بالطابعة على ${PRINTER_IP}:${PRINTER_PORT}"
    echo "   تأكّد أنّها مشغّلة وموصولة بكبل الشبكة، وأنّ هذا الجهاز على شبكة الشفاء،"
    echo "   وأنّ العنوان في config.json مطابقٌ لورقة الفحص الذاتي (Self Test)."
    echo "   (التثبيت يكمل — الوسيط يعمل ويعيد المحاولة عند كلّ طباعة.)"
  fi
else
  PRINTER="$(cfg_get printer)"
  if [ -z "$PRINTER" ]; then PRINTER="Printer_POS_80"; fi

  if lpstat -p "$PRINTER" >/dev/null 2>&1; then
    echo "✔ الطابعة «${PRINTER}» معروفة للنظام"
  else
    echo "⚠ الطابعة «${PRINTER}» غير موجودة. الطابعات المتاحة:"
    lpstat -p 2>/dev/null | awk '{print "     - " $2}' || echo "     (لا طابعات)"
    echo "   عدّل printer في config.json ثمّ أعد تشغيل هذا السكربت."
  fi
fi

# ── ③ LaunchAgent ──
mkdir -p "$HOME/Library/LaunchAgents" "$LOGDIR"
cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$HERE/src/server.js</string>
  </array>
  <key>WorkingDirectory</key><string>$HERE</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOGDIR/shefaa-print.out.log</string>
  <key>StandardErrorPath</key><string>$LOGDIR/shefaa-print.err.log</string>
</dict>
</plist>
PLISTEOF
echo "✔ أُنشئ $PLIST"

# ── ④ التشغيل ──
launchctl unload "$PLIST" >/dev/null 2>&1 || true
launchctl load "$PLIST"
sleep 2

PORT="$(cfg_get port)"
if [ -z "$PORT" ]; then PORT=17625; fi

echo
if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
  echo "✔ الوسيط يعمل على المنفذ $PORT"
  echo
  HEALTH="$(curl -s "http://127.0.0.1:$PORT/health")"
  echo "$HEALTH"
  echo
  echo
  echo "افتح صفحة «إعداد الطابعة» في النظام — يجب أن تصير اللافتة خضراء."
  echo
  # ★ السطر الأخير: بأيّ وضعٍ اشتغل الوسيط فعلاً (من ردّه هو، لا من قراءتنا للإعداد)
  echo "$HEALTH" | "$NODE" -e '
    let t = ""; process.stdin.on("data", (d) => t += d).on("end", () => {
      try {
        const h = JSON.parse(t)
        console.log(h.mode === "network"
          ? `═══ الوسيط يعمل بوضع: الشبكة — الطابعة ${h.printer_ip}:${h.printer_port} — ${h.printer_state} ═══`
          : `═══ الوسيط يعمل بوضع: نظام التشغيل — الطابعة «${h.printer}» ═══`)
      } catch { console.log("═══ الوسيط يعمل (تعذّرت قراءة الوضع) ═══") }
    })'
else
  echo "✘ الوسيط لم يستجب. راجع السجلّ:"
  echo "   tail -20 $LOGDIR/shefaa-print.err.log"
  exit 1
fi
