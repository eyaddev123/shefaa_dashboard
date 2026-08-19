import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, AID_TYPES, INCOME_KINDS, SESSION_STATUSES, STATUSES, fmtDate, fmtMoney, fmtTime } from '../api.js'
import { useRole } from '../RoleContext.jsx'
import FinanceBar from '../components/FinanceBar.jsx'

function TreasuryTiles({ treasury }) {
  return (
    <div className="tiles">
      <div className="tile"><div className="label">الرصيد النقدي</div><div className="value" style={{ fontSize: 20 }}>{fmtMoney(treasury.cashBalance)}</div></div>
      <div className="tile"><div className="label">الالتزامات المعلقة</div><div className="value" style={{ fontSize: 20 }}>{fmtMoney(treasury.committedTotal)}</div><div className="hint">قرارات معتمدة لم تُصرف</div></div>
      <div className="tile">
        <div className="label">المتاح للقرارات الجديدة</div>
        <div className="value" style={{ fontSize: 20, color: treasury.available < 0 ? 'var(--status-bad)' : 'var(--status-good)' }}>
          {fmtMoney(treasury.available)}
        </div>
        <div className="hint"><Link className="plain" to="/treasury">تفاصيل الخزينة</Link></div>
      </div>
    </div>
  )
}

function Tiles({ d }) {
  return (
    <div className="tiles">
      <div className="tile"><div className="label">العائلات (الملفات)</div><div className="value">{d.families}</div></div>
      <div className="tile"><div className="label">الأفراد المسجّلون</div><div className="value">{d.persons}</div></div>
      <div className="tile"><div className="label">إجمالي الطلبات</div><div className="value">{d.requests}</div></div>
      <div className="tile">
        <div className="label">إجمالي المصروف</div>
        <div className="value" style={{ fontSize: 22 }}>{fmtMoney(d.vouchersTotal)}</div>
        <div className="hint">{d.vouchersCount} سند صرف</div>
      </div>
    </div>
  )
}

function StatusChart({ byStatus }) {
  const maxStatus = Math.max(1, ...byStatus.map((s) => s.n))
  return (
    <div className="card">
      <h3>الطلبات حسب حالة سير العمل</h3>
      <div className="barlist">
        {byStatus.map((s) => (
          <div className="row" key={s.status}>
            <span className="name">{STATUSES[s.status] || s.status}</span>
            <div className="track"><div className="fill" style={{ width: `${(s.n / maxStatus) * 100}%` }} /></div>
            <span className="num">{s.n}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function RequestRows({ rows, extra }) {
  const navigate = useNavigate()
  return (
    <table>
      <thead>
        <tr><th>الملف</th><th>رب العائلة</th><th>النوع</th><th>التاريخ</th>{extra && <th>{extra.header}</th>}</tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="clickable" onClick={() => navigate(`/requests/${r.id}`)}>
            <td className="num">{r.file_number} / طلب {r.request_no}</td>
            <td>{r.head_name}</td>
            <td>{AID_TYPES[r.aid_type]}</td>
            <td>{fmtDate(r.requested_at)}</td>
            {extra && <td>{extra.cell(r)}</td>}
          </tr>
        ))}
        {rows.length === 0 && <tr><td colSpan={extra ? 5 : 4} className="empty">لا شيء بانتظارك 🎉</td></tr>}
      </tbody>
    </table>
  )
}

export default function Dashboard() {
  const [d, setD] = useState(null)
  const [err, setErr] = useState(null)
  const { user, isChairman } = useRole()

  useEffect(() => { api.dashboard().then(setD).catch((e) => setErr(e.message)) }, [])

  if (err) return <p className="error">تعذّر تحميل اللوحة: {err}</p>
  if (!d) return <p className="empty">جارٍ التحميل…</p>

  // ═══ لوحة موظف الإدخال ═══
  if (d.view === 'officer') {
    return (
      <>
        <h2>لوحة القيادة — موظف الإدخال</h2>
        <p className="subtitle">أهلاً {user.display_name}</p>
        <Tiles d={d} />
        <div className="tiles">
          <div className="tile alert">
            <div className="label">طلبات بلا مرفقات</div>
            <div className="value">{d.missingAttachments}</div>
            <div className="hint">أكمل صور التقارير والوصفات</div>
          </div>
          <div className="tile alert">
            <div className="label">معتمدة لم تُطابَق مع الأمين</div>
            <div className="value">{d.awaitingFulfillment}</div>
            <div className="hint"><Link className="plain" to="/reconciliation">صفحة المطابقة</Link></div>
          </div>
        </div>
        <div className="grid2">
          <div className="card">
            <h3>آخر الطلبات المُدخلة</h3>
            <RequestRows rows={d.recentRequests} extra={{ header: 'الحالة', cell: (r) => <span className="badge">{STATUSES[r.status]}</span> }} />
          </div>
          <StatusChart byStatus={d.byStatus} />
        </div>
      </>
    )
  }

  // ═══ لوحة المحاسب ═══
  if (d.view === 'accountant') {
    return (
      <>
        <h2>لوحة القيادة — المحاسب</h2>
        <p className="subtitle">أهلاً {user.display_name}</p>

        <div className="card">
          <h3>الوضع المالي</h3>
          <FinanceBar treasury={d.treasury} />
        </div>
        <TreasuryTiles treasury={d.treasury} />

        <div className="tiles">
          <div className="tile"><div className="label">إجمالي الإيرادات</div><div className="value" style={{ fontSize: 20 }}>{fmtMoney(d.treasury.incomeTotal)}</div></div>
          <div className="tile"><div className="label">إجمالي المصروف</div><div className="value" style={{ fontSize: 20 }}>{fmtMoney(d.treasury.spentTotal)}</div><div className="hint">{d.vouchersCount} سند صرف</div></div>
          <div className="tile alert">
            <div className="label">معتمدة لم تُطابَق مع الأمين</div>
            <div className="value">{d.awaitingFulfillment}</div>
            <div className="hint"><Link className="plain" to="/reconciliation">صفحة المطابقة</Link></div>
          </div>
        </div>

        <div className="grid2">
          <div className="card">
            <h3>آخر الإيرادات المسجّلة</h3>
            <table>
              <thead><tr><th>النوع</th><th>الجهة</th><th>المبلغ</th><th>التاريخ</th></tr></thead>
              <tbody>
                {d.recentIncome.map((e) => (
                  <tr key={e.id}>
                    <td><span className="badge blue">{INCOME_KINDS[e.kind] || e.kind}</span></td>
                    <td>{e.source_name}</td>
                    <td className="num">{fmtMoney(e.amount)}</td>
                    <td>{fmtDate(e.received_at)}</td>
                  </tr>
                ))}
                {d.recentIncome.length === 0 && <tr><td colSpan={4} className="empty">لا إيرادات بعد</td></tr>}
              </tbody>
            </table>
          </div>
          <StatusChart byStatus={d.byStatus} />
        </div>
      </>
    )
  }

  // ═══ لوحة إدارة/استقبال العيادات ═══
  if (d.view === 'clinic_admin') {
    return (
      <>
        <h2>لوحة القيادة — العيادات</h2>
        <p className="subtitle">أهلاً {user.display_name}</p>
        <div className="tiles">
          <div className="tile"><div className="label">الدكاترة الفعّالون</div><div className="value">{d.doctorsCount}</div></div>
          <div className="tile">
            <div className="label">جلسات اليوم</div>
            <div className="value">{d.todaySessions.length}</div>
            <div className="hint"><Link className="plain" to="/clinic/board">لوحة العيادات اليومية</Link></div>
          </div>
        </div>
        <div className="card">
          <h3>جلسات اليوم</h3>
          <table>
            <thead><tr><th>الوقت</th><th>الدكتور</th><th>الحالة</th><th>الطابور النشط</th></tr></thead>
            <tbody>
              {d.todaySessions.map((s) => (
                <tr key={s.id}>
                  <td className="num">{fmtTime(s.start_time)}</td>
                  <td>{s.doctor_name}</td>
                  <td><span className="badge">{SESSION_STATUSES[s.status] || s.status}</span></td>
                  <td className="num">{s.active_count}</td>
                </tr>
              ))}
              {d.todaySessions.length === 0 && <tr><td colSpan={4} className="empty">لا جلسات اليوم بعد</td></tr>}
            </tbody>
          </table>
        </div>
      </>
    )
  }

  // ═══ لوحة الدكتور ═══
  if (d.view === 'doctor') {
    return (
      <>
        <h2>لوحة القيادة — {user.display_name}</h2>
        <p className="subtitle">جلساتك اليوم</p>
        <div className="card">
          <table>
            <thead><tr><th>الوقت</th><th>الحالة</th><th>الطابور النشط</th></tr></thead>
            <tbody>
              {d.mySessions.map((s) => (
                <tr key={s.id}>
                  <td className="num">{fmtTime(s.start_time)} – {fmtTime(s.end_time)}</td>
                  <td><span className="badge">{SESSION_STATUSES[s.status] || s.status}</span></td>
                  <td className="num">{s.active_count}</td>
                </tr>
              ))}
              {d.mySessions.length === 0 && <tr><td colSpan={3} className="empty">لا جلسات لك اليوم</td></tr>}
            </tbody>
          </table>
          {d.mySessions.length > 0 && (
            <p style={{ marginTop: 14 }}><Link className="plain" to="/clinic/doctor">فتح شاشة الدكتور</Link></p>
          )}
        </div>
      </>
    )
  }

  // ═══ لوحة المشرف العام — نظرة شاملة على القسمين معاً وحالة الحسابات ═══
  // فرع مستقل قبل لوحة المجلس: تلك تفترض طابور مراجعة وعضوية مجلس، والمشرف بلا أيّهما.
  if (d.view === 'super_admin') {
    const u = d.users || {}
    return (
      <>
        <h2>لوحة القيادة — المشرف العام</h2>
        <p className="subtitle">
          أهلاً {user.display_name} — تطالع كل شاشات النظام، وتدير الموظفين وأدوارهم.
        </p>
        <Tiles d={d} />
        {d.treasury && <TreasuryTiles treasury={d.treasury} />}

        <div className="card highlight">
          <h3>👥 الحسابات — {u.active || 0} فعّال من {u.total || 0}</h3>
          <div className="tiles">
            <div className="tile"><div className="label">فعّال</div><div className="value">{u.active || 0}</div></div>
            <div className="tile"><div className="label">موقوف</div><div className="value">{u.suspended || 0}</div></div>
            <div className="tile">
              <div className="label">لم يسجّل دخوله بعد</div>
              <div className="value">{u.never_logged_in || 0}</div>
            </div>
          </div>
          <p style={{ marginTop: 14 }}>
            <Link className="plain" to="/users">إدارة الموظفين والصلاحيات</Link>
          </p>
        </div>

        <div className="card">
          <h3>🏥 العيادات اليوم — {d.todaySessions?.length || 0} جلسة / {d.doctorsCount || 0} طبيب فعّال</h3>
          <table>
            <thead><tr><th>الطبيب</th><th>البداية</th><th>الحالة</th><th>بالانتظار</th></tr></thead>
            <tbody>
              {(d.todaySessions || []).map((s) => (
                <tr key={s.id}>
                  <td>{s.doctor_name}</td>
                  <td>{fmtTime(s.start_time)}</td>
                  <td><span className="badge">{SESSION_STATUSES[s.status] || s.status}</span></td>
                  <td className="num">{s.active_count}</td>
                </tr>
              ))}
              {!d.todaySessions?.length && <tr><td colSpan={4} className="empty">لا جلسات اليوم بعد</td></tr>}
            </tbody>
          </table>
        </div>

        <StatusChart byStatus={d.byStatus} />
      </>
    )
  }

  // ═══ لوحة عضو المجلس / المدير المسؤول ═══
  return (
    <>
      <h2>لوحة القيادة — {isChairman ? 'المدير المسؤول' : 'عضو مجلس الإدارة'}</h2>
      <p className="subtitle">أهلاً {user.display_name} — سجّلت حتى الآن {d.myReviewsCount} مراجعة</p>
      <Tiles d={d} />
      {d.treasury && <TreasuryTiles treasury={d.treasury} />}

      <div className="card highlight">
        <h3>🔔 بانتظار مراجعتك — {d.myQueue.length} طلب</h3>
        <RequestRows rows={d.myQueue}
          extra={{ header: 'تقدّم المراجعات', cell: (r) => <span className="num">{r.reviews_count} / 5</span> }} />
      </div>

      {isChairman && (
        <div className="card highlight chairman">
          <h3>⚖️ جاهزة لقرارك النهائي — اكتملت المراجعات الخمس</h3>
          <RequestRows rows={d.readyForDecision || []}
            extra={{ header: 'الموافقات', cell: (r) => <span className="num">{r.approvals_count} / {r.reviews_count} موافق</span> }} />
        </div>
      )}

      {/* نبذة العيادات — المجلس يطالع فقط، والتفاصيل في لوحة العيادات اليومية */}
      <div className="card">
        <h3>🏥 العيادات اليوم — {d.todaySessions?.length || 0} جلسة / {d.doctorsCount || 0} طبيب فعّال</h3>
        <table>
          <thead><tr><th>الطبيب</th><th>البداية</th><th>الحالة</th><th>بالانتظار</th></tr></thead>
          <tbody>
            {(d.todaySessions || []).map((s) => (
              <tr key={s.id}>
                <td>{s.doctor_name}</td>
                <td>{s.start_time}</td>
                <td>{s.status}</td>
                <td className="num">{s.active_count}</td>
              </tr>
            ))}
            {!d.todaySessions?.length && <tr><td colSpan={4} className="empty">لا جلسات اليوم بعد</td></tr>}
          </tbody>
        </table>
      </div>

      <StatusChart byStatus={d.byStatus} />
    </>
  )
}
