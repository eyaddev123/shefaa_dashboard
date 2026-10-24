import { useEffect, useState } from 'react'
import { api, fmtMoney, toLatinDigits } from '../api.js'
import { DISCOUNT_TYPES, DISCOUNT_SCOPES, MAX_REFERRALS, availableScopes, coverageFull,
  blankReferral, draftDiscount } from '../referral.js'

// ═══ الإحالات — حتى إحالتين للزيارة، بلا تداخلٍ في النطاق ═══
// «الكشف فقط» و«الإجراءات فقط» معاً، أو «الكشف والإجراءات» وحدها. خيارات النطاق في كل سطر
// هي ما لا يغطّيه غيره وحده — فلا يُعرض خيارٌ يرفضه الخادم (والخادم يرفضه 409 على كل حال).

// قائمة الجهات الفعّالة — تُحمَّل مرّةً عند الحاجة. وجهةٌ أُوقفت بعد تسجيل إحالةٍ عليها تبقى
// في قائمة سطرها (keep) كي يُعدَّل بلا أن تُستبدل جهته قسراً.
export function useReferralOptions(enabled) {
  const [options, setOptions] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    if (!enabled || options) return
    api.clinic.referralOptions().then(setOptions).catch((e) => setErr(e.message))
  }, [enabled]) // eslint-disable-line react-hooks/exhaustive-deps
  return { options, err }
}

/**
 * سطر إحالةٍ واحدة: الجهة · النوع والقيمة · النطاق · الورقة · ملاحظة — ثمّ خصمه الفعليّ.
 * scopes: النطاقات المسموحة لهذا السطر. keep: {id, name} جهةٌ موقوفة قائمة على السطر.
 */
export function ReferralRow({ value, onChange, scopes, options, optionsErr, keep = null, discount, onRemove, disabled = false }) {
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value })
  const list = options ? [...options] : []
  if (keep && !list.some((o) => String(o.id) === String(keep.id))) list.push({ id: keep.id, name: `${keep.name} (موقوفة)` })
  const pctTooBig = value.discount_type === 'percent' && Number(value.discount_value) > 100
  return (
    <div className="ref-item">
      <div className="bf-row ref-row">
        <div className="field ref-source">
          <label>الجهة المحيلة</label>
          <select value={value.referral_source_id} onChange={set('referral_source_id')} required disabled={disabled}>
            <option value="">{options === null && !optionsErr ? 'جارٍ التحميل…' : '— اختر الجهة —'}</option>
            {list.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          {optionsErr && <small className="hint warn-hint">{optionsErr}</small>}
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
          <select value={value.discount_scope} onChange={set('discount_scope')} disabled={disabled || scopes.length <= 1}>
            {scopes.map((k) => <option key={k} value={k}>{DISCOUNT_SCOPES[k]}</option>)}
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
      <div className="ref-item-foot">
        <span>خصمها: <strong>{fmtMoney(discount?.total || 0)}</strong></span>
        {discount?.waitingForProcedures && (
          <span className="ref-waiting">ما في إجراءات بعد — رح يتفعّل أوّل ما ينضاف إجراء</span>
        )}
        {onRemove && <button type="button" className="link-btn" disabled={disabled} onClick={onRemove}>حذف</button>}
      </div>
    </div>
  )
}

/** الأصلي ← الخصومات ← المطلوب من المريض */
export function ReferralTotals({ original, discount }) {
  return (
    <p className="ref-due" aria-live="polite">
      الأصلي {fmtMoney(original)} ← الخصومات {fmtMoney(discount)} ← المطلوب من المريض{' '}
      <strong>{fmtMoney(Math.max(0, original - discount))}</strong>
    </p>
  )
}

/**
 * نموذج الحجز: «معه إحالة؟» مطويّة افتراضاً؛ مفتوحةً حتى سطرين و«+ إحالة» ما دامت التغطية ناقصة.
 * value: قائمة مسوّدات ([] = بلا إحالة). amounts: { fee, lines }.
 */
export default function ReferralsEditor({ value, onChange, amounts, disabled = false }) {
  const enabled = value.length > 0
  const { options, err } = useReferralOptions(enabled)
  const original = Number(amounts?.fee || 0) + (amounts?.lines || []).reduce((s, l) => s + Number(l.price || 0), 0)
  const discounts = value.map((d) => draftDiscount(d, amounts))
  const total = discounts.reduce((s, d) => s + d.total, 0)
  const scopesFor = (i) => availableScopes(value.filter((_, k) => k !== i).map((d) => d.discount_scope))
  const canAdd = value.length < MAX_REFERRALS && !coverageFull(value.map((d) => d.discount_scope))

  const update = (i, d) => onChange(value.map((x, k) => (k === i ? d : x)))
  const remove = (i) => onChange(value.filter((_, k) => k !== i))
  const add = () => onChange([...value, blankReferral(availableScopes(value.map((d) => d.discount_scope))[0])])

  return (
    <div className={`ref-box${enabled ? ' open' : ''}`}>
      <label className="ref-toggle">
        <input type="checkbox" checked={enabled} disabled={disabled}
          onChange={(e) => onChange(e.target.checked ? [blankReferral()] : [])} />
        معه إحالة؟
      </label>
      {enabled && (
        <>
          {value.map((d, i) => (
            <ReferralRow key={d.key} value={d} onChange={(x) => update(i, x)} scopes={scopesFor(i)}
              options={options} optionsErr={err} discount={discounts[i]} disabled={disabled}
              onRemove={() => remove(i)} />
          ))}
          {canAdd && (
            <button type="button" className="link-btn ref-add" disabled={disabled} onClick={add}>+ إحالة</button>
          )}
          <ReferralTotals original={original} discount={total} />
        </>
      )}
    </div>
  )
}
