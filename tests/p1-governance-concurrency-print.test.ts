/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Stage P1-C Audit Tests: Governance SoD, Migrated Atomic Transactions, Optimistic Revision Locking,
 * Idempotency, Binary Arabic PDF Signature, Smart Multi-Page Pagination, Header Non-Duplication & XSS Safety.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getInitialDatabase,
  migrateDatabase,
  commitRevisionCheck,
  saveDatabaseAtomicWithLock,
  ERPDatabase,
} from '../src/services/storageService';
import {
  postManualJournalTransaction,
  processApprovalDecisionTransaction,
  postSalesInvoiceTransaction,
  postVouchersBatchTransaction,
  adjustStockTransaction,
  runDepreciationTransaction,
  saveCustomBookEntryTransaction,
  updateApprovalRuleTransaction,
  toggleFiscalPeriodTransaction,
  updateUserPermissionsTransaction,
} from '../src/services/erpTransactionService';
import { buildDocumentPaginationPlan } from '../src/services/documentPaginationEngine';
import { generatePrintableHTML, verifyPdfSignature } from '../src/services/exportService';
import { buildInvoicePdfBytes, buildReportPdfBytes } from '../src/services/arabicPdfHelper';
import { Invoice, JournalEntry, PaymentVoucher, User } from '../src/types/erp';

function createSecondManager(baseUser: User, id: string, fullName: string, role: User['role']): User {
  return {
    ...baseUser,
    id,
    username: id,
    fullName,
    role,
    allowedCompanyIds: ['comp-01', 'comp-02'],
    canManageSettings: true,
    canPostEntries: true,
  };
}

describe('P1 Governance SoD, Atomic Transactions, Concurrency & Print Fidelity', () => {
  const originalLocalStorage = globalThis.localStorage;

  beforeEach(() => {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
        setItem: (k: string, v: string) => {
          store.set(k, String(v));
        },
        removeItem: (k: string) => {
          store.delete(k);
        },
        clear: () => store.clear(),
      },
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: originalLocalStorage,
    });
  });

  it('1. Enforces strict Separation of Duties (no self-approval, no same user approving Level 1 & Level 2)', () => {
    const baseDb = getInitialDatabase();
    const requester = baseDb.users[0];
    const approver1 = createSecondManager(requester, 'usr-cfo', 'سالم المدير المالي', 'المدير المالي');
    const approver2 = createSecondManager(requester, 'usr-owner-2', 'أحمد الشريك المعتمد', 'مالك المؤسسة');

    let db: ERPDatabase = {
      ...baseDb,
      users: [...baseDb.users, approver1, approver2],
      settings: {
        ...baseDb.settings,
        operationalControl: {
          ...baseDb.settings.operationalControl!,
          enableApprovalWorkflows: true,
        },
      },
      approvalRules: (baseDb.approvalRules || []).map((r) =>
        r.actionType === 'manual_journal_post'
          ? { ...r, enabled: true, minAmountThreshold: 1000, requiredLevels: 2 }
          : r
      ),
    };

    const bigEntry: JournalEntry = {
      id: 'je-sod-1',
      companyId: 'comp-01',
      entryNumber: 'JV-2026-9001',
      date: '2026-03-15',
      branchId: 'br-01',
      referenceType: 'دليل_يدوي',
      referenceNumber: 'MAN-SOD-1',
      description: 'قيد يتطلب اعتماد ثنائي',
      lines: [
        {
          id: 'jl-sod-1',
          accountId: 'acc-1111',
          accountCode: '1111',
          accountName: 'الصندوق الرئيسي',
          debit: 50000,
          credit: 0,
          currency: 'YER',
          exchangeRate: 1,
          memo: 'صندوق',
        },
        {
          id: 'jl-sod-2',
          accountId: 'acc-4110',
          accountCode: '4110',
          accountName: 'مبيعات',
          debit: 0,
          credit: 50000,
          currency: 'YER',
          exchangeRate: 1,
          memo: 'مبيعات',
        },
      ],
      totalDebit: 50000,
      totalCredit: 50000,
      status: 'posted',
      createdBy: requester.fullName,
      createdAt: new Date().toISOString(),
    };

    // Submits into Approval Inbox
    const submitRes = postManualJournalTransaction(db, requester, bigEntry);
    expect(submitRes.ok).toBe(false);
    expect(submitRes.approvalRequired).toBeTruthy();
    db = submitRes.nextDb!;
    const reqId = submitRes.approvalRequired!.id;

    // Requester CANNOT approve their own request
    const selfAttempt = processApprovalDecisionTransaction(db, requester, reqId, 'approved');
    expect(selfAttempt.ok).toBe(false);
    expect(selfAttempt.error).toContain('فصل المهام');

    // Approver 1 advances Level 1 -> Level 2
    const lvl1Res = processApprovalDecisionTransaction(db, approver1, reqId, 'approved');
    expect(lvl1Res.ok).toBe(true);
    db = lvl1Res.nextDb!;
    expect(db.approvalRequests!.find((r) => r.id === reqId)?.currentLevel).toBe(2);

    // Same Approver 1 CANNOT approve Level 2!
    const sameApproverAttempt = processApprovalDecisionTransaction(db, approver1, reqId, 'approved');
    expect(sameApproverAttempt.ok).toBe(false);
    expect(sameApproverAttempt.error).toContain('فصل المهام');

    // Distinct Approver 2 completes final approval & posts JE atomically
    const lvl2Res = processApprovalDecisionTransaction(db, approver2, reqId, 'approved');
    expect(lvl2Res.ok).toBe(true);
    db = lvl2Res.nextDb!;
    expect(db.approvalRequests!.find((r) => r.id === reqId)?.status).toBe('approved');
    expect(db.journalEntries.some((j) => j.id === 'je-sod-1')).toBe(true);
  });

  it('2. Executes migrated atomic stock adjustment, company-scoped depreciation, custom book & audited governance updates', () => {
    const baseDb = getInitialDatabase();
    const admin = baseDb.users[0];
    const targetItem = baseDb.inventoryItems[0];
    const targetWh = baseDb.warehouses[0];

    // Add a second company fixed asset to verify runDepreciationTransaction stays scoped to activeCompanyId
    const saAsset = {
      ...baseDb.fixedAssets[0],
      id: 'asset-sa-1',
      companyId: 'comp-02',
      currentBookValue: 100000,
      totalAccumulatedDepreciation: 0,
    };
    const dbWithTwoAssets: ERPDatabase = migrateDatabase({
      ...baseDb,
      fixedAssets: [...baseDb.fixedAssets, saAsset],
      users: baseDb.users.map((u) => ({
        ...u,
        passwordHash: 'secret_hash_should_never_leak',
        passwordSalt: 'secret_salt_should_never_leak',
      })),
    });

    // 2a. Atomic stock adjustment (+3 units -> GL + FIFO + StockMovement + Audit)
    const adjRes = adjustStockTransaction(dbWithTwoAssets, admin, targetItem.id, targetWh.id, 3, 'زيادة جرد مستودع', 'br-01');
    expect(adjRes.ok).toBe(true);
    const dbAfterAdj = adjRes.nextDb!;
    const adjJe = dbAfterAdj.journalEntries.find((j) => j.referenceNumber === adjRes.data!.adjustmentNumber);
    expect(adjJe).toBeTruthy();
    expect(adjJe!.totalDebit).toBe(adjJe!.totalCredit);
    expect(dbAfterAdj.auditLogs[0].module).toBe('المخزون');
    expect(dbAfterAdj.auditLogs[0].afterSnapshot).toBeTruthy();

    // Rejects negative adjustment below available stock
    const badAdj = adjustStockTransaction(dbAfterAdj, admin, targetItem.id, targetWh.id, -99999, 'عجز مستحيل', 'br-01');
    expect(badAdj.ok).toBe(false);

    // 2b. Atomic fixed asset depreciation (scoped strictly to comp-01)
    const deprRes = runDepreciationTransaction(dbAfterAdj, admin, 5000, 'br-01', '2026-03-31');
    expect(deprRes.ok).toBe(true);
    const saAssetAfter = deprRes.nextDb!.fixedAssets.find((a) => a.id === 'asset-sa-1')!;
    expect(saAssetAfter.totalAccumulatedDepreciation).toBe(0);

    // 2c. Atomic custom book entry
    const customRes = saveCustomBookEntryTransaction(deprRes.nextDb!, admin, 'br-01', {
      id: 'cb-ent-1',
      bookId: 'cbook-01',
      entryNumber: 'CB-1001',
      date: '2026-03-16',
      direction: 'IN',
      treasuryAccountId: 'tr-01',
      treasuryAccountName: 'الصندوق الرئيسي',
      rows: [
        {
          id: 'cbr-1',
          partyName: baseDb.customers[0].nameAr,
          statement: 'تحصيل عميل',
          debit: 1500,
          credit: 0,
          currency: 'YER',
        },
      ],
      totalDebit: 1500,
      totalCredit: 0,
      createdBy: admin.fullName,
      createdAt: new Date().toISOString(),
    });
    expect(customRes.ok).toBe(true);
    expect(customRes.nextDb!.paymentVouchers.some((v) => v.batchId === 'cbook-cb-ent-1')).toBe(true);

    // 2d. Audited governance updates (rule, fiscal period, user permissions without passwordHash leak)
    const ruleRes = updateApprovalRuleTransaction(customRes.nextDb!, admin, customRes.nextDb!.approvalRules![0].id, {
      enabled: true,
    });
    expect(ruleRes.ok).toBe(true);
    expect(ruleRes.nextDb!.auditLogs[0].beforeSnapshot).toEqual({
      enabled: false,
      minAmountThreshold: customRes.nextDb!.approvalRules![0].minAmountThreshold,
      requiredLevels: customRes.nextDb!.approvalRules![0].requiredLevels,
    });

    const periodId = ruleRes.nextDb!.fiscalPeriods![0].id;
    const periodRes = toggleFiscalPeriodTransaction(ruleRes.nextDb!, admin, periodId);
    expect(periodRes.ok).toBe(true);
    expect(periodRes.nextDb!.auditLogs[0].action).toBe('إقفال');

    const userRes = updateUserPermissionsTransaction(periodRes.nextDb!, admin, {
      ...periodRes.nextDb!.users[1],
      canManageSettings: true,
    });
    expect(userRes.ok).toBe(true);
    const auditSerialized = JSON.stringify(userRes.nextDb!.auditLogs[0]);
    expect(auditSerialized).not.toContain('secret_hash_should_never_leak');
    expect(auditSerialized).not.toContain('secret_salt_should_never_leak');
  });

  it('3. Rejects stale optimistic revision writes across concurrent tabs and blocks duplicate idempotencyKey submits', async () => {
    const dbV1 = getInitialDatabase();

    // Tab A & Tab B both start at revision 1
    expect(dbV1.revision).toBe(1);

    // Tab B commits first -> revision becomes 2
    const tabBSave = await saveDatabaseAtomicWithLock(dbV1, {
      expectedRevision: 1,
      sourceTabId: 'tab-B',
    });
    expect(tabBSave.ok).toBe(true);
    expect(tabBSave.savedDb?.revision).toBe(2);

    // Tab A attempts to commit stale expectedRevision=1 -> rejected cleanly
    const tabASave = await saveDatabaseAtomicWithLock(dbV1, {
      expectedRevision: 1,
      sourceTabId: 'tab-A',
    });
    expect(tabASave.ok).toBe(false);
    expect(tabASave.conflict).toBe(true);
    expect(tabASave.serverRevision).toBe(2);

    const pureConflict = commitRevisionCheck(2, dbV1, 1);
    expect(pureConflict.ok).toBe(false);

    // Idempotency key duplicate guard on Invoice & Voucher Batch
    const admin = dbV1.users[0];
    const cust = dbV1.customers[0];
    const item = dbV1.inventoryItems[0];

    const inv: Invoice = {
      id: 'inv-idem-1',
      companyId: 'comp-01',
      invoiceNumber: 'INV-IDEM-1',
      type: 'مبيعات',
      paymentType: 'نقدي',
      treasuryAccountId: 'tr-01',
      date: '2026-03-10',
      branchId: 'br-01',
      warehouseId: 'wh-01',
      entityId: cust.id,
      entityName: cust.nameAr,
      currency: 'YER',
      exchangeRate: 1,
      items: [
        {
          id: 'l-1',
          itemId: item.id,
          itemName: item.nameAr,
          itemBarcode: item.barcode,
          unit: item.baseUnit,
          quantity: 1,
          unitPrice: 5000,
          discountPercentage: 0,
          discountAmount: 0,
          subtotal: 5000,
          taxPercentage: 0,
          taxAmount: 0,
          total: 5000,
          unitCost: item.purchasePrice,
        },
      ],
      subtotal: 5000,
      discountTotal: 0,
      taxTotal: 0,
      grandTotal: 5000,
      paidAmount: 5000,
      remainingAmount: 0,
      status: 'draft',
      idempotencyKey: 'idem-inv-unique-1',
      createdBy: admin.fullName,
      createdAt: new Date().toISOString(),
    };

    const post1 = postSalesInvoiceTransaction(dbV1, admin, inv, { idempotencyKey: 'idem-inv-unique-1' });
    expect(post1.ok).toBe(true);
    const post2 = postSalesInvoiceTransaction(post1.nextDb!, admin, inv, { idempotencyKey: 'idem-inv-unique-1' });
    expect(post2.ok).toBe(false);
    expect(post2.error).toContain('مسبقاً');

    const voucher: PaymentVoucher = {
      id: 'vch-idem-1',
      companyId: 'comp-01',
      voucherNumber: 'RV-IDEM-1',
      batchId: 'batch-idem-1',
      type: 'قبض',
      date: '2026-03-10',
      branchId: 'br-01',
      treasuryAccountId: 'tr-01',
      treasuryAccountName: 'الصندوق الرئيسي',
      entityType: 'عميل',
      entityId: cust.id,
      entityName: cust.nameAr,
      amount: 1000,
      currency: 'YER',
      exchangeRate: 1,
      baseAmount: 1000,
      paymentMethod: 'نقداً',
      statement: 'سند تجربة عدم التكرار',
      status: 'posted',
      idempotencyKey: 'idem-vch-unique-1',
      receivedOrPaidBy: admin.fullName,
      createdBy: admin.fullName,
      createdAt: new Date().toISOString(),
    };
    const vPost1 = postVouchersBatchTransaction(post1.nextDb!, admin, [voucher], {
      idempotencyKey: 'idem-vch-unique-1',
    });
    expect(vPost1.ok).toBe(true);
    const vPost2 = postVouchersBatchTransaction(vPost1.nextDb!, admin, [voucher], {
      idempotencyKey: 'idem-vch-unique-1',
    });
    expect(vPost2.ok).toBe(false);
    expect(vPost2.error).toContain('مسبقاً');
  });

  it('4. Generates valid Arabic binary PDFs (%PDF-), paginates multi-page tables without duplicating headers, and escapes HTML/SVG XSS', async () => {
    const db = getInitialDatabase();
    const sampleInv = db.invoices[0];
    const company = db.companies![0];
    const branch = db.branches[0];

    // Binary Arabic PDF verification for Report & Invoice
    const rows = Array.from({ length: 55 }, (_, i) => [
      i + 1,
      `صنف تجريبي عربي رقم ${i + 1} مواصفات قياسية`,
      2,
      1500,
      3000,
    ]);

    const reportOptions = {
      title: 'تقرير مبيعات متعدد الصفحات',
      subtitle: 'كشف تفصيلي باللغة العربية',
      company,
      branch,
      preparedBy: db.users[0].fullName,
      tables: [
        {
          title: 'بنود المبيعات',
          headers: ['#', 'البيان', 'الكمية', 'السعر', 'الإجمالي'],
          rows,
          totals: ['-', 'الإجمالي النهائي', 110, '-', '165,000'],
        },
      ],
      printTemplates: db.settings.printTemplates,
      docType: 'report' as const,
    };

    const plan = buildDocumentPaginationPlan(reportOptions);
    expect(plan.pages.length).toBeGreaterThan(1);
    // Page 1 has full header; subsequent pages have continuation strip (NOT duplicated full banner/header)
    expect(plan.pages[0].headerKind).toBe('full');
    expect(plan.pages.slice(1).every((p) => p.headerKind !== 'full')).toBe(true);
    // All 55 rows preserved & totals appear strictly on final chunk
    const tableChunks = plan.pages.flatMap((p) =>
      p.blocks.filter((b) => b.kind === 'table-chunk')
    );
    const totalRowsAcrossPages = tableChunks.reduce((s, c) => s + c.rows.length, 0);
    expect(totalRowsAcrossPages).toBe(55);
    expect(tableChunks.filter((c) => Boolean(c.totals))).toHaveLength(1);
    expect(tableChunks[tableChunks.length - 1].isFinalChunk).toBe(true);

    const reportPdfBytes = await buildReportPdfBytes(reportOptions);
    expect(verifyPdfSignature(reportPdfBytes)).toBe(true);

    const invPdfBytes = await buildInvoicePdfBytes(sampleInv, company, branch, 'المستودع الرئيسي', db.settings.printTemplates?.invoice);
    expect(verifyPdfSignature(invPdfBytes)).toBe(true);

    // XSS Escaping & SVG payload sanitization in generatePrintableHTML
    const maliciousCompany = {
      ...company,
      nameAr: '<script>alert("xss")</script>شركة المنصور',
      logoUrl: 'data:image/svg+xml,<svg onload=alert(1)></svg>',
      bannerBase64: 'javascript:alert(2)',
    };
    const html = generatePrintableHTML({
      ...reportOptions,
      title: 'تقرير <img src=x onerror=alert(3)>',
      company: maliciousCompany,
    });
    expect(html).not.toContain('<script>alert("xss")</script>');
    expect(html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    expect(html).not.toContain('<img src=x onerror=alert(3)>');
    expect(html).not.toContain('image/svg+xml');
    expect(html).not.toContain('javascript:alert(2)');
  });
});
