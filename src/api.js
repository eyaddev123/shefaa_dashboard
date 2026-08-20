export const getToken = () => localStorage.getItem('token')

async function http(path, options = {}) {
  const token = getToken()
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })
  if (res.status === 401 && path !== '/auth/login') {
    localStorage.removeItem('token')
    window.dispatchEvent(new Event('auth-expired'))
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    // نُرفق جسم الخطأ كاملاً بالاستثناء ليقرأ المتصل تفاصيله (مثل code و followup)
    const err = new Error(data.error || `HTTP ${res.status}`)
    err.status = res.status
    err.data = data
    throw err
  }
  return data
}

export const api = {
  login: (username, password) =>
    http('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  me: () => http('/auth/me'),
  dashboard: () => http('/dashboard'),
  stats: () => http('/stats'),
  families: () => http('/families'),
  family: (id) => http(`/families/${id}`),
  person: (id) => http(`/persons/${id}`),
  search: (q) => http(`/search?q=${encodeURIComponent(q)}`),
  requests: () => http('/requests'),
  request: (id) => http(`/requests/${id}`),
  vouchers: () => http('/vouchers'),
  boardMembers: () => http('/board-members'),
  addBoardMember: (body) => http('/board-members', { method: 'POST', body: JSON.stringify(body) }),
  addReview: (requestId, body) =>
    http(`/requests/${requestId}/reviews`, { method: 'POST', body: JSON.stringify(body) }),
  addDecision: (requestId, body) =>
    http(`/requests/${requestId}/decision`, { method: 'POST', body: JSON.stringify(body) }),
  addVoucher: (requestId, body) =>
    http(`/requests/${requestId}/vouchers`, { method: 'POST', body: JSON.stringify(body) }),
  addFamily: (body) => http('/families', { method: 'POST', body: JSON.stringify(body) }),
  addPerson: (familyId, body) =>
    http(`/families/${familyId}/persons`, { method: 'POST', body: JSON.stringify(body) }),
  addRequest: async (body, files = []) => {
    const form = new FormData()
    for (const [k, v] of Object.entries(body))
      form.append(k, k === 'beneficiary_ids' ? JSON.stringify(v) : v)
    for (const f of files) form.append('files', f)
    const res = await fetch('/api/requests', {
      method: 'POST',
      headers: { Authorization: `Bearer ${getToken()}` },
      body: form,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    return data
  },
  notify: (requestId) => http(`/requests/${requestId}/notify`, { method: 'POST' }),
  treasury: () => http('/treasury'),
  income: () => http('/income'),
  addIncome: (body) => http('/income', { method: 'POST', body: JSON.stringify(body) }),
  catalog: () => http('/catalog'),
  addDisease: (body) => http('/diseases', { method: 'POST', body: JSON.stringify(body) }),
  addService: (body) => http('/services', { method: 'POST', body: JSON.stringify(body) }),
  updateService: (id, body) => http(`/services/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  // إدارة الموظفين والصلاحيات — المشرف العام حصراً
  users: () => http('/users'),
  userOptions: () => http('/users/options'),
  addUser: (body) => http('/users', { method: 'POST', body: JSON.stringify(body) }),
  updateUser: (id, body) => http(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  resetPassword: (id, password) =>
    http(`/users/${id}/password`, { method: 'POST', body: JSON.stringify({ password }) }),
  settings: () => http('/settings'),
  updateSetting: (key, value) =>
    http(`/settings/${key}`, { method: 'PATCH', body: JSON.stringify({ value }) }),
  reconciliationPending: () => http('/reconciliation/pending'),
  reconciliationImport: (rows) =>
    http('/reconciliation/import', { method: 'POST', body: JSON.stringify({ rows }) }),
  clinic: {
    doctors: () => http('/clinic/doctors'),
    addDoctor: (body) => http('/clinic/doctors', { method: 'POST', body: JSON.stringify(body) }),
    updateDoctor: (id, body) => http(`/clinic/doctors/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    schedules: (doctorId) => http(`/clinic/doctors/${doctorId}/schedules`),
    addSchedule: (doctorId, body) =>
      http(`/clinic/doctors/${doctorId}/schedules`, { method: 'POST', body: JSON.stringify(body) }),
    deleteSchedule: (id) => http(`/clinic/schedules/${id}`, { method: 'DELETE' }),
    sessions: (date) => http(`/clinic/sessions?date=${date}`),
    generateSessions: (date) =>
      http('/clinic/sessions/generate', { method: 'POST', body: JSON.stringify({ date }) }),
    addSession: (body) => http('/clinic/sessions', { method: 'POST', body: JSON.stringify(body) }),
    updateSession: (id, body) => http(`/clinic/sessions/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    queue: (sessionId) => http(`/clinic/sessions/${sessionId}/queue`),
    slots: (sessionId) => http(`/clinic/sessions/${sessionId}/slots`),
    doctor: (id) => http(`/clinic/doctors/${id}`),
    lookupPatient: (mobile, sessionId) =>
      http('/clinic/patients/lookup', { method: 'POST', body: JSON.stringify({ mobile, session_id: sessionId }) }),
    followupCheck: (sessionId, mobile) =>
      http(`/clinic/sessions/${sessionId}/followup-check?mobile=${encodeURIComponent(mobile)}`),
    prioritize: (appointmentId, priority) =>
      http(`/clinic/appointments/${appointmentId}/prioritize`, { method: 'POST', body: JSON.stringify({ priority }) }),
    book: (sessionId, body) =>
      http(`/clinic/sessions/${sessionId}/appointments`, { method: 'POST', body: JSON.stringify(body) }),
    arrive: (appointmentId) => http(`/clinic/appointments/${appointmentId}/arrive`, { method: 'POST' }),
    updateAppointment: (appointmentId, body) =>
      http(`/clinic/appointments/${appointmentId}`, { method: 'PATCH', body: JSON.stringify(body) }),
    mySessions: (date) => http(`/clinic/my-sessions?date=${date}`),
    call: (appointmentId) => http(`/clinic/appointments/${appointmentId}/call`, { method: 'POST' }),
    done: (appointmentId) => http(`/clinic/appointments/${appointmentId}/done`, { method: 'POST' }),
    noShow: (appointmentId) => http(`/clinic/appointments/${appointmentId}/no-show`, { method: 'POST' }),
    recall: (appointmentId) => http(`/clinic/appointments/${appointmentId}/recall`, { method: 'POST' }),
    // بلا مصادقة — الشاشة العامة وموقع المريض
    publicBoard: () => http('/public/clinic/board'),
    displayStreamUrl: () => '/api/public/clinic/display-stream',
    myTurn: (body) => http('/public/clinic/my-turn', { method: 'POST', body: JSON.stringify(body) }),
  },
  uploadAttachment: async (requestId, file) => {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(`/api/requests/${requestId}/attachments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${getToken()}` },
      body: form,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    return data
  },
}

// تسميات الأدوار بالعربية — مصدر واحد للشريط الجانبي وشاشة الموظفين
export const ROLE_LABELS = {
  officer: 'موظف إدخال',
  board: 'عضو مجلس الإدارة',
  accountant: 'محاسب الجمعية',
  clinic_admin: 'مسؤول العيادات',
  clinic_reception: 'استقبال العيادات',
  doctor: 'طبيب',
  super_admin: 'المشرف العام',
}

// شرح ما يفتحه كل دور — يُعرض تحت قائمة الأدوار في نموذج إنشاء الموظف
// كي يعرف المشرف ما الذي يمنحه فعلاً قبل أن يمنحه.
export const ROLE_DESCRIPTIONS = {
  officer: 'يُدخل العائلات والطلبات والمرفقات، ويصدر سندات الصرف، ويطابق كشوف الأمين.',
  accountant: 'الخزينة والإيرادات وأسعار الكتالوج وسندات الصرف ومطابقة الأمين.',
  board: 'يراجع الطلبات ويوصي عليها. المدير المسؤول وحده يتخذ القرار النهائي.',
  clinic_admin: 'الدكاترة وجداول الدوام وتوليد الجلسات والإعدادات، مع كامل لوحة العيادات.',
  clinic_reception: 'حجز المرضى وتسجيل الحضور وإدارة الطابور اليومي.',
  doctor: 'شاشته الخاصة فقط: طابور جلساته ونداء المرضى.',
  super_admin: 'يطالع كل شاشات النظام، ويدير الموظفين وأدوارهم والإعدادات.',
}

export const AID_TYPES = {
  treatment: 'علاج',
  medicine: 'دواء',
  surgery: 'عملية جراحية',
  medical_equipment: 'تجهيزات طبية',
  financial: 'مساعدة مالية',
  housing: 'سكن',
  other: 'أخرى',
}

export const STATUSES = {
  draft: 'مسوّدة',
  submitted: 'مُقدّم',
  under_review: 'قيد مراجعة المجلس',
  decided: 'صدر القرار',
  disbursing: 'قيد الصرف',
  disbursed: 'مصروف',
  closed: 'مغلق',
  rejected: 'مرفوض',
}

export const DECISION_TYPES = {
  full_approval: 'موافقة كاملة',
  percentage: 'موافقة بنسبة ٪',
  fixed_amount: 'مبلغ مقطوع',
  exemption: 'إعفاء',
  rejected: 'رفض',
  postponed: 'تأجيل',
}

export const RELATIONS = {
  head: 'رب العائلة',
  wife_1: 'الزوجة الأولى',
  wife_2: 'الزوجة الثانية',
  son: 'ابن',
  daughter: 'ابنة',
  father: 'أب',
  mother: 'أم',
  other: 'أخرى',
}

export const PAYMENT_METHODS = {
  cash: 'نقداً',
  bank_transfer: 'حوالة بنكية',
  cheque: 'شيك',
  in_kind: 'عينية',
}

export const INCOME_KINDS = {
  donation: 'تبرع',
  clinics: 'إيراد عيادات',
  zakat: 'زكاة',
  campaign: 'حملة',
  investment: 'استثمار',
  other: 'أخرى',
}

export const SERVICE_TYPES = {
  surgery: 'عملية',
  medicine: 'دواء',
  session: 'جلسة',
  equipment: 'تجهيزات',
  test: 'تحليل/صورة',
  other: 'أخرى',
}

export const SERVICE_UNITS = {
  once: 'مرة واحدة',
  month: 'شهرياً',
  session: 'بالجلسة',
}

export const DISEASE_CATEGORIES = {
  chronic: 'مزمن',
  surgical: 'جراحي',
  acute: 'حاد',
  disability: 'إعاقة',
  other: 'أخرى',
}

// ─── نظام العيادات ───
export const WEEKDAYS = {
  0: 'الأحد', 1: 'الاثنين', 2: 'الثلاثاء', 3: 'الأربعاء', 4: 'الخميس', 5: 'الجمعة', 6: 'السبت',
}

// تاريخ اليوم بالتوقيت المحلي (لا UTC) — يمنع خطأ "اليوم" قرب منتصف الليل، نفس منطق todayLocal بالسيرفر
export const todayLocal = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// إزاحة تاريخ بصيغة YYYY-MM-DD بعدد أيام (± ) مع البقاء في التوقيت المحلي.
// نبني Date من المكوّنات لا من نص ISO: نص «2026-08-08» يُفسَّر UTC فينزلق يوماً.
export const addDays = (isoDate, days) => {
  const [y, m, d] = isoDate.split('-').map(Number)
  const dt = new Date(y, m - 1, d + days)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

// اسم اليوم بالعربية + رقم اليوم، لعرضه في شريط التنقل بالأيام
const AR_WEEKDAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
export const dayLabel = (isoDate) => {
  const [y, m, d] = isoDate.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return { weekday: AR_WEEKDAYS[dt.getDay()], day: d, month: m }
}

export const SESSION_STATUSES = {
  open: 'مفتوحة', in_progress: 'قيد التنفيذ', closed: 'مغلقة', cancelled: 'ملغاة',
}

export const APPOINTMENT_STATUSES = {
  waiting: 'بانتظار الحضور', arrived: 'حاضر — بانتظار الدور', in_service: 'قيد الكشف',
  done: 'انتهى', no_show: 'لم يحضر', cancelled: 'ملغى',
}

export const BOOKING_TYPES = { walk_in: 'حضر شخصياً', phone: 'اتصال هاتفي' }

// نوع الزيارة — لكلٍّ سعره في بروفايل الدكتور
export const VISIT_TYPES = { consultation: 'معاينة', followup: 'مراجعة' }

// الأولوية — كل ما عدا 'normal' يتقدّم الطابور ويزيح مواعيد من بعده
export const PRIORITIES = {
  normal: 'عادي', urgent: 'حالة فورية (إسعافية)', elderly: 'كبير بالعمر', infant: 'رضيع',
}

// سبب انزياح الموعد كما يُعرض للمريض وللمشرف
export const DELAY_CAUSES = {
  urgent: 'حالة فورية', elderly: 'كبير بالعمر', infant: 'رضيع', manual: 'تعديل يدوي',
}

export const fmtTime = (t) => (t ? t.slice(0, 5) : '—')

// الالتزام المتوقع الناتج عن قرار على طلب — نفس معادلة السيرفر
export const committedFromDecision = (decisionType, decisionValue, expectedCost) => {
  const cost = Number(expectedCost) || 0
  const val = Number(decisionValue) || 0
  if (decisionType === 'full_approval') return cost
  if (decisionType === 'percentage') return (cost * val) / 100
  if (decisionType === 'fixed_amount') return val
  return 0
}

export const fmtMoney = (n) =>
  n == null ? '—' : Number(n).toLocaleString('ar-SY') + ' ل.س'

export const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('ar-SY', { year: 'numeric', month: 'long', day: 'numeric' }) : '—'
