import { useState } from 'react'

// حقل كلمة مرور بزرّ إظهار/إخفاء.
// يلزم في شاشة الموظفين خاصةً: المشرف يكتب كلمة مرور ليسلّمها لغيره، فلا بدّ
// أن يراها ليتأكد منها. وفي الدخول يكشف الخطأ المطبعي بدل تكرار المحاولة.
//
// الزرّ type="button" — بدونها يُعدّ زرّ إرسال داخل <form> فيُرسل النموذج عند الضغط.
const EyeOpen = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" />
  </svg>
)

const EyeOff = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19M6.61 6.61A18.4 18.4 0 0 0 2 11s3.5 7 10 7a9.1 9.1 0 0 0 5.39-1.61" />
    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" /><line x1="2" y1="2" x2="22" y2="22" />
  </svg>
)

export default function PasswordInput({ value, onChange, ...rest }) {
  const [shown, setShown] = useState(false)
  return (
    <div className="password-wrap">
      <input
        {...rest}
        type={shown ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        dir="ltr"
        style={{ textAlign: 'left', ...(rest.style || {}) }}
      />
      <button
        type="button"
        className="password-eye"
        onClick={() => setShown((v) => !v)}
        aria-label={shown ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
        title={shown ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
        tabIndex={-1}
      >
        {shown ? EyeOff : EyeOpen}
      </button>
    </div>
  )
}
