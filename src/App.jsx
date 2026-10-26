import { useEffect, useState } from 'react'
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { RoleProvider, useRole } from './RoleContext.jsx'
import {
  canManageUsers, canReadAid, canSearchAid, canSeeClinicBoard, canSeeCashReport, canSeeDoctorsPage,
  canSeeDoctorScreen, canSeeSettings, canSeeProceduresPage, canSeePrinterSetup, canSeeInventory, canSeeReferralsPage, homePathFor,
} from './permissions.js'
import { ROLE_LABELS } from './api.js'
import ThemeToggle from './components/ThemeToggle.jsx'
import NotificationsBell from './components/NotificationsBell.jsx'
import Login from './pages/Login.jsx'
import Search from './pages/Search.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Families from './pages/Families.jsx'
import FamilyDetail from './pages/FamilyDetail.jsx'
import NewFamily from './pages/NewFamily.jsx'
import PersonDetail from './pages/PersonDetail.jsx'
import Requests from './pages/Requests.jsx'
import NewRequest from './pages/NewRequest.jsx'
import RequestDetail from './pages/RequestDetail.jsx'
import Vouchers from './pages/Vouchers.jsx'
import Reconciliation from './pages/Reconciliation.jsx'
import Treasury from './pages/Treasury.jsx'
import Catalog from './pages/Catalog.jsx'
import ClinicDoctors from './pages/ClinicDoctors.jsx'
import DoctorProfile from './pages/DoctorProfile.jsx'
import DataQuality from './pages/DataQuality.jsx'
import Settings from './pages/Settings.jsx'
import PrinterSetup from './pages/PrinterSetup.jsx'
import Users from './pages/Users.jsx'
import ClinicBoard from './pages/ClinicBoard.jsx'
import CashReport from './pages/CashReport.jsx'
import ClinicReferrals from './pages/ClinicReferrals.jsx'
import ClinicProcedures from './pages/ClinicProcedures.jsx'
import Inventory from './pages/Inventory.jsx'
import SessionQueue from './pages/SessionQueue.jsx'
import VisitPage from './pages/VisitPage.jsx'
import DoctorScreen from './pages/DoctorScreen.jsx'
import PublicDisplay from './pages/PublicDisplay.jsx'
import OrderDisplay from './pages/OrderDisplay.jsx'
import PatientTurn from './pages/PatientTurn.jsx'

const I = {
  home: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  requests: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M9 12h6M9 16h6"/></svg>,
  families: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  vouchers: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1z"/><path d="M8 7h8M8 12h8M8 17h5"/></svg>,
  sync: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>,
  search: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>,
  treasury: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><path d="M12 12v4M10 14h4"/></svg>,
  catalog: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M12 7v6M9 10h6"/></svg>,
  clinic: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20M2 12h20"/><circle cx="12" cy="12" r="10"/></svg>,
  users: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></svg>,
  quality: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/></svg>,
  inventory: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/></svg>,
  settings: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
}

function SidebarSearch() {
  const [q, setQ] = useState('')
  const navigate = useNavigate()
  const submit = (e) => {
    e.preventDefault()
    if (q.trim().length >= 2) {
      navigate(`/search?q=${encodeURIComponent(q.trim())}`)
      setQ('')
    }
  }
  return (
    <form className="sidebar-search" onSubmit={submit}>
      {I.search}
      <input value={q} onChange={(e) => setQ(e.target.value)}
             placeholder="بحث: اسم / جوال / رقم…" aria-label="بحث" />
    </form>
  )
}

function Sidebar({ onNavigate }) {
  const { user, role, isChairman, logout } = useRole()
  const aid = canReadAid(role)
  return (
    <aside className="sidebar" onClick={(e) => {
      // أي نقرة على رابط داخل الدرج تُغلقه — الجوال لا يحتمل قائمة تغطي الشاشة بعد الانتقال
      if (onNavigate && e.target.closest('a')) onNavigate()
    }}>
      <div className="brand">
        <div className="brand-logo">🏥</div>
        <div>
          <h1>جمعية الشفاء الخيرية</h1>
          <p>إدارة حالات المساعدة الطبية</p>
        </div>
      </div>

      <div className="user-box">
        <div className="user-name">{user.display_name}</div>
        <div className="user-role">
          {isChairman ? 'المدير المسؤول — قرار نهائي' : user.member_title || ROLE_LABELS[role]}
        </div>
        {/* الإشعارات اليوم للمخزون وحده — فتظهر لمن يتسلّمها */}
        {canSeeInventory(role) && <NotificationsBell />}
        <button className="logout" onClick={logout}>تسجيل الخروج</button>
      </div>

      {/* البحث الموحّد يمسح العائلات والطلبات — لا يُعرض لطاقم العيادات.
          الاستقبال يبحث عن مريضه داخل صفحة الحجز نفسها */}
      {canSearchAid(role) && <SidebarSearch />}

      <nav>
        <NavLink to="/" end>{I.home} لوحة القيادة</NavLink>
        {aid && <NavLink to="/requests">{I.requests} الطلبات</NavLink>}
        {aid && <NavLink to="/families">{I.families} العائلات (الملفات)</NavLink>}
        {aid && <NavLink to="/data-quality">{I.quality} مراجعة البيانات</NavLink>}
        {aid && <NavLink to="/vouchers">{I.vouchers} سندات الصرف</NavLink>}
        {aid && <NavLink to="/treasury">{I.treasury} الخزينة والإيرادات</NavLink>}
        {aid && <NavLink to="/catalog">{I.catalog} الأسعار الطبية</NavLink>}
        {(role === 'officer' || role === 'accountant') && <NavLink to="/reconciliation">{I.sync} مطابقة الأمين</NavLink>}
        {/* العيادات: اليوميّ أولاً، ثمّ الإدارة الأسبوعية (صفحاتها الثلاث متتالية)، ثمّ
            المخزون، والإعدادات في الذيل. الترتيب وحده — من يرى ماذا لم يتغيّر. */}
        {canSeeClinicBoard(role) && <NavLink to="/clinic/board">{I.clinic} لوحة العيادات اليومية</NavLink>}
        {canSeeDoctorScreen(role) && <NavLink to="/clinic/doctor">{I.clinic} شاشتي</NavLink>}
        {canSeeDoctorsPage(role) && <NavLink to="/clinic/doctors">{I.clinic} العيادات — الدكاترة والدوام</NavLink>}
        {canSeeProceduresPage(role) && <NavLink to="/clinic/procedures">{I.clinic} العيادات — الإجراءات</NavLink>}
        {canSeeReferralsPage(role) && <NavLink to="/clinic/referrals">{I.clinic} العيادات — الإحالات</NavLink>}
        {canSeeInventory(role) && <NavLink to="/inventory">{I.inventory} المخزون</NavLink>}
        {canManageUsers(role) && <NavLink to="/users">{I.users} الموظفون والصلاحيات</NavLink>}
        {canSeePrinterSetup(role) && <NavLink to="/clinic/printer">{I.settings} إعداد الطابعة</NavLink>}
        {canSeeSettings(role) && <NavLink to="/settings">{I.settings} الإعدادات</NavLink>}
      </nav>

      {/* nav صار هو الممتدّ (flex: 1) فيدفع هذا للأسفل — لا حاجة لـ marginTop: auto،
          وهي كانت تُخرجه خارج الشاشة حين يطول المنيو */}
      <div style={{ paddingTop: 14, flexShrink: 0 }}>
        <ThemeToggle />
      </div>
    </aside>
  )
}

// حارس المسار: يعيد التوجيه لأول صفحة مسموحة بدل عرض صفحة ممنوعة أو بيضاء
function Guard({ allow, children }) {
  const { role } = useRole()
  if (!allow(role)) return <Navigate to={homePathFor(role)} replace />
  return children
}

// شريط علوي يظهر على الجوال/التابلت فقط — يفتح الشريط الجانبي كدرج منزلق
function TopBar({ onOpen, open }) {
  return (
    <header className="topbar">
      <button className="topbar-burger" onClick={onOpen}
              aria-label="فتح القائمة" aria-expanded={open}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
             strokeLinecap="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
      </button>
      <div className="topbar-title">
        <span className="topbar-logo">🏥</span>
        <span>جمعية الشفاء الخيرية</span>
      </div>
    </header>
  )
}

function Shell() {
  const { user, loading, role } = useRole()
  const [drawer, setDrawer] = useState(false)
  const { pathname } = useLocation()

  // تبديل الصفحة يغلق الدرج ولو تمّ من زر رجوع المتصفح لا من رابط داخل القائمة
  useEffect(() => { setDrawer(false) }, [pathname])

  // منع تمرير الصفحة خلف الدرج المفتوح — وإلا انزلق المحتوى تحت القائمة على الجوال
  useEffect(() => {
    if (!drawer) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e) => { if (e.key === 'Escape') setDrawer(false) }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [drawer])

  if (loading) return <p className="empty" style={{ padding: 40 }}>جارٍ التحميل…</p>
  if (!user) return <Login />
  const aid = (el) => <Guard allow={canReadAid}>{el}</Guard>
  return (
    <div className={`layout ${drawer ? 'drawer-open' : ''}`}>
      <TopBar onOpen={() => setDrawer(true)} open={drawer} />
      {/* الحجاب يغلق الدرج باللمس خارجه — سلوك متوقَّع على الجوال */}
      <div className="drawer-scrim" onClick={() => setDrawer(false)} aria-hidden="true" />
      <Sidebar onNavigate={() => setDrawer(false)} />
      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/requests" element={aid(<Requests />)} />
          <Route path="/requests/new" element={aid(<NewRequest />)} />
          <Route path="/requests/:id" element={aid(<RequestDetail />)} />
          <Route path="/families" element={aid(<Families />)} />
          <Route path="/families/new" element={aid(<NewFamily />)} />
          <Route path="/families/:id" element={aid(<FamilyDetail />)} />
          <Route path="/persons/:id" element={aid(<PersonDetail />)} />
          <Route path="/data-quality" element={aid(<DataQuality />)} />
          <Route path="/vouchers" element={aid(<Vouchers />)} />
          <Route path="/treasury" element={aid(<Treasury />)} />
          <Route path="/catalog" element={aid(<Catalog />)} />
          <Route path="/reconciliation" element={
            <Guard allow={(r) => r === 'officer' || r === 'accountant'}><Reconciliation /></Guard>} />
          <Route path="/clinic/doctors" element={
            <Guard allow={canSeeDoctorsPage}><ClinicDoctors /></Guard>} />
          <Route path="/clinic/doctors/:id" element={
            <Guard allow={canSeeDoctorsPage}><DoctorProfile /></Guard>} />
          <Route path="/clinic/procedures" element={
            <Guard allow={canSeeProceduresPage}><ClinicProcedures /></Guard>} />
          <Route path="/inventory" element={
            <Guard allow={canSeeInventory}><Inventory /></Guard>} />
          <Route path="/clinic/referrals" element={
            <Guard allow={canSeeReferralsPage}><ClinicReferrals /></Guard>} />
          <Route path="/clinic/board" element={
            <Guard allow={canSeeClinicBoard}><ClinicBoard /></Guard>} />
          <Route path="/clinic/cash-report" element={
            <Guard allow={canSeeCashReport}><CashReport /></Guard>} />
          <Route path="/clinic/session/:id" element={
            <Guard allow={canSeeClinicBoard}><SessionQueue /></Guard>} />
          {/* صفحة الزيارة: بحارس الطابور نفسه — من لا يرى الطابور (الطبيب) لا يرى تفاصيل زيارته */}
          <Route path="/clinic/session/:sessionId/visit/:id" element={
            <Guard allow={canSeeClinicBoard}><VisitPage /></Guard>} />
          <Route path="/clinic/doctor" element={
            <Guard allow={canSeeDoctorScreen}><DoctorScreen /></Guard>} />
          <Route path="/users" element={
            <Guard allow={canManageUsers}><Users /></Guard>} />
          <Route path="/settings" element={
            <Guard allow={canSeeSettings}><Settings /></Guard>} />
          <Route path="/clinic/printer" element={
            <Guard allow={canSeePrinterSetup}><PrinterSetup /></Guard>} />
          <Route path="/search" element={<Guard allow={canSearchAid}><Search /></Guard>} />
          <Route path="*" element={<Navigate to={homePathFor(role)} replace />} />
        </Routes>
      </main>
    </div>
  )
}

const PUBLIC_PATHS = ['/display', '/order', '/my-turn']

// الصفحتان العامتان (شاشة التابلت وموقع المريض) بلا مصادقة إطلاقاً — تُلتقطان
// قبل RoleProvider/Shell كي لا تُفرض عليهما شاشة تسجيل الدخول أو الشريط الجانبي
function Root() {
  const { pathname } = useLocation()
  if (PUBLIC_PATHS.includes(pathname)) {
    return (
      <Routes>
        <Route path="/display" element={<PublicDisplay />} />
        {/* الشاشة الثانية: ترتيب الدور كاملاً — بلا صوت، ونفس حارس الرمز */}
        <Route path="/order" element={<OrderDisplay />} />
        <Route path="/my-turn" element={<PatientTurn />} />
      </Routes>
    )
  }
  return (
    <RoleProvider>
      <Shell />
    </RoleProvider>
  )
}

export default function App() {
  return <Root />
}
