/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - V20 Tab 1: Invoices & Warehouse Operations Workbench
 * يجمع واجهة V20 السريعة (تنقل لوحة المفاتيح + إكمال تلقائي + شرائح الأقسام + الدفاتر + صفوف قابلة للتكرار والحذف)
 * مع المحرك المحاسبي والمخزني الفعلي للمشروع الأصلي
 */

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  ChevronRight,
  ChevronLeft,
  Search,
  FilePlus,
  Save,
  CheckCircle2,
  Trash2,
  BookOpen,
  SlidersHorizontal,
  Eye,
  MessageCircle,
  Plus,
  Copy,
  X,
  Edit3,
  PackagePlus,
  Tag,
  Printer,
  FileDown,
} from 'lucide-react';
import {
  Invoice,
  InvoiceItem,
  Customer,
  Vendor,
  InventoryItem,
  ItemWarehouseStock,
  Warehouse,
  TreasuryAccount,
  Currency,
  CurrencyCode,
  Branch,
  Company,
  User,
  DocumentBook,
  DepartmentItem,
  TableColumnPref,
  WarehouseDocument,
  InventoryTransfer,
  WhatsAppTemplates,
  PrintDocumentType,
  PrintTemplateConfig,
  CommercialOrder,
  CommercialOrderType,
  PosShift,
  HeldPosCart,
  Employee,
  ScreenFieldRule,
} from '../../../types/erp';
import {
  computeLiveInvoiceBalancePreview,
  getDistinctItemPriceAdvisor,
} from '../../../services/balanceIntelligenceService';
import { canFulfillStock, getItemStockInWarehouse } from '../../../services/inventoryEngine';
import { generateNextDocNumber } from '../../../services/storageService';
import {
  downloadBatchReportAsPDF,
  downloadInvoicePDF,
  printBatchDocuments,
  renderWhatsAppTemplate,
  ReportPDFOptions,
} from '../../../services/exportService';
import {
  extractNumericSuffix,
  normalizeDigits,
  rankSearchResults,
} from '../../../services/searchHelpers';
import { convertToBase, getCurrencySymbol, getEffectiveCurrencyRate } from '../../../services/currencyHelpers';
import {
  buildItemPriceIntelligenceIndex,
  convertBasePriceToTargetCurrency,
} from '../../../services/priceHistoryHelpers';
import { UniversalColumnCustomizer } from '../../common/UniversalColumnCustomizer';
import { UniversalPreviewModal, UniversalPreviewPayload } from '../../common/UniversalPreviewModal';
import { DocumentBooksModal } from '../../common/DocumentBooksModal';
import { WhatsAppShareModal } from '../../common/WhatsAppShareModal';
import { SearchableSelect, SearchableSelectOption } from '../../common/SearchableSelect';
import { CustomerItemPriceModal } from '../../common/CustomerItemPriceModal';
import { ConfirmModal } from '../../common/ConfirmModal';

type WorkbenchDocKind =
  | 'SALE'
  | 'SALE_RETURN'
  | 'PURCHASE'
  | 'PURCHASE_RETURN'
  | 'STOCK_OUT'
  | 'STOCK_IN'
  | 'STOCK_TRANSFER';

interface GridRow {
  rowKey: string;
  itemId: string;
  barcode: string;
  itemName: string;
  unit: string;
  quantity: number;
  bonusQuantity: number;
  unitCost: number;
  unitPrice: number;
  discountPercentage: number;
  taxPercentage: number;
  notes: string;
  customValues: Record<string, string>;
}

const DEFAULT_INV_COLS: TableColumnPref[] = [
  { key: 'barcode', label: 'الباركود', visible: true, order: 0, width: 105 },
  { key: 'name', label: 'الصنف', visible: true, order: 1, width: 230 },
  { key: 'unit', label: 'الوحدة', visible: true, order: 2, width: 85 },
  { key: 'qty', label: 'الكمية', visible: true, order: 3, width: 80 },
  { key: 'bonus', label: 'بونص', visible: true, order: 4, width: 70 },
  { key: 'cost', label: 'التكلفة', visible: true, order: 5, width: 95 },
  { key: 'price', label: 'السعر', visible: true, order: 6, width: 105 },
  { key: 'discount', label: 'خصم %', visible: true, order: 7, width: 75 },
  { key: 'tax', label: 'ضريبة %', visible: true, order: 8, width: 75 },
  { key: 'total', label: 'الإجمالي', visible: true, order: 9, width: 115 },
  { key: 'notes', label: 'ملاحظات', visible: true, order: 10, width: 145 },
];

const DOC_KIND_OPTIONS: { value: WorkbenchDocKind; label: string; bookCategory: DocumentBook['category'] }[] = [
  { value: 'SALE', label: 'فاتورة مبيعات', bookCategory: 'sales' },
  { value: 'SALE_RETURN', label: 'مرتجع مبيعات', bookCategory: 'sales' },
  { value: 'PURCHASE', label: 'فاتورة مشتريات', bookCategory: 'purchases' },
  { value: 'PURCHASE_RETURN', label: 'مرتجع مشتريات', bookCategory: 'purchases' },
  { value: 'STOCK_OUT', label: 'إذن صرف مخزني', bookCategory: 'warehouse' },
  { value: 'STOCK_IN', label: 'إذن توريد مخزني', bookCategory: 'warehouse' },
  { value: 'STOCK_TRANSFER', label: 'مناقلة مخزنية بين مستودعين', bookCategory: 'warehouse' },
];

function mapDocKindToInvoiceType(kind: WorkbenchDocKind): Invoice['type'] {
  if (kind === 'SALE_RETURN') return 'مرتجع_مبيعات';
  if (kind === 'PURCHASE') return 'مشتريات';
  if (kind === 'PURCHASE_RETURN') return 'مرتجع_مشتريات';
  return 'مبيعات';
}

function mapInvoiceTypeToDocKind(type: Invoice['type']): WorkbenchDocKind {
  if (type === 'مرتجع_مبيعات') return 'SALE_RETURN';
  if (type === 'مشتريات') return 'PURCHASE';
  if (type === 'مرتجع_مشتريات') return 'PURCHASE_RETURN';
  return 'SALE';
}

const createEmptyRow = (): GridRow => ({
  rowKey: `row-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  itemId: '',
  barcode: '',
  itemName: '',
  unit: 'حبة',
  quantity: 1,
  bonusQuantity: 0,
  unitCost: 0,
  unitPrice: 0,
  discountPercentage: 0,
  taxPercentage: 0,
  notes: '',
  customValues: {},
});

interface InvoiceWorkbenchProps {
  invoices: Invoice[];
  warehouseDocuments: WarehouseDocument[];
  customers: Customer[];
  vendors: Vendor[];
  warehouses: Warehouse[];
  inventoryItems: InventoryItem[];
  warehouseStock: ItemWarehouseStock[];
  treasuryAccounts: TreasuryAccount[];
  currencies: Currency[];
  documentBooks: DocumentBook[];
  departments: DepartmentItem[];
  currentBranch: Branch;
  currentCurrency: Currency;
  currentUser: User;
  company: Company;
  allowNegativeStock: boolean;
  defaultTaxRate: number;
  enableTax: boolean;
  autoDownloadInvoices: boolean;
  whatsappTemplates?: WhatsAppTemplates;
  printTemplates?: Partial<Record<PrintDocumentType, PrintTemplateConfig>>;
  savedColumnPrefs?: TableColumnPref[];
  focusedRecordId?: string;
  commercialOrders?: CommercialOrder[];
  posShifts?: PosShift[];
  heldPosCarts?: HeldPosCart[];
  salesReps?: Employee[];
  fieldRules?: ScreenFieldRule[];
  onSaveCommercialOrder?: (order: CommercialOrder) => void;
  onConvertOrderToInvoice?: (order: CommercialOrder) => void;
  onUpdatePosState?: (patch: { posShifts?: PosShift[]; heldPosCarts?: HeldPosCart[] }) => void;
  onSaveColumnPrefs: (tableId: string, prefs: TableColumnPref[]) => void;
  onPostSalesInvoice: (inv: Invoice, opts?: { idempotencyKey?: string }) => boolean | void;
  onPostPurchaseInvoice: (inv: Invoice, opts?: { idempotencyKey?: string }) => boolean | void;
  onSaveDraftInvoice: (inv: Invoice) => boolean | void;
  onCancelInvoice: (invoiceId: string) => void;
  onSaveWarehouseDoc: (doc: WarehouseDocument) => void;
  onExecuteTransfer: (transfer: InventoryTransfer) => void;
  onSaveDocumentBook: (book: DocumentBook) => void;
  onToggleDocumentBook: (bookId: string) => void;
  onSetDefaultDocumentBook: (bookId: string) => void;
  onConsumeBookSequence: (bookId: string) => void;
  onQuickSaveCustomer: (customer: Customer) => void;
  onQuickSaveVendor: (vendor: Vendor) => void;
  onQuickSaveItem: (item: InventoryItem) => void;
  onNotify: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export const InvoiceWorkbench: React.FC<InvoiceWorkbenchProps> = ({
  invoices,
  warehouses,
  inventoryItems,
  warehouseStock,
  customers,
  vendors,
  treasuryAccounts,
  currencies,
  documentBooks,
  departments,
  currentBranch,
  currentCurrency,
  currentUser,
  company,
  allowNegativeStock,
  defaultTaxRate,
  enableTax,
  autoDownloadInvoices,
  whatsappTemplates,
  printTemplates,
  savedColumnPrefs,
  focusedRecordId,
  commercialOrders = [],
  posShifts = [],
  heldPosCarts = [],
  salesReps = [],
  fieldRules = [],
  onSaveCommercialOrder,
  onConvertOrderToInvoice,
  onUpdatePosState,
  onSaveColumnPrefs,
  onPostSalesInvoice,
  onPostPurchaseInvoice,
  onSaveDraftInvoice,
  onCancelInvoice,
  onSaveWarehouseDoc,
  onExecuteTransfer,
  onSaveDocumentBook,
  onToggleDocumentBook,
  onSetDefaultDocumentBook,
  onConsumeBookSequence,
  onQuickSaveCustomer,
  onQuickSaveVendor,
  onQuickSaveItem,
  onNotify,
}) => {
  const canViewCost = currentUser.canViewCostsAndProfits;
  const canDeleteInv = currentUser.canDeleteInvoices ?? currentUser.canManageSettings;
  const canEditInv = currentUser.canEditInvoices ?? true;
  const canPost = currentUser.canPostEntries;

  // Ordered chronological invoices for Prev/Next stepping
  const sortedInvoices = useMemo(
    () => [...invoices].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [invoices]
  );

  const [viewingIndex, setViewingIndex] = useState<number>(-1); // -1 = creating new document
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null);
  const [draftIdempotencyKey, setDraftIdempotencyKey] = useState<string>(
    () => `idem-inv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  );
  const postingLockRef = useRef(false);
  const [docKind, setDocKind] = useState<WorkbenchDocKind>('SALE');
  const [selectedBookId, setSelectedBookId] = useState<string>('');
  const [docNumber, setDocNumber] = useState<string>('');
  const [docDate, setDocDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [paymentType, setPaymentType] = useState<'نقدي' | 'آجل' | 'جزئي'>('نقدي');
  const [currencyCode, setCurrencyCode] = useState<CurrencyCode>(currentCurrency.code || 'YER');
  const [exchangeRate, setExchangeRate] = useState<number>(currentCurrency.exchangeRate || 1);
  const [treasuryId, setTreasuryId] = useState<string>(treasuryAccounts[0]?.id || '');
  const [warehouseId, setWarehouseId] = useState<string>(warehouses[0]?.id || '');
  const [destWarehouseId, setDestWarehouseId] = useState<string>(warehouses[1]?.id || warehouses[0]?.id || '');

  // Party Autocomplete
  const [selectedPartyId, setSelectedPartyId] = useState<string>('');
  const [partyQuery, setPartyQuery] = useState<string>('');

  // Department Filter Chips
  const [activeDept, setActiveDept] = useState<string>('ALL');

  // Spreadsheet Rows
  const [rows, setRows] = useState<GridRow[]>(() => [createEmptyRow(), createEmptyRow(), createEmptyRow()]);
  const [invoiceDiscount, setInvoiceDiscount] = useState<number>(0);
  const [paidAmount, setPaidAmount] = useState<number>(0);
  const [invoiceNotes, setInvoiceNotes] = useState<string>('');

  // Row Item Autocomplete Dropdown State
  const [acRowIdx, setAcRowIdx] = useState<number | null>(null);
  const [acColKey, setAcColKey] = useState<'name' | 'barcode'>('name');
  const [acHighlightIdx, setAcHighlightIdx] = useState<number>(0);
  const [activePriceRowIdx, setActivePriceRowIdx] = useState<number>(0);

  // Single-pass O(N) historical price index & warehouse average cost lookup map
  const priceIntelligenceIndex = useMemo(
    () => buildItemPriceIntelligenceIndex(invoices, currencies),
    [invoices, currencies]
  );

  const warehouseStockMap = useMemo(() => {
    const map = new Map<string, ItemWarehouseStock>();
    for (const ws of warehouseStock) {
      if (ws.warehouseId === warehouseId) map.set(ws.itemId, ws);
    }
    return map;
  }, [warehouseStock, warehouseId]);

  // Modals
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [isBooksModalOpen, setIsBooksModalOpen] = useState(false);
  const [isColCustOpen, setIsColCustOpen] = useState(false);
  const [previewPayload, setPreviewPayload] = useState<UniversalPreviewPayload | null>(null);
  const [waPayload, setWaPayload] = useState<{
    phone?: string;
    text: string;
    previewPayload?: UniversalPreviewPayload;
  } | null>(null);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  const [priceLookupState, setPriceLookupState] = useState<{
    open: boolean;
    rowIdx: number | null;
    itemId?: string;
  }>({ open: false, rowIdx: null });

  // Quick Add / Inline Edit Party & Item Modals
  const [isQuickPartyOpen, setIsQuickPartyOpen] = useState(false);
  const [editingPartyId, setEditingPartyId] = useState<string | null>(null);
  const [quickPartyName, setQuickPartyName] = useState('');
  const [quickPartyPhone, setQuickPartyPhone] = useState('');
  const [quickPartyCurrency, setQuickPartyCurrency] = useState<CurrencyCode>('YER');

  const [isQuickItemOpen, setIsQuickItemOpen] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [quickItemCode, setQuickItemCode] = useState('');
  const [quickItemName, setQuickItemName] = useState('');
  const [quickItemBarcode, setQuickItemBarcode] = useState('');
  const [quickItemCat, setQuickItemCat] = useState(departments[0]?.nameAr || 'إلكترونيات');
  const [quickItemPurchase, setQuickItemPurchase] = useState(10000);
  const [quickItemSale, setQuickItemSale] = useState(12500);

  // Phase 2: Commercial Orders, POS Shifts & Held Carts, Split Payment & Sales Rep
  const [isCommercialModalOpen, setIsCommercialModalOpen] = useState(false);
  const [newOrderType, setNewOrderType] = useState<CommercialOrderType>('عرض_سعر');
  const [isPosModalOpen, setIsPosModalOpen] = useState(false);
  const [shiftOpeningCash, setShiftOpeningCash] = useState<number>(0);
  const [shiftCountedCash, setShiftCountedCash] = useState<number>(0);
  const [heldCartLabel, setHeldCartLabel] = useState<string>('');
  const [selectedSalesRepId, setSelectedSalesRepId] = useState<string>('');
  const [paymentSplitCash, setPaymentSplitCash] = useState<number>(0);
  const [paymentSplitBank, setPaymentSplitBank] = useState<number>(0);
  const [useSplitPayment, setUseSplitPayment] = useState<boolean>(false);

  // Cell Ref Registry for full spreadsheet keyboard navigation
  const cellRefs = useRef<Record<string, HTMLInputElement | HTMLSelectElement | null>>({});

  const registerCell = (rowIdx: number, colKey: string) => (el: HTMLInputElement | HTMLSelectElement | null) => {
    cellRefs.current[`${rowIdx}:${colKey}`] = el;
  };

  // Column Preferences (ordered + RBAC cost hiding)
  const columns = useMemo(() => {
    const base = savedColumnPrefs && savedColumnPrefs.length > 0 ? savedColumnPrefs : DEFAULT_INV_COLS;
    return [...base]
      .sort((a, b) => a.order - b.order)
      .filter((c) => canViewCost || c.key !== 'cost');
  }, [savedColumnPrefs, canViewCost]);

  const editableColKeys = useMemo(
    () => columns.filter((c) => c.visible && c.key !== 'total').map((c) => c.key),
    [columns]
  );

  // Matching Document Books for current docKind
  const currentBookCategory = DOC_KIND_OPTIONS.find((d) => d.value === docKind)?.bookCategory || 'sales';
  const availableBooks = useMemo(
    () => documentBooks.filter((b) => b.isActive && b.category === currentBookCategory),
    [documentBooks, currentBookCategory]
  );

  // Pick default book when docKind changes in new mode
  useEffect(() => {
    if (viewingIndex >= 0 || editingInvoiceId) return;
    const preferred =
      availableBooks.find((b) => b.isDefault) || availableBooks[0] || documentBooks.find((b) => b.isActive);
    if (preferred) {
      setSelectedBookId(preferred.id);
    }
  }, [docKind, availableBooks, documentBooks, viewingIndex, editingInvoiceId]);

  // Generate next document number from selected book & existing invoices
  useEffect(() => {
    if (viewingIndex >= 0 || editingInvoiceId) return;
    const book = documentBooks.find((b) => b.id === selectedBookId);
    const prefix =
      book?.prefix ||
      (docKind === 'SALE'
        ? 'SAL-'
        : docKind === 'SALE_RETURN'
        ? 'SRT-'
        : docKind === 'PURCHASE'
        ? 'PUR-'
        : docKind === 'PURCHASE_RETURN'
        ? 'PRT-'
        : 'WHS-');
    const pad = book?.padLength || 4;
    const allNums = invoices.map((i) => i.invoiceNumber);
    const computed = generateNextDocNumber(prefix, allNums, pad);
    if (book && book.nextSequence) {
      const seqStr = `${prefix}${String(book.nextSequence).padStart(pad, '0')}`;
      if (!allNums.includes(seqStr)) {
        const computedNum = parseInt(computed.replace(prefix, ''), 10) || 0;
        setDocNumber(book.nextSequence >= computedNum ? seqStr : computed);
        return;
      }
    }
    setDocNumber(computed);
  }, [selectedBookId, docKind, invoices, documentBooks, viewingIndex, editingInvoiceId]);

  // Department filter chips list
  const departmentChips = useMemo(() => {
    const set = new Set<string>();
    departments.forEach((d) => d.nameAr && set.add(d.nameAr));
    inventoryItems.forEach((i) => i.category && set.add(i.category));
    return Array.from(set);
  }, [departments, inventoryItems]);

  const filteredItemsPool = useMemo(() => {
    return inventoryItems.filter(
      (it) => it.status === 'active' && (activeDept === 'ALL' || it.category === activeDept)
    );
  }, [inventoryItems, activeDept]);

  // Party pool (Vendors for purchases, Customers for sales)
  const isPurchaseMode = docKind === 'PURCHASE' || docKind === 'PURCHASE_RETURN';
  const isWarehouseOnlyMode = docKind === 'STOCK_OUT' || docKind === 'STOCK_IN' || docKind === 'STOCK_TRANSFER';

  const partyPool = useMemo(() => {
    if (isPurchaseMode) {
      return vendors.map((v) => ({
        id: v.id,
        code: v.code,
        name: v.nameAr,
        phone: v.whatsapp || v.phone,
        balance: v.currentBalance,
        currency: (v.currency || 'YER') as CurrencyCode,
      }));
    }
    return customers.map((c) => ({
      id: c.id,
      code: c.code,
      name: c.nameAr,
      phone: c.whatsapp || c.phone,
      balance: c.currentBalance,
      currency: (c.currency || 'YER') as CurrencyCode,
    }));
  }, [isPurchaseMode, vendors, customers]);

  const partySelectOptions = useMemo<SearchableSelectOption[]>(
    () =>
      partyPool.map((p) => {
        const cRate = getEffectiveCurrencyRate(currencies, p.currency);
        const badge =
          p.currency !== 'YER'
            ? `${(Math.round((p.balance / cRate) * 100) / 100).toLocaleString()} ${p.currency === 'SAR' ? 'ر.س' : p.currency} | ${p.balance.toLocaleString()} ر.ي`
            : `${p.balance.toLocaleString()} ر.ي`;
        return {
          id: p.id,
          code: p.code,
          name: p.name,
          sublabel: p.phone || undefined,
          badge,
          phone: p.phone,
        };
      }),
    [partyPool, currencies]
  );

  // Default party on mount or mode switch
  useEffect(() => {
    if (viewingIndex >= 0 || editingInvoiceId) return;
    const first = partyPool[0];
    if (first && (!selectedPartyId || !partyPool.some((p) => p.id === selectedPartyId))) {
      setSelectedPartyId(first.id);
      setPartyQuery(first.name);
      const partyCurr = first.currency || 'YER';
      setCurrencyCode(partyCurr);
      setExchangeRate(getEffectiveCurrencyRate(currencies, partyCurr));
    }
  }, [docKind, partyPool, selectedPartyId, viewingIndex, editingInvoiceId, currencies]);

  const currentInvoiceRecord = viewingIndex >= 0 ? sortedInvoices[viewingIndex] : null;
  const isReadOnlyPosted = Boolean(
    currentInvoiceRecord && currentInvoiceRecord.status !== 'draft' && currentInvoiceRecord.status !== 'cancelled' && !canEditInv
  );
  const isCancelledDoc = currentInvoiceRecord?.status === 'cancelled';

  const loadInvoiceIntoForm = useCallback(
    (inv: Invoice, idx: number) => {
      setViewingIndex(idx);
      setEditingInvoiceId(inv.id);
      setDocKind(mapInvoiceTypeToDocKind(inv.type));
      setSelectedBookId(inv.bookId || '');
      setDocNumber(inv.invoiceNumber);
      setDocDate(inv.date);
      setPaymentType(inv.paymentType);
      const resolvedCurr = inv.currency || 'YER';
      const resolvedRate = getEffectiveCurrencyRate(currencies, resolvedCurr, inv.exchangeRate);
      setCurrencyCode(resolvedCurr);
      setExchangeRate(resolvedRate);
      setTreasuryId(inv.treasuryAccountId || treasuryAccounts[0]?.id || '');
      setWarehouseId(inv.warehouseId || warehouses[0]?.id || '');
      setSelectedPartyId(inv.entityId);
      setPartyQuery(inv.entityName);
      setInvoiceDiscount(inv.discountTotal || 0);
      setPaidAmount(inv.paidAmount || 0);
      setInvoiceNotes(inv.notes || '');
      const mappedRows: GridRow[] = inv.items.map((it) => ({
        rowKey: it.id || `r-${Math.random().toString(36).slice(2, 6)}`,
        itemId: it.itemId,
        barcode: it.itemBarcode || '',
        itemName: it.itemName,
        unit: it.unit || 'حبة',
        quantity: it.quantity,
        bonusQuantity: it.bonusQuantity || 0,
        unitCost: it.unitCost || 0,
        unitPrice: it.unitPrice,
        discountPercentage: it.discountPercentage || 0,
        taxPercentage: it.taxPercentage || 0,
        notes: it.notes || '',
        customValues: {},
      }));
      setRows(mappedRows.length > 0 ? mappedRows : [createEmptyRow()]);
    },
    [treasuryAccounts, warehouses, currencies]
  );

  // Jump to focusedRecordId once per target ID if navigated from Reports/Unified Docs
  const lastJumpedFocusRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!focusedRecordId) {
      lastJumpedFocusRef.current = undefined;
      return;
    }
    if (lastJumpedFocusRef.current === focusedRecordId) return;
    const idx = sortedInvoices.findIndex((i) => i.id === focusedRecordId);
    if (idx >= 0) {
      lastJumpedFocusRef.current = focusedRecordId;
      loadInvoiceIntoForm(sortedInvoices[idx], idx);
    }
  }, [focusedRecordId, sortedInvoices, loadInvoiceIntoForm]);

  const resetToNewDoc = () => {
    setViewingIndex(-1);
    setEditingInvoiceId(null);
    setDraftIdempotencyKey(`idem-inv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    setDocDate(new Date().toISOString().split('T')[0]);
    setPaymentType('نقدي');
    setInvoiceDiscount(0);
    setPaidAmount(0);
    setInvoiceNotes('');
    setRows([createEmptyRow(), createEmptyRow(), createEmptyRow()]);
    const first = partyPool[0];
    if (first) {
      setSelectedPartyId(first.id);
      setPartyQuery(first.name);
      const partyCurr = first.currency || 'YER';
      setCurrencyCode(partyCurr);
      setExchangeRate(getEffectiveCurrencyRate(currencies, partyCurr));
    }
  };

  // Financial Calculations (preserve halala/decimal precision for SAR/USD)
  const calcRowLine = useCallback((r: GridRow) => {
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const qty = Math.max(0, Number(r.quantity) || 0);
    const price = Math.max(0, Number(r.unitPrice) || 0);
    const discPct = Math.max(0, Math.min(100, Number(r.discountPercentage) || 0));
    const taxPct = Math.max(0, Number(r.taxPercentage) || 0);
    const gross = r2(qty * price);
    const discAmt = r2((gross * discPct) / 100);
    const afterDisc = r2(gross - discAmt);
    const taxAmt = r2((afterDisc * taxPct) / 100);
    const total = r2(afterDisc + taxAmt);
    return { gross, discAmt, afterDisc, taxAmt, total };
  }, []);

  const summary = useMemo(() => {
    const r2 = (n: number) => Math.round(n * 100) / 100;
    let subtotal = 0;
    let lineDiscount = 0;
    let taxTotal = 0;
    for (const r of rows) {
      if (!r.itemName.trim() && !r.itemId) continue;
      const c = calcRowLine(r);
      subtotal += c.gross;
      lineDiscount += c.discAmt;
      taxTotal += c.taxAmt;
    }
    subtotal = r2(subtotal);
    const totalDiscount = r2(lineDiscount + (Number(invoiceDiscount) || 0));
    taxTotal = r2(taxTotal);
    const grandTotal = r2(Math.max(0, subtotal - totalDiscount + taxTotal));
    return { subtotal, totalDiscount, taxTotal, grandTotal };
  }, [rows, invoiceDiscount, calcRowLine]);

  // Sync Paid amount with paymentType automatically
  useEffect(() => {
    if (viewingIndex >= 0 && currentInvoiceRecord && currentInvoiceRecord.status !== 'draft') return;
    if (paymentType === 'نقدي') {
      setPaidAmount(summary.grandTotal);
    } else if (paymentType === 'آجل') {
      setPaidAmount(0);
    }
  }, [paymentType, summary.grandTotal, viewingIndex, currentInvoiceRecord]);

  const selectedParty = partyPool.find((p) => p.id === selectedPartyId);
  const selectedCustomerObj = !isPurchaseMode ? customers.find((c) => c.id === selectedPartyId) : undefined;
  const liveBalancePreview = computeLiveInvoiceBalancePreview({
    invoiceType: mapDocKindToInvoiceType(docKind),
    previousBalanceBase: selectedParty?.balance ?? 0,
    invoiceTotalNative: summary.grandTotal,
    paidAmountNative: Number(paidAmount) || 0,
    currency: currencyCode,
    currencies,
    creditLimitBase: selectedCustomerObj?.creditLimit || 0,
  });
  const remainingAmount = liveBalancePreview.invoiceRemainingNative;
  const prevBalanceBase = liveBalancePreview.previousBalanceBase;
  const newStandingBalanceBase = liveBalancePreview.finalBalanceBase;
  const partyNativeCurrency: CurrencyCode =
    selectedParty?.currency && selectedParty.currency !== 'YER'
      ? selectedParty.currency
      : currencyCode !== 'YER'
      ? currencyCode
      : 'YER';
  const partyNativeRate = getEffectiveCurrencyRate(currencies, partyNativeCurrency);
  const isForeignParty = partyNativeCurrency !== 'YER';
  const prevBalanceNative = Math.round((prevBalanceBase / partyNativeRate) * 100) / 100;
  const newStandingBalanceNative = Math.round((newStandingBalanceBase / partyNativeRate) * 100) / 100;

  const isFieldVisible = (key: string) => {
    const rule = fieldRules.find((r) => r.fieldKey === key);
    return rule ? rule.visible : true;
  };

  // Bind an inventory item into a row
  const applyItemToRow = (rowIdx: number, item: InventoryItem) => {
    const rate = exchangeRate || 1;
    const unitSale = Math.round((item.salePrice / rate) * 100) / 100;
    const unitPur = Math.round((item.purchasePrice / rate) * 100) / 100;
    const defaultTax = enableTax ? Math.round((item.taxRate || defaultTaxRate) * 100) : 0;
    const wsAvgCost = warehouseStockMap.get(item.id)?.averageCost;
    const resolvedUnitCost = !isPurchaseMode && wsAvgCost && wsAvgCost > 0 ? wsAvgCost : item.purchasePrice;

    setRows((prev) =>
      prev.map((r, i) =>
        i === rowIdx
          ? {
              ...r,
              itemId: item.id,
              barcode: item.barcode,
              itemName: item.nameAr,
              unit: item.baseUnit || 'حبة',
              unitCost: resolvedUnitCost,
              unitPrice: isPurchaseMode ? unitPur : unitSale,
              taxPercentage: defaultTax,
            }
          : r
      )
    );
    setActivePriceRowIdx(rowIdx);
    setAcRowIdx(null);
  };

  // Recalculate unit prices of inventory-bound lines whenever invoice currency or FX rate changes on draft/new invoices
  const recalculateBoundRowPrices = (nextRate: number) => {
    const safeRate = nextRate > 0 ? nextRate : 1;
    setRows((prev) =>
      prev.map((r) => {
        if (!r.itemId) return r;
        const catalogItem = inventoryItems.find((it) => it.id === r.itemId);
        if (!catalogItem) return r;
        const basePrice = isPurchaseMode ? catalogItem.purchasePrice : catalogItem.salePrice;
        return {
          ...r,
          unitPrice: Math.round((basePrice / safeRate) * 100) / 100,
        };
      })
    );
  };

  // Focus helper for spreadsheet grid
  const focusCell = (rowIdx: number, colKey: string) => {
    setTimeout(() => {
      const el = cellRefs.current[`${rowIdx}:${colKey}`];
      if (el) {
        el.focus();
        if (el instanceof HTMLInputElement && el.type !== 'checkbox') {
          el.select();
        }
      }
    }, 10);
  };

  const addNewRowAndFocus = (focusCol: string = 'name') => {
    const nextIdx = rows.length;
    setRows((prev) => [...prev, createEmptyRow()]);
    focusCell(nextIdx, focusCol);
  };

  const duplicateRow = (idx: number) => {
    const src = rows[idx];
    if (!src) return;
    const clone: GridRow = {
      ...src,
      rowKey: `row-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      customValues: { ...src.customValues },
    };
    setRows((prev) => {
      const next = [...prev];
      next.splice(idx + 1, 0, clone);
      return next;
    });
  };

  const deleteRow = (idx: number) => {
    if (rows.length <= 1) {
      setRows([createEmptyRow()]);
      return;
    }
    setRows((prev) => prev.filter((_, i) => i !== idx));
  };

  // Grid keyboard navigation handler
  const handleCellKeyDown = (e: React.KeyboardEvent, rowIdx: number, colKey: string) => {
    if (acRowIdx === rowIdx && (colKey === 'name' || colKey === 'barcode')) {
      const qStr = colKey === 'barcode' ? rows[rowIdx]?.barcode || '' : rows[rowIdx]?.itemName || '';
      const acMatches = getAutocompleteMatches(qStr);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setAcHighlightIdx((p) => Math.min(Math.max(0, acMatches.length - 1), p + 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setAcHighlightIdx((p) => Math.max(0, p - 1));
        return;
      }
      if (e.key === 'Enter' && colKey === 'name' && acMatches[acHighlightIdx]) {
        e.preventDefault();
        applyItemToRow(rowIdx, acMatches[acHighlightIdx]);
        focusCell(rowIdx, 'qty');
        return;
      }
      if (e.key === 'Escape') {
        setAcRowIdx(null);
        return;
      }
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (rowIdx + 1 < rows.length) {
        focusCell(rowIdx + 1, colKey);
      } else {
        addNewRowAndFocus(colKey);
      }
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (rowIdx > 0) focusCell(rowIdx - 1, colKey);
      return;
    }

    const colIdx = editableColKeys.indexOf(colKey);
    if (e.ctrlKey && e.key === 'ArrowLeft' && colIdx >= 0 && colIdx + 1 < editableColKeys.length) {
      e.preventDefault();
      focusCell(rowIdx, editableColKeys[colIdx + 1]);
      return;
    }
    if (e.ctrlKey && e.key === 'ArrowRight' && colIdx > 0) {
      e.preventDefault();
      focusCell(rowIdx, editableColKeys[colIdx - 1]);
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (colKey === 'barcode') {
        const rawCode = normalizeDigits(rows[rowIdx]?.barcode || '').trim();
        const numericCore = /^\d+$/.test(rawCode) ? String(parseInt(rawCode, 10)) : null;
        const exact = inventoryItems.find(
          (it) =>
            it.status === 'active' &&
            (normalizeDigits(it.barcode).trim() === rawCode ||
              normalizeDigits(it.code).trim() === rawCode ||
              (numericCore !== null &&
                (extractNumericSuffix(it.code) === numericCore ||
                  extractNumericSuffix(it.barcode) === numericCore ||
                  extractNumericSuffix(it.id) === numericCore)))
        );
        const acMatches = getAutocompleteMatches(rawCode);
        const chosen = exact || acMatches[acHighlightIdx] || acMatches[0];
        if (chosen) {
          applyItemToRow(rowIdx, chosen);
          focusCell(rowIdx, 'qty');
        } else {
          focusCell(rowIdx, 'name');
        }
      } else if (colKey === 'name') {
        focusCell(rowIdx, 'qty');
      } else if (colKey === 'qty') {
        focusCell(rowIdx, 'price');
      } else if (colKey === 'price') {
        focusCell(rowIdx, 'notes');
      } else if (colKey === 'notes') {
        if (rowIdx + 1 < rows.length) {
          focusCell(rowIdx + 1, 'name');
        } else {
          addNewRowAndFocus('name');
        }
      } else if (colIdx >= 0 && colIdx + 1 < editableColKeys.length) {
        focusCell(rowIdx, editableColKeys[colIdx + 1]);
      }
    }
  };

  const getAutocompleteMatches = (query: string) => {
    const clean = normalizeDigits(query).trim();
    const isNumeric = /^\d+$/.test(clean);
    const activePool = inventoryItems.filter((it) => it.status === 'active');
    const basePool = isNumeric ? activePool : filteredItemsPool;
    let ranked = rankSearchResults(
      basePool,
      query,
      (it) => ({
        code: it.code,
        barcode: it.barcode,
        id: it.id,
        name: it.nameAr,
        alt: it.category,
      }),
      80
    );
    if (ranked.length === 0 && basePool !== activePool) {
      ranked = rankSearchResults(
        activePool,
        query,
        (it) => ({
          code: it.code,
          barcode: it.barcode,
          id: it.id,
          name: it.nameAr,
          alt: it.category,
        }),
        80
      );
    }
    return ranked;
  };

  // Validate and build Invoice object
  const buildInvoiceObject = (asDraft: boolean): Invoice | null => {
    const validRows = rows.filter((r) => r.itemId && r.quantity > 0);
    if (validRows.length === 0) {
      onNotify('error', 'يجب إدخال صنف واحد على الأقل بكمية صحيحة.');
      return null;
    }
    if (!selectedPartyId && !isWarehouseOnlyMode) {
      onNotify('error', 'يرجى تحديد العميل أو المورد قبل الحفظ.');
      return null;
    }

    // Stock fulfillment check for Sales / Purchase Return / Stock Out
    if (!asDraft && (docKind === 'SALE' || docKind === 'PURCHASE_RETURN' || docKind === 'STOCK_OUT' || docKind === 'STOCK_TRANSFER')) {
      for (const r of validRows) {
        const totalNeeded = r.quantity + (r.bonusQuantity || 0);
        const check = canFulfillStock(warehouseStock, r.itemId, warehouseId, totalNeeded, allowNegativeStock);
        if (!check.canFulfill) {
          onNotify('error', `${r.itemName}: ${check.message}`);
          return null;
        }
      }
    }

    const invItems: InvoiceItem[] = validRows.map((r) => {
      const c = calcRowLine(r);
      const safeRate = exchangeRate > 0 ? exchangeRate : 1;
      const netPurchaseUnitCostBase =
        Math.round(((c.afterDisc / Math.max(r.quantity, 1)) * safeRate) * 100) / 100;
      const wsAvgCost = warehouseStockMap.get(r.itemId)?.averageCost;
      const resolvedUnitCost = isPurchaseMode
        ? netPurchaseUnitCostBase
        : wsAvgCost && wsAvgCost > 0
        ? wsAvgCost
        : r.unitCost;

      return {
        id: r.rowKey,
        itemId: r.itemId,
        itemName: r.itemName,
        itemBarcode: r.barcode,
        unit: r.unit,
        quantity: r.quantity,
        bonusQuantity: r.bonusQuantity || 0,
        unitPrice: r.unitPrice,
        discountPercentage: r.discountPercentage || 0,
        discountAmount: c.discAmt,
        subtotal: c.afterDisc,
        taxPercentage: r.taxPercentage || 0,
        taxAmount: c.taxAmt,
        total: c.total,
        unitCost: resolvedUnitCost,
        notes: r.notes || undefined,
      };
    });

    const isExistingDraft = currentInvoiceRecord?.status === 'draft';
    const finalStatus: Invoice['status'] = asDraft
      ? 'draft'
      : remainingAmount === 0
      ? 'paid'
      : paidAmount > 0
      ? 'partial'
      : 'posted';

    return {
      id: isExistingDraft && editingInvoiceId ? editingInvoiceId : `inv-${Date.now()}`,
      invoiceNumber: docNumber,
      type: mapDocKindToInvoiceType(docKind),
      paymentType,
      date: docDate,
      branchId: currentBranch.id,
      warehouseId,
      entityId: selectedPartyId || 'internal',
      entityName: selectedParty?.name || partyQuery || 'عملية داخلية',
      currency: currencyCode,
      exchangeRate: exchangeRate || 1,
      items: invItems,
      subtotal: summary.subtotal,
      discountTotal: summary.totalDiscount,
      taxTotal: summary.taxTotal,
      grandTotal: summary.grandTotal,
      paidAmount: Number(paidAmount) || 0,
      remainingAmount,
      previousBalanceSnapshot: prevBalanceBase,
      newBalanceSnapshot: newStandingBalanceBase,
      paymentMethod: paymentType === 'آجل' ? undefined : useSplitPayment ? 'متعدد' : 'صندوق',
      treasuryAccountId: treasuryId,
      bookId: selectedBookId || undefined,
      salesRepId: selectedSalesRepId || undefined,
      salesRepName: salesReps.find((s) => s.id === selectedSalesRepId)?.nameAr,
      status: finalStatus,
      idempotencyKey: asDraft ? undefined : draftIdempotencyKey,
      notes: invoiceNotes || undefined,
      createdBy: currentUser.fullName,
      createdAt: currentInvoiceRecord?.createdAt || new Date().toISOString(),
    };
  };

  const handleSaveOrPost = async (asDraft: boolean) => {
    if (postingLockRef.current) return;
    if (!asDraft && !canPost) {
      onNotify('error', 'ليس لديك صلاحية ترحيل المستندات.');
      return;
    }
    postingLockRef.current = true;
    try {

    // Handle Pure Warehouse Doc / Transfer
    if (isWarehouseOnlyMode) {
      const validRows = rows.filter((r) => r.itemId && r.quantity > 0);
      if (validRows.length === 0) {
        onNotify('error', 'أدخل صنفاً واحداً على الأقل.');
        return;
      }
      if (docKind === 'STOCK_TRANSFER') {
        if (warehouseId === destWarehouseId) {
          onNotify('error', 'لا يمكن المناقلة إلى نفس المستودع.');
          return;
        }
        const transfer: InventoryTransfer = {
          id: `tr-${Date.now()}`,
          transferNumber: docNumber,
          date: docDate,
          fromWarehouseId: warehouseId,
          toWarehouseId: destWarehouseId,
          items: validRows.map((r) => ({
            itemId: r.itemId,
            itemName: r.itemName,
            unit: r.unit,
            quantity: r.quantity,
            unitCost: r.unitCost,
          })),
          status: 'draft',
          notes: invoiceNotes,
          performedBy: currentUser.fullName,
        };
        onExecuteTransfer(transfer);
      } else {
        const wDoc: WarehouseDocument = {
          id: `wd-${Date.now()}`,
          documentNumber: docNumber,
          type: docKind === 'STOCK_IN' ? 'إذن_توريد' : 'إذن_صرف',
          date: docDate,
          warehouseId,
          beneficiaryOrSupplier: partyQuery || 'المخزن الرئيسي',
          reason: invoiceNotes || 'أمر مخزني مباشر',
          items: validRows.map((r) => ({
            id: r.rowKey,
            itemId: r.itemId,
            itemName: r.itemName,
            unit: r.unit,
            quantity: r.quantity,
            unitCost: r.unitCost,
            totalCost: r.quantity * r.unitCost,
            notes: r.notes,
          })),
          totalQuantity: validRows.reduce((s, r) => s + r.quantity, 0),
          totalCost: validRows.reduce((s, r) => s + r.quantity * r.unitCost, 0),
          status: asDraft ? 'draft' : 'posted',
          performedBy: currentUser.fullName,
          notes: invoiceNotes,
          createdAt: new Date().toISOString(),
        };
        onSaveWarehouseDoc(wDoc);
        onNotify('success', `تم إصدار ${wDoc.type} رقم ${wDoc.documentNumber} بنجاح.`);
      }
      if (selectedBookId) onConsumeBookSequence(selectedBookId);
      resetToNewDoc();
      return;
    }

    const inv = buildInvoiceObject(asDraft);
    if (!inv) return;

    if (asDraft) {
      const savedOk = onSaveDraftInvoice(inv);
      if (savedOk === false) return;
      onNotify('success', `تم حفظ المسودة ${inv.invoiceNumber}.`);
      resetToNewDoc();
      return;
    }

    const postedOk = isPurchaseMode
      ? onPostPurchaseInvoice(inv, { idempotencyKey: draftIdempotencyKey })
      : onPostSalesInvoice(inv, { idempotencyKey: draftIdempotencyKey });
    if (postedOk === false) return;

    if (selectedBookId) onConsumeBookSequence(selectedBookId);

    const whName = warehouses.find((w) => w.id === inv.warehouseId)?.nameAr;
    if (autoDownloadInvoices) {
      try {
        await downloadInvoicePDF(inv, company, currentBranch, whName, printTemplates?.invoice);
      } catch {
        // Soft fallback if popup blocked
      }
    }
    onNotify('success', `تم ترحيل ${inv.type} رقم ${inv.invoiceNumber} وتحديث المخزون والقيود بنجاح.`);
    resetToNewDoc();
    } finally {
      postingLockRef.current = false;
    }
  };

  // Build Universal Preview Payload
  const buildPreviewPayload = (): UniversalPreviewPayload => {
    const whName = warehouses.find((w) => w.id === warehouseId)?.nameAr || '';
    const bookName = documentBooks.find((b) => b.id === selectedBookId)?.nameAr || 'دفتر قياسي';
    const validRows = rows.filter((r) => r.itemName.trim() || r.itemId);
    const kindLabel = DOC_KIND_OPTIONS.find((d) => d.value === docKind)?.label || 'مستند';

    const invObjForPdf: Invoice = {
      id: editingInvoiceId || 'preview',
      invoiceNumber: docNumber,
      type: mapDocKindToInvoiceType(docKind),
      paymentType,
      date: docDate,
      branchId: currentBranch.id,
      warehouseId,
      entityId: selectedPartyId || 'cust',
      entityName: selectedParty?.name || partyQuery || 'عميل نقدي',
      currency: currencyCode,
      exchangeRate,
      items: validRows.map((r) => {
        const c = calcRowLine(r);
        return {
          id: r.rowKey,
          itemId: r.itemId || 'it',
          itemName: r.itemName,
          itemBarcode: r.barcode,
          unit: r.unit,
          quantity: r.quantity,
          bonusQuantity: r.bonusQuantity,
          unitPrice: r.unitPrice,
          discountPercentage: r.discountPercentage,
          discountAmount: c.discAmt,
          subtotal: c.afterDisc,
          taxPercentage: r.taxPercentage,
          taxAmount: c.taxAmt,
          total: c.total,
          unitCost: r.unitCost,
          notes: r.notes,
        };
      }),
      subtotal: summary.subtotal,
      discountTotal: summary.totalDiscount,
      taxTotal: summary.taxTotal,
      grandTotal: summary.grandTotal,
      paidAmount,
      remainingAmount,
      previousBalanceSnapshot: prevBalanceBase,
      newBalanceSnapshot: newStandingBalanceBase,
      status: 'posted',
      createdBy: currentUser.fullName,
      createdAt: new Date().toISOString(),
    };

    const waMsg = whatsappTemplates?.invoice
      ? renderWhatsAppTemplate(whatsappTemplates.invoice, {
          customerName: invObjForPdf.entityName,
          invoiceNumber: docNumber,
          date: docDate,
          totalAmount: `${summary.grandTotal.toLocaleString()} ${currencyCode}`,
          paidAmount: `${paidAmount.toLocaleString()} ${currencyCode}`,
          remainingAmount: `${remainingAmount.toLocaleString()} ${currencyCode}`,
          companyName: company.nameAr,
        })
      : `${company.nameAr}\n${kindLabel} رقم: ${docNumber}\nالتاريخ: ${docDate}\nالعميل/الطرف: ${invObjForPdf.entityName}\nالصافي: ${summary.grandTotal.toLocaleString()} ${currencyCode}\nالمدفوع: ${paidAmount.toLocaleString()}\nالمتبقي: ${remainingAmount.toLocaleString()}`;

    return {
      title: `${kindLabel} رقم ${docNumber}`,
      periodText: `التاريخ: ${docDate}`,
      docType: 'invoice',
      metadata: {
        الدفتر: bookName,
        العميل_أو_المورد: invObjForPdf.entityName,
        المستودع: whName,
        الدفع: paymentType,
        العملة: `${currencyCode} (صرف ${exchangeRate})`,
        المرحل: currentUser.fullName,
      },
      tables: [
        {
          headers: ['#', 'الصنف', 'الوحدة', 'الكمية', 'بونص', 'السعر', 'الخصم', 'الإجمالي'],
          rows: validRows.map((r, idx) => {
            const c = calcRowLine(r);
            return [
              idx + 1,
              r.itemName,
              r.unit,
              r.quantity,
              r.bonusQuantity || 0,
              r.unitPrice.toLocaleString(),
              c.discAmt.toLocaleString(),
              c.total.toLocaleString(),
            ];
          }),
          totals: ['-', 'الإجمالي', '', validRows.reduce((s, r) => s + r.quantity, 0), '', '', summary.totalDiscount.toLocaleString(), `${summary.grandTotal.toLocaleString()} ${currencyCode}`],
        },
      ],
      summaryCards: [
        { label: 'الصافي النهائي', value: `${summary.grandTotal.toLocaleString()} ${currencyCode}` },
        { label: 'المدفوع / المستلم', value: `${paidAmount.toLocaleString()} ${currencyCode}` },
        { label: 'المتبقي (آجل)', value: `${remainingAmount.toLocaleString()} ${currencyCode}` },
        {
          label: isForeignParty ? `الرصيد السابق (${partyNativeCurrency})` : 'الرصيد السابق (YER)',
          value: isForeignParty
            ? `${prevBalanceNative.toLocaleString()} ${partyNativeCurrency === 'SAR' ? 'ر.س' : partyNativeCurrency}`
            : `${prevBalanceBase.toLocaleString()} ر.ي`,
          subValue: isForeignParty ? `المعادل: ${prevBalanceBase.toLocaleString()} ر.ي` : undefined,
        },
        {
          label: isForeignParty ? `الرصيد القائم بعد المستند (${partyNativeCurrency})` : 'الرصيد القائم بعد المستند (YER)',
          value: isForeignParty
            ? `${newStandingBalanceNative.toLocaleString()} ${partyNativeCurrency === 'SAR' ? 'ر.س' : partyNativeCurrency}`
            : `${newStandingBalanceBase.toLocaleString()} ر.ي`,
          subValue: isForeignParty ? `المعادل: ${newStandingBalanceBase.toLocaleString()} ر.ي` : undefined,
        },
      ],
      notes: invoiceNotes,
      whatsappText: waMsg,
      defaultPhone: selectedParty?.phone,
      invoiceObj: !isWarehouseOnlyMode ? invObjForPdf : undefined,
      warehouseName: whName,
      bluetoothLines: [
        company.nameAr,
        `${kindLabel}: ${docNumber}`,
        `Date: ${docDate}`,
        `Party: ${invObjForPdf.entityName}`,
        '------------------------',
        ...validRows.map((r) => `${r.itemName} x${r.quantity} = ${calcRowLine(r).total}`),
        '------------------------',
        `NET: ${summary.grandTotal} ${currencyCode}`,
        `PAID: ${paidAmount} | REM: ${remainingAmount}`,
      ],
    };
  };

  // Search Modal filtered list
  const searchResults = useMemo(() => {
    const reversed = [...sortedInvoices].reverse();
    if (!searchText.trim()) return reversed.slice(0, 300);
    return rankSearchResults(
      reversed,
      searchText,
      (i) => ({
        code: i.invoiceNumber,
        name: i.entityName,
        alt: `${i.type} ${i.currency} ${i.currency === 'SAR' ? 'سعودي ر.س' : 'يمني ر.ي'} ${i.notes || ''}`,
      }),
      300
    );
  }, [sortedInvoices, searchText]);

  return (
    <div className="space-y-3" dir="rtl">
      {/* V20 Document Navigation & Action Toolbar */}
      <div className="v20-doc-toolbar">
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            disabled={sortedInvoices.length === 0 || viewingIndex === 0}
            onClick={() => {
              if (sortedInvoices.length === 0) return;
              const nextIdx = viewingIndex === -1 ? sortedInvoices.length - 1 : Math.max(0, viewingIndex - 1);
              loadInvoiceIntoForm(sortedInvoices[nextIdx], nextIdx);
            }}
            className="px-2.5 py-1.5 rounded-md text-xs font-extrabold bg-[#08121E] border border-[var(--border-strong)] text-white hover:border-[var(--gold)] disabled:opacity-40 flex items-center gap-1 cursor-pointer"
          >
            <ChevronRight className="w-3.5 h-3.5" />
            <span>السابق</span>
          </button>

          <button
            type="button"
            disabled={viewingIndex === -1}
            onClick={() => {
              if (viewingIndex === -1) return;
              if (viewingIndex + 1 < sortedInvoices.length) {
                loadInvoiceIntoForm(sortedInvoices[viewingIndex + 1], viewingIndex + 1);
              } else {
                resetToNewDoc();
              }
            }}
            className="px-2.5 py-1.5 rounded-md text-xs font-extrabold bg-[#08121E] border border-[var(--border-strong)] text-white hover:border-[var(--gold)] disabled:opacity-40 flex items-center gap-1 cursor-pointer"
          >
            <span>التالي</span>
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => setIsSearchModalOpen(true)}
            className="px-2.5 py-1.5 rounded-md text-xs font-extrabold bg-[#08121E] border border-[var(--info)] text-[var(--info)] hover:bg-[var(--info)] hover:text-[#03060A] flex items-center gap-1 cursor-pointer"
          >
            <Search className="w-3.5 h-3.5" />
            <span>بحث في الفواتير ({invoices.length})</span>
          </button>

          <button
            type="button"
            onClick={resetToNewDoc}
            className="px-2.5 py-1.5 rounded-md text-xs font-black bg-[var(--gold)] text-[#03060A] hover:bg-[var(--gold-hover)] flex items-center gap-1 cursor-pointer"
          >
            <FilePlus className="w-3.5 h-3.5" />
            <span>مستند جديد</span>
          </button>

          <span
            className={`px-2.5 py-1 rounded text-xs font-black border ${
              isCancelledDoc
                ? 'bg-rose-950/60 border-rose-500 text-rose-300'
                : viewingIndex >= 0
                ? 'bg-sky-950/60 border-sky-500 text-sky-300'
                : 'bg-emerald-950/60 border-emerald-500 text-emerald-300'
            }`}
          >
            {viewingIndex >= 0
              ? `مستند ${viewingIndex + 1} من ${sortedInvoices.length} · ${
                  currentInvoiceRecord?.status === 'draft'
                    ? 'مسودة'
                    : currentInvoiceRecord?.status === 'cancelled'
                    ? 'ملغاة'
                    : 'مرحّلة'
                }`
              : 'مستند جديد (حر)'}
          </span>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => setIsCommercialModalOpen(true)}
            className="px-2.5 py-1.5 rounded-md text-xs font-extrabold bg-[#08121E] border border-amber-500/70 text-amber-300 hover:bg-amber-500 hover:text-[#03060A] flex items-center gap-1 cursor-pointer"
          >
            <FilePlus className="w-3.5 h-3.5" />
            <span>العروض والأوامر ({commercialOrders.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setIsPosModalOpen(true)}
            className="px-2.5 py-1.5 rounded-md text-xs font-extrabold bg-[#08121E] border border-emerald-500/70 text-emerald-300 hover:bg-emerald-500 hover:text-[#03060A] flex items-center gap-1 cursor-pointer"
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>
              الوردية والمعلق ({heldPosCarts.length})
            </span>
          </button>

          <button
            type="button"
            onClick={() =>
              setPriceLookupState({
                open: true,
                rowIdx: rows.findIndex((x) => Boolean(x.itemId)) >= 0 ? rows.findIndex((x) => Boolean(x.itemId)) : 0,
                itemId: rows.find((x) => Boolean(x.itemId))?.itemId,
              })
            }
            className="px-2.5 py-1.5 rounded-md text-xs font-extrabold bg-[#08121E] border border-sky-500/70 text-sky-300 hover:border-[var(--gold)] hover:text-[var(--gold)] flex items-center gap-1 cursor-pointer"
            title="معرفة آخر سعر بيع مادة لهذا العميل أو لغيره سابقاً"
          >
            <Tag className="w-3.5 h-3.5" />
            <span>سعر عميل لصنف</span>
          </button>

          <button
            type="button"
            onClick={() => setIsBooksModalOpen(true)}
            className="px-2.5 py-1.5 rounded-md text-xs font-extrabold bg-[#08121E] border border-[var(--gold)] text-[var(--gold)] hover:bg-[var(--gold)] hover:text-[#03060A] flex items-center gap-1 cursor-pointer"
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>إدارة الدفاتر</span>
          </button>

          <button
            type="button"
            onClick={() => setIsColCustOpen(true)}
            className="px-2.5 py-1.5 rounded-md text-xs font-extrabold bg-[#08121E] border border-[var(--border-strong)] text-white hover:border-[var(--gold)] flex items-center gap-1 cursor-pointer"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>أعمدة الفاتورة</span>
          </button>

          <button
            type="button"
            onClick={() => setPreviewPayload(buildPreviewPayload())}
            className="px-2.5 py-1.5 rounded-md text-xs font-black bg-[#0D2E1D] border border-[var(--success)] text-[var(--success)] hover:bg-[var(--success)] hover:text-[#03060A] flex items-center gap-1 cursor-pointer"
          >
            <Eye className="w-3.5 h-3.5" />
            <span>معاينة / طباعة / PDF</span>
          </button>

          <button
            type="button"
            onClick={() => {
              const p = buildPreviewPayload();
              setWaPayload({ phone: p.defaultPhone, text: p.whatsappText, previewPayload: p });
            }}
            className="px-2.5 py-1.5 rounded-md text-xs font-black bg-[#0B2B17] border border-[#25D366] text-[#25D366] hover:bg-[#25D366] hover:text-[#03060A] flex items-center gap-1 cursor-pointer"
          >
            <MessageCircle className="w-3.5 h-3.5" />
            <span>واتساب (صورة/PDF)</span>
          </button>

          {currentInvoiceRecord && currentInvoiceRecord.status !== 'cancelled' && canDeleteInv && (
            <button
              type="button"
              onClick={() => setConfirmCancelOpen(true)}
              className="px-2.5 py-1.5 rounded-md text-xs font-black bg-[#2B0B0E] border border-[var(--danger)] text-[var(--danger)] hover:bg-[var(--danger)] hover:text-white flex items-center gap-1 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>إلغاء وعكس</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Split Grid: Left (Header + Department Chips + Spreadsheet) | Right (Financial Summary Box) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3 items-start">
        <div className="xl:col-span-9 space-y-2.5 min-w-0">
          {/* Document Header Form */}
          <div className="v20-card p-3 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 text-xs">
            <div className="lg:col-span-2">
              <label className="block text-[11px] font-bold text-[var(--text-secondary)] mb-1">نوع المستند</label>
              <select
                value={docKind}
                disabled={viewingIndex >= 0 && currentInvoiceRecord?.status !== 'draft'}
                onChange={(e) => setDocKind(e.target.value as WorkbenchDocKind)}
                className="w-full v20-input px-2 py-1.5 text-xs cursor-pointer"
              >
                {DOC_KIND_OPTIONS.map((op) => (
                  <option key={op.value} value={op.value}>
                    {op.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="lg:col-span-2">
              <label className="block text-[11px] font-bold text-[var(--text-secondary)] mb-1">الدفتر المستخدم</label>
              <select
                value={selectedBookId}
                onChange={(e) => setSelectedBookId(e.target.value)}
                className="w-full v20-input px-2 py-1.5 text-xs cursor-pointer"
              >
                {availableBooks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.nameAr} ({b.prefix})
                  </option>
                ))}
                {availableBooks.length === 0 && <option value="">الترقيم التلقائي الافتراضي</option>}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-[var(--text-secondary)] mb-1">رقم المستند</label>
              <input
                type="text"
                value={docNumber}
                onChange={(e) => setDocNumber(e.target.value)}
                className="w-full v20-input px-2 py-1.5 text-xs font-mono text-center text-[var(--gold)]"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-[var(--text-secondary)] mb-1">التاريخ</label>
              <input
                type="date"
                value={docDate}
                onChange={(e) => setDocDate(e.target.value)}
                className="w-full v20-input px-2 py-1.5 text-xs tabular-nums"
              />
            </div>

            <div className="lg:col-span-2">
              <label className="block text-[11px] font-bold text-[var(--text-secondary)] mb-1">
                {isPurchaseMode ? 'المورد' : isWarehouseOnlyMode ? 'الجهة / المستفيد' : 'العميل'} (بحث وتغيير أو تعديل)
              </label>
              {isWarehouseOnlyMode ? (
                <input
                  type="text"
                  value={partyQuery}
                  onChange={(e) => setPartyQuery(e.target.value)}
                  placeholder="الجهة أو المستفيد..."
                  className="w-full v20-input px-2 py-1.5 text-xs"
                />
              ) : (
                <SearchableSelect
                  options={partySelectOptions}
                  value={selectedPartyId}
                  onChange={(opt) => {
                    if (opt) {
                      setSelectedPartyId(opt.id);
                      setPartyQuery(opt.name);
                      const picked = partyPool.find((p) => p.id === opt.id);
                      if (picked && viewingIndex < 0 && !editingInvoiceId) {
                        const partyCurr = picked.currency || 'YER';
                        setCurrencyCode(partyCurr);
                        const nextRate = getEffectiveCurrencyRate(currencies, partyCurr);
                        setExchangeRate(nextRate);
                        recalculateBoundRowPrices(nextRate);
                      }
                    }
                  }}
                  placeholder={isPurchaseMode ? 'ابحث واختر المورد...' : 'ابحث واختر العميل...'}
                  searchPlaceholder="اكتب حرفين أو رقم الهاتف للبحث..."
                  onEditSelected={() => {
                    const current = partyPool.find((p) => p.id === selectedPartyId);
                    if (!current) return;
                    setEditingPartyId(current.id);
                    setQuickPartyName(current.name);
                    setQuickPartyPhone(current.phone || '');
                    setQuickPartyCurrency(current.currency || 'YER');
                    setIsQuickPartyOpen(true);
                  }}
                  editTitle="تعديل اسم أو رقم أو عملة المحدد"
                  onQuickAdd={() => {
                    setEditingPartyId(null);
                    setQuickPartyName('');
                    setQuickPartyPhone('');
                    setQuickPartyCurrency(currencyCode);
                    setIsQuickPartyOpen(true);
                  }}
                  quickAddTitle={isPurchaseMode ? 'إضافة مورد جديد' : 'إضافة عميل جديد'}
                />
              )}
            </div>

            <div>
              <label className="block text-[11px] font-bold text-[var(--text-secondary)] mb-1">الدفع</label>
              <select
                value={paymentType}
                onChange={(e) => setPaymentType(e.target.value as 'نقدي' | 'آجل' | 'جزئي')}
                className="w-full v20-input px-2 py-1.5 text-xs cursor-pointer"
              >
                <option value="نقدي">نقدي</option>
                <option value="آجل">آجل</option>
                <option value="جزئي">جزئي</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-[var(--text-secondary)] mb-1">العملة</label>
              <select
                value={currencyCode}
                onChange={(e) => {
                  const code = e.target.value as CurrencyCode;
                  setCurrencyCode(code);
                  const nextRate = getEffectiveCurrencyRate(currencies, code);
                  setExchangeRate(nextRate);
                  if (viewingIndex < 0 || currentInvoiceRecord?.status === 'draft') {
                    recalculateBoundRowPrices(nextRate);
                  }
                }}
                className="w-full v20-input px-2 py-1.5 text-xs cursor-pointer"
              >
                {currencies.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} ({c.nameAr})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-[var(--text-secondary)] mb-1">سعر الصرف</label>
              <input
                type="number"
                step="0.01"
                value={exchangeRate}
                disabled={!(currentUser.canEditExchangeRates ?? currentUser.canManageSettings)}
                onChange={(e) => {
                  const nextRate = parseFloat(e.target.value) || 1;
                  setExchangeRate(nextRate);
                  if (viewingIndex < 0 || currentInvoiceRecord?.status === 'draft') {
                    recalculateBoundRowPrices(nextRate);
                  }
                }}
                className="w-full v20-input px-2 py-1.5 text-xs text-center tabular-nums"
              />
            </div>

            <div className="lg:col-span-2">
              <label className="block text-[11px] font-bold text-[var(--text-secondary)] mb-1">الخزينة / الصندوق</label>
              <select
                value={treasuryId}
                onChange={(e) => setTreasuryId(e.target.value)}
                className="w-full v20-input px-2 py-1.5 text-xs cursor-pointer"
              >
                {treasuryAccounts
                  .filter((t) => t.status === 'active')
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nameAr} ({t.currency})
                    </option>
                  ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-[var(--text-secondary)] mb-1">
                {docKind === 'STOCK_TRANSFER' ? 'من مستودع' : 'المستودع'}
              </label>
              <select
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
                className="w-full v20-input px-2 py-1.5 text-xs cursor-pointer"
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.nameAr}
                  </option>
                ))}
              </select>
            </div>

            {docKind === 'STOCK_TRANSFER' && (
              <div>
                <label className="block text-[11px] font-bold text-[var(--gold)] mb-1">إلى مستودع</label>
                <select
                  value={destWarehouseId}
                  onChange={(e) => setDestWarehouseId(e.target.value)}
                  className="w-full v20-input px-2 py-1.5 text-xs cursor-pointer"
                >
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.nameAr}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {isFieldVisible('notes') && (
              <div className={docKind === 'STOCK_TRANSFER' ? 'lg:col-span-1' : 'lg:col-span-2'}>
                <label className="block text-[11px] font-bold text-[var(--text-secondary)] mb-1">ملاحظة</label>
                <input
                  type="text"
                  value={invoiceNotes}
                  onChange={(e) => setInvoiceNotes(e.target.value)}
                  placeholder="بيان أو مرجع..."
                  className="w-full v20-input px-2 py-1.5 text-xs"
                />
              </div>
            )}

            {salesReps.length > 0 && !isPurchaseMode && !isWarehouseOnlyMode && (
              <div>
                <label className="block text-[11px] font-bold text-[var(--text-secondary)] mb-1">المندوب</label>
                <select
                  value={selectedSalesRepId}
                  onChange={(e) => setSelectedSalesRepId(e.target.value)}
                  className="w-full v20-input px-2 py-1.5 text-xs cursor-pointer"
                >
                  <option value="">مباشر / بدون مندوب</option>
                  {salesReps.filter((e) => e.status === 'active').map((rep) => (
                    <option key={rep.id} value={rep.id}>
                      {rep.nameAr}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Department Chips & Quick New Item */}
          <div className="v20-card-alt px-3 py-2 flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] font-black text-[var(--gold)] ml-1">الأقسام:</span>
              <button
                type="button"
                onClick={() => setActiveDept('ALL')}
                className={`px-2.5 py-1 rounded text-xs font-extrabold cursor-pointer ${
                  activeDept === 'ALL'
                    ? 'bg-[var(--gold)] text-[#03060A]'
                    : 'bg-[#08121E] border border-[var(--border-strong)] text-slate-300 hover:border-[var(--gold)]'
                }`}
              >
                الكل ({inventoryItems.length})
              </button>
              {departmentChips.map((dept) => (
                <button
                  key={dept}
                  type="button"
                  onClick={() => setActiveDept(dept)}
                  className={`px-2.5 py-1 rounded text-xs font-extrabold cursor-pointer ${
                    activeDept === dept
                      ? 'bg-[var(--gold)] text-[#03060A]'
                      : 'bg-[#08121E] border border-[var(--border-strong)] text-slate-300 hover:border-[var(--gold)]'
                  }`}
                >
                  {dept}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => {
                setEditingItemId(null);
                setQuickItemCode('');
                setQuickItemName('');
                setQuickItemBarcode('');
                setQuickItemCat(departments[0]?.nameAr || 'إلكترونيات');
                setQuickItemPurchase(10000);
                setQuickItemSale(12500);
                setIsQuickItemOpen(true);
              }}
              className="px-2.5 py-1 rounded text-xs font-extrabold bg-[#08121E] border border-[var(--gold)] text-[var(--gold)] hover:bg-[var(--gold)] hover:text-[#03060A] flex items-center gap-1 cursor-pointer"
            >
              <PackagePlus className="w-3.5 h-3.5" />
              <span>+ صنف سريع</span>
            </button>
          </div>

          {/* Keyboard-Navigable Spreadsheet Grid */}
          <div className="erp-grid-wrap">
            <table className="erp-grid">
              <thead>
                <tr>
                  <th style={{ width: '36px' }}>#</th>
                  {columns
                    .filter((c) => c.visible)
                    .map((col) => (
                      <th key={col.key} style={{ width: col.width ? `${col.width}px` : undefined }}>
                        {col.label}
                      </th>
                    ))}
                  <th style={{ width: '88px' }}>إجراء</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, rIdx) => {
                  const calc = calcRowLine(r);
                  const acQuery = acColKey === 'barcode' ? r.barcode : r.itemName;
                  const acMatches = acRowIdx === rIdx ? getAutocompleteMatches(acQuery) : [];
                  const availableQty = r.itemId ? getItemStockInWarehouse(warehouseStock, r.itemId, warehouseId) : 0;

                  const renderItemAutocompleteMenu = () => {
                    if (acRowIdx !== rIdx || acMatches.length === 0) return null;
                    return (
                      <div className="grid-autocomplete-menu top-full right-0 w-80 z-50">
                        {acMatches.map((it, mIdx) => {
                          const stockQty = getItemStockInWarehouse(warehouseStock, it.id, warehouseId);
                          return (
                            <button
                              key={it.id}
                              type="button"
                              onMouseDown={() => {
                                applyItemToRow(rIdx, it);
                                focusCell(rIdx, 'qty');
                              }}
                              className={`w-full text-right px-2.5 py-1.5 text-xs font-bold flex items-center justify-between gap-2 border-b border-slate-800 cursor-pointer ${
                                mIdx === acHighlightIdx
                                  ? 'bg-[var(--gold)] text-[#03060A]'
                                  : 'text-white hover:bg-slate-800'
                              }`}
                            >
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span
                                  className={`font-mono text-[10px] px-1 rounded shrink-0 ${
                                    mIdx === acHighlightIdx
                                      ? 'bg-black/20 text-[#03060A]'
                                      : 'bg-slate-800 text-amber-300'
                                  }`}
                                >
                                  #{it.code || it.barcode}
                                </span>
                                <span className="truncate">{it.nameAr}</span>
                              </div>
                              <span className="text-[10px] shrink-0 tabular-nums opacity-85">
                                رصيد:{stockQty} · {isPurchaseMode ? it.purchasePrice : it.salePrice}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    );
                  };

                  return (
                    <tr key={r.rowKey}>
                      <td className="text-center font-bold text-slate-400 tabular-nums">{rIdx + 1}</td>

                      {columns
                        .filter((c) => c.visible)
                        .map((col) => {
                          if (col.key === 'barcode') {
                            return (
                              <td key={col.key} className="relative">
                                <input
                                  ref={registerCell(rIdx, 'barcode')}
                                  type="text"
                                  disabled={isReadOnlyPosted}
                                  value={r.barcode}
                                  onFocus={() => {
                                    setAcRowIdx(rIdx);
                                    setAcColKey('barcode');
                                    setAcHighlightIdx(0);
                                  }}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setAcRowIdx(rIdx);
                                    setAcColKey('barcode');
                                    setAcHighlightIdx(0);
                                    setRows((prev) =>
                                      prev.map((x, idx) => (idx === rIdx ? { ...x, barcode: val } : x))
                                    );
                                  }}
                                  onBlur={() => setTimeout(() => setAcRowIdx((cur) => (cur === rIdx ? null : cur)), 180)}
                                  onKeyDown={(e) => handleCellKeyDown(e, rIdx, 'barcode')}
                                  placeholder="الرقم / باركود"
                                  className="cell-input font-mono text-center"
                                />
                                {acColKey === 'barcode' && renderItemAutocompleteMenu()}
                              </td>
                            );
                          }

                          if (col.key === 'name') {
                            return (
                              <td key={col.key} className="relative">
                                <input
                                  ref={registerCell(rIdx, 'name')}
                                  type="text"
                                  disabled={isReadOnlyPosted}
                                  value={r.itemName}
                                  onFocus={() => {
                                    setAcRowIdx(rIdx);
                                    setAcColKey('name');
                                    setAcHighlightIdx(0);
                                    setActivePriceRowIdx(rIdx);
                                  }}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setAcRowIdx(rIdx);
                                    setAcColKey('name');
                                    setAcHighlightIdx(0);
                                    setRows((prev) =>
                                      prev.map((x, idx) =>
                                        idx === rIdx ? { ...x, itemName: val, itemId: '' } : x
                                      )
                                    );
                                  }}
                                  onBlur={() => setTimeout(() => setAcRowIdx((cur) => (cur === rIdx ? null : cur)), 180)}
                                  onKeyDown={(e) => handleCellKeyDown(e, rIdx, 'name')}
                                  placeholder="اكتب اسم الصنف أو الرقم..."
                                  className="cell-input font-bold"
                                />
                                {r.itemId && (
                                  <span className="block px-1 text-[10px] text-emerald-400 font-bold tabular-nums">
                                    متاح بالمخزن: {availableQty}
                                  </span>
                                )}
                                {acColKey === 'name' && renderItemAutocompleteMenu()}
                              </td>
                            );
                          }

                          if (col.key === 'unit') {
                            const itemObj = inventoryItems.find((i) => i.id === r.itemId);
                            return (
                              <td key={col.key}>
                                <select
                                  ref={registerCell(rIdx, 'unit')}
                                  disabled={isReadOnlyPosted}
                                  value={r.unit}
                                  onChange={(e) =>
                                    setRows((prev) =>
                                      prev.map((x, idx) => (idx === rIdx ? { ...x, unit: e.target.value } : x))
                                    )
                                  }
                                  onKeyDown={(e) => handleCellKeyDown(e, rIdx, 'unit')}
                                  className="cell-input text-center cursor-pointer"
                                >
                                  <option value={itemObj?.baseUnit || 'حبة'}>{itemObj?.baseUnit || 'حبة'}</option>
                                  {itemObj?.secondaryUnit && (
                                    <option value={itemObj.secondaryUnit}>{itemObj.secondaryUnit}</option>
                                  )}
                                  <option value="درزن">درزن</option>
                                  <option value="كرتون">كرتون</option>
                                </select>
                              </td>
                            );
                          }

                          if (col.key === 'qty') {
                            return (
                              <td key={col.key}>
                                <input
                                  ref={registerCell(rIdx, 'qty')}
                                  type="number"
                                  min={0}
                                  step="any"
                                  disabled={isReadOnlyPosted}
                                  value={r.quantity}
                                  onChange={(e) =>
                                    setRows((prev) =>
                                      prev.map((x, idx) =>
                                        idx === rIdx ? { ...x, quantity: parseFloat(e.target.value) || 0 } : x
                                      )
                                    )
                                  }
                                  onKeyDown={(e) => handleCellKeyDown(e, rIdx, 'qty')}
                                  className="cell-input text-center font-bold tabular-nums"
                                />
                              </td>
                            );
                          }

                          if (col.key === 'bonus') {
                            return (
                              <td key={col.key}>
                                <input
                                  ref={registerCell(rIdx, 'bonus')}
                                  type="number"
                                  min={0}
                                  disabled={isReadOnlyPosted}
                                  value={r.bonusQuantity}
                                  onChange={(e) =>
                                    setRows((prev) =>
                                      prev.map((x, idx) =>
                                        idx === rIdx ? { ...x, bonusQuantity: parseFloat(e.target.value) || 0 } : x
                                      )
                                    )
                                  }
                                  onKeyDown={(e) => handleCellKeyDown(e, rIdx, 'bonus')}
                                  className="cell-input text-center tabular-nums text-emerald-300"
                                />
                              </td>
                            );
                          }

                          if (col.key === 'cost') {
                            return (
                              <td key={col.key}>
                                <input
                                  ref={registerCell(rIdx, 'cost')}
                                  type="number"
                                  disabled={isReadOnlyPosted}
                                  value={r.unitCost}
                                  onChange={(e) =>
                                    setRows((prev) =>
                                      prev.map((x, idx) =>
                                        idx === rIdx ? { ...x, unitCost: parseFloat(e.target.value) || 0 } : x
                                      )
                                    )
                                  }
                                  onKeyDown={(e) => handleCellKeyDown(e, rIdx, 'cost')}
                                  className="cell-input text-center tabular-nums text-amber-300"
                                />
                              </td>
                            );
                          }

                          if (col.key === 'price') {
                            const itemIntel = r.itemId ? priceIntelligenceIndex.get(r.itemId) : undefined;
                            const partySnap =
                              r.itemId && selectedPartyId && !isWarehouseOnlyMode && itemIntel
                                ? itemIntel.partyLastPrices.get(`${selectedPartyId}:${isPurchaseMode ? 'P' : 'S'}`) || null
                                : null;
                            const partyLastPrice = partySnap
                              ? convertBasePriceToTargetCurrency(
                                  partySnap.baseUnitPrice,
                                  partySnap.originalPrice,
                                  partySnap.originalCurrency,
                                  currencyCode,
                                  exchangeRate,
                                  currencies
                                )
                              : null;
                            const generalRefSnap = isPurchaseMode ? itemIntel?.lastPurchase : itemIntel?.lastSaleGeneral;
                            const generalRefPrice = generalRefSnap
                              ? convertBasePriceToTargetCurrency(
                                  generalRefSnap.baseUnitPrice,
                                  generalRefSnap.originalPrice,
                                  generalRefSnap.originalCurrency,
                                  currencyCode,
                                  exchangeRate,
                                  currencies
                                )
                              : null;

                            return (
                              <td key={col.key}>
                                <div className="flex items-center gap-0.5">
                                  <input
                                    ref={registerCell(rIdx, 'price')}
                                    type="number"
                                    min={0}
                                    step="any"
                                    disabled={isReadOnlyPosted}
                                    value={r.unitPrice}
                                    onFocus={() => setActivePriceRowIdx(rIdx)}
                                    onChange={(e) =>
                                      setRows((prev) =>
                                        prev.map((x, idx) =>
                                          idx === rIdx ? { ...x, unitPrice: parseFloat(e.target.value) || 0 } : x
                                        )
                                      )
                                    }
                                    onKeyDown={(e) => handleCellKeyDown(e, rIdx, 'price')}
                                    className="cell-input text-center font-bold tabular-nums"
                                  />
                                  {r.itemId && !isWarehouseOnlyMode && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setPriceLookupState({
                                          open: true,
                                          rowIdx: rIdx,
                                          itemId: r.itemId,
                                        })
                                      }
                                      title="عرض سجل أسعار هذا الصنف للعميل والعملاء الآخرين"
                                      className="p-1 text-sky-300 hover:text-[var(--gold)] cursor-pointer shrink-0"
                                    >
                                      <Tag className="w-3 h-3" />
                                    </button>
                                  )}
                                </div>
                                {partySnap && partyLastPrice !== null && (
                                  <button
                                    type="button"
                                    disabled={isReadOnlyPosted}
                                    onClick={() => {
                                      setRows((prev) =>
                                        prev.map((x, idx) =>
                                          idx === rIdx ? { ...x, unitPrice: partyLastPrice } : x
                                        )
                                      );
                                      onNotify(
                                        'info',
                                        `تم تطبيق آخر سعر ${isPurchaseMode ? 'شراء' : 'بيع'} للطرف (${partyLastPrice.toLocaleString()} ${currencyCode}) من فاتورة ${partySnap.invoiceNumber}.`
                                      );
                                    }}
                                    title={`بتاريخ ${partySnap.date} · فاتورة #${partySnap.invoiceNumber} — اضغط لتطبيق السعر`}
                                    className="block w-full text-center px-1 text-[10px] text-amber-300 hover:text-[var(--gold)] font-bold tabular-nums truncate cursor-pointer disabled:opacity-60"
                                  >
                                    للطرف ({partySnap.date}): {partyLastPrice.toLocaleString()}
                                  </button>
                                )}
                                {!partySnap && generalRefSnap && generalRefPrice !== null && (
                                  <div
                                    title={`${isPurchaseMode ? 'آخر شراء عام' : 'آخر بيع عام'} (${generalRefSnap.partyName} - ${generalRefSnap.date})`}
                                    className="block w-full text-center px-1 text-[9px] text-sky-300 font-semibold tabular-nums truncate"
                                  >
                                    {isPurchaseMode ? 'آخر شراء' : 'آخر بيع'}: {generalRefPrice.toLocaleString()} ({generalRefSnap.date})
                                  </div>
                                )}
                              </td>
                            );
                          }

                          if (col.key === 'discount') {
                            return (
                              <td key={col.key}>
                                <input
                                  ref={registerCell(rIdx, 'discount')}
                                  type="number"
                                  min={0}
                                  max={100}
                                  disabled={isReadOnlyPosted}
                                  value={r.discountPercentage}
                                  onChange={(e) =>
                                    setRows((prev) =>
                                      prev.map((x, idx) =>
                                        idx === rIdx
                                          ? { ...x, discountPercentage: parseFloat(e.target.value) || 0 }
                                          : x
                                      )
                                    )
                                  }
                                  onKeyDown={(e) => handleCellKeyDown(e, rIdx, 'discount')}
                                  className="cell-input text-center tabular-nums"
                                />
                              </td>
                            );
                          }

                          if (col.key === 'tax') {
                            return (
                              <td key={col.key}>
                                <input
                                  ref={registerCell(rIdx, 'tax')}
                                  type="number"
                                  min={0}
                                  disabled={isReadOnlyPosted}
                                  value={r.taxPercentage}
                                  onChange={(e) =>
                                    setRows((prev) =>
                                      prev.map((x, idx) =>
                                        idx === rIdx ? { ...x, taxPercentage: parseFloat(e.target.value) || 0 } : x
                                      )
                                    )
                                  }
                                  onKeyDown={(e) => handleCellKeyDown(e, rIdx, 'tax')}
                                  className="cell-input text-center tabular-nums"
                                />
                              </td>
                            );
                          }

                          if (col.key === 'total') {
                            return (
                              <td
                                key={col.key}
                                className="px-2 text-center font-black text-[var(--gold)] tabular-nums"
                              >
                                {calc.total.toLocaleString()}
                              </td>
                            );
                          }

                          if (col.key === 'notes') {
                            return (
                              <td key={col.key}>
                                <input
                                  ref={registerCell(rIdx, 'notes')}
                                  type="text"
                                  disabled={isReadOnlyPosted}
                                  value={r.notes}
                                  onChange={(e) =>
                                    setRows((prev) =>
                                      prev.map((x, idx) => (idx === rIdx ? { ...x, notes: e.target.value } : x))
                                    )
                                  }
                                  onKeyDown={(e) => handleCellKeyDown(e, rIdx, 'notes')}
                                  placeholder="ملاحظة..."
                                  className="cell-input"
                                />
                              </td>
                            );
                          }

                          // Custom Added Column
                          return (
                            <td key={col.key}>
                              <input
                                ref={registerCell(rIdx, col.key)}
                                type="text"
                                disabled={isReadOnlyPosted}
                                value={r.customValues[col.key] || ''}
                                onChange={(e) =>
                                  setRows((prev) =>
                                    prev.map((x, idx) =>
                                      idx === rIdx
                                        ? { ...x, customValues: { ...x.customValues, [col.key]: e.target.value } }
                                        : x
                                    )
                                  )
                                }
                                onKeyDown={(e) => handleCellKeyDown(e, rIdx, col.key)}
                                className="cell-input"
                              />
                            </td>
                          );
                        })}

                      <td className="px-1">
                        <div className="flex items-center justify-center gap-1">
                          {r.itemId && (
                            <button
                              type="button"
                              onClick={() => {
                                const it = inventoryItems.find((x) => x.id === r.itemId);
                                if (!it) return;
                                setEditingItemId(it.id);
                                setQuickItemCode(it.code);
                                setQuickItemName(it.nameAr);
                                setQuickItemBarcode(it.barcode);
                                setQuickItemCat(it.category);
                                setQuickItemPurchase(it.purchasePrice);
                                setQuickItemSale(it.salePrice);
                                setIsQuickItemOpen(true);
                              }}
                              title="تعديل بيانات هذا الصنف"
                              className="p-1 rounded bg-[#08121E] border border-sky-500/60 text-sky-300 hover:border-[var(--gold)] hover:text-[var(--gold)] cursor-pointer"
                            >
                              <Edit3 className="w-3 h-3" />
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={isReadOnlyPosted}
                            onClick={() => duplicateRow(rIdx)}
                            title="تكرار الصف"
                            className="p-1 rounded bg-[#08121E] border border-[var(--border-strong)] text-sky-300 hover:border-[var(--gold)] disabled:opacity-40 cursor-pointer"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            disabled={isReadOnlyPosted}
                            onClick={() => deleteRow(rIdx)}
                            title="حذف الصف"
                            className="p-1 rounded bg-[#2B0B0E] border border-[var(--danger)] text-[var(--danger)] hover:bg-[var(--danger)] hover:text-white disabled:opacity-40 cursor-pointer"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between flex-wrap gap-2">
            <button
              type="button"
              disabled={isReadOnlyPosted}
              onClick={() => addNewRowAndFocus('name')}
              className="px-3.5 py-1.5 rounded-lg text-xs font-black bg-[#08121E] border-2 border-[var(--gold)] text-[var(--gold)] hover:bg-[var(--gold)] hover:text-[#03060A] flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>+ إضافة صف جديد (أو ↑ ↓ Enter بالجدول)</span>
            </button>
            <span className="text-[11px] text-[var(--text-secondary)]">
              تلميح: اضغط ↑ ↓ للتنقل بين الصفوف · Ctrl+←/→ بين الأعمدة · Enter للانتقال السريع
            </span>
          </div>

          {/* Active Row Price Intelligence Bar (Separates Weighted Average Cost from Actual Last Purchase & Last Sale Prices) */}
          {(() => {
            const focusedRow = rows[activePriceRowIdx]?.itemId
              ? rows[activePriceRowIdx]
              : rows.find((r) => Boolean(r.itemId));
            if (!focusedRow || !focusedRow.itemId || isWarehouseOnlyMode) return null;
            const focusedIdx = rows.indexOf(focusedRow);
            const itemIntel = priceIntelligenceIndex.get(focusedRow.itemId);
            const wsRec = warehouseStockMap.get(focusedRow.itemId);
            const catItem = inventoryItems.find((it) => it.id === focusedRow.itemId);
            const weightedAvgBase = wsRec && wsRec.averageCost > 0 ? wsRec.averageCost : catItem?.purchasePrice || focusedRow.unitCost;
            const lastPur = itemIntel?.lastPurchase || null;
            const lastSale = itemIntel?.lastSaleGeneral || null;
            const partyPrice =
              selectedPartyId && itemIntel
                ? itemIntel.partyLastPrices.get(`${selectedPartyId}:${isPurchaseMode ? 'P' : 'S'}`) || null
                : null;
            const sym = getCurrencySymbol(currencies, currencyCode);

            const convertSnap = (snap: typeof lastPur) =>
              snap
                ? convertBasePriceToTargetCurrency(
                    snap.baseUnitPrice,
                    snap.originalPrice,
                    snap.originalCurrency,
                    currencyCode,
                    exchangeRate,
                    currencies
                  )
                : null;

            const lastPurTarget = convertSnap(lastPur);
            const lastSaleTarget = convertSnap(lastSale);
            const partyTarget = convertSnap(partyPrice);
            const advisor = getDistinctItemPriceAdvisor({
              itemId: focusedRow.itemId,
              customerId: !isPurchaseMode ? selectedPartyId : undefined,
              invoices,
              customers,
              inventoryItems,
              currencies,
            });

            return (
              <div className="v20-card-alt p-2.5 border border-sky-500/30 rounded-lg text-[11px] space-y-1.5">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="font-black text-sky-300 flex items-center gap-1.5">
                    <Tag className="w-3.5 h-3.5 text-[var(--gold)]" />
                    <span>الذاكرة السعرية للصنف المحدد: {focusedRow.itemName}</span>
                  </span>
                  <span className={`text-[10px] font-bold ${advisor.hasCustomerSpecificHistory ? 'text-emerald-300' : 'text-amber-300'}`}>
                    {advisor.customerNoticeAr}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                  {canViewCost && (
                    <div className="bg-[#060D15] border border-slate-800 rounded p-2">
                      <div className="text-[10px] text-slate-400">متوسط التكلفة المرجح بالمخزن:</div>
                      <div className="font-black text-amber-300 tabular-nums mt-0.5">
                        {Math.round(weightedAvgBase * 100) / 100} ر.ي
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {wsRec ? `كمية متاحة: ${wsRec.quantityOnHand}` : 'التكلفة التقديرية بالدليل'}
                      </div>
                    </div>
                  )}

                  {canViewCost && (
                    <div className="bg-[#060D15] border border-slate-800 rounded p-2">
                      <div className="text-[10px] text-slate-400">آخر سعر شراء عام (غير متوسط):</div>
                      {lastPur && lastPurTarget !== null ? (
                        <>
                          <div className="font-black text-emerald-300 tabular-nums mt-0.5">
                            {lastPurTarget.toLocaleString()} {sym}
                          </div>
                          <div className="text-[10px] text-slate-400 truncate">
                            {lastPur.date} · {lastPur.partyName}
                          </div>
                        </>
                      ) : (
                        <div className="text-slate-500 mt-0.5">لا توجد فاتورة شراء سابقة</div>
                      )}
                    </div>
                  )}

                  <div className="bg-[#060D15] border border-slate-800 rounded p-2">
                    <div className="text-[10px] text-slate-400">آخر سعر بيع عام:</div>
                    {lastSale && lastSaleTarget !== null ? (
                      <div className="flex items-center justify-between gap-1 mt-0.5">
                        <div>
                          <div className="font-black text-cyan-300 tabular-nums">
                            {lastSaleTarget.toLocaleString()} {sym}
                          </div>
                          <div className="text-[10px] text-slate-400 truncate">
                            {lastSale.date} · {lastSale.partyName}
                          </div>
                        </div>
                        {!isReadOnlyPosted && !isPurchaseMode && (
                          <button
                            type="button"
                            onClick={() => {
                              setRows((prev) =>
                                prev.map((x, idx) => (idx === focusedIdx ? { ...x, unitPrice: lastSaleTarget } : x))
                              );
                              onNotify('info', `تم تطبيق آخر سعر بيع عام (${lastSaleTarget.toLocaleString()} ${currencyCode}).`);
                            }}
                            className="px-2 py-0.5 rounded bg-cyan-950 border border-cyan-500/40 text-cyan-200 text-[10px] font-bold cursor-pointer shrink-0"
                          >
                            اعتماد
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="text-slate-500 mt-0.5">لا توجد فاتورة بيع سابقة</div>
                    )}
                  </div>

                  <div className="bg-[#060D15] border border-amber-500/30 rounded p-2">
                    <div className="text-[10px] text-amber-300">آخر سعر للطرف الحالي:</div>
                    {partyPrice && partyTarget !== null ? (
                      <div className="flex items-center justify-between gap-1 mt-0.5">
                        <div>
                          <div className="font-black text-[var(--gold)] tabular-nums">
                            {partyTarget.toLocaleString()} {sym}
                          </div>
                          <div className="text-[10px] text-slate-400 truncate">
                            {partyPrice.date} · #{partyPrice.invoiceNumber}
                          </div>
                        </div>
                        {!isReadOnlyPosted && (
                          <button
                            type="button"
                            onClick={() => {
                              setRows((prev) =>
                                prev.map((x, idx) => (idx === focusedIdx ? { ...x, unitPrice: partyTarget } : x))
                              );
                              onNotify('info', `تم تطبيق آخر سعر للطرف (${partyTarget.toLocaleString()} ${currencyCode}).`);
                            }}
                            className="px-2 py-0.5 rounded bg-amber-950 border border-amber-500/50 text-[var(--gold)] text-[10px] font-bold cursor-pointer shrink-0"
                          >
                            اعتماد
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="text-amber-200/80 mt-0.5">
                        {isPurchaseMode ? 'لا يوجد تعامل سابق مع هذا المورد' : 'لا توجد مبيعات سابقة لهذا العميل لهذا الصنف'}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}
        </div>

        {/* Right Sticky Financial Summary & Balance Panel */}
        <div className="xl:col-span-3 v20-card p-3.5 space-y-2.5 text-xs sticky top-4">
          <div className="flex items-center justify-between border-b-2 border-[var(--gold)] pb-2">
            <span className="font-black text-sm text-[var(--gold)]">الملخص المالي والأرصدة</span>
            <span className="font-mono font-bold text-slate-300">{currencyCode}</span>
          </div>

          <div className="flex justify-between py-1 border-b border-[var(--border-strong)]">
            <span className="text-[var(--text-secondary)]">إجمالي قبل الخصم:</span>
            <span className="font-black tabular-nums">{summary.subtotal.toLocaleString()}</span>
          </div>

          <div className="flex items-center justify-between gap-2 py-1 border-b border-[var(--border-strong)]">
            <span className="text-[var(--text-secondary)]">خصم إضافي ({currencyCode}):</span>
            <input
              type="number"
              min={0}
              disabled={isReadOnlyPosted}
              value={invoiceDiscount}
              onChange={(e) => setInvoiceDiscount(parseFloat(e.target.value) || 0)}
              className="w-24 v20-input px-2 py-1 text-xs text-center tabular-nums"
            />
          </div>

          <div className="flex justify-between py-1 border-b border-[var(--border-strong)]">
            <span className="text-[var(--text-secondary)]">الضريبة (VAT):</span>
            <span className="font-bold text-amber-300 tabular-nums">{summary.taxTotal.toLocaleString()}</span>
          </div>

          <div className="bg-[#050B12] border-2 border-[var(--gold)] rounded-lg p-2.5 space-y-1">
            <div className="flex justify-between items-center">
              <span className="font-black text-[var(--gold)]">الصافي النهائي:</span>
              <span className="font-black text-lg text-[var(--gold)] tabular-nums">
                {summary.grandTotal.toLocaleString()} {getCurrencySymbol(currencies, currencyCode)}
              </span>
            </div>
            {currencyCode !== 'YER' && (
              <div className="flex justify-between items-center text-[10px] text-slate-400 tabular-nums border-t border-slate-800/80 pt-1">
                <span>المعادل باليمني (×{exchangeRate}):</span>
                <span className="font-bold text-slate-300">
                  {convertToBase(summary.grandTotal, currencyCode, currencies, exchangeRate).toLocaleString()} ر.ي
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 py-1">
            <span className="text-[var(--text-secondary)] font-bold">المدفوع / المستلم:</span>
            <input
              type="number"
              min={0}
              disabled={isReadOnlyPosted || paymentType === 'آجل'}
              value={paidAmount}
              onChange={(e) => setPaidAmount(parseFloat(e.target.value) || 0)}
              className="w-28 v20-input px-2 py-1 text-xs text-center font-black text-emerald-300 tabular-nums"
            />
          </div>

          {!isWarehouseOnlyMode && paymentType !== 'آجل' && !isReadOnlyPosted && (
            <div className="bg-[#060D15] border border-slate-800 rounded p-2 space-y-1.5 text-[11px]">
              <label className="flex items-center justify-between cursor-pointer text-slate-300">
                <span>دفع متعدد الوسائل (نقد + شبكة/تحويل)</span>
                <input
                  type="checkbox"
                  checked={useSplitPayment}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setUseSplitPayment(checked);
                    if (checked) {
                      setPaymentSplitCash(Number(paidAmount) || 0);
                      setPaymentSplitBank(0);
                    }
                  }}
                  className="accent-[var(--gold)]"
                />
              </label>
              {useSplitPayment && (
                <div className="grid grid-cols-2 gap-1.5">
                  <div>
                    <span className="text-[10px] text-slate-400 block">نقداً</span>
                    <input
                      type="number"
                      min={0}
                      value={paymentSplitCash}
                      onChange={(e) => {
                        const c = parseFloat(e.target.value) || 0;
                        setPaymentSplitCash(c);
                        setPaidAmount(Math.round((c + paymentSplitBank) * 100) / 100);
                      }}
                      className="w-full v20-input px-1.5 py-1 text-[11px] text-center"
                    />
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block">بنك / شبكة</span>
                    <input
                      type="number"
                      min={0}
                      value={paymentSplitBank}
                      onChange={(e) => {
                        const b = parseFloat(e.target.value) || 0;
                        setPaymentSplitBank(b);
                        setPaidAmount(Math.round((paymentSplitCash + b) * 100) / 100);
                      }}
                      className="w-full v20-input px-1.5 py-1 text-[11px] text-center"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-between py-1 border-b border-[var(--border-strong)]">
            <span className="text-[var(--text-secondary)] font-bold">المتبقي (ذمم):</span>
            <span className="font-black text-rose-400 tabular-nums">
              {remainingAmount.toLocaleString()} {currencyCode}
            </span>
          </div>

          {!isWarehouseOnlyMode && (
            <div className="bg-[#060D15] border border-[var(--border-strong)] rounded-lg p-2.5 space-y-1.5 text-[11px]">
              <div className="text-[10px] font-black text-sky-300 border-b border-slate-800 pb-1">
                معادلة الرصيد المباشرة: (الفاتورة - المدفوع = المتبقي)
              </div>
              <div className="flex justify-between items-center text-[10px] tabular-nums text-slate-300">
                <span>{summary.grandTotal.toLocaleString()} - {(Number(paidAmount) || 0).toLocaleString()} =</span>
                <strong className="text-rose-300">{remainingAmount.toLocaleString()} {currencyCode}</strong>
              </div>
              <div className="flex justify-between items-start gap-2 pt-1">
                <span className="text-slate-400">
                  رصيد الطرف السابق {isForeignParty ? `(${partyNativeCurrency})` : '(YER)'}:
                </span>
                {isForeignParty ? (
                  <div className="text-left leading-tight tabular-nums">
                    <div className="font-black text-emerald-300">
                      {prevBalanceNative.toLocaleString()} {partyNativeCurrency === 'SAR' ? 'ر.س' : partyNativeCurrency}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      {prevBalanceBase.toLocaleString()} ر.ي (×{partyNativeRate})
                    </div>
                  </div>
                ) : (
                  <span className="font-bold text-white tabular-nums">{prevBalanceBase.toLocaleString()} ر.ي</span>
                )}
              </div>
              <div className="flex justify-between items-start gap-2 border-t border-slate-800 pt-1">
                <span className="text-[var(--gold)] font-bold">الرصيد النهائي المتوقع:</span>
                {isForeignParty ? (
                  <div className="text-left leading-tight tabular-nums">
                    <div className="font-black text-emerald-300">
                      {newStandingBalanceNative.toLocaleString()} {partyNativeCurrency === 'SAR' ? 'ر.س' : partyNativeCurrency}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      {newStandingBalanceBase.toLocaleString()} ر.ي
                    </div>
                  </div>
                ) : (
                  <span className="font-black text-[var(--gold)] tabular-nums">
                    {newStandingBalanceBase.toLocaleString()} ر.ي
                  </span>
                )}
              </div>
              {liveBalancePreview.creditLimitBase > 0 && (
                <div className={`text-[10px] rounded px-2 py-1 border ${liveBalancePreview.exceedsCreditLimit ? 'bg-rose-950/60 border-rose-500/60 text-rose-300 font-bold' : 'bg-slate-900 border-slate-800 text-slate-400'}`}>
                  <div className="flex justify-between">
                    <span>الحد الائتماني:</span>
                    <span className="tabular-nums">{liveBalancePreview.creditLimitBase.toLocaleString()} ({liveBalancePreview.creditUtilizationPct}%)</span>
                  </div>
                  {liveBalancePreview.exceedsCreditLimit && (
                    <div className="mt-0.5">تحذير: الفاتورة تتجاوز الحد الائتماني المسموح للعميل!</div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 gap-2 pt-1">
            {!isWarehouseOnlyMode && (
              <button
                type="button"
                disabled={isReadOnlyPosted || isCancelledDoc}
                onClick={() => handleSaveOrPost(true)}
                className="w-full py-2 rounded-lg text-xs font-extrabold bg-[#08121E] border-2 border-[var(--info)] text-[var(--info)] hover:bg-[var(--info)] hover:text-[#03060A] flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40"
              >
                <Save className="w-4 h-4" />
                <span>حفظ كمسودة (Draft)</span>
              </button>
            )}

            <button
              type="button"
              disabled={isReadOnlyPosted || isCancelledDoc}
              onClick={() => handleSaveOrPost(false)}
              className="w-full py-2.5 rounded-lg text-sm v20-btn-gold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>ترحيل وحفظ المستند نهائياً</span>
            </button>
          </div>
        </div>
      </div>

      {/* Invoices Search Modal */}
      {isSearchModalOpen && (() => {
        const buildBatchInvoiceDocs = (): ReportPDFOptions[] =>
          searchResults
            .filter((inv) => inv.status !== 'cancelled')
            .slice(0, 60)
            .map((inv) => {
              const docLabel =
                inv.type === 'مبيعات'
                  ? 'فاتورة مبيعات'
                  : inv.type === 'مشتريات'
                  ? 'فاتورة مشتريات'
                  : inv.type === 'مرتجع_مبيعات'
                  ? 'إشعار مرتجع مبيعات'
                  : 'إشعار مرتجع مشتريات';
              const whName = warehouses.find((w) => w.id === inv.warehouseId)?.nameAr || inv.warehouseId;
              return {
                docType: 'invoice',
                printTemplates,
                title: `${docLabel} #${inv.invoiceNumber}`,
                subtitle: `${inv.type === 'مشتريات' || inv.type === 'مرتجع_مشتريات' ? 'المورد' : 'العميل'}: ${inv.entityName}`,
                reportCode: inv.invoiceNumber,
                periodText: inv.date,
                company,
                branch: currentBranch,
                preparedBy: inv.createdBy || currentUser.fullName,
                notes: inv.notes,
                metadata: {
                  'رقم المستند': inv.invoiceNumber,
                  'التاريخ': inv.date,
                  'الطرف المعني': inv.entityName,
                  'نوع الدفع': inv.paymentType,
                  'المستودع': whName,
                  'العملة': `${inv.currency} (×${inv.exchangeRate || 1})`,
                },
                tables: [
                  {
                    title: 'تفاصيل البنود',
                    headers: ['#', 'الصنف', 'الوحدة', 'الكمية', 'السعر', 'الخصم', 'الضريبة', 'الإجمالي'],
                    rows: inv.items.map((it, idx) => [
                      idx + 1,
                      it.itemName,
                      it.unit,
                      it.bonusQuantity ? `${it.quantity} (+${it.bonusQuantity})` : it.quantity,
                      it.unitPrice.toLocaleString(),
                      it.discountAmount ? it.discountAmount.toLocaleString() : '0',
                      it.taxAmount ? it.taxAmount.toLocaleString() : '0',
                      `${it.total.toLocaleString()} ${inv.currency}`,
                    ]),
                    totals: [
                      '-',
                      'الإجمالي النهائي',
                      '',
                      inv.items.reduce((s, x) => s + x.quantity, 0),
                      '',
                      inv.discountTotal.toLocaleString(),
                      inv.taxTotal.toLocaleString(),
                      `${inv.grandTotal.toLocaleString()} ${inv.currency}`,
                    ],
                  },
                ],
                summaryCards: [
                  { label: 'الصافي النهائي', value: `${inv.grandTotal.toLocaleString()} ${inv.currency}`, tone: 'gold' },
                  { label: 'المدفوع', value: `${inv.paidAmount.toLocaleString()} ${inv.currency}`, tone: 'green' },
                  { label: 'المتبقي', value: `${inv.remainingAmount.toLocaleString()} ${inv.currency}`, tone: 'red' },
                ],
              };
            });
        return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85" dir="rtl">
          <div className="bg-[var(--bg-card)] border-[3px] border-[var(--gold)] rounded-xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden">
            <div className="px-4 py-3 bg-[#071019] border-b-2 border-[var(--gold)] flex flex-wrap items-center justify-between gap-2">
              <span className="font-black text-[var(--gold)] text-sm">
                البحث والاستعراض في الفواتير ({searchResults.length})
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    const docs = buildBatchInvoiceDocs();
                    if (docs.length === 0) {
                      onNotify('error', 'لا توجد فواتير نشطة للطباعة الجماعية.');
                      return;
                    }
                    printBatchDocuments(docs);
                    onNotify('info', `تم تجهيز طباعة دفعة مكونة من ${docs.length} فاتورة.`);
                  }}
                  className="px-2.5 py-1 rounded bg-[var(--gold)] text-[#03060A] text-xs font-black flex items-center gap-1 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>طباعة دفعة الفواتير</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const docs = buildBatchInvoiceDocs();
                    if (docs.length === 0) {
                      onNotify('error', 'لا توجد فواتير نشطة للتصدير.');
                      return;
                    }
                    void downloadBatchReportAsPDF(docs, `دفعة_الفواتير_${new Date().toISOString().slice(0, 10)}`);
                    onNotify('success', `تم إنشاء ملف PDF موحد لـ ${docs.length} فاتورة.`);
                  }}
                  className="px-2.5 py-1 rounded bg-[var(--info)] text-[#03060A] text-xs font-black flex items-center gap-1 cursor-pointer"
                >
                  <FileDown className="w-3.5 h-3.5" />
                  <span>دفعة PDF</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsSearchModalOpen(false)}
                  className="px-2.5 py-1 rounded bg-[#2B0B0E] border border-[var(--danger)] text-[var(--danger)] text-xs font-bold cursor-pointer"
                >
                  إغلاق
                </button>
              </div>
            </div>
            <div className="p-3 border-b border-[var(--border-strong)]">
              <input
                type="text"
                autoFocus
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="ابحث برقم الفاتورة أو اسم العميل/المورد أو نوع الفاتورة..."
                className="w-full v20-input px-3 py-2 text-xs"
              />
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              <table className="w-full text-right text-xs border-collapse">
                <thead className="bg-[#0B192C] text-[var(--gold)] border-b border-[var(--gold)]">
                  <tr>
                    <th className="p-2">الرقم</th>
                    <th className="p-2">النوع</th>
                    <th className="p-2">التاريخ</th>
                    <th className="p-2">العميل / المورد</th>
                    <th className="p-2 text-center">الصافي</th>
                    <th className="p-2 text-center">الحالة</th>
                    <th className="p-2 text-center">فتح</th>
                  </tr>
                </thead>
                <tbody>
                  {searchResults.map((inv) => {
                    const origIdx = sortedInvoices.findIndex((x) => x.id === inv.id);
                    const invCurr = inv.currency || 'YER';
                    const invSym = getCurrencySymbol(currencies, invCurr);
                    const invBase = convertToBase(inv.grandTotal, invCurr, currencies, inv.exchangeRate);
                    const statusLabel =
                      inv.status === 'paid'
                        ? 'مدفوعة'
                        : inv.status === 'partial'
                        ? 'مدفوعة جزئياً'
                        : inv.status === 'draft'
                        ? 'مسودة'
                        : inv.status === 'cancelled'
                        ? 'ملغاة'
                        : 'مرحلة';
                    return (
                      <tr key={inv.id} className="border-b border-[#1B2E44] hover:bg-amber-500/10">
                        <td className="p-2 font-mono font-bold text-[var(--gold)]">{inv.invoiceNumber}</td>
                        <td className="p-2">{inv.type.replace(/_/g, ' ')}</td>
                        <td className="p-2 tabular-nums">{inv.date}</td>
                        <td className="p-2 font-bold">{inv.entityName}</td>
                        <td className="p-2 text-center font-black tabular-nums">
                          {invCurr !== 'YER' ? (
                            <div className="leading-tight">
                              <div className="text-emerald-300">
                                {inv.grandTotal.toLocaleString()} {invSym}
                              </div>
                              <div className="text-[10px] font-normal text-slate-400">
                                {invBase.toLocaleString()} ر.ي
                              </div>
                            </div>
                          ) : (
                            <span>{inv.grandTotal.toLocaleString()} {invSym}</span>
                          )}
                        </td>
                        <td className="p-2 text-center">
                          <span className="px-1.5 py-0.5 rounded bg-[#08121E] border border-slate-700 text-[10px] font-bold">
                            {statusLabel}
                          </span>
                        </td>
                        <td className="p-2 text-center">
                          <button
                            type="button"
                            onClick={() => {
                              loadInvoiceIntoForm(inv, origIdx);
                              setIsSearchModalOpen(false);
                            }}
                            className="px-2.5 py-1 rounded bg-[var(--gold)] text-[#03060A] font-black cursor-pointer"
                          >
                            عرض
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        );
      })()}

      {/* Quick Add / Inline Edit Party Modal */}
      {isQuickPartyOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85" dir="rtl">
          <div className="bg-[var(--bg-card)] border-2 border-[var(--gold)] rounded-xl w-full max-w-md p-4 space-y-3">
            <h3 className="font-black text-[var(--gold)] text-sm">
              {editingPartyId
                ? `تعديل بيانات ${isPurchaseMode ? 'المورد' : 'العميل'}`
                : `إضافة ${isPurchaseMode ? 'مورد جديد' : 'عميل جديد'} سريعاً`}
            </h3>
            <input
              type="text"
              value={quickPartyName}
              onChange={(e) => setQuickPartyName(e.target.value)}
              placeholder="الاسم التجاري أو الشخصي *"
              className="w-full v20-input px-3 py-2 text-xs"
            />
            <input
              type="text"
              value={quickPartyPhone}
              onChange={(e) => setQuickPartyPhone(e.target.value)}
              placeholder="رقم الهاتف / الواتساب"
              className="w-full v20-input px-3 py-2 text-xs"
            />
            <select
              value={quickPartyCurrency}
              onChange={(e) => setQuickPartyCurrency(e.target.value as CurrencyCode)}
              className="w-full v20-input px-3 py-2 text-xs cursor-pointer"
            >
              {currencies.map((c) => (
                <option key={c.code} value={c.code}>
                  عملة الحساب: {c.nameAr} ({c.code})
                </option>
              ))}
            </select>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setIsQuickPartyOpen(false);
                  setEditingPartyId(null);
                }}
                className="px-3 py-1.5 rounded bg-[#08121E] border border-[var(--border-strong)] text-xs text-white cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!quickPartyName.trim()) {
                    onNotify('error', 'أدخل الاسم أولاً.');
                    return;
                  }
                  const now = new Date().toISOString().split('T')[0];
                  if (editingPartyId) {
                    if (isPurchaseMode) {
                      const existing = vendors.find((x) => x.id === editingPartyId);
                      if (existing) {
                        const updated: Vendor = {
                          ...existing,
                          nameAr: quickPartyName.trim(),
                          phone: quickPartyPhone.trim() || existing.phone,
                          whatsapp: quickPartyPhone.trim(),
                          currency: quickPartyCurrency,
                        };
                        onQuickSaveVendor(updated);
                        setSelectedPartyId(updated.id);
                        setPartyQuery(updated.nameAr);
                      }
                    } else {
                      const existing = customers.find((x) => x.id === editingPartyId);
                      if (existing) {
                        const updated: Customer = {
                          ...existing,
                          nameAr: quickPartyName.trim(),
                          phone: quickPartyPhone.trim() || existing.phone,
                          whatsapp: quickPartyPhone.trim(),
                          currency: quickPartyCurrency,
                        };
                        onQuickSaveCustomer(updated);
                        setSelectedPartyId(updated.id);
                        setPartyQuery(updated.nameAr);
                      }
                    }
                    onNotify('success', 'تم تحديث بيانات الطرف وتحديث الفاتورة.');
                  } else if (isPurchaseMode) {
                    const v: Vendor = {
                      id: `vnd-${Date.now()}`,
                      branchId: currentBranch.id,
                      code: `V-${vendors.length + 101}`,
                      nameAr: quickPartyName.trim(),
                      phone: quickPartyPhone.trim() || '770000000',
                      whatsapp: quickPartyPhone.trim(),
                      address: 'صنعاء',
                      category: 'محلي',
                      openingBalance: 0,
                      currentBalance: 0,
                      currency: quickPartyCurrency,
                      paymentTermDays: 30,
                      status: 'active',
                      createdAt: now,
                    };
                    onQuickSaveVendor(v);
                    setSelectedPartyId(v.id);
                    setPartyQuery(v.nameAr);
                    onNotify('success', 'تمت إضافة المورد وتحديده في الفاتورة.');
                  } else {
                    const c: Customer = {
                      id: `cust-${Date.now()}`,
                      branchId: currentBranch.id,
                      code: `C-${customers.length + 101}`,
                      nameAr: quickPartyName.trim(),
                      phone: quickPartyPhone.trim() || '770000000',
                      whatsapp: quickPartyPhone.trim(),
                      regionalAreaId: 'reg-01',
                      addressDetails: 'اليمن',
                      category: 'تجاري',
                      creditLimit: 2000000,
                      paymentTermDays: 30,
                      openingBalance: 0,
                      currentBalance: 0,
                      currency: quickPartyCurrency,
                      status: 'active',
                      createdAt: now,
                    };
                    onQuickSaveCustomer(c);
                    setSelectedPartyId(c.id);
                    setPartyQuery(c.nameAr);
                    onNotify('success', 'تمت إضافة العميل وتحديده في الفاتورة.');
                  }
                  setEditingPartyId(null);
                  setQuickPartyName('');
                  setQuickPartyPhone('');
                  setIsQuickPartyOpen(false);
                }}
                className="px-4 py-1.5 rounded v20-btn-gold text-xs cursor-pointer"
              >
                {editingPartyId ? 'حفظ التعديلات' : 'حفظ وتحديد'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Add / Inline Edit Item Modal */}
      {isQuickItemOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85" dir="rtl">
          <div className="bg-[var(--bg-card)] border-2 border-[var(--gold)] rounded-xl w-full max-w-md p-4 space-y-2.5 text-xs">
            <h3 className="font-black text-[var(--gold)] text-sm">
              {editingItemId ? 'تعديل بطاقة الصنف مباشرة' : 'إضافة صنف سريع للمخزون'}
            </h3>
            <input
              type="text"
              value={quickItemName}
              onChange={(e) => setQuickItemName(e.target.value)}
              placeholder="اسم الصنف *"
              className="w-full v20-input px-3 py-2 text-xs"
            />
            <div className="grid grid-cols-3 gap-2">
              <input
                type="text"
                value={quickItemCode}
                onChange={(e) => setQuickItemCode(e.target.value)}
                placeholder="رقم الصنف / الكود"
                className="w-full v20-input px-2.5 py-2 text-xs font-mono"
              />
              <input
                type="text"
                value={quickItemBarcode}
                onChange={(e) => setQuickItemBarcode(e.target.value)}
                placeholder="الباركود"
                className="w-full v20-input px-2.5 py-2 text-xs font-mono"
              />
              <input
                type="text"
                value={quickItemCat}
                onChange={(e) => setQuickItemCat(e.target.value)}
                placeholder="القسم / الفئة"
                className="w-full v20-input px-2.5 py-2 text-xs"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] text-slate-300">سعر التكلفة</label>
                <input
                  type="number"
                  value={quickItemPurchase}
                  onChange={(e) => setQuickItemPurchase(parseFloat(e.target.value) || 0)}
                  className="w-full v20-input px-3 py-1.5 text-xs"
                />
              </div>
              <div>
                <label className="text-[11px] text-slate-300">سعر البيع</label>
                <input
                  type="number"
                  value={quickItemSale}
                  onChange={(e) => setQuickItemSale(parseFloat(e.target.value) || 0)}
                  className="w-full v20-input px-3 py-1.5 text-xs"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setIsQuickItemOpen(false);
                  setEditingItemId(null);
                }}
                className="px-3 py-1.5 rounded bg-[#08121E] border border-[var(--border-strong)] text-white cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!quickItemName.trim()) {
                    onNotify('error', 'أدخل اسم الصنف.');
                    return;
                  }
                  const existingItem = editingItemId
                    ? inventoryItems.find((x) => x.id === editingItemId)
                    : undefined;
                  const savedItem: InventoryItem = existingItem
                    ? {
                        ...existingItem,
                        code: quickItemCode.trim() || existingItem.code,
                        barcode: quickItemBarcode.trim() || existingItem.barcode,
                        nameAr: quickItemName.trim(),
                        category: quickItemCat.trim() || existingItem.category,
                        purchasePrice: quickItemPurchase,
                        salePrice: quickItemSale,
                      }
                    : {
                        id: `item-${Date.now()}`,
                        code: quickItemCode.trim() || `ITM-${inventoryItems.length + 101}`,
                        barcode: quickItemBarcode.trim() || `${Date.now().toString().slice(-6)}`,
                        nameAr: quickItemName.trim(),
                        category: quickItemCat.trim() || 'عام',
                        baseUnit: 'حبة',
                        purchasePrice: quickItemPurchase,
                        salePrice: quickItemSale,
                        wholesalePrice: Math.round(quickItemSale * 0.92),
                        minSalePrice: quickItemPurchase,
                        minQuantityAlert: 5,
                        maxQuantity: 500,
                        valuationMethod: 'WEIGHTED_AVERAGE',
                        taxRate: enableTax ? defaultTaxRate : 0,
                        status: 'active',
                        createdAt: new Date().toISOString().split('T')[0],
                      };

                  onQuickSaveItem(savedItem);

                  // Refresh any matching rows on screen with updated name/barcode/price
                  if (existingItem) {
                    setRows((prev) =>
                      prev.map((row) =>
                        row.itemId === savedItem.id
                          ? {
                              ...row,
                              itemName: savedItem.nameAr,
                              barcode: savedItem.barcode || savedItem.code,
                              unitCost: savedItem.purchasePrice,
                              unitPrice: isPurchaseMode ? savedItem.purchasePrice : savedItem.salePrice,
                            }
                          : row
                      )
                    );
                  }

                  setEditingItemId(null);
                  setQuickItemCode('');
                  setQuickItemName('');
                  setQuickItemBarcode('');
                  setIsQuickItemOpen(false);
                  onNotify(
                    'success',
                    existingItem
                      ? `تم تعديل الصنف "${savedItem.nameAr}" وتحديث الجدول.`
                      : `تم إضافة الصنف "${savedItem.nameAr}" إلى الدليل.`
                  );
                }}
                className="px-4 py-1.5 rounded v20-btn-gold cursor-pointer"
              >
                {editingItemId ? 'حفظ التعديلات' : 'حفظ الصنف'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Document Books Modal */}
      <DocumentBooksModal
        isOpen={isBooksModalOpen}
        books={documentBooks}
        filterCategory={currentBookCategory}
        onSaveBook={onSaveDocumentBook}
        onToggleBookActive={onToggleDocumentBook}
        onSetDefaultBook={onSetDefaultDocumentBook}
        onClose={() => setIsBooksModalOpen(false)}
        onNotify={onNotify}
      />

      {/* Universal Column Customizer */}
      <UniversalColumnCustomizer
        isOpen={isColCustOpen}
        title="تخصيص أعمدة وترتيب جدول الفاتورة"
        columns={columns}
        allowAddCustom={true}
        onChange={(updated) => onSaveColumnPrefs('v20-invoice-grid', updated)}
        onReset={() => onSaveColumnPrefs('v20-invoice-grid', DEFAULT_INV_COLS)}
        onClose={() => setIsColCustOpen(false)}
      />

      {/* Universal Preview Modal */}
      <UniversalPreviewModal
        isOpen={Boolean(previewPayload)}
        payload={previewPayload}
        company={company}
        branch={currentBranch}
        printTemplates={printTemplates}
        onClose={() => setPreviewPayload(null)}
        onNotify={onNotify}
      />

      {/* Direct WhatsApp Modal */}
      <WhatsAppShareModal
        isOpen={Boolean(waPayload)}
        title={`إرسال المستند ${docNumber} عبر واتساب`}
        defaultPhone={waPayload?.phone}
        defaultMessage={waPayload?.text || ''}
        previewPayload={waPayload?.previewPayload}
        company={company}
        branch={currentBranch}
        onClose={() => setWaPayload(null)}
        onNotify={onNotify}
      />

      {/* Customer-Item Historical Price Lookup Modal */}
      <CustomerItemPriceModal
        isOpen={priceLookupState.open}
        onClose={() => setPriceLookupState({ open: false, rowIdx: null })}
        invoices={invoices}
        customers={customers}
        inventoryItems={inventoryItems}
        currencies={currencies}
        initialCustomerId={!isPurchaseMode && !isWarehouseOnlyMode ? selectedPartyId : ''}
        initialItemId={priceLookupState.itemId}
        targetCurrency={currencyCode}
        targetExchangeRate={exchangeRate}
        onApplyPrice={
          !isReadOnlyPosted
            ? (appliedItemId, appliedPrice, sourceInfo) => {
                const targetIdx =
                  priceLookupState.rowIdx !== null && rows[priceLookupState.rowIdx]
                    ? priceLookupState.rowIdx
                    : rows.findIndex((r) => r.itemId === appliedItemId);
                if (targetIdx >= 0 && rows[targetIdx]?.itemId === appliedItemId) {
                  setRows((prev) =>
                    prev.map((r, idx) => (idx === targetIdx ? { ...r, unitPrice: appliedPrice } : r))
                  );
                } else {
                  const catalogItem = inventoryItems.find((it) => it.id === appliedItemId);
                  if (catalogItem) {
                    const emptyIdx = rows.findIndex((r) => !r.itemId && !r.itemName.trim());
                    const insertIdx = emptyIdx >= 0 ? emptyIdx : rows.length;
                    const newRow: GridRow = {
                      ...createEmptyRow(),
                      itemId: catalogItem.id,
                      barcode: catalogItem.barcode,
                      itemName: catalogItem.nameAr,
                      unit: catalogItem.baseUnit || 'حبة',
                      quantity: 1,
                      unitCost: catalogItem.purchasePrice,
                      unitPrice: appliedPrice,
                      taxPercentage: enableTax ? Math.round((catalogItem.taxRate || defaultTaxRate) * 100) : 0,
                    };
                    setRows((prev) => {
                      if (insertIdx < prev.length) {
                        return prev.map((r, idx) => (idx === insertIdx ? newRow : r));
                      }
                      return [...prev, newRow];
                    });
                  }
                }
                onNotify('success', `تم اعتماد السعر (${appliedPrice.toLocaleString()} ${currencyCode}) من ${sourceInfo}.`);
              }
            : undefined
        }
        onOpenInvoice={(invId) => {
          const foundIdx = sortedInvoices.findIndex((inv) => inv.id === invId);
          if (foundIdx >= 0) loadInvoiceIntoForm(sortedInvoices[foundIdx], foundIdx);
        }}
      />

      {/* Confirm Cancel Invoice Modal */}
      <ConfirmModal
        isOpen={confirmCancelOpen}
        title={`إلغاء وعكس الفاتورة ${currentInvoiceRecord?.invoiceNumber || ''}`}
        variant="danger"
        message="سيتم إلغاء الفاتورة وعكس أثرها المخزني والمالي (الأرصدة + الخزينة + قيد عكسي) بالكامل. هل تريد المتابعة؟"
        confirmLabel="نعم، إلغاء وعكس"
        onConfirm={() => {
          if (currentInvoiceRecord) {
            onCancelInvoice(currentInvoiceRecord.id);
          }
          setConfirmCancelOpen(false);
          resetToNewDoc();
        }}
        onCancel={() => setConfirmCancelOpen(false)}
      />

      {/* Commercial Cycle Orders Modal (Quotes, Sales Orders, POs, GRN, Debit/Credit Notes) */}
      {isCommercialModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85" dir="rtl">
          <div className="bg-[var(--bg-card)] border-2 border-[var(--gold)] rounded-xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden text-xs">
            <div className="px-4 py-3 bg-[#071019] border-b border-[var(--border-strong)] flex items-center justify-between">
              <span className="font-black text-sm text-[var(--gold)]">
                الدورة التجارية (عروض الأسعار، أوامر البيع والشراء، استلام البضاعة والإشعارات)
              </span>
              <button
                type="button"
                onClick={() => setIsCommercialModalOpen(false)}
                className="px-2.5 py-1 rounded bg-[#08121E] border border-[var(--border-strong)] text-white cursor-pointer"
              >
                إغلاق
              </button>
            </div>
            <div className="p-4 space-y-3 overflow-y-auto">
              {onSaveCommercialOrder && (
                <div className="bg-[#060D15] border border-slate-800 rounded-lg p-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-slate-300">حفظ سطور الشاشة الحالية كـ:</span>
                    <select
                      value={newOrderType}
                      onChange={(e) => setNewOrderType(e.target.value as CommercialOrderType)}
                      className="v20-input px-2.5 py-1.5"
                    >
                      <option value="عرض_سعر">عرض سعر (Quotation)</option>
                      <option value="أمر_بيع">أمر بيع (Sales Order)</option>
                      <option value="طلب_شراء">طلب شراء (Purchase Request)</option>
                      <option value="أمر_شراء">أمر شراء (Purchase Order)</option>
                      <option value="استلام_بضاعة">إشعار استلام بضاعة (GRN)</option>
                      <option value="إشعار_دائن">إشعار دائن (Credit Note)</option>
                      <option value="إشعار_مدين">إشعار مدين (Debit Note)</option>
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const validRows = rows.filter((r) => r.itemId && r.quantity > 0);
                      if (validRows.length === 0) {
                        onNotify('error', 'أدخل صنفاً واحداً على الأقل في الجدول أولاً.');
                        return;
                      }
                      const ord: CommercialOrder = {
                        id: `ord-${Date.now()}`,
                        companyId: company.id,
                        orderNumber: generateNextDocNumber('ORD-', commercialOrders.map((o) => o.orderNumber), 4),
                        orderType: newOrderType,
                        date: docDate,
                        branchId: currentBranch.id,
                        warehouseId,
                        entityId: selectedPartyId || 'cust',
                        entityName: selectedParty?.name || partyQuery || 'عميل نقدي',
                        currency: currencyCode,
                        exchangeRate: exchangeRate || 1,
                        items: validRows.map((r) => {
                          const c = calcRowLine(r);
                          return {
                            id: r.rowKey,
                            itemId: r.itemId,
                            itemName: r.itemName,
                            itemBarcode: r.barcode,
                            unit: r.unit,
                            quantity: r.quantity,
                            bonusQuantity: r.bonusQuantity || 0,
                            unitPrice: r.unitPrice,
                            discountPercentage: r.discountPercentage || 0,
                            discountAmount: c.discAmt,
                            subtotal: c.afterDisc,
                            taxPercentage: r.taxPercentage || 0,
                            taxAmount: c.taxAmt,
                            total: c.total,
                            unitCost: r.unitCost,
                          };
                        }),
                        subtotal: summary.subtotal,
                        discountTotal: summary.totalDiscount,
                        taxTotal: summary.taxTotal,
                        grandTotal: summary.grandTotal,
                        status: 'approved',
                        notes: invoiceNotes || undefined,
                        createdBy: currentUser.fullName,
                        createdAt: new Date().toISOString(),
                      };
                      onSaveCommercialOrder(ord);
                      onNotify('success', `تم إنشاء ${ord.orderType.replace(/_/g, ' ')} رقم ${ord.orderNumber}.`);
                    }}
                    className="px-3.5 py-1.5 rounded v20-btn-gold font-black cursor-pointer"
                  >
                    + حفظ كمستند تجاري
                  </button>
                </div>
              )}

              <table className="w-full text-right border-collapse">
                <thead className="bg-[#0B192C] text-[var(--gold)] border-b border-[var(--gold)]">
                  <tr>
                    <th className="p-2">الرقم</th>
                    <th className="p-2">النوع</th>
                    <th className="p-2">التاريخ</th>
                    <th className="p-2">الطرف</th>
                    <th className="p-2 text-center">الإجمالي</th>
                    <th className="p-2 text-center">الحالة</th>
                    <th className="p-2 text-center">تحويل</th>
                  </tr>
                </thead>
                <tbody>
                  {commercialOrders.map((ord) => (
                    <tr key={ord.id} className="border-b border-[#1B2E44] hover:bg-amber-500/10">
                      <td className="p-2 font-mono font-bold text-[var(--gold)]">{ord.orderNumber}</td>
                      <td className="p-2 font-bold text-white">{ord.orderType.replace(/_/g, ' ')}</td>
                      <td className="p-2 tabular-nums">{ord.date}</td>
                      <td className="p-2">{ord.entityName}</td>
                      <td className="p-2 text-center font-black tabular-nums">
                        {ord.grandTotal.toLocaleString()} {ord.currency}
                      </td>
                      <td className="p-2 text-center">
                        <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-[10px]">
                          {ord.status === 'converted' ? `محول (${ord.convertedInvoiceNumber || ''})` : ord.status}
                        </span>
                      </td>
                      <td className="p-2 text-center">
                        {ord.status !== 'converted' && onConvertOrderToInvoice && (
                          <button
                            type="button"
                            onClick={() => {
                              onConvertOrderToInvoice(ord);
                              setIsCommercialModalOpen(false);
                            }}
                            className="px-2.5 py-1 rounded bg-emerald-600 text-white font-black cursor-pointer"
                          >
                            تحويل لفاتورة
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {commercialOrders.length === 0 && (
                    <tr>
                      <td colSpan={7} className="p-6 text-center text-slate-400">
                        لا توجد عروض أسعار أو أوامر تجارية مسجلة بعد.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* POS Shift (Open/Close Z-Report) & Held Carts Modal */}
      {isPosModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85" dir="rtl">
          <div className="bg-[var(--bg-card)] border-2 border-emerald-500 rounded-xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden text-xs">
            <div className="px-4 py-3 bg-[#071019] border-b border-emerald-500/40 flex items-center justify-between">
              <span className="font-black text-sm text-emerald-300">
                إدارة وردية الكاشير (Shift Z-Report) والفواتير المعلقة
              </span>
              <button
                type="button"
                onClick={() => setIsPosModalOpen(false)}
                className="px-2.5 py-1 rounded bg-[#08121E] border border-[var(--border-strong)] text-white cursor-pointer"
              >
                إغلاق
              </button>
            </div>
            <div className="p-4 space-y-4 overflow-y-auto">
              {(() => {
                const openShift = posShifts.find((s) => s.status === 'open');
                return (
                  <div className="bg-[#060D15] border border-slate-800 rounded-lg p-3 space-y-2">
                    <div className="font-black text-[var(--gold)]">
                      {openShift ? `وردية مفتوحة حالياً: ${openShift.shiftNumber} (${openShift.cashierName})` : 'فتح وردية كاشير جديدة'}
                    </div>
                    {!openShift ? (
                      <div className="flex items-center gap-2 flex-wrap">
                        <input
                          type="number"
                          value={shiftOpeningCash}
                          onChange={(e) => setShiftOpeningCash(parseFloat(e.target.value) || 0)}
                          placeholder="الرصيد النقدي الافتتاحي بالدرج"
                          className="v20-input px-2.5 py-1.5 w-52"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            if (!onUpdatePosState) return;
                            const newShift: PosShift = {
                              id: `shf-${Date.now()}`,
                              companyId: company.id,
                              shiftNumber: `SHF-${posShifts.length + 1}`,
                              cashierUserId: currentUser.id,
                              cashierName: currentUser.fullName,
                              treasuryAccountId: treasuryId,
                              warehouseId,
                              openedAt: new Date().toISOString(),
                              openingCash: shiftOpeningCash,
                              expectedCash: shiftOpeningCash,
                              salesCount: 0,
                              totalSalesAmount: 0,
                              status: 'open',
                            };
                            onUpdatePosState({ posShifts: [newShift, ...posShifts] });
                            onNotify('success', `تم فتح الوردية ${newShift.shiftNumber} بنجاح.`);
                          }}
                          className="px-3.5 py-1.5 rounded bg-emerald-600 text-white font-black cursor-pointer"
                        >
                          بدء الوردية
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="text-slate-300 space-x-3 space-x-reverse">
                          <span>افتتاحي: <strong className="text-white">{openShift.openingCash.toLocaleString()}</strong></span>
                          <span>المتوقع بالدرج: <strong className="text-emerald-300">{openShift.expectedCash.toLocaleString()}</strong></span>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            value={shiftCountedCash}
                            onChange={(e) => setShiftCountedCash(parseFloat(e.target.value) || 0)}
                            placeholder="الجرد الفعلي بالدرج"
                            className="v20-input px-2.5 py-1.5 w-40"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              if (!onUpdatePosState) return;
                              const variance = Math.round((shiftCountedCash - openShift.expectedCash) * 100) / 100;
                              const closed: PosShift = {
                                ...openShift,
                                status: 'closed',
                                closedAt: new Date().toISOString(),
                                actualCountedCash: shiftCountedCash,
                                cashVariance: variance,
                              };
                              onUpdatePosState({
                                posShifts: posShifts.map((s) => (s.id === openShift.id ? closed : s)),
                              });
                              onNotify('info', `تم إغلاق الوردية ${closed.shiftNumber} (فارق الصندوق: ${variance.toLocaleString()}).`);
                            }}
                            className="px-3.5 py-1.5 rounded bg-rose-600 text-white font-black cursor-pointer"
                          >
                            إغلاق الوردية (Z-Report)
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Hold / Resume Cart */}
              <div className="bg-[#060D15] border border-slate-800 rounded-lg p-3 space-y-2">
                <div className="font-black text-sky-300">تعليق واسترجاع الفواتير المؤقتة ({heldPosCarts.length})</div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={heldCartLabel}
                    onChange={(e) => setHeldCartLabel(e.target.value)}
                    placeholder="وصف / اسم العميل للتعليق..."
                    className="flex-1 v20-input px-2.5 py-1.5"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!onUpdatePosState) return;
                      const validRows = rows.filter((r) => r.itemId && r.quantity > 0);
                      if (validRows.length === 0) {
                        onNotify('error', 'لا توجد أصناف في الجدول لتعليقها.');
                        return;
                      }
                      const cart: HeldPosCart = {
                        id: `hold-${Date.now()}`,
                        companyId: company.id,
                        label: heldCartLabel.trim() || `${selectedParty?.name || 'عميل'} (${validRows.length} أصناف)`,
                        customerId: selectedPartyId || 'cust',
                        customerName: selectedParty?.name || partyQuery || 'عميل نقدي',
                        currency: currencyCode,
                        items: validRows.map((r) => {
                          const c = calcRowLine(r);
                          return {
                            id: r.rowKey,
                            itemId: r.itemId,
                            itemName: r.itemName,
                            itemBarcode: r.barcode,
                            unit: r.unit,
                            quantity: r.quantity,
                            bonusQuantity: r.bonusQuantity || 0,
                            unitPrice: r.unitPrice,
                            discountPercentage: r.discountPercentage || 0,
                            discountAmount: c.discAmt,
                            subtotal: c.afterDisc,
                            taxPercentage: r.taxPercentage || 0,
                            taxAmount: c.taxAmt,
                            total: c.total,
                            unitCost: r.unitCost,
                          };
                        }),
                        discountPct: 0,
                        savedAt: new Date().toISOString(),
                        savedBy: currentUser.fullName,
                      };
                      onUpdatePosState({ heldPosCarts: [cart, ...heldPosCarts] });
                      setHeldCartLabel('');
                      resetToNewDoc();
                      onNotify('success', `تم تعليق الفاتورة "${cart.label}" مؤقتاً.`);
                    }}
                    className="px-3.5 py-1.5 rounded bg-[var(--gold)] text-[#03060A] font-black cursor-pointer"
                  >
                    + تعليق الفاتورة الحالية
                  </button>
                </div>

                {heldPosCarts.length > 0 && (
                  <div className="space-y-1 pt-2">
                    {heldPosCarts.map((c) => (
                      <div key={c.id} className="flex items-center justify-between bg-[#0B192C] border border-slate-800 rounded px-3 py-2">
                        <div>
                          <span className="font-bold text-white">{c.label}</span>
                          <span className="text-slate-400 mr-2">· {c.items.length} أصناف · {c.currency}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedPartyId(c.customerId);
                              setPartyQuery(c.customerName);
                              setCurrencyCode(c.currency);
                              setRows(
                                c.items.map((it) => ({
                                  rowKey: it.id,
                                  itemId: it.itemId,
                                  barcode: it.itemBarcode || '',
                                  itemName: it.itemName,
                                  unit: it.unit,
                                  quantity: it.quantity,
                                  bonusQuantity: it.bonusQuantity || 0,
                                  unitCost: it.unitCost || 0,
                                  unitPrice: it.unitPrice,
                                  discountPercentage: it.discountPercentage || 0,
                                  taxPercentage: it.taxPercentage || 0,
                                  notes: it.notes || '',
                                  customValues: {},
                                }))
                              );
                              onUpdatePosState?.({ heldPosCarts: heldPosCarts.filter((x) => x.id !== c.id) });
                              setIsPosModalOpen(false);
                              onNotify('info', `تم استرجاع الفاتورة المعلقة "${c.label}".`);
                            }}
                            className="px-2.5 py-1 rounded bg-emerald-600 text-white font-bold cursor-pointer"
                          >
                            استرجاع للجدول
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
