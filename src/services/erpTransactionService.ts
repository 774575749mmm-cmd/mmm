/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Pure Atomic ERP Transaction Coordinator
 * Enforces RBAC, Tenant Isolation, Fiscal Period Locks, Approval Workflows, Idempotency,
 * FIFO/WA Stock Valuation, Double-Entry Accounting, Credit Limits, and Before/After Audit Diffs.
 */

import { ERPDatabase, generateNextDocNumber } from './storageService';
import {
  User,
  Invoice,
  PaymentVoucher,
  TreasuryTransfer,
  ExpenseRecord,
  JournalEntry,
  InventoryTransfer,
  PhysicalStocktaking,
  PayrollRun,
  AuditLogEntry,
  ApprovalActionType,
  ApprovalRequest,
  ApprovalWorkflowRule,
  CommercialOrder,
  CustomLedgerEntry,
  FiscalPeriod,
  FixedAsset,
} from '../types/erp';
import {
  assertPermission,
  assertTenantAccess,
  sanitizeInputText,
} from './securityService';
import {
  createSalesInvoiceJournalEntry,
  createPurchaseInvoiceJournalEntry,
  createVoucherJournalEntry,
  createExpenseJournalEntry,
  createReversalJournalEntry,
  createStocktakingJournalEntry,
  createAssetDisposalJournalEntry,
  createYearEndClosingEntry,
  generateFxRevaluationJournalEntry,
  validateJournalEntryWithAccounts,
  isDateInOpenFiscalPeriod,
  resolveAccount,
} from './accountingEngine';
import {
  updateWarehouseStock,
  executeInventoryTransfer,
  reverseInventoryTransfer,
  applyStocktakingAdjustments,
  addFifoCostLayer,
  consumeFifoCostLayers,
  applyBatchMovement,
  canFulfillStock,
} from './inventoryEngine';
import { getEffectiveCurrencyRate } from './currencyHelpers';

export interface TransactionResult<T = void> {
  ok: boolean;
  nextDb?: ERPDatabase;
  data?: T;
  error?: string;
  approvalRequired?: ApprovalRequest;
}

export interface TransactionOptions {
  bypassApprovalCheck?: boolean;
  idempotencyKey?: string;
  reason?: string;
}

function getRate(db: ERPDatabase, code?: string): number {
  const base = (db.company?.baseCurrency || db.currencies?.find((c) => c.isBase)?.code || 'YER').toUpperCase();
  const target = (code || base).toUpperCase();
  if (target === base) return 1;
  return getEffectiveCurrencyRate(db.currencies, target, undefined, base) || 1;
}

function verifyEntityCompany(
  entity: { companyId?: string } | undefined,
  activeCompanyId: string,
  label: string
): string | null {
  if (entity && entity.companyId && entity.companyId !== activeCompanyId) {
    return `عزل المنشآت: ${label} لا ينتمي إلى المنشأة النشطة (${activeCompanyId}).`;
  }
  return null;
}

function getCompanyAccounts(db: ERPDatabase, companyId: string) {
  const companySpecific = db.chartOfAccounts.filter((a) => a.companyId === companyId);
  if (companySpecific.some((a) => a.code === '115' || a.code === '114' || a.code === '4110')) {
    return companySpecific;
  }
  const shared = db.chartOfAccounts.filter((a) => !a.companyId);
  return shared.length > 0 ? shared : db.chartOfAccounts;
}

function checkIdempotency(db: ERPDatabase, key?: string): string | null {
  if (!key) return null;
  if ((db.processedIdempotencyKeys || []).includes(key)) {
    return `تم تنفيذ هذه العملية مسبقاً (مفتاح عدم التكرار: ${key}).`;
  }
  return null;
}

function appendIdempotencyKey(db: ERPDatabase, key?: string): string[] {
  const existing = db.processedIdempotencyKeys || [];
  if (!key || existing.includes(key)) return existing;
  return [...existing.slice(-250), key];
}

function checkApprovalRequired(
  db: ERPDatabase,
  user: User,
  actionType: ApprovalActionType,
  amountBase: number,
  documentNumber: string,
  entityLabel: string,
  payload: unknown,
  opts?: TransactionOptions
): ApprovalRequest | null {
  if (opts?.bypassApprovalCheck) return null;
  if (!db.settings.operationalControl?.enableApprovalWorkflows) return null;

  const activeCompanyId = db.activeCompanyId || db.company.id;
  const matchingRule = (db.approvalRules || []).find(
    (r) =>
      r.enabled &&
      r.actionType === actionType &&
      (!r.companyId || r.companyId === activeCompanyId) &&
      amountBase >= (r.minAmountThreshold || 0)
  );
  if (!matchingRule) return null;

  // Owner or explicitly authorized approver if threshold is 1-level and they are the top role?
  // Strict enforcement: even high roles submit into Approval Inbox when workflow rule is active unless bypassing via approval engine
  const ts = Date.now();
  const reqNum = generateNextDocNumber(
    'APR-',
    (db.approvalRequests || []).map((r) => r.requestNumber),
    4
  );

  return {
    id: `apr-${ts}-${Math.random().toString(36).slice(2, 6)}`,
    companyId: activeCompanyId,
    requestNumber: reqNum,
    actionType,
    entityLabel,
    documentNumber,
    amount: Math.round(amountBase * 100) / 100,
    currency: db.company.baseCurrency || 'YER',
    requestedByUserId: user.id,
    requestedByName: user.fullName,
    requestedAt: new Date().toISOString(),
    currentLevel: 1,
    requiredLevels: matchingRule.requiredLevels,
    status: 'pending',
    payloadJson: JSON.stringify(payload),
    history: [],
  };
}

function makeAudit(
  db: ERPDatabase,
  user: User,
  params: Omit<AuditLogEntry, 'id' | 'timestamp' | 'userId' | 'userName' | 'companyId'>
): AuditLogEntry {
  return {
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    companyId: db.activeCompanyId || db.company.id,
    timestamp: new Date().toISOString(),
    userId: user.id,
    userName: user.fullName,
    ...params,
  };
}

/**
 * 1. Save Draft Invoice
 */
export function saveDraftInvoiceTransaction(
  db: ERPDatabase,
  user: User,
  invoice: Invoice
): TransactionResult<Invoice> {
  const perm = assertPermission(user, invoice.type.includes('مشتريات') ? 'purchases' : 'sales', 'create');
  if (!perm.ok) return { ok: false, error: perm.error };
  const tenant = assertTenantAccess(user, invoice.companyId || db.activeCompanyId);
  if (!tenant.ok) return { ok: false, error: tenant.error };

  const activeCompanyId = db.activeCompanyId || db.company.id;
  const draftInv: Invoice = { ...invoice, companyId: invoice.companyId || activeCompanyId, status: 'draft' };
  const exists = db.invoices.some((i) => i.id === draftInv.id);
  const prevInv = exists ? db.invoices.find((i) => i.id === draftInv.id) : undefined;

  const nextDb: ERPDatabase = {
    ...db,
    invoices: exists
      ? db.invoices.map((i) => (i.id === draftInv.id ? draftInv : i))
      : [...db.invoices, draftInv],
    auditLogs: [
      makeAudit(db, user, {
        action: exists ? 'تعديل' : 'إنشاء',
        module: draftInv.type.includes('مشتريات') ? 'المشتريات' : 'المبيعات',
        details: `حفظ مسودة فاتورة ${draftInv.type} رقم ${draftInv.invoiceNumber}`,
        entityId: draftInv.id,
        beforeSnapshot: prevInv ? { status: prevInv.status, grandTotal: prevInv.grandTotal } : undefined,
        afterSnapshot: { status: draftInv.status, grandTotal: draftInv.grandTotal },
      }),
      ...db.auditLogs,
    ],
  };

  return { ok: true, nextDb, data: draftInv };
}

/**
 * 2. Post Sales / Sales Return Invoice (Atomic + FIFO/WA + Credit Limit + Approval + Period Lock + Idempotency)
 */
export function postSalesInvoiceTransaction(
  db: ERPDatabase,
  user: User,
  invoice: Invoice,
  opts?: TransactionOptions
): TransactionResult<Invoice> {
  const perm = assertPermission(user, 'sales', 'post');
  if (!perm.ok) return { ok: false, error: perm.error };

  const activeCompanyId = invoice.companyId || db.activeCompanyId || db.company.id;
  const tenant = assertTenantAccess(user, activeCompanyId);
  if (!tenant.ok) return { ok: false, error: tenant.error };

  const whCheck = verifyEntityCompany(
    db.warehouses.find((w) => w.id === invoice.warehouseId),
    activeCompanyId,
    'المستودع المحدد'
  );
  if (whCheck) return { ok: false, error: whCheck };
  if (invoice.treasuryAccountId) {
    const trCheck = verifyEntityCompany(
      db.treasuryAccounts.find((t) => t.id === invoice.treasuryAccountId),
      activeCompanyId,
      'حساب الخزينة'
    );
    if (trCheck) return { ok: false, error: trCheck };
  }

  const idemErr = checkIdempotency(db, opts?.idempotencyKey || invoice.idempotencyKey);
  if (idemErr) return { ok: false, error: idemErr };

  if (!invoice.items || invoice.items.length === 0 || !Number.isFinite(invoice.grandTotal) || invoice.grandTotal < 0) {
    return { ok: false, error: 'يجب أن تحتوي الفاتورة على صنف واحد على الأقل بقيمة صالحة.' };
  }

  const existing = db.invoices.find((i) => i.id === invoice.id);
  if (existing && existing.status !== 'draft') {
    return { ok: false, error: `الفاتورة رقم ${invoice.invoiceNumber} مرحلة مسبقاً.` };
  }

  const periodCheck = isDateInOpenFiscalPeriod(invoice.date, db.fiscalPeriods, activeCompanyId, db.settings);
  if (!periodCheck.allowed) {
    return { ok: false, error: periodCheck.error };
  }

  const isReturn = invoice.type === 'مرتجع_مبيعات';
  const rate = invoice.exchangeRate || getRate(db, invoice.currency);
  const normalizedPaid = Math.max(0, Math.min(invoice.grandTotal, Number(invoice.paidAmount) || 0));
  const normalizedRemaining = Math.max(0, Math.round((invoice.grandTotal - normalizedPaid) * 100) / 100);

  // Stock availability check for outbound sales
  if (!isReturn) {
    for (const line of invoice.items) {
      const totalNeeded = (line.quantity || 0) + (line.bonusQuantity || 0);
      const stockCheck = canFulfillStock(
        db.warehouseStock,
        line.itemId,
        invoice.warehouseId,
        totalNeeded,
        db.settings.allowNegativeStock
      );
      if (!stockCheck.canFulfill) {
        return { ok: false, error: `${line.itemName}: ${stockCheck.message}` };
      }
    }
  }

  // Credit Limit enforcement if active in Control Center
  const targetCustomer = db.customers.find((c) => c.id === invoice.entityId);
  const custCompanyErr = verifyEntityCompany(targetCustomer, activeCompanyId, 'العميل');
  if (custCompanyErr) return { ok: false, error: custCompanyErr };
  const remainingBase = Math.round(normalizedRemaining * rate * 100) / 100;
  if (
    !isReturn &&
    db.settings.operationalControl?.enforceCreditLimitBlock &&
    targetCustomer &&
    targetCustomer.creditLimit > 0 &&
    remainingBase > 0
  ) {
    const projectedBalance = targetCustomer.currentBalance + remainingBase;
    if (projectedBalance > targetCustomer.creditLimit) {
      return {
        ok: false,
        error: `تجاوز الحد الائتماني للعميل (${targetCustomer.nameAr}): الرصيد بعد الفاتورة (${projectedBalance.toLocaleString()}) يتجاوز الحد المسموح (${targetCustomer.creditLimit.toLocaleString()}).`,
      };
    }
  }

  const grandTotalBase = Math.round(invoice.grandTotal * rate * 100) / 100;
  const approvalReq = checkApprovalRequired(
    db,
    user,
    'invoice_post',
    grandTotalBase,
    invoice.invoiceNumber,
    `فاتورة ${invoice.type} - ${invoice.entityName}`,
    { kind: 'sales_invoice', invoice },
    opts
  );
  if (approvalReq) {
    const queuedDb: ERPDatabase = {
      ...db,
      approvalRequests: [approvalReq, ...(db.approvalRequests || [])],
      auditLogs: [
        makeAudit(db, user, {
          action: 'إنشاء',
          module: 'المبيعات',
          details: `تعليق ترحيل الفاتورة ${invoice.invoiceNumber} لحين موافقة الإدارة المالية (${approvalReq.requestNumber})`,
          entityId: invoice.id,
        }),
        ...db.auditLogs,
      ],
    };
    return { ok: false, nextDb: queuedDb, approvalRequired: approvalReq, error: `تم إرسال الفاتورة إلى صندوق الموافقات (${approvalReq.requestNumber}) لتجاوزها حد الترحيل المباشر.` };
  }

  let updatedStocks = [...db.warehouseStock];
  let updatedLayers = [...(db.stockCostLayers || [])];
  let updatedBatches = [...(db.inventoryBatches || [])];
  const newMovements = [...db.stockMovements];
  const enrichedItems = [];
  let exactInvoiceCogsBase = 0;

  for (const line of invoice.items) {
    const totalShippedQty = (line.quantity || 0) + (line.bonusQuantity || 0);
    const qtyDelta = isReturn ? totalShippedQty : -totalShippedQty;
    const itemDef = db.inventoryItems.find((it) => it.id === line.itemId);
    const wsAvgCost =
      updatedStocks.find(
        (w) => w.itemId === line.itemId && w.warehouseId === invoice.warehouseId
      )?.averageCost || 0;
    const fallbackCost = wsAvgCost > 0 ? wsAvgCost : line.unitCost || itemDef?.purchasePrice || 0;

    let effectiveLineCost = isReturn && line.unitCost > 0 ? line.unitCost : fallbackCost;
    let lineTotalCostBase = Math.round(effectiveLineCost * totalShippedQty * 100) / 100;
    const useFifo =
      db.company.valuationPolicy === 'FIFO' ||
      (db.company.valuationPolicy !== 'WEIGHTED_AVERAGE' && itemDef?.valuationMethod === 'FIFO');

    if (!isReturn && useFifo) {
      const fifoRes = consumeFifoCostLayers(
        updatedLayers,
        line.itemId,
        invoice.warehouseId,
        totalShippedQty,
        fallbackCost,
        activeCompanyId
      );
      updatedLayers = fifoRes.nextLayers;
      effectiveLineCost = fifoRes.weightedOutUnitCost;
      lineTotalCostBase = fifoRes.totalCogsBase;
    } else if (isReturn) {
      updatedLayers = addFifoCostLayer(updatedLayers, {
        companyId: activeCompanyId,
        itemId: line.itemId,
        warehouseId: invoice.warehouseId,
        quantity: totalShippedQty,
        unitCost: effectiveLineCost,
        receivedDate: invoice.date,
        sourceDocType: 'مرتجع_مبيعات',
        sourceDocId: invoice.id,
        sourceDocNumber: invoice.invoiceNumber,
        batchNumber: line.batchNumber,
        expiryDate: line.expiryDate,
      });
    }
    exactInvoiceCogsBase += lineTotalCostBase;

    updatedStocks = updateWarehouseStock(
      updatedStocks,
      line.itemId,
      invoice.warehouseId,
      qtyDelta,
      effectiveLineCost
    );

    if (line.batchNumber) {
      updatedBatches = applyBatchMovement(updatedBatches, {
        companyId: activeCompanyId,
        itemId: line.itemId,
        warehouseId: invoice.warehouseId,
        batchNumber: line.batchNumber,
        expiryDate: line.expiryDate,
        quantityDelta: qtyDelta,
        unitCost: effectiveLineCost,
        date: invoice.date,
        sourceDocId: invoice.id,
        storageLocationId: line.storageLocationId,
      });
    }

    const runningBal =
      updatedStocks.find((s) => s.itemId === line.itemId && s.warehouseId === invoice.warehouseId)
        ?.quantityOnHand || 0;

    newMovements.push({
      id: `sm-${Date.now()}-${line.itemId}-${Math.random().toString(36).slice(2, 6)}`,
      companyId: activeCompanyId,
      itemId: line.itemId,
      warehouseId: invoice.warehouseId,
      documentType: isReturn ? 'مرتجع_مبيعات' : 'فاتورة_مبيعات',
      documentNumber: invoice.invoiceNumber,
      documentId: invoice.id,
      movementDate: invoice.date,
      quantityChange: qtyDelta,
      unitCost: effectiveLineCost,
      totalCost: lineTotalCostBase,
      runningBalance: runningBal,
      batchNumber: line.batchNumber,
      expiryDate: line.expiryDate,
      notes: line.bonusQuantity ? `بونص مجاني: ${line.bonusQuantity}` : line.notes,
      performedBy: user.fullName,
    });

    enrichedItems.push({ ...line, unitCost: effectiveLineCost });
  }

  const normalizedInvoice: Invoice = {
    ...invoice,
    companyId: activeCompanyId,
    items: enrichedItems,
    exchangeRate: rate,
    paidAmount: normalizedPaid,
    remainingAmount: normalizedRemaining,
    idempotencyKey: opts?.idempotencyKey || invoice.idempotencyKey,
  };

  const companyAccounts = getCompanyAccounts(db, activeCompanyId);
  const journalEntry = createSalesInvoiceJournalEntry(
    normalizedInvoice,
    companyAccounts,
    user.fullName,
    db.journalEntries.map((j) => j.entryNumber),
    updatedStocks,
    Math.round(exactInvoiceCogsBase * 100) / 100
  );
  journalEntry.companyId = activeCompanyId;
  journalEntry.fiscalPeriodId = periodCheck.fiscalPeriodId;

  const paidBase = normalizedPaid * rate;
  const balanceDelta = isReturn ? -remainingBase : remainingBase;
  const prevCustomerBalance =
    normalizedInvoice.previousBalanceSnapshot !== undefined
      ? normalizedInvoice.previousBalanceSnapshot
      : targetCustomer?.currentBalance ?? 0;
  const newCustomerBalance = Math.round((prevCustomerBalance + balanceDelta) * 100) / 100;

  const updatedCustomers = db.customers.map((c) =>
    c.id === normalizedInvoice.entityId
      ? { ...c, currentBalance: Math.round((c.currentBalance + balanceDelta) * 100) / 100 }
      : c
  );

  let updatedTreasuries = [...db.treasuryAccounts];
  if (normalizedPaid > 0 && normalizedInvoice.treasuryAccountId) {
    updatedTreasuries = updatedTreasuries.map((t) => {
      if (t.id === normalizedInvoice.treasuryAccountId) {
        const tRate = getRate(db, t.currency);
        const amtInTreasury = t.currency === normalizedInvoice.currency ? normalizedPaid : paidBase / tRate;
        return { ...t, balance: isReturn ? t.balance - amtInTreasury : t.balance + amtInTreasury };
      }
      return t;
    });
  }

  const enrichedInvoice: Invoice = {
    ...normalizedInvoice,
    status:
      normalizedInvoice.status === 'draft'
        ? normalizedRemaining === 0
          ? 'paid'
          : normalizedPaid > 0
          ? 'partial'
          : 'posted'
        : normalizedInvoice.status,
    previousBalanceSnapshot: prevCustomerBalance,
    newBalanceSnapshot: newCustomerBalance,
    journalEntryId: journalEntry.id,
    approvalStatus: 'approved',
  };

  // Mark source commercial order converted if linked
  const updatedOrders = normalizedInvoice.sourceOrderId
    ? (db.commercialOrders || []).map((ord) =>
        ord.id === normalizedInvoice.sourceOrderId
          ? {
              ...ord,
              status: 'converted' as const,
              convertedInvoiceId: enrichedInvoice.id,
              convertedInvoiceNumber: enrichedInvoice.invoiceNumber,
            }
          : ord
      )
    : db.commercialOrders;

  const nextDb: ERPDatabase = {
    ...db,
    invoices: existing
      ? db.invoices.map((i) => (i.id === existing.id ? enrichedInvoice : i))
      : [...db.invoices, enrichedInvoice],
    commercialOrders: updatedOrders,
    warehouseStock: updatedStocks,
    stockCostLayers: updatedLayers,
    inventoryBatches: updatedBatches,
    stockMovements: newMovements,
    journalEntries: [...db.journalEntries, journalEntry],
    customers: updatedCustomers,
    treasuryAccounts: updatedTreasuries,
    processedIdempotencyKeys: appendIdempotencyKey(db, opts?.idempotencyKey || invoice.idempotencyKey),
    auditLogs: [
      makeAudit(db, user, {
        action: 'ترحيل',
        module: 'المبيعات',
        details: `ترحيل ${normalizedInvoice.type} رقم ${normalizedInvoice.invoiceNumber} بقيمة (${normalizedInvoice.grandTotal.toLocaleString()} ${normalizedInvoice.currency})`,
        entityId: normalizedInvoice.id,
        beforeSnapshot: targetCustomer ? { customerBalance: prevCustomerBalance } : undefined,
        afterSnapshot: { customerBalance: newCustomerBalance, journalEntryId: journalEntry.id },
      }),
      ...db.auditLogs,
    ],
  };

  return { ok: true, nextDb, data: enrichedInvoice };
}

/**
 * 3. Post Purchase / Purchase Return Invoice (Atomic + FIFO Layer creation + Approval + Period Lock)
 */
export function postPurchaseInvoiceTransaction(
  db: ERPDatabase,
  user: User,
  invoice: Invoice,
  opts?: TransactionOptions
): TransactionResult<Invoice> {
  const perm = assertPermission(user, 'purchases', 'post');
  if (!perm.ok) return { ok: false, error: perm.error };

  const activeCompanyId = invoice.companyId || db.activeCompanyId || db.company.id;
  const tenant = assertTenantAccess(user, activeCompanyId);
  if (!tenant.ok) return { ok: false, error: tenant.error };

  const whCheck = verifyEntityCompany(
    db.warehouses.find((w) => w.id === invoice.warehouseId),
    activeCompanyId,
    'المستودع المحدد'
  );
  if (whCheck) return { ok: false, error: whCheck };
  if (invoice.treasuryAccountId) {
    const trCheck = verifyEntityCompany(
      db.treasuryAccounts.find((t) => t.id === invoice.treasuryAccountId),
      activeCompanyId,
      'حساب الخزينة'
    );
    if (trCheck) return { ok: false, error: trCheck };
  }
  const vendorCheck = verifyEntityCompany(
    db.vendors.find((v) => v.id === invoice.entityId),
    activeCompanyId,
    'المورد'
  );
  if (vendorCheck) return { ok: false, error: vendorCheck };

  const idemErr = checkIdempotency(db, opts?.idempotencyKey || invoice.idempotencyKey);
  if (idemErr) return { ok: false, error: idemErr };

  if (!invoice.items || invoice.items.length === 0 || !Number.isFinite(invoice.grandTotal) || invoice.grandTotal < 0) {
    return { ok: false, error: 'يجب أن تحتوي فاتورة المشتريات على صنف واحد على الأقل بقيمة صالحة.' };
  }

  const existing = db.invoices.find((i) => i.id === invoice.id);
  if (existing && existing.status !== 'draft') {
    return { ok: false, error: `الفاتورة رقم ${invoice.invoiceNumber} مرحلة مسبقاً.` };
  }

  const periodCheck = isDateInOpenFiscalPeriod(invoice.date, db.fiscalPeriods, activeCompanyId, db.settings);
  if (!periodCheck.allowed) return { ok: false, error: periodCheck.error };

  const isReturn = invoice.type === 'مرتجع_مشتريات';
  const rate = invoice.exchangeRate || getRate(db, invoice.currency);
  const normalizedPaid = Math.max(0, Math.min(invoice.grandTotal, Number(invoice.paidAmount) || 0));
  const normalizedRemaining = Math.max(0, Math.round((invoice.grandTotal - normalizedPaid) * 100) / 100);

  const grandTotalBase = Math.round(invoice.grandTotal * rate * 100) / 100;
  const approvalReq = checkApprovalRequired(
    db,
    user,
    'invoice_post',
    grandTotalBase,
    invoice.invoiceNumber,
    `فاتورة ${invoice.type} - ${invoice.entityName}`,
    { kind: 'purchase_invoice', invoice },
    opts
  );
  if (approvalReq) {
    const queuedDb: ERPDatabase = {
      ...db,
      approvalRequests: [approvalReq, ...(db.approvalRequests || [])],
    };
    return { ok: false, nextDb: queuedDb, approvalRequired: approvalReq, error: `تم إرسال فاتورة المشتريات إلى صندوق الموافقات (${approvalReq.requestNumber}).` };
  }

  if (isReturn) {
    for (const line of invoice.items) {
      const totalReturnQty = (line.quantity || 0) + (line.bonusQuantity || 0);
      const stockCheck = canFulfillStock(
        db.warehouseStock,
        line.itemId,
        invoice.warehouseId,
        totalReturnQty,
        db.settings.allowNegativeStock
      );
      if (!stockCheck.canFulfill) {
        return { ok: false, error: `${line.itemName}: ${stockCheck.message}` };
      }
    }
  }

  let updatedStocks = [...db.warehouseStock];
  let updatedLayers = [...(db.stockCostLayers || [])];
  let updatedBatches = [...(db.inventoryBatches || [])];
  const newMovements = [...db.stockMovements];
  let exactReturnInvCostBase = 0;

  for (const line of invoice.items) {
    const totalReceivedQty = (line.quantity || 0) + (line.bonusQuantity || 0);
    const effectiveUnitCostBase =
      totalReceivedQty > 0
        ? Math.round((((line.unitCost * line.quantity) / totalReceivedQty) * rate) * 100) / 100
        : line.unitCost * rate;
    const qtyDelta = isReturn ? -totalReceivedQty : totalReceivedQty;
    let lineCostBaseTotal = Math.round(line.unitCost * line.quantity * rate * 100) / 100;

    if (!isReturn) {
      updatedStocks = updateWarehouseStock(
        updatedStocks,
        line.itemId,
        invoice.warehouseId,
        qtyDelta,
        effectiveUnitCostBase
      );
      updatedLayers = addFifoCostLayer(updatedLayers, {
        companyId: activeCompanyId,
        itemId: line.itemId,
        warehouseId: invoice.warehouseId,
        quantity: totalReceivedQty,
        unitCost: effectiveUnitCostBase,
        receivedDate: invoice.date,
        sourceDocType: 'فاتورة_مشتريات',
        sourceDocId: invoice.id,
        sourceDocNumber: invoice.invoiceNumber,
        batchNumber: line.batchNumber,
        expiryDate: line.expiryDate,
      });
    } else {
      const itemDef = db.inventoryItems.find((it) => it.id === line.itemId);
      const useFifo =
        db.company.valuationPolicy === 'FIFO' ||
        (db.company.valuationPolicy !== 'WEIGHTED_AVERAGE' && itemDef?.valuationMethod === 'FIFO');
      let effectiveOutUnitCost = effectiveUnitCostBase;
      if (useFifo) {
        const fifoRes = consumeFifoCostLayers(
          updatedLayers,
          line.itemId,
          invoice.warehouseId,
          totalReceivedQty,
          effectiveUnitCostBase,
          activeCompanyId
        );
        updatedLayers = fifoRes.nextLayers;
        effectiveOutUnitCost = fifoRes.weightedOutUnitCost;
        lineCostBaseTotal = fifoRes.totalCogsBase;
      }
      exactReturnInvCostBase += lineCostBaseTotal;
      updatedStocks = updateWarehouseStock(
        updatedStocks,
        line.itemId,
        invoice.warehouseId,
        qtyDelta,
        effectiveOutUnitCost
      );
    }

    if (line.batchNumber) {
      updatedBatches = applyBatchMovement(updatedBatches, {
        companyId: activeCompanyId,
        itemId: line.itemId,
        warehouseId: invoice.warehouseId,
        batchNumber: line.batchNumber,
        expiryDate: line.expiryDate,
        quantityDelta: qtyDelta,
        unitCost: effectiveUnitCostBase,
        date: invoice.date,
        sourceDocId: invoice.id,
        storageLocationId: line.storageLocationId,
      });
    }

    const runningBal =
      updatedStocks.find((s) => s.itemId === line.itemId && s.warehouseId === invoice.warehouseId)
        ?.quantityOnHand || 0;

    newMovements.push({
      id: `sm-pur-${Date.now()}-${line.itemId}-${Math.random().toString(36).slice(2, 6)}`,
      companyId: activeCompanyId,
      itemId: line.itemId,
      warehouseId: invoice.warehouseId,
      documentType: isReturn ? 'مرتجع_مشتريات' : 'فاتورة_مشتريات',
      documentNumber: invoice.invoiceNumber,
      documentId: invoice.id,
      movementDate: invoice.date,
      quantityChange: qtyDelta,
      unitCost: effectiveUnitCostBase,
      totalCost: lineCostBaseTotal,
      runningBalance: runningBal,
      batchNumber: line.batchNumber,
      expiryDate: line.expiryDate,
      notes: line.bonusQuantity ? `بونص توريد مجاني: ${line.bonusQuantity}` : line.notes,
      performedBy: user.fullName,
    });
  }

  const normalizedInvoice: Invoice = {
    ...invoice,
    companyId: activeCompanyId,
    exchangeRate: rate,
    paidAmount: normalizedPaid,
    remainingAmount: normalizedRemaining,
    idempotencyKey: opts?.idempotencyKey || invoice.idempotencyKey,
  };

  const companyAccounts = getCompanyAccounts(db, activeCompanyId);
  const journalEntry = createPurchaseInvoiceJournalEntry(
    normalizedInvoice,
    companyAccounts,
    user.fullName,
    db.journalEntries.map((j) => j.entryNumber),
    isReturn ? Math.round(exactReturnInvCostBase * 100) / 100 : undefined
  );
  journalEntry.companyId = activeCompanyId;
  journalEntry.fiscalPeriodId = periodCheck.fiscalPeriodId;

  const remainingBase = Math.round(normalizedRemaining * rate * 100) / 100;
  const paidBase = normalizedPaid * rate;
  const balanceDelta = isReturn ? -remainingBase : remainingBase;

  const targetVendor = db.vendors.find((v) => v.id === normalizedInvoice.entityId);
  const prevVendorBalance =
    normalizedInvoice.previousBalanceSnapshot !== undefined
      ? normalizedInvoice.previousBalanceSnapshot
      : targetVendor?.currentBalance ?? 0;
  const newVendorBalance = Math.round((prevVendorBalance + balanceDelta) * 100) / 100;

  const updatedVendors = db.vendors.map((v) =>
    v.id === normalizedInvoice.entityId
      ? { ...v, currentBalance: Math.round((v.currentBalance + balanceDelta) * 100) / 100 }
      : v
  );

  let updatedTreasuries = [...db.treasuryAccounts];
  if (normalizedPaid > 0 && normalizedInvoice.treasuryAccountId) {
    updatedTreasuries = updatedTreasuries.map((t) => {
      if (t.id === normalizedInvoice.treasuryAccountId) {
        const tRate = getRate(db, t.currency);
        const amtInTreasury = t.currency === normalizedInvoice.currency ? normalizedPaid : paidBase / tRate;
        return { ...t, balance: isReturn ? t.balance + amtInTreasury : t.balance - amtInTreasury };
      }
      return t;
    });
  }

  const enrichedInvoice: Invoice = {
    ...normalizedInvoice,
    status:
      normalizedInvoice.status === 'draft'
        ? normalizedRemaining === 0
          ? 'paid'
          : normalizedPaid > 0
          ? 'partial'
          : 'posted'
        : normalizedInvoice.status,
    previousBalanceSnapshot: prevVendorBalance,
    newBalanceSnapshot: newVendorBalance,
    journalEntryId: journalEntry.id,
    approvalStatus: 'approved',
  };

  const nextDb: ERPDatabase = {
    ...db,
    invoices: existing
      ? db.invoices.map((i) => (i.id === existing.id ? enrichedInvoice : i))
      : [...db.invoices, enrichedInvoice],
    warehouseStock: updatedStocks,
    stockCostLayers: updatedLayers,
    inventoryBatches: updatedBatches,
    stockMovements: newMovements,
    journalEntries: [...db.journalEntries, journalEntry],
    vendors: updatedVendors,
    treasuryAccounts: updatedTreasuries,
    processedIdempotencyKeys: appendIdempotencyKey(db, opts?.idempotencyKey || invoice.idempotencyKey),
    auditLogs: [
      makeAudit(db, user, {
        action: 'ترحيل',
        module: 'المشتريات',
        details: `ترحيل ${normalizedInvoice.type} رقم ${normalizedInvoice.invoiceNumber} بقيمة (${normalizedInvoice.grandTotal.toLocaleString()} ${normalizedInvoice.currency})`,
        entityId: normalizedInvoice.id,
        beforeSnapshot: targetVendor ? { vendorBalance: prevVendorBalance } : undefined,
        afterSnapshot: { vendorBalance: newVendorBalance, journalEntryId: journalEntry.id },
      }),
      ...db.auditLogs,
    ],
  };

  return { ok: true, nextDb, data: enrichedInvoice };
}

/**
 * 4. Cancel Invoice (Full Reversal of Stock, FIFO Layers, Balances & GL)
 */
export function cancelInvoiceTransaction(
  db: ERPDatabase,
  user: User,
  invoiceId: string,
  reason?: string
): TransactionResult {
  const inv = db.invoices.find((i) => i.id === invoiceId);
  if (!inv || inv.status === 'cancelled') {
    return { ok: false, error: 'الفاتورة ملغاة مسبقاً أو غير موجودة.' };
  }
  const modKey = inv.type.includes('مشتريات') ? 'purchases' : 'sales';
  const perm = assertPermission(user, modKey, 'delete');
  if (!perm.ok) {
    return { ok: false, error: perm.error || 'صلاحياتك لا تسمح بإلغاء الفواتير.' };
  }

  const activeCompanyId = inv.companyId || db.activeCompanyId || db.company.id;
  const tenant = assertTenantAccess(user, activeCompanyId);
  if (!tenant.ok) return { ok: false, error: tenant.error };
  const periodCheck = isDateInOpenFiscalPeriod(inv.date, db.fiscalPeriods, activeCompanyId, db.settings);
  if (!periodCheck.allowed) return { ok: false, error: periodCheck.error };

  const wasDraft = inv.status === 'draft';
  let updatedStocks = [...db.warehouseStock];
  let updatedLayers = [...(db.stockCostLayers || [])];
  const newMovements = [...db.stockMovements];
  let updatedCustomers = [...db.customers];
  let updatedVendors = [...db.vendors];
  let updatedTreasuries = [...db.treasuryAccounts];
  let updatedJEs = [...db.journalEntries];

  if (!wasDraft) {
    const rate = inv.exchangeRate || getRate(db, inv.currency);
    const isSalesSide = inv.type === 'مبيعات' || inv.type === 'مرتجع_مبيعات';
    const wasStockDeducted = inv.type === 'مبيعات' || inv.type === 'مرتجع_مشتريات';

    // FIFO & Negative-Stock safety check when cancelling inbound stock documents (Purchases / Sales Returns)
    if (!wasStockDeducted) {
      const createdLayers = updatedLayers.filter(
        (l) => l.sourceDocId === inv.id && (!l.companyId || l.companyId === activeCompanyId)
      );
      const consumedLayer = createdLayers.find((l) => l.remainingQuantity < l.originalQuantity - 0.0001);
      if (consumedLayer) {
        return {
          ok: false,
          error: `لا يمكن إلغاء الفاتورة (${inv.invoiceNumber}) لأن جزءاً من كميتها قد تم بيعه أو استهلاكه من طبقات FIFO. يرجى إنشاء مستند مرتجع مشتريات بدلاً من الإلغاء المباشر.`,
        };
      }
      if (!db.settings.allowNegativeStock) {
        for (const line of inv.items) {
          const qty = line.quantity + (line.bonusQuantity || 0);
          const currentQty =
            updatedStocks.find((s) => s.itemId === line.itemId && s.warehouseId === inv.warehouseId)
              ?.quantityOnHand || 0;
          if (currentQty < qty) {
            return {
              ok: false,
              error: `لا يمكن إلغاء الفاتورة (${inv.invoiceNumber}) لأن الرصيد الحالي للصنف (${line.itemName}) لا يكفي لسحب الكمية (${qty}). يرجى إصدار مرتجع مشتريات.`,
            };
          }
        }
      }
      if (createdLayers.length > 0) {
        updatedLayers = updatedLayers.filter(
          (l) => !(l.sourceDocId === inv.id && (!l.companyId || l.companyId === activeCompanyId))
        );
      }
    }

    for (const line of inv.items) {
      const qty = line.quantity + (line.bonusQuantity || 0);
      const reverseDelta = wasStockDeducted ? qty : -qty;
      updatedStocks = updateWarehouseStock(updatedStocks, line.itemId, inv.warehouseId, reverseDelta, line.unitCost);
      if (reverseDelta > 0) {
        updatedLayers = addFifoCostLayer(updatedLayers, {
          companyId: activeCompanyId,
          itemId: line.itemId,
          warehouseId: inv.warehouseId,
          quantity: reverseDelta,
          unitCost: line.unitCost,
          receivedDate: new Date().toISOString().split('T')[0],
          sourceDocType: 'عكس_فاتورة',
          sourceDocId: inv.id,
          sourceDocNumber: `${inv.invoiceNumber}-CANCEL`,
        });
      }
      newMovements.push({
        id: `sm-can-${Date.now()}-${line.itemId}-${Math.random().toString(36).slice(2, 6)}`,
        companyId: activeCompanyId,
        itemId: line.itemId,
        warehouseId: inv.warehouseId,
        documentType: wasStockDeducted ? 'مرتجع_مبيعات' : 'مرتجع_مشتريات',
        documentNumber: `${inv.invoiceNumber}-CANCEL`,
        documentId: inv.id,
        movementDate: new Date().toISOString().split('T')[0],
        quantityChange: reverseDelta,
        unitCost: line.unitCost,
        totalCost: line.unitCost * qty,
        runningBalance:
          updatedStocks.find((s) => s.itemId === line.itemId && s.warehouseId === inv.warehouseId)
            ?.quantityOnHand || 0,
        notes: `عكس مخزون نتيجة إلغاء فاتورة ${inv.invoiceNumber}`,
        performedBy: user.fullName,
      });
    }

    const remainingBase = (inv.remainingAmount || 0) * rate;
    const paidBase = (inv.paidAmount || 0) * rate;

    if (isSalesSide) {
      const sign = inv.type === 'مبيعات' ? -1 : 1;
      updatedCustomers = updatedCustomers.map((c) =>
        c.id === inv.entityId ? { ...c, currentBalance: Math.round((c.currentBalance + sign * remainingBase) * 100) / 100 } : c
      );
    } else {
      const sign = inv.type === 'مشتريات' ? -1 : 1;
      updatedVendors = updatedVendors.map((v) =>
        v.id === inv.entityId ? { ...v, currentBalance: Math.round((v.currentBalance + sign * remainingBase) * 100) / 100 } : v
      );
    }

    if (inv.paidAmount > 0 && inv.treasuryAccountId) {
      const treasurySign = inv.type === 'مبيعات' || inv.type === 'مرتجع_مشتريات' ? -1 : 1;
      updatedTreasuries = updatedTreasuries.map((t) => {
        if (t.id === inv.treasuryAccountId) {
          const tRate = getRate(db, t.currency);
          const amtInTreasury = t.currency === inv.currency ? inv.paidAmount : paidBase / tRate;
          return { ...t, balance: t.balance + treasurySign * amtInTreasury };
        }
        return t;
      });
    }

    if (inv.journalEntryId) {
      const origJe = updatedJEs.find((j) => j.id === inv.journalEntryId && j.status === 'posted');
      if (origJe) {
        const revJe = createReversalJournalEntry(
          origJe,
          sanitizeInputText(reason || `إلغاء فاتورة ${inv.invoiceNumber}`),
          user.fullName,
          updatedJEs.map((j) => j.entryNumber)
        );
        revJe.companyId = activeCompanyId;
        updatedJEs = updatedJEs.map((j) => (j.id === origJe.id ? { ...j, status: 'reversed' as const } : j));
        updatedJEs.push(revJe);
      }
    }
  }

  const nextDb: ERPDatabase = {
    ...db,
    invoices: db.invoices.map((i) => (i.id === inv.id ? { ...i, status: 'cancelled' as const } : i)),
    warehouseStock: updatedStocks,
    stockCostLayers: updatedLayers,
    stockMovements: newMovements,
    customers: updatedCustomers,
    vendors: updatedVendors,
    treasuryAccounts: updatedTreasuries,
    journalEntries: updatedJEs,
    auditLogs: [
      makeAudit(db, user, {
        action: 'إلغاء',
        module: inv.type.includes('مشتريات') ? 'المشتريات' : 'المبيعات',
        details: `إلغاء ${wasDraft ? 'مسودة' : 'فاتورة'} رقم ${inv.invoiceNumber}${wasDraft ? '' : ' وعكس القيد والمخزون والأرصدة'}`,
        entityId: inv.id,
        reason: reason ? sanitizeInputText(reason) : undefined,
        beforeSnapshot: { status: inv.status },
        afterSnapshot: { status: 'cancelled' },
      }),
      ...db.auditLogs,
    ],
  };

  return { ok: true, nextDb };
}

/**
 * 5. Post Batch Vouchers (with Period Lock, Approval Workflow, Linked Invoice Allocation Settlement)
 */
export function postVouchersBatchTransaction(
  db: ERPDatabase,
  user: User,
  vouchers: PaymentVoucher[],
  opts?: TransactionOptions
): TransactionResult<PaymentVoucher[]> {
  const perm = assertPermission(user, 'vouchers', 'post');
  if (!perm.ok) return { ok: false, error: perm.error };

  const activeCompanyId = vouchers[0]?.companyId || db.activeCompanyId || db.company.id;
  const tenant = assertTenantAccess(user, activeCompanyId);
  if (!tenant.ok) return { ok: false, error: tenant.error };
  if (vouchers.length === 0) return { ok: false, error: 'لا توجد سندات صالحة للترحيل.' };
  const idemErr = checkIdempotency(db, opts?.idempotencyKey || vouchers[0]?.idempotencyKey);
  if (idemErr) return { ok: false, error: idemErr };

  let totalBaseBatch = 0;
  for (const v of vouchers) {
    if (v.companyId && v.companyId !== activeCompanyId) {
      return { ok: false, error: `عزل المنشآت: السند (${v.voucherNumber}) لا ينتمي إلى المنشأة النشطة.` };
    }
    const trErr = verifyEntityCompany(
      db.treasuryAccounts.find((t) => t.id === v.treasuryAccountId),
      activeCompanyId,
      'حساب الخزينة'
    );
    if (trErr) return { ok: false, error: trErr };
    if (v.entityType === 'عميل' && v.entityId) {
      const custErr = verifyEntityCompany(
        db.customers.find((c) => c.id === v.entityId),
        activeCompanyId,
        'العميل'
      );
      if (custErr) return { ok: false, error: custErr };
    }
    if (v.entityType === 'مورد' && v.entityId) {
      const vendErr = verifyEntityCompany(
        db.vendors.find((vn) => vn.id === v.entityId),
        activeCompanyId,
        'المورد'
      );
      if (vendErr) return { ok: false, error: vendErr };
    }
    const pCheck = isDateInOpenFiscalPeriod(v.date, db.fiscalPeriods, activeCompanyId, db.settings);
    if (!pCheck.allowed) return { ok: false, error: pCheck.error };
    totalBaseBatch += v.baseAmount || v.amount * getRate(db, v.currency);
  }

  const approvalReq = checkApprovalRequired(
    db,
    user,
    'voucher_post',
    totalBaseBatch,
    vouchers.map((v) => v.voucherNumber).join(', '),
    `سندات مالية (${vouchers.length})`,
    { kind: 'vouchers_batch', vouchers },
    opts
  );
  if (approvalReq) {
    const queuedDb: ERPDatabase = {
      ...db,
      approvalRequests: [approvalReq, ...(db.approvalRequests || [])],
    };
    return {
      ok: false,
      nextDb: queuedDb,
      approvalRequired: approvalReq,
      error: `تم إرسال السندات إلى صندوق الموافقات (${approvalReq.requestNumber}) لتجاوزها سقف الاعتماد المباشر.`,
    };
  }

  let updatedTreasuries = [...db.treasuryAccounts];
  let updatedCustomers = [...db.customers];
  let updatedVendors = [...db.vendors];
  let updatedInvoices = [...db.invoices];
  const newJournalEntries: JournalEntry[] = [];
  const newVouchers: PaymentVoucher[] = [];
  const newAuditLogs: AuditLogEntry[] = [];
  const runningJeNums = db.journalEntries.map((j) => j.entryNumber);

  for (const voucher of vouchers) {
    const rate = voucher.exchangeRate || getRate(db, voucher.currency);
    const baseAmt = voucher.baseAmount || Math.round(voucher.amount * rate * 100) / 100;
    const norm: PaymentVoucher = {
      ...voucher,
      companyId: voucher.companyId || activeCompanyId,
      exchangeRate: rate,
      baseAmount: baseAmt,
      idempotencyKey: opts?.idempotencyKey || voucher.idempotencyKey,
      approvalStatus: 'approved',
    };

    const companyAccounts = getCompanyAccounts(db, activeCompanyId);
    const journalEntry = createVoucherJournalEntry(norm, companyAccounts, user.fullName, runningJeNums);
    journalEntry.companyId = activeCompanyId;
    runningJeNums.push(journalEntry.entryNumber);
    newJournalEntries.push(journalEntry);

    updatedTreasuries = updatedTreasuries.map((t) => {
      if (t.id === voucher.treasuryAccountId) {
        const tRate = getRate(db, t.currency);
        const amtInTreasury = t.currency === voucher.currency ? voucher.amount : baseAmt / tRate;
        return {
          ...t,
          balance: voucher.type === 'قبض' ? t.balance + amtInTreasury : t.balance - amtInTreasury,
        };
      }
      return t;
    });

    if (voucher.entityType === 'عميل' && voucher.entityId) {
      updatedCustomers = updatedCustomers.map((c) =>
        c.id === voucher.entityId
          ? { ...c, currentBalance: voucher.type === 'قبض' ? c.currentBalance - baseAmt : c.currentBalance + baseAmt }
          : c
      );
    }

    if (voucher.entityType === 'مورد' && voucher.entityId) {
      updatedVendors = updatedVendors.map((v) =>
        v.id === voucher.entityId
          ? { ...v, currentBalance: voucher.type === 'صرف' ? v.currentBalance - baseAmt : v.currentBalance + baseAmt }
          : v
      );
    }

    // Settle linked invoice(s) if specified and persist exact allocations for rollback safety
    const linkIds = voucher.linkedInvoiceIds?.length
      ? voucher.linkedInvoiceIds
      : voucher.linkedInvoiceId
      ? [voucher.linkedInvoiceId]
      : [];
    const persistedAllocations: NonNullable<PaymentVoucher['linkedAllocations']> = [];
    if (linkIds.length > 0) {
      let remainingVoucherBase = baseAmt;
      updatedInvoices = updatedInvoices.map((inv) => {
        if (
          !linkIds.includes(inv.id) ||
          (inv.companyId && inv.companyId !== activeCompanyId) ||
          inv.status === 'cancelled' ||
          remainingVoucherBase <= 0 ||
          inv.remainingAmount <= 0
        ) {
          return inv;
        }
        const invRate = inv.exchangeRate || getRate(db, inv.currency);
        const invRemBase = inv.remainingAmount * invRate;
        const settleBase = Math.min(invRemBase, remainingVoucherBase);
        const settleNative = Math.round((settleBase / invRate) * 100) / 100;
        remainingVoucherBase = Math.max(0, Math.round((remainingVoucherBase - settleBase) * 100) / 100);
        const newPaid = Math.round((inv.paidAmount + settleNative) * 100) / 100;
        const newRem = Math.max(0, Math.round((inv.grandTotal - newPaid) * 100) / 100);
        persistedAllocations.push({
          invoiceId: inv.id,
          invoiceNumber: inv.invoiceNumber,
          settledAmountNative: settleNative,
          settledAmountBase: Math.round(settleBase * 100) / 100,
        });
        return {
          ...inv,
          paidAmount: newPaid,
          remainingAmount: newRem,
          status: newRem <= 0.01 ? 'paid' : 'partial',
        };
      });
    }

    newVouchers.push({
      ...norm,
      journalEntryId: journalEntry.id,
      linkedAllocations: persistedAllocations.length > 0 ? persistedAllocations : norm.linkedAllocations,
    });

    newAuditLogs.push(
      makeAudit(db, user, {
        action: 'ترحيل',
        module: 'الخزينة',
        details: `ترحيل ${voucher.type === 'قبض' ? 'سند قبض' : 'سند صرف'} رقم ${voucher.voucherNumber} بمبلغ (${voucher.amount.toLocaleString()} ${voucher.currency})`,
        entityId: voucher.id,
        afterSnapshot: { amount: voucher.amount, currency: voucher.currency, journalEntryId: journalEntry.id },
      })
    );
  }

  const nextDb: ERPDatabase = {
    ...db,
    paymentVouchers: [...db.paymentVouchers, ...newVouchers],
    journalEntries: [...db.journalEntries, ...newJournalEntries],
    treasuryAccounts: updatedTreasuries,
    customers: updatedCustomers,
    vendors: updatedVendors,
    invoices: updatedInvoices,
    processedIdempotencyKeys: appendIdempotencyKey(db, opts?.idempotencyKey || vouchers[0]?.idempotencyKey),
    auditLogs: [...newAuditLogs, ...db.auditLogs],
  };

  return { ok: true, nextDb, data: newVouchers };
}

/**
 * 6. Cancel Voucher (Reverses Treasury, Party Balance, Linked Invoice Allocations & GL)
 */
export function cancelVoucherTransaction(
  db: ERPDatabase,
  user: User,
  voucherId: string,
  reason?: string
): TransactionResult {
  const perm = assertPermission(user, 'vouchers', 'delete');
  if (!perm.ok) {
    return { ok: false, error: perm.error || 'صلاحياتك لا تسمح بإلغاء السندات المالية.' };
  }
  const v = db.paymentVouchers.find((x) => x.id === voucherId);
  if (!v || v.status === 'cancelled') {
    return { ok: false, error: 'السند ملغى مسبقاً أو غير موجود.' };
  }
  const activeCompanyId = v.companyId || db.activeCompanyId || db.company.id;
  const tenant = assertTenantAccess(user, activeCompanyId);
  if (!tenant.ok) return { ok: false, error: tenant.error };
  const pCheck = isDateInOpenFiscalPeriod(v.date, db.fiscalPeriods, activeCompanyId, db.settings);
  if (!pCheck.allowed) return { ok: false, error: pCheck.error };

  const rate = v.exchangeRate || getRate(db, v.currency);
  const baseAmt = v.baseAmount || v.amount * rate;

  const updatedTreasuries = db.treasuryAccounts.map((t) => {
    if (t.id === v.treasuryAccountId) {
      const tRate = getRate(db, t.currency);
      const amtInTreasury = t.currency === v.currency ? v.amount : baseAmt / tRate;
      return { ...t, balance: v.type === 'قبض' ? t.balance - amtInTreasury : t.balance + amtInTreasury };
    }
    return t;
  });

  const updatedCustomers =
    v.entityType === 'عميل' && v.entityId
      ? db.customers.map((c) =>
          c.id === v.entityId
            ? { ...c, currentBalance: v.type === 'قبض' ? c.currentBalance + baseAmt : c.currentBalance - baseAmt }
            : c
        )
      : db.customers;

  const updatedVendors =
    v.entityType === 'مورد' && v.entityId
      ? db.vendors.map((vnd) =>
          vnd.id === v.entityId
            ? { ...vnd, currentBalance: v.type === 'صرف' ? vnd.currentBalance + baseAmt : vnd.currentBalance - baseAmt }
            : vnd
        )
      : db.vendors;

  // Rollback linked invoice allocations cleanly
  let updatedInvoices = [...db.invoices];
  if (v.linkedAllocations && v.linkedAllocations.length > 0) {
    const allocMap = new Map(v.linkedAllocations.map((a) => [a.invoiceId, a]));
    updatedInvoices = updatedInvoices.map((inv) => {
      const alloc = allocMap.get(inv.id);
      if (!alloc || inv.status === 'cancelled') return inv;
      const newPaid = Math.max(0, Math.round((inv.paidAmount - alloc.settledAmountNative) * 100) / 100);
      const newRem = Math.min(inv.grandTotal, Math.max(0, Math.round((inv.grandTotal - newPaid) * 100) / 100));
      return {
        ...inv,
        paidAmount: newPaid,
        remainingAmount: newRem,
        status: newRem <= 0.01 ? 'paid' : newPaid > 0 ? 'partial' : 'posted',
      };
    });
  } else {
    const fallbackLinkIds = v.linkedInvoiceIds?.length
      ? v.linkedInvoiceIds
      : v.linkedInvoiceId
      ? [v.linkedInvoiceId]
      : [];
    if (fallbackLinkIds.length > 0) {
      let remRollbackBase = baseAmt;
      updatedInvoices = updatedInvoices.map((inv) => {
        if (!fallbackLinkIds.includes(inv.id) || inv.status === 'cancelled' || remRollbackBase <= 0 || inv.paidAmount <= 0) {
          return inv;
        }
        const invRate = inv.exchangeRate || getRate(db, inv.currency);
        const invPaidBase = inv.paidAmount * invRate;
        const revBase = Math.min(invPaidBase, remRollbackBase);
        const revNative = Math.round((revBase / invRate) * 100) / 100;
        remRollbackBase = Math.max(0, remRollbackBase - revBase);
        const newPaid = Math.max(0, Math.round((inv.paidAmount - revNative) * 100) / 100);
        const newRem = Math.min(inv.grandTotal, Math.max(0, Math.round((inv.grandTotal - newPaid) * 100) / 100));
        return {
          ...inv,
          paidAmount: newPaid,
          remainingAmount: newRem,
          status: newRem <= 0.01 ? 'paid' : newPaid > 0 ? 'partial' : 'posted',
        };
      });
    }
  }

  let updatedJEs = [...db.journalEntries];
  if (v.journalEntryId) {
    const origJe = updatedJEs.find((j) => j.id === v.journalEntryId && j.status === 'posted');
    if (origJe) {
      const revJe = createReversalJournalEntry(
        origJe,
        reason || `إلغاء سند ${v.voucherNumber}`,
        user.fullName,
        updatedJEs.map((j) => j.entryNumber)
      );
      revJe.companyId = activeCompanyId;
      updatedJEs = updatedJEs.map((j) => (j.id === origJe.id ? { ...j, status: 'reversed' as const } : j));
      updatedJEs.push(revJe);
    }
  }

  const nextDb: ERPDatabase = {
    ...db,
    paymentVouchers: db.paymentVouchers.map((x) =>
      x.id === v.id ? { ...x, status: 'cancelled' as const } : x
    ),
    treasuryAccounts: updatedTreasuries,
    customers: updatedCustomers,
    vendors: updatedVendors,
    invoices: updatedInvoices,
    journalEntries: updatedJEs,
    auditLogs: [
      makeAudit(db, user, {
        action: 'إلغاء',
        module: 'الخزينة',
        details: `إلغاء سند ${v.type} رقم ${v.voucherNumber} وعكس القيد والأرصدة وسداد الفواتير المرتبطة`,
        entityId: v.id,
        reason,
      }),
      ...db.auditLogs,
    ],
  };

  return { ok: true, nextDb };
}

/**
 * 7. Execute Treasury Transfer
 */
export function executeTreasuryTransferTransaction(
  db: ERPDatabase,
  user: User,
  transfer: TreasuryTransfer,
  branchId: string
): TransactionResult {
  const perm = assertPermission(user, 'vouchers', 'post');
  if (!perm.ok) return { ok: false, error: perm.error };
  const fromTr = db.treasuryAccounts.find((t) => t.id === transfer.fromTreasuryId);
  const toTr = db.treasuryAccounts.find((t) => t.id === transfer.toTreasuryId);
  if (!fromTr || !toTr || fromTr.id === toTr.id || transfer.amount <= 0) {
    return { ok: false, error: 'بيانات التحويل بين الصناديق غير صالحة.' };
  }

  const activeCompanyId = transfer.companyId || db.activeCompanyId || db.company.id;
  const tenant = assertTenantAccess(user, activeCompanyId);
  if (!tenant.ok) return { ok: false, error: tenant.error };
  const fromErr = verifyEntityCompany(fromTr, activeCompanyId, 'الصندوق المحول منه');
  if (fromErr) return { ok: false, error: fromErr };
  const toErr = verifyEntityCompany(toTr, activeCompanyId, 'الصندوق المحول إليه');
  if (toErr) return { ok: false, error: toErr };
  const pCheck = isDateInOpenFiscalPeriod(transfer.date, db.fiscalPeriods, activeCompanyId, db.settings);
  if (!pCheck.allowed) return { ok: false, error: pCheck.error };

  const rate = getRate(db, transfer.currency);
  const baseAmt = transfer.amount * rate;
  const baseFee = (transfer.feeAmount || 0) * rate;

  const updatedTreasuries = db.treasuryAccounts.map((t) => {
    const tRate = getRate(db, t.currency);
    if (t.id === fromTr.id) {
      const deductAmt =
        t.currency === transfer.currency ? transfer.amount + (transfer.feeAmount || 0) : (baseAmt + baseFee) / tRate;
      return { ...t, balance: t.balance - deductAmt };
    }
    if (t.id === toTr.id) {
      const addAmt = t.currency === transfer.currency ? transfer.amount : baseAmt / tRate;
      return { ...t, balance: t.balance + addAmt };
    }
    return t;
  });

  const companyAccounts = getCompanyAccounts(db, activeCompanyId);
  const accFrom =
    companyAccounts.find((a) => a.id === fromTr.generalLedgerAccountId) ||
    resolveAccount(companyAccounts, ['1111', '131'], 'أصول', ['الصندوق']);
  const accTo =
    companyAccounts.find((a) => a.id === toTr.generalLedgerAccountId) ||
    resolveAccount(companyAccounts, ['1121', '132'], 'أصول', ['بنك']);
  const accBankFees = resolveAccount(companyAccounts, ['5340', '510'], 'مصروفات', ['رسوم', 'مصاريف']);

  const entryNumber = generateNextDocNumber(
    `JV-${new Date().getFullYear()}-`,
    db.journalEntries.map((j) => j.entryNumber),
    4
  );

  const ts = Date.now();
  const je: JournalEntry = {
    id: `je-tr-${ts}`,
    companyId: activeCompanyId,
    entryNumber,
    date: transfer.date,
    branchId,
    referenceType: 'تحويل_نقدية',
    referenceNumber: transfer.transferNumber,
    referenceId: transfer.id,
    description: `تحويل نقدي من ${fromTr.nameAr} إلى ${toTr.nameAr}`,
    lines: [
      {
        id: `jl-t1-${ts}`,
        accountId: accTo.id,
        accountCode: accTo.code,
        accountName: `${accTo.nameAr} (${toTr.nameAr})`,
        debit: baseAmt,
        credit: 0,
        currency: transfer.currency,
        exchangeRate: rate,
        memo: `استلام تحويل نقدي ${transfer.transferNumber}`,
      },
      ...(baseFee > 0
        ? [
            {
              id: `jl-t2-${ts}`,
              accountId: accBankFees.id,
              accountCode: accBankFees.code,
              accountName: accBankFees.nameAr,
              debit: baseFee,
              credit: 0,
              currency: transfer.currency,
              exchangeRate: rate,
              memo: `رسوم تحويل بنكي ${transfer.transferNumber}`,
            },
          ]
        : []),
      {
        id: `jl-t3-${ts}`,
        accountId: accFrom.id,
        accountCode: accFrom.code,
        accountName: `${accFrom.nameAr} (${fromTr.nameAr})`,
        debit: 0,
        credit: baseAmt + baseFee,
        currency: transfer.currency,
        exchangeRate: rate,
        memo: `صرف تحويل نقدي إلى ${toTr.nameAr}`,
      },
    ],
    totalDebit: baseAmt + baseFee,
    totalCredit: baseAmt + baseFee,
    status: 'posted',
    createdBy: user.fullName,
    createdAt: new Date().toISOString(),
  };

  const nextDb: ERPDatabase = {
    ...db,
    treasuryAccounts: updatedTreasuries,
    treasuryTransfers: [{ ...transfer, companyId: activeCompanyId, journalEntryId: je.id }, ...(db.treasuryTransfers || [])],
    journalEntries: [...db.journalEntries, je],
    auditLogs: [
      makeAudit(db, user, {
        action: 'ترحيل',
        module: 'الخزينة',
        details: `تحويل نقدي رقم ${transfer.transferNumber} من (${fromTr.nameAr}) إلى (${toTr.nameAr})`,
        entityId: transfer.id,
      }),
      ...db.auditLogs,
    ],
  };

  return { ok: true, nextDb };
}

/**
 * 8. Post Expense Record
 */
export function postExpenseTransaction(
  db: ERPDatabase,
  user: User,
  expense: ExpenseRecord
): TransactionResult {
  const perm = assertPermission(user, 'accounting', 'post');
  if (!perm.ok) return { ok: false, error: perm.error };
  if (!Number.isFinite(expense.total) || expense.total <= 0) {
    return { ok: false, error: 'قيمة المصروف يجب أن تكون أكبر من صفر.' };
  }

  const activeCompanyId = expense.companyId || db.activeCompanyId || db.company.id;
  const tenant = assertTenantAccess(user, activeCompanyId);
  if (!tenant.ok) return { ok: false, error: tenant.error };
  const trErr = verifyEntityCompany(
    db.treasuryAccounts.find((t) => t.id === expense.treasuryAccountId),
    activeCompanyId,
    'حساب الخزينة'
  );
  if (trErr) return { ok: false, error: trErr };
  const pCheck = isDateInOpenFiscalPeriod(expense.date, db.fiscalPeriods, activeCompanyId, db.settings);
  if (!pCheck.allowed) return { ok: false, error: pCheck.error };

  const expRate = getRate(db, expense.currency || db.company.baseCurrency || 'YER');
  const baseExpAmount = expense.total * expRate;
  const companyAccounts = getCompanyAccounts(db, activeCompanyId);
  const journalEntry = createExpenseJournalEntry(
    expense,
    companyAccounts,
    user.fullName,
    db.journalEntries.map((j) => j.entryNumber),
    expRate
  );
  journalEntry.companyId = activeCompanyId;

  const updatedTreasuries = db.treasuryAccounts.map((t) => {
    if (t.id === expense.treasuryAccountId) {
      const tRate = getRate(db, t.currency);
      const deductAmt = t.currency === expense.currency ? expense.total : baseExpAmount / tRate;
      return { ...t, balance: t.balance - deductAmt };
    }
    return t;
  });

  const nextDb: ERPDatabase = {
    ...db,
    expenseRecords: [...db.expenseRecords, { ...expense, companyId: activeCompanyId, journalEntryId: journalEntry.id }],
    journalEntries: [...db.journalEntries, journalEntry],
    treasuryAccounts: updatedTreasuries,
    auditLogs: [
      makeAudit(db, user, {
        action: 'ترحيل',
        module: 'المصروفات',
        details: `ترحيل مصروف (${expense.categoryName}) رقم ${expense.expenseNumber} بمبلغ ${expense.total.toLocaleString()}`,
        entityId: expense.id,
      }),
      ...db.auditLogs,
    ],
  };

  return { ok: true, nextDb };
}

/**
 * 9. Post Manual Journal Entry (Strict Leaf Account + Balance + Period + Approval Check)
 */
export function postManualJournalTransaction(
  db: ERPDatabase,
  user: User,
  entry: JournalEntry,
  opts?: TransactionOptions
): TransactionResult<JournalEntry> {
  const perm = assertPermission(user, 'accounting', 'post');
  if (!perm.ok) return { ok: false, error: perm.error };

  const activeCompanyId = entry.companyId || db.activeCompanyId || db.company.id;
  const tenant = assertTenantAccess(user, activeCompanyId);
  if (!tenant.ok) return { ok: false, error: tenant.error };

  const companyAccounts = getCompanyAccounts(db, activeCompanyId);
  const check = validateJournalEntryWithAccounts(entry.lines, companyAccounts);
  if (!check.isValid) {
    return { ok: false, error: check.error || 'القيد المحاسبي غير مستوفٍ للشروط المحاسبية.' };
  }

  const pCheck = isDateInOpenFiscalPeriod(
    entry.date,
    db.fiscalPeriods,
    activeCompanyId,
    db.settings,
    entry.entryType === 'closing'
  );
  if (!pCheck.allowed) return { ok: false, error: pCheck.error };

  const approvalReq = checkApprovalRequired(
    db,
    user,
    'manual_journal_post',
    check.totalDebit,
    entry.entryNumber,
    entry.description,
    { kind: 'manual_journal', entry },
    opts
  );
  if (approvalReq) {
    const queuedDb: ERPDatabase = {
      ...db,
      approvalRequests: [approvalReq, ...(db.approvalRequests || [])],
    };
    return {
      ok: false,
      nextDb: queuedDb,
      approvalRequired: approvalReq,
      error: `تم إرسال القيد اليدوي لصندوق الموافقات (${approvalReq.requestNumber}).`,
    };
  }

  const persistedEntry: JournalEntry = {
    ...entry,
    companyId: activeCompanyId,
    fiscalPeriodId: pCheck.fiscalPeriodId,
    approvalStatus: 'approved',
  };

  const nextDb: ERPDatabase = {
    ...db,
    journalEntries: [...db.journalEntries, persistedEntry],
    auditLogs: [
      makeAudit(db, user, {
        action: 'ترحيل',
        module: 'المحاسبة',
        details: `ترحيل قيد يومي رقم ${persistedEntry.entryNumber}: ${persistedEntry.description}`,
        entityId: persistedEntry.id,
        afterSnapshot: { totalDebit: persistedEntry.totalDebit, linesCount: persistedEntry.lines.length },
      }),
      ...db.auditLogs,
    ],
  };

  return { ok: true, nextDb, data: persistedEntry };
}

/**
 * 10. Reverse Journal Entry
 */
export function reverseJournalTransaction(
  db: ERPDatabase,
  user: User,
  entryId: string,
  reason: string
): TransactionResult<JournalEntry> {
  const perm = assertPermission(user, 'accounting', 'post');
  if (!perm.ok) return { ok: false, error: perm.error };
  const orig = db.journalEntries.find((j) => j.id === entryId);
  if (!orig || orig.status === 'reversed') {
    return { ok: false, error: 'هذا القيد معكوس مسبقاً أو غير موجود.' };
  }
  const activeCompanyId = orig.companyId || db.activeCompanyId || db.company.id;
  const tenant = assertTenantAccess(user, activeCompanyId);
  if (!tenant.ok) return { ok: false, error: tenant.error };
  const pCheck = isDateInOpenFiscalPeriod(orig.date, db.fiscalPeriods, activeCompanyId, db.settings);
  if (!pCheck.allowed) return { ok: false, error: pCheck.error };

  const rev = createReversalJournalEntry(
    orig,
    sanitizeInputText(reason || 'قيد عكسي'),
    user.fullName,
    db.journalEntries.map((j) => j.entryNumber)
  );
  rev.companyId = activeCompanyId;
  rev.entryType = 'reversal';

  const nextDb: ERPDatabase = {
    ...db,
    journalEntries: [
      ...db.journalEntries.map((j) => (j.id === orig.id ? { ...j, status: 'reversed' as const } : j)),
      rev,
    ],
    auditLogs: [
      makeAudit(db, user, {
        action: 'إلغاء',
        module: 'المحاسبة',
        details: `إنشاء القيد العكسي ${rev.entryNumber} للقيد ${orig.entryNumber}`,
        entityId: orig.id,
        reason: sanitizeInputText(reason),
      }),
      ...db.auditLogs,
    ],
  };

  return { ok: true, nextDb, data: rev };
}

/**
 * 11. Stock Transfers & Adjustments & Stocktaking
 */
export function executeStockTransferTransaction(
  db: ERPDatabase,
  user: User,
  transfer: InventoryTransfer
): TransactionResult {
  const perm = assertPermission(user, 'inventory', 'post');
  if (!perm.ok) return { ok: false, error: perm.error || 'لا تملك صلاحية التحويل المخزني.' };
  const activeCompanyId = transfer.companyId || db.activeCompanyId || db.company.id;
  const tenant = assertTenantAccess(user, activeCompanyId);
  if (!tenant.ok) return { ok: false, error: tenant.error };
  const fromWhErr = verifyEntityCompany(
    db.warehouses.find((w) => w.id === transfer.fromWarehouseId),
    activeCompanyId,
    'المستودع المصدر'
  );
  if (fromWhErr) return { ok: false, error: fromWhErr };
  const toWhErr = verifyEntityCompany(
    db.warehouses.find((w) => w.id === transfer.toWarehouseId),
    activeCompanyId,
    'المستودع الوجهة'
  );
  if (toWhErr) return { ok: false, error: toWhErr };

  const res = executeInventoryTransfer(db.warehouseStock, transfer, user.fullName);
  if (!res.success) return { ok: false, error: res.error };

  const nextDb: ERPDatabase = {
    ...db,
    warehouseStock: res.newStocks,
    stockMovements: [...db.stockMovements, ...res.movements.map((m) => ({ ...m, companyId: activeCompanyId }))],
    inventoryTransfers: [...db.inventoryTransfers, { ...transfer, companyId: activeCompanyId, status: 'completed' }],
    auditLogs: [
      makeAudit(db, user, {
        action: 'ترحيل',
        module: 'المخزون',
        details: `تنفيذ تحويل مخزني ${transfer.transferNumber}`,
        entityId: transfer.id,
      }),
      ...db.auditLogs,
    ],
  };
  return { ok: true, nextDb };
}

export function reverseStockTransferTransaction(
  db: ERPDatabase,
  user: User,
  transfer: InventoryTransfer
): TransactionResult {
  const perm = assertPermission(user, 'inventory', 'post');
  if (!perm.ok) return { ok: false, error: perm.error || 'لا تملك صلاحية عكس التحويل.' };
  const activeCompanyId = transfer.companyId || db.activeCompanyId || db.company.id;
  const tenant = assertTenantAccess(user, activeCompanyId);
  if (!tenant.ok) return { ok: false, error: tenant.error };

  const res = reverseInventoryTransfer(db.warehouseStock, transfer, user.fullName);
  if (!res.success) return { ok: false, error: res.error };

  const nextDb: ERPDatabase = {
    ...db,
    warehouseStock: res.newStocks,
    stockMovements: [...db.stockMovements, ...res.movements.map((m) => ({ ...m, companyId: activeCompanyId }))],
    inventoryTransfers: db.inventoryTransfers.map((t) =>
      t.id === transfer.id ? { ...t, status: 'cancelled' as const } : t
    ),
    auditLogs: [
      makeAudit(db, user, {
        action: 'إلغاء',
        module: 'المخزون',
        details: `عكس التحويل المخزني ${transfer.transferNumber}`,
        entityId: transfer.id,
      }),
      ...db.auditLogs,
    ],
  };
  return { ok: true, nextDb };
}

export function approveStocktakingTransaction(
  db: ERPDatabase,
  user: User,
  stocktake: PhysicalStocktaking
): TransactionResult<PhysicalStocktaking> {
  const perm = assertPermission(user, 'inventory', 'post');
  if (!perm.ok) return { ok: false, error: perm.error || 'لا تملك صلاحية اعتماد الجرد.' };

  const activeCompanyId = stocktake.companyId || db.activeCompanyId || db.company.id;
  const tenant = assertTenantAccess(user, activeCompanyId);
  if (!tenant.ok) return { ok: false, error: tenant.error };
  const pCheck = isDateInOpenFiscalPeriod(stocktake.date, db.fiscalPeriods, activeCompanyId, db.settings);
  if (!pCheck.allowed) return { ok: false, error: pCheck.error };

  const res = applyStocktakingAdjustments(db.warehouseStock, stocktake, user.fullName);
  if (!res.success) return { ok: false, error: res.error };

  const companyAccounts = getCompanyAccounts(db, activeCompanyId);
  const je = createStocktakingJournalEntry(
    stocktake,
    companyAccounts,
    db.settings.stocktakeSurplusAccountCode || '4190',
    db.settings.stocktakeShortageAccountCode || '5390',
    user.fullName,
    db.journalEntries.map((j) => j.entryNumber),
    db.company.baseCurrency || 'YER'
  );
  if (je) je.companyId = activeCompanyId;

  const approved: PhysicalStocktaking = {
    ...stocktake,
    companyId: activeCompanyId,
    status: 'approved',
    approvedBy: user.fullName,
    approvedAt: new Date().toISOString(),
    adjustmentJournalEntryId: je?.id,
  };
  const existing = db.stocktakings.find((s) => s.id === stocktake.id);

  // Sync FIFO layers for variances
  let updatedLayers = [...(db.stockCostLayers || [])];
  for (const item of stocktake.items) {
    const wh = item.warehouseId || stocktake.warehouseId;
    if (item.difference > 0) {
      updatedLayers = addFifoCostLayer(updatedLayers, {
        companyId: activeCompanyId,
        itemId: item.itemId,
        warehouseId: wh,
        quantity: item.difference,
        unitCost: item.unitCost,
        receivedDate: stocktake.date,
        sourceDocType: 'تسوية_زيادة',
        sourceDocId: stocktake.id,
        sourceDocNumber: stocktake.stocktakeNumber,
      });
    } else if (item.difference < 0) {
      updatedLayers = consumeFifoCostLayers(
        updatedLayers,
        item.itemId,
        wh,
        Math.abs(item.difference),
        item.unitCost,
        activeCompanyId
      ).nextLayers;
    }
  }

  const nextDb: ERPDatabase = {
    ...db,
    stocktakings: existing
      ? db.stocktakings.map((s) => (s.id === stocktake.id ? approved : s))
      : [approved, ...db.stocktakings],
    warehouseStock: res.newStocks,
    stockCostLayers: updatedLayers,
    stockMovements: [...db.stockMovements, ...res.movements.map((m) => ({ ...m, companyId: activeCompanyId }))],
    journalEntries: je ? [...db.journalEntries, je] : db.journalEntries,
    auditLogs: [
      makeAudit(db, user, {
        action: 'موافقة',
        module: 'المخزون',
        details: `اعتماد محضر الجرد ${stocktake.stocktakeNumber} وتحديث الفوارق المخزنية والمحاسبية`,
        entityId: stocktake.id,
      }),
      ...db.auditLogs,
    ],
  };
  return { ok: true, nextDb, data: approved };
}

/**
 * 12. Payroll Disbursement & Fixed Asset Depreciation / Disposal
 */
export function disbursePayrollTransaction(
  db: ERPDatabase,
  user: User,
  payroll: PayrollRun,
  branchId: string
): TransactionResult {
  const perm = assertPermission(user, 'accounting', 'post');
  if (!perm.ok) return { ok: false, error: perm.error };
  const activeCompanyId = payroll.companyId || db.activeCompanyId || db.company.id;
  const tenant = assertTenantAccess(user, activeCompanyId);
  if (!tenant.ok) return { ok: false, error: tenant.error };
  const trErr = verifyEntityCompany(
    db.treasuryAccounts.find((t) => t.id === payroll.disbursementTreasuryId),
    activeCompanyId,
    'خزينة صرف الرواتب'
  );
  if (trErr) return { ok: false, error: trErr };
  const disburseDate = payroll.disbursedDate || new Date().toISOString().split('T')[0];
  const pCheck = isDateInOpenFiscalPeriod(disburseDate, db.fiscalPeriods, activeCompanyId, db.settings);
  if (!pCheck.allowed) return { ok: false, error: pCheck.error };

  const updatedTreasuries = db.treasuryAccounts.map((t) => {
    if (t.id === payroll.disbursementTreasuryId) {
      const tRate = getRate(db, t.currency);
      return { ...t, balance: t.balance - payroll.totalNet / tRate };
    }
    return t;
  });

  const companyAccounts = getCompanyAccounts(db, activeCompanyId);
  const accSalaries = resolveAccount(companyAccounts, ['5210', '521', '520'], 'مصروفات', ['رواتب']);
  const accTreasury = resolveAccount(companyAccounts, ['1111', '131'], 'أصول', ['الصندوق']);
  const accDeductions = resolveAccount(companyAccounts, ['2130', '213', '210'], 'خصوم', ['استقطاع', 'مستحق']);
  const entryNumber = generateNextDocNumber(
    `JV-${new Date().getFullYear()}-`,
    db.journalEntries.map((j) => j.entryNumber),
    4
  );
  const ts = Date.now();
  const baseCur = db.company.baseCurrency || 'YER';
  const payrollEntry: JournalEntry = {
    id: `je-pay-${ts}`,
    companyId: activeCompanyId,
    entryNumber,
    date: disburseDate,
    branchId,
    referenceType: 'رواتب',
    referenceNumber: payroll.payrollNumber,
    referenceId: payroll.id,
    description: `قيد إثبات وصرف رواتب شهر ${payroll.month}`,
    lines: [
      {
        id: `jl-p1-${ts}`,
        accountId: accSalaries.id,
        accountCode: accSalaries.code,
        accountName: accSalaries.nameAr,
        debit: payroll.totalGross,
        credit: 0,
        currency: baseCur,
        exchangeRate: 1,
        memo: `رواتب شهر ${payroll.month}`,
      },
      {
        id: `jl-p2-${ts}`,
        accountId: accTreasury.id,
        accountCode: accTreasury.code,
        accountName: accTreasury.nameAr,
        debit: 0,
        credit: payroll.totalNet,
        currency: baseCur,
        exchangeRate: 1,
        memo: `صرف صافي الرواتب`,
      },
      {
        id: `jl-p3-${ts}`,
        accountId: accDeductions.id,
        accountCode: accDeductions.code,
        accountName: accDeductions.nameAr,
        debit: 0,
        credit: payroll.totalDeductions,
        currency: baseCur,
        exchangeRate: 1,
        memo: `استقطاعات`,
      },
    ],
    totalDebit: payroll.totalGross,
    totalCredit: payroll.totalGross,
    status: 'posted',
    createdBy: user.fullName,
    createdAt: new Date().toISOString(),
  };

  const nextDb: ERPDatabase = {
    ...db,
    payrollRuns: [...db.payrollRuns, { ...payroll, companyId: activeCompanyId, journalEntryId: payrollEntry.id }],
    journalEntries: [...db.journalEntries, payrollEntry],
    treasuryAccounts: updatedTreasuries,
    auditLogs: [
      makeAudit(db, user, {
        action: 'ترحيل',
        module: 'الرواتب',
        details: `صرف وترحيل مسير رواتب ${payroll.payrollNumber} لشهر ${payroll.month}`,
        entityId: payroll.id,
      }),
      ...db.auditLogs,
    ],
  };

  return { ok: true, nextDb };
}

export function disposeFixedAssetTransaction(
  db: ERPDatabase,
  user: User,
  assetId: string,
  saleProceeds: number,
  treasuryId: string,
  disposalDate: string,
  notes?: string
): TransactionResult {
  const perm = assertPermission(user, 'accounting', 'post');
  if (!perm.ok) return { ok: false, error: perm.error };
  const asset = db.fixedAssets.find((a) => a.id === assetId);
  if (!asset || asset.status === 'disposed') {
    return { ok: false, error: 'الأصل غير موجود أو مستبعد مسبقاً.' };
  }
  const activeCompanyId = asset.companyId || db.activeCompanyId || db.company.id;
  const tenant = assertTenantAccess(user, activeCompanyId);
  if (!tenant.ok) return { ok: false, error: tenant.error };
  if (treasuryId) {
    const trErr = verifyEntityCompany(
      db.treasuryAccounts.find((t) => t.id === treasuryId),
      activeCompanyId,
      'حساب الخزينة'
    );
    if (trErr) return { ok: false, error: trErr };
  }
  const pCheck = isDateInOpenFiscalPeriod(disposalDate, db.fiscalPeriods, activeCompanyId, db.settings);
  if (!pCheck.allowed) return { ok: false, error: pCheck.error };

  const companyAccounts = getCompanyAccounts(db, activeCompanyId);
  const je = createAssetDisposalJournalEntry(
    asset,
    saleProceeds,
    treasuryId,
    disposalDate,
    companyAccounts,
    db.treasuryAccounts,
    user.fullName,
    db.journalEntries.map((j) => j.entryNumber),
    db.company.baseCurrency || 'YER'
  );
  je.companyId = activeCompanyId;

  const updatedTreasuries =
    saleProceeds > 0
      ? db.treasuryAccounts.map((t) => {
          if (t.id === treasuryId) {
            const tRate = getRate(db, t.currency);
            return { ...t, balance: t.balance + saleProceeds / tRate };
          }
          return t;
        })
      : db.treasuryAccounts;

  const updatedAssets = db.fixedAssets.map((a) =>
    a.id === assetId
      ? {
          ...a,
          status: 'disposed' as const,
          disposalDate,
          disposalProceeds: saleProceeds,
          disposalJournalEntryId: je.id,
          currentBookValue: 0,
        }
      : a
  );

  const nextDb: ERPDatabase = {
    ...db,
    fixedAssets: updatedAssets,
    treasuryAccounts: updatedTreasuries,
    journalEntries: [...db.journalEntries, je],
    auditLogs: [
      makeAudit(db, user, {
        action: 'إقفال',
        module: 'الأصول',
        details: `بيع/استبعاد الأصل الثابت (${asset.code} - ${asset.nameAr}) بمبلغ ${saleProceeds.toLocaleString()}`,
        entityId: asset.id,
        reason: notes,
      }),
      ...db.auditLogs,
    ],
  };
  return { ok: true, nextDb };
}

/**
 * 13. Fiscal Year-End Closing & Opening Next Fiscal Year Period
 */
export function executeYearEndClosingTransaction(
  db: ERPDatabase,
  user: User,
  fiscalYear: string,
  closingDate: string,
  openNextYear = true
): TransactionResult<{ closingEntry: JournalEntry; netProfitClosed: number }> {
  const perm = assertPermission(user, 'accounting', 'approve');
  if (!perm.ok) return { ok: false, error: perm.error };

  const activeCompanyId = db.activeCompanyId || db.company.id;
  const tenant = assertTenantAccess(user, activeCompanyId);
  if (!tenant.ok) return { ok: false, error: tenant.error };
  const companyAccounts = getCompanyAccounts(db, activeCompanyId);
  const companyJournalEntries = db.journalEntries.filter((j) => !j.companyId || j.companyId === activeCompanyId);
  const closeRes = createYearEndClosingEntry(
    companyAccounts,
    companyJournalEntries,
    fiscalYear,
    closingDate,
    activeCompanyId,
    user.fullName,
    db.journalEntries.map((j) => j.entryNumber),
    db.company.baseCurrency || 'YER'
  );
  if (!closeRes.success || !closeRes.entry) {
    return { ok: false, error: closeRes.error };
  }

  const nextYearNum = String(Number(fiscalYear) + 1);
  const existingPeriods = db.fiscalPeriods || [];
  let updatedPeriods = existingPeriods.map((fp) =>
    fp.fiscalYear === fiscalYear && fp.companyId === activeCompanyId
      ? {
          ...fp,
          status: 'closed' as const,
          closedAt: new Date().toISOString(),
          closedBy: user.fullName,
          closingJournalEntryId: closeRes.entry!.id,
        }
      : fp
  );

  if (
    openNextYear &&
    !updatedPeriods.some((fp) => fp.fiscalYear === nextYearNum && fp.companyId === activeCompanyId)
  ) {
    updatedPeriods = [
      ...updatedPeriods,
      {
        id: `fp-${activeCompanyId}-${nextYearNum}`,
        companyId: activeCompanyId,
        fiscalYear: nextYearNum,
        periodName: `السنة المالية ${nextYearNum}`,
        startDate: `${nextYearNum}-01-01`,
        endDate: `${nextYearNum}-12-31`,
        status: 'open',
      },
    ];
  }

  const nextDb: ERPDatabase = {
    ...db,
    journalEntries: [...db.journalEntries, closeRes.entry],
    fiscalPeriods: updatedPeriods,
    settings: {
      ...db.settings,
      fiscalYear: openNextYear ? nextYearNum : db.settings.fiscalYear,
      fiscalYearStatus: openNextYear ? 'open' : 'closed',
    },
    auditLogs: [
      makeAudit(db, user, {
        action: 'إقفال',
        module: 'المحاسبة',
        details: `إقفال السنة المالية (${fiscalYear}) وترحيل صافي النتيجة (${closeRes.netProfitClosed.toLocaleString()}) إلى الأرباح المبقاة`,
        entityId: closeRes.entry.id,
      }),
      ...db.auditLogs,
    ],
  };

  return {
    ok: true,
    nextDb,
    data: { closingEntry: closeRes.entry, netProfitClosed: closeRes.netProfitClosed },
  };
}

/**
 * 14. Execute Multi-Currency FX Revaluation
 */
export function executeFxRevaluationTransaction(
  db: ERPDatabase,
  user: User,
  date: string
): TransactionResult {
  const perm = assertPermission(user, 'accounting', 'post');
  if (!perm.ok) return { ok: false, error: perm.error };
  const activeCompanyId = db.activeCompanyId || db.company.id;
  const tenant = assertTenantAccess(user, activeCompanyId);
  if (!tenant.ok) return { ok: false, error: tenant.error };
  const pCheck = isDateInOpenFiscalPeriod(date, db.fiscalPeriods, activeCompanyId, db.settings);
  if (!pCheck.allowed) return { ok: false, error: pCheck.error };

  const companyAccounts = getCompanyAccounts(db, activeCompanyId);
  const fxRes = generateFxRevaluationJournalEntry(
    db.treasuryAccounts,
    db.currencies,
    db.journalEntries,
    companyAccounts,
    date,
    activeCompanyId,
    user.fullName,
    db.journalEntries.map((j) => j.entryNumber),
    db.company.baseCurrency || 'YER'
  );
  if (!fxRes.success || !fxRes.entry || !fxRes.record) {
    return { ok: false, error: fxRes.error };
  }

  const nextDb: ERPDatabase = {
    ...db,
    journalEntries: [...db.journalEntries, fxRes.entry],
    fxRevaluations: [fxRes.record, ...(db.fxRevaluations || [])],
    auditLogs: [
      makeAudit(db, user, {
        action: 'ترحيل',
        module: 'المحاسبة',
        details: `إعادة تقييم العملات الأجنبية بتاريخ ${date} (صافي الفرق ${fxRes.record.totalGainLossBase.toLocaleString()})`,
        entityId: fxRes.record.id,
      }),
      ...db.auditLogs,
    ],
  };
  return { ok: true, nextDb };
}

/**
 * 15. Approval Inbox Decision Execution (Multi-Level Approval Workflow)
 */
export function processApprovalDecisionTransaction(
  db: ERPDatabase,
  approver: User,
  requestId: string,
  decision: 'approved' | 'rejected',
  notes?: string
): TransactionResult<unknown> {
  const perm = assertPermission(approver, 'accounting', 'approve');
  if (!perm.ok) return { ok: false, error: perm.error };

  const req = (db.approvalRequests || []).find((r) => r.id === requestId);
  if (!req || req.status !== 'pending') {
    return { ok: false, error: 'طلب الموافقة غير موجود أو تمت معالجته مسبقاً.' };
  }
  const activeCompanyId = req.companyId || db.activeCompanyId || db.company.id;
  const tenant = assertTenantAccess(approver, activeCompanyId);
  if (!tenant.ok) return { ok: false, error: tenant.error };

  // Strict Separation of Duties (SoD):
  // 1. Requester cannot approve their own request.
  // 2. The same user cannot approve multiple levels (e.g., Level 1 and Level 2) of the same request.
  if (decision === 'approved') {
    if (req.requestedByUserId === approver.id) {
      return {
        ok: false,
        error: 'فصل المهام (Separation of Duties): لا يجوز لمقدم الطلب اعتماد معاملته بنفسه.',
      };
    }
    if (req.history.some((h) => h.decision === 'approved' && h.byUserId === approver.id)) {
      return {
        ok: false,
        error: 'فصل المهام (Separation of Duties): لا يجوز لنفس المستخدم اعتماد أكثر من مستوى لنفس الطلب.',
      };
    }
  }

  const updatedHistory = [
    ...req.history,
    {
      level: req.currentLevel,
      decision,
      byUserId: approver.id,
      byUserName: approver.fullName,
      at: new Date().toISOString(),
      notes,
    },
  ];

  if (decision === 'rejected') {
    const nextDb: ERPDatabase = {
      ...db,
      approvalRequests: (db.approvalRequests || []).map((r) =>
        r.id === req.id ? { ...r, status: 'rejected', history: updatedHistory } : r
      ),
      auditLogs: [
        makeAudit(db, approver, {
          action: 'رفض',
          module: 'النظام',
          details: `رفض طلب الاعتماد (${req.requestNumber}) - ${req.entityLabel}`,
          entityId: req.id,
          reason: notes,
        }),
        ...db.auditLogs,
      ],
    };
    return { ok: true, nextDb };
  }

  // If 2-level workflow and currently at level 1 -> advance to level 2
  if (req.currentLevel < req.requiredLevels) {
    const nextDb: ERPDatabase = {
      ...db,
      approvalRequests: (db.approvalRequests || []).map((r) =>
        r.id === req.id ? { ...r, currentLevel: 2, history: updatedHistory } : r
      ),
      auditLogs: [
        makeAudit(db, approver, {
          action: 'موافقة',
          module: 'النظام',
          details: `اعتماد المستوى الأول للطلب (${req.requestNumber}) وإحالته للمستوى الثاني`,
          entityId: req.id,
        }),
        ...db.auditLogs,
      ],
    };
    return { ok: true, nextDb };
  }

  // Final approval achieved -> mark request approved and execute underlying payload atomically!
  const dbWithReqApproved: ERPDatabase = {
    ...db,
    approvalRequests: (db.approvalRequests || []).map((r) =>
      r.id === req.id ? { ...r, status: 'approved', history: updatedHistory } : r
    ),
  };

  try {
    const payload = JSON.parse(req.payloadJson) as {
      kind: 'sales_invoice' | 'purchase_invoice' | 'vouchers_batch' | 'manual_journal';
      invoice?: Invoice;
      vouchers?: PaymentVoucher[];
      entry?: JournalEntry;
    };

    if (payload.kind === 'sales_invoice' && payload.invoice) {
      return postSalesInvoiceTransaction(dbWithReqApproved, approver, payload.invoice, {
        bypassApprovalCheck: true,
      });
    }
    if (payload.kind === 'purchase_invoice' && payload.invoice) {
      return postPurchaseInvoiceTransaction(dbWithReqApproved, approver, payload.invoice, {
        bypassApprovalCheck: true,
      });
    }
    if (payload.kind === 'vouchers_batch' && payload.vouchers) {
      return postVouchersBatchTransaction(dbWithReqApproved, approver, payload.vouchers, {
        bypassApprovalCheck: true,
      });
    }
    if (payload.kind === 'manual_journal' && payload.entry) {
      return postManualJournalTransaction(dbWithReqApproved, approver, payload.entry, {
        bypassApprovalCheck: true,
      });
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'تعذر تنفيذ المستند المعتمد.' };
  }

  return { ok: true, nextDb: dbWithReqApproved };
}

/**
 * 16. Convert Commercial Order (عرض سعر / أمر بيع / أمر شراء) into Draft/Posted Invoice
 */
export function convertCommercialOrderToInvoice(
  order: CommercialOrder,
  nextInvoiceNumber: string,
  user: User
): Invoice {
  const isPurchaseSide =
    order.orderType === 'طلب_شراء' ||
    order.orderType === 'أمر_شراء' ||
    order.orderType === 'استلام_بضاعة';
  const type: Invoice['type'] =
    order.orderType === 'إشعار_دائن'
      ? 'مرتجع_مبيعات'
      : order.orderType === 'إشعار_مدين'
      ? 'مرتجع_مشتريات'
      : isPurchaseSide
      ? 'مشتريات'
      : 'مبيعات';

  return {
    id: `inv-conv-${Date.now()}`,
    companyId: order.companyId,
    invoiceNumber: nextInvoiceNumber,
    type,
    paymentType: 'آجل',
    date: new Date().toISOString().split('T')[0],
    branchId: order.branchId,
    warehouseId: order.warehouseId,
    entityId: order.entityId,
    entityName: order.entityName,
    currency: order.currency,
    exchangeRate: order.exchangeRate,
    items: order.items,
    subtotal: order.subtotal,
    discountTotal: order.discountTotal,
    taxTotal: order.taxTotal,
    grandTotal: order.grandTotal,
    paidAmount: 0,
    remainingAmount: order.grandTotal,
    status: 'draft',
    sourceOrderId: order.id,
    notes: `محول من (${order.orderType}) رقم ${order.orderNumber}`,
    createdBy: user.fullName,
    createdAt: new Date().toISOString(),
  };
}

/**
 * 17. Atomic Stock Adjustment Transaction (replaces raw App.tsx setDb mutation)
 * Updates warehouseStock, syncs FIFO cost layers, records StockMovement, creates balanced GL JournalEntry, and logs Audit.
 */
export function adjustStockTransaction(
  db: ERPDatabase,
  user: User,
  itemId: string,
  warehouseId: string,
  diff: number,
  reason: string,
  branchId?: string
): TransactionResult<{ adjustmentNumber: string; totalCostBase: number }> {
  const perm = assertPermission(user, 'inventory', 'post');
  if (!perm.ok && !user.canAdjustInventory) {
    return { ok: false, error: perm.error || 'لا تملك صلاحية تسوية المخزون.' };
  }
  const activeCompanyId = db.activeCompanyId || db.company.id;
  const tenant = assertTenantAccess(user, activeCompanyId);
  if (!tenant.ok) return { ok: false, error: tenant.error };

  if (!Number.isFinite(diff) || diff === 0) {
    return { ok: false, error: 'كمية التسوية المخزنية يجب أن تكون رقماً غير صفري.' };
  }

  const item = db.inventoryItems.find((i) => i.id === itemId);
  if (!item) return { ok: false, error: 'الصنف المطلوب تسويته غير موجود.' };
  const itemErr = verifyEntityCompany(item, activeCompanyId, 'الصنف المخزني');
  if (itemErr) return { ok: false, error: itemErr };

  const wh = db.warehouses.find((w) => w.id === warehouseId);
  if (!wh) return { ok: false, error: 'المستودع المحدد غير موجود.' };
  const whErr = verifyEntityCompany(wh, activeCompanyId, 'المستودع');
  if (whErr) return { ok: false, error: whErr };

  const today = new Date().toISOString().split('T')[0];
  const pCheck = isDateInOpenFiscalPeriod(today, db.fiscalPeriods, activeCompanyId, db.settings);
  if (!pCheck.allowed) return { ok: false, error: pCheck.error };

  if (diff < 0) {
    const availCheck = canFulfillStock(
      db.warehouseStock,
      itemId,
      warehouseId,
      Math.abs(diff),
      Boolean(db.settings.allowNegativeStock)
    );
    if (!availCheck.canFulfill) {
      return {
        ok: false,
        error:
          availCheck.message ||
          `الرصيد المتاح (${availCheck.currentQty}) أقل من كمية العجز/الخصم المطلوبة (${Math.abs(diff)}).`,
      };
    }
  }

  const prevQty =
    db.warehouseStock.find((s) => s.itemId === itemId && s.warehouseId === warehouseId)?.quantityOnHand || 0;
  const fallbackUnitCost = item.purchasePrice || 0;
  const adjNum = `ADJ-${Date.now().toString().slice(-6)}`;
  const adjId = `adj-${Date.now()}`;
  const cleanReason = sanitizeInputText(reason) || (diff > 0 ? 'تسوية زيادة مخزنية' : 'تسوية عجز مخزني');

  let updatedLayers = [...(db.stockCostLayers || [])];
  let totalCostBase = Math.round(Math.abs(diff) * fallbackUnitCost * 100) / 100;

  if (diff > 0) {
    updatedLayers = addFifoCostLayer(updatedLayers, {
      companyId: activeCompanyId,
      itemId,
      warehouseId,
      quantity: diff,
      unitCost: fallbackUnitCost,
      receivedDate: today,
      sourceDocType: 'تسوية_زيادة',
      sourceDocId: adjId,
      sourceDocNumber: adjNum,
    });
  } else {
    const fifoRes = consumeFifoCostLayers(
      updatedLayers,
      itemId,
      warehouseId,
      Math.abs(diff),
      fallbackUnitCost,
      activeCompanyId
    );
    updatedLayers = fifoRes.nextLayers;
    if (fifoRes.totalCogsBase > 0) {
      totalCostBase = Math.round(fifoRes.totalCogsBase * 100) / 100;
    }
  }

  const effectiveUnitCost = Math.abs(diff) > 0 ? totalCostBase / Math.abs(diff) : fallbackUnitCost;
  const updatedStocks = updateWarehouseStock(
    db.warehouseStock,
    itemId,
    warehouseId,
    diff,
    effectiveUnitCost
  );
  const newBalance =
    updatedStocks.find((s) => s.itemId === itemId && s.warehouseId === warehouseId)?.quantityOnHand || 0;

  const companyAccounts = getCompanyAccounts(db, activeCompanyId);
  const baseCur = db.company.baseCurrency || 'YER';
  let newJe: JournalEntry | undefined;
  if (totalCostBase > 0) {
    const invAcc = resolveAccount(companyAccounts, ['115', '1150'], 'أصول', ['المخزون']);
    const surplusAcc = resolveAccount(
      companyAccounts,
      [db.settings.stocktakeSurplusAccountCode || '4190', '419'],
      'إيرادات',
      ['فائض']
    );
    const shortageAcc = resolveAccount(
      companyAccounts,
      [db.settings.stocktakeShortageAccountCode || '5390', '539'],
      'مصروفات',
      ['عجز']
    );
    const entryNum = generateNextDocNumber(
      `JV-${today.slice(0, 4)}-`,
      db.journalEntries.map((j) => j.entryNumber),
      4
    );
    newJe = {
      id: `je-adj-${Date.now()}`,
      companyId: activeCompanyId,
      entryNumber: entryNum,
      date: today,
      branchId: branchId || wh.branchId || 'br-01',
      referenceType: 'تسوية_مخزنية',
      referenceId: adjId,
      referenceNumber: adjNum,
      description: `قيد تسوية مخزنية يدوية (${item.nameAr}) - ${cleanReason}`,
      lines:
        diff > 0
          ? [
              {
                id: `jl-adj-1-${Date.now()}`,
                accountId: invAcc.id,
                accountCode: invAcc.code,
                accountName: invAcc.nameAr,
                debit: totalCostBase,
                credit: 0,
                currency: baseCur,
                exchangeRate: 1,
                memo: `زيادة مخزون: ${item.nameAr}`,
              },
              {
                id: `jl-adj-2-${Date.now()}`,
                accountId: surplusAcc.id,
                accountCode: surplusAcc.code,
                accountName: surplusAcc.nameAr,
                debit: 0,
                credit: totalCostBase,
                currency: baseCur,
                exchangeRate: 1,
                memo: cleanReason,
              },
            ]
          : [
              {
                id: `jl-adj-1-${Date.now()}`,
                accountId: shortageAcc.id,
                accountCode: shortageAcc.code,
                accountName: shortageAcc.nameAr,
                debit: totalCostBase,
                credit: 0,
                currency: baseCur,
                exchangeRate: 1,
                memo: cleanReason,
              },
              {
                id: `jl-adj-2-${Date.now()}`,
                accountId: invAcc.id,
                accountCode: invAcc.code,
                accountName: invAcc.nameAr,
                debit: 0,
                credit: totalCostBase,
                currency: baseCur,
                exchangeRate: 1,
                memo: `عجز مخزون: ${item.nameAr}`,
              },
            ],
      totalDebit: totalCostBase,
      totalCredit: totalCostBase,
      status: 'posted',
      createdBy: user.fullName,
      createdAt: new Date().toISOString(),
    };
  }

  const nextDb: ERPDatabase = {
    ...db,
    warehouseStock: updatedStocks.map((s) =>
      s.itemId === itemId && s.warehouseId === warehouseId && !s.companyId
        ? { ...s, companyId: activeCompanyId }
        : s
    ),
    stockCostLayers: updatedLayers,
    stockMovements: [
      ...db.stockMovements,
      {
        id: `sm-adj-${Date.now()}`,
        companyId: activeCompanyId,
        itemId,
        warehouseId,
        documentType: diff > 0 ? 'تسوية_زيادة' : 'تسوية_عجز',
        documentNumber: adjNum,
        documentId: adjId,
        movementDate: today,
        quantityChange: diff,
        unitCost: effectiveUnitCost,
        totalCost: totalCostBase,
        runningBalance: newBalance,
        notes: cleanReason,
        performedBy: user.fullName,
      },
    ],
    journalEntries: newJe ? [...db.journalEntries, newJe] : db.journalEntries,
    auditLogs: [
      makeAudit(db, user, {
        action: 'تعديل',
        module: 'المخزون',
        details: `تسوية مخزنية (${adjNum}) للصنف "${item.nameAr}" في "${wh.nameAr}" بمقدار (${diff > 0 ? `+${diff}` : diff})`,
        entityId: adjId,
        reason: cleanReason,
        beforeSnapshot: { quantityOnHand: prevQty },
        afterSnapshot: { quantityOnHand: newBalance, totalCostBase },
      }),
      ...db.auditLogs,
    ],
  };

  return { ok: true, nextDb, data: { adjustmentNumber: adjNum, totalCostBase } };
}

/**
 * 18. Atomic Fixed Asset Depreciation Transaction (company-scoped & multi-currency safe)
 */
export function runDepreciationTransaction(
  db: ERPDatabase,
  user: User,
  totalDepr: number,
  branchId: string,
  date?: string
): TransactionResult<JournalEntry> {
  const perm = assertPermission(user, 'accounting', 'post');
  if (!perm.ok) return { ok: false, error: perm.error };
  const activeCompanyId = db.activeCompanyId || db.company.id;
  const tenant = assertTenantAccess(user, activeCompanyId);
  if (!tenant.ok) return { ok: false, error: tenant.error };

  const today = date || new Date().toISOString().split('T')[0];
  const pCheck = isDateInOpenFiscalPeriod(today, db.fiscalPeriods, activeCompanyId, db.settings);
  if (!pCheck.allowed) return { ok: false, error: pCheck.error };

  if (!Number.isFinite(totalDepr) || totalDepr <= 0) {
    return { ok: false, error: 'لا توجد مبالغ إهلاك مستحقة لهذا الشهر.' };
  }

  const companyAccounts = getCompanyAccounts(db, activeCompanyId);
  const accExpense = resolveAccount(companyAccounts, ['5410', '541', '540'], 'مصروفات', ['إهلاك']);
  const accAccDepr = resolveAccount(companyAccounts, ['1290', '129', '123'], 'أصول', ['مجمع', 'إهلاك']);
  const baseCur = db.company.baseCurrency || 'YER';
  const entryNumber = generateNextDocNumber(
    `JV-${today.slice(0, 4)}-`,
    db.journalEntries.map((j) => j.entryNumber),
    4
  );

  const updatedAssets: FixedAsset[] = db.fixedAssets.map((a) => {
    const assetCompany = a.companyId || activeCompanyId;
    if (assetCompany !== activeCompanyId) return a;
    if (a.status !== 'active' || a.currentBookValue <= a.salvageValue) return a;
    const monthly = Math.min(
      a.currentBookValue - a.salvageValue,
      Math.round((a.purchaseCost - a.salvageValue) / (a.usefulLifeMonths || 48))
    );
    return {
      ...a,
      totalAccumulatedDepreciation: a.totalAccumulatedDepreciation + monthly,
      currentBookValue: Math.max(a.salvageValue, a.currentBookValue - monthly),
    };
  });

  const deprEntry: JournalEntry = {
    id: `je-depr-${Date.now()}`,
    companyId: activeCompanyId,
    entryNumber,
    date: today,
    branchId,
    referenceType: 'إهلاك',
    referenceNumber: `DEPR-${Date.now().toString().slice(-4)}`,
    description: 'قيد إهلاك الأصول الثابتة الدوري',
    lines: [
      {
        id: `jl-d1-${Date.now()}`,
        accountId: accExpense.id,
        accountCode: accExpense.code,
        accountName: accExpense.nameAr,
        debit: totalDepr,
        credit: 0,
        currency: baseCur,
        exchangeRate: 1,
        memo: 'مصروف إهلاك أصول',
      },
      {
        id: `jl-d2-${Date.now()}`,
        accountId: accAccDepr.id,
        accountCode: accAccDepr.code,
        accountName: accAccDepr.nameAr,
        debit: 0,
        credit: totalDepr,
        currency: baseCur,
        exchangeRate: 1,
        memo: 'مجمع إهلاك الأصول',
      },
    ],
    totalDebit: totalDepr,
    totalCredit: totalDepr,
    status: 'posted',
    createdBy: user.fullName,
    createdAt: new Date().toISOString(),
  };

  const nextDb: ERPDatabase = {
    ...db,
    fixedAssets: updatedAssets,
    journalEntries: [...db.journalEntries, deprEntry],
    auditLogs: [
      makeAudit(db, user, {
        action: 'ترحيل',
        module: 'المحاسبة',
        details: `تشغيل وترحيل قيد إهلاك الأصول الثابتة (${entryNumber}) بمبلغ ${totalDepr.toLocaleString()} ${baseCur}`,
        entityId: deprEntry.id,
        afterSnapshot: { entryNumber, totalDepr, currency: baseCur },
      }),
      ...db.auditLogs,
    ],
  };

  return { ok: true, nextDb, data: deprEntry };
}

/**
 * 19. Atomic Custom Book Entry Transaction (tenant-scoped, GL/Treasury/Subledger synced, audited)
 */
export function saveCustomBookEntryTransaction(
  db: ERPDatabase,
  user: User,
  branchId: string,
  entry: CustomLedgerEntry,
  options?: { syncVoucher?: boolean }
): TransactionResult<CustomLedgerEntry> {
  const perm = assertPermission(user, 'accounting', 'post');
  if (!perm.ok) return { ok: false, error: perm.error };
  const activeCompanyId = entry.companyId || db.activeCompanyId || db.company.id;
  const tenant = assertTenantAccess(user, activeCompanyId);
  if (!tenant.ok) return { ok: false, error: tenant.error };

  const pCheck = isDateInOpenFiscalPeriod(entry.date, db.fiscalPeriods, activeCompanyId, db.settings);
  if (!pCheck.allowed) return { ok: false, error: pCheck.error };

  const stampedEntry: CustomLedgerEntry = { ...entry, companyId: activeCompanyId };
  const existing = db.customBookEntries || [];
  const exists = existing.some((e) => e.id === stampedEntry.id);
  const updatedEntries = exists
    ? existing.map((e) => (e.id === stampedEntry.id ? stampedEntry : e))
    : [stampedEntry, ...existing];

  let updatedTreasuries = [...db.treasuryAccounts];
  let updatedCustomers = [...db.customers];
  let updatedVendors = [...db.vendors];
  const generatedVouchers: PaymentVoucher[] = [];
  const generatedJEs: JournalEntry[] = [];
  const runningJeNums = db.journalEntries.map((j) => j.entryNumber);
  const companyAccounts = getCompanyAccounts(db, activeCompanyId);
  const baseCur = db.company.baseCurrency || 'YER';

  if (!exists && stampedEntry.treasuryAccountId) {
    const tr = db.treasuryAccounts.find((t) => t.id === stampedEntry.treasuryAccountId);
    const trErr = verifyEntityCompany(tr, activeCompanyId, 'حساب الخزينة');
    if (trErr) return { ok: false, error: trErr };

    const totalVal = stampedEntry.rows.reduce(
      (s, r) => s + ((stampedEntry.direction === 'IN' ? r.debit : r.credit) || r.debit || r.credit || 0),
      0
    );
    if (tr && totalVal > 0) {
      updatedTreasuries = updatedTreasuries.map((t) => {
        if (t.id === stampedEntry.treasuryAccountId) {
          const trRate = getRate(db, t.currency);
          const delta = totalVal / trRate;
          return {
            ...t,
            balance: stampedEntry.direction === 'IN' ? t.balance + delta : t.balance - delta,
          };
        }
        return t;
      });

      if (options?.syncVoucher !== false) {
        const batchId = `cbook-${stampedEntry.id}`;
        const vType: PaymentVoucher['type'] = stampedEntry.direction === 'IN' ? 'قبض' : 'صرف';
        stampedEntry.rows.forEach((r, idx) => {
          const rowAmt = (stampedEntry.direction === 'IN' ? r.debit : r.credit) || r.debit || r.credit || 0;
          if (rowAmt <= 0) return;
          const curCode = r.currency || baseCur;
          const rate = getRate(db, curCode);
          const baseAmt = rowAmt * rate;
          const pName = (r.partyName || '').trim();
          const matchedCust = db.customers.find(
            (c) => (!c.companyId || c.companyId === activeCompanyId) && c.nameAr.trim() === pName
          );
          const matchedVend = !matchedCust
            ? db.vendors.find(
                (v) => (!v.companyId || v.companyId === activeCompanyId) && v.nameAr.trim() === pName
              )
            : undefined;
          const matchedExpCat =
            !matchedCust && !matchedVend
              ? db.expenseCategories.find(
                  (ec) => (!ec.companyId || ec.companyId === activeCompanyId) && ec.nameAr.trim() === pName
                )
              : undefined;
          const matchedAcc =
            !matchedCust && !matchedVend && !matchedExpCat
              ? companyAccounts.find((a) => a.isLeaf && a.nameAr.trim() === pName)
              : undefined;

          const entityType: PaymentVoucher['entityType'] = matchedCust
            ? 'عميل'
            : matchedVend
            ? 'مورد'
            : stampedEntry.direction === 'OUT'
            ? 'مصروف'
            : 'إيراد';
          const entityId =
            matchedCust?.id ||
            matchedVend?.id ||
            matchedExpCat?.ledgerAccountId ||
            matchedAcc?.id;

          const voucher: PaymentVoucher = {
            id: `vch-cb-${stampedEntry.id}-${idx}`,
            companyId: activeCompanyId,
            voucherNumber:
              stampedEntry.rows.length > 1 ? `${stampedEntry.entryNumber}-${idx + 1}` : stampedEntry.entryNumber,
            batchId,
            type: vType,
            date: stampedEntry.date,
            branchId,
            treasuryAccountId: tr.id,
            treasuryAccountName: tr.nameAr,
            entityType,
            entityId,
            entityName: pName || stampedEntry.treasuryAccountName || 'دفتر يومي',
            amount: rowAmt,
            currency: curCode,
            exchangeRate: rate,
            baseAmount: baseAmt,
            paymentMethod: 'نقداً',
            statement: r.statement || stampedEntry.notes || `قيد دفتر ${stampedEntry.entryNumber}`,
            status: 'posted',
            receivedOrPaidBy: user.fullName,
            createdBy: user.fullName,
            createdAt: new Date().toISOString(),
          };
          const je = createVoucherJournalEntry(voucher, companyAccounts, user.fullName, runningJeNums);
          je.companyId = activeCompanyId;
          runningJeNums.push(je.entryNumber);
          generatedJEs.push(je);
          generatedVouchers.push({ ...voucher, journalEntryId: je.id });

          if (matchedCust) {
            updatedCustomers = updatedCustomers.map((c) =>
              c.id === matchedCust.id
                ? { ...c, currentBalance: vType === 'قبض' ? c.currentBalance - baseAmt : c.currentBalance + baseAmt }
                : c
            );
          } else if (matchedVend) {
            updatedVendors = updatedVendors.map((v) =>
              v.id === matchedVend.id
                ? { ...v, currentBalance: vType === 'صرف' ? v.currentBalance - baseAmt : v.currentBalance + baseAmt }
                : v
            );
          }
        });
      }
    }
  }

  const nextDb: ERPDatabase = {
    ...db,
    customBookEntries: updatedEntries,
    treasuryAccounts: updatedTreasuries,
    customers: updatedCustomers,
    vendors: updatedVendors,
    paymentVouchers: generatedVouchers.length > 0 ? [...db.paymentVouchers, ...generatedVouchers] : db.paymentVouchers,
    journalEntries: generatedJEs.length > 0 ? [...db.journalEntries, ...generatedJEs] : db.journalEntries,
    auditLogs: [
      makeAudit(db, user, {
        action: exists ? 'تعديل' : 'إنشاء',
        module: 'المحاسبة',
        details: `${exists ? 'تحديث' : 'حفظ وترحيل'} قيد دفتر مخصص (${stampedEntry.entryNumber})`,
        entityId: stampedEntry.id,
        afterSnapshot: {
          entryNumber: stampedEntry.entryNumber,
          generatedVouchers: generatedVouchers.length,
          generatedJEs: generatedJEs.length,
        },
      }),
      ...db.auditLogs,
    ],
  };

  return { ok: true, nextDb, data: stampedEntry };
}

/**
 * 20. Governance Audit Transactions (Approval Rules, Fiscal Periods, User Permissions)
 */
export function updateApprovalRuleTransaction(
  db: ERPDatabase,
  user: User,
  ruleId: string,
  patch: Partial<ApprovalWorkflowRule>
): TransactionResult<ApprovalWorkflowRule> {
  if (!user.canManageSettings && user.role !== 'المدير المالي' && user.role !== 'مدير النظام' && user.role !== 'مالك المؤسسة' && user.role !== 'Tenant Admin') {
    return { ok: false, error: 'عذراً، لا تملك صلاحية تعديل قواعد الاعتماد.' };
  }
  const targetRule = (db.approvalRules || []).find((r) => r.id === ruleId);
  if (!targetRule) return { ok: false, error: 'قاعدة الاعتماد غير موجودة.' };

  const activeCompanyId = targetRule.companyId || db.activeCompanyId || db.company.id;
  const tenant = assertTenantAccess(user, activeCompanyId);
  if (!tenant.ok) return { ok: false, error: tenant.error };

  const updatedRule = { ...targetRule, ...patch };
  const nextDb: ERPDatabase = {
    ...db,
    approvalRules: (db.approvalRules || []).map((r) => (r.id === ruleId ? updatedRule : r)),
    auditLogs: [
      makeAudit(db, user, {
        action: 'تعديل',
        module: 'النظام',
        details: `تحديث قاعدة الاعتماد "${targetRule.nameAr}"`,
        entityId: ruleId,
        beforeSnapshot: {
          enabled: targetRule.enabled,
          minAmountThreshold: targetRule.minAmountThreshold,
          requiredLevels: targetRule.requiredLevels,
        },
        afterSnapshot: {
          enabled: updatedRule.enabled,
          minAmountThreshold: updatedRule.minAmountThreshold,
          requiredLevels: updatedRule.requiredLevels,
        },
      }),
      ...db.auditLogs,
    ],
  };
  return { ok: true, nextDb, data: updatedRule };
}

export function toggleFiscalPeriodTransaction(
  db: ERPDatabase,
  user: User,
  periodId: string
): TransactionResult<FiscalPeriod> {
  if (!user.canManageSettings && user.role !== 'المدير المالي' && user.role !== 'مدير النظام' && user.role !== 'مالك المؤسسة' && user.role !== 'Tenant Admin') {
    return { ok: false, error: 'فقط المدير المالي أو مدير النظام يمكنه فتح/إغلاق الفترات المالية.' };
  }
  const period = (db.fiscalPeriods || []).find((fp) => fp.id === periodId);
  if (!period) return { ok: false, error: 'الفترة المالية غير موجودة.' };

  const activeCompanyId = period.companyId || db.activeCompanyId || db.company.id;
  const tenant = assertTenantAccess(user, activeCompanyId);
  if (!tenant.ok) return { ok: false, error: tenant.error };

  const nextStatus: FiscalPeriod['status'] = period.status === 'open' ? 'closed' : 'open';
  const updatedPeriod: FiscalPeriod = { ...period, status: nextStatus };

  const nextDb: ERPDatabase = {
    ...db,
    fiscalPeriods: (db.fiscalPeriods || []).map((fp) => (fp.id === periodId ? updatedPeriod : fp)),
    auditLogs: [
      makeAudit(db, user, {
        action: nextStatus === 'closed' ? 'إقفال' : 'تعديل',
        module: 'المحاسبة',
        details: `تغيير حالة الفترة المحاسبية (${period.periodName}) من (${period.status}) إلى (${nextStatus})`,
        entityId: period.id,
        beforeSnapshot: { status: period.status },
        afterSnapshot: { status: nextStatus },
      }),
      ...db.auditLogs,
    ],
  };
  return { ok: true, nextDb, data: updatedPeriod };
}

export function updateUserPermissionsTransaction(
  db: ERPDatabase,
  actor: User,
  updatedUser: User
): TransactionResult<User> {
  if (!actor.active) {
    return { ok: false, error: 'هذا الحساب موقوف إدارياً ولا يملك صلاحية التنفيذ.' };
  }
  if (
    !actor.canManageSettings &&
    actor.role !== 'مدير النظام' &&
    actor.role !== 'مالك المؤسسة' &&
    actor.role !== 'Tenant Admin'
  ) {
    return { ok: false, error: 'عذراً، لا تملك صلاحية تعديل صلاحيات المستخدمين.' };
  }
  if (updatedUser.isSuperAdmin && !actor.isSuperAdmin) {
    return { ok: false, error: 'صلاحية مرفوضة: مدير المنشأة لا يملك صلاحية منح صفة Super Admin.' };
  }
  const activeCompanyId = db.activeCompanyId || db.company.id;
  const tenantCheck = assertTenantAccess(actor, activeCompanyId);
  if (!tenantCheck.ok) return { ok: false, error: tenantCheck.error };

  const existing = db.users.find((u) => u.id === updatedUser.id);
  if (!existing) return { ok: false, error: 'المستخدم غير موجود.' };

  const actorAllowed = new Set(
    (actor.allowedCompanyIds || []).map((c) => String(c).trim()).filter(Boolean)
  );
  const existingAllowed = (existing.allowedCompanyIds || []).map((c) => String(c).trim()).filter(Boolean);
  if (existingAllowed.length > 0 && !existingAllowed.some((cid) => actorAllowed.has(cid))) {
    return { ok: false, error: 'عزل المنشآت: لا تملك صلاحية تعديل مستخدم لا ينتمي إلى منشآتك المصرح بها.' };
  }
  const nextAllowed = Array.isArray(updatedUser.allowedCompanyIds)
    ? updatedUser.allowedCompanyIds.map((c) => String(c).trim()).filter(Boolean)
    : existingAllowed;
  const newlyAddedCompanies = nextAllowed.filter((cid) => !existingAllowed.includes(cid));
  if (newlyAddedCompanies.some((cid) => !actorAllowed.has(cid))) {
    return { ok: false, error: 'عزل المنشآت: لا يمكنك منح صلاحية الوصول لمنشأة لا تملك صلاحيتها.' };
  }

  const sanitizeForAudit = (u: User) => ({
    id: u.id,
    username: u.username,
    role: u.role,
    active: u.active,
    canManageSettings: u.canManageSettings,
    canPostEntries: u.canPostEntries,
    canAdjustInventory: u.canAdjustInventory,
    allowedCompanyIds: u.allowedCompanyIds,
  });

  const nextDb: ERPDatabase = {
    ...db,
    users: db.users.map((u) => (u.id === updatedUser.id ? updatedUser : u)),
    auditLogs: [
      makeAudit(db, actor, {
        action: 'تعديل',
        module: 'النظام',
        details: `تعديل صلاحيات/حالة المستخدم (${updatedUser.fullName})`,
        entityId: updatedUser.id,
        beforeSnapshot: sanitizeForAudit(existing),
        afterSnapshot: sanitizeForAudit(updatedUser),
      }),
      ...db.auditLogs,
    ],
  };
  return { ok: true, nextDb, data: updatedUser };
}

export function addUserTransaction(
  db: ERPDatabase,
  actor: User,
  newUser: User
): TransactionResult<User> {
  if (!actor.active) {
    return { ok: false, error: 'هذا الحساب موقوف إدارياً ولا يملك صلاحية التنفيذ.' };
  }
  if (
    !actor.canManageSettings &&
    actor.role !== 'مدير النظام' &&
    actor.role !== 'مالك المؤسسة' &&
    actor.role !== 'Tenant Admin'
  ) {
    return { ok: false, error: 'عذراً، لا تملك صلاحية إضافة مستخدمين.' };
  }
  if (newUser.isSuperAdmin && !actor.isSuperAdmin) {
    return { ok: false, error: 'صلاحية مرفوضة: مدير المنشأة لا يملك صلاحية إنشاء حساب Super Admin.' };
  }
  const activeCompanyId = db.activeCompanyId || db.company.id;
  const tenantCheck = assertTenantAccess(actor, activeCompanyId);
  if (!tenantCheck.ok) return { ok: false, error: tenantCheck.error };

  const actorAllowed = new Set(
    (actor.allowedCompanyIds || []).map((c) => String(c).trim()).filter(Boolean)
  );
  const requestedCompanies = Array.isArray(newUser.allowedCompanyIds)
    ? newUser.allowedCompanyIds.map((c) => String(c).trim()).filter(Boolean)
    : [];
  if (requestedCompanies.some((cid) => !actorAllowed.has(cid))) {
    return { ok: false, error: 'عزل المنشآت: لا يمكنك إسناد المستخدم الجديد لمنشأة لا تملك صلاحيتها.' };
  }
  if (db.users.some((u) => u.username.toLowerCase() === newUser.username.toLowerCase())) {
    return { ok: false, error: 'اسم المستخدم مسجل مسبقاً.' };
  }

  const nextDb: ERPDatabase = {
    ...db,
    users: [...db.users, newUser],
    auditLogs: [
      makeAudit(db, actor, {
        action: 'إنشاء',
        module: 'النظام',
        details: `إضافة مستخدم جديد (${newUser.fullName} - ${newUser.role})`,
        entityId: newUser.id,
        afterSnapshot: {
          id: newUser.id,
          username: newUser.username,
          role: newUser.role,
          allowedCompanyIds: newUser.allowedCompanyIds,
        },
      }),
      ...db.auditLogs,
    ],
  };
  return { ok: true, nextDb, data: newUser };
}
