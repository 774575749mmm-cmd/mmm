/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - PostgreSQL Multi-Tenant Repository
 * Enforces strict tenant isolation (membership verification + PostgreSQL RLS context + optimistic revisions)
 */

import crypto from 'node:crypto';
import type { PgExecutor } from './db.ts';

export interface ServerUserFlags {
  canViewReports?: boolean;
  canPostEntries?: boolean;
  canAdjustInventory?: boolean;
  canViewCostsAndProfits?: boolean;
  canManageSettings?: boolean;
  canEditInvoices?: boolean;
  canDeleteInvoices?: boolean;
  canEditVouchers?: boolean;
  canDeleteVouchers?: boolean;
  canEditExchangeRates?: boolean;
}

export interface ServerUserRecord {
  id: string;
  username: string;
  fullName: string;
  email?: string;
  phone?: string;
  role: string;
  isSuperAdmin?: boolean;
  allowedCompanyIds: string[];
  branchId: string;
  active: boolean;
  passwordHash: string;
  passwordSalt: string;
  mustChangePassword?: boolean;
  sessionVersion?: number;
  passwordChangedAt?: string | null;
  companyId?: string | null;
  lastActiveCompanyId?: string | null;
  flags?: ServerUserFlags;
  permissionMatrix?: Record<string, unknown>;
  updatedAt: string;
}

export type PublicServerUser = Omit<ServerUserRecord, 'passwordHash' | 'passwordSalt'>;

export function normalizePhoneForStorage(raw?: string): string {
  const input = String(raw || '').trim();
  if (!input) return '';
  const asciiDigits = input
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
  const hasPlus = asciiDigits.startsWith('+');
  const digitsOnly = asciiDigits.replace(/[^\d]/g, '');
  if (!digitsOnly) return '';
  if (hasPlus) return `+${digitsOnly}`;
  if (digitsOnly.startsWith('00') && digitsOnly.length > 6) {
    return `+${digitsOnly.slice(2)}`;
  }
  return digitsOnly;
}

export interface ServerCompanyRecord {
  id: string;
  nameAr: string;
  nameEn: string;
  countryCode: string;
  baseCurrency: string;
  valuationPolicy: string;
  commercialRecord: string;
  taxNumber: string;
  phone: string;
  email: string;
  address: string;
  fiscalYearStart: string;
  status: string;
  createdByUserId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ServerLicenseRecord {
  companyId: string;
  licenseMode: 'unrestricted' | 'trial' | 'paid';
  status: 'active' | 'trialing' | 'expired_readonly' | 'suspended';
  planCode: string;
  trialEndsAt: string | null;
  expiresAt: string | null;
  maxUsers: number | null;
  hardwareFingerprint: string | null;
  offlineSignature: string | null;
  updatedAt: string;
}

export interface CompanyStateSnapshot {
  companyId: string;
  revision: number;
  schemaVersion: string;
  company: ServerCompanyRecord;
  companies: ServerCompanyRecord[];
  users: PublicServerUser[];
  license: ServerLicenseRecord;
  state: Record<string, unknown> | null;
  auditLogs: Array<{
    id: string;
    companyId: string;
    userId: string;
    userName: string;
    action: string;
    module: string;
    details: string;
    entityId?: string;
    timestamp: string;
  }>;
}

export const TENANT_SCOPED_COLLECTIONS = [
  'branches',
  'warehouses',
  'departments',
  'customers',
  'vendors',
  'inventoryItems',
  'warehouseStock',
  'stockCostLayers',
  'inventoryBatches',
  'storageLocations',
  'stockMovements',
  'inventoryTransfers',
  'stocktakings',
  'warehouseDocuments',
  'documentBooks',
  'chartOfAccounts',
  'costCenters',
  'journalEntries',
  'fiscalPeriods',
  'invoices',
  'commercialOrders',
  'treasuryAccounts',
  'paymentVouchers',
  'treasuryTransfers',
  'bankReconciliations',
  'posShifts',
  'heldPosCarts',
  'expenseCategories',
  'expenseRecords',
  'employees',
  'payrollRuns',
  'fixedAssets',
  'customBooks',
  'customBookEntries',
  'approvalRules',
  'approvalRequests',
  'fxRevaluations',
  'savedReportDesigns',
  'auditLogs',
  'taskAlerts',
  'dispatchLogs',
] as const;

export function sanitizePublicServerUser(user: ServerUserRecord): PublicServerUser {
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    email: user.email || '',
    phone: user.phone || '',
    role: user.role,
    isSuperAdmin: Boolean(user.isSuperAdmin),
    allowedCompanyIds: [...(user.allowedCompanyIds || [])],
    branchId: user.branchId,
    active: user.active,
    mustChangePassword: Boolean(user.mustChangePassword),
    sessionVersion: Math.max(1, Number(user.sessionVersion ?? 1) || 1),
    passwordChangedAt: user.passwordChangedAt ?? null,
    companyId: user.companyId ?? user.lastActiveCompanyId ?? null,
    lastActiveCompanyId: user.lastActiveCompanyId ?? null,
    flags: user.flags ? { ...user.flags } : undefined,
    permissionMatrix: user.permissionMatrix ? { ...user.permissionMatrix } : undefined,
    updatedAt: user.updatedAt,
  };
}

function mapCompanyRow(row: Record<string, unknown>): ServerCompanyRecord {
  return {
    id: String(row.id),
    nameAr: String(row.name_ar || ''),
    nameEn: String(row.name_en || ''),
    countryCode: String(row.country_code || 'YE'),
    baseCurrency: String(row.base_currency || 'YER'),
    valuationPolicy: String(row.valuation_policy || 'PER_ITEM'),
    commercialRecord: String(row.commercial_record || ''),
    taxNumber: String(row.tax_number || ''),
    phone: String(row.phone || ''),
    email: String(row.email || ''),
    address: String(row.address || ''),
    fiscalYearStart: String(row.fiscal_year_start || '2026-01-01'),
    status: String(row.status || 'active'),
    createdByUserId: row.created_by_user_id ? String(row.created_by_user_id) : null,
    createdAt: row.created_at ? new Date(String(row.created_at)).toISOString() : new Date().toISOString(),
    updatedAt: row.updated_at ? new Date(String(row.updated_at)).toISOString() : new Date().toISOString(),
  };
}

function mapLicenseRow(row: Record<string, unknown> | undefined, companyId: string): ServerLicenseRecord {
  if (!row) {
    return {
      companyId,
      licenseMode: 'unrestricted',
      status: 'active',
      planCode: 'standard',
      trialEndsAt: null,
      expiresAt: null,
      maxUsers: null,
      hardwareFingerprint: null,
      offlineSignature: null,
      updatedAt: new Date().toISOString(),
    };
  }
  return {
    companyId: String(row.company_id || companyId),
    licenseMode: (row.license_mode as ServerLicenseRecord['licenseMode']) || 'unrestricted',
    status: (row.status as ServerLicenseRecord['status']) || 'active',
    planCode: String(row.plan_code || 'standard'),
    trialEndsAt: row.trial_ends_at ? new Date(String(row.trial_ends_at)).toISOString() : null,
    expiresAt: row.expires_at ? new Date(String(row.expires_at)).toISOString() : null,
    maxUsers: typeof row.max_users === 'number' ? row.max_users : null,
    hardwareFingerprint: row.hardware_fingerprint ? String(row.hardware_fingerprint) : null,
    offlineSignature: row.offline_signature ? String(row.offline_signature) : null,
    updatedAt: row.updated_at ? new Date(String(row.updated_at)).toISOString() : new Date().toISOString(),
  };
}

function parseJsonCol<T>(val: unknown, fallback: T): T {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'string') {
    try {
      return JSON.parse(val) as T;
    } catch {
      return fallback;
    }
  }
  return val as T;
}

export function buildDefaultIsolatedCompanyState(company: ServerCompanyRecord, options?: {
  branchName?: string;
  warehouseName?: string;
  fiscalYear?: string;
}): Record<string, unknown> {
  const fy = String(options?.fiscalYear || company.fiscalYearStart?.slice(0, 4) || '2026');
  const branchId = `br-${company.id}`;
  const warehouseId = `wh-${company.id}`;
  return {
    schemaVersion: '3.0.0',
    company,
    activeCompanyId: company.id,
    currencies: [
      {
        code: company.baseCurrency || 'YER',
        nameAr: company.baseCurrency === 'SAR' ? 'الريال السعودي' : company.baseCurrency === 'AED' ? 'الدرهم الإماراتي' : 'الريال اليمني',
        symbol: company.baseCurrency || 'YER',
        exchangeRate: 1,
        isBase: true,
        decimalPlaces: 2,
      },
      {
        code: 'USD',
        nameAr: 'الدولار الأمريكي',
        symbol: '$',
        exchangeRate: company.baseCurrency === 'SAR' ? 3.75 : company.baseCurrency === 'AED' ? 3.67 : 530,
        isBase: false,
        decimalPlaces: 2,
      },
    ],
    branches: [
      {
        id: branchId,
        companyId: company.id,
        code: 'BR-01',
        nameAr: options?.branchName || 'الفرع الرئيسي',
        phone: company.phone || '',
        address: company.address || '',
        managerName: 'مدير الفرع',
        isMain: true,
        status: 'active',
      },
    ],
    warehouses: [
      {
        id: warehouseId,
        companyId: company.id,
        branchId,
        code: 'WH-01',
        nameAr: options?.warehouseName || 'المستودع المركزي',
        location: company.address || '',
        keeperName: 'أمين المستودع',
        status: 'active',
      },
    ],
    fiscalPeriods: [
      {
        id: `fp-${company.id}-${fy}`,
        companyId: company.id,
        fiscalYear: fy,
        periodName: `السنة المالية ${fy} (${company.nameAr})`,
        startDate: `${fy}-01-01`,
        endDate: `${fy}-12-31`,
        status: 'open',
      },
    ],
    customers: [],
    vendors: [],
    inventoryItems: [],
    warehouseStock: [],
    stockCostLayers: [],
    inventoryBatches: [],
    storageLocations: [],
    stockMovements: [],
    inventoryTransfers: [],
    stocktakings: [],
    warehouseDocuments: [],
    chartOfAccounts: [],
    costCenters: [],
    journalEntries: [],
    invoices: [],
    commercialOrders: [],
    treasuryAccounts: [],
    paymentVouchers: [],
    treasuryTransfers: [],
    bankReconciliations: [],
    posShifts: [],
    heldPosCarts: [],
    expenseCategories: [],
    expenseRecords: [],
    employees: [],
    payrollRuns: [],
    fixedAssets: [],
    customBooks: [],
    customBookEntries: [],
    approvalRules: [],
    approvalRequests: [],
    fxRevaluations: [],
    savedReportDesigns: [],
    taskAlerts: [],
    dispatchLogs: [],
    settings: {
      fiscalYear: fy,
      fiscalYearStatus: 'open',
      companyPhone: company.phone || '',
      companyAddress: company.address || '',
      companyTaxNumber: company.taxNumber || '',
      companyCommercialRecord: company.commercialRecord || '',
      language: 'ar',
    },
  };
}

export function validateAndScopeStatePayload(
  rawState: Record<string, unknown>,
  verifiedCompanyId: string
): { ok: true; state: Record<string, unknown> } | { ok: false; error: string } {
  if (!rawState || typeof rawState !== 'object') {
    return { ok: false, error: 'بيانات حالة المنشأة غير صالحة.' };
  }

  const bodyCompanyId = (rawState.company as { id?: unknown } | undefined)?.id;
  if (bodyCompanyId && String(bodyCompanyId).trim() !== verifiedCompanyId) {
    return {
      ok: false,
      error: `عزل المنشآت: رفض محاولة كتابة بيانات لشركة (${String(bodyCompanyId)}) داخل جلسة الشركة (${verifiedCompanyId}).`,
    };
  }
  if (rawState.activeCompanyId && String(rawState.activeCompanyId).trim() !== verifiedCompanyId) {
    return {
      ok: false,
      error: `عزل المنشآت: معرف الشركة النشط (${String(rawState.activeCompanyId)}) لا يطابق جلسة المنشأة المصرح بها.`,
    };
  }

  const sanitized: Record<string, unknown> = { ...rawState };
  // Never store cross-tenant user lists or multi-company directories inside single-company state_json
  delete sanitized.users;
  delete sanitized.companies;
  sanitized.activeCompanyId = verifiedCompanyId;

  for (const key of TENANT_SCOPED_COLLECTIONS) {
    const val = sanitized[key];
    if (!Array.isArray(val)) continue;
    for (const item of val) {
      if (item && typeof item === 'object') {
        const cid = (item as { companyId?: unknown }).companyId;
        if (cid !== undefined && cid !== null && String(cid).trim() !== '' && String(cid).trim() !== verifiedCompanyId) {
          return {
            ok: false,
            error: `عزل المنشآت: رفض سجل في (${key}) يحمل معرف شركة مخالف (${String(cid)}).`,
          };
        }
      }
    }
    sanitized[key] = val.map((item) =>
      item && typeof item === 'object' ? { ...(item as Record<string, unknown>), companyId: verifiedCompanyId } : item
    );
  }

  return { ok: true, state: sanitized };
}

export class PgTenantRepository {
  private readonly db: PgExecutor;

  constructor(db: PgExecutor) {
    this.db = db;
  }

  async hasAnyUsers(): Promise<boolean> {
    return this.db.transaction(
      async (tx) => {
        const res = await tx.query<{ exists: boolean }>('SELECT EXISTS(SELECT 1 FROM users) AS exists');
        return Boolean(res.rows[0]?.exists);
      },
      { bypassRls: true }
    );
  }

  private async hydrateUserRow(row: Record<string, unknown>): Promise<ServerUserRecord> {
    const userId = String(row.id);
    const memRes = await this.db.transaction(
      async (tx) =>
        tx.query<{ company_id: string; role: string; branch_id: string; flags_json: unknown; permission_matrix: unknown }>(
          `
          SELECT company_id, role, branch_id, flags_json, permission_matrix
          FROM company_memberships
          WHERE user_id = $1 AND is_active = TRUE
          ORDER BY created_at ASC
        `,
          [userId]
        ),
      { userId }
    );

    const allowedCompanyIds = memRes.rows.map((m) => String(m.company_id));
    const lastActive = row.last_active_company_id ? String(row.last_active_company_id) : null;
    const explicitCompanyId = row.company_id ? String(row.company_id) : null;
    const resolvedCompanyId = explicitCompanyId || lastActive || allowedCompanyIds[0] || null;
    const primaryMem =
      memRes.rows.find((m) => String(m.company_id) === (lastActive || resolvedCompanyId)) || memRes.rows[0];

    const userFlags = parseJsonCol<ServerUserFlags>(row.flags_json, {});
    const memFlags = primaryMem ? parseJsonCol<ServerUserFlags>(primaryMem.flags_json, {}) : {};
    const permMatrix = primaryMem
      ? parseJsonCol<Record<string, unknown>>(primaryMem.permission_matrix, {})
      : {};

    return {
      id: userId,
      username: String(row.username),
      fullName: String(row.full_name),
      email: row.email ? String(row.email) : '',
      phone: row.phone ? String(row.phone) : '',
      role: String(primaryMem?.role || row.role),
      isSuperAdmin: Boolean(row.is_super_admin),
      allowedCompanyIds,
      branchId: String(primaryMem?.branch_id || row.branch_id || 'br-01'),
      active: Boolean(row.active),
      passwordHash: String(row.password_hash),
      passwordSalt: String(row.password_salt),
      mustChangePassword: Boolean(row.must_change_password),
      sessionVersion: Math.max(1, Number(row.session_version ?? 1) || 1),
      passwordChangedAt: row.password_changed_at
        ? new Date(String(row.password_changed_at)).toISOString()
        : null,
      companyId: resolvedCompanyId,
      lastActiveCompanyId: lastActive,
      flags: { ...userFlags, ...memFlags },
      permissionMatrix: permMatrix,
      updatedAt: row.updated_at ? new Date(String(row.updated_at)).toISOString() : new Date().toISOString(),
    };
  }

  async findUserById(id: string): Promise<ServerUserRecord | undefined> {
    const res = await this.db.transaction(
      async (tx) => tx.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [id]),
      { bypassRls: true }
    );
    if (!res.rows[0]) return undefined;
    return this.hydrateUserRow(res.rows[0]);
  }

  async findUserByUsername(username: string): Promise<ServerUserRecord | undefined> {
    const res = await this.db.transaction(
      async (tx) =>
        tx.query('SELECT * FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1', [
          username.trim(),
        ]),
      { bypassRls: true }
    );
    if (!res.rows[0]) return undefined;
    return this.hydrateUserRow(res.rows[0]);
  }

  async findUserByLoginIdentifier(identifier: string): Promise<ServerUserRecord | undefined> {
    const clean = String(identifier || '').trim();
    if (!clean) return undefined;

    const byUsername = await this.findUserByUsername(clean);
    if (byUsername) return byUsername;

    if (clean.includes('@')) {
      const byEmail = await this.db.transaction(
        async (tx) =>
          tx.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1) LIMIT 2', [clean]),
        { bypassRls: true }
      );
      if (byEmail.rows.length === 1) {
        return this.hydrateUserRow(byEmail.rows[0]);
      }
    }
    return undefined;
  }

  async bootstrapOwner(params: {
    user: ServerUserRecord;
    companies: Array<Partial<ServerCompanyRecord> & { id: string }>;
    initialState?: Record<string, unknown>;
  }): Promise<{ ok: true; user: ServerUserRecord; companies: ServerCompanyRecord[] } | { ok: false; code: string; error: string }> {
    return this.db.transaction(
      async (tx) => {
        const countRes = await tx.query<{ cnt: number }>('SELECT COUNT(*)::int AS cnt FROM users');
        if (Number(countRes.rows[0]?.cnt || 0) > 0) {
          return {
            ok: false,
            code: 'ALREADY_BOOTSTRAPPED',
            error: 'النظام مهيأ مسبقاً بحساب مدير. يرجى تسجيل الدخول بكلمة المرور.',
          };
        }

        const primaryCompanyId = params.companies[0]?.id || 'comp-01';
        const cleanPhone = String(params.user.phone || '').trim();
        const normalizedPhone = normalizePhoneForStorage(cleanPhone) || null;
        const nowIso = new Date().toISOString();

        await tx.query(
          `
          INSERT INTO users (
            id, username, full_name, email, phone, phone_normalized, role, is_super_admin, branch_id, active,
            password_hash, password_salt, must_change_password, session_version, password_changed_at,
            last_active_company_id, flags_json
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 1, NOW(), NULL, $14::jsonb)
        `,
          [
            params.user.id,
            params.user.username,
            params.user.fullName,
            params.user.email || `${params.user.username}@almansoor.erp`,
            cleanPhone,
            normalizedPhone,
            params.user.role,
            true,
            params.user.branchId || 'br-01',
            true,
            params.user.passwordHash,
            params.user.passwordSalt,
            Boolean(params.user.mustChangePassword),
            JSON.stringify(params.user.flags || { canManageSettings: true, canPostEntries: true, canViewReports: true, canViewCostsAndProfits: true, canAdjustInventory: true }),
          ]
        );

        const createdCompanies: ServerCompanyRecord[] = [];
        for (const compInput of params.companies) {
          const cid = compInput.id;
          const compRes = await tx.query(
            `
            INSERT INTO companies (
              id, name_ar, name_en, country_code, base_currency, valuation_policy,
              commercial_record, tax_number, phone, email, address, fiscal_year_start, status, created_by_user_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'active', $13)
            ON CONFLICT (id) DO UPDATE SET name_ar = EXCLUDED.name_ar
            RETURNING *
          `,
            [
              cid,
              compInput.nameAr || 'المنشأة الرئيسية',
              compInput.nameEn || 'Main Enterprise',
              compInput.countryCode || 'YE',
              compInput.baseCurrency || 'YER',
              compInput.valuationPolicy || 'PER_ITEM',
              compInput.commercialRecord || '',
              compInput.taxNumber || '',
              compInput.phone || cleanPhone,
              compInput.email || params.user.email || '',
              compInput.address || '',
              compInput.fiscalYearStart || '2026-01-01',
              params.user.id,
            ]
          );
          const companyRow = mapCompanyRow(compRes.rows[0]);
          createdCompanies.push(companyRow);

          await tx.query(
            `
            INSERT INTO company_memberships (
              user_id, company_id, role, branch_id, permission_matrix, flags_json, is_active
            ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, TRUE)
            ON CONFLICT (user_id, company_id) DO NOTHING
          `,
            [
              params.user.id,
              cid,
              params.user.role,
              params.user.branchId || 'br-01',
              JSON.stringify(params.user.permissionMatrix || {}),
              JSON.stringify(params.user.flags || { canManageSettings: true, canPostEntries: true, canViewReports: true, canViewCostsAndProfits: true, canAdjustInventory: true }),
            ]
          );

          await tx.query(
            `
            INSERT INTO company_licenses (company_id, license_mode, status, plan_code)
            VALUES ($1, 'unrestricted', 'active', 'enterprise')
            ON CONFLICT (company_id) DO NOTHING
          `,
            [cid]
          );

          if (params.initialState && cid === primaryCompanyId) {
            const scoped = validateAndScopeStatePayload(params.initialState, cid);
            if (scoped.ok) {
              await tx.query(
                `
                INSERT INTO company_state (company_id, schema_version, revision, company_profile, state_json, updated_by_user_id)
                VALUES ($1, '3.0.0', 1, $2::jsonb, $3::jsonb, $4)
                ON CONFLICT (company_id) DO NOTHING
              `,
                [cid, JSON.stringify(companyRow), JSON.stringify(scoped.state), params.user.id]
              );
            }
          }
        }

        if (createdCompanies.length > 0) {
          await tx.query('UPDATE users SET company_id = $1, last_active_company_id = $1 WHERE id = $2', [
            createdCompanies[0].id,
            params.user.id,
          ]);
        }

        const hydrated: ServerUserRecord = {
          ...params.user,
          phone: cleanPhone,
          isSuperAdmin: true,
          sessionVersion: 1,
          passwordChangedAt: nowIso,
          allowedCompanyIds: createdCompanies.map((c) => c.id),
          companyId: createdCompanies[0]?.id || null,
          lastActiveCompanyId: createdCompanies[0]?.id || null,
        };
        return { ok: true, user: hydrated, companies: createdCompanies };
      },
      { bypassRls: true }
    );
  }

  async registerTenantAccount(params: {
    username: string;
    fullName: string;
    email?: string;
    phone?: string;
    passwordHash: string;
    passwordSalt: string;
    company?: {
      id?: string;
      nameAr: string;
      nameEn?: string;
      countryCode?: string;
      baseCurrency?: string;
      valuationPolicy?: string;
      commercialRecord?: string;
      taxNumber?: string;
      phone?: string;
      address?: string;
      fiscalYearStart?: string;
      branchName?: string;
      warehouseName?: string;
    };
    initialState?: Record<string, unknown>;
  }): Promise<
    | { ok: true; user: ServerUserRecord; company: ServerCompanyRecord; companies: ServerCompanyRecord[] }
    | { ok: false; status: number; code: string; error: string }
  > {
    const companyNameAr = String(params.company?.nameAr || '').trim();
    if (!companyNameAr) {
      return {
        ok: false,
        status: 400,
        code: 'COMPANY_NAME_REQUIRED',
        error: 'اسم المنشأة الجديدة بالعربية مطلوب لإنشاء الحساب وربطه بالمنشأة.',
      };
    }

    return this.db.transaction(
      async (tx) => {
        const dup = await tx.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1', [
          params.username.trim(),
        ]);
        if (dup.rows.length > 0) {
          return {
            ok: false,
            status: 409,
            code: 'USERNAME_EXISTS',
            error: 'اسم المستخدم مسجل مسبقاً. يرجى اختيار اسم آخر.',
          };
        }

        const cid = String(params.company?.id || `comp-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`).trim();
        const dupComp = await tx.query('SELECT id FROM companies WHERE id = $1 LIMIT 1', [cid]);
        if (dupComp.rows.length > 0) {
          return {
            ok: false,
            status: 409,
            code: 'COMPANY_ALREADY_EXISTS',
            error: 'معرف المنشأة مسجل مسبقاً.',
          };
        }

        const userId = `usr-${crypto.randomUUID().slice(0, 12)}`;
        const branchId = `br-${cid}`;
        const cleanEmail = (params.email || `${params.username.trim()}@almansoor.erp`).trim();
        const cleanPhone = String(params.phone || params.company?.phone || '').trim();
        const normalizedPhone = normalizePhoneForStorage(cleanPhone) || null;
        const nowIso = new Date().toISOString();

        const tenantFlags: ServerUserFlags = {
          canViewReports: true,
          canPostEntries: true,
          canAdjustInventory: true,
          canViewCostsAndProfits: true,
          canManageSettings: true,
          canEditInvoices: true,
          canDeleteInvoices: true,
          canEditVouchers: true,
          canDeleteVouchers: true,
          canEditExchangeRates: true,
        };

        await tx.query(
          `
          INSERT INTO users (
            id, username, full_name, email, phone, phone_normalized, role, is_super_admin, branch_id, active,
            password_hash, password_salt, must_change_password, session_version, password_changed_at,
            last_active_company_id, flags_json
          ) VALUES ($1, $2, $3, $4, $5, $6, 'Tenant Admin', FALSE, $7, TRUE, $8, $9, FALSE, 1, NOW(), NULL, $10::jsonb)
        `,
          [
            userId,
            params.username.trim(),
            params.fullName.trim(),
            cleanEmail,
            cleanPhone,
            normalizedPhone,
            branchId,
            params.passwordHash,
            params.passwordSalt,
            JSON.stringify(tenantFlags),
          ]
        );

        await tx.query("SELECT set_config('app.current_company_id', $1, true)", [cid]);
        await tx.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);

        const compRes = await tx.query(
          `
          INSERT INTO companies (
            id, name_ar, name_en, country_code, base_currency, valuation_policy,
            commercial_record, tax_number, phone, email, address, fiscal_year_start, status, created_by_user_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'active', $13)
          RETURNING *
        `,
          [
            cid,
            companyNameAr,
            (params.company?.nameEn || companyNameAr).trim(),
            params.company?.countryCode || 'YE',
            params.company?.baseCurrency || 'YER',
            params.company?.valuationPolicy || 'PER_ITEM',
            params.company?.commercialRecord || '',
            params.company?.taxNumber || '',
            params.company?.phone || cleanPhone,
            params.email || '',
            params.company?.address || '',
            params.company?.fiscalYearStart || '2026-01-01',
            userId,
          ]
        );
        const createdCompany = mapCompanyRow(compRes.rows[0]);

        await tx.query(
          `
          INSERT INTO company_memberships (
            user_id, company_id, role, branch_id, permission_matrix, flags_json, is_active
          ) VALUES ($1, $2, 'Tenant Admin', $3, $4::jsonb, $5::jsonb, TRUE)
        `,
          [
            userId,
            cid,
            branchId,
            JSON.stringify({ '*': { view: true, create: true, edit: true, delete: true, post: true, approve: true, export: true, print: true, manageSettings: true, viewCosts: true } }),
            JSON.stringify(tenantFlags),
          ]
        );

        await tx.query(
          `
          INSERT INTO company_licenses (company_id, license_mode, status, plan_code)
          VALUES ($1, 'unrestricted', 'active', 'standard')
        `,
          [cid]
        );

        const rawState =
          params.initialState ||
          buildDefaultIsolatedCompanyState(createdCompany, {
            branchName: params.company?.branchName,
            warehouseName: params.company?.warehouseName,
            fiscalYear: createdCompany.fiscalYearStart?.slice(0, 4),
          });
        const scoped = validateAndScopeStatePayload(rawState, cid);
        const stateToSave = scoped.ok ? scoped.state : buildDefaultIsolatedCompanyState(createdCompany);

        await tx.query(
          `
          INSERT INTO company_state (company_id, schema_version, revision, company_profile, state_json, updated_by_user_id)
          VALUES ($1, '3.0.0', 1, $2::jsonb, $3::jsonb, $4)
        `,
          [cid, JSON.stringify(createdCompany), JSON.stringify(stateToSave), userId]
        );

        await tx.query(
          `
          INSERT INTO company_audit_logs (id, company_id, actor_user_id, actor_name, action, module, details, entity_id)
          VALUES ($1, $2, $3, $4, 'إنشاء', 'الإعدادات', $5, $2)
        `,
          [
            `log-${crypto.randomUUID().slice(0, 10)}`,
            cid,
            userId,
            params.fullName.trim(),
            `تسجيل حساب وتأسيس منشأة مستقلة (${createdCompany.nameAr})`,
          ]
        );

        await tx.query('UPDATE users SET company_id = $1, last_active_company_id = $1, branch_id = $2 WHERE id = $3', [
          cid,
          branchId,
          userId,
        ]);

        const userRecord: ServerUserRecord = {
          id: userId,
          username: params.username.trim(),
          fullName: params.fullName.trim(),
          email: cleanEmail,
          phone: cleanPhone,
          role: 'Tenant Admin',
          isSuperAdmin: false,
          allowedCompanyIds: [createdCompany.id],
          branchId,
          active: true,
          passwordHash: params.passwordHash,
          passwordSalt: params.passwordSalt,
          mustChangePassword: false,
          sessionVersion: 1,
          passwordChangedAt: nowIso,
          companyId: createdCompany.id,
          lastActiveCompanyId: createdCompany.id,
          flags: tenantFlags,
          updatedAt: nowIso,
        };

        return {
          ok: true,
          user: userRecord,
          company: createdCompany,
          companies: [createdCompany],
        };
      },
      { bypassRls: true }
    );
  }

  async updateLastActiveCompany(userId: string, companyId: string): Promise<void> {
    await this.db.transaction(
      async (tx) => {
        await tx.query(
          'UPDATE users SET last_active_company_id = $1, updated_at = NOW() WHERE id = $2',
          [companyId, userId]
        );
      },
      { companyId, userId }
    );
  }

  async updateUserPassword(
    userId: string,
    passwordHash: string,
    passwordSalt: string,
    options?: {
      companyId?: string;
      actorUserId?: string;
      actorName?: string;
      auditDetails?: string;
    }
  ): Promise<{ sessionVersion: number }> {
    return this.db.transaction(
      async (tx) => {
        const res = await tx.query<{ session_version: number }>(
          `
          UPDATE users
          SET password_hash = $1,
              password_salt = $2,
              must_change_password = FALSE,
              session_version = COALESCE(session_version, 1) + 1,
              password_changed_at = NOW(),
              updated_at = NOW()
          WHERE id = $3
          RETURNING session_version
        `,
          [passwordHash, passwordSalt, userId]
        );

        const nextVersion = Math.max(1, Number(res.rows[0]?.session_version ?? 2) || 2);

        if (options?.companyId) {
          await tx.query(
            `
            INSERT INTO company_audit_logs (id, company_id, actor_user_id, actor_name, action, module, details, entity_id)
            VALUES ($1, $2, $3, $4, 'تعديل', 'النظام', $5, $6)
          `,
            [
              `log-${crypto.randomUUID().slice(0, 10)}`,
              options.companyId,
              options.actorUserId || userId,
              options.actorName || 'مستخدم النظام',
              options.auditDetails || 'تحديث كلمة المرور وإبطال الجلسات السابقة تلقائياً',
              userId,
            ]
          );
        }

        return { sessionVersion: nextVersion };
      },
      { bypassRls: true }
    );
  }

  async incrementSessionVersion(
    userId: string,
    options?: {
      companyId?: string;
      actorUserId?: string;
      actorName?: string;
      auditDetails?: string;
    }
  ): Promise<{ sessionVersion: number }> {
    return this.db.transaction(
      async (tx) => {
        const res = await tx.query<{ session_version: number }>(
          `
          UPDATE users
          SET session_version = COALESCE(session_version, 1) + 1,
              updated_at = NOW()
          WHERE id = $1
          RETURNING session_version
        `,
          [userId]
        );
        const nextVersion = Math.max(1, Number(res.rows[0]?.session_version ?? 2) || 2);

        if (options?.companyId) {
          await tx.query(
            `
            INSERT INTO company_audit_logs (id, company_id, actor_user_id, actor_name, action, module, details, entity_id)
            VALUES ($1, $2, $3, $4, 'تعديل', 'النظام', $5, $6)
          `,
            [
              `log-${crypto.randomUUID().slice(0, 10)}`,
              options.companyId,
              options.actorUserId || userId,
              options.actorName || 'مستخدم النظام',
              options.auditDetails || 'إبطال جميع جلسات الدخول السابقة للمستخدم',
              userId,
            ]
          );
        }

        return { sessionVersion: nextVersion };
      },
      { bypassRls: true }
    );
  }

  async getUserAuthorizedCompanies(userId: string): Promise<ServerCompanyRecord[]> {
    return this.db.transaction(
      async (tx) => {
        const res = await tx.query(
          `
          SELECT c.*
          FROM companies c
          INNER JOIN company_memberships m
            ON m.company_id = c.id
          WHERE m.user_id = $1 AND m.is_active = TRUE
          ORDER BY c.created_at ASC
        `,
          [userId]
        );
        return res.rows.map(mapCompanyRow);
      },
      { userId }
    );
  }

  async createCompanyForUser(params: {
    actor: ServerUserRecord;
    company: {
      id?: string;
      nameAr: string;
      nameEn?: string;
      countryCode?: string;
      baseCurrency?: string;
      valuationPolicy?: string;
      commercialRecord?: string;
      taxNumber?: string;
      phone?: string;
      email?: string;
      address?: string;
      fiscalYearStart?: string;
      branchName?: string;
      warehouseName?: string;
    };
    initialState?: Record<string, unknown>;
  }): Promise<
    | { ok: true; company: ServerCompanyRecord; companies: ServerCompanyRecord[]; revision: number }
    | { ok: false; status: number; code: string; error: string }
  > {
    const cid = String(params.company.id || `comp-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`).trim();
    const creatorRole =
      params.actor.isSuperAdmin || params.actor.role === 'مالك المؤسسة'
        ? params.actor.role
        : 'Tenant Admin';

    return this.db.transaction(
      async (tx) => {
        const dup = await tx.query('SELECT id FROM companies WHERE id = $1 LIMIT 1', [cid]);
        if (dup.rows.length > 0) {
          return {
            ok: false,
            status: 409,
            code: 'COMPANY_ALREADY_EXISTS',
            error: 'معرف المنشأة مسجل مسبقاً.',
          };
        }

        const compRes = await tx.query(
          `
          INSERT INTO companies (
            id, name_ar, name_en, country_code, base_currency, valuation_policy,
            commercial_record, tax_number, phone, email, address, fiscal_year_start, status, created_by_user_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'active', $13)
          RETURNING *
        `,
          [
            cid,
            params.company.nameAr.trim(),
            (params.company.nameEn || params.company.nameAr).trim(),
            params.company.countryCode || 'YE',
            params.company.baseCurrency || 'YER',
            params.company.valuationPolicy || 'PER_ITEM',
            params.company.commercialRecord || '',
            params.company.taxNumber || '',
            params.company.phone || '',
            params.company.email || '',
            params.company.address || '',
            params.company.fiscalYearStart || '2026-01-01',
            params.actor.id,
          ]
        );
        const createdCompany = mapCompanyRow(compRes.rows[0]);

        const tenantFlags: ServerUserFlags = {
          canViewReports: true,
          canPostEntries: true,
          canAdjustInventory: true,
          canViewCostsAndProfits: true,
          canManageSettings: true,
          canEditInvoices: true,
          canDeleteInvoices: true,
          canEditVouchers: true,
          canDeleteVouchers: true,
          canEditExchangeRates: true,
        };
        const starterBranchId =
          (Array.isArray(params.initialState?.branches) &&
            (params.initialState!.branches as Array<{ id?: string; companyId?: string }>).find(
              (b) => b.companyId === cid
            )?.id) ||
          `br-${cid}`;

        await tx.query(
          `
          INSERT INTO company_memberships (
            user_id, company_id, role, branch_id, permission_matrix, flags_json, is_active
          ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, TRUE)
        `,
          [
            params.actor.id,
            cid,
            creatorRole,
            starterBranchId,
            JSON.stringify({ '*': { view: true, create: true, edit: true, delete: true, post: true, approve: true, export: true, print: true, manageSettings: true, viewCosts: true } }),
            JSON.stringify(tenantFlags),
          ]
        );

        await tx.query(
          `
          INSERT INTO company_licenses (company_id, license_mode, status, plan_code)
          VALUES ($1, 'unrestricted', 'active', 'standard')
        `,
          [cid]
        );

        const rawState =
          params.initialState ||
          buildDefaultIsolatedCompanyState(createdCompany, {
            branchName: params.company.branchName,
            warehouseName: params.company.warehouseName,
            fiscalYear: createdCompany.fiscalYearStart?.slice(0, 4),
          });
        const scoped = validateAndScopeStatePayload(rawState, cid);
        const stateToSave = scoped.ok ? scoped.state : buildDefaultIsolatedCompanyState(createdCompany);

        await tx.query(
          `
          INSERT INTO company_state (company_id, schema_version, revision, company_profile, state_json, updated_by_user_id)
          VALUES ($1, '3.0.0', 1, $2::jsonb, $3::jsonb, $4)
        `,
          [cid, JSON.stringify(createdCompany), JSON.stringify(stateToSave), params.actor.id]
        );

        await tx.query(
          `
          INSERT INTO company_audit_logs (id, company_id, actor_user_id, actor_name, action, module, details, entity_id)
          VALUES ($1, $2, $3, $4, 'إنشاء', 'الإعدادات', $5, $2)
        `,
          [
            `log-${crypto.randomUUID().slice(0, 10)}`,
            cid,
            params.actor.id,
            params.actor.fullName,
            `تأسيس منشأة جديدة (${createdCompany.nameAr}) وحفظها في قاعدة البيانات`,
          ]
        );

        await tx.query(
          'UPDATE users SET company_id = COALESCE(company_id, $1), last_active_company_id = $1, updated_at = NOW() WHERE id = $2',
          [cid, params.actor.id]
        );

        const allRes = await tx.query(
          `
          SELECT c.*
          FROM companies c
          INNER JOIN company_memberships m ON m.company_id = c.id
          WHERE m.user_id = $1 AND m.is_active = TRUE
          ORDER BY c.created_at ASC
        `,
          [params.actor.id]
        );

        return {
          ok: true,
          company: createdCompany,
          companies: allRes.rows.map(mapCompanyRow),
          revision: 1,
        };
      },
      { companyId: cid, userId: params.actor.id }
    );
  }

  async switchActiveCompany(
    userId: string,
    targetCompanyId: string
  ): Promise<
    | { ok: true; company: ServerCompanyRecord; membershipRole: string; companies: ServerCompanyRecord[] }
    | { ok: false; status: number; code: string; error: string }
  > {
    const cleanTarget = String(targetCompanyId || '').trim();
    if (!cleanTarget) {
      return {
        ok: false,
        status: 400,
        code: 'COMPANY_ID_REQUIRED',
        error: 'معرف المنشأة المستهدفة مطلوب.',
      };
    }

    return this.db.transaction(
      async (tx) => {
        const mem = await tx.query<{ role: string }>(
          `
          SELECT role FROM company_memberships
          WHERE user_id = $1 AND company_id = $2 AND is_active = TRUE
          LIMIT 1
        `,
          [userId, cleanTarget]
        );
        if (!mem.rows[0]) {
          return {
            ok: false,
            status: 403,
            code: 'TENANT_ISOLATION_VIOLATION',
            error: `عزل المنشآت: الحساب غير مصرح له بالوصول إلى المنشأة (${cleanTarget}).`,
          };
        }

        const compRes = await tx.query('SELECT * FROM companies WHERE id = $1 LIMIT 1', [cleanTarget]);
        if (!compRes.rows[0]) {
          return {
            ok: false,
            status: 404,
            code: 'COMPANY_NOT_FOUND',
            error: 'المنشأة المطلوبة غير موجودة.',
          };
        }

        await tx.query('UPDATE users SET last_active_company_id = $1, updated_at = NOW() WHERE id = $2', [
          cleanTarget,
          userId,
        ]);

        const listRes = await tx.query(
          `
          SELECT c.*
          FROM companies c
          INNER JOIN company_memberships m ON m.company_id = c.id
          WHERE m.user_id = $1 AND m.is_active = TRUE
          ORDER BY c.created_at ASC
        `,
          [userId]
        );

        return {
          ok: true,
          company: mapCompanyRow(compRes.rows[0]),
          membershipRole: String(mem.rows[0].role),
          companies: listRes.rows.map(mapCompanyRow),
        };
      },
      { companyId: cleanTarget, userId }
    );
  }

  async updateCompanyProfile(params: {
    actor: ServerUserRecord;
    companyId: string;
    patch: {
      nameAr?: string;
      nameEn?: string;
      countryCode?: string;
      baseCurrency?: string;
      valuationPolicy?: string;
      commercialRecord?: string;
      taxNumber?: string;
      phone?: string;
      email?: string;
      address?: string;
      fiscalYearStart?: string;
      status?: string;
    };
  }): Promise<
    | { ok: true; company: ServerCompanyRecord }
    | { ok: false; status: number; code: string; error: string }
  > {
    if (params.patch.status !== undefined && !params.actor.isSuperAdmin) {
      return {
        ok: false,
        status: 403,
        code: 'FORBIDDEN_SUPER_ADMIN_ONLY',
        error: 'صلاحية مرفوضة: تفعيل أو تعطيل اشتراك المنشأة مخصص لمالك المؤسسة (Super Admin) فقط.',
      };
    }

    return this.db.transaction(
      async (tx) => {
        if (!params.actor.isSuperAdmin) {
          const mem = await tx.query<{ role: string }>(
            'SELECT role FROM company_memberships WHERE user_id = $1 AND company_id = $2 AND is_active = TRUE LIMIT 1',
            [params.actor.id, params.companyId]
          );
          if (!mem.rows[0]) {
            return {
              ok: false,
              status: 403,
              code: 'TENANT_ISOLATION_VIOLATION',
              error: 'عزل المنشآت: لا تملك صلاحية تعديل بيانات هذه المنشأة.',
            };
          }
        }

        const existingRes = await tx.query('SELECT * FROM companies WHERE id = $1 LIMIT 1', [
          params.companyId,
        ]);
        if (!existingRes.rows[0]) {
          return {
            ok: false,
            status: 404,
            code: 'COMPANY_NOT_FOUND',
            error: 'المنشأة غير موجودة.',
          };
        }

        const p = params.patch;
        const updatedRes = await tx.query(
          `
          UPDATE companies
          SET name_ar = COALESCE(NULLIF($2, ''), name_ar),
              name_en = COALESCE(NULLIF($3, ''), name_en),
              country_code = COALESCE(NULLIF($4, ''), country_code),
              base_currency = COALESCE(NULLIF($5, ''), base_currency),
              valuation_policy = COALESCE(NULLIF($6, ''), valuation_policy),
              commercial_record = COALESCE($7, commercial_record),
              tax_number = COALESCE($8, tax_number),
              phone = COALESCE($9, phone),
              email = COALESCE($10, email),
              address = COALESCE($11, address),
              fiscal_year_start = COALESCE(NULLIF($12, ''), fiscal_year_start),
              status = COALESCE(NULLIF($13, ''), status),
              updated_at = NOW()
          WHERE id = $1
          RETURNING *
        `,
          [
            params.companyId,
            p.nameAr !== undefined ? String(p.nameAr).trim() : '',
            p.nameEn !== undefined ? String(p.nameEn).trim() : '',
            p.countryCode !== undefined ? String(p.countryCode).trim() : '',
            p.baseCurrency !== undefined ? String(p.baseCurrency).trim() : '',
            p.valuationPolicy !== undefined ? String(p.valuationPolicy).trim() : '',
            p.commercialRecord !== undefined ? String(p.commercialRecord) : null,
            p.taxNumber !== undefined ? String(p.taxNumber) : null,
            p.phone !== undefined ? String(p.phone) : null,
            p.email !== undefined ? String(p.email) : null,
            p.address !== undefined ? String(p.address) : null,
            p.fiscalYearStart !== undefined ? String(p.fiscalYearStart).trim() : '',
            p.status !== undefined && params.actor.isSuperAdmin ? String(p.status).trim() : '',
          ]
        );
        const updatedCompany = mapCompanyRow(updatedRes.rows[0]);

        // Keep company_state JSON profile aligned cleanly if row exists
        const stateRowRes = await tx.query<{ company_profile: unknown; state_json: unknown }>(
          'SELECT company_profile, state_json FROM company_state WHERE company_id = $1 LIMIT 1',
          [params.companyId]
        );
        if (stateRowRes.rows[0]) {
          const prevProfile = parseJsonCol<Record<string, unknown>>(stateRowRes.rows[0].company_profile, {});
          const prevState = parseJsonCol<Record<string, unknown>>(stateRowRes.rows[0].state_json, {});
          const mergedProfile = {
            ...prevProfile,
            ...updatedCompany,
            isActive: updatedCompany.status !== 'inactive' && updatedCompany.status !== 'suspended',
          };
          const mergedState = {
            ...prevState,
            company: {
              ...((prevState.company as Record<string, unknown>) || {}),
              ...mergedProfile,
            },
          };
          await tx.query(
            `
            UPDATE company_state
            SET company_profile = $2::jsonb,
                state_json = $3::jsonb,
                revision = revision + 1,
                updated_by_user_id = $4,
                updated_at = NOW()
            WHERE company_id = $1
          `,
            [params.companyId, JSON.stringify(mergedProfile), JSON.stringify(mergedState), params.actor.id]
          );
        }

        await tx.query(
          `
          INSERT INTO company_audit_logs (id, company_id, actor_user_id, actor_name, action, module, details, entity_id)
          VALUES ($1, $2, $3, $4, 'تعديل', 'الإعدادات', $5, $2)
        `,
          [
            `log-${crypto.randomUUID().slice(0, 10)}`,
            params.companyId,
            params.actor.id,
            params.actor.fullName,
            `تحديث بيانات المنشأة (${updatedCompany.nameAr}) في قاعدة البيانات`,
          ]
        );

        return { ok: true, company: updatedCompany };
      },
      params.actor.isSuperAdmin ? { bypassRls: true } : { companyId: params.companyId, userId: params.actor.id }
    );
  }

  async setCompanySubscriptionStatus(params: {
    actor: ServerUserRecord;
    companyId: string;
    status: 'active' | 'inactive' | 'suspended';
  }): Promise<
    | { ok: true; company: ServerCompanyRecord; license: ServerLicenseRecord }
    | { ok: false; status: number; code: string; error: string }
  > {
    if (!params.actor.isSuperAdmin) {
      return {
        ok: false,
        status: 403,
        code: 'FORBIDDEN_SUPER_ADMIN_ONLY',
        error: 'صلاحية مرفوضة: تفعيل أو تعطيل اشتراكات المنشآت مخصص لمالك المؤسسة (Super Admin) فقط.',
      };
    }

    return this.db.transaction(
      async (tx) => {
        const compRes = await tx.query(
          'UPDATE companies SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING *',
          [params.companyId, params.status]
        );
        if (!compRes.rows[0]) {
          return {
            ok: false,
            status: 404,
            code: 'COMPANY_NOT_FOUND',
            error: 'المنشأة غير موجودة.',
          };
        }
        const licenseStatus = params.status === 'active' ? 'active' : 'suspended';
        const licRes = await tx.query(
          `
          INSERT INTO company_licenses (company_id, license_mode, status, plan_code, updated_at)
          VALUES ($1, 'unrestricted', $2, 'standard', NOW())
          ON CONFLICT (company_id) DO UPDATE SET status = EXCLUDED.status, updated_at = NOW()
          RETURNING *
        `,
          [params.companyId, licenseStatus]
        );

        await tx.query(
          `
          INSERT INTO company_audit_logs (id, company_id, actor_user_id, actor_name, action, module, details, entity_id)
          VALUES ($1, $2, $3, $4, 'تعديل', 'النظام', $5, $2)
        `,
          [
            `log-${crypto.randomUUID().slice(0, 10)}`,
            params.companyId,
            params.actor.id,
            params.actor.fullName,
            `تغيير حالة اشتراك المنشأة إلى (${params.status}) بواسطة مالك المؤسسة`,
          ]
        );

        return {
          ok: true,
          company: mapCompanyRow(compRes.rows[0]),
          license: mapLicenseRow(licRes.rows[0], params.companyId),
        };
      },
      { bypassRls: true }
    );
  }

  async getCompanyState(
    userId: string,
    companyId: string
  ): Promise<
    | { ok: true; snapshot: CompanyStateSnapshot }
    | { ok: false; status: number; code: string; error: string }
  > {
    return this.db.transaction(
      async (tx) => {
        const mem = await tx.query<{ role: string }>(
          `
          SELECT role FROM company_memberships
          WHERE user_id = $1 AND company_id = $2 AND is_active = TRUE
          LIMIT 1
        `,
          [userId, companyId]
        );
        if (!mem.rows[0]) {
          return {
            ok: false,
            status: 403,
            code: 'TENANT_ISOLATION_VIOLATION',
            error: 'عزل المنشآت: لا تملك صلاحية قراءة بيانات هذه المنشأة.',
          };
        }

        const compRes = await tx.query('SELECT * FROM companies WHERE id = $1 LIMIT 1', [companyId]);
        if (!compRes.rows[0]) {
          return {
            ok: false,
            status: 404,
            code: 'COMPANY_NOT_FOUND',
            error: 'المنشأة غير موجودة.',
          };
        }
        const company = mapCompanyRow(compRes.rows[0]);

        const allCompaniesRes = await tx.query(
          `
          SELECT c.*
          FROM companies c
          INNER JOIN company_memberships m ON m.company_id = c.id
          WHERE m.user_id = $1 AND m.is_active = TRUE
          ORDER BY c.created_at ASC
        `,
          [userId]
        );

        const stateRes = await tx.query<{
          schema_version: string;
          revision: number;
          company_profile: unknown;
          state_json: unknown;
        }>('SELECT schema_version, revision, company_profile, state_json FROM company_state WHERE company_id = $1 LIMIT 1', [
          companyId,
        ]);

        const licRes = await tx.query('SELECT * FROM company_licenses WHERE company_id = $1 LIMIT 1', [
          companyId,
        ]);

        const usersRes = await tx.query(
          `
          SELECT u.id, u.username, u.full_name, u.email, u.is_super_admin, u.active,
                 u.must_change_password, u.company_id, u.last_active_company_id, u.updated_at,
                 m.role, m.branch_id, m.flags_json, m.permission_matrix
          FROM users u
          INNER JOIN company_memberships m ON m.user_id = u.id
          WHERE m.company_id = $1
          ORDER BY u.created_at ASC
        `,
          [companyId]
        );

        const logsRes = await tx.query(
          `
          SELECT id, company_id, actor_user_id, actor_name, action, module, details, entity_id, created_at
          FROM company_audit_logs
          WHERE company_id = $1
          ORDER BY created_at DESC
          LIMIT 200
        `,
          [companyId]
        );

        const companyUsers: PublicServerUser[] = usersRes.rows.map((r) => ({
          id: String(r.id),
          username: String(r.username),
          fullName: String(r.full_name),
          email: r.email ? String(r.email) : '',
          role: String(r.role),
          isSuperAdmin: Boolean(r.is_super_admin),
          allowedCompanyIds: [companyId],
          branchId: String(r.branch_id || 'br-01'),
          active: Boolean(r.active),
          mustChangePassword: Boolean(r.must_change_password),
          companyId: r.company_id ? String(r.company_id) : companyId,
          lastActiveCompanyId: r.last_active_company_id ? String(r.last_active_company_id) : null,
          flags: parseJsonCol<ServerUserFlags>(r.flags_json, {}),
          permissionMatrix: parseJsonCol<Record<string, unknown>>(r.permission_matrix, {}),
          updatedAt: r.updated_at ? new Date(String(r.updated_at)).toISOString() : new Date().toISOString(),
        }));

        const stateRow = stateRes.rows[0];
        const parsedState = stateRow
          ? parseJsonCol<Record<string, unknown> | null>(stateRow.state_json, null)
          : null;

        return {
          ok: true,
          snapshot: {
            companyId,
            revision: stateRow ? Number(stateRow.revision) : 0,
            schemaVersion: stateRow ? String(stateRow.schema_version) : '3.0.0',
            company,
            companies: allCompaniesRes.rows.map(mapCompanyRow),
            users: companyUsers,
            license: mapLicenseRow(licRes.rows[0], companyId),
            state: parsedState,
            auditLogs: logsRes.rows.map((l) => ({
              id: String(l.id),
              companyId: String(l.company_id),
              userId: l.actor_user_id ? String(l.actor_user_id) : '',
              userName: String(l.actor_name),
              action: String(l.action),
              module: String(l.module),
              details: String(l.details),
              entityId: l.entity_id ? String(l.entity_id) : undefined,
              timestamp: l.created_at ? new Date(String(l.created_at)).toISOString() : new Date().toISOString(),
            })),
          },
        };
      },
      { companyId, userId }
    );
  }

  async saveCompanyState(params: {
    userId: string;
    companyId: string;
    state: Record<string, unknown>;
    expectedRevision?: number;
  }): Promise<
    | { ok: true; revision: number; companyId: string }
    | { ok: false; status: number; code: string; error: string; serverRevision?: number }
  > {
    const validated = validateAndScopeStatePayload(params.state, params.companyId);
    if (!validated.ok) {
      return {
        ok: false,
        status: 403,
        code: 'TENANT_ISOLATION_VIOLATION',
        error: validated.error,
      };
    }

    return this.db.transaction(
      async (tx) => {
        const mem = await tx.query<{ role: string }>(
          `
          SELECT role FROM company_memberships
          WHERE user_id = $1 AND company_id = $2 AND is_active = TRUE
          LIMIT 1
        `,
          [params.userId, params.companyId]
        );
        if (!mem.rows[0]) {
          return {
            ok: false,
            status: 403,
            code: 'TENANT_ISOLATION_VIOLATION',
            error: 'عزل المنشآت: لا تملك صلاحية حفظ بيانات هذه المنشأة.',
          };
        }
        if (mem.rows[0].role === 'مستخدم محدود') {
          return {
            ok: false,
            status: 403,
            code: 'FORBIDDEN_ROLE',
            error: 'صلاحية مرفوضة: المستخدم المحدود لا يملك صلاحية تعديل بيانات المنشأة.',
          };
        }

        const existingRes = await tx.query<{ revision: number }>(
          'SELECT revision FROM company_state WHERE company_id = $1 FOR UPDATE',
          [params.companyId]
        );
        const currentRevision = existingRes.rows[0] ? Number(existingRes.rows[0].revision) : 0;

        if (
          params.expectedRevision !== undefined &&
          currentRevision > 0 &&
          currentRevision > params.expectedRevision
        ) {
          return {
            ok: false,
            status: 409,
            code: 'REVISION_CONFLICT',
            serverRevision: currentRevision,
            error: `تعارض تزامن البيانات: يوجد تحديث أحدث على الخادم (${currentRevision}).`,
          };
        }

        const nextRevision = currentRevision + 1;
        const companyProfile =
          (validated.state.company as Record<string, unknown> | undefined) || { id: params.companyId };
        const schemaVersion = String(validated.state.schemaVersion || '3.0.0');

        await tx.query(
          `
          UPDATE companies
          SET name_ar = COALESCE(NULLIF($2, ''), name_ar),
              name_en = COALESCE(NULLIF($3, ''), name_en),
              country_code = COALESCE(NULLIF($4, ''), country_code),
              base_currency = COALESCE(NULLIF($5, ''), base_currency),
              valuation_policy = COALESCE(NULLIF($6, ''), valuation_policy),
              commercial_record = COALESCE($7, commercial_record),
              tax_number = COALESCE($8, tax_number),
              phone = COALESCE($9, phone),
              email = COALESCE($10, email),
              address = COALESCE($11, address),
              updated_at = NOW()
          WHERE id = $1
        `,
          [
            params.companyId,
            String(companyProfile.nameAr || ''),
            String(companyProfile.nameEn || ''),
            String(companyProfile.countryCode || ''),
            String(companyProfile.baseCurrency || ''),
            String(companyProfile.valuationPolicy || ''),
            companyProfile.commercialRecord !== undefined ? String(companyProfile.commercialRecord) : null,
            companyProfile.taxNumber !== undefined ? String(companyProfile.taxNumber) : null,
            companyProfile.phone !== undefined ? String(companyProfile.phone) : null,
            companyProfile.email !== undefined ? String(companyProfile.email) : null,
            companyProfile.address !== undefined ? String(companyProfile.address) : null,
          ]
        );

        await tx.query(
          `
          INSERT INTO company_state (
            company_id, schema_version, revision, company_profile, state_json, updated_by_user_id, updated_at
          ) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, NOW())
          ON CONFLICT (company_id) DO UPDATE SET
            schema_version = EXCLUDED.schema_version,
            revision = EXCLUDED.revision,
            company_profile = EXCLUDED.company_profile,
            state_json = EXCLUDED.state_json,
            updated_by_user_id = EXCLUDED.updated_by_user_id,
            updated_at = NOW()
        `,
          [
            params.companyId,
            schemaVersion,
            nextRevision,
            JSON.stringify({ ...companyProfile, id: params.companyId }),
            JSON.stringify(validated.state),
            params.userId,
          ]
        );

        return { ok: true, revision: nextRevision, companyId: params.companyId };
      },
      { companyId: params.companyId, userId: params.userId }
    );
  }

  async restoreCompanyBackup(params: {
    actor: ServerUserRecord;
    sessionCompanyId: string;
    targetMode: 'current_company' | 'restored_company';
    targetCompanyId?: string;
    companyProfile?: Partial<ServerCompanyRecord>;
    state: Record<string, unknown>;
    expectedRevision?: number;
    allowReplaceExisting?: boolean;
    sourceLabel?: string;
  }): Promise<
    | {
        ok: true;
        company: ServerCompanyRecord;
        companies: ServerCompanyRecord[];
        activeCompanyId: string;
        revision: number;
        license: ServerLicenseRecord;
      }
    | { ok: false; status: number; code: string; error: string; serverRevision?: number }
  > {
    if (!params.state || typeof params.state !== 'object' || Array.isArray(params.state)) {
      return {
        ok: false,
        status: 400,
        code: 'INVALID_BACKUP_PAYLOAD',
        error: 'ملف النسخة الاحتياطية غير صالح أو فارغ.',
      };
    }

    const sessionCid = String(params.sessionCompanyId || '').trim();
    const rawRequestedTargetCid = String(
      params.targetCompanyId ||
        params.companyProfile?.id ||
        (params.state.company as { id?: unknown } | undefined)?.id ||
        ''
    ).trim();

    if (params.targetMode === 'current_company') {
      if (!sessionCid) {
        return {
          ok: false,
          status: 403,
          code: 'NO_COMPANY_ACCESS',
          error: 'لا توجد منشأة نشطة مصرح بها في الجلسة الحالية.',
        };
      }
      if (params.targetCompanyId && params.targetCompanyId.trim() !== sessionCid) {
        return {
          ok: false,
          status: 403,
          code: 'TENANT_ISOLATION_VIOLATION',
          error: `عزل المنشآت: لا يمكن الكتابة فوق منشأة أخرى (${params.targetCompanyId.trim()}) أثناء جلسة (${sessionCid}).`,
        };
      }
    } else if (params.targetMode === 'restored_company') {
      if (!params.actor.isSuperAdmin) {
        return {
          ok: false,
          status: 403,
          code: 'FORBIDDEN_SUPER_ADMIN_ONLY',
          error: 'صلاحية مرفوضة: استعادة نسخة كمنشأة مستقلة مخصص لمالك المؤسسة (Super Admin) فقط.',
        };
      }
      if (!rawRequestedTargetCid) {
        return {
          ok: false,
          status: 400,
          code: 'COMPANY_ID_REQUIRED',
          error: 'معرف المنشأة غير موجود في النسخة الاحتياطية.',
        };
      }
    } else {
      return {
        ok: false,
        status: 400,
        code: 'INVALID_RESTORE_MODE',
        error: 'وضع الاستعادة غير صالح.',
      };
    }

    const resolvedTargetCompanyId =
      params.targetMode === 'current_company' ? sessionCid : rawRequestedTargetCid;

    // Never import user credentials, passwords, or privilege matrices from backups
    const sanitizedInput: Record<string, unknown> = { ...params.state };
    delete sanitizedInput.users;
    delete sanitizedInput.companies;
    delete sanitizedInput.passwordHash;
    delete sanitizedInput.passwordSalt;

    const rawCompObj = (
      (sanitizedInput.company && typeof sanitizedInput.company === 'object'
        ? sanitizedInput.company
        : {}) as Record<string, unknown>
    );

    if (params.targetMode === 'current_company') {
      sanitizedInput.company = { ...rawCompObj, id: resolvedTargetCompanyId };
      sanitizedInput.activeCompanyId = resolvedTargetCompanyId;
      for (const key of TENANT_SCOPED_COLLECTIONS) {
        const val = sanitizedInput[key];
        if (!Array.isArray(val)) continue;
        sanitizedInput[key] = val.map((item) =>
          item && typeof item === 'object'
            ? { ...(item as Record<string, unknown>), companyId: resolvedTargetCompanyId }
            : item
        );
      }
    } else {
      // Preserve explicit foreign ID rejection if state.company.id contradicts targetCompanyId, while filling missing companyId on legacy rows
      if (!rawCompObj.id) {
        sanitizedInput.company = { ...rawCompObj, id: resolvedTargetCompanyId };
      }
      if (!sanitizedInput.activeCompanyId) {
        sanitizedInput.activeCompanyId = resolvedTargetCompanyId;
      }
      for (const key of TENANT_SCOPED_COLLECTIONS) {
        const val = sanitizedInput[key];
        if (!Array.isArray(val)) continue;
        sanitizedInput[key] = val.map((item) => {
          if (!item || typeof item !== 'object') return item;
          const rec = item as Record<string, unknown>;
          if (rec.companyId === undefined || rec.companyId === null || String(rec.companyId).trim() === '') {
            return { ...rec, companyId: resolvedTargetCompanyId };
          }
          return rec;
        });
      }
    }

    const validated = validateAndScopeStatePayload(sanitizedInput, resolvedTargetCompanyId);
    if (!validated.ok) {
      return {
        ok: false,
        status: 403,
        code: 'TENANT_ISOLATION_VIOLATION',
        error: validated.error,
      };
    }

    const profileSource = {
      ...rawCompObj,
      ...(params.companyProfile || {}),
    } as Partial<ServerCompanyRecord>;
    const schemaVersion = String(validated.state.schemaVersion || '3.0.0');
    const cleanNameAr = String(profileSource.nameAr || 'منشأة مستعادة').trim() || 'منشأة مستعادة';
    const cleanNameEn = String(profileSource.nameEn || cleanNameAr).trim() || cleanNameAr;
    const cleanCountryCode = String(profileSource.countryCode || 'YE').trim() || 'YE';
    const cleanBaseCurrency = String(profileSource.baseCurrency || 'YER').trim() || 'YER';
    const cleanValuation = String(profileSource.valuationPolicy || 'PER_ITEM').trim() || 'PER_ITEM';
    const cleanCommercial = String(profileSource.commercialRecord || '');
    const cleanTax = String(profileSource.taxNumber || '');
    const cleanPhone = String(profileSource.phone || '');
    const cleanEmail = String(profileSource.email || '');
    const cleanAddress = String(profileSource.address || '');
    const cleanFiscalStart = String(profileSource.fiscalYearStart || '2026-01-01');

    return this.db.transaction(
      async (tx) => {
        const existingCompRes = await tx.query('SELECT * FROM companies WHERE id = $1 FOR UPDATE', [
          resolvedTargetCompanyId,
        ]);
        const memRes = await tx.query<{ role: string; is_active: boolean }>(
          'SELECT role, is_active FROM company_memberships WHERE user_id = $1 AND company_id = $2 LIMIT 1',
          [params.actor.id, resolvedTargetCompanyId]
        );

        let savedCompany: ServerCompanyRecord;
        let savedRevision = 1;
        let savedLicense: ServerLicenseRecord;

        if (existingCompRes.rows[0]) {
          // Existing company: require active admin membership
          const memRow = memRes.rows[0];
          if (!memRow || !memRow.is_active) {
            return {
              ok: false,
              status: 403,
              code: 'TENANT_ISOLATION_VIOLATION',
              error: `عزل المنشآت: لا تملك عضوية نشطة مصرح بها لاستعادة البيانات داخل المنشأة (${resolvedTargetCompanyId}).`,
            };
          }

          const memRole = String(memRow.role || '');
          const isAdminMem =
            memRole === 'مالك المؤسسة' ||
            memRole === 'مدير النظام' ||
            memRole === 'Tenant Admin' ||
            Boolean(params.actor.isSuperAdmin);
          if (!isAdminMem) {
            return {
              ok: false,
              status: 403,
              code: 'FORBIDDEN_ROLE',
              error: `صلاحية مرفوضة: الدور (${memRole || 'غير معروف'}) لا يملك صلاحية استعادة النسخ الاحتياطية.`,
            };
          }

          if (params.targetMode === 'restored_company' && !params.allowReplaceExisting) {
            return {
              ok: false,
              status: 409,
              code: 'COMPANY_ALREADY_EXISTS',
              error: `المنشأة (${resolvedTargetCompanyId}) موجودة مسبقاً في قاعدة البيانات. اختر تأكيد الاستبدال أو الاستعادة داخل المنشأة النشطة.`,
            };
          }

          const stateRowRes = await tx.query<{ revision: number }>(
            'SELECT revision FROM company_state WHERE company_id = $1 FOR UPDATE',
            [resolvedTargetCompanyId]
          );
          const currentRevision = stateRowRes.rows[0] ? Number(stateRowRes.rows[0].revision) : 0;

          if (
            params.expectedRevision !== undefined &&
            currentRevision > 0 &&
            currentRevision > params.expectedRevision
          ) {
            return {
              ok: false,
              status: 409,
              code: 'REVISION_CONFLICT',
              serverRevision: currentRevision,
              error: `تعارض تزامن البيانات: يوجد تحديث أحدث على الخادم (الإصدار ${currentRevision}). يرجى تحديث الصفحة والمحاولة مجدداً.`,
            };
          }

          const updatedCompRes = await tx.query(
            `
            UPDATE companies
            SET name_ar = COALESCE(NULLIF($2, ''), name_ar),
                name_en = COALESCE(NULLIF($3, ''), name_en),
                country_code = COALESCE(NULLIF($4, ''), country_code),
                base_currency = COALESCE(NULLIF($5, ''), base_currency),
                valuation_policy = COALESCE(NULLIF($6, ''), valuation_policy),
                commercial_record = $7,
                tax_number = $8,
                phone = $9,
                email = $10,
                address = $11,
                fiscal_year_start = COALESCE(NULLIF($12, ''), fiscal_year_start),
                updated_at = NOW()
            WHERE id = $1
            RETURNING *
          `,
            [
              resolvedTargetCompanyId,
              cleanNameAr,
              cleanNameEn,
              cleanCountryCode,
              cleanBaseCurrency,
              cleanValuation,
              cleanCommercial,
              cleanTax,
              cleanPhone,
              cleanEmail,
              cleanAddress,
              cleanFiscalStart,
            ]
          );
          savedCompany = mapCompanyRow(updatedCompRes.rows[0]);

          await tx.query(
            `
            INSERT INTO company_licenses (company_id, license_mode, status, plan_code)
            VALUES ($1, 'unrestricted', 'active', 'standard')
            ON CONFLICT (company_id) DO NOTHING
          `,
            [resolvedTargetCompanyId]
          );
          const licRes = await tx.query('SELECT * FROM company_licenses WHERE company_id = $1 LIMIT 1', [
            resolvedTargetCompanyId,
          ]);
          savedLicense = mapLicenseRow(licRes.rows[0], resolvedTargetCompanyId);

          savedRevision = currentRevision + 1;
          const profilePayload = {
            ...savedCompany,
            isActive: savedCompany.status !== 'inactive' && savedCompany.status !== 'suspended',
          };
          const finalState = {
            ...validated.state,
            schemaVersion,
            company: profilePayload,
            activeCompanyId: resolvedTargetCompanyId,
          };

          await tx.query(
            `
            INSERT INTO company_state (
              company_id, schema_version, revision, company_profile, state_json, updated_by_user_id, updated_at
            ) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, NOW())
            ON CONFLICT (company_id) DO UPDATE SET
              schema_version = EXCLUDED.schema_version,
              revision = EXCLUDED.revision,
              company_profile = EXCLUDED.company_profile,
              state_json = EXCLUDED.state_json,
              updated_by_user_id = EXCLUDED.updated_by_user_id,
              updated_at = NOW()
          `,
            [
              resolvedTargetCompanyId,
              schemaVersion,
              savedRevision,
              JSON.stringify(profilePayload),
              JSON.stringify(finalState),
              params.actor.id,
            ]
          );
        } else {
          // New company creation during restore: strictly Super Admin + restored_company mode
          if (params.targetMode !== 'restored_company') {
            return {
              ok: false,
              status: 404,
              code: 'COMPANY_NOT_FOUND',
              error: 'المنشأة النشطة غير موجودة في قاعدة البيانات.',
            };
          }
          if (!params.actor.isSuperAdmin) {
            return {
              ok: false,
              status: 403,
              code: 'FORBIDDEN_SUPER_ADMIN_ONLY',
              error: 'صلاحية مرفوضة: إنشاء مؤسسة مستقلة أثناء الاستعادة مخصص لمالك المؤسسة (Super Admin) فقط.',
            };
          }

          const insertedCompRes = await tx.query(
            `
            INSERT INTO companies (
              id, name_ar, name_en, country_code, base_currency, valuation_policy,
              commercial_record, tax_number, phone, email, address, fiscal_year_start, status, created_by_user_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'active', $13)
            RETURNING *
          `,
            [
              resolvedTargetCompanyId,
              cleanNameAr,
              cleanNameEn,
              cleanCountryCode,
              cleanBaseCurrency,
              cleanValuation,
              cleanCommercial,
              cleanTax,
              cleanPhone,
              cleanEmail,
              cleanAddress,
              cleanFiscalStart,
              params.actor.id,
            ]
          );
          savedCompany = mapCompanyRow(insertedCompRes.rows[0]);

          const creatorRole =
            params.actor.isSuperAdmin || params.actor.role === 'مالك المؤسسة'
              ? params.actor.role
              : 'Tenant Admin';
          const adminFlags: ServerUserFlags = {
            canViewReports: true,
            canPostEntries: true,
            canAdjustInventory: true,
            canViewCostsAndProfits: true,
            canManageSettings: true,
            canEditInvoices: true,
            canDeleteInvoices: true,
            canEditVouchers: true,
            canDeleteVouchers: true,
            canEditExchangeRates: true,
          };
          const starterBranchId =
            (Array.isArray(validated.state.branches) &&
              (validated.state.branches as Array<{ id?: string; companyId?: string }>).find(
                (b) => b.companyId === resolvedTargetCompanyId
              )?.id) ||
            `br-${resolvedTargetCompanyId}`;

          await tx.query(
            `
            INSERT INTO company_memberships (
              user_id, company_id, role, branch_id, permission_matrix, flags_json, is_active
            ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, TRUE)
          `,
            [
              params.actor.id,
              resolvedTargetCompanyId,
              creatorRole,
              starterBranchId,
              JSON.stringify({
                '*': {
                  view: true,
                  create: true,
                  edit: true,
                  delete: true,
                  post: true,
                  approve: true,
                  export: true,
                  print: true,
                  manageSettings: true,
                  viewCosts: true,
                },
              }),
              JSON.stringify(adminFlags),
            ]
          );

          const licInsertRes = await tx.query(
            `
            INSERT INTO company_licenses (company_id, license_mode, status, plan_code)
            VALUES ($1, 'unrestricted', 'active', 'standard')
            RETURNING *
          `,
            [resolvedTargetCompanyId]
          );
          savedLicense = mapLicenseRow(licInsertRes.rows[0], resolvedTargetCompanyId);

          savedRevision = 1;
          const profilePayload = {
            ...savedCompany,
            isActive: true,
          };
          const finalState = {
            ...validated.state,
            schemaVersion,
            company: profilePayload,
            activeCompanyId: resolvedTargetCompanyId,
          };

          await tx.query(
            `
            INSERT INTO company_state (
              company_id, schema_version, revision, company_profile, state_json, updated_by_user_id, updated_at
            ) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, NOW())
          `,
            [
              resolvedTargetCompanyId,
              schemaVersion,
              savedRevision,
              JSON.stringify(profilePayload),
              JSON.stringify(finalState),
              params.actor.id,
            ]
          );
        }

        const sourceNote = params.sourceLabel ? ` (${params.sourceLabel})` : '';
        await tx.query(
          `
          INSERT INTO company_audit_logs (id, company_id, actor_user_id, actor_name, action, module, details, entity_id)
          VALUES ($1, $2, $3, $4, 'استعادة', 'الإعدادات', $5, $2)
        `,
          [
            `log-${crypto.randomUUID().slice(0, 10)}`,
            resolvedTargetCompanyId,
            params.actor.id,
            params.actor.fullName,
            `اعتماد استعادة وترحيل النسخة الاحتياطية للمنشأة (${savedCompany.nameAr})${sourceNote}`,
          ]
        );

        await tx.query(
          'UPDATE users SET company_id = COALESCE(company_id, $1), last_active_company_id = $1, updated_at = NOW() WHERE id = $2',
          [resolvedTargetCompanyId, params.actor.id]
        );

        const allRes = await tx.query(
          `
          SELECT c.*
          FROM companies c
          INNER JOIN company_memberships m ON m.company_id = c.id
          WHERE m.user_id = $1 AND m.is_active = TRUE
          ORDER BY c.created_at ASC
        `,
          [params.actor.id]
        );

        return {
          ok: true,
          company: savedCompany,
          companies: allRes.rows.map(mapCompanyRow),
          activeCompanyId: resolvedTargetCompanyId,
          revision: savedRevision,
          license: savedLicense,
        };
      },
      { companyId: resolvedTargetCompanyId, userId: params.actor.id }
    );
  }

  async listCompanyUsers(
    actorUserId: string,
    companyId: string
  ): Promise<{ ok: true; users: PublicServerUser[] } | { ok: false; status: number; code: string; error: string }> {
    return this.db.transaction(
      async (tx) => {
        const mem = await tx.query<{ role: string }>(
          'SELECT role FROM company_memberships WHERE user_id = $1 AND company_id = $2 AND is_active = TRUE LIMIT 1',
          [actorUserId, companyId]
        );
        if (!mem.rows[0]) {
          return {
            ok: false,
            status: 403,
            code: 'TENANT_ISOLATION_VIOLATION',
            error: 'عزل المنشآت: غير مصرح بعرض مستخدمي هذه المنشأة.',
          };
        }

        const res = await tx.query(
          `
          SELECT u.id, u.username, u.full_name, u.email, u.phone, u.is_super_admin, u.active,
                 u.must_change_password, u.session_version, u.password_changed_at,
                 u.company_id, u.last_active_company_id, u.updated_at,
                 m.role, m.branch_id, m.flags_json, m.permission_matrix
          FROM users u
          INNER JOIN company_memberships m ON m.user_id = u.id
          WHERE m.company_id = $1
          ORDER BY u.created_at ASC
        `,
          [companyId]
        );
        return {
          ok: true,
          users: res.rows.map((r) => ({
            id: String(r.id),
            username: String(r.username),
            fullName: String(r.full_name),
            email: r.email ? String(r.email) : '',
            phone: r.phone ? String(r.phone) : '',
            role: String(r.role),
            isSuperAdmin: Boolean(r.is_super_admin),
            allowedCompanyIds: [companyId],
            branchId: String(r.branch_id || 'br-01'),
            active: Boolean(r.active),
            mustChangePassword: Boolean(r.must_change_password),
            sessionVersion: Math.max(1, Number(r.session_version ?? 1) || 1),
            passwordChangedAt: r.password_changed_at
              ? new Date(String(r.password_changed_at)).toISOString()
              : null,
            companyId: r.company_id ? String(r.company_id) : companyId,
            lastActiveCompanyId: r.last_active_company_id ? String(r.last_active_company_id) : null,
            flags: parseJsonCol<ServerUserFlags>(r.flags_json, {}),
            permissionMatrix: parseJsonCol<Record<string, unknown>>(r.permission_matrix, {}),
            updatedAt: r.updated_at ? new Date(String(r.updated_at)).toISOString() : new Date().toISOString(),
          })),
        };
      },
      { companyId, userId: actorUserId }
    );
  }

  async upsertCompanyUser(params: {
    actor: ServerUserRecord;
    companyId: string;
    targetUser: {
      id: string;
      username: string;
      fullName: string;
      email?: string;
      phone?: string;
      role: string;
      isSuperAdmin?: boolean;
      branchId?: string;
      active?: boolean;
      passwordHash?: string;
      passwordSalt?: string;
      mustChangePassword?: boolean;
      flags?: ServerUserFlags;
      permissionMatrix?: Record<string, unknown>;
      allowedCompanyIds?: string[];
    };
  }): Promise<
    | { ok: true; user: PublicServerUser; created: boolean }
    | { ok: false; status: number; code: string; error: string }
  > {
    if ((params.targetUser.isSuperAdmin || params.targetUser.role === 'مالك المؤسسة') && !params.actor.isSuperAdmin) {
      return {
        ok: false,
        status: 403,
        code: 'FORBIDDEN_SUPER_ADMIN_ESCALATION',
        error: 'صلاحية مرفوضة: مدير المنشأة لا يملك صلاحية منح صفة Super Admin أو دور مالك المؤسسة.',
      };
    }

    const actorCompanies = new Set(params.actor.allowedCompanyIds || []);
    const targetAllowed = Array.isArray(params.targetUser.allowedCompanyIds)
      ? params.targetUser.allowedCompanyIds.map((c) => String(c).trim()).filter(Boolean)
      : [params.companyId];

    // If non-super-admin attempts to assign a company outside their authorized companies -> 403
    if (!params.actor.isSuperAdmin && targetAllowed.some((cid) => !actorCompanies.has(cid))) {
      return {
        ok: false,
        status: 403,
        code: 'TENANT_ISOLATION_VIOLATION',
        error: 'عزل المنشآت: لا يمكنك إسناد مستخدم إلى منشأة لا تملك صلاحيتها.',
      };
    }

    return this.db.transaction(
      async (tx) => {
        // Verify actor has active admin membership on companyId
        const actorMem = await tx.query<{ role: string; flags_json: unknown }>(
          'SELECT role, flags_json FROM company_memberships WHERE user_id = $1 AND company_id = $2 AND is_active = TRUE LIMIT 1',
          [params.actor.id, params.companyId]
        );
        if (!actorMem.rows[0] && !params.actor.isSuperAdmin) {
          return {
            ok: false,
            status: 403,
            code: 'TENANT_ISOLATION_VIOLATION',
            error: 'عزل المنشآت: لا تملك عضوية إدارية في هذه المنشأة.',
          };
        }

        const existingRes = await tx.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [
          params.targetUser.id,
        ]);
        const existing = existingRes.rows[0];
        let nextSessionVersion = Math.max(1, Number(existing?.session_version ?? 1) || 1);
        const cleanPhone =
          params.targetUser.phone !== undefined
            ? String(params.targetUser.phone).trim()
            : String(existing?.phone || '').trim();
        const normalizedPhone = normalizePhoneForStorage(cleanPhone) || null;

        if (existing) {
          const targetIsSuperAdmin =
            Boolean(existing.is_super_admin) || String(existing.role || '').trim() === 'مالك المؤسسة';
          if (targetIsSuperAdmin && !params.actor.isSuperAdmin) {
            await tx.query(
              `
              INSERT INTO company_audit_logs (id, company_id, actor_user_id, actor_name, action, module, details, entity_id)
              VALUES ($1, $2, $3, $4, 'رفض', 'النظام', $5, $6)
            `,
              [
                `log-${crypto.randomUUID().slice(0, 10)}`,
                params.companyId,
                params.actor.id,
                params.actor.fullName,
                `رفض محاولة غير مخولة لتعديل أو إعادة تعيين حساب مدير النظام الأعلى (${String(existing.username)})`,
                params.targetUser.id,
              ]
            );
            return {
              ok: false,
              status: 403,
              code: 'FORBIDDEN_SUPER_ADMIN_PROTECTION',
              error:
                'صلاحية مرفوضة: لا يملك مدير المنشأة صلاحية تعديل أو تعطيل أو تغيير كلمة مرور حساب مدير النظام الأعلى (Super Admin).',
            };
          }

          // Verify existing user belongs to this company (or actor is Super Admin)
          const targetMem = await tx.query(
            'SELECT 1 FROM company_memberships WHERE user_id = $1 AND company_id = $2 LIMIT 1',
            [params.targetUser.id, params.companyId]
          );
          if (targetMem.rows.length === 0 && !params.actor.isSuperAdmin) {
            return {
              ok: false,
              status: 403,
              code: 'TENANT_ISOLATION_VIOLATION',
              error: 'عزل المنشآت: لا يمكنك تعديل مستخدم ينتمي لمنشأة أخرى.',
            };
          }

          const passwordChanged = Boolean(params.targetUser.passwordHash && params.targetUser.passwordSalt);
          const nextActive =
            params.targetUser.active !== undefined ? Boolean(params.targetUser.active) : Boolean(existing.active);
          const shouldRevokeSessions = passwordChanged || (!nextActive && Boolean(existing.active));
          nextSessionVersion = shouldRevokeSessions ? nextSessionVersion + 1 : nextSessionVersion;

          await tx.query(
            `
            UPDATE users
            SET username = $2,
                full_name = $3,
                email = COALESCE(NULLIF($4, ''), email),
                phone = $5,
                phone_normalized = $6,
                role = $7,
                branch_id = $8,
                active = $9,
                password_hash = COALESCE(NULLIF($10, ''), password_hash),
                password_salt = COALESCE(NULLIF($11, ''), password_salt),
                must_change_password = $12,
                session_version = $13,
                password_changed_at = CASE WHEN $14::boolean THEN NOW() ELSE password_changed_at END,
                company_id = COALESCE(company_id, $16),
                flags_json = $15::jsonb,
                updated_at = NOW()
            WHERE id = $1
          `,
            [
              params.targetUser.id,
              params.targetUser.username,
              params.targetUser.fullName,
              params.targetUser.email || '',
              cleanPhone,
              normalizedPhone,
              params.targetUser.role,
              params.targetUser.branchId || String(existing.branch_id || 'br-01'),
              nextActive,
              params.targetUser.passwordHash || '',
              params.targetUser.passwordSalt || '',
              params.targetUser.mustChangePassword !== undefined
                ? Boolean(params.targetUser.mustChangePassword)
                : Boolean(existing.must_change_password),
              nextSessionVersion,
              passwordChanged,
              JSON.stringify(params.targetUser.flags || parseJsonCol(existing.flags_json, {})),
              targetAllowed[0] || params.companyId,
            ]
          );
        } else {
          if (!params.targetUser.passwordHash || !params.targetUser.passwordSalt) {
            return {
              ok: false,
              status: 400,
              code: 'PASSWORD_REQUIRED',
              error: 'يجب تعيين كلمة مرور قوية عند إنشاء مستخدم جديد.',
            };
          }

          const dupUser = await tx.query(
            'SELECT id FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1',
            [params.targetUser.username.trim()]
          );
          if (dupUser.rows.length > 0) {
            return {
              ok: false,
              status: 409,
              code: 'USERNAME_EXISTS',
              error: 'اسم المستخدم مسجل مسبقاً لمستخدم آخر.',
            };
          }

          nextSessionVersion = 1;
          await tx.query(
            `
            INSERT INTO users (
              id, username, full_name, email, phone, phone_normalized, role, is_super_admin, branch_id, active,
              password_hash, password_salt, must_change_password, session_version, password_changed_at,
              company_id, last_active_company_id, flags_json
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 1, NOW(), $14, $14, $15::jsonb)
          `,
            [
              params.targetUser.id,
              params.targetUser.username.trim(),
              params.targetUser.fullName.trim(),
              params.targetUser.email || `${params.targetUser.username.trim()}@almansoor.erp`,
              cleanPhone,
              normalizedPhone,
              params.targetUser.role,
              Boolean(params.actor.isSuperAdmin && params.targetUser.isSuperAdmin),
              params.targetUser.branchId || 'br-01',
              params.targetUser.active !== false,
              params.targetUser.passwordHash,
              params.targetUser.passwordSalt,
              Boolean(params.targetUser.mustChangePassword),
              targetAllowed[0] || params.companyId,
              JSON.stringify(params.targetUser.flags || {}),
            ]
          );
        }

        const companiesToLink = targetAllowed.length > 0 ? targetAllowed : [params.companyId];
        // Update membership inside the active company
        await tx.query(
          `
          INSERT INTO company_memberships (
            user_id, company_id, role, branch_id, permission_matrix, flags_json, is_active
          ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)
          ON CONFLICT (user_id, company_id) DO UPDATE SET
            role = EXCLUDED.role,
            branch_id = EXCLUDED.branch_id,
            permission_matrix = EXCLUDED.permission_matrix,
            flags_json = EXCLUDED.flags_json,
            is_active = EXCLUDED.is_active,
            updated_at = NOW()
        `,
          [
            params.targetUser.id,
            params.companyId,
            params.targetUser.role,
            params.targetUser.branchId || 'br-01',
            JSON.stringify(params.targetUser.permissionMatrix || {}),
            JSON.stringify(params.targetUser.flags || {}),
            params.targetUser.active !== false,
          ]
        );

        // If user explicitly provided zero companies (e.g. legacy test), revoke active membership if empty
        if (Array.isArray(params.targetUser.allowedCompanyIds) && params.targetUser.allowedCompanyIds.length === 0) {
          await tx.query('DELETE FROM company_memberships WHERE user_id = $1', [params.targetUser.id]);
        } else {
          for (const cid of companiesToLink) {
            if (cid === params.companyId) continue;
            await tx.query("SELECT set_config('app.current_company_id', $1, true)", [cid]);
            await tx.query(
              `
              INSERT INTO company_memberships (
                user_id, company_id, role, branch_id, permission_matrix, flags_json, is_active
              ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, TRUE)
              ON CONFLICT (user_id, company_id) DO NOTHING
            `,
              [
                params.targetUser.id,
                cid,
                params.targetUser.role,
                params.targetUser.branchId || 'br-01',
                JSON.stringify(params.targetUser.permissionMatrix || {}),
                JSON.stringify(params.targetUser.flags || {}),
              ]
            );
          }
          await tx.query("SELECT set_config('app.current_company_id', $1, true)", [params.companyId]);
        }

        await tx.query(
          `
          INSERT INTO company_audit_logs (id, company_id, actor_user_id, actor_name, action, module, details, entity_id)
          VALUES ($1, $2, $3, $4, $5, 'النظام', $6, $7)
        `,
          [
            `log-${crypto.randomUUID().slice(0, 10)}`,
            params.companyId,
            params.actor.id,
            params.actor.fullName,
            existing ? 'تعديل' : 'إنشاء',
            `${existing ? 'تحديث بيانات وصلاحيات' : 'إنشاء'} المستخدم (${params.targetUser.fullName} - ${params.targetUser.role})`,
            params.targetUser.id,
          ]
        );

        const publicUser: PublicServerUser = {
          id: params.targetUser.id,
          username: params.targetUser.username,
          fullName: params.targetUser.fullName,
          email: params.targetUser.email || (existing?.email ? String(existing.email) : ''),
          phone: cleanPhone,
          role: params.targetUser.role,
          isSuperAdmin: existing
            ? Boolean(existing.is_super_admin)
            : Boolean(params.actor.isSuperAdmin && params.targetUser.isSuperAdmin),
          allowedCompanyIds: Array.isArray(params.targetUser.allowedCompanyIds)
            ? params.targetUser.allowedCompanyIds
            : [params.companyId],
          companyId: targetAllowed[0] || params.companyId,
          branchId: params.targetUser.branchId || 'br-01',
          active: params.targetUser.active !== false,
          mustChangePassword: Boolean(params.targetUser.mustChangePassword),
          sessionVersion: nextSessionVersion,
          flags: params.targetUser.flags,
          permissionMatrix: params.targetUser.permissionMatrix,
          updatedAt: new Date().toISOString(),
        };

        return { ok: true, user: publicUser, created: !existing };
      },
      { companyId: params.companyId, userId: params.actor.id }
    );
  }

  async getAdminOverview(): Promise<{
    totalCompanies: number;
    totalUsers: number;
    companies: Array<{
      id: string;
      nameAr: string;
      countryCode: string;
      baseCurrency: string;
      status: string;
      licenseStatus: string;
      planCode: string;
      createdAt: string;
    }>;
  }> {
    return this.db.transaction(
      async (tx) => {
        const compRes = await tx.query(`
          SELECT c.id, c.name_ar, c.country_code, c.base_currency, c.status, c.created_at,
                 COALESCE(l.status, 'active') AS license_status,
                 COALESCE(l.plan_code, 'standard') AS plan_code
          FROM companies c
          LEFT JOIN company_licenses l ON l.company_id = c.id
          ORDER BY c.created_at ASC
        `);
        const usrRes = await tx.query<{ cnt: number }>('SELECT COUNT(*)::int AS cnt FROM users');
        return {
          totalCompanies: compRes.rows.length,
          totalUsers: Number(usrRes.rows[0]?.cnt || 0),
          companies: compRes.rows.map((r) => ({
            id: String(r.id),
            nameAr: String(r.name_ar),
            countryCode: String(r.country_code),
            baseCurrency: String(r.base_currency),
            status: String(r.status),
            licenseStatus: String(r.license_status),
            planCode: String(r.plan_code),
            createdAt: r.created_at ? new Date(String(r.created_at)).toISOString() : new Date().toISOString(),
          })),
        };
      },
      { bypassRls: true }
    );
  }
}
