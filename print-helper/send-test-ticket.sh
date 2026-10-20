#!/bin/bash
# ═══ إرسال بطاقةٍ تجريبيةٍ واحدة إلى الطابعة ═══
#   ./send-test-ticket.sh            ⇐ بطاقة نموذجية
#   ./send-test-ticket.sh ملف.png    ⇐ صورةٌ جاهزة
#
# ★ هذا السكربت **يطبع فعلاً** على الورق. لا تشغّله إلا حين تكون مستعدّاً.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="$(python3 -c "import json;print(json.load(open('$HERE/config.json')).get('port',17625))" 2>/dev/null || echo 17625)"
TOKEN="$(python3 -c "import json;print(json.load(open('$HERE/config.json')).get('token',''))" 2>/dev/null || echo "")"

if [ $# -ge 1 ]; then
  IMG="$1"
  [ -f "$IMG" ] || { echo "✘ لا ملف: $IMG"; exit 1; }
else
  IMG="$HERE/.out/sample-ticket.png"
  node "$HERE/test/make-sample.mjs" "$IMG"
fi

echo "يُرسل $IMG إلى الوسيط على المنفذ $PORT …"
PAYLOAD="$(python3 - "$IMG" <<'PY'
import base64,json,sys
print(json.dumps({"image":"data:image/png;base64,"+base64.b64encode(open(sys.argv[1],'rb').read()).decode()}))
PY
)"
HDR=(-H "Content-Type: application/json" -H "Origin: http://localhost:5173")
[ -n "$TOKEN" ] && HDR+=(-H "X-Print-Token: $TOKEN")
curl -sS -X POST "http://127.0.0.1:$PORT/print" "${HDR[@]}" -d "$PAYLOAD"
echo
