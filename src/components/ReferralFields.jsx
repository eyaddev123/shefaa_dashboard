import { useEffect, useState } from 'react'
import { api, fmtMoney, toLatinDigits } from '../api.js'
import { DISCOUNT_TYPES, DISCOUNT_SCOPES, computeReferral, parseAmount } from '../referral.js'

// ═══ قسم «إحالة» — مطويٌّ افتراضاً ═══
// خانة «معه إحالة؟» وحدها في الحالة العادية، فلا يطول نموذج الحجز على من لا ورقة معه.
// مفتوحاً: الجهة · نوع الخصم وقيمته · النطاق · رقم الورقة وملاحظة — ثمّ المطلوب من المريض
// قبل الخصم وبعده، محسوباً فوراً (الحساب الملزِم في الخادم).
//
// amounts: { fee, lines: [{id, price}] } — أجر الزيارة والإجراءات القائمة بترتيبها.
// current: إحالةٌ قائمة على الزيارة (للتعديل) — جهتها تبقى في القائمة ولو أُوقفت بعدها.
export default function ReferralFields({ value, onChange, amounts, current = null, collapsible = true, disabled = false }) {
  const [options, setOptions] = useState(null)
  const [loadErr, setLoadErr] = useState(null)
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value })

  useEffect(() => {
    if (!value.enabled || options) return
    api.clinic.referralOptions().then(setOptions).catch((e) => setLoadErr(e.message))
  }, [value.enabled]) // eslint-disable-line react-hooks/exhaustive-deps

  const list = options ? [...options] : []
  if (current && !list.some((o) => String(o.id) === String(current.referral_source_id)))
    list.push({ id: current.referral_source_id, name: `${current.source_name} (موقوفة)` })

  const fee = Number(amounts?.fee || 0)
  const lines = amounts?.lines || []
  const original = fee + lines.reduce((s, l) => s + Number(l.price || 0), 0)
  const v = parseAmount(value.discount_value)
  const preview = value.enabled && v != null && v > 0
    ? computeReferral({ fee, lines, type: value.discount_type, value: v, scope: value.discount_scope })
    : null
  const due = preview ? original - preview.total : original
  const pctTooBig = value.discount_type === 'percent' && v != null && v > 100

  return (
    <div className={`ref-box${value.enabled ? ' open' : ''}`}>
      {collapsible && (
        <label className="ref-toggle">
          <input type="checkbox" checked={value.enabled} disabled={disabled}
            onChange={(e) => onChange({ ...value, enabled: e.target.checked })} />
          معه إحالة؟
        </label>
      )}
      {value.enabled && (
        <>
          <div className="bf-row ref-row">
            <div className="field ref-source">
              <label>الجهة المحيلة</label>
              <select value={value.referral_source_id} onChange={set('referral_source_id')} required disabled={disabled}>
                <option value="">{options === null && !loadErr ? 'جارٍ التحميل…' : '— اختر الجهة —'}</option>
                {list.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
              {loadErr && <small className="hint warn-hint">{loadErr}</small>}
            </div>
            <div className="field">
              <label>نوع الخصم</label>
              <select value={value.discount_type} onChange={set('discount_type')} disabled={disabled}>
                {Object.entries(DISCOUNT_TYPES).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
              </select>
            </div>
            <div className="field">
              <label>{value.discount_type === 'percent' ? 'النسبة %' : 'المبلغ (ل.س)'}</label>
              {/* نصّ لا number: حقل الرقم يبتلع الأرقام العربية */}
              <input value={value.discount_value} inputMode="decimal" required disabled={disabled}
                placeholder={value.discount_type === 'percent' ? '50' : '10,000'}
                onChange={(e) => onChange({ ...value, discount_value: toLatinDigits(e.target.value) })} />
              {pctTooBig && <small className="hint warn-hint">النسبة حتى ١٠٠٪</small>}
            </div>
            <div className="field">
              <label>تغطّي</label>
              <select value={value.discount_scope} onChange={set('discount_scope')} disabled={disabled}>
                {Object.entries(DISCOUNT_SCOPES).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
              </select>
            </div>
            <div className="field">
              <label>رقم الورقة <span className="opt">(اختياري)</span></label>
              <input value={value.referral_doc_number} maxLength={60} onChange={set('referral_doc_number')} disabled={disabled} />
            </div>
            <div className="field ref-note">
              <label>ملاحظة <span className="opt">(اختياري)</span></label>
              <input value={value.referral_note} maxLength={500} onChange={set('referral_note')} disabled={disabled} />
            </div>
          </div>
          <p className="ref-due" aria-live="polite">
            المطلوب من المريض:{' '}
            {preview && preview.total > 0 ? (
              <><s className="muted">{fmtMoney(original)}</s> ← <strong>{fmtMoney(due)}</strong></>
            ) : <strong>{fmtMoney(original)}</strong>}
            {lines.length > 0 && value.discount_scope === 'visit_only' && (
              <span className="muted ref-due-note"> — الإجراءات بسعرها الكامل</span>
            )}
          </p>
        </>
      )}
    </div>
  )
}
