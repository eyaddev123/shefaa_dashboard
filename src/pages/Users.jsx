import { useEffect, useState } from 'react'
import { api, ROLE_LABELS, ROLE_DESCRIPTIONS, fmtDate } from '../api.js'
import { useRole } from '../RoleContext.jsx'

// الأدوار التي يلزمها ربط بسجلّ خارجي — مرآة لقواعد الخادم
const NEEDS_BOARD_MEMBER = (role) => role === 'board'
const NEEDS_DOCTOR = (role) => role === 'doctor'

// ═══ نموذج إنشاء موظف ═══
// خطوة واحدة صريحة: هوية الدخول، ثم الدور، ثم الربط الذي يفرضه الدور.
function NewUserForm({ options, onCreated }) {
  const blank = {
    username: '', display_name: '', password: '', confirm: '',
    role: 'officer', board_member_id: '', doctor_id: '',
  }
  const [form, setForm] = useState(blank)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [done, setDone] = useState(null)

  const set = (k) => (e) => {
    const v = e.target.value
    setForm((f) => {
      // تبديل الدور يمسح ربطاً لم يعد يصحّ — الخادم يرفضه، فلا نتركه معلّقاً بالنموذج
      if (k === 'role') return { ...f, role: v, board_member_id: '', doctor_id: '' }
      return { ...f, [k]: v }
    })
    setErr(null); setDone(null)
  }

  const needsMember = NEEDS_BOARD_MEMBER(form.role)
  const needsDoctor = NEEDS_DOCTOR(form.role)
  const noMembersLeft = needsMember && options.boardMembers.length === 0
  const noDoctorsLeft = needsDoctor && options.doctors.length === 0

  const submit = async (e) => {
    e.preventDefault()
    if (form.password !== form.confirm) return setErr('كلمتا المرور غير متطابقتين')
    setBusy(true); setErr(null); setDone(null)
    try {
      await api.addUser({
        username: form.username.trim().toLowerCase(),
        display_name: form.display_name.trim(),
        password: form.password,
        role: form.role,
        board_member_id: needsMember ? form.board_member_id : null,
        doctor_id: needsDoctor ? form.doctor_id : null,
      })
      // نُبقي اسم المستخدم معروضاً للمشرف ليسلّمه مع كلمة المرور التي كتبها بنفسه
      setDone(form.username.trim().toLowerCase())
      setForm(blank)
      onCreated()
    } catch (ex) { setErr(ex.message) }
    finally { setBusy(false) }
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 14 }}>
      <div className="inline">
        <div className="field">
          <label>اسم المستخدم (للدخول)</label>
          <input value={form.username} onChange={set('username')} required
                 dir="ltr" style={{ textAlign: 'left' }}
                 placeholder="samer.y" pattern="[a-z0-9_.]{3,50}"
                 title="حروف إنجليزية صغيرة وأرقام و _ . فقط، 3 خانات فأكثر" />
        </div>
        <div className="field">
          <label>الاسم المعروض</label>
          <input value={form.display_name} onChange={set('display_name')} required
                 placeholder="أ. سامر يوسف" />
        </div>
        <div className="field">
          <label>كلمة المرور</label>
          <input type="password" value={form.password} onChange={set('password')}
                 required minLength={6} dir="ltr" style={{ textAlign: 'left' }} />
        </div>
        <div className="field">
          <label>تأكيد كلمة المرور</label>
          <input type="password" value={form.confirm} onChange={set('confirm')}
                 required minLength={6} dir="ltr" style={{ textAlign: 'left' }} />
        </div>
        <div className="field">
          <label>الدور</label>
          <select value={form.role} onChange={set('role')}>
            {options.roles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>)}
          </select>
        </div>

        {needsMember && (
          <div className="field">
            <label>عضو المجلس المرتبط</label>
            <select value={form.board_member_id} onChange={set('board_member_id')} required>
              <option value="">— اختر العضو —</option>
              {options.boardMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}{m.title ? ` — ${m.title}` : ''}{m.is_chairman ? ' (المدير المسؤول)' : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        {needsDoctor && (
          <div className="field">
            <label>الدكتور المرتبط</label>
            <select value={form.doctor_id} onChange={set('doctor_id')} required>
              <option value="">— اختر الدكتور —</option>
              {options.doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}{d.specialty ? ` — ${d.specialty}` : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        <button type="submit" disabled={busy || noMembersLeft || noDoctorsLeft}>
          {busy ? 'جارٍ الإنشاء…' : 'إنشاء الموظف'}
        </button>
      </div>

      <p className="setting-desc" style={{ marginTop: 8 }}>
        {ROLE_DESCRIPTIONS[form.role]}
      </p>

      {noMembersLeft && (
        <>
          <p className="error" style={{ marginBottom: 0 }}>
            لا يوجد عضو مجلس بلا حساب. أضف عضواً جديداً للمجلس ليمكن إنشاء حسابه:
          </p>
          <NewBoardMemberForm onCreated={onCreated} />
        </>
      )}
      {noDoctorsLeft && (
        <p className="error">
          كل الدكاترة الفعّالين لهم حسابات مسبقاً. أضف دكتوراً من صفحة «الدكاترة والدوام» أولاً.
        </p>
      )}
      {err && <p className="error">{err}</p>}
      {done && (
        <p className="badge good" style={{ marginTop: 8, display: 'inline-block' }}>
          أُنشئ الحساب «{done}». سلّم الموظف اسم المستخدم وكلمة المرور التي كتبتها —
          لا يمكن استرجاعها لاحقاً، إنما إعادة تعيينها.
        </p>
      )}
    </form>
  )
}

// ═══ إضافة عضو مجلس ═══
// يظهر عند اختيار دور «عضو المجلس» ولا يوجد عضو حرّ — بلا سجلّ عضو لا يمكن إنشاء حسابه،
// فيصير هذا الباب شرطاً لتشغيل مسار اعتماد الطلبات على قاعدة نظيفة.
function NewBoardMemberForm({ onCreated }) {
  const [name, setName] = useState('')
  const [title, setTitle] = useState('')
  const [isChairman, setIsChairman] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setErr(null)
    try {
      await api.addBoardMember({ name: name.trim(), title: title.trim(), is_chairman: isChairman })
      setName(''); setTitle(''); setIsChairman(false)
      onCreated()
    } catch (ex) { setErr(ex.message) }
    finally { setBusy(false) }
  }

  return (
    <form className="inline" onSubmit={submit} style={{ marginTop: 10 }}>
      <div className="field">
        <label>اسم عضو المجلس</label>
        <input value={name} onChange={(e) => { setName(e.target.value); setErr(null) }}
               required placeholder="د. محمد الخطيب" />
      </div>
      <div className="field">
        <label>الصفة (اختياري)</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="رئيس المجلس" />
      </div>
      <div className="field field-check" style={{ justifyContent: 'flex-end' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 400 }}>
          <input type="checkbox" checked={isChairman} style={{ width: 'auto' }}
                 onChange={(e) => setIsChairman(e.target.checked)} />
          المدير المسؤول (القرار النهائي)
        </label>
      </div>
      <button type="submit" disabled={busy} style={{ padding: '6px 14px', fontSize: 12.5 }}>
        {busy ? 'جارٍ…' : 'إضافة عضو المجلس'}
      </button>
      {err && <p className="error">{err}</p>}
    </form>
  )
}

// ═══ إعادة تعيين كلمة المرور ═══
function PasswordReset({ user, onDone }) {
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    if (pw !== confirm) return setErr('كلمتا المرور غير متطابقتين')
    setBusy(true); setErr(null)
    try {
      await api.resetPassword(user.id, pw)
      onDone(`تم تعيين كلمة مرور جديدة لـ ${user.display_name} — سلّمها له.`)
    } catch (ex) { setErr(ex.message) }
    finally { setBusy(false) }
  }

  return (
    <form className="inline" onSubmit={submit}>
      <div className="field">
        <label>كلمة المرور الجديدة</label>
        <input type="password" value={pw} onChange={(e) => { setPw(e.target.value); setErr(null) }}
               required minLength={6} dir="ltr" style={{ textAlign: 'left' }} autoFocus />
      </div>
      <div className="field">
        <label>تأكيدها</label>
        <input type="password" value={confirm} onChange={(e) => { setConfirm(e.target.value); setErr(null) }}
               required minLength={6} dir="ltr" style={{ textAlign: 'left' }} />
      </div>
      <button type="submit" disabled={busy} style={{ padding: '6px 14px', fontSize: 12.5 }}>
        {busy ? 'جارٍ…' : 'تعيين'}
      </button>
      <button type="button" className="ghost" onClick={() => onDone(null)}
              style={{ padding: '6px 14px', fontSize: 12.5 }}>إلغاء</button>
      {err && <p className="error">{err}</p>}
    </form>
  )
}

// ═══ تغيير دور موظف قائم ═══
// الدور وربطه يتغيران معاً — دور جديد بلا ربطه الصحيح يترك حساباً معطوباً
function RoleEditor({ user, options, onDone }) {
  const [role, setRole] = useState(user.role)
  const [memberId, setMemberId] = useState(user.board_member_id || '')
  const [doctorId, setDoctorId] = useState(user.doctor_id || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const needsMember = NEEDS_BOARD_MEMBER(role)
  const needsDoctor = NEEDS_DOCTOR(role)

  // الخيارات المتاحة = غير المرتبطين + ارتباط هذا الحساب نفسه (وإلا اختفى دوره الحالي من القائمة)
  const members = [
    ...options.boardMembers,
    ...(user.board_member_id && !options.boardMembers.some((m) => m.id === user.board_member_id)
      ? [{ id: user.board_member_id, name: user.board_member_name, title: user.member_title }] : []),
  ]
  const doctors = [
    ...options.doctors,
    ...(user.doctor_id && !options.doctors.some((d) => d.id === user.doctor_id)
      ? [{ id: user.doctor_id, name: user.doctor_name, specialty: user.doctor_specialty }] : []),
  ]

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setErr(null)
    try {
      await api.updateUser(user.id, {
        role,
        board_member_id: needsMember ? memberId : null,
        doctor_id: needsDoctor ? doctorId : null,
      })
      onDone(`تغيّر دور ${user.display_name} إلى «${ROLE_LABELS[role]}».`)
    } catch (ex) { setErr(ex.message) }
    finally { setBusy(false) }
  }

  return (
    <form className="inline" onSubmit={submit}>
      <div className="field">
        <label>الدور الجديد</label>
        <select value={role} onChange={(e) => {
          setRole(e.target.value); setMemberId(''); setDoctorId(''); setErr(null)
        }}>
          {options.roles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>)}
        </select>
      </div>
      {needsMember && (
        <div className="field">
          <label>عضو المجلس المرتبط</label>
          <select value={memberId} onChange={(e) => setMemberId(e.target.value)} required>
            <option value="">— اختر العضو —</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.name}{m.title ? ` — ${m.title}` : ''}</option>
            ))}
          </select>
        </div>
      )}
      {needsDoctor && (
        <div className="field">
          <label>الدكتور المرتبط</label>
          <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)} required>
            <option value="">— اختر الدكتور —</option>
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>{d.name}{d.specialty ? ` — ${d.specialty}` : ''}</option>
            ))}
          </select>
        </div>
      )}
      <button type="submit" disabled={busy} style={{ padding: '6px 14px', fontSize: 12.5 }}>
        {busy ? 'جارٍ…' : 'حفظ الدور'}
      </button>
      <button type="button" className="ghost" onClick={() => onDone(null)}
              style={{ padding: '6px 14px', fontSize: 12.5 }}>إلغاء</button>
      <p className="setting-desc" style={{ flexBasis: '100%', margin: '6px 0 0' }}>
        {ROLE_DESCRIPTIONS[role]}
      </p>
      {err && <p className="error">{err}</p>}
    </form>
  )
}

function UserRow({ user, options, onChanged, isSelf }) {
  const [panel, setPanel] = useState(null) // 'password' | 'role' | null

  const toggleActive = async () => {
    const verb = user.is_active ? 'إيقاف' : 'تفعيل'
    if (!confirm(`${verb} حساب ${user.display_name}؟`)) return
    try { await api.updateUser(user.id, { is_active: !user.is_active }); onChanged() }
    catch (ex) { alert(ex.message) }
  }

  const close = (msg) => { setPanel(null); if (msg) { onChanged(msg) } }
  const link = user.board_member_name || user.doctor_name

  return (
    <>
      <tr style={user.is_active ? undefined : { opacity: 0.5 }}>
        <td dir="ltr" style={{ textAlign: 'right' }}>{user.username}</td>
        <td>{user.display_name}{isSelf && <span className="badge" style={{ marginInlineStart: 6 }}>أنت</span>}</td>
        <td>
          {ROLE_LABELS[user.role] || user.role}
          {user.is_chairman && <span className="badge good" style={{ marginInlineStart: 6 }}>المدير المسؤول</span>}
        </td>
        <td>{link || '—'}</td>
        <td>{user.last_login_at ? fmtDate(user.last_login_at) : <span className="badge">لم يدخل بعد</span>}</td>
        <td>{user.is_active ? <span className="badge good">فعّال</span> : <span className="badge">موقوف</span>}</td>
        <td>
          {isSelf ? (
            // حساب المشرف العام لا يُعدَّل من هنا — وإلا أوقف نفسه فأُغلق الباب على النظام
            <span className="setting-desc">حسابك — لا يُعدَّل من هذه الشاشة</span>
          ) : (
            <>
              <button className="ghost" style={{ padding: '3px 10px', fontSize: 11.5 }}
                      onClick={() => setPanel(panel === 'role' ? null : 'role')}>الدور</button>{' '}
              <button className="ghost" style={{ padding: '3px 10px', fontSize: 11.5 }}
                      onClick={() => setPanel(panel === 'password' ? null : 'password')}>كلمة المرور</button>{' '}
              <button className="ghost" style={{ padding: '3px 10px', fontSize: 11.5 }}
                      onClick={toggleActive}>{user.is_active ? 'إيقاف' : 'تفعيل'}</button>
            </>
          )}
        </td>
      </tr>
      {panel && (
        <tr>
          <td colSpan={7} style={{ background: 'var(--bg-soft, rgba(0,0,0,0.02))' }}>
            {panel === 'password'
              ? <PasswordReset user={user} onDone={close} />
              : <RoleEditor user={user} options={options} onDone={close} />}
          </td>
        </tr>
      )}
    </>
  )
}

export default function Users() {
  const { user: me } = useRole()
  const [users, setUsers] = useState(null)
  const [options, setOptions] = useState(null)
  const [err, setErr] = useState(null)
  const [notice, setNotice] = useState(null)

  const load = (msg) => {
    if (typeof msg === 'string') setNotice(msg)
    return Promise.all([api.users(), api.userOptions()])
      .then(([u, o]) => { setUsers(u); setOptions(o) })
      .catch((e) => setErr(e.message))
  }
  useEffect(() => { load() }, [])

  if (err) return <p className="error">{err}</p>
  if (!users || !options) return <p className="empty">جارٍ التحميل…</p>

  const active = users.filter((u) => u.is_active).length

  return (
    <>
      <h2>الموظفون والصلاحيات</h2>
      <p className="subtitle">
        إنشاء حسابات الموظفين ومنح كلٍّ منهم دوره. الدور وحده يقرّر ما يراه الموظف وما يستطيع
        فعله — الفرض على الخادم، فإخفاء الرابط ليس اعتماداً عليه.
      </p>

      {notice && (
        <p className="badge good" style={{ display: 'inline-block', marginBottom: 12 }}>{notice}</p>
      )}

      <div className="card">
        <h3>إنشاء موظف جديد</h3>
        <NewUserForm options={options} onCreated={() => load()} />
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3>الحسابات ({active} فعّال من {users.length})</h3>
        <table style={{ marginTop: 10 }}>
          <thead>
            <tr>
              <th>اسم المستخدم</th><th>الاسم المعروض</th><th>الدور</th>
              <th>الربط</th><th>آخر دخول</th><th>الحالة</th><th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <UserRow key={u.id} user={u} options={options}
                       isSelf={u.id === me.id} onChanged={load} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
