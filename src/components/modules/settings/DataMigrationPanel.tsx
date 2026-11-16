/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Direct SQL Backup (.bak/.bakw) & Excel/CSV Data Migration Center
 */

import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import {
  Database,
  Upload,
  Download,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  FileCode2,
  RefreshCw,
  ArrowLeftRight,
  Table2,
  Eye,
  Sparkles,
} from 'lucide-react';
import { ERPDatabase } from '../../../services/storageService';
import {
  Account,
  AccountCategory,
  AccountNature,
  Customer,
  InventoryItem,
  ItemWarehouseStock,
  Vendor,
} from '../../../types/erp';
import { exportToExcel } from '../../../services/exportService';
import {
  ParsedBakDatabase,
  parseSqlServerBakBuffer,
  QrightMigrationPreview,
} from '../../../services/sqlBakParserService';

type MigrationTarget = 'customers' | 'vendors' | 'inventory' | 'accounts';
type ImportMode = 'merge' | 'replace';

interface DataMigrationPanelProps {
  db: ERPDatabase;
  onApplyMigration: (updatedDb: ERPDatabase) => void;
}

const TARGET_LABELS: Record<MigrationTarget, string> = {
  customers: 'العملاء وأرصدتهم (Customers)',
  vendors: 'الموردين وأرصدتهم (Vendors)',
  inventory: 'الأصناف والأسعار والمخزون (Inventory)',
  accounts: 'دليل الحسابات والأرصدة (Chart of Accounts)',
};

function pickCol(row: Record<string, any>, candidates: string[], fallback: any = ''): any {
  const keys = Object.keys(row);
  for (const cand of candidates) {
    const exact = keys.find((k) => k.trim().toLowerCase() === cand.toLowerCase());
    if (exact !== undefined && row[exact] !== undefined && row[exact] !== '') {
      return row[exact];
    }
  }
  for (const cand of candidates) {
    const partial = keys.find((k) => k.trim().toLowerCase().includes(cand.toLowerCase()));
    if (partial !== undefined && row[partial] !== undefined && row[partial] !== '') {
      return row[partial];
    }
  }
  return fallback;
}

function toNum(val: any, fallback = 0): number {
  if (typeof val === 'number' && !Number.isNaN(val)) return val;
  if (typeof val === 'string') {
    const cleaned = val.replace(/[,،\s]/g, '');
    const parsed = Number(cleaned);
    return Number.isNaN(parsed) ? fallback : parsed;
  }
  return fallback;
}

export const DataMigrationPanel: React.FC<DataMigrationPanelProps> = ({
  db,
  onApplyMigration,
}) => {
  // Excel / CSV state
  const [target, setTarget] = useState<MigrationTarget>('customers');
  const [importMode, setImportMode] = useState<ImportMode>('merge');
  const [targetWarehouseId, setTargetWarehouseId] = useState<string>(db.warehouses[0]?.id || 'wh-1');
  const [parsedRows, setParsedRows] = useState<Record<string, any>[]>([]);
  const [fileName, setFileName] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [successMsg, setSuccessMsg] = useState<string>('');
  const [rollbackSnapshot, setRollbackSnapshot] = useState<{ db: ERPDatabase; logId: string; label: string } | null>(null);
  const [skipDuplicates, setSkipDuplicates] = useState<boolean>(false);

  // Direct .bak / .bakw SQL Server Backup state
  const [bakDb, setBakDb] = useState<ParsedBakDatabase | null>(null);
  const [bakPreview, setBakPreview] = useState<QrightMigrationPreview | null>(null);
  const [bakLoading, setBakLoading] = useState(false);
  const [bakMode, setBakMode] = useState<ImportMode>('replace');
  const [includeCompany, setIncludeCompany] = useState(true);
  const [includeRecentInvoices, setIncludeRecentInvoices] = useState(true);
  const [selectedBakTable, setSelectedBakTable] = useState<string>('');
  const [bakTableRows, setBakTableRows] = useState<Record<string, any>[]>([]);

  const handleBakFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    setErrorMsg('');
    setSuccessMsg('');
    setBakLoading(true);
    setBakDb(null);
    setBakPreview(null);
    setBakTableRows([]);
    setSelectedBakTable('');

    try {
      const buffer = await file.arrayBuffer();
      await new Promise((r) => setTimeout(r, 0));
      const parsed = parseSqlServerBakBuffer(buffer, file.name);
      const preview = parsed.getQrightMigrationPreview();
      setBakDb(parsed);
      setBakPreview(preview);
      if (parsed.tables.length > 0) {
        const defaultTbl =
          parsed.tables.find((t) => t.name === 'Accounts')?.name || parsed.tables[0].name;
        setSelectedBakTable(defaultTbl);
        setBakTableRows(parsed.decodeTable(defaultTbl, 15));
      }
      setSuccessMsg(
        `تم تحليل نسخة SQL Server (${file.name}) بنجاح واستخراج ${parsed.tables.length} جدولاً داخل المتصفح مباشرة!`
      );
    } catch (err: any) {
      console.error(err);
      setErrorMsg(
        err?.message ||
          'تعذر استخراج النسخة الاحتياطية مباشرة. قد تكون النسخة مضغوطة (Compression) — استخدم سكربت SQL أدناه عبر SSMS.'
      );
    } finally {
      setBakLoading(false);
    }
  };

  const handlePreviewBakTable = (tableName: string) => {
    if (!bakDb) return;
    setSelectedBakTable(tableName);
    setBakTableRows(bakDb.decodeTable(tableName, 15));
  };

  const handleCommitBakMigration = () => {
    if (!bakDb) return;
    const { updatedDb, stats } = bakDb.applyQrightMigration(db, bakMode, {
      includeCompany,
      includeRecentInvoices,
    });
    onApplyMigration(updatedDb);
    setSuccessMsg(
      `تم ترحيل البيانات بنجاح إلى نظام المنصور ERP: (${stats.accountsImported} حساب، ${stats.customersImported} عميل، ${stats.vendorsImported} مورد، ${stats.itemsImported} صنف، ${stats.stockRowsImported} رصيد مستودع، ${stats.warehousesImported} مستودع${
        stats.invoicesImported > 0 || stats.vouchersImported > 0 || stats.journalEntriesImported > 0
          ? `، ${stats.invoicesImported} فاتورة، ${stats.vouchersImported} سند، ${stats.journalEntriesImported} قيد يومية`
          : ''
      }).`
    );
  };

  const handleExcelCsvFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    const lower = file.name.toLowerCase();
    if (lower.endsWith('.bak') || lower.endsWith('.bakw') || lower.endsWith('.mdf')) {
      await handleBakFileChange(e);
      return;
    }

    input.value = '';
    setErrorMsg('');
    setSuccessMsg('');
    setFileName(file.name);

    try {
      const buffer = await file.arrayBuffer();
      await new Promise((r) => setTimeout(r, 0));
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(firstSheet, { defval: '' });
      if (rows.length === 0) {
        setErrorMsg('الملف المرفوع فارغ أو لا يحتوي على صفوف بيانات صالحة.');
        setParsedRows([]);
        return;
      }
      setParsedRows(rows);
    } catch (err) {
      console.error(err);
      setErrorMsg('تعذر قراءة الملف. تأكد من أنه ملف Excel (.xlsx / .xls) أو CSV صالح.');
      setParsedRows([]);
    }
  };

  const handleCommitExcelImport = () => {
    if (parsedRows.length === 0) return;

    const now = new Date().toISOString();
    const today = now.split('T')[0];
    const branchId = db.branches[0]?.id || 'br-1';
    const areaId = db.regionalAreas[0]?.id || 'area-1';
    const preImportDbSnapshot: ERPDatabase = JSON.parse(JSON.stringify(db));

    let updatedDb: ERPDatabase = { ...db };
    let importedCount = 0;
    let skippedDuplicates = 0;

    if (target === 'customers') {
      const mapped: Customer[] = parsedRows
        .map((r, idx) => {
          const nameAr = String(
            pickCol(r, ['nameAr', 'الاسم', 'اسم العميل', 'CustomerName', 'AccName', 'Name'])
          ).trim();
          if (!nameAr) return null;
          const code = String(
            pickCol(r, ['code', 'الكود', 'كود العميل', 'CustomerCode', 'AccCode'], `IMP-C-${idx + 1}`)
          ).trim();
          const balance = toNum(pickCol(r, ['currentBalance', 'الرصيد', 'الرصيد الحالي', 'Balance', 'Debit'], 0));
          const creditLimit = toNum(pickCol(r, ['creditLimit', 'الحد الائتماني', 'CreditLimit'], 500000));
          const phone = String(pickCol(r, ['phone', 'الهاتف', 'الجوال', 'Phone', 'Mobile'], '770000000'));
          const addressDetails = String(
            pickCol(r, ['addressDetails', 'العنوان', 'Address', 'City'], 'مستورد من قاعدة بيانات خارجية')
          );
          const rawCat = String(pickCol(r, ['category', 'التصنيف', 'Category'], 'تجاري'));
          const category: Customer['category'] =
            rawCat === 'جملة' || rawCat === 'تجزئة' || rawCat === 'VIP' || rawCat === 'حكومي' ? rawCat : 'تجاري';

          return {
            id: `cust-imp-${Date.now()}-${idx}`,
            branchId,
            code,
            nameAr,
            phone,
            whatsapp: phone,
            regionalAreaId: areaId,
            addressDetails,
            category,
            creditLimit,
            paymentTermDays: 30,
            openingBalance: balance,
            currentBalance: balance,
            status: 'active' as const,
            createdAt: today,
          };
        })
        .filter(Boolean) as Customer[];

      if (importMode === 'replace') {
        updatedDb.customers = mapped;
        importedCount = mapped.length;
      } else {
        const merged = [...db.customers];
        mapped.forEach((item) => {
          const existingIdx = merged.findIndex((c) => c.code === item.code);
          if (existingIdx >= 0) {
            if (skipDuplicates) {
              skippedDuplicates += 1;
            } else {
              merged[existingIdx] = { ...merged[existingIdx], ...item, id: merged[existingIdx].id };
              importedCount += 1;
            }
          } else {
            merged.push(item);
            importedCount += 1;
          }
        });
        updatedDb.customers = merged;
      }
    } else if (target === 'vendors') {
      const mapped: Vendor[] = parsedRows
        .map((r, idx) => {
          const nameAr = String(
            pickCol(r, ['nameAr', 'الاسم', 'اسم المورد', 'VendorName', 'SupplierName', 'Name'])
          ).trim();
          if (!nameAr) return null;
          const code = String(
            pickCol(r, ['code', 'الكود', 'كود المورد', 'VendorCode', 'AccCode'], `IMP-V-${idx + 1}`)
          ).trim();
          const balance = toNum(pickCol(r, ['currentBalance', 'الرصيد', 'الرصيد الحالي', 'Balance', 'Credit'], 0));
          const phone = String(pickCol(r, ['phone', 'الهاتف', 'الجوال', 'Phone', 'Mobile'], '770000000'));
          const address = String(pickCol(r, ['address', 'العنوان', 'Address'], 'مستورد من قاعدة بيانات خارجية'));

          return {
            id: `vend-imp-${Date.now()}-${idx}`,
            branchId,
            code,
            nameAr,
            phone,
            whatsapp: phone,
            address,
            category: 'مورد رئيسي' as const,
            openingBalance: balance,
            currentBalance: balance,
            paymentTermDays: 30,
            status: 'active' as const,
            createdAt: today,
          };
        })
        .filter(Boolean) as Vendor[];

      importedCount = mapped.length;
      if (importMode === 'replace') {
        updatedDb.vendors = mapped;
      } else {
        const merged = [...db.vendors];
        mapped.forEach((item) => {
          const existingIdx = merged.findIndex((v) => v.code === item.code);
          if (existingIdx >= 0) {
            merged[existingIdx] = { ...merged[existingIdx], ...item, id: merged[existingIdx].id };
          } else {
            merged.push(item);
          }
        });
        updatedDb.vendors = merged;
      }
    } else if (target === 'inventory') {
      const newItems: InventoryItem[] = [];
      const newStocks: ItemWarehouseStock[] = [];

      parsedRows.forEach((r, idx) => {
        const nameAr = String(
          pickCol(r, ['nameAr', 'اسم الصنف', 'الصنف', 'ItemName', 'ProductName', 'Name'])
        ).trim();
        if (!nameAr) return;
        const code = String(pickCol(r, ['code', 'كود الصنف', 'الكود', 'ItemCode', 'SKU'], `IMP-IT-${idx + 1}`)).trim();
        const barcode = String(pickCol(r, ['barcode', 'الباركود', 'Barcode', 'CodeID'], code)).trim();
        const category = String(
          pickCol(r, ['category', 'التصنيف', 'المجموعة', 'Category', 'GroupName'], 'أصناف مستوردة')
        );
        const baseUnit = String(pickCol(r, ['baseUnit', 'الوحدة', 'Unit', 'Unity', 'UnitName'], 'حبة'));
        const purchasePrice = toNum(
          pickCol(r, ['purchasePrice', 'سعر الشراء', 'التكلفة', 'Cost', 'Last', 'PurchasePrice'], 0)
        );
        const salePrice = toNum(
          pickCol(r, ['salePrice', 'سعر البيع', 'السعر', 'Consumer', 'Price', 'SalePrice'], purchasePrice)
        );
        const qty = toNum(pickCol(r, ['quantity', 'الكمية', 'الرصيد', 'Qty', 'Quantity', 'Stock'], 0));

        const itemId = `it-imp-${Date.now()}-${idx}`;
        newItems.push({
          id: itemId,
          code,
          barcode,
          nameAr,
          category,
          baseUnit,
          purchasePrice,
          salePrice,
          wholesalePrice: Math.round(salePrice * 0.92),
          minSalePrice: Math.round(salePrice * 0.85),
          minQuantityAlert: 5,
          maxQuantity: 1000,
          valuationMethod: 'WEIGHTED_AVERAGE',
          taxRate: db.settings.defaultTaxRate || 0.05,
          status: 'active',
          createdAt: today,
        });

        newStocks.push({
          itemId,
          warehouseId: targetWarehouseId,
          quantityOnHand: qty,
          averageCost: purchasePrice,
        });
      });

      importedCount = newItems.length;
      if (importMode === 'replace') {
        updatedDb.inventoryItems = newItems;
        updatedDb.warehouseStock = newStocks;
      } else {
        const mergedItems = [...db.inventoryItems];
        const mergedStock = [...db.warehouseStock];

        newItems.forEach((it, idx) => {
          const existingIdx = mergedItems.findIndex((x) => x.code === it.code);
          const stockRow = newStocks[idx];
          if (existingIdx >= 0) {
            const existingId = mergedItems[existingIdx].id;
            mergedItems[existingIdx] = { ...mergedItems[existingIdx], ...it, id: existingId };
            const sIdx = mergedStock.findIndex(
              (s) => s.itemId === existingId && s.warehouseId === targetWarehouseId
            );
            if (sIdx >= 0) {
              mergedStock[sIdx] = {
                ...mergedStock[sIdx],
                quantityOnHand: stockRow.quantityOnHand,
                averageCost: stockRow.averageCost,
              };
            } else {
              mergedStock.push({ ...stockRow, itemId: existingId });
            }
          } else {
            mergedItems.push(it);
            mergedStock.push(stockRow);
          }
        });

        updatedDb.inventoryItems = mergedItems;
        updatedDb.warehouseStock = mergedStock;
      }
    } else if (target === 'accounts') {
      const mapped: Account[] = parsedRows
        .map((r, idx) => {
          const code = String(pickCol(r, ['code', 'رقم الحساب', 'كود الحساب', 'AccCode', 'AccountCode'])).trim();
          const nameAr = String(
            pickCol(r, ['nameAr', 'اسم الحساب', 'الحساب', 'AccName', 'AccountName', 'Name'])
          ).trim();
          if (!code || !nameAr) return null;

          const firstDigit = code.charAt(0);
          let defaultCategory: AccountCategory = 'أصول';
          let defaultNature: AccountNature = 'debit';
          if (firstDigit === '2') {
            defaultCategory = 'خصوم';
            defaultNature = 'credit';
          } else if (firstDigit === '3') {
            defaultCategory = 'حقوق_ملكية';
            defaultNature = 'credit';
          } else if (firstDigit === '4') {
            defaultCategory = 'إيرادات';
            defaultNature = 'credit';
          } else if (firstDigit === '5') {
            defaultCategory = 'مصروفات';
            defaultNature = 'debit';
          }

          const rawCat = String(pickCol(r, ['category', 'الفئة', 'Category'], defaultCategory));
          const category: AccountCategory =
            rawCat === 'أصول' ||
            rawCat === 'خصوم' ||
            rawCat === 'حقوق_ملكية' ||
            rawCat === 'إيرادات' ||
            rawCat === 'مصروفات'
              ? rawCat
              : defaultCategory;

          const rawNat = String(pickCol(r, ['nature', 'الطبيعة', 'Nature'], defaultNature)).toLowerCase();
          const nature: AccountNature =
            rawNat === 'credit' || rawNat === 'دائن'
              ? 'credit'
              : rawNat === 'debit' || rawNat === 'مدين'
              ? 'debit'
              : defaultNature;

          const debit = toNum(pickCol(r, ['Debit', 'مدين'], 0));
          const credit = toNum(pickCol(r, ['Credit', 'دائن'], 0));
          const currentBalance =
            debit !== 0 || credit !== 0
              ? nature === 'debit'
                ? debit - credit
                : credit - debit
              : toNum(pickCol(r, ['currentBalance', 'الرصيد', 'Balance'], 0));

          const level = toNum(
            pickCol(r, ['level', 'المستوى', 'Level'], code.length <= 1 ? 1 : code.length <= 2 ? 2 : 3)
          );
          const isLeafRaw = pickCol(r, ['isLeaf', 'فرعي', 'IsLeaf'], true);
          const isLeaf =
            isLeafRaw === true ||
            String(isLeafRaw).toLowerCase() === 'true' ||
            String(isLeafRaw) === '1' ||
            String(isLeafRaw) === 'نعم';

          return {
            id: `acc-imp-${Date.now()}-${idx}`,
            code,
            nameAr,
            category,
            nature,
            parentCode: String(
              pickCol(r, ['parentCode', 'الحساب الأب', 'ParentCode'], code.length > 1 ? code.slice(0, -1) : '')
            ),
            level,
            isLeaf,
            currentBalance,
          };
        })
        .filter(Boolean) as Account[];

      importedCount = mapped.length;
      if (importMode === 'replace') {
        updatedDb.chartOfAccounts = mapped;
      } else {
        const merged = [...db.chartOfAccounts];
        mapped.forEach((acc) => {
          const existingIdx = merged.findIndex((a) => a.code === acc.code);
          if (existingIdx >= 0) {
            merged[existingIdx] = { ...merged[existingIdx], ...acc, id: merged[existingIdx].id };
          } else {
            merged.push(acc);
          }
        });
        updatedDb.chartOfAccounts = merged;
      }
    }

    const importLogId = `imp-${Date.now()}`;
    const entityTypeMap: Record<MigrationTarget, 'customers' | 'vendors' | 'items' | 'accounts'> = {
      customers: 'customers',
      vendors: 'vendors',
      inventory: 'items',
      accounts: 'accounts',
    };

    updatedDb.dataImportLogs = [
      {
        id: importLogId,
        timestamp: now,
        entityType: entityTypeMap[target],
        fileName: fileName || 'excel-import',
        totalRows: parsedRows.length,
        importedRows: importedCount,
        skippedDuplicates,
        errorsCount: Math.max(0, parsedRows.length - importedCount - skippedDuplicates),
        status: 'completed',
        performedBy: db.users[0]?.fullName || 'مدير النظام',
      },
      ...(db.dataImportLogs || []),
    ];

    updatedDb.auditLogs = [
      {
        id: `log-mig-${Date.now()}`,
        timestamp: now,
        userId: db.users[0]?.id || 'u-1',
        userName: db.users[0]?.fullName || 'مدير النظام',
        action: 'إنشاء',
        module: 'الإعدادات',
        details: `استيراد وترحيل (${importedCount}) سجل في [${TARGET_LABELS[target]}] (تخطي مكرر: ${skippedDuplicates}) من ملف: ${fileName}`,
      },
      ...db.auditLogs,
    ];

    setRollbackSnapshot({
      db: preImportDbSnapshot,
      logId: importLogId,
      label: `${TARGET_LABELS[target]} (${importedCount} سجل)`,
    });
    onApplyMigration(updatedDb);
    setSuccessMsg(`تم استيراد وترحيل ${importedCount} سجل بنجاح (تم تخطي ${skippedDuplicates} مكرر) إلى (${TARGET_LABELS[target]}).`);
    setParsedRows([]);
    setFileName('');
  };

  const handleRollbackLastImport = () => {
    if (!rollbackSnapshot) return;
    const rolledDb: ERPDatabase = {
      ...rollbackSnapshot.db,
      dataImportLogs: (db.dataImportLogs || []).map((l) =>
        l.id === rollbackSnapshot.logId ? { ...l, status: 'rolled_back' as const } : l
      ),
    };
    onApplyMigration(rolledDb);
    setSuccessMsg(`تم التراجع الذري (Rollback) عن عملية استيراد: ${rollbackSnapshot.label}.`);
    setRollbackSnapshot(null);
  };

  const handleDownloadTemplates = () => {
    exportToExcel({
      fileName: 'قوالب_استيراد_البيانات_ALMANSOOR_ERP',
      sheets: [
        {
          name: 'العملاء_Customers',
          data: [
            ['code', 'nameAr', 'phone', 'category', 'creditLimit', 'currentBalance', 'addressDetails'],
            ['C-2001', 'شركة النور للتجارة', '777111222', 'تجاري', 1000000, 150000, 'صنعاء - شارع الستين'],
          ],
        },
        {
          name: 'الموردين_Vendors',
          data: [
            ['code', 'nameAr', 'phone', 'currentBalance', 'address'],
            ['V-2001', 'مؤسسة الإمداد الدولية', '777333444', 250000, 'عدن - المنصورة'],
          ],
        },
        {
          name: 'الأصناف_Inventory',
          data: [
            ['code', 'barcode', 'nameAr', 'category', 'baseUnit', 'purchasePrice', 'salePrice', 'quantity'],
            ['IT-9001', '629000123456', 'لابتوب ديل لاتيتيود 5540', 'أجهزة حاسوب', 'حبة', 280000, 330000, 12],
          ],
        },
        {
          name: 'الحسابات_Accounts',
          data: [
            ['code', 'nameAr', 'category', 'nature', 'parentCode', 'level', 'isLeaf', 'currentBalance'],
            ['11103', 'صندوق المبيعات الفرعي', 'أصول', 'debit', '111', 4, 'نعم', 500000],
          ],
        },
      ],
    });
  };

  const handleDownloadSqlScript = () => {
    const sqlContent = `-- =====================================================================
-- ALMANSOOR SMART FINANCE ERP - SQL Server (.bakw / .bak) Extraction Script
-- سكربت مرجعي لاستعادة نسخة QrightFJK2025 على SQL Server (Windows)
-- =====================================================================

RESTORE DATABASE [QrightFJK2025]
FROM DISK = N'C:\\Backup\\auto_QrightFJK2025_2026_11_12.bakw'
WITH REPLACE,
     MOVE N'QrightDAE2025' TO N'C:\\SQLData\\QrightFJK2025.mdf',
     MOVE N'QrightDAE2025_log' TO N'C:\\SQLData\\QrightFJK2025_log.ldf';
GO

USE [QrightFJK2025];
GO

SELECT * FROM Accounts;
SELECT * FROM Customers;
SELECT * FROM Materials;
SELECT * FROM Stores;
SELECT * FROM StoresInventory;
`;

    const blob = new Blob(['\uFEFF' + sqlContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'extract_QrightFJK2025_to_AlmansoorERP.sql';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 text-xs">
      {/* SECTION 1: DIRECT SQL SERVER BACKUP (.bak / .bakw) EXTRACTOR */}
      <div className="bg-slate-900 border border-amber-500/40 rounded-2xl p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-2.5">
            <span className="p-2.5 bg-amber-500/15 border border-amber-500/30 text-amber-400 rounded-xl">
              <Database className="w-5 h-5" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-sm text-white">
                  استخراج واستيراد نسخ SQL Server الاحتياطية (.bakw / .bak) مباشرة
                </h3>
                <span className="px-2 py-0.5 bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 rounded text-[10px] font-bold">
                  يعمل مباشرة في المتصفح
                </span>
              </div>
              <p className="text-slate-400 text-[11px] mt-0.5">
                ارفع ملف النسخة الاحتياطية (مثل <code className="font-mono text-amber-300">auto_QrightFJK2025_2026_11_12.bakw</code>) ليقوم النظام بقراءة الجداول الداخلية واستخراج الحسابات والعملاء والأصناف والأرصدة وتصديرها إلى Excel أو ترحيلها فوراً.
              </p>
            </div>
          </div>

          <label className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-xl flex items-center justify-center gap-2 transition-colors cursor-pointer shrink-0 shadow-md">
            <Upload className="w-4 h-4" />
            <span>{bakLoading ? 'جاري تحليل وفك النسخة...' : 'اختر ملف .bakw أو .bak للاستخراج'}</span>
            <input
              type="file"
              accept=".bak,.bakw,.mdf"
              onChange={handleBakFileChange}
              disabled={bakLoading}
              className="hidden"
            />
          </label>
        </div>

        {/* Parsed BAK Summary & Actions */}
        {bakDb && bakPreview && (
          <div className="space-y-4">
            <div className="bg-slate-950 border border-emerald-500/30 rounded-xl p-4 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
                    <Sparkles className="w-4 h-4" />
                    <span>
                      قاعدة البيانات: <strong className="text-white">{bakPreview.companyName}</strong> ({bakDb.databaseName})
                    </span>
                  </div>
                  <p className="text-slate-400 text-[11px] mt-0.5">
                    تم العثور على <strong className="text-amber-400 font-mono">{bakDb.tables.length}</strong> جدولاً داخل النسخة ({bakDb.totalPages.toLocaleString()} صفحة SQL Server)
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => bakDb.exportAllKeyTablesToExcel()}
                  className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition-colors cursor-pointer shrink-0"
                >
                  <Download className="w-4 h-4" />
                  <span>تنزيل كافة الجداول الرئيسية كملف Excel (.xlsx)</span>
                </button>
              </div>

              {/* Counts Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 text-center">
                {[
                  { label: 'الحسابات', val: bakPreview.counts.accounts },
                  { label: 'العملاء', val: bakPreview.counts.customers },
                  { label: 'الموردين (2xx)', val: bakPreview.counts.vendorsFromAccounts },
                  { label: 'الأصناف', val: bakPreview.counts.materials },
                  { label: 'المستودعات', val: bakPreview.counts.warehouses },
                  { label: 'أرصدة المخزون', val: bakPreview.counts.warehouseStock },
                  { label: 'الفواتير', val: bakPreview.counts.bills },
                  { label: 'السندات والقيود', val: bakPreview.counts.bonds + bakPreview.counts.entryBonds },
                ].map((c) => (
                  <div key={c.label} className="bg-slate-900 border border-slate-800 rounded-lg p-2">
                    <div className="text-[10px] text-slate-400">{c.label}</div>
                    <div className="text-sm font-black font-mono text-amber-400 mt-0.5">
                      {c.val.toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>

              {/* Direct One-Click Import Controls */}
              {bakPreview.isQrightSchema && (
                <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-center">
                    <div>
                      <label className="block text-slate-300 font-semibold mb-1">أسلوب الترحيل إلى نظام المنصور</label>
                      <select
                        value={bakMode}
                        onChange={(e) => setBakMode(e.target.value as ImportMode)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white font-semibold focus:border-amber-500 focus:outline-none cursor-pointer"
                      >
                        <option value="replace">استبدال كامل (اعتماد بيانات النسخة فقط وحذف البيانات التجريبية)</option>
                        <option value="merge">دمج وتحديث السجلات بالكود (Merge / Upsert)</option>
                      </select>
                    </div>

                    <div className="space-y-1.5 text-[11px] text-slate-300">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={includeCompany}
                          onChange={(e) => setIncludeCompany(e.target.checked)}
                          className="accent-amber-500 w-3.5 h-3.5"
                        />
                        <span>تحديث اسم المؤسسة والعملات والمستودعات</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={includeRecentInvoices}
                          onChange={(e) => setIncludeRecentInvoices(e.target.checked)}
                          className="accent-amber-500 w-3.5 h-3.5"
                        />
                        <span>استيراد جميع الحركات السابقة (الفواتير والسندات والقيود لكشوف الحساب)</span>
                      </label>
                    </div>

                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={handleCommitBakMigration}
                        className="w-full py-2.5 px-4 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-xl flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-md"
                      >
                        <RefreshCw className="w-4 h-4" />
                        <span>ترحيل البيانات إلى نظام المنصور ERP</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Table Explorer inside .bakw */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 pt-2">
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 max-h-72 overflow-y-auto space-y-1">
                  <div className="flex items-center gap-1.5 font-bold text-slate-300 pb-2 border-b border-slate-800 mb-2">
                    <Table2 className="w-4 h-4 text-amber-400" />
                    <span>الجداول المستخرجة ({bakDb.tables.length})</span>
                  </div>
                  {bakDb.tables.slice(0, 45).map((tbl) => (
                    <div
                      key={tbl.objectId}
                      className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[11px] ${
                        selectedBakTable === tbl.name
                          ? 'bg-amber-500/20 border border-amber-500/40 text-amber-300'
                          : 'hover:bg-slate-800/70 text-slate-300'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => handlePreviewBakTable(tbl.name)}
                        className="flex items-center gap-1.5 text-right flex-1 cursor-pointer font-mono"
                      >
                        <Eye className="w-3 h-3 shrink-0 opacity-70" />
                        <span className="truncate">{tbl.name}</span>
                      </button>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-mono text-[10px] text-slate-400">
                          {tbl.estimatedRows.toLocaleString()}
                        </span>
                        <button
                          type="button"
                          onClick={() => bakDb.exportTableToExcel(tbl.name)}
                          title={`تصدير ${tbl.name} إلى Excel`}
                          className="p-1 bg-slate-800 hover:bg-emerald-600 text-emerald-400 hover:text-white rounded cursor-pointer"
                        >
                          <Download className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Live Preview of Selected SQL Table */}
                <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-3 overflow-hidden flex flex-col">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-800 mb-2">
                    <span className="font-bold text-white">
                      معاينة جدول: <code className="font-mono text-amber-400">{selectedBakTable || '-'}</code>
                    </span>
                    {selectedBakTable && (
                      <button
                        type="button"
                        onClick={() => bakDb.exportTableToExcel(selectedBakTable)}
                        className="flex items-center gap-1 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-[10px] font-bold cursor-pointer"
                      >
                        <Download className="w-3 h-3" />
                        <span>تصدير هذا الجدول Excel</span>
                      </button>
                    )}
                  </div>

                  {bakTableRows.length > 0 ? (
                    <div className="overflow-x-auto max-h-60">
                      <table className="w-full text-right text-[11px] border-collapse">
                        <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                          <tr>
                            {Object.keys(bakTableRows[0])
                              .filter((k) => !k.includes('GUID') && k !== 'License')
                              .slice(0, 7)
                              .map((col) => (
                                <th key={col} className="py-1.5 px-2 font-mono whitespace-nowrap">
                                  {col}
                                </th>
                              ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60">
                          {bakTableRows.map((r, idx) => (
                            <tr key={idx} className="hover:bg-slate-800/40">
                              {Object.keys(bakTableRows[0])
                                .filter((k) => !k.includes('GUID') && k !== 'License')
                                .slice(0, 7)
                                .map((col) => (
                                  <td key={col} className="py-1.5 px-2 text-slate-200 truncate max-w-[150px]">
                                    {r[col] === null || r[col] === undefined ? '-' : String(r[col])}
                                  </td>
                                ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="text-slate-500 text-center py-10">لا توجد صفوف في هذا الجدول للمعاينة</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* SECTION 2: EXCEL / CSV IMPORTER + TEMPLATES + SSMS FALLBACK */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-2.5">
            <span className="p-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl">
              <ArrowLeftRight className="w-5 h-5" />
            </span>
            <div>
              <h3 className="font-bold text-sm text-white">استيراد جداول Excel / CSV وقوالب البيانات</h3>
              <p className="text-slate-400 text-[11px]">
                استيراد العملاء، الموردين، الأصناف والأرصدة، ودليل الحسابات من ملفات Excel أو CSV
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadTemplates}
              className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>تنزيل قوالب Excel المتطابقة</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadSqlScript}
              className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-amber-300 font-bold rounded-xl transition-colors cursor-pointer"
            >
              <FileCode2 className="w-3.5 h-3.5" />
              <span>سكربت تفريغ SQL Server (.sql)</span>
            </button>
          </div>
        </div>

        {/* Excel Import Options */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-slate-300 font-semibold mb-1.5">1. نوع البيانات المراد استيرادها</label>
            <select
              value={target}
              onChange={(e) => {
                setTarget(e.target.value as MigrationTarget);
                setParsedRows([]);
                setFileName('');
                setErrorMsg('');
                setSuccessMsg('');
              }}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-bold focus:border-amber-500 focus:outline-none cursor-pointer"
            >
              <option value="customers">العملاء وأرصدتهم (Customers)</option>
              <option value="vendors">الموردون وأرصدتهم (Vendors)</option>
              <option value="inventory">الأصناف والأسعار والمخزون (Inventory)</option>
              <option value="accounts">دليل الحسابات (Chart of Accounts)</option>
            </select>
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1.5">2. أسلوب المعالجة</label>
            <select
              value={importMode}
              onChange={(e) => setImportMode(e.target.value as ImportMode)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 focus:border-amber-500 focus:outline-none cursor-pointer"
            >
              <option value="merge">دمج وتحديث المطابق بالكود (Merge / Upsert)</option>
              <option value="replace">استبدال القائمة الحالية بالكامل (Replace)</option>
            </select>
          </div>

          {target === 'inventory' ? (
            <div>
              <label className="block text-slate-300 font-semibold mb-1.5">3. المستودع المستهدف للكميات</label>
              <select
                value={targetWarehouseId}
                onChange={(e) => setTargetWarehouseId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 focus:border-amber-500 focus:outline-none cursor-pointer"
              >
                {db.warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.nameAr}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="flex items-end">
              <label className="w-full py-2 px-4 bg-slate-800 hover:bg-slate-700 text-amber-300 font-bold rounded-xl flex items-center justify-center gap-2 transition-colors cursor-pointer text-center border border-slate-700">
                <Upload className="w-4 h-4" />
                <span>{fileName ? `ملف: ${fileName}` : 'اختر ملف Excel / CSV للاستيراد'}</span>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv,.bak,.bakw"
                  onChange={handleExcelCsvFileChange}
                  className="hidden"
                />
              </label>
            </div>
          )}
        </div>

        {target === 'inventory' && (
          <div>
            <label className="w-full py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-amber-300 font-bold rounded-xl flex items-center justify-center gap-2 transition-colors cursor-pointer text-center border border-slate-700">
              <Upload className="w-4 h-4" />
              <span>{fileName ? `ملف الأصناف المحدد: ${fileName}` : 'اختر ملف Excel / CSV للأصناف والمخزون'}</span>
              <input
                type="file"
                accept=".xlsx,.xls,.csv,.bak,.bakw"
                onChange={handleExcelCsvFileChange}
                className="hidden"
              />
            </label>
          </div>
        )}

        {/* Messages */}
        {errorMsg && (
          <div className="bg-rose-950/30 border border-rose-800/50 text-rose-300 p-3.5 rounded-xl flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="bg-emerald-950/30 border border-emerald-800/50 text-emerald-300 p-3.5 rounded-xl flex items-center gap-2 font-bold">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Excel Live Preview Table */}
        {parsedRows.length > 0 && (
          <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden space-y-3 p-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                  <span className="font-bold text-white">
                    معاينة البيانات المستخرجة: <strong className="text-amber-400 font-mono">{parsedRows.length}</strong> صف جاهز للاستيراد
                  </span>
                </div>
                <label className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={skipDuplicates}
                    onChange={(e) => setSkipDuplicates(e.target.checked)}
                    className="accent-amber-500"
                  />
                  <span>تخطي الأكواد المكررة دون تعديل</span>
                </label>
              </div>
              <button
                type="button"
                onClick={handleCommitExcelImport}
                className="flex items-center gap-1.5 px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-black rounded-xl transition-colors cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                <span>اعتماد وتنفيذ الترحيل إلى {TARGET_LABELS[target]}</span>
              </button>
            </div>

            <div className="overflow-x-auto max-h-60">
              <table className="w-full text-right text-[11px] border-collapse">
                <thead className="bg-slate-900 text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="py-2 px-2">#</th>
                    {Object.keys(parsedRows[0])
                      .slice(0, 7)
                      .map((col) => (
                        <th key={col} className="py-2 px-2 font-mono">
                          {col}
                        </th>
                      ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {parsedRows.slice(0, 8).map((r, i) => (
                    <tr key={i} className="hover:bg-slate-900/50">
                      <td className="py-1.5 px-2 font-mono text-slate-500">{i + 1}</td>
                      {Object.keys(parsedRows[0])
                        .slice(0, 7)
                        .map((col) => (
                          <td key={col} className="py-1.5 px-2 text-slate-200 truncate max-w-[160px]">
                            {String(r[col] ?? '')}
                          </td>
                        ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Atomic Rollback & Import History */}
        {(rollbackSnapshot || (db.dataImportLogs && db.dataImportLogs.length > 0)) && (
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong className="text-slate-200">سجل عمليات الاستيراد والترحيل</strong>
              {rollbackSnapshot && (
                <button
                  type="button"
                  onClick={handleRollbackLastImport}
                  className="px-3 py-1.5 rounded-lg bg-rose-950/60 border border-rose-500/50 text-rose-300 hover:bg-rose-900/60 font-bold cursor-pointer"
                >
                  تراجع ذري عن آخر استيراد ({rollbackSnapshot.label})
                </button>
              )}
            </div>
            {(db.dataImportLogs || []).slice(0, 6).map((log) => (
              <div key={log.id} className="flex items-center justify-between text-[11px] bg-slate-900 px-3 py-1.5 rounded">
                <span className="text-slate-300">
                  {log.timestamp.slice(0, 16).replace('T', ' ')} · {log.fileName} ({log.entityType})
                </span>
                <span className={log.status === 'rolled_back' ? 'text-rose-400 font-bold' : 'text-emerald-400 font-bold'}>
                  {log.status === 'rolled_back' ? 'تم التراجع' : `مستورد: ${log.importedRows} / مكرر متخطى: ${log.skippedDuplicates}`}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
