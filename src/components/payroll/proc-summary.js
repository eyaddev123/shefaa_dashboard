// ═══ ملخّص الإجراءات حسب نوعها (طلب المستخدم 2026-11-20) ═══
// «عمل 4 ايكو، قديش حصّته؟ منضرب، وآخر شي المجموع»: سطرٌ لكلّ (إجراء، حصّة الواحد) — العدد × الحصّة = المجموع.
// الإجراء نفسه بحصّتين (نسبةٌ تغيّر سعرها، أو تصحيحٌ يدوي) سطران متجاوران، فلا رقمٌ مخبّأ في متوسّط.
// المحاسَب وحده (paid) — كـ«حصّته من الإجراءات» في الحساب؛ «بانتظار المحاسبة» خارجه وله تنبيهه.
/** @param {{procedures: {name: string, base?: string, qty?: number, share: number, paid: boolean}[]}[]} visits */
export function procSummary(visits) {
  const groups = new Map()
  for (const v of visits) {
    for (const p of v.procedures || []) {
      if (!p.paid) continue
      // العدد (2026-11-22): «× 4» سطرٌ بحصّةٍ مجموعة — حصّة الواحد = الحصّة ÷ العدد، والعدد يُضاف كلّه
      const qty = Number(p.qty) || 1
      const name = p.base || p.name
      const cents = Math.round((Number(p.share || 0) * 100) / qty)
      const key = `${name}\u0000${cents}`
      const g = groups.get(key) || { name, cents, count: 0 }
      g.count += qty
      groups.set(key, g)
    }
  }
  const byName = new Map()
  for (const g of groups.values()) byName.set(g.name, (byName.get(g.name) || 0) + g.count)
  // الأكثر عدداً أوّلاً، وسطور الاسم الواحد معاً (الحصّة الأعلى أوّلاً)
  const rows = [...groups.values()]
    .sort((a, b) => byName.get(b.name) - byName.get(a.name) || a.name.localeCompare(b.name, 'ar') || b.cents - a.cents)
    .map((g) => ({ name: g.name, share: g.cents / 100, count: g.count, total: (g.cents * g.count) / 100 }))
  return {
    rows,
    kinds: byName.size,
    count: rows.reduce((t, r) => t + r.count, 0),
    total: rows.reduce((t, r) => t + Math.round(r.total * 100), 0) / 100,
  }
}
