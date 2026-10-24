// ═══════════════════════════════════════════════════════════════════
// تخطيط شاشات الصالة — مشتركٌ بين شاشة النداء (/display) وشاشة الدور (/order)
//
// لماذا ملفٌّ مستقل: الشاشتان تعملان على تلفازٍ قديم (Chrome 66) بلا container
// queries، فالمقاسات تُحسب في JS من مقاس البطاقة المقيس. تكرار هذا الحساب في
// ملفَّين يعني انحرافَهما بأول تعديل — وقد كلّفنا ذلك جولةً كاملة من قبل.
// ═══════════════════════════════════════════════════════════════════

// ═══ توزيع البطاقات: نختار الشبكة التي تُكبّر البطاقة فعلاً ═══
//
// التوزيع الثابت («٣ أعمدة لما فوق الأربعة») كان يُخرج ٧ بطاقات صفوفاً ٣+٣+١:
// بطاقةٌ يتيمة في صفٍّ وحدها، ونصف الشاشة السفلي فارغ على تلفاز الصالة.
//
// البديل: نجرّب كل عدد أعمدة ممكن ونقيس **مساحة البطاقة الناتجة** بالبكسل
// (من عرض الشبكة وارتفاعها الحقيقيَّين)، ونأخذ الأكبر. ثم نرجّح التوازن:
// شبكةٌ تترك صفّاً أخيرَ شبهَ فارغ تُخصم، فيخرج ٧ ⇒ ٤+٣ لا ٣+٣+١.
//
// ولماذا لا نسبة ثابتة للبطاقة: البطاقة تملأ خانتها مهما كانت — المهم أن تكون
// الخانة أكبر ما يمكن وأقرب إلى مربّع، فالنصّ يكبر معها.
const AR_CARD_IDEAL = 1.25   // نسبة عرض/ارتفاع مفضّلة للبطاقة (أعرض قليلاً من مربّع)

export function pickGrid(n, gridW, gridH) {
  if (n <= 1) return { cols: 1, rows: 1 }
  if (!gridW || !gridH) return { cols: Math.min(n, 3), rows: Math.ceil(n / Math.min(n, 3)) }

  let best = null
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols)
    const cw = gridW / cols
    const ch = gridH / rows
    // مساحة الخانة — المقياس الأول: بطاقة أكبر = نصّ أكبر
    const area = cw * ch
    // عقوبة الانحراف عن النسبة المفضّلة: خانةٌ شريطيّة (طويلة ضيّقة أو عريضة
    // مسطّحة) مساحتها كبيرة لكنّ النصّ فيها يبقى صغيراً، فالأضيق يحكمه.
    const ar = cw / ch
    const arPenalty = Math.min(ar / AR_CARD_IDEAL, AR_CARD_IDEAL / ar)
    // عقوبة الصفّ الأخير الناقص: ٧ في ٣ أعمدة تترك صفّاً فيه بطاقة من ثلاث.
    const lastRow = n - (rows - 1) * cols
    const balance = lastRow / cols
    // ═══ الارتفاع أندرُ من العرض ═══
    // البطاقة تحتاج ارتفاعاً أدنى لتحمل: اسم + رقم + غرفة + صفّ التالي. فشبكةٌ
    // بصفوفٍ كثيرة تُقصّر البطاقة حتى يُقصّ محتواها مهما اتّسع عرضها. (٩ أطباء
    // على ٩٦٠×٥٤٠: ٣×٣ تعطي بطاقة ١٣٦px فيُقصّ الرقم، و٥+٤ تعطي ٢٠٠px فتسلم.)
    const MIN_CARD_H = 150
    const heightPenalty = ch >= MIN_CARD_H ? 1 : Math.pow(ch / MIN_CARD_H, 2)
    const score = area * arPenalty * heightPenalty * (0.55 + 0.45 * balance)
    if (!best || score > best.score) best = { cols, rows, score }
  }
  return { cols: best.cols, rows: best.rows }
}

// توزيع بطاقات الصفّ الأخير حين لا يكتمل: تُوسَّط بدل أن تنزوي في جانب.
// CSS Grid وحده لا يُوسّط صفّاً ناقصاً، فنُزيح أولى بطاقاته بـ grid-column-start.
// (grid-column-start مدعوم في Chrome 66 — لا subgrid ولا شيء حديث.)
export function lastRowOffset(n, cols) {
  const lastRow = n - (Math.ceil(n / cols) - 1) * cols
  if (lastRow === cols) return 0
  return Math.floor((cols - lastRow) / 2)
}

// ═══ مقاسات البطاقة — محسوبة بالـ JS لا بـ CSS ═══
//
// لماذا لا CSS: المقاسات كلها كانت داخل @supports (container-type: size)،
// وChrome 66 — متصفّح تلفاز الصالة — **لا يملكها**. فيسقط إلى القواعد الأساسية
// المبنيّة على vw بسقوفٍ ثابتة (clamp(10px, 0.9vw, 17px)): على شاشة 1920 يعطي
// 17px لـ«يُخدَم الآن» و24px للغرفة. هذه هي «النقاط الصغيرة» التي تُرى من بعيد.
//
// فنحسبها من **مقاس البطاقة نفسه**، ولكلّ عنصرٍ حدٌّ أدنى بالبكسل يُقرأ من ٤–٥ م.
// الترتيب البصري مقصود: الرقم ← الغرفة ← الاسم ← حبّات التالي ← الاختصاص.
const MIN = { number: 56, room: 28, doctor: 20, label: 15, upLabel: 13, specialty: 13 }

// ═══ الحبّات (chips): الحدّ الأدنى لرقم الحبّة ═══
// ٣٤px على شاشة عرضها 1920: ارتفاع الرقم في Cairo العريض ≈٠٫٧em ⇒ ≈٢٤px ≈ ١٫٥ سم
// على تلفاز ٥٥″ — نحو ضعف ما يلزم لقراءة رقمٍ من ٥ أمتار.
// ويتناسب مع **عرض** النافذة لا ارتفاعها: التلفاز الذي يُبلغ عن 960×540 يرسم بكثافة ٢
// (WebView أندرويد) فبكسله ضعف حجمه الفعلي، وشريط المتصفّح يسرق ارتفاعاً لا عرضاً.
// وأرضيّته ٢٤px — حدّ أرقام «التالي» قبل الحبّات.
// ★ القاعدة: إن لم تتّسع البطاقة للحدّ الأدنى يقلّ **عدد** الحبّات («+N») ولا يصغر الخطّ.
export const CHIP_MIN_AT_1920 = 34
export function chipMinPx(viewW) {
  return Math.max(24, Math.round(CHIP_MIN_AT_1920 * (viewW || 1920) / 1920))
}

// ═══ ثلاثة مستويات بعدد العيادات المعروضة ═══
export const TIERS = {
  // ١–٢: بطاقة كبيرة — الحبّة ≈ نصف الرقم الحالي، حتى ٦، وعنوانان
  large:   { chipRatio: 0.5,  nextCap: 6, slots: 6, specialty: true,  nextTitle: true,  returnTitle: true,  merged: false },
  // ٣–٤: الرقم أصغر قليلاً ويبقى المسيطر، حتى ٤ + «+N»، والعودة بأيقونةٍ بلا كلمة
  medium:  { chipRatio: 0.42, nextCap: 4, slots: 5, specialty: true,  nextTitle: true,  returnTitle: false, merged: false },
  // ٥ فأكثر: الاسم والرقم والعيادة، وتحتها صفّ حبّاتٍ واحد مدموج بلا أيّ عنوان —
  // اللون يفرّق «التالي» عن «بانتظار العودة»
  compact: { chipRatio: 0.4,  nextCap: 3, slots: 5, specialty: false, nextTitle: false, returnTitle: false, merged: true },
}
export const tierOf = (n) => (n <= 2 ? 'large' : n <= 4 ? 'medium' : 'compact')

// هندسة الحبّة بوحدة em من خطّها — نفسها في CSS (.pd-chip). عرض رقم Cairo العريض
// مقيسٌ بالمتصفّح: ٠٫٥٥٥em لكل خانة، و«+» مثلها.
const CHIP = { digit: 0.56, padX: 0.4, margin: 0.15, padY: 0.12, lineH: 1.2, border: 1 }
export const chipWidth = (chars, C) =>
  Math.ceil(C * (chars * CHIP.digit + 2 * CHIP.padX + 2 * CHIP.margin) + 2 * CHIP.border)
const chipHeight = (C) => Math.ceil(C * (CHIP.lineH + 2 * CHIP.padY) + 2 * CHIP.border) + 2
// كلمة «بانتظار العودة» بخطّ 700 = ٦٫١em مقيسة؛ والأيقونة ١٫١em وهامشها
const RETURN_WORD_EM = 6.1
const BORDER = 2     // حدّ البطاقة (CSS)
const SECTION_GAP = 4 // gap بين أقسام البطاقة (CSS)

// ═══ الوسط: «يُخدَم الآن» + الرقم + العيادة ضمن ارتفاعٍ معلوم ═══
// ارتفاع الصندوق ≈ الخطّ × ارتفاع السطر. نوزّع الوسط: «يُخدَم الآن» ١٦٪ · الرقم ٥٤٪ ·
// الغرفة ٢٢٪ · ٨٪ للفجوات. وبلا «يُخدَم الآن» (المستوى المكبوس) يأخذ الرقم نصيبه.
function fitMiddle(midH, cardW, base, allowLabel) {
  const px = (frac, min) => Math.max(min, Math.round(base * frac))
  const numberByH = (midH * (allowLabel ? 0.54 : 0.62)) / 1.02
  const roomByH = (midH * 0.22) / 1.41
  // الرقم بطل الشاشة: الأضيق بين نصيبه العمودي وعرض البطاقة يحكم
  let number = Math.max(MIN.number, Math.round(Math.min(cardW * 0.44, numberByH)))
  // الغرفة ثانية الأهمية: عدّة أطباء يتشاركون رقم «التالي» فالغرفة هي المميِّز
  const room = Math.max(MIN.room, Math.round(Math.min(cardW * 0.15, roomByH)))

  // ═══ حين لا يتّسع الوسط للحدّين الأدنيين معاً ═══
  // الحدّ الأدنى يمنع «النقاط الصغيرة» لكنّه إن تجاوز المتاح فاضت الغرفة فقصّها
  // overflow واختفت **بلا أثر** — أسوأ عطبٍ ممكن. فبدل تصغير الخطّ نُقلّل الأسطر:
  //   أولاً: يسقط «يُخدَم الآن» — الرقم الضخم تحت اسم الدكتور مفهومٌ بذاته.
  //   ثم: الغرفة تُختصر إلى رقمها («٦» بدل «العيادة ٦») وتنتقل بجانب الرقم.
  const label = Math.max(MIN.label, Math.min(px(0.062, MIN.label), Math.round(room * 0.7)))
  const budget = midH * 0.95
  const needed = (withLabel, roomBeside) =>
    number * 1.02 + (roomBeside ? 0 : room * 1.41) + (withLabel ? label * 1.2 : 0)
  let showLabel = allowLabel
  let roomBeside = false
  if (needed(showLabel, roomBeside) > budget) showLabel = false
  if (needed(showLabel, roomBeside) > budget) roomBeside = true
  // آخر ما يُضحّى به: الرقم ينزل إلى حدّه الأدنى — والغرفة تبقى كما هي
  const fits = needed(showLabel, roomBeside) <= budget
  if (!fits) number = Math.max(MIN.number, Math.floor(budget / 1.02))
  return { number, room, label, showLabel, roomCompact: roomBeside, fits }
}

// ═══ مقاسات البطاقة ═══
// opts: tier (من tierOf) · chipMin (من chipMinPx) · nextRow/returnRow: هل في الشبكة
// بطاقةٌ لها «تالي»/«بانتظار العودة» · digits: أطول رقمٍ معروض.
// المقاسات واحدة للشبكة كلّها (فلا تختلف بطاقةٌ عن جارتها في حجم رقمها)، فيُحجز
// ارتفاع الصفّ متى وُجد في إحداها؛ والبطاقة التي لا صفّ لها يتوسّط وسطُها فقط.
//
// ★ الميزانية العمودية **محسوبة** لا نسبٌ مقيسة: الترويسة والحبّات تُطرح بارتفاعها
// الفعليّ (خطّ × ارتفاع سطر + حشو)، والباقي للوسط. والحبّات تكبر مع الرقم والرقم
// يصغر معها، فنكرّر الحساب حتى يستقرّ.
// ★ وإن لم يتّسع الوسط حتى للرقم والعيادة بحدّيهما الأدنيين (بطاقةٌ قصيرة: ٤ عيادات على
// 960×540 تعطي ١٩٠px لا تحمل صفَّي حبّات) ينزل المستوى درجةً — صفٌّ مدموج بلا عناوين —
// بدل أن يُقصّ الرقم أو تختفي العيادة. فـ fonts.tier هو المستوى **الفعليّ**.
const TIER_ORDER = ['large', 'medium', 'compact']
export function cardFonts(cardW, cardH, opts = {}) {
  if (!cardW || !cardH) return null
  const start = TIER_ORDER.indexOf(opts.tier) >= 0 ? TIER_ORDER.indexOf(opts.tier) : 0
  let out = null
  for (let i = start; i < TIER_ORDER.length; i++) {
    out = cardFontsAt(cardW, cardH, { ...opts, tier: TIER_ORDER[i] })
    if (out.fits) break
  }
  return out
}

function cardFontsAt(cardW, cardH, opts) {
  const tierKey = opts.tier
  const tier = TIERS[tierKey]
  const chipMin = opts.chipMin || 24
  const hasNext = opts.nextRow !== false
  const hasReturn = !!opts.returnRow
  const digits = Math.max(2, opts.digits || 2)
  // الأضيق يحكم: نصٌّ مربوط بالعرض وحده يفيض طولاً في بطاقة عريضة قصيرة، والعكس.
  const base = Math.min(cardW, cardH * 1.35)
  const px = (frac, min) => Math.max(min, Math.round(base * frac))

  const padY = Math.max(6, Math.round(cardH * 0.02))
  const padX = Math.max(8, Math.round(cardW * 0.025))
  const innerW = Math.floor(cardW - 2 * padX - 2 * BORDER)
  const innerH = cardH - 2 * padY - 2 * BORDER

  const titleOf = (C, D) => Math.max(MIN.upLabel, Math.min(Math.round(C * 0.42), Math.round(D * 0.85)))
  const chipsH = (C, T) => {
    if (!hasNext && !hasReturn) return 0
    let h = 1 + Math.round(C * 0.25)                    // الحدّ العلوي وحشوه
    if (tier.merged) return h + chipHeight(C)
    if (hasNext) h += (tier.nextTitle ? Math.ceil(T * 1.25) + 4 + Math.round(C * 0.08) : 0) + chipHeight(C)
    if (hasReturn) h += (hasNext ? Math.round(C * 0.2) : 0) + chipHeight(C)
    return h
  }
  const layout = (C, D) => {
    const specialty = tier.specialty ? Math.max(MIN.specialty, Math.min(px(0.055, MIN.specialty), Math.round(D * 0.7))) : 0
    const headH = Math.ceil(D * 1.15) + (specialty ? 3 + Math.ceil(specialty * 1.15) : 0)
    const T = titleOf(C, D)
    const ch = chipsH(C, T)
    const midH = innerH - headH - SECTION_GAP - (ch ? ch + SECTION_GAP : 0)
    return { specialty, T, mid: fitMiddle(midH, cardW, base, tier.nextTitle) }
  }
  // سقف العرض: عدد الحبّات المرغوب للمستوى يتّسع في سطرٍ واحد
  const unit = digits * CHIP.digit + 2 * CHIP.padX + 2 * CHIP.margin
  const byWidth = Math.floor((innerW - 4 - tier.slots * 2 * CHIP.border) / (tier.slots * unit + (tier.merged ? 0.4 : 0)))

  // الاسم يتبع الغرفة والغرفة تتبع الوسط: بضع جولات تكفي ليستقرّ
  const settle = (C) => {
    let D = MIN.doctor
    for (let i = 0; i < 4; i++) {
      const { mid } = layout(C, D)
      D = Math.max(MIN.doctor, Math.min(px(0.105, MIN.doctor), Math.round(mid.room * 0.88)))
    }
    return { D, mid: layout(C, D).mid }
  }
  // ═══ حجم الحبّة: أكبر C تبقى عنده ≤ نسبةً من الرقم الحالي ═══
  // الحبّة الأكبر تأكل من الوسط فيصغر الرقم — فالتكرار البسيط يتأرجح (بطاقةٌ واحدة
  // أعطت رقماً ١٠٤px وحبّاتٍ ٦٢px). والعلاقة رتيبة: بحثٌ ثنائيّ يجد نقطة التوازن.
  // ولا تنزل عن حدّها مهما ضاق العرض أو الارتفاع — يقلّ عددها بدلاً من ذلك.
  let lo = chipMin
  // وسقفٌ بالارتفاع للبطاقة الكبيرة جداً (عيادةٌ وحدها): صفّا حبّاتٍ بنصف الرقم
  // يأكلان ثلث البطاقة فيصغر «يُخدَم الآن» عمّا كان — وهو يجب أن يبقى ضخماً.
  let hi = Math.max(chipMin, Math.min(byWidth, tierKey === 'large' ? Math.round(innerH * 0.07) : byWidth))
  while (hi - lo > 1) {
    const C = Math.floor((lo + hi) / 2)
    if (C <= settle(C).mid.number * tier.chipRatio) lo = C
    else hi = C
  }
  const C = hi > lo && hi <= settle(hi).mid.number * tier.chipRatio ? hi : lo
  const D = settle(C).D
  const { specialty, T, mid } = layout(C, D)
  // الغرفة تبقى ≥ الاسم (الترتيب البصري) — تصغير الاسم يحرّر ارتفاعاً ولا يأخذه
  const doctor = Math.max(MIN.doctor, Math.min(D, mid.room))
  // الحبّة لا تنافس الرقم الحالي — يبقى المسيطر في كل المستويات
  const chip = Math.max(chipMin, Math.min(C, Math.round(mid.number * 0.6)))

  return {
    tier: tierKey,
    number: mid.number,
    room: mid.room,
    roomCompact: mid.roomCompact,
    fits: mid.fits,
    showLabel: mid.showLabel,
    label: mid.label,
    doctor,
    specialty,
    showSpecialty: tier.specialty,
    chip,
    chipMin,
    chipTitle: T,
    padX,
    padY,
    innerW,
    // عرض علامة «بانتظار العودة» قبل حبّاتها: أيقونة + كلمة (كبير) أو أيقونة وحدها (متوسّط)
    returnMarkW: tier.merged ? 0 : tier.returnTitle
      ? Math.ceil(T * (RETURN_WORD_EM + 1.4) + chip * 0.3)
      : Math.ceil(chip * 1.1),
  }
}

// ═══ كم حبّةً تُعرض؟ ═══
// يُحسب من العرض لا يُقاس بعد الرسم: القياس يأتي متأخّراً دورةً فتُعرض حبّاتٌ تُقصّ
// بصمت. وما لا يتّسع يُعلن عن نفسه بحبّة «+N» — قصٌّ صامت أسوأ من رقمٍ ناقص.
// ★ أوّل «تالي» يُعرض دائماً: هو الذي سيُنادى بعد قليل.
export function planChips(next, ret, fonts) {
  const tier = TIERS[fonts.tier] || TIERS.large
  const C = fonts.chip
  const w = (n) => chipWidth(String(n).length, C)
  const more = (k) => (k > 0 ? chipWidth(String(k).length + 1, C) : 0)
  const sum = (arr, k) => arr.slice(0, k).reduce((s, n) => s + w(n), 0)
  const avail = fonts.innerW - 4

  if (tier.merged) {
    // صفٌّ واحد: «التالي» ثم «العودة» بفاصلٍ صغير. نجرّب كل توزيع (a من التالي، b من
    // العودة) ونفضّل بالترتيب: حبّتَي «تالي» (من ينتظر يبحث عن رقمه أولاً) ← ظهور
    // العودة بلونها ولو حبّةً أو «+N» ← أكثر الحبّات ← الأكثر من «التالي».
    const aMax = Math.min(tier.nextCap, next.length)
    const aMin = next.length > 0 ? 1 : 0
    let best = null
    for (let a = aMax; a >= aMin; a--) {
      for (let b = ret.length; b >= 0; b--) {
        const sep = a > 0 && (b > 0 || ret.length > 0) ? Math.ceil(C * 0.4) : 0
        const width = sum(next, a) + more(next.length - a) + sep + sum(ret, b) + more(ret.length - b)
        if (width > avail && !(a === aMin && b === 0)) continue
        const score = [Math.min(a, 2), b > 0 || ret.length === 0 ? 1 : 0, a + b, a]
        const better = !best || score.some((v, k) =>
          v !== best.score[k] && score.slice(0, k).every((u, j) => u === best.score[j]) && v > best.score[k])
        if (better) best = { a, b, score }
      }
    }
    const { a, b } = best || { a: aMin, b: 0 }
    return { next: next.slice(0, a), nextMore: next.length - a, ret: ret.slice(0, b), retMore: ret.length - b }
  }

  const fitRow = (nums, cap, room, minShown) => {
    for (let a = Math.min(cap, nums.length); a >= minShown; a--) {
      if (sum(nums, a) + more(nums.length - a) <= room) return a
    }
    return minShown
  }
  const a = fitRow(next, tier.nextCap, avail, next.length > 0 ? 1 : 0)
  const b = fitRow(ret, Infinity, avail - fonts.returnMarkW, 0)
  return { next: next.slice(0, a), nextMore: next.length - a, ret: ret.slice(0, b), retMore: ret.length - b }
}
