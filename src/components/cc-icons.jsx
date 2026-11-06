// أيقونات لوحة القيادة — مجموعةٌ واحدة بخطّ أيقونات الشريط الجانبي نفسه (لا رموز تعبيرية)
const svg = (...children) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
)
const p = (d) => <path key={d} d={d} />
const c = (cx, cy, r) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} />

export const CC = {
  calendar: svg(p('M8 2v4M16 2v4M3 10h18'), <rect key="r" x="3" y="4" width="18" height="18" rx="2" />),
  users: svg(p('M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'), c(9, 7, 4), p('M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75')),
  syringe: svg(p('m18 2 4 4M17 7l3-3M19 9 8.7 19.3a1 1 0 0 1-1.4 0l-3.6-3.6a1 1 0 0 1 0-1.4L14 4M9 11l4 4M5 19l-3 3M14 4l6 6')),
  userX: svg(p('M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'), c(9, 7, 4), p('m17 8 5 5M22 8l-5 5')),
  wallet: svg(p('M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V5'), p('M16 14h.01')),
  coins: svg(c(8, 8, 6), p('M18.09 10.37A6 6 0 1 1 10.34 18M7 6h1v4M16.71 13.88l.7.71-2.82 2.82')),
  bell: svg(p('M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9'), p('M10.3 21a1.94 1.94 0 0 0 3.4 0')),
  box: svg(p('M21 8 12 3 3 8v8l9 5 9-5z'), p('m3 8 9 5 9-5M12 13v8')),
  receipt: svg(p('M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1z'), p('M8 8h8M8 12h8M8 16h5')),
  logout: svg(p('M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9')),
  check: svg(c(12, 12, 10), p('m8 12 3 3 5-6')),
  star: svg(p('m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z')),
  award: svg(c(12, 8, 6), p('M15.5 13 17 22l-5-3-5 3 1.5-9')),
  clock: svg(c(12, 12, 10), p('M12 6v6l4 2')),
  eye: svg(p('M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7'), c(12, 12, 3)),
}
