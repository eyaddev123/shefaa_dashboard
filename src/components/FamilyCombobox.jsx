import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api.js'

// بحث حيّ عن عائلة بدل قائمة منسدلة بآلاف العائلات.
// يبحث بالسيرفر (اسم/رقم ملف/هاتف) مع debounce، ويدعم لوحة المفاتيح وRTL.
// تنفتح القائمة بالنقر على الحقل (أوّل 20 عائلة للتصفّح) ثم تُصفّى بالكتابة.
// النتائج تصل صفحاتٍ من 20؛ القائمة تُمرَّر داخلها وحدَها، والصفحة التالية
// تُجلب عند بلوغ آخرها (تمريراً أو بالسهم) أو بزرّ «عرض ٢٠ أخرى».
// value = { id, file_number, head_name } أو null. onChange يستقبل نفس الشكل.

export default function FamilyCombobox({ value, onChange, autoFocus }) {
  const [text, setText] = useState('')
  const [results, setResults] = useState([])
  const [hasMore, setHasMore] = useState(false)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [loading, setLoading] = useState(false)     // بحث جديد
  const [loadingMore, setLoadingMore] = useState(false) // صفحة تالية
  const boxRef = useRef(null)
  const listRef = useRef(null)
  const timer = useRef(null)
  // معرّف البحث الجاري — يُهمل ردّ استعلام قديم وصل بعد أحدث منه
  const runId = useRef(0)
  const queryRef = useRef('')

  // إن مُرّرت عائلة مختارة مسبقاً (?family=)، نعرض اسمها في الحقل
  useEffect(() => {
    if (value && value.head_name) setText(`${value.file_number} — ${value.head_name}`)
  }, [value?.id]) // eslint-disable-line

  // جلبُ الصفحة الأولى لاستعلامٍ ما. autoOpen تفتح القائمة (بحثُ المستخدم)،
  // وتبقى مغلقةً حين نُحدِّث محتواها فقط. runId يُهمل ردَّ استعلامٍ سبقه أحدثُ منه.
  const fetchPage = (q, autoOpen) => {
    const id = ++runId.current
    queryRef.current = q
    setLoading(true)
    api.familyLookup(q, 0)
      .then((r) => {
        if (id !== runId.current) return
        setResults(r.items || []); setHasMore(!!r.hasMore); setActive(-1)
        if (autoOpen) setOpen(true)
        if (listRef.current) listRef.current.scrollTop = 0  // استعلامٌ جديد ⇐ من أوّله
      })
      .catch(() => { if (id === runId.current) { setResults([]); setHasMore(false) } })
      .finally(() => { if (id === runId.current) setLoading(false) })
  }

  // بحث مؤجَّل 300ms — لا نُرهق السيرفر بكل حرف
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    const q = text.trim()
    // الحقل فارغ: لا نفتح من تلقائنا عند تحميل الصفحة (ذلك شأنُ نقرةِ المستخدم
    // في openList)، لكنْ إن كان مسحاً بعد بحثٍ فنعود إلى التصفّح بدل نتائجَ عالقة.
    if (!q) {
      if (queryRef.current) fetchPage('', true)
      return
    }
    // حرفٌ واحد لا يُبحث به (الخادم يردّه فارغاً)، والنصُّ المطابقُ لاسم
    // العائلة المختارة لا يستدعي بحثاً جديداً.
    if (q.length === 1 || (value && `${value.file_number} — ${value.head_name}` === text)) {
      setResults([]); setHasMore(false); return
    }
    timer.current = setTimeout(() => fetchPage(q, true), 300)
    return () => timer.current && clearTimeout(timer.current)
  }, [text]) // eslint-disable-line

  // الصفحة التالية (20 أخرى) — تُلحق بما ظهر بلا إعادة بناء القائمة
  const loadMore = useCallback(() => {
    if (loading || loadingMore || !hasMore) return
    const id = runId.current
    const offset = results.length
    setLoadingMore(true)
    api.familyLookup(queryRef.current, offset)
      .then((r) => {
        if (id !== runId.current) return
        setResults((prev) => [...prev, ...(r.items || [])])
        setHasMore(!!r.hasMore)
      })
      .catch(() => {})
      .finally(() => { if (id === runId.current) setLoadingMore(false) })
  }, [loading, loadingMore, hasMore, results.length])

  // إغلاق عند النقر خارج المكوّن
  useEffect(() => {
    const onDoc = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  // النقر على الحقل يفتح القائمة فوراً. إن لم تكن هناك نتائجُ محمَّلةٌ بعدُ
  // (أوّل نقرة، والحقل فارغ) نجلب أوّل 20 للتصفّح بلا انتظار كتابة.
  const openList = () => {
    setOpen(true)
    if (results.length || loading) return
    const q = text.trim()
    if (q.length === 1) return
    if (value && `${value.file_number} — ${value.head_name}` === text) return
    fetchPage(q, false)   // القائمة مفتوحةٌ أصلاً بـ setOpen أعلاه
  }

  // تمرير قرب النهاية ⇐ اجلب الصفحة التالية
  const onScroll = (e) => {
    const el = e.currentTarget
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) loadMore()
  }

  // إبقاء السطر النشط داخل الإطار المرئي عند التنقّل بالسهمين
  useEffect(() => {
    if (active < 0 || !listRef.current) return
    const li = listRef.current.querySelector(`li[data-i="${active}"]`)
    if (li) li.scrollIntoView({ block: 'nearest' })
  }, [active])

  const pick = (fam) => {
    onChange(fam)
    setText(`${fam.file_number} — ${fam.head_name}`)
    setOpen(false); setActive(-1)
  }

  const onKey = (e) => {
    if (!open || results.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => {
        const next = Math.min(a + 1, results.length - 1)
        if (next === results.length - 1) loadMore()  // بلغ الآخر — هات المزيد
        return next
      })
    }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (active >= 0) pick(results[active]) }
    else if (e.key === 'Escape') { setOpen(false) }
  }

  const badge = (state) =>
    state === 'suspended' ? <span className="standing-badge suspended sm">اعتماد معلّق</span>
    : state === 'active' ? <span className="standing-badge sm">معتمدة دائماً</span>
    : null

  return (
    <div className="combobox" ref={boxRef}>
      <input
        value={text} autoFocus={autoFocus} autoComplete="off" dir="rtl"
        onChange={(e) => { setText(e.target.value); if (value) onChange(null) }}
        onMouseDown={openList} onKeyDown={onKey}
        placeholder="ابحث بالاسم أو رقم الملف أو الهاتف…"
        role="combobox" aria-expanded={open} aria-autocomplete="list" />
      {open && (
        <ul className="combobox-list" role="listbox" ref={listRef} onScroll={onScroll}>
          {loading && <li className="empty">جارٍ البحث…</li>}
          {!loading && results.length === 0 && <li className="empty">لا نتائج</li>}
          {!loading && results.map((fam, i) => (
            <li key={fam.id} role="option" aria-selected={i === active} data-i={i}
                className={i === active ? 'active' : ''}
                onMouseDown={(e) => { e.preventDefault(); pick(fam) }}
                onMouseEnter={() => setActive(i)}>
              <span className="cb-main">{fam.file_number} — {fam.head_name}</span>
              <span className="cb-meta">
                {fam.mobile && <span dir="ltr" className="muted">{fam.mobile}</span>}
                {badge(fam.standing_state)}
                {fam.has_block_issue && <span className="badge bad sm">مشكلة بيانات</span>}
              </span>
            </li>
          ))}
          {!loading && loadingMore && <li className="empty">جارٍ جلب المزيد…</li>}
          {!loading && !loadingMore && hasMore && (
            <li className="cb-more"
                onMouseDown={(e) => e.preventDefault()}  // لا تسحب التركيز من الحقل
                onClick={loadMore}>
              عرض ٢٠ نتيجة أخرى
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
