import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import legacy from '@vitejs/plugin-legacy'

// ═══ شاشة الصالة: تلفاز أندرويد ٩ بـ WebView/Chrome 66 ═══
//
// الدرس الذي كلّفنا جولةً كاملة: Chrome 66 **يدعم** `type="module"`، فيأخذ
// الحزمة **الحديثة** ولا يمسّ حزمة `nomodule` إطلاقاً. فحزمةُ ES5 وحدَها لا
// تُنقذه — المتصفّح لا يطلبها أصلاً.
//
// وهو يحلّل الصياغةَ الحديثة بلا عناء، لكنّه يفتقر **دوالَّ** أحدثَ منه:
// Object.fromEntries (Chrome 73) وPromise.prototype.finally (Chrome 63+)
// وsغيرهما. فيُحمَّل الملفّ ويُحلَّل ثمّ يموت عند أوّل نداء:
//   Uncaught TypeError: Object.fromEntries is not a function
// وهذا ما صوّرناه على الشاشة فعلاً.
//
// لذلك نحتاج **الاثنين معاً**:
//   modernPolyfills — يحقن الدوالّ الناقصة في الحزمة الحديثة نفسها (حسب
//                      الاستعمال الفعليّ، فلا تنتفخ الحزمة بلا داع)
//   targets للحزمة القديمة — تبقى لمن لا يفهم module أصلاً
export default defineConfig({
  plugins: [
    react(),
    legacy({
      // الحزمة القديمة (nomodule): لمن لا يدعم ES modules إطلاقاً
      targets: ['defaults', 'Android >= 5', 'Chrome >= 49', 'not IE 11'],
      additionalLegacyPolyfills: ['regenerator-runtime/runtime'],
      renderLegacyChunks: true,
      // ═══ المفتاح ═══
      // `true` = اكتشافٌ حسب الاستعمال: يفحص ما تستدعيه الشيفرة فعلاً ويحقن
      // ما ينقص هدفَ `build.target` أدناه. أرخص من قائمةٍ يدويّة وأضمن منها —
      // قائمتُنا اليدويّة كانت ستُغفل Promise.finally.
      modernPolyfills: true,
    }),
  ],
  build: {
    // هدفُ الحزمة الحديثة. plugin-legacy يحترمه ويبني modernPolyfills عليه،
    // فخفضُه إلى chrome66 يجعل كلَّ دالّةٍ أحدثَ منه تُحقن تلقائياً.
    // (التحذير السابق «overrode build.target» كان لأنّ modernPolyfills مطفأة.)
    target: ['chrome66', 'edge79', 'firefox67', 'safari12'],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
      '/uploads': 'http://localhost:4000',
    },
  },
})
