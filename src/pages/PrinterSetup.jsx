import { useState } from 'react'
import { loadPrinter, savePrinter, printTicket, SAMPLE_TICKET } from '../ticket-print.js'

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

  const update = (patch) => {
    const next = { ...printer, ...patch }
    setPrinter(next); savePrinter(next); setMsg(null)
  }

  const test = async () => {
    setTesting(true); setMsg(null)
    const r = await printTicket(SAMPLE_TICKET, printer.width)
    setMsg(r.ok
      ? { kind: 'good', text: 'أُرسلت البطاقة التجريبية إلى الطابعة.' }
      : { kind: 'bad', text: `تعذّرت الطباعة${r.reason ? ` — ${r.reason}` : ''}` })
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
        <div className="ps-device">
          <label className="ps-toggle">
            <input type="checkbox" checked={printer.enabled}
              onChange={(e) => update({ enabled: e.target.checked })} />
            <span>هذا الجهاز يطبع البطاقات</span>
          </label>
          <p className="setting-desc">
            فعّله على الحاسوب الموصول بالطابعة وحده. الجهاز الآخر يبقى مطفأً فلا يحاول
            الطباعة عند كلّ حضور.
          </p>

          <div className="field ps-width">
            <label htmlFor="ps-w">عرض الورق</label>
            <select id="ps-w" value={printer.width}
              onChange={(e) => update({ width: Number(e.target.value) })}>
              <option value={80}>٨٠ مم (الافتراضي)</option>
              <option value={58}>٥٨ مم</option>
            </select>
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

      {/* ═══ توصيل الطابعة بالشبكة ═══ */}
      <div className="card">
        <h3>أولاً: الطابعة على الشبكة (مرّة واحدة)</h3>
        <p className="setting-desc">
          الطابعة موصولة بالشبكة (LAN)، فيستعملها الحاسوبان معاً. ونحتاج رقمها (IP) أوّلاً.
        </p>
        <ol className="ps-steps">
          <Step n="١">
            أطفئ الطابعة، ثمّ شغّلها مع الضغط المستمرّ على زرّ <strong>FEED</strong> حتى تطبع
            ورقة <strong>الفحص الذاتي</strong> (Self Test).
          </Step>
          <Step n="٢">
            في الورقة ستجد سطر <code dir="ltr">IP Address</code> — مثل <code dir="ltr">192.168.1.87</code>.
            اكتبه، فهو ما ستُدخله على الحاسوبين.
          </Step>
          <Step n="٣">
            إن لم يظهر رقم أو ظهر <code dir="ltr">0.0.0.0</code>، فالطابعة لم تأخذ عنواناً من
            الشبكة: تأكّد من كبل الشبكة ومن أنّ ضوء المنفذ يومض، ثمّ أعد الفحص الذاتي.
          </Step>
        </ol>
      </div>

      {/* ═══ ويندوز ═══ */}
      <div className="card">
        <h3>على حاسوب ويندوز</h3>
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
            خصائص الطابعة ← <strong>تفضيلات</strong> ← حجم الورق: <code dir="ltr">80 x 297 mm</code>
            {' '}(أو <code dir="ltr">80mm Roll</code>). ثمّ <strong>طباعة صفحة اختبار</strong> للتأكّد.
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
        <h3>على حاسوب ماك</h3>
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
            اجعلها <strong>الطابعة الافتراضية</strong> من القائمة نفسها، واضبط حجم الورق
            <code dir="ltr"> 80mm</code> من <strong>تهيئة الصفحة</strong>.
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
          <li>
            <strong>لا شيء يخرج ولا ضوء:</strong> المنفذ خطأ — في ويندوز: خصائص الطابعة ←
            <strong> منافذ</strong>، وتأكّد أنّ المنفذ المحدَّد هو عنوان الطابعة نفسه الذي في
            ورقة الفحص الذاتي (قد يكون تغيّر إن أعادت الشبكة توزيع العناوين).
          </li>
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
