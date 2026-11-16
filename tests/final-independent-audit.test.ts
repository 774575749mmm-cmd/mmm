/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * MASTER FINAL VERIFICATION — Independent Post-Remediation Audit Suite
 * Covers Phases 2–6: Live Server Auth & RBAC, Tenant Isolation, Exact FIFO & Double-Entry Accounting,
 * Unified Print & Typography + Intelligent Pagination + Binary PDF, and AES-256-GCM Backup/Restore.
 */

import http from 'node:http';
import crypto from 'node:crypto';
import { describe, it, expect } from 'vitest';
import {
  createErpServerApp,
  hashPasswordPbkdf2Server,
} from '../server/app';
import {
  getInitialDatabase,
  scopeDatabaseToCompany,
  switchActiveCompanyInDb,
  filterDatabaseForUserTenants,
  encryptBackupPayload,
  decryptBackupPayload,
  validateBackupPayload,
  validateDatabaseObject,
  ERPDatabase,
} from '../src/services/storageService';
import {
  assertTenantAccess,
  assertPermission,
  verifyPasswordWithMigrationAsync,
  hashPasswordAsync,
  generateSaltHex,
} from '../src/services/securityService';
import {
  postPurchaseInvoiceTransaction,
  postSalesInvoiceTransaction,
  cancelInvoiceTransaction,
  postVouchersBatchTransaction,
  cancelVoucherTransaction,
  updateUserPermissionsTransaction,
  addUserTransaction,
} from '../src/services/erpTransactionService';
import { runFinancialIntegrityScan } from '../src/services/financialIntegrityService';
import {
  generatePrintableHTML,
  resolveEffectivePrintTemplate,
  verifyPdfSignature,
} from '../src/services/exportService';
import { buildDocumentPaginationPlan } from '../src/services/documentPaginationEngine';
import {
  buildReportPdfBytes,
  buildInvoicePdfBytes,
  buildVoucherPdfBytes,
  buildBatchReportPdfBytes,
} from '../src/services/arabicPdfHelper';
import type { Invoice, PaymentVoucher, User } from '../src/types/erp';

async function startEphemeralServer(options: Parameters<typeof createErpServerApp>[0] = {}) {
  const app = createErpServerApp({
    inMemoryAuthStore: true,
    sessionSecret: 'audit-verification-secret-at-least-32-chars!!',
    ...options,
  });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

describe('MASTER FINAL VERIFICATION — Independent Audit Suite', () => {
  describe('Phase 2: Real Authentication, Session Expiry, Inactive Users, RBAC & Secret Hygiene', () => {
    it('executes full auth lifecycle: PBKDF2 login, wrong password, inactive block, empty companies fail-closed, expired cookie, logout & RBAC', async () => {
      const srv = await startEphemeralServer();
      try {
        // 1. Bootstrap owner
        const bootRes = await fetch(`${srv.baseUrl}/api/auth/bootstrap`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: 'usr-owner-audit',
            username: 'audit_owner',
            fullName: 'مدير التدقيق',
            password: 'AuditOwner#2026',
            allowedCompanyIds: ['comp-01'],
          }),
        });
        expect(bootRes.status).toBe(201);
        const bootJson = await bootRes.json();
        expect(bootJson.user.passwordHash).toBeUndefined();
        expect(bootJson.user.passwordSalt).toBeUndefined();
        const ownerCookie = (bootRes.headers.get('set-cookie') || '').split(';')[0];
        expect(ownerCookie).toContain('erp_session=');

        // 2. Provision Cashier, Inactive User, Limited User, and Zero-Company User
        const cashierRes = await fetch(`${srv.baseUrl}/api/auth/users`, {
          method: 'POST',
          headers: { Cookie: ownerCookie, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: 'usr-cashier-audit',
            username: 'audit_cashier',
            fullName: 'أمين صندوق التدقيق',
            role: 'أمين الصندوق',
            allowedCompanyIds: ['comp-01'],
            active: true,
            password: 'CashierPass#2026',
          }),
        });
        expect(cashierRes.status).toBe(201);

        const inactiveRes = await fetch(`${srv.baseUrl}/api/auth/users`, {
          method: 'POST',
          headers: { Cookie: ownerCookie, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: 'usr-inactive-audit',
            username: 'audit_inactive',
            fullName: 'مستخدم موقوف',
            role: 'محاسب',
            allowedCompanyIds: ['comp-01'],
            active: false,
            password: 'InactivePass#2026',
          }),
        });
        expect(inactiveRes.status).toBe(201);

        const zeroCompRes = await fetch(`${srv.baseUrl}/api/auth/users`, {
          method: 'POST',
          headers: { Cookie: ownerCookie, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: 'usr-nocomp-audit',
            username: 'audit_nocomp',
            fullName: 'مستخدم بلا منشأة',
            role: 'مالك المؤسسة',
            allowedCompanyIds: [],
            active: true,
            password: 'NoCompPass#2026',
          }),
        });
        expect(zeroCompRes.status).toBe(201);
        const zeroCompJson = await zeroCompRes.json();
        // Verify empty allowedCompanyIds was NOT silently replaced with ['comp-01']
        expect(zeroCompJson.user.allowedCompanyIds).toEqual([]);

        // 3. Valid Login succeeds with HttpOnly cookie and no secret hashes leaked
        const loginOk = await fetch(`${srv.baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'audit_cashier', password: 'CashierPass#2026' }),
        });
        expect(loginOk.status).toBe(200);
        const setCookieHeader = loginOk.headers.get('set-cookie') || '';
        expect(setCookieHeader).toContain('HttpOnly');
        expect(setCookieHeader).toContain('SameSite=Lax');
        const cashierCookie = setCookieHeader.split(';')[0];
        const loginBody = await loginOk.json();
        expect(loginBody.user.passwordHash).toBeUndefined();
        expect(loginBody.user.passwordSalt).toBeUndefined();

        // 4. Wrong password -> 401
        const badPass = await fetch(`${srv.baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'audit_cashier', password: 'WrongPassword!1' }),
        });
        expect(badPass.status).toBe(401);

        // 5. Inactive user -> 401 ACCOUNT_DISABLED + local verifyPasswordWithMigrationAsync fails closed
        const inactiveLogin = await fetch(`${srv.baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'audit_inactive', password: 'InactivePass#2026' }),
        });
        expect(inactiveLogin.status).toBe(401);
        const inactiveErr = await inactiveLogin.json();
        expect(inactiveErr.code).toBe('ACCOUNT_DISABLED');

        const salt = generateSaltHex(16);
        const hash = await hashPasswordAsync('InactivePass#2026', salt);
        const localInactiveUser: User = {
          ...getInitialDatabase().users[0],
          id: 'usr-inactive-local',
          active: false,
          passwordSalt: salt,
          passwordHash: hash,
        };
        const localCheck = await verifyPasswordWithMigrationAsync(localInactiveUser, 'InactivePass#2026');
        expect(localCheck.ok).toBe(false);

        // 6. Zero allowedCompanyIds -> 403 NO_COMPANY_ACCESS on server login
        const zeroCompLogin = await fetch(`${srv.baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'audit_nocomp', password: 'NoCompPass#2026' }),
        });
        expect(zeroCompLogin.status).toBe(403);
        const zeroCompErr = await zeroCompLogin.json();
        expect(zeroCompErr.code).toBe('NO_COMPANY_ACCESS');

        // 7. Expired session cookie -> 401 on protected endpoint & /api/auth/verify
        const secret = 'audit-verification-secret-at-least-32-chars!!';
        const expPayload = Buffer.from(
          JSON.stringify({
            userId: 'usr-owner-audit',
            username: 'audit_owner',
            role: 'مالك المؤسسة',
            companyId: 'comp-01',
            allowedCompanyIds: ['comp-01'],
            iat: Date.now() - 200_000,
            exp: Date.now() - 5_000,
          })
        ).toString('base64url');
        const expSig = crypto.createHmac('sha256', secret).update(expPayload).digest('base64url');
        const expiredCookie = `erp_session=${encodeURIComponent(`${expPayload}.${expSig}`)}`;

        const verifyExp = await fetch(`${srv.baseUrl}/api/auth/verify`, {
          headers: { Cookie: expiredCookie },
        });
        expect(verifyExp.status).toBe(401);

        // 8. Logout clears cookie & unauthenticated access returns 401
        const logoutRes = await fetch(`${srv.baseUrl}/api/auth/logout`, {
          method: 'POST',
          headers: { Cookie: cashierCookie },
        });
        expect(logoutRes.status).toBe(200);
        expect(logoutRes.headers.get('set-cookie')).toContain('Max-Age=0');

        const unauthVerify = await fetch(`${srv.baseUrl}/api/auth/verify`);
        expect(unauthVerify.status).toBe(401);
        const unauthAi = await fetch(`${srv.baseUrl}/api/ai/analyze`, { method: 'POST' });
        expect(unauthAi.status).toBe(401);
        const unauthWa = await fetch(`${srv.baseUrl}/api/whatsapp/dispatch`, { method: 'POST' });
        expect(unauthWa.status).toBe(401);

        // 9. RBAC: Cashier calling /api/ai/analyze -> 403 FORBIDDEN_ROLE
        const cashierAi = await fetch(`${srv.baseUrl}/api/ai/analyze`, {
          method: 'POST',
          headers: { Cookie: cashierCookie, 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: 'test' }),
        });
        expect(cashierAi.status).toBe(403);

        // 10. Status never exposes passwordHash or passwordSalt
        const statusRes = await fetch(`${srv.baseUrl}/api/auth/status`, {
          headers: { Cookie: ownerCookie },
        });
        expect(statusRes.status).toBe(200);
        const statusText = await statusRes.text();
        expect(statusText).not.toContain('passwordHash');
        expect(statusText).not.toContain('passwordSalt');
      } finally {
        await srv.close();
      }
    });
  });

  describe('Phase 3: Multi-Tenant Data & Backup Isolation', () => {
    it('isolates Company A from Company B across scopeDatabaseToCompany, filterDatabaseForUserTenants, payload spoofing & user governance', () => {
      const base = getInitialDatabase();
      const comp2 = {
        ...base.company,
        id: 'comp-02',
        nameAr: 'الشركة الثانية للتدقيق',
        nameEn: 'Audit Second Corp',
      };
      const db: ERPDatabase = {
        ...base,
        companies: [base.company, comp2],
        activeCompanyId: 'comp-01',
        branches: [
          ...base.branches,
          { ...base.branches[0], id: 'br-comp2', companyId: 'comp-02', nameAr: 'فرع ب' },
        ],
        customers: [
          ...base.customers,
          { ...base.customers[0], id: 'cust-b-1', companyId: 'comp-02', code: 'C-B1', nameAr: 'عميل الشركة ب السري' },
        ],
        invoices: [
          ...base.invoices,
          { ...base.invoices[0], id: 'inv-b-1', companyId: 'comp-02', invoiceNumber: 'B-INV-999' },
        ],
        journalEntries: [
          ...base.journalEntries,
          { ...base.journalEntries[0], id: 'je-b-1', companyId: 'comp-02', entryNumber: 'B-JV-999' },
        ],
        auditLogs: [
          ...base.auditLogs,
          {
            id: 'log-b-1',
            companyId: 'comp-02',
            timestamp: new Date().toISOString(),
            userId: 'usr-b',
            userName: 'مدير الشركة ب',
            action: 'إنشاء',
            module: 'المبيعات',
            details: 'عملية سرية خاصة بالشركة ب',
          },
        ],
        users: [
          ...base.users,
          {
            ...base.users[0],
            id: 'usr-comp2-only',
            username: 'comp2admin',
            fullName: 'مدير الشركة الثانية',
            allowedCompanyIds: ['comp-02'],
          },
        ],
      };

      const comp1Admin: User = { ...db.users[0], allowedCompanyIds: ['comp-01'] };
      const zeroCompanyOwner: User = { ...db.users[0], role: 'مالك المؤسسة', allowedCompanyIds: [] };

      // 1. filterDatabaseForUserTenants excludes all Company B data from backups, users, audit logs
      const exportViewA = filterDatabaseForUserTenants(db, comp1Admin);
      expect(exportViewA.companies?.map((c) => c.id)).toEqual(['comp-01']);
      expect(exportViewA.customers.some((c) => c.companyId === 'comp-02')).toBe(false);
      expect(exportViewA.invoices.some((i) => i.id === 'inv-b-1')).toBe(false);
      expect(exportViewA.journalEntries.some((j) => j.id === 'je-b-1')).toBe(false);
      expect(exportViewA.auditLogs.some((l) => l.id === 'log-b-1')).toBe(false);
      expect(exportViewA.users.some((u) => u.id === 'usr-comp2-only')).toBe(false);

      // 2. Empty allowedCompanyIds fails closed with 0 tenant data even for Owner role
      const exportViewZero = filterDatabaseForUserTenants(db, zeroCompanyOwner);
      expect(exportViewZero.companies).toHaveLength(0);
      expect(exportViewZero.invoices).toHaveLength(0);
      expect(exportViewZero.customers).toHaveLength(0);
      expect(exportViewZero.chartOfAccounts).toHaveLength(0);
      expect(assertTenantAccess(zeroCompanyOwner, 'comp-01').ok).toBe(false);

      // 3. Spoofing invoice.companyId = 'comp-02' while comp-01 is active MUST be rejected
      const spoofSaleRes = postSalesInvoiceTransaction(db, comp1Admin, {
        ...db.invoices[0],
        id: 'inv-spoof-1',
        companyId: 'comp-02',
        invoiceNumber: 'SPOOF-01',
      });
      expect(spoofSaleRes.ok).toBe(false);

      // 4. Company A admin cannot modify or add users targeting Company B
      const crossUserEdit = updateUserPermissionsTransaction(db, comp1Admin, {
        ...db.users.find((u) => u.id === 'usr-comp2-only')!,
        active: false,
      });
      expect(crossUserEdit.ok).toBe(false);

      const escalateUserRes = addUserTransaction(db, comp1Admin, {
        ...comp1Admin,
        id: 'usr-escalated',
        username: 'escalated',
        allowedCompanyIds: ['comp-01', 'comp-02'],
      });
      expect(escalateUserRes.ok).toBe(false);

      // 5. scopeDatabaseToCompany on comp-01 never exposes comp-02 records to GlobalSearch
      const scopedA = scopeDatabaseToCompany(db, 'comp-01');
      expect(scopedA.customers.some((c) => c.id === 'cust-b-1')).toBe(false);
      expect(scopedA.invoices.some((i) => i.id === 'inv-b-1')).toBe(false);
    });
  });

  describe('Phase 4: Exact Accounting Integrity & FIFO Lot Valuation', () => {
    it('computes exact FIFO COGS = 13,000 and Remaining Inventory = 8 units @ 12,000 for (Buy 10@1000, Buy 10@1500, Sell 12)', () => {
      const base = getInitialDatabase();
      const admin = base.users[0];

      // Add a clean FIFO item with 0 initial stock in wh-01
      const fifoItem = {
        ...base.inventoryItems[0],
        id: 'item-fifo-audit',
        code: 'FIFO-100',
        barcode: '9988776655',
        nameAr: 'صنف اختبار FIFO القياسي',
        purchasePrice: 1000,
        salePrice: 2000,
        valuationMethod: 'FIFO' as const,
      };
      let db: ERPDatabase = {
        ...base,
        company: { ...base.company, valuationPolicy: 'FIFO' },
        inventoryItems: [...base.inventoryItems, fifoItem],
        warehouseStock: [
          ...base.warehouseStock,
          {
            companyId: 'comp-01',
            itemId: 'item-fifo-audit',
            warehouseId: 'wh-01',
            quantityOnHand: 0,
            averageCost: 0,
          },
        ],
      };

      // Purchase #1: 10 units @ 1,000 = 10,000 YER (Tax 0%)
      const pur1: Invoice = {
        id: 'inv-fifo-p1',
        companyId: 'comp-01',
        invoiceNumber: 'P-FIFO-001',
        type: 'مشتريات',
        paymentType: 'آجل',
        date: '2026-04-01',
        branchId: 'br-01',
        warehouseId: 'wh-01',
        entityId: 'vend-01',
        entityName: base.vendors[0].nameAr,
        currency: 'YER',
        exchangeRate: 1,
        items: [
          {
            id: 'l-p1',
            itemId: 'item-fifo-audit',
            itemName: fifoItem.nameAr,
            itemBarcode: fifoItem.barcode,
            unit: 'حبة',
            quantity: 10,
            unitPrice: 1000,
            discountPercentage: 0,
            discountAmount: 0,
            subtotal: 10000,
            taxPercentage: 0,
            taxAmount: 0,
            total: 10000,
            unitCost: 1000,
          },
        ],
        subtotal: 10000,
        discountTotal: 0,
        taxTotal: 0,
        grandTotal: 10000,
        paidAmount: 0,
        remainingAmount: 10000,
        status: 'draft',
        createdBy: admin.fullName,
        createdAt: new Date().toISOString(),
      };
      const resP1 = postPurchaseInvoiceTransaction(db, admin, pur1);
      expect(resP1.ok).toBe(true);
      db = resP1.nextDb!;

      // Purchase #2: 10 units @ 1,500 = 15,000 YER (Tax 0%)
      const pur2: Invoice = {
        ...pur1,
        id: 'inv-fifo-p2',
        invoiceNumber: 'P-FIFO-002',
        date: '2026-04-02',
        items: [
          {
            ...pur1.items[0],
            id: 'l-p2',
            unitPrice: 1500,
            subtotal: 15000,
            total: 15000,
            unitCost: 1500,
          },
        ],
        subtotal: 15000,
        grandTotal: 15000,
        remainingAmount: 15000,
      };
      const resP2 = postPurchaseInvoiceTransaction(db, admin, pur2);
      expect(resP2.ok).toBe(true);
      db = resP2.nextDb!;

      expect(
        db.warehouseStock.find((s) => s.itemId === 'item-fifo-audit' && s.warehouseId === 'wh-01')?.quantityOnHand
      ).toBe(20);

      // Sell 12 units @ 2,000 = 24,000 YER
      const sale12: Invoice = {
        id: 'inv-fifo-s1',
        companyId: 'comp-01',
        invoiceNumber: 'S-FIFO-001',
        type: 'مبيعات',
        paymentType: 'آجل',
        date: '2026-04-03',
        branchId: 'br-01',
        warehouseId: 'wh-01',
        entityId: 'cust-01',
        entityName: base.customers[0].nameAr,
        currency: 'YER',
        exchangeRate: 1,
        items: [
          {
            id: 'l-s1',
            itemId: 'item-fifo-audit',
            itemName: fifoItem.nameAr,
            itemBarcode: fifoItem.barcode,
            unit: 'حبة',
            quantity: 12,
            unitPrice: 2000,
            discountPercentage: 0,
            discountAmount: 0,
            subtotal: 24000,
            taxPercentage: 0,
            taxAmount: 0,
            total: 24000,
            unitCost: 1000,
          },
        ],
        subtotal: 24000,
        discountTotal: 0,
        taxTotal: 0,
        grandTotal: 24000,
        paidAmount: 0,
        remainingAmount: 24000,
        status: 'draft',
        createdBy: admin.fullName,
        createdAt: new Date().toISOString(),
      };
      const resS1 = postSalesInvoiceTransaction(db, admin, sale12);
      expect(resS1.ok).toBe(true);
      db = resS1.nextDb!;

      // Exact FIFO assertions:
      // 1. COGS in stockMovements = 10*1000 + 2*1500 = 13,000
      const saleMovement = db.stockMovements.find((m) => m.documentId === 'inv-fifo-s1');
      expect(saleMovement?.quantityChange).toBe(-12);
      expect(saleMovement?.totalCost).toBe(13000);

      // 2. COGS & Inventory credit in GL Journal Entry = 13,000
      const saleJe = db.journalEntries.find((j) => j.referenceId === 'inv-fifo-s1')!;
      expect(saleJe.lines.find((l) => l.accountCode === '5110')?.debit).toBe(13000);
      expect(saleJe.lines.find((l) => l.accountCode === '115')?.credit).toBe(13000);
      expect(saleJe.lines.find((l) => l.accountCode === '114')?.debit).toBe(24000);
      expect(saleJe.lines.find((l) => l.accountCode === '4110')?.credit).toBe(24000);

      // 3. Remaining FIFO layers: Layer 1 = 0, Layer 2 = 8 units @ 1500 = 12,000
      const remainingLayers = (db.stockCostLayers || []).filter(
        (l) => l.itemId === 'item-fifo-audit' && l.warehouseId === 'wh-01' && l.remainingQuantity > 0
      );
      const remQty = remainingLayers.reduce((s, l) => s + l.remainingQuantity, 0);
      const remVal = remainingLayers.reduce((s, l) => s + l.remainingQuantity * l.unitCost, 0);
      expect(remQty).toBe(8);
      expect(remVal).toBe(12000);

      // 4. Every posted Journal Entry in DB is balanced (Debit === Credit)
      for (const je of db.journalEntries) {
        expect(Math.abs(je.totalDebit - je.totalCredit)).toBeLessThan(0.01);
      }

      // 5. Financial integrity scan passes without critical GL imbalance
      const scan = runFinancialIntegrityScan(db);
      expect(scan.issues.some((i) => i.category === 'unbalanced_journal' && i.severity === 'critical')).toBe(false);
    });
  });

  describe('Phase 5: Unified Print Engine, Typography Control, Pagination & Binary PDFs', () => {
    it('reflects exact font sizes, repeats table headers across pages even with partial templates, avoids row splits & orphan headers, and generates valid Arabic PDFs', async () => {
      const db = getInitialDatabase();
      const company = db.company;
      const branch = db.branches[0];

      // Partial template omitting repeatTableHeader must preserve default true
      const resolvedPartial = resolveEffectivePrintTemplate({
        docType: 'report',
        printTemplate: {
          ...db.settings.printTemplates!.report!,
          repeatTableHeader: undefined as unknown as boolean,
          typography: {
            ...db.settings.printTemplates!.report!.typography!,
            unit: 'pt',
            companyName: 18,
            documentTitle: 16,
            tableHeaders: 13,
            tableCells: 11,
          },
          pagination: {
            ...db.settings.printTemplates!.report!.pagination!,
            minimumRowsBeforeTableBreak: 4,
            preventRowSplit: true,
          },
        },
      });
      expect(resolvedPartial.repeatTableHeader).toBe(true);
      expect(resolvedPartial.typography?.companyName).toBe(18);
      expect(resolvedPartial.typography?.tableCells).toBe(11);

      // Multi-page 70-row report
      const rows = Array.from({ length: 70 }, (_, idx) => [
        idx + 1,
        `بند تقرير مالي عربي اختباري رقم ${idx + 1} وصف طويل متوازن`,
        5,
        1250,
        6250,
      ]);
      const reportOptions = {
        title: 'تقرير التدقيق المستقل متعدد الصفحات',
        subtitle: 'اختبار التحكم بالخطوط وتكرار الرؤوس ومنع انقسام الصفوف',
        company,
        branch,
        preparedBy: db.users[0].fullName,
        docType: 'report' as const,
        printTemplate: resolvedPartial,
        tables: [
          {
            title: 'جدول الحركات التفصيلية',
            headers: ['#', 'البيان', 'الكمية', 'السعر', 'الإجمالي'],
            rows,
            totals: ['-', 'الإجمالي العام', 350, '-', '437,500'],
          },
        ],
      };

      const plan = buildDocumentPaginationPlan(reportOptions);
      expect(plan.pages.length).toBeGreaterThanOrEqual(2);
      expect(plan.typoPt.companyName).toBe(18);
      expect(plan.typoPt.tableCells).toBe(11);

      // Every table chunk across all pages repeats table headers
      const allChunks = plan.pages.flatMap((p) => p.blocks.filter((b) => b.kind === 'table-chunk'));
      expect(allChunks.every((c) => c.showTableHeader === true)).toBe(true);
      // Totals row appears ONLY once on the last chunk
      expect(allChunks.filter((c) => Boolean(c.totals))).toHaveLength(1);
      expect(allChunks[allChunks.length - 1].isFinalChunk).toBe(true);

      // Unified HTML contains exact typography sizes, RTL dir, row break-inside avoid, and no duplicate full headers
      const html = generatePrintableHTML({ ...reportOptions, forPreview: false });
      expect(html).toContain('dir="rtl"');
      expect(html).toContain('font-size: 18pt');
      expect(html).toContain('font-size: 16pt');
      expect(html).toContain('font-size: 13pt');
      expect(html).toContain('font-size: 11pt');
      expect(html).toContain('.report-table tr { break-inside: avoid; page-break-inside: avoid; }');
      expect((html.match(/class="header-section/g) || []).length).toBe(1);

      // Minimum rows before table break prevents orphan header on multi-table report
      const twoTablePlan = buildDocumentPaginationPlan({
        ...reportOptions,
        tables: [
          {
            title: 'الجدول الأول',
            headers: ['#', 'البيان', 'القيمة'],
            rows: Array.from({ length: 24 }, (_, i) => [i + 1, `سطر تملأ الصفحة ${i + 1}`, 100]),
          },
          {
            title: 'الجدول الثاني المحمي من اليتيم',
            headers: ['#', 'البيان', 'القيمة'],
            rows: Array.from({ length: 12 }, (_, i) => [i + 1, `بند الجدول الثاني ${i + 1}`, 250]),
          },
        ],
      });
      const secondTableDecision = twoTablePlan.decisions[1];
      if (secondTableDecision.remainingBeforeMm < secondTableDecision.requiredMinMm) {
        expect(secondTableDecision.movedToNextPage).toBe(true);
      }

      // Binary Arabic PDF checks: report, invoice, voucher, and batch
      const reportPdf = await buildReportPdfBytes(reportOptions);
      expect(verifyPdfSignature(reportPdf)).toBe(true);
      expect(reportPdf.length).toBeGreaterThan(15000);

      const invPdf = await buildInvoicePdfBytes(db.invoices[0], company, branch, 'المستودع الرئيسي', resolvedPartial);
      expect(verifyPdfSignature(invPdf)).toBe(true);

      const vchPdf = await buildVoucherPdfBytes(db.paymentVouchers[0], company, branch, resolvedPartial);
      expect(verifyPdfSignature(vchPdf)).toBe(true);

      const batchPdf = await buildBatchReportPdfBytes([
        reportOptions,
        {
          ...reportOptions,
          title: 'تقرير ثاني مدمج',
          tables: [{ headers: ['البند', 'القيمة'], rows: [['اختبار', 100]] }],
        },
      ]);
      expect(verifyPdfSignature(batchPdf)).toBe(true);
    });
  });

  describe('Phase 6: AES-256-GCM Backup Encryption, Failure Isolation & Large Dataset Restore', () => {
    it('exports encrypted backup, rejects wrong/tampered/corrupt inputs without side effects, and restores into isolated DB with full balance parity', async () => {
      const base = getInitialDatabase();
      const admin = base.users[0];
      // Perform a real invoice posting before backup so balances & counts differ from seed
      const saleInv: Invoice = {
        id: 'inv-bkp-verify-1',
        companyId: 'comp-01',
        invoiceNumber: 'BKP-SAL-001',
        type: 'مبيعات',
        paymentType: 'نقدي',
        treasuryAccountId: 'tr-01',
        date: '2026-04-05',
        branchId: 'br-01',
        warehouseId: 'wh-01',
        entityId: 'cust-01',
        entityName: base.customers[0].nameAr,
        currency: 'YER',
        exchangeRate: 1,
        items: [
          {
            id: 'bl-1',
            itemId: 'item-01',
            itemName: base.inventoryItems[0].nameAr,
            itemBarcode: base.inventoryItems[0].barcode,
            unit: 'حبة',
            quantity: 1,
            unitPrice: 450000,
            discountPercentage: 0,
            discountAmount: 0,
            subtotal: 450000,
            taxPercentage: 0,
            taxAmount: 0,
            total: 450000,
            unitCost: base.inventoryItems[0].purchasePrice,
          },
        ],
        subtotal: 450000,
        discountTotal: 0,
        taxTotal: 0,
        grandTotal: 450000,
        paidAmount: 450000,
        remainingAmount: 0,
        status: 'draft',
        createdBy: admin.fullName,
        createdAt: new Date().toISOString(),
      };
      const postRes = postSalesInvoiceTransaction(base, admin, saleInv);
      expect(postRes.ok).toBe(true);
      const liveDb = postRes.nextDb!;

      const expectedInvoices = liveDb.invoices.length;
      const expectedJEs = liveDb.journalEntries.length;
      const expectedTreasuryBal = liveDb.treasuryAccounts.find((t) => t.id === 'tr-01')!.balance;
      const expectedCoaCash = liveDb.chartOfAccounts.find((a) => a.code === '1111')!.currentBalance;

      // 1. Encrypt .json.enc
      const encrypted = await encryptBackupPayload(liveDb, 'AuditBackup#2026');
      expect(encrypted).toContain('ALMANSOOR_ERP_AES256_GCM_V1');

      // 2. Wrong passphrase rejected
      await expect(decryptBackupPayload(encrypted, 'WrongBackup#999')).rejects.toThrow();

      // 3. Tampered ciphertext rejected via AES-GCM tag
      const env = JSON.parse(encrypted) as { ciphertext: string; [k: string]: unknown };
      env.ciphertext = env.ciphertext.slice(0, -6) + 'AAAAAA';
      await expect(decryptBackupPayload(JSON.stringify(env), 'AuditBackup#2026')).rejects.toThrow();

      // 4. Corrupted JSON / missing tables fail validation cleanly without touching liveDb
      expect(validateBackupPayload('{corrupt').valid).toBe(false);
      expect(validateDatabaseObject({ company: { nameAr: 'X' }, invoices: [] }).valid).toBe(false);

      // 5. Decrypt & restore into completely isolated DB object
      const decryptedJson = await decryptBackupPayload(encrypted, 'AuditBackup#2026');
      const restoredCheck = validateBackupPayload(decryptedJson);
      expect(restoredCheck.valid).toBe(true);
      const restoredDb = restoredCheck.db!;
      expect(restoredDb).not.toBe(liveDb);
      expect(restoredDb.invoices.length).toBe(expectedInvoices);
      expect(restoredDb.journalEntries.length).toBe(expectedJEs);
      expect(restoredDb.treasuryAccounts.find((t) => t.id === 'tr-01')!.balance).toBe(expectedTreasuryBal);
      expect(restoredDb.chartOfAccounts.find((a) => a.code === '1111')!.currentBalance).toBe(expectedCoaCash);

      // 6. Scale test: 1,200 invoices encrypt -> decrypt -> validate
      const largeInvoices = Array.from({ length: 1200 }, (_, i) => ({
        ...saleInv,
        id: `inv-big-${i}`,
        invoiceNumber: `BIG-${i + 1}`,
      }));
      const largeDb: ERPDatabase = { ...liveDb, invoices: largeInvoices };
      const largeEnc = await encryptBackupPayload(largeDb, 'LargePass#2026');
      const largeDec = await decryptBackupPayload(largeEnc, 'LargePass#2026');
      const largeVal = validateBackupPayload(largeDec);
      expect(largeVal.valid).toBe(true);
      expect(largeVal.db?.invoices.length).toBe(1200);
    }, 15000);
  });
});
