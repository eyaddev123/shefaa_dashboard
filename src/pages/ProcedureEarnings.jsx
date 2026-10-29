import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, todayLocal } from '../api.js'

// ═══ مستحقات الدكاترة من الإجراءات ═══
// «كم طلع لكل دكتور بهالفترة؟» — سطرٌ لكل دكتورٍ له إجراءات، وكبسةٌ تفتح تفصيله إجراءً إجراءً.
// الحساب كلّه في الخادم (GET /api/clinic/procedures/earnings) من لقطات الأسطر المسجّلة —
// لا إعادة حساب ولا جمع هنا — وهو نفسه ما يُبنى منه الإكسل. والفترة تُحلّ في الخادم بتوقيت
// دمشق (اليوم · أمس · هالأسبوع · هالشهر)، فلا تنزلق عند منتصف الليل بساعة الجهاز.
// الفترة والدكتور المفتوح في الرابط: زرّ الرجوع في الجوال يعود من التفصيل إلى الملخّص.
// المشرفة والمدير والمشرف العام وحدهم (EARNINGS_ROLES في الخادم) — المجلس والاستقبال 403.

const PERIODS = [
  { key: 'today', label: 'اليوم' },
  { key: 'yesterday', label: 'أمس' },
  { key: 'week', label: 'هالأسبوع' },
  { key: 'month', label: 'هالشهر' },
  { key: 'custom', label: 'من — إلى' },
]

const fmtNum = (n) => Number(n || 0).toLocaleString('ar-SY')
const countText = (n) => `${fmtNum(n)} ${n === 1 ? 'إجراء' : 'إجراءات'}`
function Money({ value }) {
  return <>{fmtNum(value)}<span className="cash-unit">ل.س</span></>
}
// «٢٠٢٦-١٠-٢٤ ← ٢٠٢٦-١٠-٢٩» بأرقامٍ لاتينية كباقي التواريخ في الصفحة
const rangeText = (d) => (d.from === d.to ? d.from : `${d.from} ← ${d.to}`)

const TILES = [
  { key: 'count', label: 'عدد الإجراءات' },
  { key: 'price', label: 'إجمالي القيمة', money: true },
  { key: 'materials', label: 'تكلفة المواد', money: true },
  { key: 'doctor', label: 'حصّة الدكاترة', money: true, hero: true },
  { key: 'shifa', label: 'حصّة الشفاء', money: true },
]

function Tiles({ totals, doctorLabel }) {
  return (
    <div className="tiles earn-tiles">
      {TILES.map((t) => (
        <div key={t.key} className={`tile${t.hero ? ' earn-hero' : ''}`}>
          <div className="label">{t.key === 'doctor' && doctorLabel ? doctorLabel : t.label}</div>
          <div className={`value${t.key === 'shifa' && totals.shifa < 0 ? ' neg' : ''}`}>
            {t.money ? <Money value={totals[t.key]} /> : fmtNum(totals[t.key])}
          </div>
        </div>
      ))}
    </div>
  )
}

function Summary({ data, onOpen }) {
  return (
    <table className="rtable earn-table">
      <thead>
        <tr><th>الدكتور</th><th>الإجراءات</th><th>إجمالي القيمة</th><th>تكلفة المواد</th>
          <th>حصّة الدكتور</th><th>حصّة الشفاء</th><th></th></tr>
      </thead>
      <tbody>
        {data.doctors.map((d) => (
          <tr key={d.doctorId} className="earn-row" onClick={() => onOpen(d.doctorId)}>
            <td className="rt-title">
              {d.doctor}
              {d.specialty && <span className="earn-spec">{d.specialty}</span>}
            </td>
            <td className="rt-badge earn-count">
              <span className="badge sm">{countText(d.totals.count)}</span>
              {d.noRule > 0 && <span className="badge warn sm">بلا قاعدة ({fmtNum(d.noRule)})</span>}
              {d.negative > 0 && <span className="badge bad sm">الشفاء سالبة ({fmtNum(d.negative)})</span>}
            </td>
            <td className="num" data-label="إجمالي القيمة">{fmtNum(d.totals.price)}</td>
            <td className="num" data-label="تكلفة المواد">{fmtNum(d.totals.materials)}</td>
            <td className="num earn-doc" data-label="حصّة الدكتور">{fmtNum(d.totals.doctor)}</td>
            <td className={`num${d.totals.shifa < 0 ? ' neg' : ''}`} data-label="حصّة الشفاء">{fmtNum(d.totals.shifa)}</td>
            <td className="rt-actions earn-open">
              <button type="button" className="ghost" aria-label={`تفصيل ${d.doctor}`}
                onClick={(e) => { e.stopPropagation(); onOpen(d.doctorId) }}>التفصيل ←</button>
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="earn-total">
          <td className="rt-title">الإجمالي</td>
          <td className="rt-badge earn-count"><span className="badge sm">{countText(data.totals.count)}</span></td>
          <td className="num" data-label="إجمالي القيمة">{fmtNum(data.totals.price)}</td>
          <td className="num" data-label="تكلفة المواد">{fmtNum(data.totals.materials)}</td>
          <td className="num earn-doc" data-label="حصص الدكاترة">{fmtNum(data.totals.doctor)}</td>
          <td className={`num${data.totals.shifa < 0 ? ' neg' : ''}`} data-label="حصّة الشفاء">{fmtNum(data.totals.shifa)}</td>
          <td className="rt-actions"></td>
        </tr>
      </tfoot>
    </table>
  )
}

// القاعدة بكلمتين كما في الملفّ (ruleShort في الخادم) لكن بأرقامٍ هندية و«٪» العربية —
// «%40» اللاتينية تنقلب في سطرٍ عربيّ
export function ruleText(l) {
  if (l.ruleSource === 'none') return 'بلا قاعدة'
  if (l.ruleSource === 'manual') return 'تجاوز يدوي'
  const v = fmtNum(l.ruleValue)
  if (l.ruleKind === 'fixed') return l.ruleSource === 'doctor' ? `العامة ثابت ${v}` : `ثابت ${v}`
  return l.ruleSource === 'doctor' ? `العامة ${v}٪` : `نسبة ${v}٪`
}

const qty = (q) => Number(q).toLocaleString('ar-SY', { maximumFractionDigits: 2 })
function Items({ l }) {
  if (l.items.length === 0 && !l.legacyMaterials) return <span className="muted">بلا مواد</span>
  return (
    <span className="earn-items">
      {l.items.map((m, i) => <span key={i}>{m.name} ×{qty(m.qty)} {m.unit}</span>)}
      {l.legacyMaterials > 0 && <span>مواد سابقة (إجمالي)</span>}
    </span>
  )
}

function Detail({ doctor, multiDay }) {
  return (
    <table className="rtable earn-table earn-detail">
      <thead>
        <tr><th>الوقت</th><th>المريض</th><th>الإجراء</th><th>السعر</th><th>المواد</th>
          <th>القاعدة</th><th>حصّته</th><th>الشفاء</th></tr>
      </thead>
      <tbody>
        {doctor.lines.map((l) => (
          <tr key={l.id} className={l.negative ? 'earn-neg' : l.noRule ? 'earn-norule' : undefined}>
            <td className="rt-badge earn-when" dir="ltr">
              {multiDay && <span className="earn-date">{l.date}</span>}
              <span>{l.time}</span>
            </td>
            <td className="rt-title earn-proc-cell">
              <span className="earn-proc">{l.procedure}</span>
            </td>
            <td className="earn-patient rt-full" data-label="المريض">
              {l.patient}
              {l.queue !== '' && l.queue != null && <span className="muted"> (الدور {fmtNum(l.queue)})</span>}
            </td>
            <td className="num" data-label="السعر">{fmtNum(l.price)}</td>
            <td className="earn-mats" data-label="المواد">
              <strong className="num">{fmtNum(l.materials)}</strong>
              <Items l={l} />
            </td>
            <td data-label="القاعدة">
              <span className={`earn-rule${l.noRule ? ' is-norule' : ''}`}>{ruleText(l)}</span>
            </td>
            <td className="num earn-doc" data-label="حصّته">{fmtNum(l.doctor)}</td>
            <td className={`num${l.negative ? ' neg' : ''}`} data-label="الشفاء">{fmtNum(l.shifa)}{l.negative && ' ⚠'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default function ProcedureEarnings({ showToast }) {
  const [params, setParams] = useSearchParams()
  const period = PERIODS.some((p) => p.key === params.get('period')) ? params.get('period') : 'today'
  const from = params.get('from') || todayLocal()
  const to = params.get('to') || from
  const doctorId = params.get('doctor')
  const [loaded, setLoaded] = useState(null)    // { key, data } — الردّ مع الفترة التي طُلب لها
  const [err, setErr] = useState(null)
  const [exporting, setExporting] = useState(false)

  const query = period === 'custom' ? { from, to } : { period }
  const qKey = JSON.stringify(query)
  useEffect(() => {
    let live = true
    setErr(null)
    api.clinic.procedureEarnings(query)
      .then((d) => { if (live) setLoaded({ key: qKey, data: d }) })
      .catch((e) => { if (live) setErr(e.message) })
    return () => { live = false }
  }, [qKey])
  // ردّ فترةٍ سابقة لا يُعرض تحت زرّ الفترة الجديدة ولو لإطارٍ واحد
  const data = loaded && loaded.key === qKey ? loaded.data : null

  // الرابط وحده الحالة: تبويب الصفحة يبقى، وتغيير الفترة يُغلق التفصيل
  const update = (patch, { push = false } = {}) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) { if (v == null || v === '') next.delete(k); else next.set(k, v) }
    setParams(next, { replace: !push })
  }
  const pickPeriod = (key) => update(key === 'custom'
    ? { period: 'custom', from: data?.from || todayLocal(), to: data?.to || todayLocal(), doctor: null }
    : { period: key, from: null, to: null, doctor: null })
  const open = (id) => { update({ doctor: id }, { push: true }); window.scrollTo?.(0, 0) }

  const doctor = data && doctorId ? data.doctors.find((d) => d.doctorId === doctorId) : null
  const multiDay = data && data.from !== data.to

  const doExport = async () => {
    setExporting(true)
    try {
      const name = await api.clinic.exportEarnings({ ...query, doctorId: doctor?.doctorId })
      showToast(`نُزّل ${name}`, 'success', 3000)
    } catch (ex) { showToast(ex.message) }
    finally { setExporting(false) }
  }

  return (
    <div className="card earn-card">
      <div className="earn-head">
        <h3>{doctor ? doctor.doctor : 'مستحقات الدكاترة من الإجراءات'}</h3>
        <button type="button" className="ghost earn-export" disabled={exporting || !data || data.doctors.length === 0}
          onClick={doExport}>
          {exporting ? 'جارٍ التصدير…' : doctor ? 'إكسل هذا الدكتور' : 'إكسل الملخّص والتفصيل'}
        </button>
      </div>

      <div className="earn-periods" role="group" aria-label="الفترة">
        {PERIODS.map((p) => (
          <button key={p.key} type="button" aria-pressed={period === p.key}
            className={`rev-flag${period === p.key ? ' is-on' : ''}`} onClick={() => pickPeriod(p.key)}>
            {p.label}
          </button>
        ))}
      </div>
      {period === 'custom' && (
        <div className="inline rev-filters earn-custom">
          <div className="field"><label htmlFor="earn-from">من</label>
            <input id="earn-from" type="date" value={from}
              onChange={(e) => e.target.value && update({ from: e.target.value, to: e.target.value > to ? e.target.value : to, doctor: null })} /></div>
          <div className="field"><label htmlFor="earn-to">إلى</label>
            <input id="earn-to" type="date" value={to} min={from}
              onChange={(e) => e.target.value && update({ to: e.target.value, doctor: null })} /></div>
        </div>
      )}
      {data && <p className="earn-range">الفترة: <span dir="ltr">{rangeText(data)}</span></p>}

      {err ? <p className="error">{err}</p>
        : !data ? <p className="empty">جارٍ التحميل…</p>
        : doctorId ? (
          !doctor ? (
            <>
              <p className="empty">لا إجراءات لهذا الدكتور في هذه الفترة.</p>
              <button type="button" className="ghost earn-back" onClick={() => update({ doctor: null })}>→ كل الدكاترة</button>
            </>
          ) : (
            <>
              <button type="button" className="ghost earn-back" onClick={() => update({ doctor: null })}>→ كل الدكاترة</button>
              <Tiles totals={doctor.totals} doctorLabel="حصّة الدكتور" />
              <Detail doctor={doctor} multiDay={multiDay} />
            </>
          )
        )
        : data.doctors.length === 0 ? <p className="empty">لا إجراءات في هذه الفترة.</p>
        : (
          <>
            <Tiles totals={data.totals} />
            <Summary data={data} onOpen={open} />
            <p className="earn-note">
              الأرقام من لقطة كلّ سطر لحظة تسجيله — تغيير قاعدةٍ أو سعرٍ لاحقاً لا يمسّها. والإجراء المُزال لا يُحسب.
            </p>
          </>
        )}
    </div>
  )
}
