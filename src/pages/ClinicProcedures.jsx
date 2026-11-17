import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useDialogs } from '../dialogs.jsx'
import { api } from '../api.js'
import { useRole } from '../RoleContext.jsx'
import { useToast } from '../action-feedback.jsx'
import ProcedureEarnings from './ProcedureEarnings.jsx'
import ProcedureDialog from '../components/procedures/ProcedureDialog.jsx'
import { canSeeEarnings } from '../permissions.js'
import { matchesAr } from '../arabic-search.js'
import { DistributeRuleDialog, PricingHistoryDialog } from '../components/ShareRuleDialogs.jsx'
import { doctorsCount } from '../share-rule.js'

// ═══ العيادات — الإجراءات ═══
// تبويبان: «الإجراءات» (الكتالوج) و«المستحقات» (من يراها). تبويب «المراجعة» أُزيل بطلب المستخدم
// (2026-11-15: «المستحقات مكفّيتها»): أدواته التي لها عمل — غير المدفوع، وتصحيح مواد السطر وأثره،
// و«إجراء فقط» بلا إجراء، والتنبيهات — صارت في «المستحقات». ?tab=review القديم يفتح المستحقات.
//
// الكتالوج يجيب أسئلة المشرفة: «بكم الإجراء الفلاني؟» (بحث) · «ما إجراءات هذا الاختصاص؟» (أزرار
// الاختصاصات بعددها) · «ما الأكثر طلباً؟» (الترتيب). كلّ إجراء بطاقةٌ تُفتح، وفي نافذتها كلّ ما يخصّه.
// كتالوجٌ عام لكل الدكاترة بلا حذف (الحجوزات تشير إليه): المُستغنى عنه يُعطَّل. المشرفة تكتب، والمجلس
// والمشرف العام والمدير يطالعون (والمدير والمشرفة يرون تاريخ التسعيرة) — يطابق الخادم.
const PRICING_HISTORY_READERS = ['clinic_admin', 'manager']
// المستهلكات تُرسل لمن يرى التقسيم وحده — يطابق SETTLEMENT_VIEWERS في الخادم.
const SETTLEMENT_VIEWERS = ['clinic_admin', 'board', 'super_admin', 'manager']
const TABS = [
  { key: 'catalog', label: 'الإجراءات' },
  { key: 'earnings', label: 'المستحقات', allow: canSeeEarnings },
]
const SORTS = [['used', 'الأكثر استعمالاً'], ['name', 'أبجدياً'], ['price', 'الأعلى سعراً']]

const fmtNum = (n) => Number(n || 0).toLocaleString('ar-SY-u-nu-latn', { maximumFractionDigits: 2 })
const usedText = (n) => (n === 0 ? 'لم يُستعمل' : n === 1 ? 'مرّة واحدة' : n === 2 ? 'مرّتان'
  : `${fmtNum(n)} ${n % 100 >= 3 && n % 100 <= 10 ? 'مرّات' : 'مرّة'}`)
const specsOf = (p) => (p.is_general || !(p.specialties || []).length ? [] : p.specialties)

function Catalog({ list, role, reload, showToast }) {
  const dlg = useDialogs()
  const [params, setParams] = useSearchParams()
  const q = params.get('q') || ''
  const spec = params.get('spec') || ''
  const sort = SORTS.some(([k]) => k === params.get('sort')) ? params.get('sort') : 'used'
  const set = (patch) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) { if (v == null || v === '') next.delete(k); else next.set(k, v) }
    setParams(next, { replace: true })
  }
  const canEdit = role === 'clinic_admin'
  const canHistory = PRICING_HISTORY_READERS.includes(role)
  const seesConsumables = SETTLEMENT_VIEWERS.includes(role)
  const canOpen = canEdit || canHistory || seesConsumables
  const [openId, setOpenId] = useState(null)       // رقم الإجراء المفتوح، أو 'new'
  const [distributing, setDistributing] = useState(null)
  const [historyOf, setHistoryOf] = useState(null)
  const open = openId && openId !== 'new' ? list.find((p) => p.id === openId) : null

  // أزرار الاختصاصات بعدد المفعَّل في كلٍّ — مرتّبةً بالأكثر
  const specs = useMemo(() => {
    const m = new Map()
    for (const p of list) {
      if (!p.is_active) continue
      const ss = specsOf(p)
      if (!ss.length) m.set('general', { id: 'general', name: 'عام', n: (m.get('general')?.n || 0) + 1 })
      for (const s of ss) m.set(String(s.id), { id: String(s.id), name: s.name, n: (m.get(String(s.id))?.n || 0) + 1 })
    }
    return [...m.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'ar'))
  }, [list])
  const active = list.filter((p) => p.is_active)
  const stopped = list.filter((p) => !p.is_active)
  const pool = spec === 'off' ? stopped : active
  const shown = pool
    .filter((p) => !spec || spec === 'off' || (spec === 'general' ? specsOf(p).length === 0 : specsOf(p).some((s) => String(s.id) === spec)))
    .filter((p) => !q.trim() || matchesAr(p.name, q.trim()))
    .sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name, 'ar')
      : sort === 'price' ? Number(b.price) - Number(a.price) || a.name.localeCompare(b.name, 'ar')
      : b.times_used - a.times_used || a.name.localeCompare(b.name, 'ar')))
  // بحثٌ لا يجد شيئاً في الاختصاص المختار — لكنّه يجد خارجه: نقول ذلك
  const elsewhere = q.trim() && shown.length === 0 ? list.filter((p) => matchesAr(p.name, q.trim())).length : 0

  const toggleActive = async (p) => {
    if (p.is_active) {
      const ok = await dlg.confirm({
        title: 'تعطيل الإجراء',
        body: `تعطيل «${p.name}»؟\nلا يُضاف بعدها لأي حجز، وما أُضيف سابقاً يبقى كما هو.`,
        confirmLabel: 'تعطيل', danger: true,
      })
      if (!ok) return
    }
    try {
      await api.clinic.updateProcedure(p.id, { is_active: !p.is_active })
      showToast(p.is_active ? `عُطّل «${p.name}»` : `فُعّل «${p.name}»`, 'success', 3000)
      setOpenId(null); reload()
    } catch (ex) { showToast(ex.message) }
  }

  return (
    <>
      <div className="pcx-bar">
        <input type="search" className="pcx-search" value={q} placeholder="ابحث عن إجراء بالاسم"
          aria-label="بحث عن إجراء" onChange={(e) => set({ q: e.target.value })} />
        <div className="pcx-sort" role="group" aria-label="الترتيب">
          {SORTS.map(([k, label]) => (
            <button key={k} type="button" aria-pressed={sort === k} className={`rev-flag${sort === k ? ' is-on' : ''}`}
              onClick={() => set({ sort: k === 'used' ? null : k })}>{label}</button>
          ))}
        </div>
        {canEdit && <button type="button" className="pcx-new" onClick={() => setOpenId('new')}>+ إجراء جديد</button>}
      </div>

      <div className="pcx-specs" role="group" aria-label="الاختصاص">
        <button type="button" aria-pressed={!spec} className={`pcx-spec${!spec ? ' is-on' : ''}`} onClick={() => set({ spec: null })}>
          الكلّ <span className="pcx-spec-n">{fmtNum(active.length)}</span></button>
        {specs.map((s) => (
          <button key={s.id} type="button" aria-pressed={spec === s.id} className={`pcx-spec${spec === s.id ? ' is-on' : ''}`}
            onClick={() => set({ spec: s.id })}>{s.name} <span className="pcx-spec-n">{fmtNum(s.n)}</span></button>
        ))}
        {stopped.length > 0 && (
          <button type="button" aria-pressed={spec === 'off'} className={`pcx-spec is-off${spec === 'off' ? ' is-on' : ''}`}
            onClick={() => set({ spec: 'off' })}>المعطَّلة <span className="pcx-spec-n">{fmtNum(stopped.length)}</span></button>
        )}
      </div>

      {shown.length === 0 ? (
        <p className="empty pcx-empty">
          {list.length === 0 ? `لا إجراءات بعد${canEdit ? ' — أضف أوّلها من «إجراء جديد»' : ''}.`
            : elsewhere ? <>لا نتيجة هنا — وفي غير هذا الاختصاص {fmtNum(elsewhere)}. <button type="button" className="link-btn" onClick={() => set({ spec: null })}>ابحث في الكلّ</button></>
            : 'لا إجراءات تطابق البحث.'}
        </p>
      ) : (
        <ul className="pcx-grid">
          {shown.map((p) => {
            const ss = specsOf(p)
            const body = (
              <>
                <span className="pcx-name">{p.name}</span>
                <span className="pcx-price">{fmtNum(p.price)}<span className="cash-unit">ل.س</span></span>
                <span className="pcx-tags">
                  {ss.length ? ss.map((s) => <span key={s.id} className="pcx-tag">{s.name}</span>) : <span className="pcx-tag">عام</span>}
                </span>
                <span className="pcx-foot">
                  <span>{usedText(p.times_used)}</span>
                  {seesConsumables && Number(p.consumables_cost) > 0 && <span>مستهلكات {fmtNum(p.consumables_cost)}</span>}
                </span>
              </>
            )
            return (
              <li key={p.id} className={p.is_active ? undefined : 'is-off'}>
                {canOpen
                  ? <button type="button" className="pcx-card" onClick={() => setOpenId(p.id)} aria-label={`${p.name}، ${fmtNum(p.price)} ل.س`}>{body}</button>
                  : <div className="pcx-card">{body}</div>}
              </li>
            )
          })}
        </ul>
      )}

      {(openId === 'new' || open) && (
        <ProcedureDialog key={openId} proc={open} canEdit={canEdit} canHistory={canHistory} seesConsumables={seesConsumables}
          onClose={() => setOpenId(null)}
          onSaved={(text, warnings) => {
            setOpenId(null); reload()
            if (warnings.length) showToast(`${text} — ⚠ ${warnings.join('، ')}`, 'warning', 8000)
            else showToast(text, 'success', 3000)
          }}
          onDistribute={() => { setDistributing(open); setOpenId(null) }}
          onHistory={() => setHistoryOf(open)}
          onToggle={() => toggleActive(open)} />
      )}
      {distributing && (
        <DistributeRuleDialog procedure={distributing} onClose={() => setDistributing(null)}
          onDone={(out) => {
            setDistributing(null)
            const parts = [out.added && `أُضيفت عند ${doctorsCount(out.added)}`, out.replaced && `استُبدلت عند ${doctorsCount(out.replaced)}`,
              out.skipped && `تُخطّي ${doctorsCount(out.skipped)}`].filter(Boolean)
            const text = `«${out.procedure_name}»: ${parts.join('، ') || 'لا تغيير'}`
            if (out.warnings?.length) showToast(`${text} — ⚠ ${out.warnings.join('، ')}`, 'warning', 8000)
            else showToast(text, 'success', 4500)
          }} />
      )}
      {historyOf && <PricingHistoryDialog procedure={historyOf} onClose={() => setHistoryOf(null)} />}
    </>
  )
}

export default function ClinicProcedures() {
  const [list, setList] = useState(null)
  const [err, setErr] = useState(null)
  const [params, setParams] = useSearchParams()
  const [toast, showToast] = useToast()
  const { clinicRole: role } = useRole()
  const tabs = TABS.filter((t) => !t.allow || t.allow(role))
  // ?tab=review (رابطٌ قديم أو من لوحة القيادة) ⇐ المستحقات، فأدوات المراجعة فيها الآن
  const asked = params.get('tab') === 'review' ? 'earnings' : params.get('tab')
  const tab = tabs.some((t) => t.key === asked) ? asked : 'catalog'
  const setTab = (key) => setParams(key === 'catalog' ? {} : { tab: key }, { replace: true })

  const load = () => api.clinic.procedures().then((r) => { setList(r); setErr(null) }).catch((e) => setErr(e.message))
  useEffect(() => { load() }, [])

  const active = list ? list.filter((p) => p.is_active).length : 0
  return (
    <div className="pcx-page">
      <div className="pcx-head">
        <h2>الإجراءات</h2>
        <p className="subtitle pcx-lead">
          {tab === 'earnings'
            ? 'ما طلع لكلّ دكتور من الإجراءات، وحصّة الشفاء منها — من لحظة القبض، كما سُجّل.'
            : <>الاستقبال يضيف الإجراء بعد دخول المريض ومعه موادّه، فتُحسب الحصص فوراً وتنزل المواد من المخزون.
              {' '}المواد وأسعارها في <Link to="/inventory">المخزون</Link>.</>}
        </p>
      </div>
      {toast}
      {tabs.length > 1 && (
        <div className="pcx-tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key}
              className={`pcx-tab${tab === t.key ? ' is-on' : ''}`} onClick={() => setTab(t.key)}>
              {t.label}{t.key === 'catalog' && list && <span className="pcx-tab-n">{fmtNum(active)}</span>}
            </button>
          ))}
        </div>
      )}
      {tab === 'earnings' ? <ProcedureEarnings showToast={showToast} canEdit={role === 'clinic_admin'} />
        : err && !list ? <p className="error">{err}</p>
        : !list ? <p className="empty">جارٍ التحميل…</p>
        : <Catalog list={list} role={role} reload={load} showToast={showToast} />}
    </div>
  )
}
