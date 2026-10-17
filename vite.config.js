import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import legacy from '@vitejs/plugin-legacy'

// شاشة الصالة تلفازُ أندرويد بمتصفّحٍ مدمج قديم. حزمةُ Vite الافتراضية
// (هدف 'modules') تَخرج بـ `??` و`?.` — ومصدرُها React نفسها لا شيفرتنا — فيعجز
// المتصفّح القديم عن **تحليلها** فيموت السكربت قبل أوّل سطر: صفحةٌ بيضاء بعنوانٍ
// سليم (العنوان من HTML لا من JS). وأسوأ منه أنّ `<script type="module">` تتجاهله
// تلك المتصفّحاتُ بصمتٍ تامّ بلا خطأ أصلاً.
//
// plugin-legacy يحلّ الاثنين: يُنزِل الصياغة إلى ES5 ويُخرج نسخةً ثانية بـ
// `nomodule` مع polyfills، فالمتصفّحُ الحديث يأخذ الحزمة الحديثة (بلا بطء)
// والقديمُ يأخذ البديل.
export default defineConfig({
  plugins: [
    react(),
    legacy({
      // أندرويد ٥–٧ (WebView 4.4+) تغطّي تلفازات الصالة وأجهزةَ الاستقبال القديمة
      targets: ['defaults', 'Android >= 5', 'Chrome >= 49', 'not IE 11'],
      // الصياغةُ وحدَها لا تكفي: الحزمةُ القديمة تحتاج Promise/Map/Set وغيرها
      additionalLegacyPolyfills: ['regenerator-runtime/runtime'],
      renderLegacyChunks: true,
    }),
  ],
  // لا نضبط build.target هنا: plugin-legacy يملكه (يُخرج حزمتين — حديثةً
  // وأخرى ES5 بـ nomodule)، وضبطُه يدوياً يُطلق تحذيراً ويُتجاهَل.
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
      '/uploads': 'http://localhost:4000',
    },
  },
})
