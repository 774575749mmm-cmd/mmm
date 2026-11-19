/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Cloud Data-Access Boundary Service
 * Authoritative PostgreSQL REST Client (Cleanly separable for future Electron/SQLite offline repository swap)
 */

import {
  Account,
  Company,
  CountryPackCode,
  Currency,
  SystemSettings,
  TreasuryAccount,
  User,
  UserRoleType,
} from '../types/erp';
import {
  CURRENT_SCHEMA_VERSION,
  ERPDatabase,
  getInitialDatabase,
  migrateDatabase,
  scopeDatabaseToCompany,
} from './storageService';
import { initialChartOfAccounts } from '../data/initialData';
import { buildUserRoleMatrix } from './securityService';
import type { LicenseEvaluationResult } from './licenseBoundaryService';

export interface ServerPublicUserDto {
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
  mustChangePassword?: boolean;
  sessionVersion?: number;
  passwordChangedAt?: string | null;
  companyId?: string | null;
  lastActiveCompanyId?: string | null;
  flags?: {
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
  };
  permissionMatrix?: Record<string, unknown>;
}

export interface ServerCompanyDto {
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
  createdAt?: string;
}

export interface AuthStatusPayload {
  ok: boolean;
  initialized: boolean;
  authenticated: boolean;
  sessionRevoked?: boolean;
  user: ServerPublicUserDto | null;
  companies: ServerCompanyDto[];
  activeCompanyId: string | null;
  licenseBoundary?: LicenseEvaluationResult;
}

export interface CompanyStatePayload {
  ok: boolean;
  companyId: string;
  revision: number;
  schemaVersion?: string;
  company: ServerCompanyDto;
  companies: ServerCompanyDto[];
  users: ServerPublicUserDto[];
  licenseBoundary?: LicenseEvaluationResult;
  state: Record<string, unknown> | null;
  auditLogs?: Array<{
    id: string;
    companyId?: string;
    userId: string;
    userName: string;
    action: string;
    module: string;
    details: string;
    entityId?: string;
    timestamp: string;
  }>;
}

export function serverCompanyToErpCompany(c: ServerCompanyDto): Company {
  return {
    id: c.id,
    nameAr: c.nameAr,
    nameEn: c.nameEn || c.nameAr,
    countryCode: (c.countryCode as CountryPackCode) || 'YE',
    baseCurrency: c.baseCurrency || 'YER',
    valuationPolicy: (c.valuationPolicy as Company['valuationPolicy']) || 'PER_ITEM',
    commercialRecord: c.commercialRecord || '',
    taxNumber: c.taxNumber || '',
    phone: c.phone || '',
    email: c.email || '',
    address: c.address || '',
    fiscalYearStart: c.fiscalYearStart || '2026-01-01',
    isActive: c.status !== 'inactive',
    createdAt: c.createdAt,
  };
}

export function serverUserToErpUser(su: ServerPublicUserDto): User {
  const role = (su.role || 'مستخدم محدود') as UserRoleType;
  const isAdminRole =
    role === 'مالك المؤسسة' || role === 'مدير النظام' || role === 'Tenant Admin';
  const flags = su.flags || {};

  return {
    id: su.id,
    username: su.username,
    fullName: su.fullName,
    role,
    isSuperAdmin: Boolean(su.isSuperAdmin),
    branchId: su.branchId || 'br-01',
    allowedCompanyIds: Array.isArray(su.allowedCompanyIds) ? [...su.allowedCompanyIds] : [],
    email: su.email || `${su.username}@almansoor.erp`,
    phone: su.phone || '',
    active: su.active !== false,
    mustChangePassword: Boolean(su.mustChangePassword),
    canViewReports: flags.canViewReports ?? true,
    canPostEntries: flags.canPostEntries ?? (role !== 'مستخدم محدود'),
    canAdjustInventory:
      flags.canAdjustInventory ?? (isAdminRole || role === 'المدير المالي' || role === 'مسؤول المخزون'),
    canViewCostsAndProfits:
      flags.canViewCostsAndProfits ?? (isAdminRole || role === 'المدير المالي' || role === 'محاسب'),
    canManageSettings: flags.canManageSettings ?? isAdminRole,
    canEditInvoices: flags.canEditInvoices ?? (role !== 'مستخدم محدود'),
    canDeleteInvoices: flags.canDeleteInvoices ?? isAdminRole,
    canEditVouchers: flags.canEditVouchers ?? (role !== 'مستخدم محدود'),
    canDeleteVouchers: flags.canDeleteVouchers ?? isAdminRole,
    canEditExchangeRates: flags.canEditExchangeRates ?? isAdminRole,
    permissionMatrix:
      su.permissionMatrix && Object.keys(su.permissionMatrix).length > 0
        ? (su.permissionMatrix as User['permissionMatrix'])
        : buildUserRoleMatrix(role),
  };
}

function buildCleanZeroCoaForCompany(companyId: string): Account[] {
  return initialChartOfAccounts.map((acc) => ({
    ...acc,
    id: `${acc.id}-${companyId}`,
    companyId,
    currentBalance: 0,
    importedDebit: 0,
    importedCredit: 0,
    isActive: acc.isActive !== false,
  }));
}

export function hydrateErpDatabaseFromServerState(
  snapshot: CompanyStatePayload,
  localSeedIfMissing?: ERPDatabase
): ERPDatabase {
  const companyId = snapshot.companyId;
  const primaryCompany = serverCompanyToErpCompany(snapshot.company);
  const authorizedCompanies = (snapshot.companies || []).map(serverCompanyToErpCompany);
  const erpUsers = (snapshot.users || []).map(serverUserToErpUser);

  const rawState = (snapshot.state || {}) as Partial<ERPDatabase>;
  const hasStatePayload = Boolean(snapshot.state && Object.keys(snapshot.state).length > 0);

  // If comp-01 was bootstrapped without state yet and localSeedIfMissing belongs to comp-01, preserve local seed cleanly
  const shouldUseLocalComp01Seed =
    !hasStatePayload &&
    companyId === 'comp-01' &&
    localSeedIfMissing &&
    (localSeedIfMissing.activeCompanyId === 'comp-01' || localSeedIfMissing.company?.id === 'comp-01');

  if (shouldUseLocalComp01Seed && localSeedIfMissing) {
    const scopedLocal = scopeDatabaseToCompany(localSeedIfMissing, 'comp-01');
    return migrateDatabase({
      ...scopedLocal,
      company: primaryCompany,
      companies: authorizedCompanies.length > 0 ? authorizedCompanies : [primaryCompany],
      activeCompanyId: companyId,
      users: erpUsers.length > 0 ? erpUsers : scopedLocal.users,
      revision: Math.max(1, snapshot.revision || 1),
    });
  }

  const coaFromState = Array.isArray(rawState.chartOfAccounts) && rawState.chartOfAccounts.length > 0
    ? rawState.chartOfAccounts
    : buildCleanZeroCoaForCompany(companyId);

  const branchesFromState =
    Array.isArray(rawState.branches) && rawState.branches.length > 0
      ? rawState.branches
      : [
          {
            id: `br-${companyId}`,
            companyId,
            code: 'BR-01',
            nameAr: 'الفرع الرئيسي',
            phone: primaryCompany.phone || '',
            address: primaryCompany.address || '',
            managerName: 'مدير الفرع',
            isMain: true,
            status: 'active' as const,
          },
        ];

  const warehousesFromState =
    Array.isArray(rawState.warehouses) && rawState.warehouses.length > 0
      ? rawState.warehouses
      : [
          {
            id: `wh-${companyId}`,
            companyId,
            branchId: branchesFromState[0].id,
            code: 'WH-01',
            nameAr: 'المستودع المركزي',
            location: primaryCompany.address || '',
            keeperName: 'أمين المستودع',
            status: 'active' as const,
          },
        ];

  const cashGl = coaFromState.find((a) => a.code === '1111') || coaFromState.find((a) => a.isLeaf);
  const treasuryFromState: TreasuryAccount[] =
    Array.isArray(rawState.treasuryAccounts) && rawState.treasuryAccounts.length > 0
      ? rawState.treasuryAccounts
      : [
          {
            id: `tr-${companyId}`,
            companyId,
            code: 'TR-CASH-1',
            nameAr: `صندوق النقدية الرئيسي (${primaryCompany.nameAr})`,
            type: 'صندوق',
            currency: primaryCompany.baseCurrency || 'YER',
            branchId: branchesFromState[0].id,
            generalLedgerAccountId: cashGl?.id || `acc-1111-${companyId}`,
            balance: 0,
            status: 'active',
          },
        ];

  const currenciesFromState: Currency[] =
    Array.isArray(rawState.currencies) && rawState.currencies.length > 0
      ? rawState.currencies
      : getInitialDatabase().currencies;

  const baseSettings = (rawState.settings || {}) as Partial<SystemSettings>;

  // Never fall back to initialData comp-01 operational arrays when hydrating an isolated server company!
  const cleanPayload: Partial<ERPDatabase> = {
    ...rawState,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    company: {
      ...primaryCompany,
      ...(rawState.company || {}),
      id: companyId,
    },
    companies: authorizedCompanies.length > 0 ? authorizedCompanies : [primaryCompany],
    activeCompanyId: companyId,
    revision: Math.max(1, snapshot.revision || 1),
    currencies: currenciesFromState,
    branches: branchesFromState,
    warehouses: warehousesFromState,
    chartOfAccounts: coaFromState,
    treasuryAccounts: treasuryFromState,
    customers: Array.isArray(rawState.customers) ? rawState.customers : [],
    vendors: Array.isArray(rawState.vendors) ? rawState.vendors : [],
    inventoryItems: Array.isArray(rawState.inventoryItems) ? rawState.inventoryItems : [],
    warehouseStock: Array.isArray(rawState.warehouseStock) ? rawState.warehouseStock : [],
    stockCostLayers: Array.isArray(rawState.stockCostLayers) ? rawState.stockCostLayers : [],
    inventoryBatches: Array.isArray(rawState.inventoryBatches) ? rawState.inventoryBatches : [],
    storageLocations: Array.isArray(rawState.storageLocations) ? rawState.storageLocations : [],
    stockMovements: Array.isArray(rawState.stockMovements) ? rawState.stockMovements : [],
    inventoryTransfers: Array.isArray(rawState.inventoryTransfers) ? rawState.inventoryTransfers : [],
    stocktakings: Array.isArray(rawState.stocktakings) ? rawState.stocktakings : [],
    warehouseDocuments: Array.isArray(rawState.warehouseDocuments) ? rawState.warehouseDocuments : [],
    costCenters: Array.isArray(rawState.costCenters) ? rawState.costCenters : [],
    journalEntries: Array.isArray(rawState.journalEntries) ? rawState.journalEntries : [],
    invoices: Array.isArray(rawState.invoices) ? rawState.invoices : [],
    commercialOrders: Array.isArray(rawState.commercialOrders) ? rawState.commercialOrders : [],
    paymentVouchers: Array.isArray(rawState.paymentVouchers) ? rawState.paymentVouchers : [],
    treasuryTransfers: Array.isArray(rawState.treasuryTransfers) ? rawState.treasuryTransfers : [],
    bankReconciliations: Array.isArray(rawState.bankReconciliations) ? rawState.bankReconciliations : [],
    posShifts: Array.isArray(rawState.posShifts) ? rawState.posShifts : [],
    heldPosCarts: Array.isArray(rawState.heldPosCarts) ? rawState.heldPosCarts : [],
    expenseCategories: Array.isArray(rawState.expenseCategories) ? rawState.expenseCategories : [],
    expenseRecords: Array.isArray(rawState.expenseRecords) ? rawState.expenseRecords : [],
    employees: Array.isArray(rawState.employees) ? rawState.employees : [],
    payrollRuns: Array.isArray(rawState.payrollRuns) ? rawState.payrollRuns : [],
    fixedAssets: Array.isArray(rawState.fixedAssets) ? rawState.fixedAssets : [],
    customBooks: Array.isArray(rawState.customBooks) ? rawState.customBooks : [],
    customBookEntries: Array.isArray(rawState.customBookEntries) ? rawState.customBookEntries : [],
    approvalRequests: Array.isArray(rawState.approvalRequests) ? rawState.approvalRequests : [],
    fxRevaluations: Array.isArray(rawState.fxRevaluations) ? rawState.fxRevaluations : [],
    taskAlerts: Array.isArray(rawState.taskAlerts) ? rawState.taskAlerts : [],
    dispatchLogs: Array.isArray(rawState.dispatchLogs) ? rawState.dispatchLogs : [],
    users: erpUsers,
    auditLogs:
      Array.isArray(rawState.auditLogs) && rawState.auditLogs.length > 0
        ? rawState.auditLogs
        : (snapshot.auditLogs as ERPDatabase['auditLogs']) || [],
    settings: baseSettings as SystemSettings,
  };

  return scopeDatabaseToCompany(migrateDatabase(cleanPayload), companyId);
}

const RESTORE_SCOPED_COLLECTIONS = [
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

export function prepareDatabaseForRestore(
  db: ERPDatabase,
  targetCompanyId: string,
  targetMode: 'current_company' | 'restored_company'
): ERPDatabase {
  const cleanCid = String(targetCompanyId || db.activeCompanyId || db.company.id).trim();
  const next: Record<string, unknown> = { ...db };

  for (const key of RESTORE_SCOPED_COLLECTIONS) {
    const arr = next[key];
    if (!Array.isArray(arr)) continue;
    next[key] = arr.map((item) => {
      if (!item || typeof item !== 'object') return item;
      const rec = item as Record<string, unknown>;
      if (
        targetMode === 'current_company' ||
        rec.companyId === undefined ||
        rec.companyId === null ||
        String(rec.companyId).trim() === ''
      ) {
        return { ...rec, companyId: cleanCid };
      }
      return rec;
    });
  }

  const nextCompany: Company = {
    ...db.company,
    id: cleanCid,
    isActive: db.company.isActive !== false,
  };

  return {
    ...(next as unknown as ERPDatabase),
    company: nextCompany,
    activeCompanyId: cleanCid,
    companies: [nextCompany],
  };
}

export function extractScopedCloudStatePayload(db: ERPDatabase, companyId: string): Record<string, unknown> {
  const scoped = scopeDatabaseToCompany(db, companyId);
  const { users: _u, companies: _c, ...rest } = scoped;
  return {
    ...rest,
    company: { ...scoped.company, id: companyId },
    activeCompanyId: companyId,
  };
}

async function parseJsonSafe<T>(res: Response): Promise<T & { ok?: boolean; error?: string; code?: string }> {
  return (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string; code?: string };
}

export const cloudApiService = {
  async getAuthStatus(): Promise<AuthStatusPayload> {
    const res = await fetch('/api/auth/status', { credentials: 'include' });
    const data = await parseJsonSafe<AuthStatusPayload>(res);
    if (!res.ok) {
      throw new Error(data.error || 'تعذر التحقق من حالة الجلسة.');
    }
    return data;
  },

  async login(payload: { username: string; password: string; companyId?: string }) {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await parseJsonSafe<{
      user: ServerPublicUserDto;
      companies: ServerCompanyDto[];
      activeCompanyId: string;
      licenseBoundary?: LicenseEvaluationResult;
    }>(res);
    return { ok: res.ok, status: res.status, data };
  },

  async register(payload: {
    username: string;
    fullName: string;
    email?: string;
    phone?: string;
    password: string;
    company: {
      nameAr: string;
      nameEn?: string;
      countryCode?: string;
      baseCurrency?: string;
      taxNumber?: string;
      commercialRecord?: string;
      phone?: string;
    };
  }) {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await parseJsonSafe<{
      user: ServerPublicUserDto;
      company: ServerCompanyDto | null;
      companies: ServerCompanyDto[];
      activeCompanyId: string | null;
      licenseBoundary?: LicenseEvaluationResult;
    }>(res);
    return { ok: res.ok, status: res.status, data };
  },

  async completeForcedPasswordChange(newPassword: string) {
    const res = await fetch('/api/auth/complete-forced-password-change', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPassword }),
    });
    const data = await parseJsonSafe<{
      user?: ServerPublicUserDto;
      activeCompanyId?: string;
      revokedPreviousSessions?: boolean;
    }>(res);
    return { ok: res.ok, status: res.status, data };
  },

  async changePassword(currentPassword: string, newPassword: string) {
    const res = await fetch('/api/auth/change-password', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = await parseJsonSafe<{
      user?: ServerPublicUserDto;
      revokedPreviousSessions?: boolean;
    }>(res);
    return { ok: res.ok, status: res.status, data };
  },

  async revokeSessions(keepCurrent = true) {
    const res = await fetch('/api/auth/revoke-sessions', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keepCurrent }),
    });
    const data = await parseJsonSafe<{
      sessionVersion?: number;
      keptCurrentSession?: boolean;
    }>(res);
    return { ok: res.ok, status: res.status, data };
  },

  async logout(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => null);
  },

  async getCompanies(): Promise<{ companies: ServerCompanyDto[]; activeCompanyId: string | null }> {
    const res = await fetch('/api/companies', { credentials: 'include' });
    const data = await parseJsonSafe<{ companies: ServerCompanyDto[]; activeCompanyId: string | null }>(res);
    if (!res.ok) {
      throw new Error(data.error || 'تعذر جلب قائمة المنشآت من الخادم.');
    }
    return {
      companies: data.companies || [],
      activeCompanyId: data.activeCompanyId || null,
    };
  },

  async createCompany(payload: {
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
    initialState?: Record<string, unknown>;
  }) {
    const res = await fetch('/api/companies', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await parseJsonSafe<{
      company: ServerCompanyDto;
      companies: ServerCompanyDto[];
      activeCompanyId: string;
      revision: number;
      licenseBoundary?: LicenseEvaluationResult;
    }>(res);
    if (!res.ok) {
      throw new Error(data.error || 'فشل إنشاء المنشأة في قاعدة البيانات.');
    }
    return data;
  },

  async updateCompany(
    companyId: string,
    payload: {
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
    }
  ): Promise<ServerCompanyDto> {
    const res = await fetch(`/api/companies/${encodeURIComponent(companyId)}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await parseJsonSafe<{ company: ServerCompanyDto }>(res);
    if (!res.ok) {
      throw new Error(data.error || 'فشل تحديث بيانات المنشأة في قاعدة البيانات.');
    }
    return data.company;
  },

  async updateCompanyStatus(
    companyId: string,
    status: 'active' | 'inactive' | 'suspended'
  ): Promise<ServerCompanyDto> {
    const res = await fetch(`/api/companies/${encodeURIComponent(companyId)}/status`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    const data = await parseJsonSafe<{ company: ServerCompanyDto }>(res);
    if (!res.ok) {
      throw new Error(data.error || 'تعذر تغيير حالة اشتراك المنشأة.');
    }
    return data.company;
  },

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
    const res = await fetch('/api/admin/overview', { credentials: 'include' });
    const data = await parseJsonSafe<{
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
    }>(res);
    if (!res.ok) {
      throw new Error(data.error || 'تعذر جلب نظرة منصة المنشآت.');
    }
    return {
      totalCompanies: data.totalCompanies || 0,
      totalUsers: data.totalUsers || 0,
      companies: data.companies || [],
    };
  },

  async switchCompany(companyId: string) {
    const res = await fetch('/api/companies/switch', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId }),
    });
    const data = await parseJsonSafe<{
      activeCompanyId: string;
      company: ServerCompanyDto;
      companies: ServerCompanyDto[];
    }>(res);
    if (!res.ok) {
      throw new Error(data.error || 'فشل تبديل المنشأة النشطة.');
    }
    return data;
  },

  async getCompanyState(): Promise<CompanyStatePayload> {
    const res = await fetch('/api/company/state', { credentials: 'include' });
    const data = await parseJsonSafe<CompanyStatePayload>(res);
    if (!res.ok) {
      throw new Error(data.error || 'تعذر تحميل بيانات المنشأة من قاعدة البيانات.');
    }
    return data;
  },

  async saveCompanyState(
    db: ERPDatabase,
    companyId: string,
    expectedRevision?: number
  ): Promise<
    | { ok: true; revision: number }
    | { ok: false; status?: number; code?: string; conflict?: boolean; error: string; serverRevision?: number }
  > {
    const payloadState = extractScopedCloudStatePayload(db, companyId);
    const res = await fetch('/api/company/state', {
      method: 'PUT',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Company-Id': companyId,
      },
      body: JSON.stringify({
        companyId,
        expectedRevision,
        state: payloadState,
      }),
    });
    const data = await parseJsonSafe<{ revision?: number; serverRevision?: number }>(res);
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        code: data.code,
        conflict: res.status === 409,
        serverRevision: data.serverRevision,
        error: data.error || 'تعذر حفظ بيانات المنشأة في الخادم.',
      };
    }
    return { ok: true, revision: data.revision || (expectedRevision ?? 0) + 1 };
  },

  async restoreCompanyBackup(params: {
    targetMode: 'current_company' | 'restored_company';
    targetCompanyId?: string;
    db: ERPDatabase;
    expectedRevision?: number;
    allowReplaceExisting?: boolean;
    sourceLabel?: string;
  }): Promise<
    | {
        ok: true;
        company: ServerCompanyDto;
        companies: ServerCompanyDto[];
        activeCompanyId: string;
        revision: number;
        licenseBoundary?: LicenseEvaluationResult;
      }
    | {
        ok: false;
        status: number;
        code?: string;
        conflict?: boolean;
        serverRevision?: number;
        error: string;
      }
  > {
    const targetCid = String(
      params.targetCompanyId || params.db.company?.id || params.db.activeCompanyId || ''
    ).trim();
    const prepared = prepareDatabaseForRestore(params.db, targetCid, params.targetMode);
    const { users: _u, companies: _c, ...statePayload } = prepared;
    const companyProfile = {
      id: targetCid,
      nameAr: prepared.company.nameAr,
      nameEn: prepared.company.nameEn || prepared.company.nameAr,
      countryCode: prepared.company.countryCode || 'YE',
      baseCurrency: prepared.company.baseCurrency || 'YER',
      valuationPolicy: prepared.company.valuationPolicy || 'PER_ITEM',
      commercialRecord: prepared.company.commercialRecord || '',
      taxNumber: prepared.company.taxNumber || '',
      phone: prepared.company.phone || '',
      email: prepared.company.email || '',
      address: prepared.company.address || '',
      fiscalYearStart: prepared.company.fiscalYearStart || '2026-01-01',
    };

    const res = await fetch('/api/company/restore', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        targetMode: params.targetMode,
        targetCompanyId: targetCid || undefined,
        companyProfile,
        state: {
          ...statePayload,
          company: { ...prepared.company, id: targetCid },
          activeCompanyId: targetCid,
        },
        expectedRevision: params.expectedRevision,
        allowReplaceExisting: params.allowReplaceExisting,
        sourceLabel: params.sourceLabel,
      }),
    });

    const data = await parseJsonSafe<{
      company: ServerCompanyDto;
      companies: ServerCompanyDto[];
      activeCompanyId: string;
      revision: number;
      licenseBoundary?: LicenseEvaluationResult;
      serverRevision?: number;
    }>(res);

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        code: data.code,
        conflict: res.status === 409,
        serverRevision: data.serverRevision,
        error: data.error || 'تعذر اعتماد واستعادة النسخة الاحتياطية على الخادم.',
      };
    }

    return {
      ok: true,
      company: data.company,
      companies: data.companies || [],
      activeCompanyId: data.activeCompanyId,
      revision: data.revision,
      licenseBoundary: data.licenseBoundary,
    };
  },

  async saveCompanyUser(payload: {
    id: string;
    username: string;
    fullName: string;
    email?: string;
    phone?: string;
    role: string;
    allowedCompanyIds?: string[];
    branchId?: string;
    active?: boolean;
    password?: string;
    mustChangePassword?: boolean;
    flags?: ServerPublicUserDto['flags'];
    permissionMatrix?: Record<string, unknown>;
  }) {
    const res = await fetch('/api/company/users', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await parseJsonSafe<{ user: ServerPublicUserDto }>(res);
    if (!res.ok) {
      throw new Error(data.error || 'تعذر حفظ بيانات المستخدم على الخادم.');
    }
    return data.user;
  },
};
