/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Multi-Company Onboarding & Country Compliance Pack Setup Wizard
 */

import React, { useState } from 'react';
import { Building2, Globe2, Shield, CheckCircle2, X } from 'lucide-react';
import {
  Account,
  Company,
  CostCenter,
  CountryPackCode,
  DocumentBook,
  ExpenseCategory,
  TreasuryAccount,
  User,
} from '../../../types/erp';
import {
  ERPDatabase,
  CURRENT_SCHEMA_VERSION,
  defaultDocumentBooks,
} from '../../../services/storageService';
import {
  initialChartOfAccounts,
  initialCostCenters,
  initialExpenseCategories,
} from '../../../data/initialData';
import {
  COUNTRY_COMPLIANCE_PACKS,
  applyCountryPackToCompanyAndSettings,
} from '../../../services/countryComplianceService';
import {
  assertPermission,
  buildUserRoleMatrix,
  generateSaltHex,
  hashPasswordAsync,
  validatePasswordStrength,
  sanitizeInputText,
} from '../../../services/securityService';

interface SetupWizardModalProps {
  isOpen: boolean;
  db: ERPDatabase;
  currentUser?: User;
  onClose: () => void;
  onCreateCompany: (nextDb: ERPDatabase, newCompany: Company) => void;
  onNotify: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export const SetupWizardModal: React.FC<SetupWizardModalProps> = ({
  isOpen,
  db,
  currentUser,
  onClose,
  onCreateCompany,
  onNotify,
}) => {
  const [nameAr, setNameAr] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [countryCode, setCountryCode] = useState<CountryPackCode>('YE');
  const [branchName, setBranchName] = useState('الفرع الرئيسي');
  const [warehouseName, setWarehouseName] = useState('المستودع المركزي');
  const [fiscalYear, setFiscalYear] = useState(db.settings.fiscalYear || '2026');
  const [taxNumber, setTaxNumber] = useState('');
  const [commercialRecord, setCommercialRecord] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [valuationPolicy, setValuationPolicy] = useState<Company['valuationPolicy']>('PER_ITEM');

  if (!isOpen) return null;

  const selectedPack = COUNTRY_COMPLIANCE_PACKS[countryCode];
  const productionSecurityMode = Boolean(db.settings.operationalControl?.productionSecurityMode);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const actor = currentUser || db.users[0];
    const perm = assertPermission(actor, 'settings', 'create');
    if (!perm.ok) {
      onNotify('error', perm.error || 'عذراً، لا تملك صلاحية تأسيس منشأة جديدة.');
      return;
    }

    const cleanName = sanitizeInputText(nameAr);
    if (!cleanName) {
      onNotify('error', 'يرجى إدخال اسم الشركة / المنشأة الجديدة.');
      return;
    }
    if (adminPassword.trim().length > 0 || productionSecurityMode) {
      const strength = validatePasswordStrength(adminPassword.trim());
      if (!strength.ok) {
        onNotify('error', strength.error || 'يجب تعيين كلمة مرور قوية لا تقل عن 8 أحرف (أحرف + أرقام).');
        return;
      }
    }

    const ts = Date.now();
    const companyId = `comp-${ts}`;
    const branchId = `br-${ts}`;
    const warehouseId = `wh-${ts}`;

    const baseCompany: Company = {
      id: companyId,
      nameAr: cleanName,
      nameEn: sanitizeInputText(nameEn) || cleanName,
      commercialRecord: sanitizeInputText(commercialRecord) || `CR-${ts.toString().slice(-6)}`,
      taxNumber: sanitizeInputText(taxNumber),
      phone: db.company.phone || '',
      email: db.company.email || '',
      address: selectedPack.nameAr,
      baseCurrency: selectedPack.baseCurrency,
      countryCode,
      isActive: true,
      fiscalYearStart: `${fiscalYear}-01-01`,
      valuationPolicy,
      createdAt: new Date().toISOString(),
    };

    const applied = applyCountryPackToCompanyAndSettings(
      countryCode,
      baseCompany,
      {
        ...db.settings,
        fiscalYear,
        fiscalYearStatus: 'open',
      },
      db.currencies
    );

    // Provision isolated Chart of Accounts (zeroed opening balances) for the new company
    const companyCoa: Account[] = initialChartOfAccounts.map((acc) => ({
      ...acc,
      id: `${acc.id}-${companyId}`,
      companyId,
      currentBalance: 0,
      importedDebit: 0,
      importedCredit: 0,
      isActive: acc.isActive !== false,
    }));
    const cashGlAcc =
      companyCoa.find((a) => a.code === '1111') ||
      companyCoa.find((a) => a.isLeaf && a.category === 'أصول');

    const starterTreasury: TreasuryAccount = {
      id: `tr-${ts}`,
      companyId,
      code: `TR-CASH-${(db.treasuryAccounts?.length || 0) + 1}`,
      nameAr: `صندوق النقدية الرئيسي (${cleanName})`,
      type: 'صندوق',
      currency: applied.company.baseCurrency,
      branchId,
      generalLedgerAccountId: cashGlAcc?.id || `acc-1111-${companyId}`,
      balance: 0,
      status: 'active',
    };

    const companyCostCenters: CostCenter[] = initialCostCenters.slice(0, 1).map((cc) => ({
      ...cc,
      id: `${cc.id}-${companyId}`,
      companyId,
      nameAr: `الإدارة العامة (${cleanName})`,
    }));

    const companyExpenseCategories: ExpenseCategory[] = initialExpenseCategories.map((ec) => {
      const origAcc = initialChartOfAccounts.find((a) => a.id === ec.ledgerAccountId);
      const matchedCompanyAcc = origAcc
        ? companyCoa.find((a) => a.code === origAcc.code)
        : undefined;
      return {
        ...ec,
        id: `${ec.id}-${companyId}`,
        companyId,
        ledgerAccountId: matchedCompanyAcc?.id || ec.ledgerAccountId,
      };
    });

    const companyDocBooks: DocumentBook[] = defaultDocumentBooks.map((b) => ({
      ...b,
      id: `${b.id}-${companyId}`,
      companyId,
      nextSequence: 1,
    }));

    const nextCompanies = [...(db.companies || [db.company]), applied.company];
    const nextBranches = [
      ...db.branches,
      {
        id: branchId,
        companyId,
        code: `BR-${db.branches.length + 1}`,
        nameAr: sanitizeInputText(branchName) || 'الفرع الرئيسي',
        phone: baseCompany.phone,
        address: baseCompany.address,
        managerName: 'مدير الفرع',
        isMain: true,
        status: 'active' as const,
      },
    ];
    const nextWarehouses = [
      ...db.warehouses,
      {
        id: warehouseId,
        companyId,
        branchId,
        code: `WH-${db.warehouses.length + 1}`,
        nameAr: sanitizeInputText(warehouseName) || 'المستودع المركزي',
        location: baseCompany.address,
        keeperName: 'أمين المستودع',
        status: 'active' as const,
      },
    ];

    const nextPeriods = [
      ...(db.fiscalPeriods || []),
      {
        id: `fp-${companyId}-${fiscalYear}`,
        companyId,
        fiscalYear,
        periodName: `السنة المالية ${fiscalYear} (${cleanName})`,
        startDate: `${fiscalYear}-01-01`,
        endDate: `${fiscalYear}-12-31`,
        status: 'open' as const,
      },
    ];

    // Update salted PBKDF2 hash if adminPassword supplied and grant company scope to creator + owner
    let nextUsers: User[] = db.users;
    const creatorId = actor?.id || db.users[0]?.id;
    if (adminPassword.trim().length >= 8) {
      const salt = generateSaltHex(16);
      const hash = await hashPasswordAsync(adminPassword.trim(), salt);
      const primaryAdmin = db.users[0];
      const nextAllowed = Array.from(
        new Set([...(primaryAdmin?.allowedCompanyIds || [db.company.id]), companyId])
      );
      nextUsers = db.users.map((u, idx) =>
        idx === 0
          ? {
              ...u,
              passwordSalt: salt,
              passwordHash: hash,
              mustChangePassword: false,
              allowedCompanyIds: nextAllowed,
              permissionMatrix: u.permissionMatrix || buildUserRoleMatrix(u.role),
            }
          : u.id === creatorId
          ? {
              ...u,
              allowedCompanyIds: Array.from(
                new Set([...(u.allowedCompanyIds || [db.company.id]), companyId])
              ),
            }
          : u
      );
      if (primaryAdmin) {
        await fetch('/api/auth/users', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: primaryAdmin.id,
            username: primaryAdmin.username,
            fullName: primaryAdmin.fullName,
            role: primaryAdmin.role,
            allowedCompanyIds: nextAllowed,
            branchId: primaryAdmin.branchId,
            active: primaryAdmin.active,
            password: adminPassword.trim(),
            mustChangePassword: false,
          }),
        }).catch(() => null);
      }
    } else {
      nextUsers = db.users.map((u, idx) =>
        idx === 0 || u.id === creatorId
          ? {
              ...u,
              allowedCompanyIds: Array.from(
                new Set([...(u.allowedCompanyIds || [db.company.id]), companyId])
              ),
            }
          : u
      );
    }

    const nextDb: ERPDatabase = {
      ...db,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      company: applied.company,
      companies: nextCompanies,
      activeCompanyId: companyId,
      currencies: applied.currencies,
      branches: nextBranches,
      warehouses: nextWarehouses,
      chartOfAccounts: [...db.chartOfAccounts, ...companyCoa],
      treasuryAccounts: [...db.treasuryAccounts, starterTreasury],
      costCenters: [...db.costCenters, ...companyCostCenters],
      expenseCategories: [...db.expenseCategories, ...companyExpenseCategories],
      documentBooks: [...(db.documentBooks || []), ...companyDocBooks],
      fiscalPeriods: nextPeriods,
      users: nextUsers,
      settings: applied.settings,
      auditLogs: [
        {
          id: `log-comp-${ts}`,
          companyId,
          timestamp: new Date().toISOString(),
          userId: actor?.id || 'usr-01',
          userName: actor?.fullName || 'مدير النظام',
          action: 'إنشاء',
          module: 'الإعدادات',
          details: `تأسيس منشأة جديدة (${cleanName}) بحزمة الامتثال (${selectedPack.nameAr}) وتهيئة شجرة حسابات وصندوق مستقل`,
          entityId: companyId,
        },
        ...db.auditLogs,
      ],
    };

    onCreateCompany(nextDb, applied.company);
    onNotify('success', `تم إنشاء وتفعيل منشأة "${cleanName}" بحزمة (${selectedPack.nameAr}).`);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[150] bg-black/75 flex items-center justify-center p-4" dir="rtl">
      <form onSubmit={handleSubmit} className="v20-card w-full max-w-2xl p-5 space-y-4 text-xs max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-[var(--border-strong)] pb-3">
          <div className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-[var(--gold)]" />
            <div>
              <h3 className="font-black text-sm text-white">معالج تأسيس منشأة / شركة جديدة (Multi-Tenant Wizard)</h3>
              <p className="text-[11px] text-slate-400">تهيئة العملة، حزمة الضرائب، الفرع الرئيسي، المستودع، والفترة المالية</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block font-bold text-slate-300 mb-1">اسم المنشأة بالعربية *</label>
            <input
              type="text"
              required
              value={nameAr}
              onChange={(e) => setNameAr(e.target.value)}
              placeholder="مثال: شركة النخبة للتجارة والاستيراد"
              className="w-full v20-input px-3 py-2"
            />
          </div>
          <div>
            <label className="block font-bold text-slate-300 mb-1">اسم المنشأة بالإنجليزية</label>
            <input
              type="text"
              value={nameEn}
              onChange={(e) => setNameEn(e.target.value)}
              placeholder="Elite Trading Co."
              className="w-full v20-input px-3 py-2 font-mono"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block font-bold text-slate-300 mb-1 flex items-center gap-1.5">
              <Globe2 className="w-3.5 h-3.5 text-[var(--gold)]" />
              <span>حزمة الامتثال الضريبي والعملة (Country Compliance Pack)</span>
            </label>
            <select
              value={countryCode}
              onChange={(e) => setCountryCode(e.target.value as CountryPackCode)}
              className="w-full v20-input px-3 py-2 font-bold cursor-pointer"
            >
              {Object.values(COUNTRY_COMPLIANCE_PACKS).map((p) => (
                <option key={p.code} value={p.code}>
                  {p.nameAr} — العملة الأساسية: {p.baseCurrency} · الضريبة: {(p.defaultTaxRate * 100).toFixed(0)}%
                </option>
              ))}
            </select>
            <div className="mt-1.5 p-2.5 rounded-lg bg-amber-950/25 border border-amber-500/30 text-[11px] text-amber-200">
              {selectedPack.complianceNoticeAr}
            </div>
          </div>

          <div>
            <label className="block font-bold text-slate-300 mb-1">الفرع الرئيسي</label>
            <input
              type="text"
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              className="w-full v20-input px-3 py-2"
            />
          </div>
          <div>
            <label className="block font-bold text-slate-300 mb-1">المستودع المركزي</label>
            <input
              type="text"
              value={warehouseName}
              onChange={(e) => setWarehouseName(e.target.value)}
              className="w-full v20-input px-3 py-2"
            />
          </div>

          <div>
            <label className="block font-bold text-slate-300 mb-1">السنة المالية الافتتاحية</label>
            <input
              type="text"
              value={fiscalYear}
              onChange={(e) => setFiscalYear(e.target.value)}
              className="w-full v20-input px-3 py-2 font-mono"
            />
          </div>
          <div>
            <label className="block font-bold text-slate-300 mb-1">سياسة تقييم المخزون</label>
            <select
              value={valuationPolicy}
              onChange={(e) => setValuationPolicy(e.target.value as Company['valuationPolicy'])}
              className="w-full v20-input px-3 py-2"
            >
              <option value="PER_ITEM">حسب إعداد كل صنف (FIFO / المتوسط المرجح)</option>
              <option value="FIFO">الوارد أولاً صادر أولاً (FIFO)</option>
              <option value="WEIGHTED_AVERAGE">المتوسط المرجح (Weighted Average)</option>
            </select>
          </div>

          <div>
            <label className="block font-bold text-slate-300 mb-1">السجل التجاري</label>
            <input
              type="text"
              value={commercialRecord}
              onChange={(e) => setCommercialRecord(e.target.value)}
              className="w-full v20-input px-3 py-2 font-mono"
            />
          </div>
          <div>
            <label className="block font-bold text-slate-300 mb-1">الرقم الضريبي</label>
            <input
              type="text"
              value={taxNumber}
              onChange={(e) => setTaxNumber(e.target.value)}
              className="w-full v20-input px-3 py-2 font-mono"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block font-bold text-slate-300 mb-1 flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5 text-emerald-400" />
              <span>تعيين / تحديث كلمة مرور مدير المنشأة (Salted Hash)</span>
            </label>
            <input
              type="password"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              placeholder={productionSecurityMode ? 'مطلوبة (8 أحرف على الأقل: أحرف + أرقام)' : 'اختياري في وضع التطوير'}
              className="w-full v20-input px-3 py-2 font-mono"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border-strong)]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-[#08121E] border border-[var(--border-strong)] text-slate-200 cursor-pointer"
          >
            إلغاء
          </button>
          <button
            type="submit"
            className="px-5 py-2 rounded-lg v20-btn-gold font-black flex items-center gap-1.5 cursor-pointer"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>تأسيس وتفعيل المنشأة</span>
          </button>
        </div>
      </form>
    </div>
  );
};
