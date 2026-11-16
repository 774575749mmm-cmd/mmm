# خطة التحول المعماري إلى خادم مركزي وقاعدة بيانات PostgreSQL (Architecture & Migration Blueprint)

> **ملاحظة معمارية:** هذا المستند خطة هندسية وتنفيذية مرحلية للانتقال الاختياري من وضع التشغيل المحلي الحالي (`IndexedDB + Node/Express`) إلى بنية متعددة المستخدمين والفروع (`PostgreSQL + Server-Authoritative API`) دون تعطيل التشغيل المحلي القائم حالياً.

---

## 1. الأسباب الهندسية للانتقال من المتصفح إلى خادم مركزي
1. **التزامن الموزع (Multi-Device / Multi-User Concurrency):** يوفر التحديث الحالي (`navigator.locks + BroadcastChannel + ERPDatabase.revision`) حماية كاملة للتزامن **داخل تبويبات نفس المتصفح فقط**، بينما يتطلب عمل عدة أمناء صناديق وفروع من أجهزة مختلفة أقفال صفوف فعلية (`SELECT ... FOR UPDATE`) وزيادة ذرية للأرقام التسلسلية في PostgreSQL.
2. **حجم البيانات طويل الأمد:** قاعدة بيانات IndexedDB تتحمل جيجابايت محلية لكنها غير مصممة للاستعلامات التجميعية المعقدة عبر ملايين القيود والفواتير كما تفعل الفهارس (`B-Tree / GIN`) في PostgreSQL.
3. **الاعتماد الخارجي للجهات الضريبية (ZATCA Phase 2 / الفوترة الإلكترونية):** إرسال التوقيعات المشفرة واستلام شهادات CSID يتطلب خادماً دائماً ومفاتيح محمية في Secret Manager / KMS.

---

## 2. المخطط العلائقي المقترح لقاعدة بيانات PostgreSQL (Core Schema)

```sql
-- 1. المؤسسات وعزل المستأجرين (Multi-Tenant Root)
CREATE TABLE companies (
  id UUID PRIMARY KEY,
  name_ar TEXT NOT NULL,
  name_en TEXT,
  country_code VARCHAR(4) NOT NULL DEFAULT 'YE',
  base_currency VARCHAR(8) NOT NULL DEFAULT 'YER',
  valuation_policy VARCHAR(20) NOT NULL DEFAULT 'PER_ITEM',
  tax_number TEXT,
  commercial_record TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. المستخدمون والجلسات والصلاحيات (RBAC + PBKDF2 / Argon2id)
CREATE TABLE users (
  id UUID PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  permission_matrix JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE user_company_access (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, company_id)
);

-- 3. دليل الحسابات والفترات المحاسبية والقيود المزدوجة
CREATE TABLE chart_of_accounts (
  id UUID PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id),
  code VARCHAR(32) NOT NULL,
  name_ar TEXT NOT NULL,
  category VARCHAR(24) NOT NULL,
  nature VARCHAR(10) NOT NULL CHECK (nature IN ('debit', 'credit')),
  is_leaf BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (company_id, code)
);

CREATE TABLE fiscal_periods (
  id UUID PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id),
  fiscal_year VARCHAR(8) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status VARCHAR(16) NOT NULL CHECK (status IN ('open', 'closed', 'locked'))
);

CREATE TABLE journal_entries (
  id UUID PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id),
  entry_number VARCHAR(64) NOT NULL,
  entry_date DATE NOT NULL,
  reference_type VARCHAR(40) NOT NULL,
  reference_id UUID,
  total_debit NUMERIC(18, 4) NOT NULL,
  total_credit NUMERIC(18, 4) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'posted',
  idempotency_key TEXT UNIQUE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ABS(total_debit - total_credit) < 0.01),
  UNIQUE (company_id, entry_number)
);

CREATE TABLE journal_entry_lines (
  id UUID PRIMARY KEY,
  journal_entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES chart_of_accounts(id),
  debit_base NUMERIC(18, 4) NOT NULL DEFAULT 0,
  credit_base NUMERIC(18, 4) NOT NULL DEFAULT 0,
  currency VARCHAR(8) NOT NULL,
  exchange_rate NUMERIC(18, 6) NOT NULL DEFAULT 1,
  memo TEXT
);

-- 4. الفواتير، السندات، وطبقات التكلفة FIFO
CREATE TABLE invoices (
  id UUID PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id),
  invoice_number VARCHAR(64) NOT NULL,
  type VARCHAR(32) NOT NULL,
  invoice_date DATE NOT NULL,
  entity_id UUID NOT NULL,
  currency VARCHAR(8) NOT NULL,
  exchange_rate NUMERIC(18, 6) NOT NULL,
  subtotal NUMERIC(18, 4) NOT NULL,
  tax_total NUMERIC(18, 4) NOT NULL,
  grand_total NUMERIC(18, 4) NOT NULL,
  paid_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  remaining_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  idempotency_key TEXT UNIQUE,
  UNIQUE (company_id, invoice_number)
);

CREATE TABLE stock_cost_layers (
  id UUID PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id),
  item_id UUID NOT NULL,
  warehouse_id UUID NOT NULL,
  source_doc_id UUID NOT NULL,
  original_qty NUMERIC(18, 4) NOT NULL,
  remaining_qty NUMERIC(18, 4) NOT NULL CHECK (remaining_qty >= 0),
  unit_cost_base NUMERIC(18, 4) NOT NULL,
  received_date DATE NOT NULL
);

-- 5. الاعتمادات وسجل التدقيق الغير قابل للتعديل
CREATE TABLE approval_requests (
  id UUID PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id),
  request_number VARCHAR(64) NOT NULL,
  requested_by UUID NOT NULL REFERENCES users(id),
  current_level SMALLINT NOT NULL DEFAULT 1,
  required_levels SMALLINT NOT NULL DEFAULT 1,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  payload_json JSONB NOT NULL
);

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id),
  actor_user_id UUID NOT NULL REFERENCES users(id),
  action VARCHAR(32) NOT NULL,
  module VARCHAR(32) NOT NULL,
  entity_id TEXT,
  before_snapshot JSONB,
  after_snapshot JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 3. سياسات الحماية على مستوى قاعدة البيانات والـ API
1. **Row-Level Security (RLS):** تفعيل `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;` على جميع الجداول التشغيلية والمحاسبية مع ربط `SET LOCAL app.company_id = $1;` داخل كل معاملة SQL.
2. **Idempotency + Optimistic Locking:** تخزين `idempotency_key` كـ `UNIQUE INDEX` مع عمود `version` في الفواتير والسندات والقيود لمنع التكرار أو الكتابة الفوقية.
3. **Server-Authoritative RBAC:** نقل التحقق من الصلاحيات من واجهة المتصفح إلى طبقة Middleware في Express مع التحقق من الجلسة الموقّعة (`HttpOnly`, `SameSite=Lax`, `Secure`) قبل كل استعلام PostgreSQL.

---

## 4. خطوات الترحيل الآمن للبيانات (Zero-Data-Loss Cutover)
1. **مرحلة التصدير التحضيري:** تصدير قاعدة البيانات الحالية عبر محرك النسخ الاحتياطي المشفر `ALMANSOOR_ERP_AES256_GCM_V1`.
2. **مرحلة التحويل والاستيراد (ETL Script):** فك تشفير ملف `.json.enc` وتشغيل سكربت ترحيل يدرج سجلات `companies`, `users`, `chart_of_accounts`, `invoices`, `stock_cost_layers`, و`journal_entries` داخل معاملة PostgreSQL واحدة مع التحقق من تطابق ميزان المراجعة قبل الالتزام (`COMMIT`).
3. **مرحلة المطابقة الثنائية (Parallel Verification):** تشغيل `runFinancialIntegrityScan` ومقارنة مجاميع المدين/الدائن، ذمم العملاء/الموردين، وتقييم المخزون بين IndexedDB وPostgreSQL بمطابقة صفرية الفارق قبل إيقاف وضع التخزين المحلي.
