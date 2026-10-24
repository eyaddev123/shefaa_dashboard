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
// الترتيب البصري مقصود: الرقم ← الغرفة ← الاسم ← التالي/بعده ← الاختصاص.
const MIN = { number: 56, room: 28, doctor: 20, label: 15, upNum: 24, upLabel: 13, specialty: 13 }

// opts.extraRow: سطر «بانتظار العودة» أسفل البطاقة (خروج مؤقت) — يُقتطع ارتفاعه من
// الوسط **قبل** توزيعه، وإلا فاض الوسط فقصّ overflow الغرفةَ بصمت (انظر أدناه).
export function cardFonts(cardW, cardH, opts = {}) {
  if (!cardW || !cardH) return null
  // الأضيق يحكم: نصٌّ مربوط بالعرض وحده يفيض طولاً في بطاقة عريضة قصيرة، والعكس.
  const base = Math.min(cardW, cardH * 1.35)
  const px = (frac, min) => Math.max(min, Math.round(base * frac))
  // ═══ الميزانية العمودية: مقيسة لا مخمَّنة ═══
  // البطاقة ثلاثة صفوف (grid: auto 1fr auto). قياسٌ فعلي بالمتصفّح أعطى
  // الترويسة ≈٢٢٪ وصفّ التالي ≈٢١٪ والوسط ≈٤٨٪ من ارتفاع البطاقة.
  // والوسط يحمل ثلاثة: «يُخدَم الآن» ثم الرقم ثم الغرفة — ومجموع ارتفاعاتها
  // الصندوقية يجب أن يبقى **داخل** الوسط، وإلا فاضت الغرفة فقصّها overflow
  // واختفت من الشاشة (رُصد فعلاً: صندوقها ٩px وخطّها ٥٨px).
  //
  // ارتفاع الصندوق ≈ الخطّ × ارتفاع السطر. فنوزّع الوسط بنسبٍ تجمع إلى ١:
  //   «يُخدَم الآن» ١٦٪ · الرقم ٥٤٪ · الغرفة ٢٢٪ · ٨٪ للفجوات والحشو.
  // نصيب الوسط من البطاقة. الترويسة وصفّ «التالي» يتناسبان مع الخطّ أيضاً،
  // فنسبتهما شبه ثابتة: قياسٌ فعلي أعطى الوسط ٤٦–٤٨٪ عند ٧ و٩ بطاقات.
  // ونأخذ ٤٦٪ لا أكثر: التقدير الزائد يُخفي الغرفة تماماً (خطأٌ صامت لا يُرى
  // إلا في الصالة)، والناقص يصغّر الخطّ قليلاً فقط (خطأٌ مرئي وقابل للضبط).
  // بطاقةٌ قليلة العدد تملك فائض ارتفاع (الترويسة وصفّ التالي لا ينموان بنفس
  // النسبة)، فنعطيها نصيباً أكبر من الوسط. والصغيرة تبقى على ٤٦٪ المقيسة.
  // السطر الإضافي: خطّ «التالي:» الصغير × ارتفاع السطر + حشوه وحدّه ≈ ٩٪ من البطاقة،
  // وحدٌّ أدنى ١٨px للبطاقات الصغيرة (الخطّ لا ينزل عن ١٣px).
  // ★ وفي البطاقة الأضيق لا يتّسع السطر حتى للرقم بحدّه الأدنى (٧ أطباء على ٩٦٠×٤٥٠):
  // فلا سطر — تنتقل الأرقام إلى صفّ «التالي» نفسه (returningInline) بدل قصّ الرقم.
  const midShare = cardH * (cardH >= 600 ? 0.56 : cardH >= 380 ? 0.50 : 0.46)
  let extraH = opts.extraRow ? Math.max(18, Math.round(cardH * 0.09)) : 0
  const returningInline = extraH > 0 && MIN.number * 1.02 > (midShare - extraH) * 0.95
  if (returningInline) extraH = 0
  const midH = midShare - extraH
  // الخطّ = نصيب الصندوق ÷ ارتفاع السطر (number 1.02، room 1.25 + حشو 0.16em)
  const numberByH = (midH * 0.54) / 1.02
  const roomByH = (midH * 0.22) / 1.41
  // الرقم بطل الشاشة: الأضيق بين نصيبه العمودي وعرض البطاقة يحكم
  let number = Math.max(MIN.number, Math.round(Math.min(cardW * 0.44, numberByH)))
  // الغرفة ثانية الأهمية: عدّة أطباء يتشاركون رقم «التالي» فالغرفة هي المميِّز
  let room = Math.max(MIN.room, Math.round(Math.min(cardW * 0.15, roomByH)))

  // ═══ حين لا يتّسع الوسط للحدّين الأدنيين معاً ═══
  // (٩ أطباء على ١٣٦٦×٧٦٨: البطاقة ١٩٩px، الترويسة وصفّ التالي يأخذان ١٠٢ فيبقى
  // ٦٨ بينما «يُخدَم الآن» + الرقم + الغرفة تحتاج ١١٦.) الحدّ الأدنى يمنع «النقاط
  // الصغيرة» لكنّه إن تجاوز المتاح فاضت الغرفة فقصّها overflow واختفت **بلا أثر**
  // — وهو أسوأ عطبٍ ممكن: الغرفة ثانية الأهمية.
  //
  // فبدل تصغير الخطّ إلى ما لا يُقرأ، نُقلّل **عدد الأسطر**:
  //   أولاً: يسقط «يُخدَم الآن» — الرقم الضخم تحت اسم الدكتور مفهومٌ بذاته.
  //   ثم: الغرفة تُختصر إلى رقمها («٦» بدل «الغرفة ٦») وتنتقل بجانب الرقم.
  const labelH = () => Math.max(MIN.label, Math.min(px(0.062, MIN.label), Math.round(room * 0.7)))
  const budget = midH * 0.95
  const needed = (withLabel, roomBeside) =>
    number * 1.02 + (roomBeside ? 0 : room * 1.41) + (withLabel ? labelH() * 1.2 : 0)

  let showLabel = true
  let roomBeside = false
  if (needed(showLabel, roomBeside) > budget) showLabel = false
  if (needed(showLabel, roomBeside) > budget) roomBeside = true
  if (needed(showLabel, roomBeside) > budget) {
    // آخر ما يُضحّى به: الرقم ينزل إلى حدّه الأدنى — والغرفة تبقى كما هي
    number = Math.max(MIN.number, Math.floor((budget - 0) / 1.02))
  }
  const roomCompact = roomBeside
  const doctor = Math.min(px(0.105, MIN.doctor), Math.round(room * 0.88))
  const upNum = Math.min(px(0.105, MIN.upNum), Math.round(room * 0.88))
  return {
    number,
    room,
    roomCompact,
    showLabel,
    returningInline,
    doctor,
    upNum,
    label: Math.min(px(0.062, MIN.label), Math.round(doctor * 0.8)),
    upLabel: Math.min(px(0.052, MIN.upLabel), Math.round(doctor * 0.7)),
    specialty: Math.min(px(0.055, MIN.specialty), Math.round(doctor * 0.7)),
  }
}
