/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Stage P0-C Audit Tests: Accounting & Inventory Precision
 * Covers FIFO COGS rounding sync, Purchase Input VAT 1165 separation, Sales/Purchase Returns,
 * Purchase cancel FIFO layer lock, Voucher allocation persistence + cancel rollback,
 * Multi-company FIFO/WA valuation scan, and Non-YER base currency posting.
 */

import { describe, it, expect } from 'vitest';
import { getInitialDatabase, migrateDatabase } from '../src/services/storageService';
import {
  postSalesInvoiceTransaction,
  postPurchaseInvoiceTransaction,
  cancelInvoiceTransaction,
  postVouchersBatchTransaction,
  cancelVoucherTransaction,
  executeYearEndClosingTransaction,
  approveStocktakingTransaction,
} from '../src/services/erpTransactionService';
import { runFinancialIntegrityScan } from '../src/services/financialIntegrityService';
import { calculateInventoryValuationComparison } from '../src/services/inventoryEngine';
import { Invoice, PaymentVoucher, PhysicalStocktaking } from '../src/types/erp';

function buildCleanBaseDb() {
  return getInitialDatabase();
}

describe('P0-C Accounting & Inventory Precision', () => {
  it('1. Separates Purchase Input VAT (1165) from Inventory (115) while keeping JE balanced', () => {
    const db = buildCleanBaseDb();
    const admin = db.users[0];
    const taxAcc1165 = db.chartOfAccounts.find((a) => a.code === '1165');
    expect(taxAcc1165).toBeTruthy();

    const purInv: Invoice = {
      id: 'inv-pur-vat-1',
      companyId: 'comp-01',
      invoiceNumber: 'PUR-VAT-001',
      type: 'مشتريات',
      paymentType: 'آجل',
      date: '2026-03-01',
      branchId: 'br-01',
      warehouseId: 'wh-01',
      entityId: 'vend-01',
      entityName: 'شركة الشروق',
      currency: 'YER',
      exchangeRate: 1,
      items: [
        {
          id: 'line-1',
          itemId: 'item-01',
          itemName: 'لابتوب ديل',
          itemBarcode: '629104000101',
          unit: 'حبة',
          quantity: 10,
          unitPrice: 1000,
          discountPercentage: 0,
          discountAmount: 0,
          subtotal: 10000,
          taxPercentage: 15,
          taxAmount: 1500,
          total: 11500,
          unitCost: 1000,
        },
      ],
      subtotal: 10000,
      discountTotal: 0,
      taxTotal: 1500,
      grandTotal: 11500,
      paidAmount: 0,
      remainingAmount: 11500,
      status: 'draft',
      createdBy: admin.fullName,
      createdAt: new Date().toISOString(),
    };

    const res = postPurchaseInvoiceTransaction(db, admin, purInv);
    expect(res.ok).toBe(true);
    const postedJe = res.nextDb!.journalEntries.find((j) => j.referenceId === purInv.id);
    expect(postedJe).toBeTruthy();
    expect(postedJe!.totalDebit).toBe(11500);
    expect(postedJe!.totalCredit).toBe(11500);

    const invLine = postedJe!.lines.find((l) => l.accountCode === '115');
    const vatLine = postedJe!.lines.find((l) => l.accountCode === '1165');
    const apLine = postedJe!.lines.find((l) => l.accountCode === '2110');
    expect(invLine?.debit).toBe(10000);
    expect(vatLine?.debit).toBe(1500);
    expect(apLine?.credit).toBe(11500);
  });

  it('2. Syncs exact FIFO consumed COGS to GL & StockMovements without unit-rounding drift', () => {
    const db = buildCleanBaseDb();
    const admin = db.users[0];
    // Configure item-02 as FIFO in isolated warehouse wh-01 with known fractional layers:
    // Layer 1: qty 2 @ 100 = 200; Layer 2: qty 1 @ 101 = 101 -> selling 3 qty = total 301 (weighted unit 100.33 * 3 = 300.99!)
    const seededDb = {
      ...db,
      company: { ...db.company, valuationPolicy: 'FIFO' as const },
      inventoryItems: db.inventoryItems.map((it) =>
        it.id === 'item-02' ? { ...it, valuationMethod: 'FIFO' as const } : it
      ),
      warehouseStock: db.warehouseStock.map((ws) =>
        ws.itemId === 'item-02' && ws.warehouseId === 'wh-01'
          ? { ...ws, quantityOnHand: 3, averageCost: 100.33 }
          : ws
      ),
      stockCostLayers: [
        ...(db.stockCostLayers || []).filter((l) => !(l.itemId === 'item-02' && l.warehouseId === 'wh-01')),
        {
          id: 'layer-fifo-exact-1',
          companyId: 'comp-01',
          itemId: 'item-02',
          warehouseId: 'wh-01',
          receivedDate: '2026-01-01',
          sourceDocType: 'رصيد_افتتاحي',
          sourceDocId: 'open-1',
          sourceDocNumber: 'OP-1',
          originalQuantity: 2,
          remainingQuantity: 2,
          unitCost: 100,
        },
        {
          id: 'layer-fifo-exact-2',
          companyId: 'comp-01',
          itemId: 'item-02',
          warehouseId: 'wh-01',
          receivedDate: '2026-01-02',
          sourceDocType: 'فاتورة_مشتريات',
          sourceDocId: 'pur-2',
          sourceDocNumber: 'PUR-2',
          originalQuantity: 1,
          remainingQuantity: 1,
          unitCost: 101,
        },
      ],
    };

    const saleInv: Invoice = {
      id: 'inv-fifo-exact',
      companyId: 'comp-01',
      invoiceNumber: 'INV-FIFO-1',
      type: 'مبيعات',
      paymentType: 'آجل',
      date: '2026-03-05',
      branchId: 'br-01',
      warehouseId: 'wh-01',
      entityId: 'cust-01',
      entityName: 'عميل الاختبار',
      currency: 'YER',
      exchangeRate: 1,
      items: [
        {
          id: 'l-1',
          itemId: 'item-02',
          itemName: 'طابعة إبسون',
          itemBarcode: '629104000102',
          unit: 'حبة',
          quantity: 3,
          unitPrice: 200,
          discountPercentage: 0,
          discountAmount: 0,
          subtotal: 600,
          taxPercentage: 0,
          taxAmount: 0,
          total: 600,
          unitCost: 100,
        },
      ],
      subtotal: 600,
      discountTotal: 0,
      taxTotal: 0,
      grandTotal: 600,
      paidAmount: 0,
      remainingAmount: 600,
      status: 'draft',
      createdBy: admin.fullName,
      createdAt: new Date().toISOString(),
    };

    const res = postSalesInvoiceTransaction(seededDb, admin, saleInv);
    expect(res.ok).toBe(true);
    const movement = res.nextDb!.stockMovements.find((m) => m.documentId === 'inv-fifo-exact');
    expect(movement?.totalCost).toBe(301);

    const je = res.nextDb!.journalEntries.find((j) => j.referenceId === 'inv-fifo-exact');
    const cogsLine = je?.lines.find((l) => l.accountCode === '5110');
    const invLine = je?.lines.find((l) => l.accountCode === '115');
    expect(cogsLine?.debit).toBe(301);
    expect(invLine?.credit).toBe(301);
    expect(je?.totalDebit).toBe(je?.totalCredit);
  });

  it('3. Properly reverses Sales Return (مرتجع_مبيعات) and Purchase Return (مرتجع_مشتريات) across GL, stock, and balances', () => {
    const db = buildCleanBaseDb();
    const admin = db.users[0];
    const startCustBal = db.customers.find((c) => c.id === 'cust-01')!.currentBalance;
    const startVendBal = db.vendors.find((v) => v.id === 'vend-01')!.currentBalance;
    const startQty = db.warehouseStock.find((s) => s.itemId === 'item-01' && s.warehouseId === 'wh-01')!.quantityOnHand;

    const salesRet: Invoice = {
      id: 'inv-sret-1',
      companyId: 'comp-01',
      invoiceNumber: 'SRET-001',
      type: 'مرتجع_مبيعات',
      paymentType: 'آجل',
      date: '2026-03-06',
      branchId: 'br-01',
      warehouseId: 'wh-01',
      entityId: 'cust-01',
      entityName: 'شركة المجد',
      currency: 'YER',
      exchangeRate: 1,
      items: [
        {
          id: 'sr-1',
          itemId: 'item-01',
          itemName: 'لابتوب ديل',
          itemBarcode: '629104000101',
          unit: 'حبة',
          quantity: 2,
          unitPrice: 475000,
          discountPercentage: 0,
          discountAmount: 0,
          subtotal: 950000,
          taxPercentage: 5,
          taxAmount: 47500,
          total: 997500,
          unitCost: 380000,
        },
      ],
      subtotal: 950000,
      discountTotal: 0,
      taxTotal: 47500,
      grandTotal: 997500,
      paidAmount: 0,
      remainingAmount: 997500,
      status: 'draft',
      createdBy: admin.fullName,
      createdAt: new Date().toISOString(),
    };

    const sretRes = postSalesInvoiceTransaction(db, admin, salesRet);
    expect(sretRes.ok).toBe(true);
    expect(sretRes.nextDb!.customers.find((c) => c.id === 'cust-01')!.currentBalance).toBe(startCustBal - 997500);
    expect(
      sretRes.nextDb!.warehouseStock.find((s) => s.itemId === 'item-01' && s.warehouseId === 'wh-01')!.quantityOnHand
    ).toBe(startQty + 2);

    const sretJe = sretRes.nextDb!.journalEntries.find((j) => j.referenceId === 'inv-sret-1')!;
    expect(sretJe.referenceType).toBe('مرتجع');
    expect(sretJe.lines.find((l) => l.accountCode === '4110')?.debit).toBe(950000);
    expect(sretJe.lines.find((l) => l.accountCode === '2120')?.debit).toBe(47500);
    expect(sretJe.lines.find((l) => l.accountCode === '114')?.credit).toBe(997500);
    expect(sretJe.lines.find((l) => l.accountCode === '115')?.debit).toBe(760000);
    expect(sretJe.lines.find((l) => l.accountCode === '5110')?.credit).toBe(760000);
    expect(sretJe.totalDebit).toBe(sretJe.totalCredit);

    const purRet: Invoice = {
      id: 'inv-pret-1',
      companyId: 'comp-01',
      invoiceNumber: 'PRET-001',
      type: 'مرتجع_مشتريات',
      paymentType: 'آجل',
      date: '2026-03-07',
      branchId: 'br-01',
      warehouseId: 'wh-01',
      entityId: 'vend-01',
      entityName: 'شركة الشروق',
      currency: 'YER',
      exchangeRate: 1,
      items: [
        {
          id: 'pr-1',
          itemId: 'item-01',
          itemName: 'لابتوب ديل',
          itemBarcode: '629104000101',
          unit: 'حبة',
          quantity: 1,
          unitPrice: 380000,
          discountPercentage: 0,
          discountAmount: 0,
          subtotal: 380000,
          taxPercentage: 5,
          taxAmount: 19000,
          total: 399000,
          unitCost: 380000,
        },
      ],
      subtotal: 380000,
      discountTotal: 0,
      taxTotal: 19000,
      grandTotal: 399000,
      paidAmount: 0,
      remainingAmount: 399000,
      status: 'draft',
      createdBy: admin.fullName,
      createdAt: new Date().toISOString(),
    };

    const pretRes = postPurchaseInvoiceTransaction(sretRes.nextDb!, admin, purRet);
    expect(pretRes.ok).toBe(true);
    expect(pretRes.nextDb!.vendors.find((v) => v.id === 'vend-01')!.currentBalance).toBe(startVendBal - 399000);
    expect(
      pretRes.nextDb!.warehouseStock.find((s) => s.itemId === 'item-01' && s.warehouseId === 'wh-01')!.quantityOnHand
    ).toBe(startQty + 1);

    const pretJe = pretRes.nextDb!.journalEntries.find((j) => j.referenceId === 'inv-pret-1')!;
    expect(pretJe.lines.find((l) => l.accountCode === '2110')?.debit).toBe(399000);
    expect(pretJe.lines.find((l) => l.accountCode === '115')?.credit).toBe(380000);
    expect(pretJe.lines.find((l) => l.accountCode === '1165')?.credit).toBe(19000);
    expect(pretJe.totalDebit).toBe(pretJe.totalCredit);
  });

  it('4. Blocks cancelling a Purchase Invoice if any portion of its FIFO layers was consumed, and cleans unconsumed layers on valid cancel', () => {
    const db = buildCleanBaseDb();
    const admin = db.users[0];
    const fifoDb = {
      ...db,
      company: { ...db.company, valuationPolicy: 'FIFO' as const },
      inventoryItems: db.inventoryItems.map((it) =>
        it.id === 'item-04' ? { ...it, valuationMethod: 'FIFO' as const } : it
      ),
      warehouseStock: db.warehouseStock.map((ws) =>
        ws.itemId === 'item-04' && ws.warehouseId === 'wh-01' ? { ...ws, quantityOnHand: 0 } : ws
      ),
      stockCostLayers: (db.stockCostLayers || []).filter((l) => !(l.itemId === 'item-04' && l.warehouseId === 'wh-01')),
    };

    const purInv: Invoice = {
      id: 'inv-pur-lock-1',
      companyId: 'comp-01',
      invoiceNumber: 'PUR-LOCK-1',
      type: 'مشتريات',
      paymentType: 'آجل',
      date: '2026-03-08',
      branchId: 'br-01',
      warehouseId: 'wh-01',
      entityId: 'vend-01',
      entityName: 'المورد',
      currency: 'YER',
      exchangeRate: 1,
      items: [
        {
          id: 'pl-1',
          itemId: 'item-04',
          itemName: 'قارئ باركود',
          itemBarcode: '629104000104',
          unit: 'حبة',
          quantity: 5,
          unitPrice: 28000,
          discountPercentage: 0,
          discountAmount: 0,
          subtotal: 140000,
          taxPercentage: 0,
          taxAmount: 0,
          total: 140000,
          unitCost: 28000,
        },
      ],
      subtotal: 140000,
      discountTotal: 0,
      taxTotal: 0,
      grandTotal: 140000,
      paidAmount: 0,
      remainingAmount: 140000,
      status: 'draft',
      createdBy: admin.fullName,
      createdAt: new Date().toISOString(),
    };

    const pRes = postPurchaseInvoiceTransaction(fifoDb, admin, purInv);
    expect(pRes.ok).toBe(true);

    // Unconsumed cancellation succeeds and removes created FIFO layer
    const cleanCancel = cancelInvoiceTransaction(pRes.nextDb!, admin, purInv.id, 'خطأ إدخال');
    expect(cleanCancel.ok).toBe(true);
    expect((cleanCancel.nextDb!.stockCostLayers || []).some((l) => l.sourceDocId === purInv.id)).toBe(false);

    // Now sell 1 unit from that purchase -> must block cancelling purchase invoice
    const sell1: Invoice = {
      id: 'inv-sale-lock-1',
      companyId: 'comp-01',
      invoiceNumber: 'SALE-LOCK-1',
      type: 'مبيعات',
      paymentType: 'نقدي',
      treasuryAccountId: 'tr-01',
      date: '2026-03-09',
      branchId: 'br-01',
      warehouseId: 'wh-01',
      entityId: 'cust-01',
      entityName: 'عميل',
      currency: 'YER',
      exchangeRate: 1,
      items: [
        {
          id: 'sl-1',
          itemId: 'item-04',
          itemName: 'قارئ باركود',
          itemBarcode: '629104000104',
          unit: 'حبة',
          quantity: 1,
          unitPrice: 40000,
          discountPercentage: 0,
          discountAmount: 0,
          subtotal: 40000,
          taxPercentage: 0,
          taxAmount: 0,
          total: 40000,
          unitCost: 28000,
        },
      ],
      subtotal: 40000,
      discountTotal: 0,
      taxTotal: 0,
      grandTotal: 40000,
      paidAmount: 40000,
      remainingAmount: 0,
      status: 'draft',
      createdBy: admin.fullName,
      createdAt: new Date().toISOString(),
    };
    const sRes = postSalesInvoiceTransaction(pRes.nextDb!, admin, sell1);
    expect(sRes.ok).toBe(true);

    const blockedCancel = cancelInvoiceTransaction(sRes.nextDb!, admin, purInv.id, 'محاولة إلغاء');
    expect(blockedCancel.ok).toBe(false);
    expect(blockedCancel.error).toContain('FIFO');
  });

  it('5. Persists Voucher linkedAllocations on batch post and rolls back Invoice paidAmount/status on voucher cancel', () => {
    const db = buildCleanBaseDb();
    const admin = db.users[0];
    const targetInv = db.invoices.find((i) => i.id === 'inv-01')!;
    const initialPaid = targetInv.paidAmount;
    const initialRemaining = targetInv.remainingAmount;

    const voucher: PaymentVoucher = {
      id: 'pv-alloc-test-1',
      companyId: 'comp-01',
      voucherNumber: 'RV-ALLOC-001',
      type: 'قبض',
      date: '2026-03-10',
      branchId: 'br-01',
      treasuryAccountId: 'tr-01',
      treasuryAccountName: 'صندوق رئيسي',
      entityType: 'عميل',
      entityId: 'cust-01',
      entityName: 'شركة المجد',
      amount: initialRemaining,
      currency: 'YER',
      exchangeRate: 1,
      baseAmount: initialRemaining,
      linkedInvoiceIds: ['inv-01'],
      paymentMethod: 'نقداً',
      statement: 'سداد كامل الفاتورة',
      status: 'posted',
      receivedOrPaidBy: 'المحصل',
      createdBy: admin.fullName,
      createdAt: new Date().toISOString(),
    };

    const postRes = postVouchersBatchTransaction(db, admin, [voucher], { idempotencyKey: 'idem-v-alloc-1' });
    expect(postRes.ok).toBe(true);
    const savedVoucher = postRes.nextDb!.paymentVouchers.find((v) => v.id === 'pv-alloc-test-1')!;
    expect(savedVoucher.linkedAllocations).toHaveLength(1);
    expect(savedVoucher.linkedAllocations![0].invoiceId).toBe('inv-01');
    expect(savedVoucher.linkedAllocations![0].settledAmountNative).toBe(initialRemaining);

    const settledInv = postRes.nextDb!.invoices.find((i) => i.id === 'inv-01')!;
    expect(settledInv.status).toBe('paid');
    expect(settledInv.remainingAmount).toBe(0);

    // Cancel voucher -> invoice remainingAmount and status must restore cleanly
    const cancelRes = cancelVoucherTransaction(postRes.nextDb!, admin, 'pv-alloc-test-1', 'إلغاء سند سداد');
    expect(cancelRes.ok).toBe(true);
    const restoredInv = cancelRes.nextDb!.invoices.find((i) => i.id === 'inv-01')!;
    expect(restoredInv.paidAmount).toBe(initialPaid);
    expect(restoredInv.remainingAmount).toBe(initialRemaining);
    expect(restoredInv.status).toBe('posted');
  });

  it('6. Evaluates company-scoped FIFO/WA inventory valuation and non-YER base currency postings cleanly', () => {
    const baseDb = buildCleanBaseDb();
    const admin = baseDb.users[0];

    // Configure SAR Company 2 with distinct FIFO layers & ensure Company 1 data does not bleed into scan
    const comp2Db = migrateDatabase({
      ...baseDb,
      activeCompanyId: 'comp-sa',
      company: {
        ...baseDb.company,
        id: 'comp-sa',
        nameAr: 'شركة المنصور السعودية',
        countryCode: 'SA',
        baseCurrency: 'SAR',
        valuationPolicy: 'FIFO',
      },
      companies: [
        baseDb.company,
        {
          id: 'comp-sa',
          nameAr: 'شركة المنصور السعودية',
          nameEn: 'Almansoor KSA',
          commercialRecord: '101010',
          taxNumber: '3000000001',
          phone: '',
          email: '',
          address: 'الرياض',
          baseCurrency: 'SAR',
          countryCode: 'SA',
          valuationPolicy: 'FIFO',
        },
      ],
      currencies: [
        { code: 'SAR', nameAr: 'ريال سعودي', symbol: 'ر.س', exchangeRate: 1, isBase: true, decimalPlaces: 2 },
        { code: 'USD', nameAr: 'دولار', symbol: '$', exchangeRate: 3.75, isBase: false, decimalPlaces: 2 },
      ],
      warehouses: [
        ...baseDb.warehouses,
        { id: 'wh-sa', companyId: 'comp-sa', branchId: 'br-sa', code: 'WH-SA', nameAr: 'مستودع الرياض', location: 'الرياض', keeperName: 'سالم', status: 'active' },
      ],
      inventoryItems: [
        ...baseDb.inventoryItems,
        {
          id: 'item-sa-1',
          companyId: 'comp-sa',
          code: 'SA-1',
          barcode: '999001',
          nameAr: 'صنف سعودي',
          category: 'عام',
          baseUnit: 'حبة',
          purchasePrice: 50,
          salePrice: 80,
          wholesalePrice: 70,
          minSalePrice: 60,
          minQuantityAlert: 1,
          maxQuantity: 100,
          valuationMethod: 'FIFO',
          taxRate: 0.15,
          status: 'active',
          createdAt: '2026-01-01',
        },
      ],
      warehouseStock: [
        ...baseDb.warehouseStock,
        { companyId: 'comp-sa', itemId: 'item-sa-1', warehouseId: 'wh-sa', quantityOnHand: 4, averageCost: 55 },
      ],
      stockCostLayers: [
        ...(baseDb.stockCostLayers || []),
        {
          id: 'l-sa-1',
          companyId: 'comp-sa',
          itemId: 'item-sa-1',
          warehouseId: 'wh-sa',
          receivedDate: '2026-01-01',
          sourceDocType: 'فاتورة_مشتريات',
          sourceDocId: 'p-sa-1',
          sourceDocNumber: 'PSA-1',
          originalQuantity: 2,
          remainingQuantity: 2,
          unitCost: 50,
        },
        {
          id: 'l-sa-2',
          companyId: 'comp-sa',
          itemId: 'item-sa-1',
          warehouseId: 'wh-sa',
          receivedDate: '2026-01-02',
          sourceDocType: 'فاتورة_مشتريات',
          sourceDocId: 'p-sa-2',
          sourceDocNumber: 'PSA-2',
          originalQuantity: 2,
          remainingQuantity: 2,
          unitCost: 60,
        },
      ],
      chartOfAccounts: [
        ...baseDb.chartOfAccounts,
        ...baseDb.chartOfAccounts.map((a) => ({
          ...a,
          id: `${a.id}-comp-sa`,
          companyId: 'comp-sa',
        })),
      ],
      fiscalPeriods: [
        ...(baseDb.fiscalPeriods || []),
        {
          id: 'fp-comp-sa-2026',
          companyId: 'comp-sa',
          fiscalYear: '2026',
          periodName: 'السنة المالية 2026',
          startDate: '2026-01-01',
          endDate: '2026-12-31',
          status: 'open',
        },
      ],
      users: baseDb.users.map((u) => ({ ...u, allowedCompanyIds: ['comp-01', 'comp-sa'] })),
    });
    const comp2Admin = comp2Db.users[0];

    // Valuation check should strictly scope to comp-sa and use FIFO layers (2*50 + 2*60 = 220)
    const valRows = calculateInventoryValuationComparison(
      comp2Db.inventoryItems,
      comp2Db.warehouseStock,
      comp2Db.stockCostLayers || [],
      'comp-sa',
      'FIFO'
    );
    expect(valRows).toHaveLength(1);
    expect(valRows[0].fifoLayerValue).toBe(220);

    const scan = runFinancialIntegrityScan(comp2Db);
    expect(scan.summaryMetrics.warehouseValuationSum).toBe(220);

    // Stocktaking & Year-end closing in SAR company must tag lines with SAR, not YER
    const st: PhysicalStocktaking = {
      id: 'st-sa-1',
      companyId: 'comp-sa',
      stocktakeNumber: 'ST-SA-1',
      warehouseId: 'wh-sa',
      scope: 'single_item',
      date: '2026-03-11',
      items: [
        {
          itemId: 'item-sa-1',
          itemName: 'صنف سعودي',
          unit: 'حبة',
          bookQuantity: 4,
          physicalQuantity: 5,
          difference: 1,
          unitCost: 60,
          totalDifferenceValue: 60,
        },
      ],
      status: 'review',
      conductedBy: comp2Admin.fullName,
    };
    const stRes = approveStocktakingTransaction(comp2Db, comp2Admin, st);
    expect(stRes.ok).toBe(true);
    const stJe = stRes.nextDb!.journalEntries.find((j) => j.referenceId === 'st-sa-1')!;
    expect(stJe.lines.every((l) => l.currency === 'SAR')).toBe(true);

    const closeRes = executeYearEndClosingTransaction(stRes.nextDb!, comp2Admin, '2026', '2026-12-31', false);
    expect(closeRes.ok).toBe(true);
    expect(closeRes.data!.closingEntry.lines.every((l) => l.currency === 'SAR')).toBe(true);
  });
});
