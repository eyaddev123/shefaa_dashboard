import { useEffect, useState } from 'react'
import { loadPrinter, savePrinter, printTicket, SAMPLE_TICKET, MAX_COPIES, copyLabel } from '../ticket-print.js'
import { helperHealth, printViaHelper, loadHelper } from '../print-helper.js'

// ═══════════ إعداد الطابعة الحرارية ═══════════
// الإعداد هنا **لهذا الجهاز وحده** (localStorage): الاستقبال جهازان وطابعةٌ
// واحدة، فلو كان الإعداد في القاعدة لحاول الجهازان الطباعة معاً.
// والإعداد العام (تشغيل الطباعة التلقائية للجميع) في صفحة «الإعدادات».

function Step({ n, children }) {
  return <li className="ps-step"><span className="ps-num">{n}</span><div>{children}</div></li>
}

export default function PrinterSetup() {
  const [printer, setPrinter] = useState(loadPrinter)
  const [testing, setTesting] = useState(false)
  const [msg, setMsg] = useState(null)
  // حالة الوسيط: null = نفحص، ثمّ كائن الصحّة أو { ok:false }
  const [helper, setHelper] = useState(null)
  const checkHelper = () => { setHelper(null); helperHealth().then(setHelper) }
  useEffect(() => {
    checkHelper()
    // فحصٌ دوريّ خفيف: الموظف قد يُشغّل الوسيط والصفحة مفتوحة
    const t = setInterval(() => helperHealth().then(setHelper), 10000)
    return () => clearInterval(t)
  }, [])

  // وضع الشبكة (وسيط ٣ فأعلى): الوسيط يكلّم الطابعة على TCP مباشرةً، فلا تعريف
  // طابعة في نظام التشغيل — والنصوص التي تفترض التعريف تُخفى أو تُعدَّل
  const isNet = !!(helper && helper.ok && helper.mode === 'network')

  const update = (patch) => {
    const next = { ...printer, ...patch }
    setPrinter(next); savePrinter(next); setMsg(null)
  }

  const test = async () => {
    setTesting(true); setMsg(null)
    // بعدد النسخ المضبوط — فيرى الموظف ما سيخرج عند الحضور بالضبط
    const r = await printViaHelper(SAMPLE_TICKET, printer.width, undefined, undefined, { copies: printer.copies })
    if (r.ok) setMsg({ kind: 'good', text: printer.copies > 1
      ? `أُرسلت ${printer.copies} نسخ تجريبية إلى الطابعة، كلٌّ منها مقطوعة وحدها.`
      : 'أُرسلت البطاقة التجريبية إلى الطابعة.' })
    else {
      // الوسيط متوقّف ⇒ جرّب المتصفّح، وقل للموظف الفرق
      const fb = await printTicket(SAMPLE_TICKET, printer.width, undefined, { copies: printer.copies })
      setMsg(fb.ok
        ? { kind: 'warn', text: 'الوسيط غير متصل — طُبعت من المتصفّح (نافذة وورقٌ أطول).' }
        : { kind: 'bad', text: `تعذّرت الطباعة${r.reason ? ` — ${r.reason}` : ''}` })
    }
    helperHealth().then(setHelper)
    setTesting(false)
  }

  return (
    <>
      <h2>إعداد الطابعة</h2>
      <p className="subtitle">
        بطاقة الدور تُطبع على الطابعة الحرارية (Xprinter XP‑T80Q، ورق ٨٠مم) عند تعليم حضور
        المريض. الإعداد في الأعلى يخصّ <strong>هذا الجهاز وحده</strong>، والدليل تحته
        يُتَّبع مرّةً واحدة على كلّ حاسوب.
      </p>

      {/* ═══ إعداد هذا الجهاز ═══ */}
      <div className="card">
        <h3>هذا الجهاز</h3>
        {/* ═══ حالة وسيط الطباعة ═══
            خضراء = الوسيط يعمل والطابعة متّصلة ⇒ طباعةٌ صامتة بطول المحتوى.
            حمراء = الوسيط متوقّف ⇒ الحضور يمرّ والبطاقة لا تُطبع تلقائياً. */}
        <div className={`ps-status ${helper === null ? '' : helper.ok
          ? (helper.printer_ready ? 'is-ok' : 'is-warn') : 'is-bad'}`}>
          <span className="ps-dot" />
          <div>
            {helper === null ? <strong>جارٍ فحص وسيط الطباعة…</strong>
              : helper.ok ? (
                <>
                  <strong>وسيط الطباعة يعمل</strong>
                  <div className="ps-status-sub">
                    {isNet
                      ? (helper.printer_ready
                        ? `الطابعة على الشبكة متّصلة — ${helper.printer_state || 'جاهزة'}.`
                        : `الوسيط يعمل لكنّ الطابعة على الشبكة غير جاهزة — ${helper.printer_state || 'تحقّق من الكبل والورق'}.`)
                      : helper.printer_ready
                        ? `الطابعة «${helper.printer}» متّصلة وجاهزة.`
                        : `الوسيط يعمل لكنّ الطابعة «${helper.printer}» غير جاهزة — ${helper.printer_state || 'تحقّق من الكبل والورق'}.`}
                  </div>
                  {isNet && (
                    <div className="ps-status-sub">
                      وضع الشبكة — العنوان <code dir="ltr">{helper.printer_ip}</code> المنفذ
                      {' '}<code dir="ltr">{helper.printer_port}</code>
                    </div>
                  )}
                  {/* الإصدار ١ لا يعرف النسخ في مهمّةٍ واحدة: يطبعها النظام نسخةً نسخة
                      (الورق نفسه)، والتحديث يجعلها مهمّةً واحدة — انظر «التحديث» في الدليل */}
                  {!(helper.version >= 2) && (
                    <div className="ps-status-sub">
                      ⚠ الوسيط على هذا الجهاز إصدارٌ أقدم — النسخ تُطبع واحدةً واحدة. حدّثه: انسخ مجلّد
                      {' '}<code dir="ltr">print-helper</code> الجديد فوق القديم (أبقِ <code dir="ltr">config.json</code>)
                      ثمّ أعد تشغيل سكربت التثبيت.
                    </div>
                  )}
                </>
              ) : (
                <>
                  <strong>وسيط الطباعة غير متصل</strong>
                  <div className="ps-status-sub">
                    البطاقات لن تُطبع تلقائياً ({helper.reason || 'لا يستجيب'}).
                    الحضور يُسجَّل كالمعتاد. راجع «تثبيت وسيط الطباعة» أدناه.
                  </div>
                </>
              )}
          </div>
          <button type="button" className="ghost ps-recheck" onClick={checkHelper}>إعادة الفحص</button>
        </div>
        <div className="ps-device">
          <label className="ps-toggle">
            <input type="checkbox" checked={printer.enabled}
              onChange={(e) => update({ enabled: e.target.checked })} />
            <span>هذا الجهاز يطبع البطاقات</span>
          </label>
          <p className="setting-desc">
            {isNet
              ? 'الطابعة على الشبكة: فعّله على كلّ جهاز استقبالٍ عليه وسيط — كلّ حضورٍ تُطبع بطاقته مرّةً واحدة من الجهاز الذي ضغط «حضر».'
              : 'فعّله على الحاسوب الموصول بالطابعة وحده. الجهاز الآخر يبقى مطفأً فلا يحاول الطباعة عند كلّ حضور.'}
          </p>

          <div className="field ps-width">
            <label htmlFor="ps-w">عرض الورق</label>
            <select id="ps-w" value={printer.width}
              onChange={(e) => update({ width: Number(e.target.value) })}>
              <option value={80}>٨٠ مم (الافتراضي)</option>
              <option value={58}>٥٨ مم</option>
            </select>
          </div>

          {/* عدد النسخ عند الحضور: الأولى «نسخة المريض» والثانية «نسخة العيادة» */}
          <div className="field ps-copies">
            <label htmlFor="ps-copies">عدد النسخ عند الحضور</label>
            <select id="ps-copies" value={printer.copies}
              onChange={(e) => update({ copies: Number(e.target.value) })}>
              {Array.from({ length: MAX_COPIES }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n === 1 ? 'نسخة واحدة' : n === 2 ? 'نسختان (الافتراضي)' : `${n} نسخ`}
                </option>
              ))}
            </select>
            <span className="hint">
              {Array.from({ length: printer.copies }, (_, i) => copyLabel(i)).join(' · ')}
              {' '}— كلّ نسخةٍ تُقطع وحدها. وإعادة الطباعة اليدوية تسأل عن العدد كلّ مرّة.
            </span>
          </div>

          <div className="ps-test">
            <button type="button" onClick={test} disabled={testing}>
              {testing ? 'جارٍ الطباعة…' : '🖨 طباعة تجريبية'}
            </button>
            {msg && <span className={`badge ${msg.kind}`}>{msg.text}</span>}
          </div>
          {!printer.enabled && (
            <p className="hint">
              الطباعة التجريبية تعمل حتى لو كان المفتاح مطفأً — لتجرّب قبل أن تُفعّله.
            </p>
          )}
        </div>
      </div>

      {/* ═══ تثبيت وسيط الطباعة ═══ */}
      <div className="card">
        <h3>تثبيت وسيط الطباعة (مرّة واحدة على جهاز الاستقبال)</h3>
        <p className="setting-desc">
          برنامجٌ صغير يعمل في خلفية الجهاز، يستقبل صورة البطاقة من النظام ويرسلها
          للطابعة مباشرةً — فتُطبع <strong>بلا نافذة</strong>، و<strong>بطول المحتوى</strong>،
          و<strong>تُقطع تلقائياً</strong>. بدونه يبقى الحضور يعمل، لكن لا تُطبع بطاقة.
        </p>
        <div className="ps-note ps-warn">
          <strong>كلّ جهازٍ يطبع يحتاج وسيطاً خاصّاً به</strong> — حتى والطابعة على الشبكة.
          الموقع يُفتح بـ <code dir="ltr">https</code>، والمتصفّح لا يسمح لصفحة <code dir="ltr">https</code>
          {' '}أن تكلّم عنواناً على الشبكة مثل <code dir="ltr">192.168.1.50</code> مباشرةً
          (محتوى مختلط)، فيكلّم الوسيط على الجهاز نفسه (<code dir="ltr">127.0.0.1</code>)، والوسيط
          هو الذي يكلّم الطابعة.
          <br />
          <strong>وإذن كروم «الوصول إلى الشبكة المحلية»</strong> يُمنح مرّةً على كلّ جهاز: عند أوّل
          طباعة يظهر طلب إذن — اضغط <strong>«سماح»</strong>. وإن رُفض بالخطأ: القفل بجانب العنوان ←
          إعدادات الموقع ← السماح بالوصول إلى الشبكة المحلية.
        </div>
        <ol className="ps-steps">
          <Step n="١">
            انسخ مجلّد <code dir="ltr">print-helper</code> إلى الجهاز، مثلاً إلى
            {' '}<code dir="ltr">~/shefaa-print</code>.
          </Step>
          <Step n="٢">
            تأكّد من وجود Node (الإصدار ١٨ فأعلى): افتح <strong>Terminal</strong> ونفّذ
            <pre dir="ltr" className="ps-cmd">node --version</pre>
            إن لم يكن مثبّتاً فنزّله من <code dir="ltr">nodejs.org</code>.
          </Step>
          <Step n="٣">
            افتح <code dir="ltr">config.json</code> داخل المجلّد واكتب عنوان الطابعة في
            {' '}<code dir="ltr">printer_ip</code>:
            <pre dir="ltr" className="ps-cmd">{`"printer_ip": "192.168.1.50",
"printer_port": 9100,`}</pre>
            بهذا يرسل الوسيط البطاقة للطابعة على الشبكة مباشرةً، و<strong>لا داعي لتعريف
            الطابعة في نظام التشغيل إطلاقاً</strong> (يُتجاهل <code dir="ltr">printer</code>).
            احفظ الملفّ كما هو (UTF-8)، ولا تحذف الفواصل ولا علامات الاقتباس.
            {!isNet && (
              <details className="ps-note">
                <summary>الوضع القديم: طابعة معرّفة في نظام التشغيل (اترك <code dir="ltr">printer_ip</code> فارغاً)</summary>
                اعرف اسم طابعتك كما يراها النظام:
                <div className="ps-note">
              <strong>ماك:</strong>
              <pre dir="ltr" className="ps-cmd">lpstat -p | awk '{'{'}print $2{'}'}'</pre>
            </div>
            <div className="ps-note">
              <strong>ويندوز:</strong> سكربت التثبيت يعرضها لك ويسألك أيّها تريد —
              فلا حاجة لتعديلٍ يدويّ. (وللاطّلاع:
              {' '}<code dir="ltr">Get-Printer | Select Name</code>)
              <br />
              <strong>مهمّ:</strong> اكتب الاسم <strong>كما هو بالضبط</strong> كما يظهر في
              «الطابعات والماسحات» — بمسافاته وشَرطاته.
            </div>
                ثمّ يُحفظ في <code dir="ltr">config.json</code> تحت <code dir="ltr">printer</code>.
              </details>
            )}
          </Step>
          <Step n="٤">
            ثبّته ليعمل تلقائياً عند الدخول:
            <div className="ps-note">
              <strong>ماك:</strong>
              <pre dir="ltr" className="ps-cmd">cd ~/shefaa-print && ./install-mac.sh</pre>
              ينشئ LaunchAgent ويُشغّله فوراً.
            </div>
            <div className="ps-note">
              <strong>ويندوز:</strong> انقر بالزرّ الأيمن على
              {' '}<code dir="ltr">install-windows.ps1</code> ثمّ
              {' '}<strong>«تشغيل باستخدام PowerShell»</strong>.
              يفحص الاتصال بالطابعة على الشبكة (أو، في الوضع القديم، يعرض الطابعات المثبّتة
              ليختار الصحيحة)، ويسجّل مهمّةً تعمل عند كلّ دخول.
              {' '}<em>لا يحتاج صلاحية مسؤول.</em>
              <br />
              إن رفض ويندوز تشغيل السكربت، افتح PowerShell ونفّذ:
              <pre dir="ltr" className="ps-cmd">{`powershell -ExecutionPolicy Bypass -File .\\install-windows.ps1`}</pre>
            </div>
          </Step>
          <Step n="٥">
            تأكّد: آخر سطر يطبعه سكربت التثبيت يقول
            {' '}<strong>«الوسيط يعمل بوضع: الشبكة — الطابعة 192.168.1.50:9100»</strong>،
            واللافتة في أعلى هذه الصفحة <strong>خضراء</strong> وتحتها العنوان والمنفذ.
            وللفحص من الطرفية (يجب أن يظهر <code dir="ltr">"mode":"network"</code>):
            <pre dir="ltr" className="ps-cmd">curl http://127.0.0.1:17625/health</pre>
          </Step>
        </ol>
        <div className="ps-note">
          <strong>السجلّ عند الأعطال:</strong>
          <br />ماك: <code dir="ltr">~/Library/Logs/shefaa-print.log</code>
          <br />ويندوز: <code dir="ltr">%LOCALAPPDATA%\shefaa-print\shefaa-print.log</code>
          <br /><br /><strong>لإيقافه:</strong>
          <br />ماك: <code dir="ltr">launchctl unload ~/Library/LaunchAgents/com.shefaa.print.plist</code>
          <br />ويندوز: من <strong>«برنامج جدولة المهام»</strong> أوقف المهمّة
          {' '}<code dir="ltr">ShefaaPrintHelper</code>.
        </div>
      </div>

      {/* ═══ الطابعة على الإيثرنت ═══ */}
      <div className="card">
        <h3>الطابعة على الإيثرنت</h3>
        <p className="setting-desc">
          الطابعة موصولة بكبل شبكة إلى راوتر الشفاء، بعنوانٍ <strong>ثابت</strong>
          {' '}<code dir="ltr">192.168.1.50</code> محفوظٍ في الطابعة نفسها، و<code dir="ltr">DHCP</code>
          {' '}معطّلٌ عن قصد (كي لا يتغيّر العنوان فتتوقّف الطباعة). كلّ جهاز عليه وسيط يطبع عليها مباشرةً،
          و<strong>لا داعي لتعريف طابعة في نظام التشغيل إطلاقاً</strong>. وإن طبع جهازان معاً
          ينتظر أحدهما الآخر ويعيد المحاولة وحده.
        </p>
        <ol className="ps-steps">
          <Step n="١">
            <strong>لمعرفة عنوانها:</strong> أطفئ الطابعة، ثمّ شغّلها مع الضغط المستمرّ على زرّ
            {' '}<strong>FEED</strong> حتى تطبع ورقة <strong>الفحص الذاتي</strong> (Self Test). فيها سطر
            {' '}<code dir="ltr">IP Address</code> — يجب أن يكون <code dir="ltr">192.168.1.50</code>.
          </Step>
          <Step n="٢">
            <strong>لتغيير العنوان</strong> (نادراً، مثلاً إن تغيّر الراوتر): من حاسوبٍ على الشبكة نفسها
            افتح في المتصفّح <code dir="ltr">http://192.168.1.50</code> (أو العنوان الذي في ورقة الفحص)،
            فتظهر صفحة <code dir="ltr">Ethernet WebConfig</code> ← تبويب
            {' '}<strong><span dir="ltr">Configuration</span></strong> ← غيّر
            {' '}<code dir="ltr">Fixed IP Address</code> و<code dir="ltr">Subnet Mask</code>
            {' '}(<code dir="ltr">255.255.255.0</code>) و<code dir="ltr">Gateway</code>
            {' '}(<code dir="ltr">192.168.1.1</code>) ← <strong>Save</strong> ← <strong>Restart</strong>.
            ثمّ اكتب العنوان الجديد في <code dir="ltr">printer_ip</code> على <strong>كلّ</strong> جهاز
            وأعد تشغيل سكربت التثبيت.
          </Step>
          <Step n="٣">
            إن ظهر في ورقة الفحص <code dir="ltr">0.0.0.0</code> أو عنوانٌ لا يبدأ بـ
            {' '}<code dir="ltr">192.168.1.</code>، فالإعداد ضاع (أو أُعيدت الطابعة لإعدادات المصنع:
            {' '}<code dir="ltr">192.168.123.100</code>): تأكّد من الكبل ومن أنّ ضوء المنفذ يومض،
            ثمّ أعد ضبط العنوان كما في الخطوة ٢.
          </Step>
        </ol>
      </div>

      {/* ═══ تعريف الطابعة في نظام التشغيل: في وضع الشبكة اختياريّ (احتياط المتصفّح وحده) ═══ */}
      {isNet && (
        <div className="card">
          <h3>تعريف الطابعة في نظام التشغيل — غير مطلوب</h3>
          <p className="setting-desc">
            هذا الجهاز بوضع الشبكة: الوسيط يطبع بلا تعريف. التعريف يفيد فقط <strong>احتياط
            المتصفّح</strong> (حين يتوقّف الوسيط، في إعادة الطباعة وإيصال الحديد)، فإن أردته
            فالخطوات في البطاقتين أدناه.
          </p>
        </div>
      )}

      {/* ═══ ويندوز ═══ */}
      <div className="card">
        <h3>{isNet ? 'اختياري — تعريف الطابعة على ويندوز (لاحتياط المتصفّح)' : 'على حاسوب ويندوز'}</h3>
        <ol className="ps-steps">
          <Step n="١">
            نزّل تعريف <strong>Xprinter</strong> المناسب للموديل (80mm / XP‑T80Q) من موقع الشركة،
            واضغط عليه بالزرّ الأيمن ثمّ <strong>تشغيل كمسؤول</strong> (Run as administrator).
            التعريف المثبَّت بلا صلاحية مسؤول يفشل بصمت عند الطباعة.
          </Step>
          <Step n="٢">
            أثناء التثبيت اختر المنفذ <strong>شبكة / TCP‑IP</strong> وأدخل رقم الطابعة الذي
            كتبته من ورقة الفحص الذاتي.
            <div className="ps-note">
              إن كانت موصولةً بـ USB بدل الشبكة فاختر منفذ <code dir="ltr">USB</code> الظاهر في القائمة.
            </div>
          </Step>
          <Step n="٣">
            بعد التثبيت: <strong>الإعدادات ← الأجهزة ← الطابعات والماسحات</strong> ← اختر الطابعة ←
            <strong> تعيين كطابعة افتراضية</strong>. وأطفئ خيار
            «<span dir="ltr">Let Windows manage my default printer</span>» وإلّا بدّلها ويندوز وحده.
          </Step>
          <Step n="٤">
            <strong>حجم الورق — وهو سبب الورق الأبيض الزائد:</strong> خصائص الطابعة ←
            <strong> تفضيلات</strong> ← حجم الورق: اختر مقاس <strong>الرول</strong>
            {' '}(<code dir="ltr">72 x 3276 mm</code> أو ما يُسمّى <code dir="ltr">Roll</code>
            {' '}/ <code dir="ltr">Receipt</code>) — <strong>لا</strong> {' '}
            <code dir="ltr">72 x 210 mm</code>.
            <div className="ps-note">
              المقاس الثابت (٢١٠مم) يجعل الطابعة تُخرج ورقةً بطول ٢١٠مم مهما قصرت البطاقة،
              فتخرج نحو <strong>١٠٠مم ورقاً أبيض</strong> بعد كلّ بطاقة. ومقاس الرول يجعلها
              تقطع بعد المحتوى مباشرةً — والنظام يرسل طول البطاقة الحقيقي مع كلّ طباعة.
            </div>
            ثمّ <strong>طباعة صفحة اختبار</strong> للتأكّد.
          </Step>
          <Step n="٥">
            <strong>لتختفي نافذة الطباعة:</strong> انسخ اختصار كروم على سطح المكتب، ثمّ بالزرّ
            الأيمن ← خصائص ← في خانة <strong>الهدف</strong> (Target) أضف في آخر السطر بعد مسافة:
            <pre dir="ltr" className="ps-cmd">--kiosk-printing</pre>
            وافتح النظام من هذا الاختصار وحده. ولا تُفعّل خيار تعطيل المعاينة
            (<span dir="ltr">Disable Print Preview</span>) — الطباعة الصامتة تحتاج المعاينة مُفعَّلة.
          </Step>
        </ol>
      </div>

      {/* ═══ ماك ═══ */}
      <div className="card">
        <h3>{isNet ? 'اختياري — تعريف الطابعة على ماك (لاحتياط المتصفّح)' : 'على حاسوب ماك'}</h3>
        <ol className="ps-steps">
          <Step n="١">
            نزّل تعريف Xprinter الخاصّ بـ <strong>macOS</strong> وثبّته. قد يطلب السماح له من
            <strong> إعدادات النظام ← الخصوصية والأمان</strong> بعد التثبيت.
          </Step>
          <Step n="٢">
            <strong>إعدادات النظام ← الطابعات والماسحات ← إضافة طابعة</strong> ← بطاقة
            <strong> IP</strong> ← أدخل رقم الطابعة من ورقة الفحص الذاتي، والبروتوكول
            <code dir="ltr"> Line Printer Daemon – LPD</code>، واختر تعريف Xprinter في خانة
            «الاستخدام» (Use).
          </Step>
          <Step n="٣">
            اجعلها <strong>الطابعة الافتراضية</strong> من القائمة نفسها.
            <div className="ps-note">
              <strong>حجم الورق — سبب الورق الأبيض الزائد:</strong> في نافذة الطباعة اختر
              {' '}<strong>حجم الورق</strong> = <code dir="ltr">X72MMY3276MM</code>
              {' '}(مقاس الرول)، <strong>لا</strong> <code dir="ltr">X72MMY210MM</code>.
              الأخير يُخرج ورقةً بطول ٢١٠مم دائماً — نحو ١٠٠مم ورقٍ أبيض بعد كلّ بطاقة.
            </div>
            <div className="ps-note">
              ولجعله الافتراضَ الدائم (فتستعمله الطباعة الصامتة بلا اختيار)، افتح
              {' '}<strong>Terminal</strong> ونفّذ:
              <pre dir="ltr" className="ps-cmd">{`lpoptions -p "$(lpstat -d | sed 's/.*: //')" \\
  -o PageSize=X72MMY3276MM`}</pre>
              وللتأكّد من المقاسات المتاحة لطابعتك:
              <pre dir="ltr" className="ps-cmd">{'lpoptions -p <اسم الطابعة> -l | grep PageSize'}</pre>
              النجمة <code dir="ltr">*</code> تسبق المقاس المضبوط حالياً.
            </div>
          </Step>
          <Step n="٤">
            <strong>لتختفي نافذة الطباعة:</strong> افتح <strong>Terminal</strong> وشغّل كروم بالأمر:
            <pre dir="ltr" className="ps-cmd">open -a "Google Chrome" --args --kiosk-printing</pre>
            ثمّ افتح النظام من النافذة التي فُتحت بهذا الأمر.
            <div className="ps-note ps-warn">
              ⚠ تنبيه مهمّ: الطباعة الصامتة على الماك <strong>غير مضمونة</strong> — جوجل لا توثّق
              هذه الراية لنظام ماك، والمصادر متضاربة. فقد تظهر نافذة الطباعة رغم الأمر، فيضغط
              الموظف «طباعة» في كلّ مرّة. إن حدث ذلك فاجعل الطباعة من حاسوب ويندوز، أو اقبل
              ضغطة الزرّ. <strong>البطاقة نفسها تُطبع صحيحةً في الحالتين.</strong>
            </div>
          </Step>
        </ol>
      </div>

      {/* ═══ الأعطال ═══ */}
      <div className="card">
        <h3>إن طبعت ورقةً فارغة أو لم تطبع شيئاً</h3>
        <ul className="ps-faults">
          <li>
            <strong>ورقة بيضاء تخرج:</strong> الورق مقلوب. الوجه الحراريّ للأعلى — اقلب البكرة.
            (اختبار سريع: اخدش الورق بظفرك، الوجه الصحيح يترك أثراً داكناً.)
          </li>
          <li>
            <strong>لا شيء يخرج والضوء الأحمر يومض:</strong> الورق انتهى أو الغطاء غير مُحكم.
          </li>
          {isNet ? (
            <>
              <li>
                <strong>«الطابعة مشغولة أو غير متاحة»:</strong> الوسيط أعاد المحاولة ٥ مرّات ولم
                يصل. تأكّد أنّ الطابعة مشغّلة وكبل الشبكة موصول، وأنّ هذا الجهاز على شبكة الشفاء،
                وأنّ <code dir="ltr">printer_ip</code> مطابقٌ لورقة الفحص الذاتي — ثمّ أعد الطباعة.
              </li>
              <li>
                <strong>«انقطع الاتصال بالطابعة أثناء الطباعة»:</strong> انظر إلى الورقة أوّلاً —
                ربما طُبع جزءٌ منها. الوسيط لا يعيد الإرسال وحده كي لا تُطبع البطاقة مرّتين.
              </li>
            </>
          ) : (
            <li>
              <strong>لا شيء يخرج ولا ضوء:</strong> المنفذ خطأ — في ويندوز: خصائص الطابعة ←
              <strong> منافذ</strong>، وتأكّد أنّ المنفذ المحدَّد هو عنوان الطابعة نفسه الذي في
              ورقة الفحص الذاتي (قد يكون تغيّر إن أعادت الشبكة توزيع العناوين).
            </li>
          )}
          <li>
            <strong>تطبع رموزاً غريبة بدل العربية:</strong> التعريف قديم أو خطأ — أعد تثبيت
            تعريف الموديل الصحيح (80mm) كمسؤول.
          </li>
          <li>
            <strong>النصّ مقصوص من الجانب:</strong> حجم الورق في تفضيلات الطابعة ليس ٨٠مم،
            أو أنّ عرض الورق هنا في الأعلى مضبوطٌ على ٥٨ والورق ٨٠ (أو العكس).
          </li>
          <li>
            <strong>تطبع نصف البطاقة ثمّ تقطع:</strong> حجم الورق مضبوطٌ على طولٍ ثابت —
            اجعله <code dir="ltr">80 x 297 mm</code> أو <code dir="ltr">Roll</code>.
          </li>
          <li>
            <strong>الكبل:</strong> جرّب كبل شبكةٍ آخر أو منفذاً آخر في الراوتر — الكبل
            التالف يُظهر الطابعة «متّصلة» ولا يُمرّر شيئاً.
          </li>
        </ul>
      </div>
    </>
  )
}
