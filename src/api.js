export const getToken = () => localStorage.getItem('token')

async function http(path, options = {}) {
  const token = getToken()
  let res
  try {
    res = await fetch(`/api${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    })
  } catch {
    // انقطاع الشبكة: fetch يرمي «Failed to fetch» بالإنجليزية — رسالة عربية مفهومة بدلها
    const err = new Error('تعذّر الاتصال بالخادم — تحقّق من الشبكة وأعد المحاولة')
    err.status = 0
    err.data = { code: 'NETWORK_ERROR' }
    throw err
  }
  if (res.status === 401 && path !== '/auth/login') {
    localStorage.removeItem('token')
    window.dispatchEvent(new Event('auth-expired'))
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    // نُرفق جسم الخطأ كاملاً بالاستثناء ليقرأ المتصل تفاصيله (مثل code و followup)
    // بلا رسالة من خادمنا (وسيطٌ ردّ 502/504 والخادم متوقف): «HTTP 502» لا تعني شيئاً للموظف
    const err = new Error(data.error || (res.status >= 500
      ? `الخادم لا يستجيب الآن (${res.status}) — أعد المحاولة بعد قليل`
      : `HTTP ${res.status}`))
    err.status = res.status
    err.data = data
    throw err
  }
  return data
}

// ═══ التنزيل: ملفٌّ لا JSON ═══
// رابطٌ عاديّ <a href> لا يحمل ترويسة Authorization، فالخادم يردّ 401.
// فنجلبه بـ fetch ونصنع رابطاً مؤقّتاً من الـblob — والاسم العربي يُقرأ
// من Content-Disposition الذي يرسله الخادم.
async function downloadFile(url, fallbackName) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${getToken()}` } })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    const err = new Error(data.error || `تعذّر التصدير (${res.status})`)
    err.status = res.status; err.data = data
    throw err
  }
  const cd = res.headers.get('content-disposition') || ''
  const star = /filename\*=UTF-8''([^;]+)/i.exec(cd)
  const name = star ? decodeURIComponent(star[1]) : fallbackName
  const objectUrl = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = objectUrl
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  // الإفراج مؤجَّل: الإلغاء الفوري يقطع التنزيل في بعض المتصفّحات
  setTimeout(() => URL.revokeObjectURL(objectUrl), 10000)
  return name
}

// رفع ملفّ (FormData) — بلا Content-Type: المتصفّح يضعه بحدوده. والخطأ يحمل جسمه
// كاملاً (err.data) كـhttp(): معاينة الاستيراد الجديدة تصل مع 409 PREVIEW_STALE.
async function postForm(path, form) {
  let res
  try {
    res = await fetch(`/api${path}`, { method: 'POST', headers: { Authorization: `Bearer ${getToken()}` }, body: form })
  } catch {
    const err = new Error('تعذّر الاتصال بالخادم — تحقّق من الشبكة وأعد المحاولة')
    err.status = 0; err.data = { code: 'NETWORK_ERROR' }
    throw err
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`)
    err.status = res.status; err.data = data
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
  families: (opts = {}) => {
    const p = new URLSearchParams()
    if (opts.issues) p.set('issues', '1')
    if (opts.by && opts.q) { p.set('by', opts.by); p.set('q', opts.q) }
    const qs = p.toString()
    return http(`/families${qs ? '?' + qs : ''}`)
  },

  // مراجعة جودة البيانات المستوردة من الأرشيف
  dqSummary: () => http('/data-quality/summary'),
  dqRecords: (params = {}) => {
    const q = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== '' && v != null)).toString()
    return http(`/data-quality/records${q ? `?${q}` : ''}`)
  },
  dqFix: (scope, id, body) =>
    http(`/data-quality/${scope}/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  dqReopen: (scope, id) =>
    http(`/data-quality/${scope}/${id}/reopen`, { method: 'POST' }),
  family: (id) => http(`/families/${id}`),
  person: (id) => http(`/persons/${id}`),
  updatePerson: (id, body) => http(`/persons/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  search: (q) => http(`/search?q=${encodeURIComponent(q)}`),
  // بحث سريع عن عائلة (combobox إنشاء الطلب)
  familyLookup: (q, offset = 0) => http(`/families/lookup?q=${encodeURIComponent(q)}&offset=${offset}`),
  // قائمة الطلبات مع بحث خادمي محدَّد بربع: by=name|phone|request_no
  requests: (by, q) => http('/requests' + (by && q ? `?by=${by}&q=${encodeURIComponent(q)}` : '')),
  request: (id) => http(`/requests/${id}`),
  vouchers: () => http('/vouchers'),
  boardMembers: () => http('/board-members'),
  addBoardMember: (body) => http('/board-members', { method: 'POST', body: JSON.stringify(body) }),
  addReview: (requestId, body) =>
    http(`/requests/${requestId}/reviews`, { method: 'POST', body: JSON.stringify(body) }),
  addDecision: (requestId, body) =>
    http(`/requests/${requestId}/decision`, { method: 'POST', body: JSON.stringify(body) }),
  // الاعتماد الدائم للعائلة
  standingApprovals: (familyId) => http(`/families/${familyId}/standing-approvals`),
  revokeStandingApproval: (id, reason) =>
    http(`/standing-approvals/${id}/revoke`, { method: 'POST', body: JSON.stringify({ reason }) }),
  reconfirmStandingApproval: (id) =>
    http(`/standing-approvals/${id}/reconfirm`, { method: 'POST' }),
  standingDueReview: () => http('/standing-approvals/due-review'),
  flaggedVouchers: () => http('/reconciliation/flagged'),
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
    // تعديل السطر نفسه (نفس id): 409 SCHEDULE_OVERLAP إن تداخل مع سطرٍ آخر لنفس الدكتور
    updateSchedule: (id, body) =>
      http(`/clinic/schedules/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    deleteSchedule: (id) => http(`/clinic/schedules/${id}`, { method: 'DELETE' }),
    // تفعيل/إيقاف سطر الدوام بلا حذف — الموقوف لا تُولَّد منه جلسات
    setScheduleActive: (id, isActive) =>
      http(`/clinic/schedules/${id}`, { method: 'PATCH', body: JSON.stringify({ is_active: isActive }) }),
    // تعديل الغرفة السريع من لوحة اليوم: null = «بلا غرفة»، وconfirm بعد 409 ROOM_CHANGE_LIVE_SESSION
    setDoctorRoom: (id, room, confirm = false) =>
      http(`/clinic/doctors/${id}/room`, { method: 'PATCH',
        body: JSON.stringify({ room, ...(confirm ? { confirm: true } : {}) }) }),
    doctorHistory: (id) => http(`/clinic/doctors/${id}/history`),
    schedulePreview: (from, weeks = 6) =>
      http(`/clinic/schedules/preview?from=${from}&weeks=${weeks}`),
    dayDoctors: (date) => http(`/clinic/day-doctors?date=${date}`),
    closeSession: (id) => http(`/clinic/sessions/${id}/close`, { method: 'POST' }),
    // ═══ الإجراءات بالحساب الفوري: المراجعة والتقارير (مشرف العيادات ومن يطالع) ═══
    procedureReview: ({ from, to, doctorId, flag }) => {
      const q = new URLSearchParams({ from, to: to || from })
      if (doctorId) q.set('doctor_id', String(doctorId))
      if (flag) q.set('flag', flag)
      return http(`/clinic/procedures/review?${q}`)
    },
    procedureHistory: (lineId) => http(`/clinic/procedures/${lineId}/history`),
    exportProcedures: ({ from, to, doctorId }) => {
      const q = new URLSearchParams({ from, to: to || from })
      if (doctorId) q.set('doctor_id', String(doctorId))
      return downloadFile(`/api/clinic/procedures/export?${q}`, `حصص الإجراءات-${from}.xlsx`)
    },
    materialsConsumption: ({ from, to }) =>
      http(`/clinic/materials/consumption?${new URLSearchParams({ from, to: to || from })}`),
    exportConsumption: ({ from, to }) =>
      downloadFile(`/api/clinic/materials/consumption?${new URLSearchParams({ from, to: to || from, format: 'xlsx' })}`,
        `استهلاك المواد-${from}.xlsx`),
    // ── كتالوج المواد ── (الاستقبال يتسلّم المفعَّل بلا سعر — من الخادم نفسه)
    materials: () => http('/clinic/materials'),
    addMaterial: (body) => http('/clinic/materials', { method: 'POST', body: JSON.stringify(body) }),
    updateMaterial: (id, body) => http(`/clinic/materials/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    setDoctorShare: (id, body) =>
      http(`/clinic/doctors/${id}/share`, { method: 'PATCH', body: JSON.stringify(body) }),
    doctorProcedureShares: (id) => http(`/clinic/doctors/${id}/procedure-shares`),
    // إضافة قاعدة: 409 SHARE_RULE_EXISTS ومعه القائمة (تُعدَّل بـ setDoctorProcedureShare)
    addDoctorProcedureShare: (id, body) =>
      http(`/clinic/doctors/${id}/procedure-shares`, { method: 'POST', body: JSON.stringify(body) }),
    procedureDoctorShares: (procId) => http(`/clinic/procedures/${procId}/doctor-shares`),
    distributeRule: (procId, body) =>
      http(`/clinic/procedures/${procId}/distribute-rule`, { method: 'POST', body: JSON.stringify(body) }),
    procedurePricingHistory: (procId) => http(`/clinic/procedures/${procId}/pricing-history`),
    setDoctorProcedureShare: (id, procId, body) =>
      http(`/clinic/doctors/${id}/procedure-shares/${procId}`, { method: 'PUT', body: JSON.stringify(body) }),
    removeDoctorProcedureShare: (id, procId) =>
      http(`/clinic/doctors/${id}/procedure-shares/${procId}`, { method: 'DELETE' }),
    reopenSession: (id) => http(`/clinic/sessions/${id}/reopen`, { method: 'POST' }),
    // جرد الصندوق: الشاشة (format=json) والملفّ من المسار نفسه والحساب نفسه — كلّه في الخادم
    cashReportData: ({ date }) => http(`/reception/cash-report?${new URLSearchParams({ date, format: 'json' })}`),
    // المساءلة (المشرفة والمدير): نشاط الموظفين في يوم الجرد، والخط الزمني لكل زيارة
    cashStaffActivity: ({ date }) => http(`/reception/cash-report/staff-activity?${new URLSearchParams({ date })}`),
    appointmentTimeline: (appointmentId) => http(`/clinic/appointments/${appointmentId}/timeline`),
    cashReport: ({ date }) =>
      downloadFile(`/api/reception/cash-report?${new URLSearchParams({ date })}`, `jard-${date}.xlsx`),
    // ═══ الإحالات ═══
    // قائمة الاختيار (الفعّالة) للاستقبال والمشرفة؛ والإدارة والتقرير للمشرفة وحدها
    referralOptions: () => http('/clinic/referral-sources/options'),
    referralSources: () => http('/clinic/referral-sources'),
    addReferralSource: (body) => http('/clinic/referral-sources', { method: 'POST', body: JSON.stringify(body) }),
    updateReferralSource: (id, body) =>
      http(`/clinic/referral-sources/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    deleteReferralSource: (id) => http(`/clinic/referral-sources/${id}`, { method: 'DELETE' }),
    // حتى إحالتين للزيارة بلا تداخل؛ كل كتابة يُعيد الخادم بها الحساب (والتداخل 409)
    addReferral: (appointmentId, body) =>
      http(`/clinic/appointments/${appointmentId}/referrals`, { method: 'POST', body: JSON.stringify(body) }),
    updateReferral: (appointmentId, refId, body) =>
      http(`/clinic/appointments/${appointmentId}/referrals/${refId}`, { method: 'PUT', body: JSON.stringify(body) }),
    removeReferral: (appointmentId, refId, reason) =>
      http(`/clinic/appointments/${appointmentId}/referrals/${refId}`, { method: 'DELETE', body: JSON.stringify({ reason }) }),
    referralReport: ({ from, to, sourceId }) => {
      const q = new URLSearchParams({ from, to: to || from })
      if (sourceId) q.set('source_id', String(sourceId))
      return http(`/clinic/referrals/report?${q}`)
    },
    exportReferralReport: ({ from, to, sourceId }) => {
      const q = new URLSearchParams({ from, to: to || from })
      if (sourceId) q.set('source_id', String(sourceId))
      return downloadFile(`/api/clinic/referrals/report/export?${q}`, `مستحقات-الإحالات-${from}.xlsx`)
    },
    // تصدير بيانات العيادة (انظر downloadFile)
    exportExcel: ({ from, to, doctorId }) => {
      const q = new URLSearchParams({ from, to: to || from })
      if (doctorId) q.set('doctor_id', String(doctorId))
      return downloadFile(`/api/clinic/export?${q}`, `عيادات-${from}.xlsx`)
    },
    apologize: (body) => http('/clinic/apologies', { method: 'POST', body: JSON.stringify(body) }),
    undoApology: (doctorId, date) =>
      http(`/clinic/apologies/${doctorId}/${date}`, { method: 'DELETE' }),
    sessions: (date) => http(`/clinic/sessions?date=${date}`),
    generateSessions: (date) =>
      http('/clinic/sessions/generate', { method: 'POST', body: JSON.stringify({ date }) }),
    addSession: (body) => http('/clinic/sessions', { method: 'POST', body: JSON.stringify(body) }),
    updateSession: (id, body) => http(`/clinic/sessions/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    queue: (sessionId) => http(`/clinic/sessions/${sessionId}/queue`),
    slots: (sessionId) => http(`/clinic/sessions/${sessionId}/slots`),
    doctor: (id) => http(`/clinic/doctors/${id}`),
    // يبحث بالموبايل أو بالاسم. الرد إمّا مريضاً واحداً (مطابقة موبايل قاطعة)،
    // أو { candidates: [...] } (مطابقة اسم — يقرّر الموظف)، أو null.
    lookupPatientBy: (body) =>
      http('/clinic/patients/lookup', { method: 'POST', body: JSON.stringify(body) }),
    lookupPatient: (mobile, sessionId) =>
      http('/clinic/patients/lookup', { method: 'POST', body: JSON.stringify({ mobile, session_id: sessionId }) }),
    followupCheck: (sessionId, mobile) =>
      http(`/clinic/sessions/${sessionId}/followup-check?mobile=${encodeURIComponent(mobile)}`),
    prioritize: (appointmentId, priority) =>
      http(`/clinic/appointments/${appointmentId}/prioritize`, { method: 'POST', body: JSON.stringify({ priority }) }),
    // قراءةٌ فقط: الوقت الذي سيأخذه الحجز التالي لو حُفظ الآن (نمط الحضور). الحقيقيّ يُعطى عند الحفظ.
    estimatePreview: (sessionId, { priority, booking_type }) =>
      http(`/clinic/sessions/${sessionId}/estimate-preview?priority=${encodeURIComponent(priority)}`
        + `&booking_type=${encodeURIComponent(booking_type)}`),
    book: (sessionId, body) =>
      http(`/clinic/sessions/${sessionId}/appointments`, { method: 'POST', body: JSON.stringify(body) }),
    // patient اختياري: استكمال المعلومات المؤجَّلة مع تعليم الحضور في طلب واحد
    arrive: (appointmentId, patient) => http(`/clinic/appointments/${appointmentId}/arrive`,
      { method: 'POST', body: JSON.stringify(patient ? { patient } : {}) }),
    updateAppointment: (appointmentId, body) =>
      http(`/clinic/appointments/${appointmentId}`, { method: 'PATCH', body: JSON.stringify(body) }),

    // ═══ تعديل الحجز ═══
    // (الحالة تُغيَّر من لوحة «تفاصيل» ضمن حفظٍ واحد عبر saveAppointmentDetails
    //  أدناه — ولا مُستدعٍ لمسار /status في الواجهة.)
    undoNoShow: (appointmentId, reason) =>
      http(`/clinic/appointments/${appointmentId}/undo-no-show`,
        { method: 'POST', body: JSON.stringify({ reason }) }),
    // حفظٌ واحد: بيانات المريض + نوع الزيارة + الأولوية في ذرّةٍ واحدة
    saveAppointmentDetails: (appointmentId, body) =>
      http(`/clinic/appointments/${appointmentId}/details`,
        { method: 'PATCH', body: JSON.stringify(body) }),
    fixPatientData: (appointmentId, body) =>
      http(`/clinic/appointments/${appointmentId}/patient-data`,
        { method: 'PATCH', body: JSON.stringify(body) }),
    changePatient: (appointmentId, body) =>
      http(`/clinic/appointments/${appointmentId}/change-patient`,
        { method: 'POST', body: JSON.stringify(body) }),
    changeVisitType: (appointmentId, body) =>
      http(`/clinic/appointments/${appointmentId}/visit-type`,
        { method: 'PATCH', body: JSON.stringify(body) }),
    downgradePriority: (appointmentId, reason) =>
      http(`/clinic/appointments/${appointmentId}/priority`,
        { method: 'PATCH', body: JSON.stringify({ priority: 'normal', reason }) }),
    appointmentHistory: (appointmentId) =>
      http(`/clinic/appointments/${appointmentId}/history`),
    mySessions: (date) => http(`/clinic/my-sessions?date=${date}`),
    call: (appointmentId) => http(`/clinic/appointments/${appointmentId}/call`, { method: 'POST' }),
    done: (appointmentId) => http(`/clinic/appointments/${appointmentId}/done`, { method: 'POST' }),
    noShow: (appointmentId) => http(`/clinic/appointments/${appointmentId}/no-show`, { method: 'POST' }),
    recall: (appointmentId) => http(`/clinic/appointments/${appointmentId}/recall`, { method: 'POST' }),
    // ── «خروج مؤقت»: المريض يخرج (قطرة، صورة) ويعود بلا أن يخسر دوره ──
    // للطبيب صاحب الحجز ولمشرف العيادات (طوارئ). العودة نداءٌ على شاشة الصالة،
    // ويرفضها الخادم (409 DOCTOR_BUSY) والطبيب في منتصف كشف مريضٍ آخر.
    stepOut: (appointmentId) => http(`/clinic/appointments/${appointmentId}/step-out`, { method: 'POST' }),
    returnCall: (appointmentId) => http(`/clinic/appointments/${appointmentId}/return`, { method: 'POST' }),
    // ── نمط الحضور ──
    // بدء الكشف: منفصل عن النداء — يسجّل started_at وحده
    start: (appointmentId) => http(`/clinic/appointments/${appointmentId}/start`, { method: 'POST' }),
    // وصول الطبيب: مرة واحدة لجلسة اليوم، والتصحيح بوقت HH:MM يترك أثراً
    doctorArrived: (sessionId) => http(`/clinic/sessions/${sessionId}/doctor-arrived`, { method: 'POST' }),
    fixDoctorArrival: (sessionId, time) =>
      http(`/clinic/sessions/${sessionId}/doctor-arrived`, { method: 'PATCH', body: JSON.stringify({ time }) }),
    // تحويل نمط جلسة مولَّدة — لمشرف العيادات، وللجلسة الفارغة فقط (الخادم يرفض غيرها بـ 409)
    switchSessionMode: (sessionId, flowMode) =>
      http(`/clinic/sessions/${sessionId}/flow-mode`, { method: 'PATCH', body: JSON.stringify({ flow_mode: flowMode }) }),
    // ── إجراءات العيادة ──
    // الكتالوج: الاستقبال يتسلّم المفعَّل وحده من الخادم نفسه
    // forDoctor: ترشيح الكتالوج باختصاص دكتورٍ بعينه (الاستقبال يمرّره من الحجز).
    // والطبيب يُرشَّح باختصاصه هو في الخادم بلا معاملة.
    procedures: (forDoctor) =>
      http(`/clinic/procedures${forDoctor ? `?active=1&for_doctor=${forDoctor}` : ''}`),
    // ── الاختصاصات ──
    specialties: () => http('/clinic/specialties'),
    addSpecialty: (name) =>
      http('/clinic/specialties', { method: 'POST', body: JSON.stringify({ name }) }),
    setProcedureSpecialties: (id, body) =>
      http(`/clinic/procedures/${id}/specialties`, { method: 'PUT', body: JSON.stringify(body) }),
    addProcedure: (body) => http('/clinic/procedures', { method: 'POST', body: JSON.stringify(body) }),
    updateProcedure: (id, body) => http(`/clinic/procedures/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    // على الحجز: لا سعر يُرسَل — الخادم ينسخه من الكتالوج، ويحسب المواد والحصص لحظتها
    // materials: [{material_id, qty}]
    addAppointmentProcedure: (appointmentId, procedureId, materials = []) =>
      http(`/clinic/appointments/${appointmentId}/procedures`,
        { method: 'POST', body: JSON.stringify({ procedure_id: procedureId, materials }) }),
    // القائمة كاملةً تحلّ محلّ السابقة؛ legacy_materials للمشرف وحده
    setLineMaterials: (appointmentId, lineId, body) =>
      http(`/clinic/appointments/${appointmentId}/procedures/${lineId}/materials`,
        { method: 'PUT', body: JSON.stringify(body) }),
    removeAppointmentProcedure: (appointmentId, lineId, reason) =>
      http(`/clinic/appointments/${appointmentId}/procedures/${lineId}/remove`,
        { method: 'POST', body: JSON.stringify({ reason }) }),
    // تأجيل موعد إلى جلسة أخرى — ينشئ حجزاً جديداً ويُعلّم القديم «مؤجَّل»
    postpone: (appointmentId, body) =>
      http(`/clinic/appointments/${appointmentId}/postpone`, { method: 'POST', body: JSON.stringify(body) }),
    // جلسات يوم ما (لاختيار الجلسة الهدف عند التأجيل)
    sessions: (date) => http(`/clinic/sessions?date=${date}`),
    // دوامات يوم الأسبوع لتاريخٍ ما — تميّز «لا دوام» عن «دوامٌ لم تُولَّد جلساته»
    schedulesForDate: (date) => http(`/clinic/schedules/for-date?date=${encodeURIComponent(date)}`),
    // بلا مصادقة — الشاشة العامة وموقع المريض
    publicBoard: () => http('/public/clinic/board'),
    // رمز الجهاز يمرّ في الاستعلام: EventSource لا يقبل ترويسات مخصّصة
    displayStreamUrl: (key) => `/api/public/clinic/display-stream?key=${encodeURIComponent(key)}`,
    myTurn: (body) => http('/public/clinic/my-turn', { method: 'POST', body: JSON.stringify(body) }),
  },
  // المرفق الطبي لا يُفتح برابط مباشر — الرابط بلا توكن، والمجلد لم يعد مكشوفاً.
  // نجلبه هنا بالتوكن ثم نفتحه كـ blob محلي، فلا يمرّ ملف طبي أبداً بلا مصادقة.
  openAttachment: async (attachmentId) => {
    const res = await fetch(`/api/attachments/${attachmentId}/file`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || 'تعذّر فتح المرفق')
    }
    const url = URL.createObjectURL(await res.blob())
    window.open(url, '_blank', 'noopener')
    // نحرّر الذاكرة بعد أن يلتقط التبويب الجديد الرابط
    setTimeout(() => URL.revokeObjectURL(url), 60000)
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

  // ═══ مخزون المواد — مشرفة العيادات وحدها (الخادم يردّ 403 لغيرها) ═══
  inventory: {
    materials: () => http('/inventory/materials'),
    material: (id) => http(`/inventory/materials/${id}`),
    units: () => http('/inventory/units'),
    addMaterial: (body) => http('/inventory/materials', { method: 'POST', body: JSON.stringify(body) }),
    updateMaterial: (id, body) => http(`/inventory/materials/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    setPrice: (id, body) => http(`/inventory/materials/${id}/price`, { method: 'POST', body: JSON.stringify(body) }),
    prices: (id) => http(`/inventory/materials/${id}/prices`),
    movements: (id, page = 1, per = 20) => http(`/inventory/materials/${id}/movements?page=${page}&per=${per}`),
    purchase: (body) => http('/inventory/purchases', { method: 'POST', body: JSON.stringify(body) }),
    stocktakePreview: (items) => http('/inventory/stocktake/preview', { method: 'POST', body: JSON.stringify({ items }) }),
    stocktake: (items) => http('/inventory/stocktake', { method: 'POST', body: JSON.stringify({ items }) }),
    consumption: ({ from, to, group }) => http(`/inventory/reports/consumption?${new URLSearchParams({ from, to, group })}`),
    exportConsumption: ({ from, to, group }) => downloadFile(
      `/api/inventory/reports/consumption?${new URLSearchParams({ from, to, group, format: 'xlsx' })}`, `استهلاك المواد-${from}.xlsx`),
    purchases: ({ from, to }) => http(`/inventory/reports/purchases?${new URLSearchParams({ from, to })}`),
    exportPurchases: ({ from, to }) => downloadFile(
      `/api/inventory/reports/purchases?${new URLSearchParams({ from, to, format: 'xlsx' })}`, `المشتريات-${from}.xlsx`),
    template: () => downloadFile('/api/inventory/import/template', 'قالب استيراد المواد.xlsx'),
    importPreview: (file) => { const f = new FormData(); f.append('file', file); return postForm('/inventory/import/preview', f) },
    importCommit: (file, fingerprint) => {
      const f = new FormData(); f.append('fingerprint', fingerprint); f.append('file', file)
      return postForm('/inventory/import/commit', f)
    },
  },

  // ═══ الإشعارات داخل النظام — لكلّ مستخدمٍ ما وُجّه إليه ═══
  notifications: {
    list: () => http('/notifications'),
    read: (id) => http(`/notifications/${id}/read`, { method: 'POST' }),
    readAll: () => http('/notifications/read-all', { method: 'POST' }),
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
  manager: 'مدير (اطّلاع فقط)',
}

// شرح ما يفتحه كل دور — يُعرض تحت قائمة الأدوار في نموذج إنشاء الموظف
// كي يعرف المشرف ما الذي يمنحه فعلاً قبل أن يمنحه.
export const ROLE_DESCRIPTIONS = {
  officer: 'يُدخل العائلات والطلبات والمرفقات، ويصدر سندات الصرف، ويطابق كشوف الأمين.',
  accountant: 'الخزينة والإيرادات وأسعار الكتالوج وسندات الصرف ومطابقة الأمين.',
  board: 'يراجع الطلبات ويوصي عليها. المدير المسؤول وحده يتخذ القرار النهائي.',
  clinic_admin: 'الدكاترة وجداول الدوام وتوليد الجلسات والإعدادات، مع كامل لوحة العيادات.',
  clinic_reception: 'حجز المرضى وتسجيل الحضور وإدارة الدور اليومي.',
  doctor: 'شاشته الخاصة فقط: قائمة الدور في جلساته ونداء المرضى.',
  super_admin: 'يطالع كل شاشات النظام، ويدير الموظفين وأدوارهم والإعدادات.',
  manager: 'يطالع كل شاشات المساعدات والعيادات — بلا أي كتابة أو إضافة أو تعديل.',
}

// الحالة الاجتماعية — تُعرض حسب جنس الابن المشتقّ من العلاقة
export const MARITAL_STATUS = {
  single: { m: 'أعزب', f: 'عزباء' },
  married: { m: 'متزوج', f: 'متزوجة' },
  divorced: { m: 'مطلّق', f: 'مطلّقة' },
  widowed: { m: 'أرمل', f: 'أرملة' },
}
// نصّ الحالة حسب جنس الفرد (daughter → مؤنّث، غيره → مذكّر)
export const maritalLabel = (status, relation) =>
  status ? (MARITAL_STATUS[status]?.[relation === 'daughter' ? 'f' : 'm'] || status) : null

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
  waiting_return: 'بانتظار العودة',
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

// ═══ تحويل الأرقام العربية/الفارسية إلى لاتينية ═══
// يُستعمل في الإدخال ليرى الموظف **ما سيُخزَّن فعلاً** فور كتابته.
// ⚠️ وهذا عرضٌ لا حراسة: الخادم يطبّع أيضاً (normalizeMobile/normalizeBirthYear)،
// فأي مسار آخر — طلب مباشر أو تبويب قديم — يبقى محميّاً.
// التخزين لاتينيٌّ دائماً، وإلا انكسر البحث و ON CONFLICT (المقارنة نصّية).
export const toLatinDigits = (v) => String(v ?? '')
  .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
  .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))

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

// تاريخ ووقت — لسجل التعديلات (متى غُيّر الحقل بالضبط)
export const fmtDateTime = (d) =>
  d ? new Date(d).toLocaleString('ar-SY', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'

// ═══ بثّ الموظفين: «تغيّر شيءٌ في جلسة كذا» ═══
// يفتح /api/clinic/events ويستدعي onEvent(name, data) لكل حدث. بـ fetch لا EventSource:
// المسار مصادَق بتوكن الموظف في الترويسة، وEventSource لا يرسل ترويسات (والتوكن في
// العنوان يُسجَّل في سجلّات الوسطاء). يُعيد الاتصال وحده بتباعدٍ متزايد، ويُعيد دالّةً
// تُغلقه. والتحديث الدوري في الشاشة يبقى شبكة أمان لو انقطع البثّ صامتاً.
const STAFF_RETRY_MS = [2000, 5000, 15000, 30000]
export function openStaffStream(onEvent) {
  let closed = false, ctrl = null, timer = null, step = 0
  const parse = (frame) => {
    const ev = /^event: (.+)$/m.exec(frame)
    const data = /^data: (.+)$/m.exec(frame)
    if (!ev || !data) return
    try { onEvent(ev[1], JSON.parse(data[1])) } catch { /* إطارٌ تالف — التحديث الدوري يُصلح */ }
  }
  const connect = async () => {
    if (closed) return
    const token = getToken()
    if (!token || typeof ReadableStream === 'undefined' || typeof AbortController === 'undefined') return
    ctrl = new AbortController()
    try {
      const res = await fetch('/api/clinic/events', {
        headers: { Authorization: `Bearer ${token}` }, signal: ctrl.signal })
      // 401/403: لا معنى لإعادة المحاولة — التوكن انتهى أو الدور لا يملك القسم
      if (res.status === 401 || res.status === 403) return
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
      step = 0
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const frames = buf.split('\n\n')
        buf = frames.pop()
        frames.forEach(parse)
      }
    } catch { /* انقطاع — نعيد الاتصال أدناه */ }
    if (closed) return
    timer = setTimeout(connect, STAFF_RETRY_MS[Math.min(step++, STAFF_RETRY_MS.length - 1)])
  }
  connect()
  return () => { closed = true; clearTimeout(timer); if (ctrl) ctrl.abort() }
}
