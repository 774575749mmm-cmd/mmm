/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - V20 Enterprise Workspace Shell + Real Accounting/Inventory Engines
 */

import React, { Suspense, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Bell,
  HelpCircle,
  RotateCcw,
  Landmark,
  Wallet,
  Building2,
  Coins,
  Globe,
  Sparkles,
  Search,
  Tag,
  ExternalLink,
  PlusSquare,
  ChevronDown,
  LogOut,
  Shield,
} from 'lucide-react';
import {
  loadDatabase,
  loadDatabaseFromIDB,
  saveDatabaseDebounced,
  saveDatabaseVerified,
  saveDatabaseAtomicWithLock,
  subscribeDatabaseSync,
  flushPendingDatabaseSave,
  resetToDemoDatabase,
  generateNextDocNumber,
  defaultTabsConfig,
  defaultDocumentBooks,
  resolveCompanyPrintTemplates,
  switchActiveCompanyInDb,
  scopeDatabaseToCompany,
  validateDatabaseObject,
  PersistenceResult,
  ERPDatabase,
} from './services/storageService';
import { getEffectiveCurrencyRate } from './services/currencyHelpers';
import { setActivePrintTemplates } from './services/exportService';
import { AppLanguage, getTabLabel, syncDocumentLanguage, t } from './services/i18n';
import { assertTenantAccess, isPlatformSuperAdmin } from './services/securityService';
import {
  cloudApiService,
  hydrateErpDatabaseFromServerState,
  prepareDatabaseForRestore,
  serverUserToErpUser,
} from './services/cloudApiService';
import {
  TransactionResult,
  TransactionOptions,
  saveDraftInvoiceTransaction,
  postSalesInvoiceTransaction,
  postPurchaseInvoiceTransaction,
  cancelInvoiceTransaction,
  postVouchersBatchTransaction,
  cancelVoucherTransaction,
  executeTreasuryTransferTransaction,
  postExpenseTransaction,
  postManualJournalTransaction,
  reverseJournalTransaction,
  executeStockTransferTransaction,
  reverseStockTransferTransaction,
  approveStocktakingTransaction,
  disbursePayrollTransaction,
  disposeFixedAssetTransaction,
  convertCommercialOrderToInvoice,
  adjustStockTransaction,
  runDepreciationTransaction,
  saveCustomBookEntryTransaction,
  updateUserPermissionsTransaction,
  addUserTransaction,
} from './services/erpTransactionService';
import {
  Invoice,
  Customer,
  Vendor,
  InventoryItem,
  PaymentVoucher,
  ExpenseRecord,
  Employee,
  PayrollRun,
  FixedAsset,
  Branch,
  Warehouse,
  UnitOfMeasure,
  Currency,
  User,
  TaskAlert,
  InventoryTransfer,
  TreasuryAccount,
  TreasuryTransfer,
  JournalEntry,
  WarehouseDocument,
  PhysicalStocktaking,
  DispatchLogEntry,
  CustomLedgerBook,
  CustomLedgerEntry,
  TableColumnPref,
  DocumentBook,
  DepartmentItem,
  RegionalArea,
  Account,
  PrintDocumentType,
  PrintTemplateConfig,
  SystemSettings,
  Company,
  CommercialOrder,
  BankReconciliationSession,
  PosShift,
  HeldPosCart,
  InventoryBatch,
  StorageLocation,
  SavedReportDesign,
} from './types/erp';

// Common Modals & Banners
import { HelpModal, HelpTopic } from './components/common/HelpModal';
import { PrintModal, PrintableDocumentData } from './components/common/PrintModal';
import { ToastBanner, ToastMessage } from './components/common/ToastBanner';
import { ConfirmModal } from './components/common/ConfirmModal';
import { GlobalSearchModal } from './components/common/GlobalSearchModal';
import { CustomerItemPriceModal } from './components/common/CustomerItemPriceModal';
import { MdiWindowProvider, MdiFloatingFrame } from './components/common/MdiWindowManager';
import { SetupWizardModal } from './components/modules/settings/SetupWizardModal';
import { LoginModal } from './components/auth/LoginModal';

// V20 Workbenches (8 Enterprise Tabs — Route/Tab Code-Split via React.lazy)
const InvoiceWorkbench = React.lazy(() =>
  import('./components/modules/workbenches/InvoiceWorkbench').then((m) => ({ default: m.InvoiceWorkbench }))
);
const VoucherWorkbench = React.lazy(() =>
  import('./components/modules/workbenches/VoucherWorkbench').then((m) => ({ default: m.VoucherWorkbench }))
);
const LedgersAccountingWorkbench = React.lazy(() =>
  import('./components/modules/workbenches/LedgersAccountingWorkbench').then((m) => ({
    default: m.LedgersAccountingWorkbench,
  }))
);
const InventoryWorkbench = React.lazy(() =>
  import('./components/modules/workbenches/InventoryWorkbench').then((m) => ({ default: m.InventoryWorkbench }))
);
const PartiesWorkbench = React.lazy(() =>
  import('./components/modules/workbenches/PartiesWorkbench').then((m) => ({ default: m.PartiesWorkbench }))
);
const ReportsWorkbench = React.lazy(() =>
  import('./components/modules/workbenches/ReportsWorkbench').then((m) => ({ default: m.ReportsWorkbench }))
);
const UnifiedOperationsWorkbench = React.lazy(() =>
  import('./components/modules/workbenches/UnifiedOperationsWorkbench').then((m) => ({
    default: m.UnifiedOperationsWorkbench,
  }))
);
const SettingsWorkbench = React.lazy(() =>
  import('./components/modules/workbenches/SettingsWorkbench').then((m) => ({ default: m.SettingsWorkbench }))
);

export type V20TabId =
  | 'tab-pos'
  | 'tab-bonds'
  | 'tab-ledgers'
  | 'tab-inventory'
  | 'tab-cust'
  | 'tab-reports'
  | 'tab-unified-coa'
  | 'tab-admin';

export type ReportsSubTabId =
  | 'v20_comp'
  | 'statement'
  | 'daily_customers'
  | 'hub_22'
  | 'daily_22'
  | 'unified_docs'
  | 'tasks_dispatch'
  | 'smart_ai';

export type UnifiedSubTabId = 'coa' | 'hr' | 'expenses' | 'assets' | 'directories';

export interface WorkspaceWindowInstance {
  id: string;
  tabId: V20TabId;
  title: string;
  focusedRecordId?: string;
  reportsSubTab?: ReportsSubTabId;
  unifiedSubTab?: UnifiedSubTabId;
  statementTarget?: { type: 'customer' | 'vendor'; id: string } | null;
}

export default function App() {
  const [db, setDb] = useState<ERPDatabase>(() => loadDatabase());
  const [activeTab, setActiveTab] = useState<V20TabId>('tab-pos');
  const [visitedTabs, setVisitedTabs] = useState<V20TabId[]>(['tab-pos']);
  const [floatingWindows, setFloatingWindows] = useState<WorkspaceWindowInstance[]>([]);
  const [isWinLauncherOpen, setIsWinLauncherOpen] = useState(false);

  const [focusedRecordId, setFocusedRecordId] = useState<string | undefined>(undefined);
  const [reportsSubTab, setReportsSubTab] = useState<ReportsSubTabId>('v20_comp');
  const [unifiedSubTab, setUnifiedSubTab] = useState<UnifiedSubTabId>('coa');
  const [statementTarget, setStatementTarget] = useState<{
    type: 'customer' | 'vendor';
    id: string;
  } | null>(null);

  const initialDbRef = useRef<ERPDatabase | null>(null);
  const hasUserMutatedRef = useRef(false);
  const cloudRevisionRef = useRef<number>(1);
  const skipNextCloudSaveRef = useRef<boolean>(true);
  const cloudSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  if (!initialDbRef.current) initialDbRef.current = db;
  useEffect(() => {
    if (db !== initialDbRef.current) {
      hasUserMutatedRef.current = true;
    }
  }, [db]);

  const scopedDb = useMemo(() => scopeDatabaseToCompany(db), [db]);

  const resolvedCompanyPrintTemplates = useMemo(
    () => resolveCompanyPrintTemplates(db.settings, db.company.id),
    [db.settings, db.company.id]
  );

  // Active Contextual State (always initialized from active company scope)
  const [currentBranch, setCurrentBranch] = useState<Branch>(
    () => scopedDb.branches[0] || db.branches[0]
  );
  const [currentCurrency, setCurrentCurrency] = useState<Currency>(() => db.currencies[0]);
  const [currentUser, setCurrentUser] = useState<User>(() => db.users[0]);

  const authorizedCompanies = useMemo(() => {
    const all = db.companies && db.companies.length > 0 ? db.companies : [];
    return all.filter((c) => assertTenantAccess(currentUser, c.id).ok);
  }, [db.companies, currentUser]);

  // Keep currentBranch synced to the active company's branches cleanly
  useEffect(() => {
    if (scopedDb.branches.length > 0 && !scopedDb.branches.some((b) => b.id === currentBranch?.id)) {
      setCurrentBranch(scopedDb.branches[0]);
    }
  }, [scopedDb.branches, currentBranch]);

  // Real Session & Authentication Gate State
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [cloudSessionActive, setCloudSessionActive] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<'bootstrap' | 'login' | 'force_change_password' | null>('login');
  const [pendingPasswordChangeUser, setPendingPasswordChangeUser] = useState<User | null>(null);
  const [authCanCancel, setAuthCanCancel] = useState(false);

  const lang: AppLanguage = db.settings.language === 'en' ? 'en' : 'ar';

  const handleChangeLanguage = useCallback((nextLang: AppLanguage) => {
    setDb((prev) => ({
      ...prev,
      settings: {
        ...prev.settings,
        language: nextLang,
      },
    }));
  }, []);

  useEffect(() => {
    syncDocumentLanguage(lang);
  }, [lang]);

  useEffect(() => {
    setActivePrintTemplates(resolvedCompanyPrintTemplates);
  }, [resolvedCompanyPrintTemplates]);

  const handleSavePrintTemplates = useCallback(
    async (map: Record<PrintDocumentType, PrintTemplateConfig>): Promise<PersistenceResult> => {
      if (!currentUser.canManageSettings) {
        return {
          ok: false,
          backend: 'none',
          verified: false,
          error: 'عذراً، لا يملك المستخدم الحالي صلاحية تعديل قوالب الطباعة.',
        };
      }
      const nextSettings: SystemSettings = {
        ...db.settings,
        printTemplates: map,
        companyPrintTemplates: {
          ...(db.settings.companyPrintTemplates || {}),
          [db.company.id]: map,
        },
      };
      const nextDb: ERPDatabase = {
        ...db,
        settings: nextSettings,
      };
      const res = await saveDatabaseVerified(nextDb);
      if (!res.ok) {
        return res;
      }
      hasUserMutatedRef.current = true;
      setDb(nextDb);
      setActivePrintTemplates(map);
      return res;
    },
    [db, currentUser.canManageSettings]
  );

  // Keep every visited main tab mounted so drafts/filters are never lost on tab switch
  useEffect(() => {
    setVisitedTabs((prev) => (prev.includes(activeTab) ? prev : [...prev, activeTab]));
  }, [activeTab]);

  // Modals & Toasts
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isGlobalSearchOpen, setIsGlobalSearchOpen] = useState(false);
  const [priceLookupModal, setPriceLookupModal] = useState<{
    open: boolean;
    customerId?: string;
    itemId?: string;
  }>({ open: false });
  const [printableDocs, setPrintableDocs] = useState<{ id: string; doc: PrintableDocumentData }[]>([]);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
  const [isSetupWizardOpen, setIsSetupWizardOpen] = useState(false);

  const openPrintDocWindow = useCallback((doc: PrintableDocumentData) => {
    const id = `pdoc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setPrintableDocs((prev) => [...prev, { id, doc }]);
  }, []);

  const closePrintDocWindow = useCallback((id: string) => {
    setPrintableDocs((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const spawnFloatingWindow = useCallback(
    (opts: Omit<WorkspaceWindowInstance, 'id'>) => {
      const id = `mdi-win-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      setFloatingWindows((prev) => [...prev, { ...opts, id }]);
      setIsWinLauncherOpen(false);
    },
    []
  );

  const closeFloatingWindow = useCallback((winId: string) => {
    setFloatingWindows((prev) => prev.filter((w) => w.id !== winId));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsGlobalSearchOpen((prev) => !prev);
        return;
      }
      const shortcuts = db.settings.operationalControl?.shortcuts || [];
      if (shortcuts.length === 0) return;
      const target = e.target as HTMLElement | null;
      const isEditable =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      const isFnKey = /^F\d{1,2}$/i.test(e.key);
      if (isEditable && !isFnKey && !e.ctrlKey && !e.altKey) return;

      for (const sc of shortcuts) {
        if (!sc.enabled || !sc.keys) continue;
        const parts = sc.keys
          .split('+')
          .map((p) => p.trim().toLowerCase())
          .filter(Boolean);
        const needCtrl = parts.includes('ctrl') || parts.includes('control');
        const needAlt = parts.includes('alt');
        const needShift = parts.includes('shift');
        const keyPart = parts.find((p) => !['ctrl', 'control', 'alt', 'shift'].includes(p));
        if (
          keyPart &&
          e.key.toLowerCase() === keyPart &&
          e.ctrlKey === needCtrl &&
          e.altKey === needAlt &&
          e.shiftKey === needShift
        ) {
          e.preventDefault();
          setFocusedRecordId(undefined);
          const tabMap: Record<string, V20TabId> = {
            dashboard: 'tab-reports',
            sales: 'tab-pos',
            purchases: 'tab-pos',
            vouchers: 'tab-bonds',
            accounting: 'tab-ledgers',
            inventory: 'tab-inventory',
            parties: 'tab-cust',
            reports: 'tab-reports',
            settings: 'tab-admin',
          };
          const resolvedTab = tabMap[sc.targetTabId] || (sc.targetTabId as V20TabId);
          setActiveTab(resolvedTab);
          if (sc.targetTabId === 'dashboard') {
            setReportsSubTab('v20_comp');
          }
          break;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [db.settings.operationalControl?.shortcuts]);

  const notify = useCallback((type: 'success' | 'error' | 'info', message: string) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev.slice(-3), { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const hydrateWorkspaceFromCloud = useCallback(
    async (localSeed?: ERPDatabase) => {
      const snapshot = await cloudApiService.getCompanyState();
      const hydrated = hydrateErpDatabaseFromServerState(snapshot, localSeed);
      let effectiveRevision = snapshot.revision || 0;

      if (effectiveRevision === 0) {
        const seedRes = await cloudApiService.saveCompanyState(hydrated, snapshot.companyId, 0);
        if (seedRes.ok) {
          effectiveRevision = seedRes.revision;
        }
      }

      const finalDb: ERPDatabase = {
        ...hydrated,
        revision: Math.max(1, effectiveRevision),
      };
      cloudRevisionRef.current = Math.max(1, effectiveRevision);
      skipNextCloudSaveRef.current = true;
      initialDbRef.current = finalDb;
      setDb(finalDb);
      if (finalDb.branches[0]) setCurrentBranch(finalDb.branches[0]);
      const baseCurr =
        finalDb.currencies.find((c) => c.code === finalDb.company.baseCurrency) ||
        finalDb.currencies.find((c) => c.isBase) ||
        finalDb.currencies[0];
      if (baseCurr) setCurrentCurrency(baseCurr);
      return { hydratedDb: finalDb, snapshot };
    },
    []
  );

  // Hydrate from PostgreSQL authoritative session + IndexedDB cache
  useEffect(() => {
    let active = true;
    const syncAuthAndIdb = async () => {
      const idbData = await loadDatabaseFromIDB();
      if (!active) return;

      const effectiveDb = idbData || db;

      try {
        const data = await cloudApiService.getAuthStatus();
        if (!active) return;

        if (!data.initialized) {
          if (idbData && !hasUserMutatedRef.current) {
            initialDbRef.current = idbData;
            setDb(idbData);
            if (idbData.branches[0]) setCurrentBranch(idbData.branches[0]);
            if (idbData.currencies[0]) setCurrentCurrency(idbData.currencies[0]);
          }
          setIsAuthenticated(false);
          setCloudSessionActive(false);
          setAuthCanCancel(false);
          setAuthModalMode('bootstrap');
          return;
        }

        if (data.authenticated && data.user?.id) {
          try {
            const { hydratedDb } = await hydrateWorkspaceFromCloud(effectiveDb);
            if (!active) return;

            const serverUser = serverUserToErpUser(data.user);
            const matched =
              hydratedDb.users.find((u) => u.id === serverUser.id && u.active) || serverUser;

            if (matched.mustChangePassword || data.user.mustChangePassword) {
              setPendingPasswordChangeUser(matched);
              setIsAuthenticated(false);
              setCloudSessionActive(true);
              setAuthCanCancel(false);
              setAuthModalMode('force_change_password');
              return;
            }

            setCurrentUser(matched);
            setCloudSessionActive(true);
            setIsAuthenticated(true);
            setAuthModalMode(null);
            return;
          } catch {
            if (!active) return;
          }
        }

        // Unauthenticated: do NOT leak previous company workspace
        setCloudSessionActive(false);
        setIsAuthenticated(false);
        setAuthCanCancel(false);
        setAuthModalMode('login');
        if (data.sessionRevoked) {
          notify('info', 'تم إنهاء الجلسة السابقة بعد تغيير كلمة المرور أو إبطال الجلسات. يرجى تسجيل الدخول مجدداً.');
        }
      } catch {
        if (!active) return;
        if (idbData && !hasUserMutatedRef.current) {
          initialDbRef.current = idbData;
          setDb(idbData);
          if (idbData.branches[0]) setCurrentBranch(idbData.branches[0]);
          if (idbData.currencies[0]) setCurrentCurrency(idbData.currencies[0]);
        }
        const hasLocalHashes = effectiveDb.users.some((u) => Boolean(u.passwordHash && u.passwordSalt));
        setCloudSessionActive(false);
        setIsAuthenticated(false);
        setAuthCanCancel(false);
        setAuthModalMode(hasLocalHashes ? 'login' : 'bootstrap');
      }
    };

    void syncAuthAndIdb();
    return () => {
      active = false;
    };
  }, [hydrateWorkspaceFromCloud]);

  const handleLogout = useCallback(async () => {
    if (cloudSaveTimerRef.current) {
      clearTimeout(cloudSaveTimerRef.current);
      cloudSaveTimerRef.current = null;
      if (cloudSessionActive && isAuthenticated) {
        const activeCid = db.activeCompanyId || db.company.id;
        await cloudApiService
          .saveCompanyState(db, activeCid, cloudRevisionRef.current)
          .catch(() => null);
      }
    }
    await cloudApiService.logout();
    if (cloudSessionActive) {
      skipNextCloudSaveRef.current = true;
      setDb((prev) => ({
        ...prev,
        companies: [],
        users: [],
        customers: [],
        vendors: [],
        invoices: [],
        journalEntries: [],
        paymentVouchers: [],
      }));
    }
    setFloatingWindows([]);
    setIsAuthenticated(false);
    setCloudSessionActive(false);
    setPendingPasswordChangeUser(null);
    setAuthCanCancel(false);
    setAuthModalMode('login');
  }, [cloudSessionActive, isAuthenticated, db]);

  // Sync state across concurrent tabs/windows in the same browser via BroadcastChannel
  useEffect(() => {
    const unsubscribe = subscribeDatabaseSync(({ revision, latestDb }) => {
      setDb((prev) => {
        if (revision > (prev.revision ?? 1)) {
          return latestDb;
        }
        return prev;
      });
    });
    return unsubscribe;
  }, []);

  // Persist DB locally (IndexedDB cache) + sync authoritatively to PostgreSQL when cloud-authenticated
  useEffect(() => {
    saveDatabaseDebounced(db, 350);

    if (!cloudSessionActive || !isAuthenticated) return;
    if (skipNextCloudSaveRef.current) {
      skipNextCloudSaveRef.current = false;
      return;
    }

    if (cloudSaveTimerRef.current) {
      clearTimeout(cloudSaveTimerRef.current);
    }

    const activeCid = db.activeCompanyId || db.company.id;
    if (db.company?.id && db.company.id !== activeCid) {
      notify(
        'error',
        `عزل المنشآت: تم منع حفظ بيانات (${db.company.id}) فوق المنشأة النشطة (${activeCid}).`
      );
      return;
    }

    cloudSaveTimerRef.current = setTimeout(async () => {
      cloudSaveTimerRef.current = null;
      const res = await cloudApiService.saveCompanyState(db, activeCid, cloudRevisionRef.current);
      if (res.ok) {
        cloudRevisionRef.current = res.revision;
      } else if (res.status === 401 && (res.code === 'SESSION_REVOKED' || res.code === 'INVALID_SESSION' || res.code === 'AUTH_REQUIRED')) {
        setCloudSessionActive(false);
        setIsAuthenticated(false);
        setAuthCanCancel(false);
        setAuthModalMode('login');
        notify('error', res.error || 'انتهت الجلسة أو تم إبطالها. يرجى تسجيل الدخول مجدداً.');
      } else if (res.conflict) {
        await hydrateWorkspaceFromCloud().catch(() => null);
        notify('info', 'تعارض تزامن (409): تم تحديث البيانات من جلسة أحدث على الخادم.');
      } else if (res.status === 403 || res.code === 'TENANT_ISOLATION_VIOLATION' || res.code === 'FORBIDDEN_ROLE') {
        notify('error', res.error || 'صلاحية مرفوضة (403): عزل المنشآت منع الكتابة فوق هذه المنشأة.');
      } else {
        notify('error', res.error || 'تعذر مزامنة البيانات مع الخادم.');
      }
    }, 450);

    return () => {
      if (cloudSaveTimerRef.current) {
        clearTimeout(cloudSaveTimerRef.current);
      }
    };
  }, [db, cloudSessionActive, isAuthenticated, hydrateWorkspaceFromCloud, notify]);

  // Flush any pending DB save cleanly on page close / reload
  useEffect(() => {
    const handleFlush = () => {
      flushPendingDatabaseSave();
    };
    window.addEventListener('beforeunload', handleFlush);
    window.addEventListener('pagehide', handleFlush);
    return () => {
      window.removeEventListener('beforeunload', handleFlush);
      window.removeEventListener('pagehide', handleFlush);
      flushPendingDatabaseSave();
    };
  }, []);

  // Live Sync of V20 Theme CSS Custom Properties (font size, gold accent, card background)
  useEffect(() => {
    const ui = db.settings.uiPreferences;
    const size = ui?.fontSize || 14;
    const gold = ui?.goldColor || '#f5c748';
    const card = ui?.cardColor || '#101e2e';
    const root = document.documentElement.style;
    root.setProperty('--base-font-size', `${size}px`);
    root.fontSize = `${size}px`;
    root.setProperty('--gold', gold);
    root.setProperty('--bg-card', card);
  }, [db.settings.uiPreferences]);

  const getCurrencyRate = useCallback(
    (code: string): number => getEffectiveCurrencyRate(db.currencies, code),
    [db.currencies]
  );

  // Seamless navigation mapper: opens targeted record / module in an independent floating MDI popup window
  const navigateToRecord = useCallback(
    (moduleName: string, recordId?: string) => {
      let targetTab: V20TabId = 'tab-reports';
      let targetReportsSub: ReportsSubTabId = 'unified_docs';
      let targetUnifiedSub: UnifiedSubTabId = 'coa';
      let winTitle = lang === 'en' ? 'Document Window' : 'نافذة مستند';

      if (moduleName === 'sales' || moduleName === 'purchases' || moduleName === 'tab-pos') {
        targetTab = 'tab-pos';
        winTitle = lang === 'en' ? 'Invoice Window' : 'نافذة فاتورة';
      } else if (moduleName === 'treasury' || moduleName === 'liquidity' || moduleName === 'tab-bonds') {
        targetTab = 'tab-bonds';
        winTitle = lang === 'en' ? 'Voucher Window' : 'نافذة سندات وخزينة';
      } else if (moduleName === 'accounting' || moduleName === 'tab-ledgers') {
        targetTab = 'tab-ledgers';
        winTitle = lang === 'en' ? 'Ledger & Journals' : 'نافذة الدفاتر والقيود';
      } else if (moduleName === 'inventory' || moduleName === 'tab-inventory') {
        targetTab = 'tab-inventory';
        winTitle = lang === 'en' ? 'Inventory & Stock' : 'نافذة الجرد والمستودعات';
      } else if (
        moduleName === 'customers' ||
        moduleName === 'vendors' ||
        moduleName === 'receivables' ||
        moduleName === 'tab-cust'
      ) {
        targetTab = 'tab-cust';
        winTitle = lang === 'en' ? 'Customers & Vendors' : 'نافذة العملاء والموردين';
      } else if (moduleName === 'smart_ai') {
        targetTab = 'tab-reports';
        targetReportsSub = 'smart_ai';
        winTitle = lang === 'en' ? 'Smart AI Advisor' : 'مستشار الحلول الذكية';
      } else if (moduleName === 'daily_report') {
        targetTab = 'tab-reports';
        targetReportsSub = 'daily_22';
        winTitle = lang === 'en' ? 'Daily Management Report' : 'التقرير اليومي (22 مؤشر)';
      } else if (moduleName === 'unified_docs') {
        targetTab = 'tab-reports';
        targetReportsSub = 'unified_docs';
        winTitle = lang === 'en' ? 'Unified Documents' : 'مركز المستندات الموحد';
      } else if (moduleName === 'tasks' || moduleName === 'scheduled_dispatch') {
        targetTab = 'tab-reports';
        targetReportsSub = 'tasks_dispatch';
        winTitle = lang === 'en' ? 'Tasks & Dispatch' : 'التنبيهات والمجدول';
      } else if (moduleName === 'reports' || moduleName === 'dashboard' || moduleName === 'currency' || moduleName === 'tab-reports') {
        targetTab = 'tab-reports';
        targetReportsSub = 'v20_comp';
        winTitle = lang === 'en' ? 'Comprehensive Report' : 'التقرير الشامل للإدارة';
      } else if (moduleName === 'hr') {
        targetTab = 'tab-unified-coa';
        targetUnifiedSub = 'hr';
        winTitle = lang === 'en' ? 'HR & Payroll' : 'شؤون الموظفين والرواتب';
      } else if (moduleName === 'expenses' || moduleName === 'operations') {
        targetTab = 'tab-unified-coa';
        targetUnifiedSub = 'expenses';
        winTitle = lang === 'en' ? 'Expenses Center' : 'نافذة المصروفات';
      } else if (moduleName === 'assets') {
        targetTab = 'tab-unified-coa';
        targetUnifiedSub = 'assets';
        winTitle = lang === 'en' ? 'Fixed Assets' : 'الأصول الثابتة';
      } else if (moduleName === 'tab-unified-coa') {
        targetTab = 'tab-unified-coa';
        winTitle = lang === 'en' ? 'Unified COA & Operations' : 'النظام الموحد والشجرة';
      } else if (moduleName === 'settings' || moduleName === 'tab-admin') {
        targetTab = 'tab-admin';
        winTitle = lang === 'en' ? 'Settings & RBAC' : 'التخصيص والصلاحيات';
      }

      spawnFloatingWindow({
        tabId: targetTab,
        title: recordId ? `${winTitle} (${recordId.slice(-6)})` : winTitle,
        focusedRecordId: recordId,
        reportsSubTab: targetReportsSub,
        unifiedSubTab: targetUnifiedSub,
      });
    },
    [lang, spawnFloatingWindow]
  );

  // ==========================================
  // DOCUMENT BOOKS & DIRECTORIES HANDLERS
  // ==========================================
  const documentBooks = useMemo(
    () =>
      scopedDb.documentBooks && scopedDb.documentBooks.length > 0
        ? scopedDb.documentBooks
        : defaultDocumentBooks,
    [scopedDb.documentBooks]
  );

  const handleSaveDocumentBook = (book: DocumentBook) => {
    const activeCid = db.activeCompanyId || db.company.id;
    const stampedBook: DocumentBook = { ...book, companyId: book.companyId || activeCid };
    const list = db.documentBooks || defaultDocumentBooks;
    const exists = list.some((b) => b.id === stampedBook.id);
    setDb({
      ...db,
      documentBooks: exists ? list.map((b) => (b.id === stampedBook.id ? stampedBook : b)) : [...list, stampedBook],
    });
  };

  const handleToggleDocumentBook = (bookId: string) => {
    const list = db.documentBooks || defaultDocumentBooks;
    setDb({
      ...db,
      documentBooks: list.map((b) => (b.id === bookId ? { ...b, isActive: !b.isActive } : b)),
    });
  };

  const handleSetDefaultDocumentBook = (bookId: string) => {
    const list = db.documentBooks || defaultDocumentBooks;
    const target = list.find((b) => b.id === bookId);
    if (!target) return;
    setDb({
      ...db,
      documentBooks: list.map((b) =>
        b.category === target.category ? { ...b, isDefault: b.id === bookId } : b
      ),
    });
  };

  const handleConsumeBookSequence = (bookId: string) => {
    setDb((prev) => ({
      ...prev,
      documentBooks: (prev.documentBooks || defaultDocumentBooks).map((b) =>
        b.id === bookId ? { ...b, nextSequence: b.nextSequence + 1 } : b
      ),
    }));
  };

  // ==========================================
  // TRANSACTIONAL OPERATIONAL BUSINESS LOGIC (ATOMIC PHASE 2 COORDINATOR)
  // ==========================================
  const applyTxResult = <T,>(res: TransactionResult<T>, successMsg?: string): boolean => {
    if (res.nextDb) {
      const expectedRev = db.revision ?? 1;
      const stampedNextDb: ERPDatabase = {
        ...res.nextDb,
        revision: expectedRev + 1,
      };
      setDb(stampedNextDb);
      void saveDatabaseAtomicWithLock(res.nextDb, { expectedRevision: expectedRev }).then((lockRes) => {
        if (lockRes.conflict) {
          notify('error', lockRes.error || 'تعارض تزامن البيانات من تبويب آخر.');
        }
      });
    }
    if (!res.ok) {
      notify(res.approvalRequired ? 'info' : 'error', res.error || 'تعذر إتمام العملية.');
      return false;
    }
    if (successMsg) notify('success', successMsg);
    return true;
  };

  const handleSaveDraftInvoice = (invoice: Invoice) => {
    const res = saveDraftInvoiceTransaction(db, currentUser, invoice);
    return applyTxResult(res);
  };

  const handlePostSalesInvoice = (invoice: Invoice, opts?: TransactionOptions): boolean => {
    const res = postSalesInvoiceTransaction(db, currentUser, invoice, opts);
    return applyTxResult(res);
  };

  const handlePostPurchaseInvoice = (invoice: Invoice, opts?: TransactionOptions): boolean => {
    const res = postPurchaseInvoiceTransaction(db, currentUser, invoice, opts);
    return applyTxResult(res);
  };

  const handleCancelInvoice = (invoiceId: string) => {
    const res = cancelInvoiceTransaction(db, currentUser, invoiceId);
    applyTxResult(res, 'تم إلغاء الفاتورة وعكس أثرها بالكامل.');
  };

  const handleBatchPostVouchers = (vouchers: PaymentVoucher[], opts?: TransactionOptions): boolean => {
    const res = postVouchersBatchTransaction(db, currentUser, vouchers, opts);
    return applyTxResult(res);
  };

  const handleCancelVoucher = (voucherId: string) => {
    const res = cancelVoucherTransaction(db, currentUser, voucherId);
    applyTxResult(res, 'تم إلغاء السند وعكس أثره بنجاح.');
  };

  const handleTreasuryTransfer = (transfer: TreasuryTransfer) => {
    const res = executeTreasuryTransferTransaction(db, currentUser, transfer, currentBranch.id);
    applyTxResult(res);
  };

  const handleSaveCustomBookEntry = (
    entry: CustomLedgerEntry,
    options?: { syncVoucher?: boolean }
  ) => {
    const res = saveCustomBookEntryTransaction(db, currentUser, currentBranch.id, entry, options);
    applyTxResult(res, `تم حفظ وترحيل قيد الدفتر (${entry.entryNumber}) بنجاح.`);
  };

  const handlePostExpense = (expense: ExpenseRecord) => {
    const res = postExpenseTransaction(db, currentUser, expense);
    applyTxResult(res);
  };

  const handlePostManualEntry = (entry: JournalEntry) => {
    const res = postManualJournalTransaction(db, currentUser, entry);
    applyTxResult(res);
  };

  const handleReverseJournalEntry = (entryId: string, reason: string) => {
    const res = reverseJournalTransaction(db, currentUser, entryId, reason);
    if (applyTxResult(res) && res.data) {
      notify('success', `تم إنشاء القيد العكسي ${res.data.entryNumber} بنجاح.`);
    }
  };

  const handleExecuteTransfer = (transfer: InventoryTransfer) => {
    const res = executeStockTransferTransaction(db, currentUser, transfer);
    applyTxResult(res, `تم تنفيذ التحويل المخزني ${transfer.transferNumber} بنجاح.`);
  };

  const handleReverseTransfer = (transfer: InventoryTransfer) => {
    const res = reverseStockTransferTransaction(db, currentUser, transfer);
    applyTxResult(res, `تم عكس التحويل المخزني ${transfer.transferNumber} بنجاح.`);
  };

  const handleAdjustStock = (itemId: string, warehouseId: string, diff: number, reason: string) => {
    const res = adjustStockTransaction(db, currentUser, itemId, warehouseId, diff, reason, currentBranch.id);
    applyTxResult(res, 'تم تنفيذ التسوية المخزنية وتحديث المخزون والقيود بنجاح.');
  };

  const handleSaveStocktaking = (stocktake: PhysicalStocktaking) => {
    const existing = db.stocktakings.find((s) => s.id === stocktake.id);
    if (existing?.status === 'approved') return;
    setDb((prev) => ({
      ...prev,
      stocktakings: existing
        ? prev.stocktakings.map((s) => (s.id === stocktake.id ? stocktake : s))
        : [stocktake, ...prev.stocktakings],
    }));
    notify('success', `تم حفظ مسودة الجرد ${stocktake.stocktakeNumber}.`);
  };

  const handleApproveStocktaking = (stocktake: PhysicalStocktaking) => {
    const res = approveStocktakingTransaction(db, currentUser, stocktake);
    applyTxResult(res, `تم اعتماد محضر الجرد ${stocktake.stocktakeNumber} وتحديث المخزون والقيود بنجاح.`);
  };

  const handleDisbursePayroll = (payroll: PayrollRun) => {
    const res = disbursePayrollTransaction(db, currentUser, payroll, currentBranch.id);
    applyTxResult(res);
  };

  const handleDisposeAsset = (
    assetId: string,
    saleProceeds: number,
    treasuryId: string,
    disposalDate: string,
    notes?: string
  ) => {
    const res = disposeFixedAssetTransaction(
      db,
      currentUser,
      assetId,
      saleProceeds,
      treasuryId,
      disposalDate,
      notes
    );
    applyTxResult(res, 'تم استبعاد / بيع الأصل الثابت وترحيل قيد التسوية بنجاح.');
  };

  const handleRunDepreciation = (totalDepr: number) => {
    const res = runDepreciationTransaction(db, currentUser, totalDepr, currentBranch.id);
    applyTxResult(res, 'تم احتساب وترحيل قيد إهلاك الأصول الثابتة بنجاح.');
  };

  const handleSwitchCompany = useCallback(
    async (targetCompanyId: string) => {
      if (!isPlatformSuperAdmin(currentUser)) {
        notify('error', 'عذراً، التنقل بين المنشآت متاح لمالك المنصة (Super Admin) فقط.');
        return;
      }
      const accessCheck = assertTenantAccess(currentUser, targetCompanyId);
      if (!accessCheck.ok) {
        notify('error', accessCheck.error || 'عذراً، لا تملك صلاحية الوصول إلى هذه المنشأة.');
        return;
      }

      if (cloudSessionActive) {
        try {
          if (cloudSaveTimerRef.current) {
            clearTimeout(cloudSaveTimerRef.current);
            cloudSaveTimerRef.current = null;
            const curCid = db.activeCompanyId || db.company.id;
            await cloudApiService.saveCompanyState(db, curCid, cloudRevisionRef.current);
          }
          const switched = await cloudApiService.switchCompany(targetCompanyId);
          const { hydratedDb } = await hydrateWorkspaceFromCloud();
          notify('info', `تم التبديل إلى منشأة: ${switched.company?.nameAr || hydratedDb.company.nameAr}`);
          return;
        } catch (err: unknown) {
          notify('error', err instanceof Error ? err.message : 'فشل التبديل إلى المنشأة المطلوبة.');
          return;
        }
      }

      const nextDb = switchActiveCompanyInDb(db, targetCompanyId);
      setDb(nextDb);
      const nextBranch =
        nextDb.branches.find((b) => b.companyId === targetCompanyId) || nextDb.branches[0];
      if (nextBranch) setCurrentBranch(nextBranch);
      const baseCurr =
        nextDb.currencies.find((c) => c.code === nextDb.company.baseCurrency) ||
        nextDb.currencies.find((c) => c.isBase) ||
        nextDb.currencies[0];
      if (baseCurr) setCurrentCurrency(baseCurr);
      notify('info', `تم التبديل إلى منشأة: ${nextDb.company.nameAr}`);
    },
    [db, currentUser, cloudSessionActive, hydrateWorkspaceFromCloud, notify]
  );

  const executeResetDatabase = () => {
    const pristine = resetToDemoDatabase();
    setDb(pristine);
    if (pristine.branches[0]) setCurrentBranch(pristine.branches[0]);
    if (pristine.currencies[0]) setCurrentCurrency(pristine.currencies[0]);
    if (pristine.users[0]) setCurrentUser(pristine.users[0]);
    setIsResetConfirmOpen(false);
    notify('success', 'تمت إعادة ضبط النظام إلى البيانات التجريبية بنجاح.');
  };

  const handleSaveColumnPrefs = useCallback((tableId: string, prefs: TableColumnPref[]) => {
    setDb((prev) => {
      const currentUi = prev.settings.uiPreferences || {
        fontSize: 14,
        accentPreset: 'amber',
        hiddenModules: [],
        tableColumnPrefs: {},
      };
      return {
        ...prev,
        settings: {
          ...prev.settings,
          uiPreferences: {
            ...currentUi,
            tableColumnPrefs: {
              ...(currentUi.tableColumnPrefs || {}),
              [tableId]: prefs,
            },
          },
        },
      };
    });
  }, []);

  const savedColPrefsMap = db.settings.uiPreferences?.tableColumnPrefs || {};

  // Visible tabs configuration (honors both V20 UI tab toggles and Operational Control Center module gates)
  const visibleTabs = useMemo(() => {
    const cfg = db.settings.uiPreferences?.tabsConfig;
    const base = cfg && cfg.length > 0 ? cfg : defaultTabsConfig;
    const mods = db.settings.operationalControl?.enabledModules;
    return base.filter((tItem) => {
      if (tItem.id === 'tab-admin') return true;
      if (!tItem.visible) return false;
      if (!mods) return true;
      switch (tItem.id) {
        case 'tab-pos':
          return mods.sales || mods.purchases || mods.pos;
        case 'tab-bonds':
          return mods.vouchers;
        case 'tab-ledgers':
          return mods.accounting;
        case 'tab-inventory':
          return mods.inventory;
        case 'tab-cust':
          return mods.parties;
        case 'tab-reports':
          return mods.reports;
        case 'tab-unified-coa':
          return mods.accounting || mods.hrPayroll || mods.fixedAssets;
        default:
          return true;
      }
    });
  }, [db.settings.uiPreferences?.tabsConfig, db.settings.operationalControl?.enabledModules]);

  // Liquidity Total in Base Currency (scoped to active company)
  const totalLiquidityBase = useMemo(
    () =>
      scopedDb.treasuryAccounts
        .filter((t) => t.status === 'active')
        .reduce((sum, t) => sum + t.balance * getCurrencyRate(t.currency), 0),
    [scopedDb.treasuryAccounts, getCurrencyRate]
  );

  const helpTopic: HelpTopic = {
    title: 'نظام المنصور V20 المتكامل — دليل الاستخدام السريع',
    purpose: 'واجهة العمل السريعة بنظام الجداول ولوحة المفاتيح مع محرك القيد المزدوج وجرد المستودعات.',
    responsibleRole: 'المالك، المحاسب العام، الكاشير، أمين المستودع',
    operationalSteps: [
      'استخدم شريط التبويبات العلوي للتنقل الفوري بين الفواتير، السندات، الدفاتر، الجرد، العملاء، التقارير، الشجرة الموحدة، والتخصيص.',
      'داخل الجداول: اضغط ↑ و ↓ لإضافة والتنقل بين الصفوف، و Enter للانتقال السريع بين الحقول.',
      'استخدم زر "إدارة الدفاتر" لتحديد بادئات الترقيم وفتح دفاتر مخصصة لكل نشاط.',
    ],
    accountingImpact: 'يُنشئ النظام قيداً محاسبياً مزدوجاً متوازناً ويحدث أرصدة الصناديق والعملاء والموردين فوراً.',
    inventoryImpact: 'يُراقب الرصيد اللحظي في المستودعات ويمنع البيع بالسالب حسب سياسة المنشأة.',
    commonMistakes: ['إغلاق الفاتورة قبل اختيار الصنف من القائمة المنسدلة أو ضبط الكمية.'],
    bestPractices: 'مراجعة شريط السيولة العلوي والتقرير الشامل بنهاية كل وردية وأخذ نسخة احتياطية دورية.',
  };

  const unreadAlertsCount = useMemo(
    () => scopedDb.taskAlerts.filter((t) => !t.isCompleted).length,
    [scopedDb.taskAlerts]
  );

  const launcherItems: {
    labelAr: string;
    labelEn: string;
    tabId: V20TabId;
    reportsSubTab?: ReportsSubTabId;
    unifiedSubTab?: UnifiedSubTabId;
  }[] = [
    { labelAr: 'فاتورة مبيعات / مشتريات (نافذة مستقلة)', labelEn: 'New Invoice Window', tabId: 'tab-pos' },
    { labelAr: 'سند قبض / صرف جديد (نافذة مستقلة)', labelEn: 'New Voucher Window', tabId: 'tab-bonds' },
    { labelAr: 'كشف حساب عميل / مورد', labelEn: 'Party Account Statement', tabId: 'tab-reports', reportsSubTab: 'statement' },
    { labelAr: 'التقرير الشامل للإدارة', labelEn: 'Executive Comprehensive Report', tabId: 'tab-reports', reportsSubTab: 'v20_comp' },
    { labelAr: 'حركة العملاء اليومية والإرسال', labelEn: 'Daily Customer Movement', tabId: 'tab-reports', reportsSubTab: 'daily_customers' },
    { labelAr: 'مركز التقارير (22 تقريراً)', labelEn: '22 Reports Center', tabId: 'tab-reports', reportsSubTab: 'hub_22' },
    { labelAr: 'الدفاتر اليومية والقيود', labelEn: 'Journals & Ledgers', tabId: 'tab-ledgers' },
    { labelAr: 'الجرد والحركة والمستودعات', labelEn: 'Inventory & Stock', tabId: 'tab-inventory' },
    { labelAr: 'العملاء والموردون والعملات', labelEn: 'Parties & Currencies', tabId: 'tab-cust' },
    { labelAr: 'المصروفات والشجرة والرواتب', labelEn: 'Expenses, COA & HR', tabId: 'tab-unified-coa', unifiedSubTab: 'expenses' },
  ];

  const renderWorkbenchView = (opts: {
    tabId: V20TabId;
    isActive?: boolean;
    focusedId?: string;
    rSubTab?: ReportsSubTabId;
    uSubTab?: UnifiedSubTabId;
    stmtTarget?: { type: 'customer' | 'vendor'; id: string } | null;
  }) => {
    const activeCid = db.activeCompanyId || db.company.id;
    switch (opts.tabId) {
      case 'tab-pos':
        return (
          <InvoiceWorkbench
            invoices={scopedDb.invoices}
            warehouseDocuments={scopedDb.warehouseDocuments || []}
            customers={scopedDb.customers}
            vendors={scopedDb.vendors}
            warehouses={scopedDb.warehouses}
            inventoryItems={scopedDb.inventoryItems}
            warehouseStock={scopedDb.warehouseStock}
            treasuryAccounts={scopedDb.treasuryAccounts}
            currencies={db.currencies}
            documentBooks={documentBooks}
            departments={scopedDb.departments || []}
            currentBranch={currentBranch}
            currentCurrency={currentCurrency}
            currentUser={currentUser}
            company={scopedDb.company}
            allowNegativeStock={db.settings.allowNegativeStock}
            defaultTaxRate={db.settings.defaultTaxRate}
            enableTax={db.settings.enableTax}
            autoDownloadInvoices={db.settings.autoDownloadInvoices}
            whatsappTemplates={db.settings.whatsappTemplates}
            printTemplates={resolvedCompanyPrintTemplates}
            savedColumnPrefs={savedColPrefsMap['v20-invoice-grid']}
            focusedRecordId={opts.focusedId}
            commercialOrders={scopedDb.commercialOrders || []}
            posShifts={scopedDb.posShifts || []}
            heldPosCarts={scopedDb.heldPosCarts || []}
            salesReps={scopedDb.employees}
            fieldRules={
              db.settings.operationalControl?.screenFieldRules?.['sales_invoice'] ||
              db.settings.operationalControl?.screenFieldRules?.['invoice'] ||
              []
            }
            onSaveCommercialOrder={(ord: CommercialOrder) =>
              setDb((prev) => {
                const cid = prev.activeCompanyId || prev.company.id;
                const stamped = { ...ord, companyId: ord.companyId || cid };
                const list = prev.commercialOrders || [];
                const ex = list.some((x) => x.id === stamped.id);
                return {
                  ...prev,
                  commercialOrders: ex ? list.map((x) => (x.id === stamped.id ? stamped : x)) : [stamped, ...list],
                };
              })
            }
            onConvertOrderToInvoice={(order: CommercialOrder) => {
              const isPurchaseSide =
                order.orderType === 'طلب_شراء' ||
                order.orderType === 'أمر_شراء' ||
                order.orderType === 'استلام_بضاعة' ||
                order.orderType === 'إشعار_مدين';
              const nextNum = generateNextDocNumber(
                isPurchaseSide ? db.settings.purchasePrefix : db.settings.invoicePrefix,
                scopedDb.invoices.map((i) => i.invoiceNumber),
                4
              );
              const draftInv = convertCommercialOrderToInvoice(order, nextNum, currentUser);
              const res = saveDraftInvoiceTransaction(db, currentUser, draftInv);
              if (!res.ok || !res.nextDb) {
                notify('error', res.error || 'تعذر تحويل المستند التجاري إلى فاتورة.');
                return;
              }
              const updatedDb: ERPDatabase = {
                ...res.nextDb,
                commercialOrders: (res.nextDb.commercialOrders || []).map((o) =>
                  o.id === order.id
                    ? {
                        ...o,
                        status: 'converted' as const,
                        convertedInvoiceId: draftInv.id,
                        convertedInvoiceNumber: draftInv.invoiceNumber,
                      }
                    : o
                ),
              };
              setDb(updatedDb);
              setFocusedRecordId(draftInv.id);
              notify('success', `تم تحويل (${order.orderNumber}) إلى مسودة فاتورة (${draftInv.invoiceNumber}).`);
            }}
            onUpdatePosState={(patch) =>
              setDb((prev) => {
                const cid = prev.activeCompanyId || prev.company.id;
                return {
                  ...prev,
                  ...(patch.posShifts
                    ? {
                        posShifts: [
                          ...(prev.posShifts || []).filter((s) => s.companyId !== cid),
                          ...patch.posShifts.map((s) => ({ ...s, companyId: s.companyId || cid })),
                        ],
                      }
                    : {}),
                  ...(patch.heldPosCarts
                    ? {
                        heldPosCarts: [
                          ...(prev.heldPosCarts || []).filter((h) => h.companyId !== cid),
                          ...patch.heldPosCarts.map((h) => ({ ...h, companyId: h.companyId || cid })),
                        ],
                      }
                    : {}),
                };
              })
            }
            onSaveColumnPrefs={handleSaveColumnPrefs}
            onPostSalesInvoice={handlePostSalesInvoice}
            onPostPurchaseInvoice={handlePostPurchaseInvoice}
            onSaveDraftInvoice={handleSaveDraftInvoice}
            onCancelInvoice={handleCancelInvoice}
            onSaveWarehouseDoc={(doc) =>
              setDb((prev) => ({
                ...prev,
                warehouseDocuments: [
                  { ...doc, companyId: doc.companyId || prev.activeCompanyId || prev.company.id },
                  ...(prev.warehouseDocuments || []),
                ],
              }))
            }
            onExecuteTransfer={handleExecuteTransfer}
            onSaveDocumentBook={handleSaveDocumentBook}
            onToggleDocumentBook={handleToggleDocumentBook}
            onSetDefaultDocumentBook={handleSetDefaultDocumentBook}
            onConsumeBookSequence={handleConsumeBookSequence}
            onQuickSaveCustomer={(c) =>
              setDb((prev) => {
                const stamped = { ...c, companyId: c.companyId || prev.activeCompanyId || prev.company.id };
                return {
                  ...prev,
                  customers: prev.customers.some((x) => x.id === stamped.id)
                    ? prev.customers.map((x) => (x.id === stamped.id ? stamped : x))
                    : [stamped, ...prev.customers],
                };
              })
            }
            onQuickSaveVendor={(v) =>
              setDb((prev) => {
                const stamped = { ...v, companyId: v.companyId || prev.activeCompanyId || prev.company.id };
                return {
                  ...prev,
                  vendors: prev.vendors.some((x) => x.id === stamped.id)
                    ? prev.vendors.map((x) => (x.id === stamped.id ? stamped : x))
                    : [stamped, ...prev.vendors],
                };
              })
            }
            onQuickSaveItem={(it) =>
              setDb((prev) => {
                const stamped = { ...it, companyId: it.companyId || prev.activeCompanyId || prev.company.id };
                return {
                  ...prev,
                  inventoryItems: prev.inventoryItems.some((x) => x.id === stamped.id)
                    ? prev.inventoryItems.map((x) => (x.id === stamped.id ? stamped : x))
                    : [stamped, ...prev.inventoryItems],
                };
              })
            }
            onNotify={notify}
          />
        );
      case 'tab-bonds':
        return (
          <VoucherWorkbench
            vouchers={scopedDb.paymentVouchers}
            treasuryAccounts={scopedDb.treasuryAccounts}
            treasuryTransfers={scopedDb.treasuryTransfers}
            customers={scopedDb.customers}
            vendors={scopedDb.vendors}
            invoices={scopedDb.invoices}
            bankReconciliations={scopedDb.bankReconciliations || []}
            expenseCategories={scopedDb.expenseCategories}
            chartOfAccounts={scopedDb.chartOfAccounts}
            currencies={db.currencies}
            documentBooks={documentBooks}
            currentBranch={currentBranch}
            currentCurrency={currentCurrency}
            currentUser={currentUser}
            company={scopedDb.company}
            paymentMethods={db.settings.paymentMethods}
            whatsappTemplates={db.settings.whatsappTemplates}
            printTemplates={resolvedCompanyPrintTemplates}
            savedColumnPrefs={savedColPrefsMap['v20-bond-grid']}
            focusedRecordId={opts.focusedId}
            onSaveColumnPrefs={handleSaveColumnPrefs}
            onBatchPostVouchers={handleBatchPostVouchers}
            onCancelVoucher={handleCancelVoucher}
            onTreasuryTransfer={handleTreasuryTransfer}
            onSaveBankReconciliation={(rec: BankReconciliationSession) =>
              setDb((prev) => {
                const stamped = { ...rec, companyId: rec.companyId || prev.activeCompanyId || prev.company.id };
                const list = prev.bankReconciliations || [];
                const ex = list.some((x) => x.id === stamped.id);
                return {
                  ...prev,
                  bankReconciliations: ex ? list.map((x) => (x.id === stamped.id ? stamped : x)) : [stamped, ...list],
                };
              })
            }
            onSaveDocumentBook={handleSaveDocumentBook}
            onToggleDocumentBook={handleToggleDocumentBook}
            onSetDefaultDocumentBook={handleSetDefaultDocumentBook}
            onConsumeBookSequence={handleConsumeBookSequence}
            onNotify={notify}
          />
        );
      case 'tab-ledgers':
        return (
          <LedgersAccountingWorkbench
            chartOfAccounts={scopedDb.chartOfAccounts}
            journalEntries={scopedDb.journalEntries}
            costCenters={scopedDb.costCenters}
            invoices={scopedDb.invoices}
            paymentVouchers={scopedDb.paymentVouchers}
            expenseRecords={scopedDb.expenseRecords}
            customBooks={scopedDb.customBooks || []}
            customBookEntries={scopedDb.customBookEntries || []}
            treasuryAccounts={scopedDb.treasuryAccounts}
            customers={scopedDb.customers}
            vendors={scopedDb.vendors}
            expenseCategories={scopedDb.expenseCategories}
            currencies={db.currencies}
            fiscalPeriods={scopedDb.fiscalPeriods || []}
            currentBranch={currentBranch}
            currentCurrency={currentCurrency}
            currentUser={currentUser}
            company={scopedDb.company}
            printTemplates={resolvedCompanyPrintTemplates}
            savedColumnPrefs={savedColPrefsMap['v20-ledger-log']}
            focusedRecordId={opts.focusedId}
            onSaveColumnPrefs={handleSaveColumnPrefs}
            onPostManualEntry={handlePostManualEntry}
            onReverseJournalEntry={handleReverseJournalEntry}
            onSaveCustomBook={(book) =>
              setDb((prev) => {
                const stamped = { ...book, companyId: book.companyId || prev.activeCompanyId || prev.company.id };
                const list = prev.customBooks || [];
                const ex = list.some((b) => b.id === stamped.id);
                return {
                  ...prev,
                  customBooks: ex ? list.map((b) => (b.id === stamped.id ? stamped : b)) : [...list, stamped],
                };
              })
            }
            onSaveCustomBookEntry={handleSaveCustomBookEntry}
            onOpenPrintModal={openPrintDocWindow}
            onNotify={notify}
          />
        );
      case 'tab-inventory':
        return (
          <InventoryWorkbench
            items={scopedDb.inventoryItems}
            warehouses={scopedDb.warehouses}
            warehouseStock={scopedDb.warehouseStock}
            stockMovements={scopedDb.stockMovements}
            inventoryTransfers={scopedDb.inventoryTransfers}
            stocktakings={scopedDb.stocktakings}
            warehouseDocuments={scopedDb.warehouseDocuments || []}
            departments={scopedDb.departments || []}
            unitsOfMeasure={db.unitsOfMeasure || []}
            company={scopedDb.company}
            branch={currentBranch}
            currentUser={currentUser}
            currencySymbol={currentCurrency.symbol}
            printTemplates={resolvedCompanyPrintTemplates}
            savedColumnPrefsMap={savedColPrefsMap}
            focusedRecordId={opts.focusedId}
            stockCostLayers={scopedDb.stockCostLayers || []}
            inventoryBatches={scopedDb.inventoryBatches || []}
            storageLocations={scopedDb.storageLocations || []}
            onSaveBatch={(batch: InventoryBatch) =>
              setDb((prev) => {
                const stamped = { ...batch, companyId: batch.companyId || prev.activeCompanyId || prev.company.id };
                const list = prev.inventoryBatches || [];
                const ex = list.some((x) => x.id === stamped.id);
                return {
                  ...prev,
                  inventoryBatches: ex ? list.map((x) => (x.id === stamped.id ? stamped : x)) : [stamped, ...list],
                };
              })
            }
            onSaveLocation={(loc: StorageLocation) =>
              setDb((prev) => {
                const stamped = { ...loc, companyId: loc.companyId || prev.activeCompanyId || prev.company.id };
                const list = prev.storageLocations || [];
                const ex = list.some((x) => x.id === stamped.id);
                return {
                  ...prev,
                  storageLocations: ex ? list.map((x) => (x.id === stamped.id ? stamped : x)) : [stamped, ...list],
                };
              })
            }
            onSaveColumnPrefs={handleSaveColumnPrefs}
            onSaveItem={(item) =>
              setDb((prev) => {
                const stamped = { ...item, companyId: item.companyId || prev.activeCompanyId || prev.company.id };
                return {
                  ...prev,
                  inventoryItems: prev.inventoryItems.some((i) => i.id === stamped.id)
                    ? prev.inventoryItems.map((i) => (i.id === stamped.id ? stamped : i))
                    : [stamped, ...prev.inventoryItems],
                };
              })
            }
            onExecuteTransfer={handleExecuteTransfer}
            onReverseTransfer={handleReverseTransfer}
            onAdjustStock={handleAdjustStock}
            onSaveWarehouseDoc={(doc) =>
              setDb((prev) => ({
                ...prev,
                warehouseDocuments: [
                  { ...doc, companyId: doc.companyId || prev.activeCompanyId || prev.company.id },
                  ...(prev.warehouseDocuments || []),
                ],
              }))
            }
            onSaveStocktaking={(st) =>
              handleSaveStocktaking({ ...st, companyId: st.companyId || activeCid })
            }
            onApproveStocktaking={handleApproveStocktaking}
            onNotify={notify}
          />
        );
      case 'tab-cust':
        return (
          <PartiesWorkbench
            customers={scopedDb.customers}
            vendors={scopedDb.vendors}
            regionalAreas={db.regionalAreas}
            currencies={db.currencies}
            company={scopedDb.company}
            branch={currentBranch}
            printTemplates={resolvedCompanyPrintTemplates}
            savedColumnPrefsMap={savedColPrefsMap}
            onSaveColumnPrefs={handleSaveColumnPrefs}
            onSaveCustomer={(c) =>
              setDb((prev) => {
                const stamped = { ...c, companyId: c.companyId || prev.activeCompanyId || prev.company.id };
                return {
                  ...prev,
                  customers: prev.customers.some((x) => x.id === stamped.id)
                    ? prev.customers.map((x) => (x.id === stamped.id ? stamped : x))
                    : [stamped, ...prev.customers],
                };
              })
            }
            onSaveVendor={(v) =>
              setDb((prev) => {
                const stamped = { ...v, companyId: v.companyId || prev.activeCompanyId || prev.company.id };
                return {
                  ...prev,
                  vendors: prev.vendors.some((x) => x.id === stamped.id)
                    ? prev.vendors.map((x) => (x.id === stamped.id ? stamped : x))
                    : [stamped, ...prev.vendors],
                };
              })
            }
            onSaveZone={(z: RegionalArea) =>
              setDb((prev) => ({
                ...prev,
                regionalAreas: prev.regionalAreas.some((x) => x.id === z.id)
                  ? prev.regionalAreas.map((x) => (x.id === z.id ? z : x))
                  : [...prev.regionalAreas, z],
              }))
            }
            onOpenStatement={(type, id) => {
              const partyName =
                type === 'customer'
                  ? scopedDb.customers.find((c) => c.id === id)?.nameAr
                  : scopedDb.vendors.find((v) => v.id === id)?.nameAr;
              spawnFloatingWindow({
                tabId: 'tab-reports',
                title: lang === 'en' ? `Statement: ${partyName || ''}` : `كشف حساب: ${partyName || ''}`,
                reportsSubTab: 'statement',
                statementTarget: { type, id },
              });
            }}
            onOpenPriceLookup={(customerId) => setPriceLookupModal({ open: true, customerId })}
            onNotify={notify}
          />
        );
      case 'tab-reports':
        return (
          <ReportsWorkbench
            db={scopedDb}
            currentBranch={currentBranch}
            currentUser={currentUser}
            currencySymbol={currentCurrency.symbol}
            lang={lang}
            isActive={opts.isActive ?? true}
            printTemplates={resolvedCompanyPrintTemplates}
            initialSubTab={opts.rSubTab || 'v20_comp'}
            preselectedStatementParty={opts.stmtTarget}
            savedColumnPrefsMap={savedColPrefsMap}
            onSaveColumnPrefs={handleSaveColumnPrefs}
            onSaveCustomer={(c) =>
              setDb((prev) => {
                const stamped = { ...c, companyId: c.companyId || prev.activeCompanyId || prev.company.id };
                return {
                  ...prev,
                  customers: prev.customers.some((x) => x.id === stamped.id)
                    ? prev.customers.map((x) => (x.id === stamped.id ? stamped : x))
                    : [stamped, ...prev.customers],
                };
              })
            }
            onSaveVendor={(v) =>
              setDb((prev) => {
                const stamped = { ...v, companyId: v.companyId || prev.activeCompanyId || prev.company.id };
                return {
                  ...prev,
                  vendors: prev.vendors.some((x) => x.id === stamped.id)
                    ? prev.vendors.map((x) => (x.id === stamped.id ? stamped : x))
                    : [stamped, ...prev.vendors],
                };
              })
            }
            onOpenPrintModal={openPrintDocWindow}
            onNavigateToRecord={navigateToRecord}
            onAddTask={(task: TaskAlert) =>
              setDb((prev) => ({
                ...prev,
                taskAlerts: [
                  { ...task, companyId: task.companyId || prev.activeCompanyId || prev.company.id },
                  ...prev.taskAlerts,
                ],
              }))
            }
            onToggleTaskComplete={(taskId) =>
              setDb((prev) => ({
                ...prev,
                taskAlerts: prev.taskAlerts.map((t) =>
                  t.id === taskId ? { ...t, isCompleted: !t.isCompleted } : t
                ),
              }))
            }
            onUpdateSettings={(s) => setDb((prev) => ({ ...prev, settings: s }))}
            onAddDispatchLog={(log: DispatchLogEntry) =>
              setDb((prev) => ({
                ...prev,
                dispatchLogs: [
                  { ...log, companyId: log.companyId || prev.activeCompanyId || prev.company.id },
                  ...(prev.dispatchLogs || []),
                ],
              }))
            }
            onRetryDispatch={(logId) =>
              setDb((prev) => ({
                ...prev,
                dispatchLogs: (prev.dispatchLogs || []).map((l) =>
                  l.id === logId ? { ...l, status: 'sent' as const, retryCount: l.retryCount + 1 } : l
                ),
              }))
            }
            onSaveReportDesigns={(designs: SavedReportDesign[]) =>
              setDb((prev) => {
                const cid = prev.activeCompanyId || prev.company.id;
                return {
                  ...prev,
                  savedReportDesigns: [
                    ...(prev.savedReportDesigns || []).filter((d) => d.companyId !== cid),
                    ...designs.map((d) => ({ ...d, companyId: d.companyId || cid })),
                  ],
                };
              })
            }
            onNotify={notify}
          />
        );
      case 'tab-unified-coa':
        return (
          <UnifiedOperationsWorkbench
            chartOfAccounts={scopedDb.chartOfAccounts}
            costCenters={scopedDb.costCenters}
            employees={scopedDb.employees}
            payrollRuns={scopedDb.payrollRuns}
            expenseCategories={scopedDb.expenseCategories}
            expenseRecords={scopedDb.expenseRecords}
            fixedAssets={scopedDb.fixedAssets}
            treasuryAccounts={scopedDb.treasuryAccounts}
            warehouses={scopedDb.warehouses}
            departments={scopedDb.departments || []}
            regionalAreas={db.regionalAreas}
            currencies={db.currencies}
            company={scopedDb.company}
            currentBranch={currentBranch}
            currentUser={currentUser}
            currencySymbol={currentCurrency.symbol}
            initialSubTab={opts.uSubTab || 'coa'}
            savedColumnPrefsMap={savedColPrefsMap}
            focusedRecordId={opts.focusedId}
            invoices={scopedDb.invoices}
            onSaveColumnPrefs={handleSaveColumnPrefs}
            onSaveAccount={(acc: Account) =>
              setDb((prev) => {
                const stamped = { ...acc, companyId: acc.companyId || prev.activeCompanyId || prev.company.id };
                return {
                  ...prev,
                  chartOfAccounts: prev.chartOfAccounts.some((x) => x.id === stamped.id)
                    ? prev.chartOfAccounts.map((x) => (x.id === stamped.id ? stamped : x))
                    : [...prev.chartOfAccounts, stamped],
                };
              })
            }
            onSaveEmployee={(emp: Employee) =>
              setDb((prev) => {
                const stamped = { ...emp, companyId: emp.companyId || prev.activeCompanyId || prev.company.id };
                return {
                  ...prev,
                  employees: prev.employees.some((x) => x.id === stamped.id)
                    ? prev.employees.map((x) => (x.id === stamped.id ? stamped : x))
                    : [stamped, ...prev.employees],
                };
              })
            }
            onDisbursePayroll={handleDisbursePayroll}
            onPostExpense={handlePostExpense}
            onSaveAsset={(asset: FixedAsset) =>
              setDb((prev) => {
                const stamped = { ...asset, companyId: asset.companyId || prev.activeCompanyId || prev.company.id };
                return {
                  ...prev,
                  fixedAssets: prev.fixedAssets.some((x) => x.id === stamped.id)
                    ? prev.fixedAssets.map((x) => (x.id === stamped.id ? stamped : x))
                    : [stamped, ...prev.fixedAssets],
                };
              })
            }
            onRunDepreciation={handleRunDepreciation}
            onDisposeAsset={handleDisposeAsset}
            onSaveTreasuryAccount={(acc: TreasuryAccount) =>
              setDb((prev) => {
                const stamped = { ...acc, companyId: acc.companyId || prev.activeCompanyId || prev.company.id };
                return {
                  ...prev,
                  treasuryAccounts: prev.treasuryAccounts.some((t) => t.id === stamped.id)
                    ? prev.treasuryAccounts.map((t) => (t.id === stamped.id ? stamped : t))
                    : [...prev.treasuryAccounts, stamped],
                };
              })
            }
            onSaveWarehouse={(w: Warehouse) =>
              setDb((prev) => {
                const stamped = { ...w, companyId: w.companyId || prev.activeCompanyId || prev.company.id };
                return {
                  ...prev,
                  warehouses: prev.warehouses.some((x) => x.id === stamped.id)
                    ? prev.warehouses.map((x) => (x.id === stamped.id ? stamped : x))
                    : [...prev.warehouses, stamped],
                };
              })
            }
            onSaveDepartment={(d: DepartmentItem) =>
              setDb((prev) => {
                const stamped = { ...d, companyId: d.companyId || prev.activeCompanyId || prev.company.id };
                const list = prev.departments || [];
                return {
                  ...prev,
                  departments: list.some((x) => x.id === stamped.id)
                    ? list.map((x) => (x.id === stamped.id ? stamped : x))
                    : [...list, stamped],
                };
              })
            }
            onSaveZone={(z: RegionalArea) =>
              setDb((prev) => ({
                ...prev,
                regionalAreas: prev.regionalAreas.some((x) => x.id === z.id)
                  ? prev.regionalAreas.map((x) => (x.id === z.id ? z : x))
                  : [...prev.regionalAreas, z],
              }))
            }
            onNotify={notify}
          />
        );
      case 'tab-admin':
        return (
          <SettingsWorkbench
            db={db}
            currentUser={currentUser}
            lang={lang}
            onChangeLanguage={handleChangeLanguage}
            onUpdateCompany={(c) => {
              setDb((prev) => ({
                ...prev,
                company: c,
                companies: (prev.companies || [prev.company]).map((x) => (x.id === c.id ? c : x)),
              }));
              if (cloudSessionActive) {
                void cloudApiService
                  .updateCompany(c.id, {
                    nameAr: c.nameAr,
                    nameEn: c.nameEn,
                    countryCode: c.countryCode,
                    baseCurrency: c.baseCurrency,
                    valuationPolicy: c.valuationPolicy,
                    commercialRecord: c.commercialRecord,
                    taxNumber: c.taxNumber,
                    phone: c.phone,
                    email: c.email,
                    address: c.address,
                    fiscalYearStart: c.fiscalYearStart,
                  })
                  .catch((err) => {
                    notify('error', err instanceof Error ? err.message : 'تعذر مزامنة تحديث المنشأة مع PostgreSQL.');
                  });
              }
            }}
            onUpdateSettings={(s) => setDb((prev) => ({ ...prev, settings: s }))}
            onSavePrintTemplates={handleSavePrintTemplates}
            onSaveBranch={(b: Branch) =>
              setDb((prev) => {
                const stamped = { ...b, companyId: b.companyId || prev.activeCompanyId || prev.company.id };
                return {
                  ...prev,
                  branches: prev.branches.some((x) => x.id === stamped.id)
                    ? prev.branches.map((x) => (x.id === stamped.id ? stamped : x))
                    : [...prev.branches, stamped],
                };
              })
            }
            onSaveWarehouse={(w: Warehouse) =>
              setDb((prev) => {
                const stamped = { ...w, companyId: w.companyId || prev.activeCompanyId || prev.company.id };
                return {
                  ...prev,
                  warehouses: prev.warehouses.some((x) => x.id === stamped.id)
                    ? prev.warehouses.map((x) => (x.id === stamped.id ? stamped : x))
                    : [...prev.warehouses, stamped],
                };
              })
            }
            onSaveUnitOfMeasure={(u: UnitOfMeasure) =>
              setDb((prev) => {
                const list = prev.unitsOfMeasure || [];
                return {
                  ...prev,
                  unitsOfMeasure: list.some((x) => x.id === u.id)
                    ? list.map((x) => (x.id === u.id ? u : x))
                    : [...list, u],
                };
              })
            }
            onUpdateCurrencies={(currencies) => {
              if (!(currentUser.canEditExchangeRates ?? currentUser.canManageSettings)) {
                notify('error', 'عذراً، لا تملك صلاحية تعديل العملات وأسعار الصرف.');
                return;
              }
              setDb((prev) => ({ ...prev, currencies }));
              const updatedCurr = currencies.find((c) => c.code === currentCurrency.code);
              if (updatedCurr) setCurrentCurrency(updatedCurr);
            }}
            onUpdateUserPermissions={(u) => {
              const res = updateUserPermissionsTransaction(db, currentUser, u);
              if (applyTxResult(res)) {
                if (currentUser.id === u.id) {
                  setCurrentUser(u);
                }
                if (cloudSessionActive) {
                  void cloudApiService
                    .saveCompanyUser({
                      id: u.id,
                      username: u.username,
                      fullName: u.fullName,
                      email: u.email,
                      role: u.role,
                      allowedCompanyIds: u.allowedCompanyIds,
                      branchId: u.branchId,
                      active: u.active,
                      flags: {
                        canViewReports: u.canViewReports,
                        canPostEntries: u.canPostEntries,
                        canAdjustInventory: u.canAdjustInventory,
                        canViewCostsAndProfits: u.canViewCostsAndProfits,
                        canManageSettings: u.canManageSettings,
                        canEditInvoices: u.canEditInvoices,
                        canDeleteInvoices: u.canDeleteInvoices,
                        canEditVouchers: u.canEditVouchers,
                        canDeleteVouchers: u.canDeleteVouchers,
                        canEditExchangeRates: u.canEditExchangeRates,
                      },
                      permissionMatrix: u.permissionMatrix,
                    })
                    .catch((err) => {
                      notify('error', err instanceof Error ? err.message : 'فشل مزامنة صلاحيات المستخدم مع الخادم.');
                    });
                }
              }
            }}
            onAddUser={(u) => {
              const res = addUserTransaction(db, currentUser, u);
              applyTxResult(res, `تم إضافة المستخدم (${u.fullName}) بنجاح.`);
            }}
            onSaveDocumentBook={handleSaveDocumentBook}
            onToggleDocumentBook={handleToggleDocumentBook}
            onSetDefaultDocumentBook={handleSetDefaultDocumentBook}
            onResetDatabase={executeResetDatabase}
            onRestoreDatabase={async (restored, options) => {
              const check = validateDatabaseObject(restored);
              if (!check.valid || !check.db) {
                const msg = check.error || 'ملف النسخة المستعادة تالف أو غير مكتمل.';
                notify('error', msg);
                return { ok: false, status: 400, code: 'INVALID_BACKUP_PAYLOAD', error: msg };
              }

              const currentActiveCid = db.activeCompanyId || db.company.id;
              const restoredCid =
                String(check.db.company?.id || check.db.activeCompanyId || currentActiveCid).trim() ||
                currentActiveCid;
              const targetMode: 'current_company' | 'restored_company' =
                options?.targetMode ||
                (isPlatformSuperAdmin(currentUser) && restoredCid !== currentActiveCid
                  ? 'restored_company'
                  : 'current_company');

              if (targetMode === 'restored_company' && !isPlatformSuperAdmin(currentUser)) {
                const msg =
                  'صلاحية مرفوضة (403): إنشاء أو استعادة مؤسسة مستقلة مخصص لمالك المؤسسة (Super Admin) فقط.';
                notify('error', msg);
                return { ok: false, status: 403, code: 'FORBIDDEN_SUPER_ADMIN_ONLY', error: msg };
              }

              const targetCid = targetMode === 'current_company' ? currentActiveCid : restoredCid;

              if (cloudSessionActive) {
                if (cloudSaveTimerRef.current) {
                  clearTimeout(cloudSaveTimerRef.current);
                  cloudSaveTimerRef.current = null;
                }

                const res = await cloudApiService.restoreCompanyBackup({
                  targetMode,
                  targetCompanyId: targetCid,
                  db: check.db,
                  expectedRevision: targetMode === 'current_company' ? cloudRevisionRef.current : undefined,
                  allowReplaceExisting: options?.allowReplaceExisting,
                  sourceLabel: options?.sourceLabel,
                });

                if (!res.ok) {
                  if (res.status === 409 && res.code === 'REVISION_CONFLICT') {
                    notify(
                      'error',
                      res.error || 'تعارض تزامن البيانات (409): يوجد تحديث أحدث على الخادم.'
                    );
                  } else if (res.status === 409 && res.code === 'COMPANY_ALREADY_EXISTS') {
                    notify(
                      'error',
                      res.error || 'المنشأة موجودة مسبقاً (409): يرجى تأكيد الاستبدال أو الاستعادة داخل المنشأة الحالية.'
                    );
                  } else if (res.status === 403) {
                    notify(
                      'error',
                      res.error || 'صلاحية مرفوضة (403): عزل المنشآت منع اعتماد الاستعادة.'
                    );
                  } else {
                    notify('error', res.error || 'تعذر اعتماد واستعادة النسخة الاحتياطية على الخادم.');
                  }
                  return {
                    ok: false,
                    status: res.status,
                    code: res.code,
                    error: res.error,
                  };
                }

                const nextAllowedIds = res.companies.map((c) => c.id);
                const { hydratedDb } = await hydrateWorkspaceFromCloud();
                const matchedServerUser = hydratedDb.users.find(
                  (u) => u.id === currentUser.id && u.active
                );
                setCurrentUser((prev) => ({
                  ...(matchedServerUser || prev),
                  allowedCompanyIds: nextAllowedIds.length > 0 ? nextAllowedIds : prev.allowedCompanyIds,
                }));
                notify(
                  'success',
                  `تم اعتماد وحفظ استعادة (${hydratedDb.company.nameAr}) في قاعدة البيانات بنجاح.`
                );
                return { ok: true };
              }

              // Offline / Local-only fallback
              const preparedLocal = prepareDatabaseForRestore(check.db, targetCid, targetMode);
              const localCompanies =
                targetMode === 'current_company'
                  ? (db.companies || [preparedLocal.company]).map((c) =>
                      c.id === targetCid ? preparedLocal.company : c
                    )
                  : [
                      ...(db.companies || []).filter((c) => c.id !== preparedLocal.company.id),
                      preparedLocal.company,
                    ];
              const finalLocalDb: ERPDatabase = {
                ...preparedLocal,
                companies: localCompanies,
                users: check.db.users && check.db.users.length > 0 ? check.db.users : db.users,
              };
              setDb(finalLocalDb);
              const restoredScoped = scopeDatabaseToCompany(finalLocalDb, targetCid);
              if (restoredScoped.branches[0]) setCurrentBranch(restoredScoped.branches[0]);
              const baseCurr =
                finalLocalDb.currencies.find((c) => c.code === finalLocalDb.company.baseCurrency) ||
                finalLocalDb.currencies.find((c) => c.isBase) ||
                finalLocalDb.currencies[0];
              if (baseCurr) setCurrentCurrency(baseCurr);
              const matchedUser = finalLocalDb.users.find((u) => u.id === currentUser.id && u.active);
              if (matchedUser) {
                setCurrentUser(matchedUser);
              } else {
                setIsAuthenticated(false);
                setAuthCanCancel(false);
                setAuthModalMode('login');
              }
              notify('success', `تمت استعادة بيانات (${finalLocalDb.company.nameAr}) بنجاح.`);
              return { ok: true };
            }}
            onUpdateDatabase={setDb}
            onNotify={notify}
          />
        );
    }
  };

  return (
    <MdiWindowProvider lang={lang}>
    <div className="min-h-screen flex flex-col bg-[var(--bg-obsidian)] text-[var(--text-main)]" dir={lang === 'en' ? 'ltr' : 'rtl'}>
      {/* V20 Sticky Top System Header */}
      <header className="sticky top-0 z-40 bg-gradient-to-l from-[#071019] to-[#0D1A29] border-b-2 border-[var(--gold)] shadow-2xl no-print">
        <div className="max-w-[1700px] mx-auto px-3 py-2 space-y-2">
          {/* Top Row: Brand, Context Selectors & System Controls */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-lg bg-[var(--gold)] text-[#03060A] flex items-center justify-center font-black text-base shadow">
                {lang === 'en' ? 'M' : 'م'}
              </div>
              <div>
                <h1 className="text-sm sm:text-base font-black text-[var(--gold)] leading-tight">
                  {db.company.nameAr}
                </h1>
                <p className="text-[11px] text-[var(--text-secondary)] font-bold">
                  ALMANSOOR SMART FINANCE ERP · {currentBranch.nameAr}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap text-xs">
              {/* Multi-Company Switcher + Onboarding Wizard Trigger (STRICTLY Super Admin Only) */}
              {isPlatformSuperAdmin(currentUser) ? (
                <div className="flex items-center gap-1 bg-[#060D15] border border-[var(--border-strong)] rounded-md px-2 py-1">
                  <Landmark className="w-3.5 h-3.5 text-[var(--gold)]" />
                  <select
                    value={db.activeCompanyId || db.company.id}
                    onChange={(e) => void handleSwitchCompany(e.target.value)}
                    className="bg-transparent text-white font-bold outline-none cursor-pointer max-w-[160px]"
                    title="تبديل المنشأة / الشركة النشطة"
                  >
                    {authorizedCompanies.map((c) => (
                      <option key={c.id} value={c.id} className="bg-[#071019]">
                        {c.nameAr}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setIsSetupWizardOpen(true)}
                    className="px-1.5 py-0.5 rounded bg-[var(--gold)] text-[#03060A] font-black text-[10px] hover:bg-[var(--gold-hover)] cursor-pointer"
                    title="تأسيس منشأة / شركة جديدة"
                  >
                    + منشأة
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1 bg-[#060D15] border border-[var(--border-strong)] rounded-md px-2 py-1">
                  <Landmark className="w-3.5 h-3.5 text-[var(--gold)]" />
                  <span className="text-white font-bold truncate max-w-[180px]" title={db.company.nameAr}>
                    {db.company.nameAr}
                  </span>
                </div>
              )}

              {/* Branch Switcher */}
              <div className="flex items-center gap-1 bg-[#060D15] border border-[var(--border-strong)] rounded-md px-2 py-1">
                <Building2 className="w-3.5 h-3.5 text-[var(--gold)]" />
                <select
                  value={currentBranch.id}
                  onChange={(e) => {
                    const b = scopedDb.branches.find((x) => x.id === e.target.value);
                    if (b) setCurrentBranch(b);
                  }}
                  className="bg-transparent text-white font-bold outline-none cursor-pointer"
                >
                  {scopedDb.branches.map((b) => (
                    <option key={b.id} value={b.id} className="bg-[#071019]">
                      {b.nameAr}
                    </option>
                  ))}
                </select>
              </div>

              {/* Currency Switcher */}
              <div className="flex items-center gap-1 bg-[#060D15] border border-[var(--border-strong)] rounded-md px-2 py-1">
                <Coins className="w-3.5 h-3.5 text-[var(--gold)]" />
                <select
                  value={currentCurrency.code}
                  onChange={(e) => {
                    const c = db.currencies.find((x) => x.code === e.target.value);
                    if (c) setCurrentCurrency(c);
                  }}
                  className="bg-transparent text-white font-bold outline-none cursor-pointer"
                >
                  {db.currencies.map((c) => (
                    <option key={c.code} value={c.code} className="bg-[#071019]">
                      {c.code} ({c.exchangeRate})
                    </option>
                  ))}
                </select>
              </div>

              {/* Authenticated User Identity Badge + Password-Verified User Switch / Logout */}
              <div className="flex items-center gap-1 bg-[#060D15] border border-[var(--gold)] rounded-md px-2 py-1">
                <Shield className="w-3.5 h-3.5 text-[var(--gold)]" />
                <span className="text-[var(--gold)] font-black whitespace-nowrap">
                  {currentUser.fullName} ({currentUser.role})
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setAuthCanCancel(true);
                    setAuthModalMode('login');
                  }}
                  className="ms-1 px-1.5 py-0.5 rounded bg-slate-800 hover:bg-[var(--gold)] hover:text-[#03060A] text-[10px] font-bold text-slate-200 cursor-pointer transition"
                  title={lang === 'en' ? 'Switch User (requires password)' : 'تبديل المستخدم (يتطلب كلمة مرور)'}
                >
                  {lang === 'en' ? 'Switch' : 'تبديل'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleLogout()}
                  className="p-0.5 rounded hover:bg-rose-900/60 text-rose-400 cursor-pointer"
                  title={lang === 'en' ? 'Sign Out' : 'تسجيل الخروج'}
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Quick Global Search (Ctrl+K) */}
              <button
                type="button"
                onClick={() => setIsGlobalSearchOpen(true)}
                className="px-2.5 py-1.5 rounded-md bg-[#08121E] border border-[var(--border-strong)] hover:border-[var(--gold)] text-white font-black flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition"
                title={t('globalSearchTooltip', lang)}
              >
                <Search className="w-3.5 h-3.5 text-[var(--gold)]" />
                <span>{t('globalSearchBtn', lang)}</span>
                <span className="hidden md:inline font-mono text-[10px] px-1 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                  Ctrl+K
                </span>
              </button>

              {/* Quick Customer-Item Historical Price Lookup */}
              <button
                type="button"
                onClick={() => setPriceLookupModal({ open: true })}
                className="px-2.5 py-1.5 rounded-md bg-[#08121E] border border-sky-500/60 hover:border-[var(--gold)] text-sky-300 hover:text-[var(--gold)] font-black flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition"
                title={t('priceLookupTooltip', lang)}
              >
                <Tag className="w-3.5 h-3.5" />
                <span>{t('priceLookupBtn', lang)}</span>
              </button>

              {/* Multi-Window MDI Launcher */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setIsWinLauncherOpen((o) => !o)}
                  className="px-2.5 py-1.5 rounded-md bg-[var(--gold)] text-[#03060A] hover:bg-[var(--gold-hover)] font-black flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer transition shadow"
                  title={lang === 'en' ? 'Open a new floating MDI window alongside your current work' : 'فتح نافذة منبثقة جديدة للعمل بالتوازي مع الشاشة الحالية'}
                >
                  <PlusSquare className="w-3.5 h-3.5" />
                  <span>{lang === 'en' ? 'New Window' : 'نافذة منبثقة'}</span>
                  <ChevronDown className="w-3 h-3" />
                </button>
                {isWinLauncherOpen && (
                  <div
                    className={`absolute top-full mt-1.5 w-72 bg-[#091422] border-2 border-[var(--gold)] rounded-xl shadow-2xl p-1.5 z-[120] ${
                      lang === 'en' ? 'right-0' : 'left-0'
                    }`}
                  >
                    <div className="px-2.5 py-1.5 text-[11px] font-black text-[var(--gold)] border-b border-[var(--border-strong)] mb-1 flex items-center justify-between">
                      <span>{lang === 'en' ? 'Open Floating Popup Window' : 'فتح نافذة منبثقة جديدة'}</span>
                      <button
                        type="button"
                        onClick={() => setIsWinLauncherOpen(false)}
                        className="text-slate-400 hover:text-white cursor-pointer"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="space-y-0.5 max-h-80 overflow-y-auto">
                      {launcherItems.map((item, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() =>
                            spawnFloatingWindow({
                              tabId: item.tabId,
                              title: lang === 'en' ? item.labelEn : item.labelAr,
                              reportsSubTab: item.reportsSubTab,
                              unifiedSubTab: item.unifiedSubTab,
                            })
                          }
                          className="w-full text-start px-2.5 py-1.5 rounded-lg text-xs font-bold text-slate-200 hover:bg-[var(--gold)] hover:text-[#03060A] flex items-center justify-between gap-2 cursor-pointer transition"
                        >
                          <span className="truncate">{lang === 'en' ? item.labelEn : item.labelAr}</span>
                          <ExternalLink className="w-3 h-3 shrink-0 opacity-70" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Quick Smart AI Advisor Shortcut */}
              <button
                type="button"
                onClick={() => {
                  setReportsSubTab('smart_ai');
                  setActiveTab('tab-reports');
                }}
                className="px-2.5 py-1.5 rounded-md bg-[#0D1E32] border border-[var(--gold)] text-[var(--gold)] hover:bg-[var(--gold)] hover:text-[#03060A] font-black flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer transition"
                title={t('repTabSmartAi', lang)}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{t('smartAiBtn', lang)}</span>
              </button>

              {/* Quick Bilingual Toggle (AR / EN) */}
              <button
                type="button"
                onClick={() => handleChangeLanguage(lang === 'ar' ? 'en' : 'ar')}
                className="px-2.5 py-1.5 rounded-md bg-[#08121E] border border-[var(--border-strong)] hover:border-[var(--gold)] text-white font-black flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                title={t('langSwitchTooltip', lang)}
              >
                <Globe className="w-3.5 h-3.5 text-[var(--gold)]" />
                <span>{t('langBadge', lang)}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setReportsSubTab('tasks_dispatch');
                  setActiveTab('tab-reports');
                }}
                className="relative px-2.5 py-1.5 rounded-md bg-[#08121E] border border-[var(--border-strong)] text-white hover:border-[var(--gold)] flex items-center gap-1 cursor-pointer"
                title={t('alertsAndDispatch', lang)}
              >
                <Bell className="w-3.5 h-3.5 text-[var(--gold)]" />
                {unreadAlertsCount > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full bg-[var(--danger)] text-white text-[10px] font-black tabular-nums">
                    {unreadAlertsCount}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setIsHelpOpen(true)}
                className="px-2.5 py-1.5 rounded-md bg-[#08121E] border border-[var(--border-strong)] text-sky-300 hover:border-[var(--gold)] flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <HelpCircle className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{t('help', lang)}</span>
              </button>

              <button
                type="button"
                onClick={() => setIsResetConfirmOpen(true)}
                className="px-2.5 py-1.5 rounded-md bg-[#2B0B0E] border border-[var(--danger)] text-[var(--danger)] hover:bg-[var(--danger)] hover:text-white flex items-center gap-1 cursor-pointer"
                title={t('resetDemo', lang)}
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Live Top Treasuries Liquidity Bar */}
          <div className="flex items-center gap-2 overflow-x-auto pb-0.5 text-[11px]">
            <div className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#050B12] border border-[var(--gold)] font-black text-[var(--gold)] tabular-nums">
              <Landmark className="w-3.5 h-3.5" />
              <span>
                {t('totalLiquidity', lang)}: {totalLiquidityBase.toLocaleString()} {scopedDb.company.baseCurrency || 'YER'}
              </span>
            </div>
            {scopedDb.treasuryAccounts
              .filter((tAcc) => tAcc.status === 'active')
              .map((tr) => (
                <div
                  key={tr.id}
                  className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#08121E] border border-[var(--border-strong)] text-slate-200 tabular-nums"
                >
                  <Wallet className="w-3 h-3 text-emerald-400" />
                  <span className="font-bold">{tr.nameAr}:</span>
                  <span className="font-black text-emerald-300">
                    {tr.balance.toLocaleString()} {tr.currency}
                  </span>
                </div>
              ))}
          </div>

          {/* V20 Dynamic Horizontal 8-Tab Navigation Bar + Instant Floating Popup Button */}
          <nav className="flex items-center gap-1.5 overflow-x-auto pt-1 border-t border-[var(--border-strong)]">
            {visibleTabs.map((tab) => {
              const isActive = activeTab === tab.id;
              const label = getTabLabel(tab.id, tab.label, lang);
              return (
                <div
                  key={tab.id}
                  className={`shrink-0 flex items-center rounded-t-md border transition ${
                    isActive
                      ? 'bg-[var(--gold)] text-[#03060A] border-[var(--gold)] shadow'
                      : 'bg-[#08121E] text-slate-200 border-[var(--border-strong)] hover:border-[var(--gold)]'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setFocusedRecordId(undefined);
                      setActiveTab(tab.id as V20TabId);
                    }}
                    className="px-3 py-1.5 text-xs font-black cursor-pointer"
                  >
                    {label}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      spawnFloatingWindow({
                        tabId: tab.id as V20TabId,
                        title: label,
                        reportsSubTab: tab.id === 'tab-reports' ? reportsSubTab : undefined,
                        unifiedSubTab: tab.id === 'tab-unified-coa' ? unifiedSubTab : undefined,
                      })
                    }
                    title={lang === 'en' ? `Open ${label} in floating MDI window` : `فتح "${label}" في نافذة منبثقة مستقلة`}
                    className={`px-1.5 py-1.5 text-[11px] cursor-pointer border-s ${
                      isActive
                        ? 'border-[#03060A]/25 text-[#03060A] hover:bg-black/10'
                        : 'border-[var(--border-strong)] text-[var(--gold)] hover:bg-[var(--gold)]/20'
                    }`}
                  >
                    <ExternalLink className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </nav>
        </div>
      </header>

      {/* Main Workspace Content (Locked until authenticated; preserves visited tabs while signed in) */}
      <main className="flex-1 max-w-[1700px] w-full mx-auto p-3 md:p-4">
        {isAuthenticated ? (
          visitedTabs.map((tabId) => (
            <HiddenAwareTabPanel key={tabId} isActive={activeTab === tabId}>
              <Suspense
                fallback={
                  <div className="v20-card p-8 text-center text-xs font-bold text-slate-300">
                    {lang === 'en' ? 'Loading workbench module...' : 'جاري تحميل وحدة العمل...'}
                  </div>
                }
              >
                {renderWorkbenchView({
                  tabId,
                  isActive: tabId === activeTab,
                  focusedId: tabId === activeTab ? focusedRecordId : undefined,
                  rSubTab: tabId === 'tab-reports' ? reportsSubTab : undefined,
                  uSubTab: tabId === 'tab-unified-coa' ? unifiedSubTab : undefined,
                  stmtTarget: tabId === 'tab-reports' ? statementTarget : undefined,
                })}
              </Suspense>
            </HiddenAwareTabPanel>
          ))
        ) : (
          <div className="v20-card p-10 text-center space-y-3 my-8">
            <Shield className="w-10 h-10 text-[var(--gold)] mx-auto" />
            <h2 className="text-base font-black text-[var(--gold)]">
              {lang === 'en' ? 'Workspace Locked — Authentication Required' : 'مساحة العمل مقفلة — يرجى تسجيل الدخول'}
            </h2>
            <p className="text-xs text-slate-400">
              {lang === 'en'
                ? 'Sign in with an active user account and password to access financial and accounting modules.'
                : 'سجل الدخول بحساب مفعل وكلمة مرور صحيحة للوصول إلى الدفاتر والعمليات المالية.'}
            </p>
            <button
              type="button"
              onClick={() => setAuthModalMode('login')}
              className="px-4 py-2 rounded v20-btn-gold text-xs font-black cursor-pointer"
            >
              {lang === 'en' ? 'Open Sign In' : 'فتح نافذة تسجيل الدخول'}
            </button>
          </div>
        )}
      </main>

      {/* Simultaneous Floating MDI Workspace Popup Windows */}
      {floatingWindows.map((win) => (
        <MdiFloatingFrame
          key={win.id}
          windowId={win.id}
          title={win.title}
          kind="workspace"
          defaultWidth={1080}
          defaultHeight={680}
          dir={lang === 'en' ? 'ltr' : 'rtl'}
          onClose={() => closeFloatingWindow(win.id)}
        >
          <div className="p-3">
            <Suspense
              fallback={
                <div className="v20-card p-8 text-center text-xs font-bold text-slate-300">
                  {lang === 'en' ? 'Loading window module...' : 'جاري تحميل محتوى النافذة...'}
                </div>
              }
            >
              {renderWorkbenchView({
                tabId: win.tabId,
                isActive: true,
                focusedId: win.focusedRecordId,
                rSubTab: win.reportsSubTab,
                uSubTab: win.unifiedSubTab,
                stmtTarget: win.statementTarget,
              })}
            </Suspense>
          </div>
        </MdiFloatingFrame>
      ))}

      <GlobalSearchModal
        isOpen={isGlobalSearchOpen}
        onClose={() => setIsGlobalSearchOpen(false)}
        db={scopedDb}
        lang={lang}
        onNavigate={navigateToRecord}
      />

      <CustomerItemPriceModal
        isOpen={priceLookupModal.open}
        onClose={() => setPriceLookupModal({ open: false })}
        invoices={scopedDb.invoices}
        customers={scopedDb.customers}
        inventoryItems={scopedDb.inventoryItems}
        currencies={db.currencies}
        initialCustomerId={priceLookupModal.customerId}
        initialItemId={priceLookupModal.itemId}
        lang={lang}
        onOpenInvoice={(invId) => navigateToRecord('sales', invId)}
      />

      <HelpModal isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} topic={helpTopic} lang={lang} />

      {printableDocs.map((p) => {
        const inferredDocType = p.doc.items?.length
          ? 'invoice'
          : /كشف حساب/i.test(p.doc.title || '')
          ? 'statement'
          : /سند/i.test(p.doc.title || '')
          ? 'voucher'
          : 'report';
        return (
          <PrintModal
            key={p.id}
            isOpen
            onClose={() => closePrintDocWindow(p.id)}
            document={p.doc}
            company={scopedDb.company}
            branch={currentBranch}
            lang={lang}
            docType={inferredDocType}
            printTemplates={resolvedCompanyPrintTemplates}
          />
        );
      })}

      <ConfirmModal
        isOpen={isResetConfirmOpen}
        title={t('resetConfirmTitle', lang)}
        variant="danger"
        message={t('resetConfirmMsg', lang)}
        confirmLabel={t('resetConfirmBtn', lang)}
        onConfirm={executeResetDatabase}
        onCancel={() => setIsResetConfirmOpen(false)}
      />

      <SetupWizardModal
        isOpen={isSetupWizardOpen && isPlatformSuperAdmin(currentUser)}
        db={db}
        currentUser={currentUser}
        cloudSessionActive={cloudSessionActive}
        onClose={() => setIsSetupWizardOpen(false)}
        onCreateCompany={(nextDb: ERPDatabase, newCompany: Company) => {
          const scopedNew = scopeDatabaseToCompany(
            {
              ...nextDb,
              activeCompanyId: newCompany.id,
              company: newCompany,
            },
            newCompany.id
          );
          cloudRevisionRef.current = nextDb.revision ?? 1;
          skipNextCloudSaveRef.current = true;
          setDb(scopedNew);
          setCurrentUser((prev) => ({
            ...prev,
            allowedCompanyIds: Array.from(new Set([...(prev.allowedCompanyIds || []), newCompany.id])),
          }));
          const nextBranch =
            scopedNew.branches.find((b) => b.companyId === newCompany.id) || scopedNew.branches[0];
          if (nextBranch) setCurrentBranch(nextBranch);
          const baseCurr =
            scopedNew.currencies.find((c) => c.code === newCompany.baseCurrency) ||
            scopedNew.currencies.find((c) => c.isBase) ||
            scopedNew.currencies[0];
          if (baseCurr) setCurrentCurrency(baseCurr);
        }}
        onNotify={notify}
      />

      <LoginModal
        isOpen={authModalMode !== null}
        mode={authModalMode || 'login'}
        users={db.users}
        activeCompanyId={db.activeCompanyId || db.company.id}
        allCompanyIds={(db.companies && db.companies.length > 0 ? db.companies : [db.company]).map((c) => c.id)}
        pendingUserForPasswordChange={pendingPasswordChangeUser}
        isCloudSession={cloudSessionActive}
        canCancel={authCanCancel}
        lang={lang}
        onBootstrapComplete={async (updatedOwner) => {
          const hasOwner = db.users.some((u) => u.id === updatedOwner.id);
          const seedDb: ERPDatabase = {
            ...db,
            users: hasOwner
              ? db.users.map((u) => (u.id === updatedOwner.id ? updatedOwner : u))
              : [updatedOwner, ...db.users],
          };
          setDb(seedDb);
          try {
            await hydrateWorkspaceFromCloud(seedDb);
            setCloudSessionActive(true);
          } catch {
            // Keep local seed if offline
          }
          setCurrentUser(updatedOwner);
          setIsAuthenticated(true);
          setAuthModalMode(null);
          setAuthCanCancel(false);
          notify('success', 'تم تفعيل حساب المالك وتأمين النظام بكلمة مرور مشفرة.');
        }}
        onLoginSuccess={async (loggedInUser, migrated, meta) => {
          let resolvedUser = loggedInUser;
          if (migrated) {
            resolvedUser = {
              ...loggedInUser,
              passwordHash: migrated.passwordHash,
              passwordSalt: migrated.passwordSalt,
            };
          }

          if (meta?.cloudAuthenticated) {
            try {
              const { hydratedDb } = await hydrateWorkspaceFromCloud();
              const matched =
                hydratedDb.users.find((u) => u.id === resolvedUser.id && u.active) || resolvedUser;
              setCloudSessionActive(true);
              if (matched.mustChangePassword || resolvedUser.mustChangePassword) {
                setPendingPasswordChangeUser({ ...matched, mustChangePassword: true });
                setIsAuthenticated(false);
                setAuthModalMode('force_change_password');
                return;
              }
              setCurrentUser(matched);
              setIsAuthenticated(true);
              setAuthModalMode(null);
              setAuthCanCancel(false);
              notify('success', `مرحباً ${matched.fullName}`);
              return;
            } catch (err: unknown) {
              setIsAuthenticated(false);
              notify('error', err instanceof Error ? err.message : 'تعذر تحميل بيانات المنشأة من الخادم.');
              return;
            }
          }

          const activeCid = db.activeCompanyId || db.company.id;
          const allCompanies = db.companies && db.companies.length > 0 ? db.companies : [db.company];
          const canAccessActive = assertTenantAccess(resolvedUser, activeCid).ok;
          const allowedCompany = canAccessActive
            ? allCompanies.find((c) => c.id === activeCid) || db.company
            : allCompanies.find((c) => assertTenantAccess(resolvedUser, c.id).ok);

          if (!allowedCompany) {
            setIsAuthenticated(false);
            notify('error', 'عذراً، هذا الحساب غير مخول للوصول إلى أي منشأة مفعلة.');
            return;
          }

          setDb((prev) => {
            const baseUpdated = migrated
              ? {
                  ...prev,
                  users: prev.users.map((u) => (u.id === resolvedUser.id ? resolvedUser : u)),
                }
              : prev;
            if (allowedCompany.id !== (baseUpdated.activeCompanyId || baseUpdated.company.id)) {
              return switchActiveCompanyInDb(baseUpdated, allowedCompany.id);
            }
            return baseUpdated;
          });

          if (resolvedUser.mustChangePassword) {
            setPendingPasswordChangeUser(resolvedUser);
            setIsAuthenticated(false);
            setAuthModalMode('force_change_password');
            return;
          }
          setCurrentUser(resolvedUser);
          setIsAuthenticated(true);
          setAuthModalMode(null);
          setAuthCanCancel(false);
          notify('success', `مرحباً ${resolvedUser.fullName}`);
        }}
        onPasswordChanged={(updatedUser) => {
          const cleanUser = { ...updatedUser, mustChangePassword: false };
          setDb((prev) => ({
            ...prev,
            users: prev.users.some((u) => u.id === cleanUser.id)
              ? prev.users.map((u) => (u.id === cleanUser.id ? cleanUser : u))
              : [...prev.users, cleanUser],
          }));
          setCurrentUser(cleanUser);
          setPendingPasswordChangeUser(null);
          setIsAuthenticated(true);
          setAuthModalMode(null);
          setAuthCanCancel(false);
          notify('success', 'تم تحديث كلمة المرور وتأمين الجلسة بنجاح.');
        }}
        onCancel={() => {
          setAuthModalMode(null);
          setAuthCanCancel(false);
        }}
      />

      <ToastBanner
        toasts={toasts}
        onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))}
      />
    </div>
    </MdiWindowProvider>
  );
}

interface HiddenAwareTabPanelProps {
  isActive: boolean;
  children: React.ReactNode;
}

const HiddenAwareTabPanel = React.memo<HiddenAwareTabPanelProps>(
  ({ isActive, children }) => <div className={isActive ? '' : 'hidden'}>{children}</div>,
  (prev, next) => !prev.isActive && !next.isActive
);

