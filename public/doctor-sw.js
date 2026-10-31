// عامل خدمة شاشة الطبيب — إشعار «مريض جديد بالانتظار» وحده (doctor-alert.js في الخادم).
// لا تخزين ولا اعتراض طلبات: لا fetch handler عمداً، فلا يمسّ تحميل النظام ولا شاشة الصالة.
// الحمولة بلا مبلغ ولا تفصيل طبي: { title, body, tag, url }.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch (e) { data = {} }
  const title = data.title || 'مريض جديد بالانتظار'
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    tag: data.tag || 'idle-arrival',
    renotify: true,
    dir: 'rtl',
    lang: 'ar',
    vibrate: [220, 120, 220],
    data: { url: data.url || '/clinic/doctor' },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/clinic/doctor'
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if (c.url.indexOf('/clinic/doctor') !== -1 && 'focus' in c) return c.focus()
    }
    return self.clients.openWindow ? self.clients.openWindow(url) : undefined
  }))
})
