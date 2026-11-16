import { describe, it, expect } from 'vitest';
import {
  getInitialDatabase,
  scopeDatabaseToCompany,
  switchActiveCompanyInDb,
  ERPDatabase,
} from '../src/services/storageService';
import {
  assertTenantAccess,
  assertPermission,
} from '../src/services/securityService';
import {
  sanitizeImageSrc,
  generatePrintableHTML,
} from '../src/services/exportService';
import {
  postSalesInvoiceTransaction,
  postPurchaseInvoiceTransaction,
  cancelInvoiceTransaction,
  postVouchersBatchTransaction,
  cancelVoucherTransaction,
  executeTreasuryTransferTransaction,
  postExpenseTransaction,
  reverseJournalTransaction,
  executeStockTransferTransaction,
  reverseStockTransferTransaction,
  approveStocktakingTransaction,
  disbursePayrollTransaction,
  disposeFixedAssetTransaction,
  executeYearEndClosingTransaction,
  executeFxRevaluationTransaction,
} from '../src/services/erpTransactionService';
import type { User, Invoice, PaymentVoucher } from '../src/types/erp';

function createTwoCompanyDb(): {
  db: ERPDatabase;
  ownerComp1Only: User;
  cashierComp1: User;
} {
  const base = getInitialDatabase();
  const comp2 = {
    ...base.company,
    id: 'comp-02',
    nameAr: 'شركة النخبة الفرعية الثانية',
    nameEn: 'Elite Second Co.',
    baseCurrency: 'SAR',
  };

  const ownerComp1Only: User = {
    ...base.users[0],
    id: 'usr-comp1-owner',
    role: 'مالك المؤسسة',
    allowedCompanyIds: ['comp-01'],
  };

  const cashierComp1: User = {
    ...base.users[0],
    id: 'usr-cashier-noflag',
    username: 'cashier1',
    fullName: 'أمين صندوق اختباري',
    role: 'أمين الصندوق',
    allowedCompanyIds: ['comp-01'],
    // Explicitly leave canDeleteInvoices & canDeleteVouchers undefined to verify no bypass
    canDeleteInvoices: undefined,
    canDeleteVouchers: undefined,
    canEditExchangeRates: undefined,
    canManageSettings: false,
  };

  const comp2Invoice: Invoice = {
    ...base.invoices[0],
    id: 'inv-comp2-01',
    companyId: 'comp-02',
    invoiceNumber: 'C2-INV-001',
    status: 'posted',
  };

  const comp2Voucher: PaymentVoucher = {
    ...base.paymentVouchers[0],
    id: 'pv-comp2-01',
    companyId: 'comp-02',
    voucherNumber: 'C2-RV-001',
    status: 'posted',
  };

  const db: ERPDatabase = {
    ...base,
    companies: [base.company, comp2],
    activeCompanyId: 'comp-01',
    branches: [
      ...base.branches,
      { ...base.branches[0], id: 'br-comp2-01', companyId: 'comp-02', nameAr: 'فرع الشركة 2' },
    ],
    warehouses: [
      ...base.warehouses,
      { ...base.warehouses[0], id: 'wh-comp2-01', companyId: 'comp-02', branchId: 'br-comp2-01', nameAr: 'مستودع الشركة 2' },
    ],
    customers: [
      ...base.customers,
      { ...base.customers[0], id: 'cust-comp2-01', companyId: 'comp-02', branchId: 'br-comp2-01', nameAr: 'عميل الشركة الثانية' },
    ],
    treasuryAccounts: [
      ...base.treasuryAccounts,
      { ...base.treasuryAccounts[0], id: 'tr-comp2-01', companyId: 'comp-02', branchId: 'br-comp2-01', balance: 50000 },
    ],
    invoices: [...base.invoices, comp2Invoice],
    paymentVouchers: [...base.paymentVouchers, comp2Voucher],
    journalEntries: [
      ...base.journalEntries,
      { ...base.journalEntries[0], id: 'je-comp2-01', companyId: 'comp-02', entryNumber: 'C2-JV-001' },
    ],
    fixedAssets: [
      ...base.fixedAssets,
      { ...base.fixedAssets[0], id: 'fa-comp2-01', companyId: 'comp-02', nameAr: 'أصل الشركة الثانية' },
    ],
    fiscalPeriods: [
      ...(base.fiscalPeriods || []),
      {
        id: 'fp-comp2-2026',
        companyId: 'comp-02',
        fiscalYear: '2026',
        periodName: '2026 Comp 2',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        status: 'open',
      },
    ],
  };

  return { db, ownerComp1Only, cashierComp1 };
}

describe('Stage P0-B: Multi-Tenant Isolation, Granular RBAC & Export XSS Sanitization', () => {
  describe('Fail-Closed assertTenantAccess & Role RBAC', () => {
    it('fails closed when allowedCompanyIds is empty (even for مالك المؤسسة) or targetCompanyId is empty', () => {
      const { db, ownerComp1Only } = createTwoCompanyDb();
      const emptyScopeOwner: User = { ...ownerComp1Only, allowedCompanyIds: [] };
      const undefinedScopeOwner: User = { ...ownerComp1Only, allowedCompanyIds: undefined };
      const inactiveOwner: User = { ...ownerComp1Only, active: false };

      expect(assertTenantAccess(emptyScopeOwner, 'comp-01').ok).toBe(false);
      expect(assertTenantAccess(undefinedScopeOwner, 'comp-01').ok).toBe(false);
      expect(assertTenantAccess(inactiveOwner, 'comp-01').ok).toBe(false);
      expect(assertTenantAccess(ownerComp1Only, '').ok).toBe(false);
      expect(assertTenantAccess(ownerComp1Only, undefined).ok).toBe(false);
      expect(assertTenantAccess(ownerComp1Only, 'comp-02').ok).toBe(false);
      expect(assertTenantAccess(ownerComp1Only, db.company.id).ok).toBe(true);
    });

    it('strictly blocks Cashier (أمين الصندوق) from deleting/cancelling invoices and vouchers', () => {
      const { db, cashierComp1 } = createTwoCompanyDb();

      expect(assertPermission(cashierComp1, 'sales', 'delete').ok).toBe(false);
      expect(assertPermission(cashierComp1, 'vouchers', 'delete').ok).toBe(false);
      expect(assertPermission(cashierComp1, 'currencies', 'edit').ok).toBe(false);

      const invCancelRes = cancelInvoiceTransaction(db, cashierComp1, db.invoices[0].id);
      expect(invCancelRes.ok).toBe(false);

      const vchCancelRes = cancelVoucherTransaction(db, cashierComp1, db.paymentVouchers[0].id);
      expect(vchCancelRes.ok).toBe(false);
    });
  });

  describe('Cross-Company Data & Transaction Isolation', () => {
    it('scopeDatabaseToCompany returns zero records from Company 1 when Company 2 is active and zeroes unseeded COA balances', () => {
      const { db } = createTwoCompanyDb();
      const switched = switchActiveCompanyInDb(db, 'comp-02');
      const scopedComp2 = scopeDatabaseToCompany(switched, 'comp-02');

      expect(scopedComp2.company.id).toBe('comp-02');
      expect(scopedComp2.customers.every((c) => c.companyId === 'comp-02')).toBe(true);
      expect(scopedComp2.customers.some((c) => c.id === 'cust-01')).toBe(false);
      expect(scopedComp2.invoices.every((i) => i.companyId === 'comp-02')).toBe(true);
      expect(scopedComp2.invoices.some((i) => i.id === 'inv-01')).toBe(false);
      expect(scopedComp2.vendors.length).toBe(0);
      expect(scopedComp2.stockMovements.length).toBe(0);
      expect(scopedComp2.employees.length).toBe(0);
      expect(scopedComp2.auditLogs.length).toBe(0);
      expect(
        scopedComp2.chartOfAccounts.every(
          (a) => a.companyId === 'comp-02' && a.currentBalance === 0
        )
      ).toBe(true);
    });

    it('rejects every cross-tenant transaction when active company or target record belongs to an unauthorized company', () => {
      const { db, ownerComp1Only } = createTwoCompanyDb();
      const dbComp2Active = switchActiveCompanyInDb(db, 'comp-02');

      // User allowed only on comp-01 tries operations while comp-02 is active
      expect(
        postSalesInvoiceTransaction(dbComp2Active, ownerComp1Only, {
          ...db.invoices[0],
          id: 'inv-hack-sale',
          companyId: 'comp-02',
          invoiceNumber: 'INV-HACK-1',
        }).ok
      ).toBe(false);

      expect(
        postPurchaseInvoiceTransaction(dbComp2Active, ownerComp1Only, {
          ...db.invoices[2],
          id: 'inv-hack-pur',
          companyId: 'comp-02',
          invoiceNumber: 'PUR-HACK-1',
        }).ok
      ).toBe(false);

      expect(
        postVouchersBatchTransaction(dbComp2Active, ownerComp1Only, [
          { ...db.paymentVouchers[0], id: 'pv-hack', companyId: 'comp-02', voucherNumber: 'RV-HACK' },
        ]).ok
      ).toBe(false);

      expect(
        executeTreasuryTransferTransaction(
          dbComp2Active,
          ownerComp1Only,
          {
            id: 'tt-hack',
            companyId: 'comp-02',
            transferNumber: 'TT-1',
            date: '2026-02-20',
            fromTreasuryId: 'tr-comp2-01',
            toTreasuryId: 'tr-01',
            amount: 100,
            currency: 'YER',
            feeAmount: 0,
            createdBy: 'x',
          },
          'br-comp2-01'
        ).ok
      ).toBe(false);

      expect(
        postExpenseTransaction(dbComp2Active, ownerComp1Only, {
          ...db.expenseRecords[0],
          id: 'exp-hack',
          companyId: 'comp-02',
        }).ok
      ).toBe(false);

      expect(
        disbursePayrollTransaction(
          dbComp2Active,
          ownerComp1Only,
          { ...db.payrollRuns[0], id: 'pr-hack', companyId: 'comp-02' },
          'br-comp2-01'
        ).ok
      ).toBe(false);

      expect(
        executeYearEndClosingTransaction(dbComp2Active, ownerComp1Only, '2026', '2026-12-31').ok
      ).toBe(false);

      expect(
        executeFxRevaluationTransaction(dbComp2Active, ownerComp1Only, '2026-02-20').ok
      ).toBe(false);

      // Even while comp-01 is active, targeting an entity owned by comp-02 must fail
      expect(cancelInvoiceTransaction(db, ownerComp1Only, 'inv-comp2-01').ok).toBe(false);
      expect(cancelVoucherTransaction(db, ownerComp1Only, 'pv-comp2-01').ok).toBe(false);
      expect(reverseJournalTransaction(db, ownerComp1Only, 'je-comp2-01', 'hack').ok).toBe(false);
      expect(
        disposeFixedAssetTransaction(
          db,
          ownerComp1Only,
          'fa-comp2-01',
          1000,
          'tr-01',
          '2026-02-20'
        ).ok
      ).toBe(false);
      expect(
        executeStockTransferTransaction(dbComp2Active, ownerComp1Only, {
          id: 'st-hack',
          companyId: 'comp-02',
          transferNumber: 'TR-HACK',
          date: '2026-02-20',
          fromWarehouseId: 'wh-comp2-01',
          toWarehouseId: 'wh-01',
          items: [{ itemId: 'item-01', itemName: 'Test', unit: 'حبة', quantity: 1, unitCost: 100 }],
          notes: '',
          status: 'completed',
          performedBy: 'x',
        }).ok
      ).toBe(false);
      expect(
        reverseStockTransferTransaction(dbComp2Active, ownerComp1Only, {
          id: 'st-hack2',
          companyId: 'comp-02',
          transferNumber: 'TR-HACK2',
          date: '2026-02-20',
          fromWarehouseId: 'wh-comp2-01',
          toWarehouseId: 'wh-01',
          items: [{ itemId: 'item-01', itemName: 'Test', unit: 'حبة', quantity: 1, unitCost: 100 }],
          notes: '',
          status: 'completed',
          performedBy: 'x',
        }).ok
      ).toBe(false);
      expect(
        approveStocktakingTransaction(dbComp2Active, ownerComp1Only, {
          id: 'stk-hack',
          companyId: 'comp-02',
          stocktakeNumber: 'STK-1',
          scope: 'warehouse',
          date: '2026-02-20',
          warehouseId: 'wh-comp2-01',
          items: [],
          status: 'draft',
          conductedBy: 'x',
        }).ok
      ).toBe(false);
    });
  });

  describe('SVG / <img src> XSS Neutralization in exportService', () => {
    it('blocks javascript:, data:image/svg+xml, quote-breakout payloads and preserves safe raster images', () => {
      expect(sanitizeImageSrc('javascript:alert(1)')).toBe('');
      expect(sanitizeImageSrc('data:image/svg+xml,<svg onload=alert(1)>')).toBe('');
      expect(sanitizeImageSrc('data:text/html,<script>alert(1)</script>')).toBe('');
      expect(sanitizeImageSrc('" onerror="alert(1)')).toBe('');

      const validPng =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      expect(sanitizeImageSrc(validPng)).toBe(validPng);
      expect(sanitizeImageSrc('https://cdn.almansoor.example/logo.png')).toBe(
        'https://cdn.almansoor.example/logo.png'
      );

      const { db } = createTwoCompanyDb();
      const maliciousHtml = generatePrintableHTML({
        title: 'تقرير <script>alert(1)</script>',
        tables: [
          {
            headers: ['البيان'],
            rows: [['اختبار']],
          },
        ],
        company: {
          ...db.company,
          logoUrl: '" onerror="alert(1)',
          bannerBase64: 'data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+PC9zdmc+',
          useFullBanner: true,
        },
      });
      expect(maliciousHtml).not.toContain('onerror=');
      expect(maliciousHtml).not.toContain('image/svg+xml');
      expect(maliciousHtml).not.toContain('<script>alert(1)</script>');
    });
  });
});
