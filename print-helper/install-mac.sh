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

# ── ② الطابعة ──
PRINTER="$(python3 - "$HERE/config.json" <<'PY' 2>/dev/null || echo ""
import json,sys
try: print(json.load(open(sys.argv[1])).get("printer",""))
except Exception: print("")
PY
)"
if [ -z "$PRINTER" ]; then PRINTER="Printer_POS_80"; fi

if lpstat -p "$PRINTER" >/dev/null 2>&1; then
  echo "✔ الطابعة «$PRINTER» معروفة للنظام"
else
  echo "⚠ الطابعة «$PRINTER» غير موجودة. الطابعات المتاحة:"
  lpstat -p 2>/dev/null | awk '{print "     - " $2}' || echo "     (لا طابعات)"
  echo "   عدّل printer في config.json ثمّ أعد تشغيل هذا السكربت."
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

PORT="$(python3 - "$HERE/config.json" <<'PY' 2>/dev/null || echo 17625
import json,sys
try: print(json.load(open(sys.argv[1])).get("port",17625))
except Exception: print(17625)
PY
)"

echo
if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
  echo "✔ الوسيط يعمل على المنفذ $PORT"
  echo
  curl -s "http://127.0.0.1:$PORT/health"
  echo
  echo
  echo "افتح صفحة «إعداد الطابعة» في النظام — يجب أن تصير اللافتة خضراء."
else
  echo "✘ الوسيط لم يستجب. راجع السجلّ:"
  echo "   tail -20 $LOGDIR/shefaa-print.err.log"
  exit 1
fi
