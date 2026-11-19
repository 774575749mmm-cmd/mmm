# تقرير اختبار قبول تسجيل الدخول (Login Acceptance Test Report)

- **النظام:** ALMANSOOR SMART FINANCE ERP
- **تاريخ التنفيذ (UTC):** `2026-11-19T18:04:04.500Z`
- **النتيجة الإجمالية:** **PASS (5/5)**
- **أداة التنفيذ:** متصفح Chromium حقيقي عبر Playwright (`scripts/login-acceptance-test.mjs`)
- **البيئة المستهدفة:** `http://127.0.0.1:3198`
- **محرك قاعدة البيانات:** `pglite` (`rlsReady: true`, `production: false`)
- **عزل البيانات:** بيئة PGlite معزولة ومؤقتة بالكامل (`DATABASE_URL=""`) دون أي مساس بـ Production أو Staging أو الحسابات القائمة.

---

## ملخص النتائج

| # | الاختبار | النتيجة | استجابات الخادم | أخطاء Console / PageError |
|---:|---|---:|---|---:|
| 1 | عرض شاشة تسجيل الدخول دون أخطاء | **PASS** | GET /api/auth/status → 200 | 0 / 0 |
| 2 | رفض بيانات الاعتماد الخاطئة ومنع الدخول للوحة التحكم | **PASS** | POST /api/auth/login → 401, GET /api/company/state → 401 | 0 / 0 |
| 3 | محاكاة إدخال بيانات اعتماد صحيحة وتنفيذ تسجيل الدخول | **PASS** | POST /api/auth/login → 200, GET /api/company/state → 200 | 0 / 0 |
| 4 | التحقق من الانتقال الناجح إلى لوحة التحكم | **PASS** | UI Transition Verified | 0 / 0 |
| 5 | استمرارية الجلسة وبقاء المستخدم داخل لوحة التحكم بعد إعادة التحميل (F5) | **PASS** | GET /api/auth/status → 200, GET /api/company/state → 200 | 0 / 0 |

---

## التفاصيل والأدلة لكل سيناريو

### 1. عرض شاشة تسجيل الدخول دون أخطاء
- **النتيجة:** `PASS`
- **خطوات التنفيذ الفعلية:**
1. فتح عنوان النظام المعزول (http://127.0.0.1:3198) في سياق متصفح Chromium جديد دون جلسة مسبقة.
2. انتظار استجابة فحص حالة المصادقة GET /api/auth/status واكتمال تحميل الواجهة.
3. التحقق من ظهور عنوان نافذة الدخول وحقل اسم المستخدم وحقل كلمة المرور وزر تسجيل الدخول.
- **استجابة الخادم ونتيجة الواجهة:** أعاد الخادم HTTP 200 (initialized: true, authenticated: false)، وظهرت نافذة "تسجيل الدخول الآمن — نظام المنصور" بكامل عناصرها.
- **الأدلة المرصودة:**
```json
{
  "httpStatus": 200,
  "initialized": true,
  "authenticated": false,
  "modalHeading": "تسجيل الدخول الآمن — نظام المنصور",
  "usernameInputVisible": true,
  "passwordInputVisible": true,
  "submitButtonVisible": true
}
```
- **فحص Console و PageErrors:** 0 أخطاء تطبيق في Console، 0 أخطاء PageError.

---

### 2. رفض بيانات الاعتماد الخاطئة ومنع الدخول للوحة التحكم
- **النتيجة:** `PASS`
- **خطوات التنفيذ الفعلية:**
1. إدخال اسم المستخدم "admin" مع كلمة مرور غير صحيحة في نموذج تسجيل الدخول.
2. النقر على زر تسجيل الدخول ورصد استجابة الخادم POST /api/auth/login.
3. التحقق من ظهور رسالة الخطأ داخل النافذة وبقاء شاشة القفل ورفض الوصول إلى بيانات لوحة التحكم (/api/company/state → 401).
- **استجابة الخادم ونتيجة الواجهة:** رفض الخادم المحاولة برمز HTTP 401 والرسالة "اسم المستخدم أو كلمة المرور غير صحيحة."، وبقيت شاشة القفل مفعّلة مع رفض GET /api/company/state برمز HTTP 401.
- **الأدلة المرصودة:**
```json
{
  "httpStatus": 401,
  "serverErrorMessage": "اسم المستخدم أو كلمة المرور غير صحيحة.",
  "errorDisplayedInUi": true,
  "loginModalRemainsOpen": true,
  "lockScreenVisible": true,
  "serverAuthenticatedAfterFail": false,
  "protectedStateHttpStatus": 401,
  "dashboardBlocked": true
}
```
- **فحص Console و PageErrors:** 0 أخطاء تطبيق في Console، 0 أخطاء PageError (مع 2 سجل شبكة متوقع لرفض 401 المقصود).

---

### 3. محاكاة إدخال بيانات اعتماد صحيحة وتنفيذ تسجيل الدخول
- **النتيجة:** `PASS`
- **خطوات التنفيذ الفعلية:**
1. إدخال اسم المستخدم الصحيح "admin" وكلمة المرور الصحيحة (المولدة مؤقتاً للاختبار) في حقول النموذج.
2. النقر على زر تسجيل الدخول ورصد طلب المصادقة POST /api/auth/login.
3. التحقق من إصدار ملف تعريف ارتباط الجلسة الآمن (HttpOnly) وتحميل حالة المنشأة GET /api/company/state.
- **استجابة الخادم ونتيجة الواجهة:** نجح تسجيل الدخول برمز HTTP 200 للمستخدم "admin" بدور "مالك المؤسسة" وإصدار جلسة sessionVersion=1، مع إصدار كوكي HttpOnly وتحميل حالة الشركة بنجاح (HTTP 200).
- **الأدلة المرصودة:**
```json
{
  "loginHttpStatus": 200,
  "companyStateHttpStatus": 200,
  "authenticatedUser": {
    "username": "admin",
    "fullName": "مالك اختبار القبول",
    "role": "مالك المؤسسة",
    "sessionVersion": 1,
    "mustChangePassword": false
  },
  "companiesLinkedCount": 1,
  "httpOnlySessionCookieSet": true,
  "sessionCookieName": "erp_session"
}
```
- **فحص Console و PageErrors:** 0 أخطاء تطبيق في Console، 0 أخطاء PageError.

---

### 4. التحقق من الانتقال الناجح إلى لوحة التحكم
- **النتيجة:** `PASS`
- **خطوات التنفيذ الفعلية:**
1. التحقق من إغلاق نافذة تسجيل الدخول وزوال شاشة القفل بالكامل بعد نجاح المصادقة.
2. التحقق من ظهور شريط الأدوات العلوي (زر تسجيل الخروج وزر تأسيس منشأة جديدة).
3. التحقق من ظهور وحدات التنقل الرئيسية للوحة التحكم (مثل: 1. الفواتير والمخزن و 8. التخصيص والصلاحيات والدفاتر).
- **استجابة الخادم ونتيجة الواجهة:** أُغلقت نافذة الدخول وزالت شاشة القفل، وانتقل المتصفح تلقائياً إلى لوحة التحكم الرئيسية بكامل أزرار التنقل والتحكم النشطة.
- **الأدلة المرصودة:**
```json
{
  "loginModalDismissed": true,
  "lockScreenDismissed": true,
  "logoutButtonVisible": true,
  "createCompanyButtonVisible": true,
  "invoicesModuleTabVisible": true,
  "settingsModuleTabVisible": true,
  "activeUserContextRendered": true
}
```
- **فحص Console و PageErrors:** 0 أخطاء تطبيق في Console، 0 أخطاء PageError.

---

### 5. استمرارية الجلسة وبقاء المستخدم داخل لوحة التحكم بعد إعادة التحميل (F5)
- **النتيجة:** `PASS`
- **خطوات التنفيذ الفعلية:**
1. تنفيذ إعادة تحميل كاملة للصفحة في المتصفح (page.reload / F5).
2. رصد استجابة GET /api/auth/status و GET /api/company/state بعد إعادة التحميل.
3. التحقق من بقاء المستخدم داخل لوحة التحكم وعدم إعادته لشاشة تسجيل الدخول.
- **استجابة الخادم ونتيجة الواجهة:** استمرت الجلسة بنجاح بعد إعادة التحميل (authenticated: true) وبقيت لوحة التحكم مفتوحة ومفعّلة.
- **الأدلة المرصودة:**
```json
{
  "reloadAuthStatusHttp": 200,
  "reloadAuthenticated": true,
  "reloadUsername": "admin",
  "reloadCompanyStateHttp": 200,
  "dashboardRemainedVisible": true,
  "loginModalReappeared": false
}
```
- **فحص Console و PageErrors:** 0 أخطاء تطبيق في Console، 0 أخطاء PageError.


---

## سجلات الخادم وبيئة التشغيل

- **ملاحظة HMR:** تم رصد 6 إشعار(ات) متوقعة متعلقة بتعطيل Vite HMR WebSocket في بيئة التطوير المعزولة دون أي تأثير على الوظائف.
- **مخرجات الخادم (stdout):**
```text
ALMANSOOR SMART FINANCE ERP Server listening on http://0.0.0.0:3198
```
- **تحذيرات/سجلات التمهيد (stderr):**
```text
[ERP Auth] Database has no users yet (authInitialized=false). Set ERP_BOOTSTRAP_ADMIN_PASSWORD or activate via /api/auth/bootstrap.
```
