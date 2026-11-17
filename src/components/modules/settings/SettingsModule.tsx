/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Settings & Institutional Customization Module
 */

import React, { useDeferredValue, useMemo, useState } from 'react';
import {
  Settings,
  Download,
  Upload,
  History,
  CheckCircle,
  Save,
  AlertTriangle,
  Plus,
  Building2,
  Palette,
  MessageCircle,
  ShieldAlert,
  Info,
  Trash2,
} from 'lucide-react';
import {
  Company,
  Branch,
  Warehouse,
  Currency,
  UnitOfMeasure,
  SystemSettings,
  WhatsAppTemplates,
  UIPreferences,
  User,
} from '../../../types/erp';
import {
  ERPDatabase,
  validateBackupPayload,
  generateNextDocNumber,
  encryptBackupPayload,
  decryptBackupPayload,
  filterDatabaseForUserTenants,
  scopeDatabaseToCompany,
} from '../../../services/storageService';
import {
  getRoleDisplayLabel,
  isTenantAdminUser,
  validateUploadFile,
} from '../../../services/securityService';
import {
  BackupExportResult,
  BackupProgress,
  exportDatabaseBackupAsync,
} from '../../../services/backupService';
import { DataMigrationPanel } from './DataMigrationPanel';
import { ConfirmModal } from '../../common/ConfirmModal';
import { ERPModuleId } from '../../layout/Sidebar';

interface SettingsModuleProps {
  db: ERPDatabase;
  currentUser: User;
  onUpdateCompany: (company: Company) => void;
  onUpdateSettings: (settings: SystemSettings) => void;
  onSaveBranch: (branch: Branch) => void;
  onSaveWarehouse: (wh: Warehouse) => void;
  onSaveUnitOfMeasure: (uom: UnitOfMeasure) => void;
  onUpdateCurrencies: (currencies: Currency[]) => void;
  onUpdateUserPermissions?: (user: User) => void;
  onResetDatabase: () => void;
  onRestoreDatabase: (db: ERPDatabase) => void;
  onUpdateDatabase?: (db: ERPDatabase) => void;
  onNotify?: (type: 'success' | 'error' | 'info', msg: string) => void;
}

const SIDEBAR_MODULES: { id: ERPModuleId; label: string }[] = [
  { id: 'dashboard', label: 'لوحة القيادة والمؤشرات' },
  { id: 'daily_report', label: 'التقرير الإداري اليومي (22 مؤشر)' },
  { id: 'unified_docs', label: 'مركز المستندات الموحد' },
  { id: 'customers', label: 'العملاء والمناطق' },
  { id: 'sales', label: 'المبيعات وعروض الأسعار' },
  { id: 'vendors', label: 'إدارة الموردين' },
  { id: 'purchases', label: 'المشتريات وأوامر الشراء' },
  { id: 'inventory', label: 'المخزون والمستودعات' },
  { id: 'accounting', label: 'المحاسبة المزدوجة والقيود' },
  { id: 'treasury', label: 'الصناديق والبنوك والسندات' },
  { id: 'expenses', label: 'المصروفات ومراكز التكلفة' },
  { id: 'scheduled_dispatch', label: 'مركز الإرسال والمجدول' },
  { id: 'hr', label: 'الموارد البشرية والرواتب' },
  { id: 'assets', label: 'الأصول الثابتة والإهلاك' },
  { id: 'reports', label: 'مركز التقارير والتحليلات' },
  { id: 'tasks', label: 'المهام والتنبيهات والواتساب' },
];

export const SettingsModule: React.FC<SettingsModuleProps> = ({
  db,
  currentUser,
  onUpdateCompany,
  onUpdateSettings,
  onSaveBranch,
  onSaveWarehouse,
  onSaveUnitOfMeasure,
  onUpdateCurrencies,
  onUpdateUserPermissions,
  onResetDatabase,
  onRestoreDatabase,
  onUpdateDatabase,
  onNotify,
}) => {
  const canManage = isTenantAdminUser(currentUser);
  const tenantScopedDb = useMemo(() => filterDatabaseForUserTenants(db, currentUser), [db, currentUser]);
  const activeCompanyScopedDb = useMemo(() => scopeDatabaseToCompany(tenantScopedDb), [tenantScopedDb]);

  const [activeTab, setActiveTab] = useState<
    | 'company'
    | 'system'
    | 'branches_units'
    | 'currencies'
    | 'whatsapp_ui'
    | 'roles'
    | 'audit'
    | 'backup'
    | 'migration'
  >('company');

  // Company Form
  const [nameAr, setNameAr] = useState(db.company.nameAr);
  const [nameEn, setNameEn] = useState(db.company.nameEn);
  const [commercialRecord, setCommercialRecord] = useState(db.company.commercialRecord);
  const [taxNumber, setTaxNumber] = useState(db.company.taxNumber);
  const [phone, setPhone] = useState(db.company.phone);
  const [email, setEmail] = useState(db.company.email);
  const [address, setAddress] = useState(db.company.address);
  const [logoUrl, setLogoUrl] = useState(db.company.logoUrl || '');
  const [companySavedMsg, setCompanySavedMsg] = useState('');

  // System Settings Form
  const [allowNegativeStock, setAllowNegativeStock] = useState(db.settings.allowNegativeStock);
  const [enforceBalancedEntries, setEnforceBalancedEntries] = useState(db.settings.enforceBalancedJournalEntries);
  const [defaultTaxRate, setDefaultTaxRate] = useState(db.settings.defaultTaxRate);
  const [enableTax, setEnableTax] = useState(db.settings.enableTax);
  const [autoDownloadInvoices, setAutoDownloadInvoices] = useState(db.settings.autoDownloadInvoices);
  const [fiscalYear, setFiscalYear] = useState(db.settings.fiscalYear);
  const [invoicePrefix, setInvoicePrefix] = useState(db.settings.invoicePrefix);
  const [surplusCode, setSurplusCode] = useState(db.settings.stocktakeSurplusAccountCode || '4190');
  const [shortageCode, setShortageCode] = useState(db.settings.stocktakeShortageAccountCode || '5390');
  const [paymentMethods, setPaymentMethods] = useState<string[]>(
    db.settings.paymentMethods || ['نقداً', 'تحويل_بنكي', 'شيك', 'محفظة_إلكترونية']
  );
  const [newPaymentMethod, setNewPaymentMethod] = useState('');

  // Branches, Warehouses, Units forms
  const [newBranchName, setNewBranchName] = useState('');
  const [newBranchManager, setNewBranchManager] = useState('');
  const [newBranchPhone, setNewBranchPhone] = useState('');
  const [newWhName, setNewWhName] = useState('');
  const [newWhBranchId, setNewWhBranchId] = useState(db.branches[0]?.id || '');
  const [newWhKeeper, setNewWhKeeper] = useState('');
  const [newUomName, setNewUomName] = useState('');
  const [newUomSymbol, setNewUomSymbol] = useState('');
  const [newUomFactor, setNewUomFactor] = useState(1);

  // Currencies draft
  const [editableCurrencies, setEditableCurrencies] = useState<Currency[]>(db.currencies);

  // WhatsApp & UI preferences
  const [templates, setTemplates] = useState<WhatsAppTemplates>(
    db.settings.whatsappTemplates || {
      invoice: 'مرحباً {name}، فاتورة رقم {number} بمبلغ {amount} {currency}.',
      voucher: 'مرحباً {name}، سند {type} رقم {number} بمبلغ {amount} {currency}.',
      statement: 'مرحباً {name}، خلاصة كشف الحساب: {balance} {currency}.',
      overdueReminder: 'مرحباً {name}، يرجى التكرم بسداد المستحق {balance} {currency}.',
      paymentConfirmation: 'شكراً {name}، تم استلام مبلغ {amount} {currency}.',
      dailySummary: 'ملخص الإدارة ليوم {date}: مبيعات {sales} {currency}.',
    }
  );
  const [enableWhatsAppAPI, setEnableWhatsAppAPI] = useState(db.settings.enableWhatsAppAPI);
  const [whatsappApiEndpoint, setWhatsappApiEndpoint] = useState(db.settings.whatsappApiEndpoint || '');
  const [whatsappPhoneNumberId, setWhatsappPhoneNumberId] = useState(db.settings.whatsappPhoneNumberId || '');
  const [whatsappApiToken, setWhatsappApiToken] = useState(db.settings.whatsappApiToken || '');
  const [uiPrefs, setUiPrefs] = useState<UIPreferences>(
    db.settings.uiPreferences || {
      fontSize: 14,
      accentPreset: 'amber',
      hiddenModules: [],
      tableColumnPrefs: {},
    }
  );

  // Audit filter & pagination
  const [auditSearch, setAuditSearch] = useState('');
  const deferredAuditSearch = useDeferredValue(auditSearch);
  const [auditVisibleCount, setAuditVisibleCount] = useState(50);

  // Async non-blocking backup export/restore state
  const [isExportingBackup, setIsExportingBackup] = useState(false);
  const [backupProgress, setBackupProgress] = useState<BackupProgress | null>(null);
  const [lastBackupResult, setLastBackupResult] = useState<BackupExportResult | null>(null);
  const [isParsingRestore, setIsParsingRestore] = useState(false);

  // Backup confirmation & AES-GCM encryption state
  const [backupPassphrase, setBackupPassphrase] = useState('');
  const [pendingEncryptedRaw, setPendingEncryptedRaw] = useState<{ rawText: string; fileName: string } | null>(null);
  const [decryptPassphrase, setDecryptPassphrase] = useState('');
  const [pendingRestore, setPendingRestore] = useState<{
    db: ERPDatabase;
    fileName: string;
    stats: NonNullable<ReturnType<typeof validateBackupPayload>['stats']>;
  } | null>(null);
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);

  const requireAdmin = () => {
    if (!canManage) {
      onNotify?.('error', 'عذراً، صلاحيات حسابك الحالي لا تسمح بتعديل إعدادات النظام.');
      return false;
    }
    return true;
  };

  const handleBannerUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setLogoUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSaveCompany = (e: React.FormEvent) => {
    e.preventDefault();
    if (!requireAdmin()) return;
    onUpdateCompany({
      ...db.company,
      nameAr,
      nameEn,
      commercialRecord,
      taxNumber,
      phone,
      email,
      address,
      logoUrl: logoUrl || undefined,
    });
    setCompanySavedMsg('تم حفظ وتحديث بيانات المؤسسة وصورة الترويسة بنجاح.');
    onNotify?.('success', 'تم حفظ بيانات المؤسسة بنجاح.');
    setTimeout(() => setCompanySavedMsg(''), 4000);
  };

  const handleSaveSystemSettings = (e: React.FormEvent) => {
    e.preventDefault();
    if (!requireAdmin()) return;
    onUpdateSettings({
      ...db.settings,
      allowNegativeStock,
      enforceBalancedJournalEntries: enforceBalancedEntries,
      defaultTaxRate: Number(defaultTaxRate),
      enableTax,
      autoDownloadInvoices,
      fiscalYear,
      invoicePrefix,
      stocktakeSurplusAccountCode: surplusCode,
      stocktakeShortageAccountCode: shortageCode,
      paymentMethods,
    });
    onNotify?.('success', 'تم حفظ سياسات النظام وحسابات الجرد وطرق الدفع بنجاح.');
  };

  const handleSaveWhatsAppAndUI = (e: React.FormEvent) => {
    e.preventDefault();
    if (!requireAdmin()) return;
    onUpdateSettings({
      ...db.settings,
      enableWhatsAppAPI,
      whatsappApiEndpoint,
      whatsappPhoneNumberId,
      whatsappApiToken,
      whatsappTemplates: templates,
      uiPreferences: {
        ...(db.settings.uiPreferences || { tableColumnPrefs: {} }),
        ...uiPrefs,
        hiddenModules: uiPrefs.hiddenModules.filter((m) => m !== 'settings'),
      },
    });
    onNotify?.('success', 'تم حفظ قوالب واتساب وتخصيص الواجهة والقوائم بنجاح.');
  };

  const handleAsyncBackupExport = async () => {
    if (isExportingBackup) return;
    setIsExportingBackup(true);
    setLastBackupResult(null);
    setBackupProgress({ percent: 2, stageAr: 'بدء تجهيز النسخة الاحتياطية...', processedBytes: 0 });
    try {
      const result = await exportDatabaseBackupAsync(tenantScopedDb, {
        onProgress: (p) => setBackupProgress(p),
      });
      setLastBackupResult(result);
      if (result.ok) {
        onNotify?.(
          'success',
          `تم تصدير النسخة الاحتياطية كاملة (${(result.sizeBytes / 1024).toFixed(1)} KB) خلال ${result.durationMs} مللي ثانية.`
        );
      } else {
        onNotify?.('error', result.error || 'تعذر تصدير النسخة الاحتياطية.');
      }
    } finally {
      setIsExportingBackup(false);
    }
  };

  const handleEncryptedBackupExport = async () => {
    if (!requireAdmin()) return;
    if (backupPassphrase.trim().length < 4) {
      onNotify?.('error', 'أدخل كلمة مرور للتشفير (4 أحرف على الأقل) قبل تصدير النسخة المشفرة.');
      return;
    }
    try {
      const cipherJson = await encryptBackupPayload(tenantScopedDb, backupPassphrase.trim());
      const blob = new Blob([cipherJson], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `almansoor-erp-encrypted-${new Date().toISOString().split('T')[0]}.json.enc`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      const recCount =
        tenantScopedDb.invoices.length +
        tenantScopedDb.journalEntries.length +
        tenantScopedDb.paymentVouchers.length +
        tenantScopedDb.customers.length;
      const meta = {
        id: `bkp-${Date.now()}`,
        createdAt: new Date().toISOString(),
        type: 'encrypted' as const,
        schemaVersion: tenantScopedDb.schemaVersion || '2.0',
        recordCount: recCount,
        sizeBytes: blob.size,
        verifiedRestoreOk: true,
        notes: 'نسخة مشفرة AES-256-GCM',
      };
      const updateFn = onUpdateDatabase || onRestoreDatabase;
      updateFn({
        ...db,
        backupHistory: [meta, ...(db.backupHistory || []).slice(0, 19)],
      });
      onNotify?.('success', `تم تصدير النسخة الاحتياطية المشفرة AES-256-GCM (${(blob.size / 1024).toFixed(1)} KB).`);
    } catch (err) {
      onNotify?.('error', err instanceof Error ? err.message : 'تعذر تشفير النسخة الاحتياطية.');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    if (!requireAdmin()) {
      input.value = '';
      return;
    }
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    const validFile = validateUploadFile(file, 'backup');
    if (!validFile.ok) {
      onNotify?.('error', validFile.error || 'ملف غير مدعوم.');
      return;
    }

    setIsParsingRestore(true);
    try {
      const rawText = await file.text();
      if (file.name.toLowerCase().endsWith('.enc') || rawText.includes('ALMANSOOR_ERP_AES256_GCM_V1')) {
        setPendingEncryptedRaw({ rawText, fileName: file.name });
        setDecryptPassphrase('');
        return;
      }
      const check = validateBackupPayload(rawText);
      if (!check.valid || !check.db || !check.stats) {
        onNotify?.('error', check.error || 'ملف النسخة الاحتياطية غير صالح.');
        return;
      }
      setPendingRestore({ db: check.db, fileName: file.name, stats: check.stats });
    } finally {
      setIsParsingRestore(false);
    }
  };

  const handleDecryptAndVerifyBackup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingEncryptedRaw) return;
    try {
      const plainJson = await decryptBackupPayload(pendingEncryptedRaw.rawText, decryptPassphrase);
      const check = validateBackupPayload(plainJson);
      if (!check.valid || !check.db || !check.stats) {
        onNotify?.('error', check.error || 'تم فك التشفير لكن بنية النسخة غير صالحة.');
        return;
      }
      const fileName = pendingEncryptedRaw.fileName;
      setPendingEncryptedRaw(null);
      setDecryptPassphrase('');
      setPendingRestore({ db: check.db, fileName, stats: check.stats });
    } catch {
      onNotify?.('error', 'كلمة مرور فك التشفير غير صحيحة أو الملف تالف.');
    }
  };

  const handleAddBranchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!requireAdmin() || !newBranchName.trim()) return;
    const code = generateNextDocNumber('BR-', db.branches.map((b) => b.code), 2);
    onSaveBranch({
      id: `br-${Date.now()}`,
      companyId: db.company.id,
      code,
      nameAr: newBranchName.trim(),
      phone: newBranchPhone.trim() || db.company.phone,
      address: db.company.address,
      managerName: newBranchManager.trim() || 'مدير الفرع',
      isMain: false,
      status: 'active',
    });
    setNewBranchName('');
    setNewBranchManager('');
    setNewBranchPhone('');
    onNotify?.('success', `تم إضافة الفرع (${newBranchName.trim()}) بنجاح.`);
  };

  const handleAddWarehouseSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!requireAdmin() || !newWhName.trim()) return;
    const code = generateNextDocNumber('WH-', db.warehouses.map((w) => w.code), 2);
    onSaveWarehouse({
      id: `wh-${Date.now()}`,
      branchId: newWhBranchId || db.branches[0]?.id || 'br-01',
      code,
      nameAr: newWhName.trim(),
      location: 'الموقع المسجل',
      keeperName: newWhKeeper.trim() || 'أمين المستودع',
      status: 'active',
    });
    setNewWhName('');
    setNewWhKeeper('');
    onNotify?.('success', `تم إضافة المستودع (${newWhName.trim()}) بنجاح.`);
  };

  const handleAddUomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!requireAdmin() || !newUomName.trim()) return;
    onSaveUnitOfMeasure({
      id: `uom-${Date.now()}`,
      nameAr: newUomName.trim(),
      symbolAr: newUomSymbol.trim() || newUomName.trim(),
      isBase: Number(newUomFactor) === 1,
      factorToBase: Math.max(1, Number(newUomFactor) || 1),
    });
    setNewUomName('');
    setNewUomSymbol('');
    setNewUomFactor(1);
    onNotify?.('success', 'تم إضافة وحدة القياس بنجاح.');
  };

  const toggleModuleVisibility = (modId: string) => {
    if (modId === 'settings') return;
    setUiPrefs((prev) => {
      const exists = prev.hiddenModules.includes(modId);
      return {
        ...prev,
        hiddenModules: exists
          ? prev.hiddenModules.filter((x) => x !== modId)
          : [...prev.hiddenModules, modId],
      };
    });
  };

  const filteredLogs = useMemo(() => {
    if (!deferredAuditSearch.trim()) return tenantScopedDb.auditLogs;
    const q = deferredAuditSearch.trim().toLowerCase();
    return tenantScopedDb.auditLogs.filter(
      (l) =>
        l.userName.toLowerCase().includes(q) ||
        l.module.toLowerCase().includes(q) ||
        l.details.toLowerCase().includes(q)
    );
  }, [tenantScopedDb.auditLogs, deferredAuditSearch]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 bg-slate-900 border border-slate-800 rounded-2xl p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Settings className="w-5 h-5 text-amber-400" />
              <h2 className="text-lg font-bold text-white">مركز الإعدادات والتخصيص والتحكم المؤسسي</h2>
            </div>
            <p className="text-xs text-slate-400">
              المؤسسة، السياسات المحاسبية، الفروع والمستودعات والوحدات، العملات، قوالب واتساب وتخصيص الواجهة، والصلاحيات
            </p>
          </div>
          {!canManage && (
            <span className="px-3 py-1.5 rounded-lg bg-rose-950/70 border border-rose-700/50 text-rose-300 text-xs font-bold flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4" />
              <span>وضع القراءة فقط — يتطلب صلاحية إدارة الإعدادات</span>
            </span>
          )}
        </div>

        {/* Tab buttons */}
        <div className="bg-slate-950 p-1 rounded-xl border border-slate-800 flex items-center gap-1 text-xs overflow-x-auto">
          {[
            { id: 'company', label: 'بيانات المؤسسة' },
            { id: 'system', label: 'سياسات النظام وحسابات الجرد' },
            { id: 'branches_units', label: 'الفروع والمستودعات والوحدات' },
            { id: 'currencies', label: 'العملات وأسعار الصرف' },
            { id: 'whatsapp_ui', label: 'واتساب وتخصيص الواجهة' },
            { id: 'roles', label: 'الأدوار والصلاحيات' },
            { id: 'audit', label: 'سجل التدقيق' },
            { id: 'backup', label: 'النسخ الاحتياطي' },
            { id: 'migration', label: 'استيراد وترحيل البيانات' },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id as typeof activeTab)}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer whitespace-nowrap ${
                activeTab === t.id ? 'bg-amber-500 text-slate-950 shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* TAB 1: COMPANY DATA */}
      {activeTab === 'company' && (
        <form onSubmit={handleSaveCompany} className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 text-xs max-w-2xl">
          <h3 className="font-bold text-sm text-white mb-2">بيانات المؤسسة والشعار والعناوين الرسمية</h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-slate-300 font-semibold mb-1">اسم المؤسسة (بالعربية) *</label>
              <input
                type="text"
                required
                disabled={!canManage}
                value={nameAr}
                onChange={(e) => setNameAr(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-amber-500 disabled:opacity-60"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-slate-300 font-semibold mb-1">اسم المؤسسة (بالإنجليزية)</label>
              <input
                type="text"
                disabled={!canManage}
                value={nameEn}
                onChange={(e) => setNameEn(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-amber-500 disabled:opacity-60"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">رقم السجل التجاري</label>
              <input
                type="text"
                disabled={!canManage}
                value={commercialRecord}
                onChange={(e) => setCommercialRecord(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-amber-500"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">الرقم الضريبي المعتمد</label>
              <input
                type="text"
                disabled={!canManage}
                value={taxNumber}
                onChange={(e) => setTaxNumber(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-amber-500"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">رقم الهاتف المركزي</label>
              <input
                type="text"
                disabled={!canManage}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-amber-500"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">البريد الإلكتروني الرسمي</label>
              <input
                type="email"
                disabled={!canManage}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-amber-500"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-slate-300 font-semibold mb-1">العنوان الرئيسي للمقر</label>
              <input
                type="text"
                disabled={!canManage}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-amber-500"
              />
            </div>

            <div className="sm:col-span-2 bg-slate-950/80 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <strong className="text-slate-200 block">صورة ترويسة الفواتير والكشوفات (Banner / Logo)</strong>
                  <span className="text-slate-400 text-[11px]">
                    تظهر في أعلى الفواتير المطبوعة وسندات القبض والصرف وكشوفات الحساب
                  </span>
                </div>
                {canManage && (
                  <div className="flex items-center gap-2 shrink-0">
                    <label className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-amber-400 font-bold rounded-lg cursor-pointer transition-colors">
                      <Upload className="w-3.5 h-3.5 inline ml-1" />
                      <span>رفع صورة الترويسة</span>
                      <input type="file" accept="image/*" onChange={handleBannerUpload} className="hidden" />
                    </label>
                    {logoUrl && (
                      <button
                        type="button"
                        onClick={() => setLogoUrl('')}
                        className="px-2.5 py-1.5 bg-rose-950/60 hover:bg-rose-900 text-rose-300 font-bold rounded-lg cursor-pointer transition-colors"
                      >
                        حذف
                      </button>
                    )}
                  </div>
                )}
              </div>
              {logoUrl && (
                <div className="bg-white p-2 rounded-lg border border-slate-700">
                  <img src={logoUrl} alt="معاينة الترويسة" className="w-full max-h-28 object-contain mx-auto" />
                </div>
              )}
            </div>
          </div>

          {companySavedMsg && (
            <div className="p-3 bg-emerald-950/60 border border-emerald-700/50 text-emerald-300 rounded-lg flex items-center gap-2 font-semibold">
              <CheckCircle className="w-4 h-4 shrink-0" />
              <span>{companySavedMsg}</span>
            </div>
          )}

          {canManage && (
            <button
              type="submit"
              className="flex items-center gap-1.5 px-6 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-lg transition-colors cursor-pointer"
            >
              <Save className="w-4 h-4" />
              <span>حفظ بيانات المؤسسة</span>
            </button>
          )}
        </form>
      )}

      {/* TAB 2: SYSTEM POLICIES & STOCKTAKE COA & PAYMENT METHODS */}
      {activeTab === 'system' && (
        <form onSubmit={handleSaveSystemSettings} className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-5 text-xs max-w-3xl">
          <h3 className="font-bold text-sm text-white">سياسات الرقابة المحاسبية والمخزنية وحسابات تسوية الجرد</h3>

          <div className="space-y-3 bg-slate-950/70 p-4 rounded-xl border border-slate-800">
            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <strong className="text-slate-100 block">منع البيع بالسالب عند عدم توفر رصيد مخزني</strong>
                <span className="text-slate-400 text-[11px]">
                  رفض ترحيل أي فاتورة مبيعات إذا تجاوزت الكمية المطلوبة الرصيد الفعلي في المستودع
                </span>
              </div>
              <input
                type="checkbox"
                disabled={!canManage}
                checked={!allowNegativeStock}
                onChange={(e) => setAllowNegativeStock(!e.target.checked)}
                className="w-4 h-4 accent-amber-500 cursor-pointer"
              />
            </label>

            <div className="border-t border-slate-800 pt-3">
              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <strong className="text-slate-100 block">إلزامية توازن قيود اليومية (المدين = الدائن)</strong>
                  <span className="text-slate-400 text-[11px]">
                    منع ترحيل أي قيد محاسبي إذا وجد فارق بين طرفي المدين والدائن
                  </span>
                </div>
                <input
                  type="checkbox"
                  disabled={!canManage}
                  checked={enforceBalancedEntries}
                  onChange={(e) => setEnforceBalancedEntries(e.target.checked)}
                  className="w-4 h-4 accent-amber-500 cursor-pointer"
                />
              </label>
            </div>

            <div className="border-t border-slate-800 pt-3">
              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <strong className="text-slate-100 block">تفعيل احتساب ضريبة القيمة المضافة (VAT)</strong>
                  <span className="text-slate-400 text-[11px]">
                    تطبيق الضريبة الافتراضية على فواتير المبيعات وترحيلها لحساب الضريبة المستحقة
                  </span>
                </div>
                <input
                  type="checkbox"
                  disabled={!canManage}
                  checked={enableTax}
                  onChange={(e) => setEnableTax(e.target.checked)}
                  className="w-4 h-4 accent-amber-500 cursor-pointer"
                />
              </label>
            </div>

            <div className="border-t border-slate-800 pt-3">
              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <strong className="text-slate-100 block">التنزيل التلقائي لملف PDF للفواتير فور الاعتماد</strong>
                  <span className="text-slate-400 text-[11px]">
                    تنزيل نسخة PDF ثنائية موثقة تلقائياً بعد كل فاتورة مبيعات أو مشتريات جديدة
                  </span>
                </div>
                <input
                  type="checkbox"
                  disabled={!canManage}
                  checked={autoDownloadInvoices}
                  onChange={(e) => setAutoDownloadInvoices(e.target.checked)}
                  className="w-4 h-4 accent-amber-500 cursor-pointer"
                />
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">السنة المالية</label>
              <input
                type="text"
                disabled={!canManage}
                value={fiscalYear}
                onChange={(e) => setFiscalYear(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">بادئة فواتير المبيعات</label>
              <input
                type="text"
                disabled={!canManage}
                value={invoicePrefix}
                onChange={(e) => setInvoicePrefix(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">نسبة الضريبة الافتراضية</label>
              <input
                type="number"
                step="0.01"
                min={0}
                max={1}
                disabled={!canManage}
                value={defaultTaxRate}
                onChange={(e) => setDefaultTaxRate(Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono"
              />
            </div>
          </div>

          {/* Stocktaking COA Accounts */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-950/70 p-4 rounded-xl border border-slate-800">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">حساب فائض الجرد المخزني (دائن)</label>
              <select
                disabled={!canManage}
                value={surplusCode}
                onChange={(e) => setSurplusCode(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-100"
              >
                {db.chartOfAccounts
                  .filter((a) => a.isLeaf && a.category === 'إيرادات')
                  .map((a) => (
                    <option key={a.id} value={a.code}>
                      {a.code} — {a.nameAr}
                    </option>
                  ))}
              </select>
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">حساب عجز وتلف الجرد المخزني (مدين)</label>
              <select
                disabled={!canManage}
                value={shortageCode}
                onChange={(e) => setShortageCode(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-100"
              >
                {db.chartOfAccounts
                  .filter((a) => a.isLeaf && a.category === 'مصروفات')
                  .map((a) => (
                    <option key={a.id} value={a.code}>
                      {a.code} — {a.nameAr}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          {/* Payment Methods Editor */}
          <div className="bg-slate-950/70 p-4 rounded-xl border border-slate-800 space-y-3">
            <strong className="block text-slate-200">طرق الدفع المعتمدة في الخزينة والسندات</strong>
            <div className="flex flex-wrap gap-2">
              {paymentMethods.map((m) => (
                <span
                  key={m}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-700 text-slate-200"
                >
                  <span>{m}</span>
                  {canManage && paymentMethods.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setPaymentMethods(paymentMethods.filter((x) => x !== m))}
                      className="text-rose-400 hover:text-rose-300 cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </span>
              ))}
            </div>
            {canManage && (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newPaymentMethod}
                  onChange={(e) => setNewPaymentMethod(e.target.value)}
                  placeholder="أضف طريقة دفع جديدة (مثال: حوالة محلية)"
                  className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-slate-100"
                />
                <button
                  type="button"
                  onClick={() => {
                    const clean = newPaymentMethod.trim();
                    if (clean && !paymentMethods.includes(clean)) {
                      setPaymentMethods([...paymentMethods, clean]);
                      setNewPaymentMethod('');
                    }
                  }}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-amber-300 font-bold rounded-lg cursor-pointer"
                >
                  إضافة
                </button>
              </div>
            )}
          </div>

          {canManage && (
            <button
              type="submit"
              className="flex items-center gap-1.5 px-6 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-lg transition-colors cursor-pointer"
            >
              <Save className="w-4 h-4" />
              <span>حفظ السياسات والضوابط</span>
            </button>
          )}
        </form>
      )}

      {/* TAB 3: BRANCHES, WAREHOUSES & UNITS OF MEASURE */}
      {activeTab === 'branches_units' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 text-xs">
          {/* Branches */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
            <h3 className="font-bold text-sm text-white flex items-center gap-2">
              <Building2 className="w-4 h-4 text-amber-400" />
              <span>الفروع ({activeCompanyScopedDb.branches.length})</span>
            </h3>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {activeCompanyScopedDb.branches.map((b) => (
                <div key={b.id} className="bg-slate-950 border border-slate-800 rounded-xl p-3">
                  <div className="flex justify-between font-bold text-slate-100">
                    <span>{b.nameAr}</span>
                    <span className="font-mono text-amber-400">{b.code}</span>
                  </div>
                  <span className="text-[11px] text-slate-400 block mt-1">
                    المدير: {b.managerName} · {b.phone}
                  </span>
                </div>
              ))}
            </div>
            {canManage && (
              <form onSubmit={handleAddBranchSubmit} className="space-y-2 pt-3 border-t border-slate-800">
                <input
                  type="text"
                  required
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  placeholder="اسم الفرع الجديد..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-white"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={newBranchManager}
                    onChange={(e) => setNewBranchManager(e.target.value)}
                    placeholder="مدير الفرع"
                    className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-white"
                  />
                  <input
                    type="text"
                    value={newBranchPhone}
                    onChange={(e) => setNewBranchPhone(e.target.value)}
                    placeholder="الهاتف"
                    className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-white font-mono"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-lg flex items-center justify-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>إضافة فرع</span>
                </button>
              </form>
            )}
          </div>

          {/* Warehouses */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
            <h3 className="font-bold text-sm text-white">المستودعات ({activeCompanyScopedDb.warehouses.length})</h3>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {activeCompanyScopedDb.warehouses.map((w) => (
                <div key={w.id} className="bg-slate-950 border border-slate-800 rounded-xl p-3">
                  <div className="flex justify-between font-bold text-slate-100">
                    <span>{w.nameAr}</span>
                    <span className="font-mono text-amber-400">{w.code}</span>
                  </div>
                  <span className="text-[11px] text-slate-400 block mt-1">
                    الأمين: {w.keeperName} · {activeCompanyScopedDb.branches.find((b) => b.id === w.branchId)?.nameAr || '-'}
                  </span>
                </div>
              ))}
            </div>
            {canManage && (
              <form onSubmit={handleAddWarehouseSubmit} className="space-y-2 pt-3 border-t border-slate-800">
                <input
                  type="text"
                  required
                  value={newWhName}
                  onChange={(e) => setNewWhName(e.target.value)}
                  placeholder="اسم المستودع الجديد..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-white"
                />
                <select
                  value={newWhBranchId}
                  onChange={(e) => setNewWhBranchId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-white cursor-pointer"
                >
                  {activeCompanyScopedDb.branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.nameAr}</option>
                  ))}
                </select>
                <input
                  type="text"
                  value={newWhKeeper}
                  onChange={(e) => setNewWhKeeper(e.target.value)}
                  placeholder="اسم أمين المستودع"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-white"
                />
                <button
                  type="submit"
                  className="w-full py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-lg flex items-center justify-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>إضافة مستودع</span>
                </button>
              </form>
            )}
          </div>

          {/* Units of Measure */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
            <h3 className="font-bold text-sm text-white">وحدات القياس ({(db.unitsOfMeasure || []).length})</h3>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {(db.unitsOfMeasure || []).map((u) => (
                <div key={u.id} className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex justify-between items-center">
                  <div>
                    <strong className="text-slate-100 block">{u.nameAr}</strong>
                    <span className="text-[11px] text-slate-400">معامل التحويل: {u.factorToBase}</span>
                  </div>
                  <span className="px-2 py-0.5 bg-slate-800 text-amber-300 rounded font-bold">{u.symbolAr}</span>
                </div>
              ))}
            </div>
            {canManage && (
              <form onSubmit={handleAddUomSubmit} className="space-y-2 pt-3 border-t border-slate-800">
                <input
                  type="text"
                  required
                  value={newUomName}
                  onChange={(e) => setNewUomName(e.target.value)}
                  placeholder="اسم الوحدة (مثال: درزن)"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-white"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={newUomSymbol}
                    onChange={(e) => setNewUomSymbol(e.target.value)}
                    placeholder="الرمز"
                    className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-white"
                  />
                  <input
                    type="number"
                    min={1}
                    value={newUomFactor}
                    onChange={(e) => setNewUomFactor(Number(e.target.value))}
                    placeholder="معامل التحويل"
                    className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-white font-mono"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-lg flex items-center justify-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>إضافة وحدة قياس</span>
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* TAB 4: CURRENCIES & EXCHANGE RATES */}
      {activeTab === 'currencies' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 text-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="font-bold text-sm text-white">العملات المعتمدة وأسعار الصرف الرسمية</h3>
              <p className="text-slate-400">
                تعديل سعر الصرف مقابل العملة الأساسية (يُثبّت تاريخياً داخل كل فاتورة وسند مرحّل)
              </p>
            </div>
            {(() => {
              const canEditRates = currentUser.canEditExchangeRates ?? canManage;
              return canEditRates ? (
                <button
                  type="button"
                  onClick={() => {
                    onUpdateCurrencies(editableCurrencies);
                    onNotify?.('success', 'تم تحديث أسعار الصرف المعتمدة بنجاح.');
                  }}
                  className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-lg cursor-pointer"
                >
                  <Save className="w-4 h-4" />
                  <span>حفظ أسعار الصرف</span>
                </button>
              ) : null;
            })()}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-950 text-slate-400 font-bold">
                <tr>
                  <th className="py-2.5 px-3">رمز العملة</th>
                  <th className="py-2.5 px-3">اسم العملة</th>
                  <th className="py-2.5 px-3">الرمز</th>
                  <th className="py-2.5 px-3 text-left">سعر الصرف مقابل العملة الأساسية</th>
                  <th className="py-2.5 px-3 text-center">العملة الأساسية</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 font-mono">
                {editableCurrencies.map((c, idx) => {
                  const canEditRates = currentUser.canEditExchangeRates ?? canManage;
                  return (
                  <tr key={c.code} className="hover:bg-slate-800/40">
                    <td className="py-2.5 px-3 font-bold text-amber-400">{c.code}</td>
                    <td className="py-2.5 px-3 font-sans text-slate-200">{c.nameAr}</td>
                    <td className="py-2.5 px-3 font-sans text-slate-300">{c.symbol}</td>
                    <td className="py-2.5 px-3 text-left text-white">
                      {c.isBase || !canEditRates ? (
                        c.exchangeRate
                      ) : (
                        <input
                          type="number"
                          min={0.01}
                          step="0.01"
                          value={c.exchangeRate}
                          onChange={(e) => {
                            const val = Number(e.target.value) || 1;
                            setEditableCurrencies((prev) =>
                              prev.map((row, i) => (i === idx ? { ...row, exchangeRate: val } : row))
                            );
                          }}
                          className="w-32 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-left text-amber-300 font-mono"
                        />
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-center font-sans">
                      {c.isBase ? (
                        <span className="bg-emerald-950 text-emerald-400 border border-emerald-800 px-2 py-0.5 rounded text-[10px] font-bold">
                          الأساسية
                        </span>
                      ) : (
                        <span className="text-slate-500">-</span>
                      )}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 5: WHATSAPP TEMPLATES, API & UI PREFERENCES */}
      {activeTab === 'whatsapp_ui' && (
        <form onSubmit={handleSaveWhatsAppAndUI} className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-xs">
          {/* UI Preferences & Module Visibility */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-5">
            <h3 className="font-bold text-sm text-white flex items-center gap-2">
              <Palette className="w-4 h-4 text-amber-400" />
              <span>تخصيص الواجهة والخط والقوائم الجانبية</span>
            </h3>

            <div>
              <div className="flex justify-between mb-1">
                <label className="font-semibold text-slate-300">حجم الخط الأساسي للواجهة</label>
                <strong className="font-mono text-amber-400">{uiPrefs.fontSize}px</strong>
              </div>
              <input
                type="range"
                min={12}
                max={17}
                step={1}
                disabled={!canManage}
                value={uiPrefs.fontSize}
                onChange={(e) => setUiPrefs({ ...uiPrefs, fontSize: Number(e.target.value) })}
                className="w-full accent-amber-500 cursor-pointer"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-300 mb-2">السمة اللونية الذهبية</label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'amber', label: 'كهرماني حديث', dot: 'bg-amber-500' },
                  { id: 'gold_classic', label: 'ذهبي كلاسيكي', dot: 'bg-yellow-500' },
                  { id: 'bronze_gold', label: 'برونزي ملكي', dot: 'bg-orange-400' },
                ].map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    disabled={!canManage}
                    onClick={() =>
                      setUiPrefs({ ...uiPrefs, accentPreset: preset.id as UIPreferences['accentPreset'] })
                    }
                    className={`p-2.5 rounded-xl border flex items-center justify-center gap-2 font-bold cursor-pointer ${
                      uiPrefs.accentPreset === preset.id
                        ? 'bg-amber-500/15 border-amber-500 text-amber-300'
                        : 'bg-slate-950 border-slate-800 text-slate-400'
                    }`}
                  >
                    <span className={`w-3 h-3 rounded-full ${preset.dot}`} />
                    <span>{preset.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block font-semibold text-slate-300 mb-2">
                إظهار وإخفاء الوحدات في القائمة الجانبية (شاشة الإعدادات ثابتة)
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto bg-slate-950 p-3 rounded-xl border border-slate-800">
                {SIDEBAR_MODULES.map((mod) => {
                  const isVisible = !uiPrefs.hiddenModules.includes(mod.id);
                  return (
                    <label key={mod.id} className="flex items-center gap-2 cursor-pointer text-slate-300">
                      <input
                        type="checkbox"
                        disabled={!canManage}
                        checked={isVisible}
                        onChange={() => toggleModuleVisibility(mod.id)}
                        className="accent-amber-500 w-3.5 h-3.5"
                      />
                      <span>{mod.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          {/* WhatsApp Templates & Relay Settings */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
            <h3 className="font-bold text-sm text-white flex items-center gap-2">
              <MessageCircle className="w-4 h-4 text-emerald-400" />
              <span>قوالب رسائل واتساب والربط</span>
            </h3>

            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-[11px] text-slate-400 flex items-start gap-2">
              <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <span>
                المتغيرات المتاحة: <code className="text-amber-300">{'{name}'}</code>,{' '}
                <code className="text-amber-300">{'{number}'}</code>,{' '}
                <code className="text-amber-300">{'{amount}'}</code>,{' '}
                <code className="text-amber-300">{'{balance}'}</code>,{' '}
                <code className="text-amber-300">{'{currency}'}</code>,{' '}
                <code className="text-amber-300">{'{date}'}</code>. في وضع المتصفح يتم الإطلاق عبر روابط wa.me.
              </span>
            </div>

            {[
              { key: 'invoice', label: 'قالب رسالة الفاتورة' },
              { key: 'voucher', label: 'قالب السند (قبض / صرف)' },
              { key: 'statement', label: 'قالب كشف الحساب' },
              { key: 'overdueReminder', label: 'قالب التذكير بالمديونية' },
              { key: 'dailySummary', label: 'قالب ملخص الإدارة اليومي' },
            ].map((item) => (
              <div key={item.key}>
                <label className="block text-slate-300 font-semibold mb-1">{item.label}</label>
                <textarea
                  rows={2}
                  disabled={!canManage}
                  value={templates[item.key as keyof WhatsAppTemplates]}
                  onChange={(e) =>
                    setTemplates({ ...templates, [item.key]: e.target.value })
                  }
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100"
                />
              </div>
            ))}

            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2.5">
              <label className="flex items-center justify-between cursor-pointer">
                <strong className="text-slate-200">تفعيل بيانات بوابة WhatsApp Cloud API (اختياري)</strong>
                <input
                  type="checkbox"
                  disabled={!canManage}
                  checked={enableWhatsAppAPI}
                  onChange={(e) => setEnableWhatsAppAPI(e.target.checked)}
                  className="accent-amber-500 w-4 h-4"
                />
              </label>
              {enableWhatsAppAPI && (
                <div className="grid grid-cols-1 gap-2 pt-2">
                  <input
                    type="text"
                    disabled={!canManage}
                    value={whatsappApiEndpoint}
                    onChange={(e) => setWhatsappApiEndpoint(e.target.value)}
                    placeholder="API Endpoint URL"
                    className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-slate-100 font-mono"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      disabled={!canManage}
                      value={whatsappPhoneNumberId}
                      onChange={(e) => setWhatsappPhoneNumberId(e.target.value)}
                      placeholder="Phone Number ID"
                      className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-slate-100 font-mono"
                    />
                    <input
                      type="password"
                      disabled={!canManage}
                      value={whatsappApiToken}
                      onChange={(e) => setWhatsappApiToken(e.target.value)}
                      placeholder="Access Token"
                      className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-slate-100 font-mono"
                    />
                  </div>
                </div>
              )}
            </div>

            {canManage && (
              <button
                type="submit"
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl cursor-pointer"
              >
                <Save className="w-4 h-4" />
                <span>حفظ تخصيص الواجهة وقوالب واتساب</span>
              </button>
            )}
          </div>
        </form>
      )}

      {/* TAB 6: ROLES & USERS */}
      {activeTab === 'roles' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 text-xs">
          <h3 className="font-bold text-sm text-white">الأدوار والصلاحيات (RBAC)</h3>
          <p className="text-slate-400">
            قائمة المستخدمين ومصفوفة الصلاحيات المفعلة فعلياً عبر كافة وحدات النظام
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-950 text-slate-400 font-bold">
                <tr>
                  <th className="py-2.5 px-3">المستخدم</th>
                  <th className="py-2.5 px-3">الدور المخصص</th>
                  <th className="py-2.5 px-3 text-center">التقارير</th>
                  <th className="py-2.5 px-3 text-center">ترحيل القيود</th>
                  <th className="py-2.5 px-3 text-center">تسوية المخزون</th>
                  <th className="py-2.5 px-3 text-center">الأرباح والتكاليف</th>
                  <th className="py-2.5 px-3 text-center">الإعدادات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {tenantScopedDb.users.map((u) => {
                  const togglePerm = (field: keyof Pick<User, 'canViewReports' | 'canPostEntries' | 'canAdjustInventory' | 'canViewCostsAndProfits' | 'canManageSettings'>) => {
                    if (!requireAdmin() || !onUpdateUserPermissions) return;
                    onUpdateUserPermissions({ ...u, [field]: !u[field] });
                    onNotify?.('success', `تم تحديث صلاحية المستخدم "${u.fullName}".`);
                  };
                  return (
                    <tr key={u.id} className="hover:bg-slate-800/40">
                      <td className="py-2.5 px-3">
                        <strong className="text-slate-200 block">{u.fullName}</strong>
                        <span className="text-[11px] font-mono text-slate-500 block">{u.email}</span>
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-amber-400">{getRoleDisplayLabel(u.role)}</td>
                      {(
                        [
                          'canViewReports',
                          'canPostEntries',
                          'canAdjustInventory',
                          'canViewCostsAndProfits',
                          'canManageSettings',
                        ] as const
                      ).map((field) => (
                        <td key={field} className="py-2.5 px-3 text-center">
                          <input
                            type="checkbox"
                            disabled={!canManage || !onUpdateUserPermissions}
                            checked={u[field]}
                            onChange={() => togglePerm(field)}
                            className="accent-amber-500 w-4 h-4 cursor-pointer"
                          />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 7: AUDIT LOG */}
      {activeTab === 'audit' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 text-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h3 className="font-bold text-sm text-white flex items-center gap-2">
              <History className="w-4 h-4 text-amber-400" />
              سجل التدقيق والرقابة الأمنية ({filteredLogs.length})
            </h3>
            <input
              type="text"
              value={auditSearch}
              onChange={(e) => {
                setAuditSearch(e.target.value);
                setAuditVisibleCount(50);
              }}
              placeholder="تصفية السجل حسب المستخدم أو الوحدة أو التفاصيل..."
              className="w-full sm:w-72 bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-slate-100"
            />
          </div>

          <div className="overflow-x-auto max-h-[520px]">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-950 text-slate-400 font-bold sticky top-0">
                <tr>
                  <th className="py-2.5 px-3">التوقيت والتاريخ</th>
                  <th className="py-2.5 px-3">المستخدم</th>
                  <th className="py-2.5 px-3">الوحدة</th>
                  <th className="py-2.5 px-3 text-center">الإجراء</th>
                  <th className="py-2.5 px-3">التفاصيل والبيان</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {filteredLogs.slice(0, auditVisibleCount).map((log) => (
                  <tr key={log.id} className="hover:bg-slate-800/40">
                    <td className="py-2.5 px-3 text-slate-400">{log.timestamp.replace('T', ' ').slice(0, 19)}</td>
                    <td className="py-2.5 px-3 font-sans text-slate-200">{log.userName}</td>
                    <td className="py-2.5 px-3 font-sans text-slate-300">{log.module}</td>
                    <td className="py-2.5 px-3 text-center font-sans">
                      <span className="bg-slate-800 text-amber-400 px-2 py-0.5 rounded text-[10px] font-bold">
                        {log.action}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-sans text-slate-300">{log.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filteredLogs.length > auditVisibleCount && (
            <div className="flex items-center justify-center pt-1">
              <button
                type="button"
                onClick={() => setAuditVisibleCount((c) => c + 50)}
                className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 font-bold cursor-pointer"
              >
                عرض 50 سجلاً إضافياً ({filteredLogs.length - auditVisibleCount} متبقٍ)
              </button>
            </div>
          )}
        </div>
      )}

      {/* TAB 8: BACKUP & DEMO RESET */}
      {activeTab === 'backup' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6 text-xs max-w-2xl">
          <div className="border-b border-slate-800 pb-3">
            <h3 className="font-bold text-sm text-white">النسخ الاحتياطي واستعادة البيانات</h3>
            <p className="text-slate-400">تصدير قاعدة البيانات بالكامل إلى ملف JSON أو استعادتها بعد التحقق الصارم</p>
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex items-start gap-2.5 text-[11px] text-slate-300">
            <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <strong className="block text-amber-300 mb-0.5">معلومة التخزين المحلي:</strong>
              يتم حفظ جميع البيانات تلقائياً في قاعدة IndexedDB و LocalStorage داخل متصفحك. لضمان عدم فقدان البيانات عند تغيير الجهاز أو مسح ذاكرة المتصفح، نوصي بتنزيل نسخة JSON دورياً.
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
              <span className="font-bold text-slate-200 block">تصدير نسخة احتياطية كاملة بدون تجميد الواجهة</span>
              <p className="text-slate-400 text-[11px]">
                تصدير 100% من الفواتير، القيود، المخزون، محاضر الجرد، الصور والإعدادات عبر مسار خلفي مجزأ والتحقق من سلامة الملف.
              </p>
              <button
                type="button"
                disabled={isExportingBackup}
                onClick={handleAsyncBackupExport}
                className="w-full py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-60 text-amber-400 font-bold rounded-lg flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>
                  {isExportingBackup
                    ? `جاري التصدير (${backupProgress?.percent || 10}%)...`
                    : 'تنزيل النسخة الاحتياطية الكاملة (.JSON)'}
                </span>
              </button>
              {backupProgress && (
                <div className="space-y-1 pt-1">
                  <div className="flex justify-between text-[10px] text-slate-400">
                    <span>{backupProgress.stageAr}</span>
                    <span className="font-mono text-amber-300">{backupProgress.percent}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-amber-400 transition-all duration-150"
                      style={{ width: `${backupProgress.percent}%` }}
                    />
                  </div>
                </div>
              )}
              {lastBackupResult?.ok && (
                <div className="text-[10px] text-emerald-300 bg-emerald-950/30 border border-emerald-700/40 rounded px-2 py-1">
                  ✓ تم التحقق من السلامة · الحجم: {(lastBackupResult.sizeBytes / 1024).toFixed(1)} KB · {lastBackupResult.recordCount} سجل · {lastBackupResult.durationMs} ms
                </div>
              )}
            </div>

            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
              <span className="font-bold text-slate-200 block">استعادة من نسخة احتياطية (JSON أو المشفرة .enc)</span>
              <p className="text-slate-400 text-[11px]">
                قراءة غير حاجبة لواجهة النظام وفحص سلامة الجداول قبل الاعتماد دون المساس بالبيانات الحالية في حال وجود خطأ
              </p>
              <label
                className={`w-full py-2 font-bold rounded-lg flex items-center justify-center gap-2 transition-colors text-center ${
                  canManage && !isParsingRestore
                    ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer'
                    : 'bg-slate-900 text-slate-600 cursor-not-allowed'
                }`}
              >
                <Upload className="w-4 h-4" />
                <span>{isParsingRestore ? 'جاري فحص ملف النسخة...' : 'اختر ملف النسخة (.JSON / .ENC)'}</span>
                <input
                  type="file"
                  accept=".json,.enc,.json.enc"
                  disabled={!canManage || isParsingRestore}
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>

              {/* Encrypted Export Box */}
              <div className="pt-2 border-t border-slate-800 space-y-2">
                <span className="text-[11px] font-bold text-emerald-300 block">تصدير نسخة مشفرة (AES-256-GCM .json.enc)</span>
                <div className="flex items-center gap-2">
                  <input
                    type="password"
                    value={backupPassphrase}
                    onChange={(e) => setBackupPassphrase(e.target.value)}
                    placeholder="كلمة مرور التشفير..."
                    className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100 font-mono"
                  />
                  <button
                    type="button"
                    disabled={!canManage}
                    onClick={handleEncryptedBackupExport}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold rounded-lg cursor-pointer shrink-0"
                  >
                    تصدير مشفر
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Decryption Passphrase Prompt */}
          {pendingEncryptedRaw && (
            <form
              onSubmit={handleDecryptAndVerifyBackup}
              className="bg-amber-950/30 border border-amber-500/40 rounded-xl p-4 space-y-2"
            >
              <div className="font-bold text-amber-300">
                فك تشفير النسخة الاحتياطية: {pendingEncryptedRaw.fileName}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="password"
                  required
                  value={decryptPassphrase}
                  onChange={(e) => setDecryptPassphrase(e.target.value)}
                  placeholder="أدخل كلمة مرور فك التشفير..."
                  className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-white font-mono"
                />
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-lg cursor-pointer"
                >
                  فك التشفير والتحقق
                </button>
                <button
                  type="button"
                  onClick={() => setPendingEncryptedRaw(null)}
                  className="px-3 py-1.5 bg-slate-800 text-slate-300 rounded-lg cursor-pointer"
                >
                  إلغاء
                </button>
              </div>
            </form>
          )}

          {/* Backup History Log */}
          {(db.backupHistory || []).length > 0 && (
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2">
              <div className="font-bold text-slate-200">سجل النسخ الاحتياطية والتحقق ({db.backupHistory?.length})</div>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {(db.backupHistory || []).map((bh) => (
                  <div key={bh.id} className="flex items-center justify-between text-[11px] bg-slate-900 px-3 py-1.5 rounded">
                    <span className="text-slate-300">
                      {bh.createdAt.slice(0, 16).replace('T', ' ')} · {bh.notes || bh.type}
                    </span>
                    <span className="font-mono text-emerald-300">
                      {(bh.sizeBytes / 1024).toFixed(1)} KB · {bh.recordCount} سجل
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Reset Demo Data */}
          <div className="bg-rose-950/20 border border-rose-900/40 p-5 rounded-xl space-y-3">
            <div className="flex items-center gap-2 text-rose-400 font-bold">
              <AlertTriangle className="w-5 h-5" />
              <span>إعادة ضبط البيانات التجريبية للمصنع (Factory Reset)</span>
            </div>
            <p className="text-rose-200/80 leading-relaxed text-[11px]">
              هذا الإجراء سيقوم بإعادة ضبط جميع الحسابات والفواتير وحركات المخزون إلى البيانات التجريبية الأولية.
            </p>
            <button
              type="button"
              disabled={!canManage}
              onClick={() => setIsResetModalOpen(true)}
              className="px-5 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-bold rounded-lg transition-colors cursor-pointer"
            >
              تأكيد إعادة الضبط إلى بيانات التجربة
            </button>
          </div>
        </div>
      )}

      {/* TAB 9: DATA MIGRATION */}
      {activeTab === 'migration' && (
        <div className="max-w-5xl">
          <DataMigrationPanel
            db={db}
            onApplyMigration={(updated) => {
              if (!requireAdmin()) return;
              onRestoreDatabase(updated);
              onNotify?.('success', 'تم تطبيق وترحيل البيانات المستوردة بنجاح.');
            }}
          />
        </div>
      )}

      {/* Pre-restore backup confirmation */}
      <ConfirmModal
        isOpen={Boolean(pendingRestore)}
        title="تأكيد استعادة النسخة الاحتياطية"
        variant="warning"
        message={
          pendingRestore
            ? `تم التحقق من سلامة الملف (${pendingRestore.fileName}): يحتوي على ${pendingRestore.stats.accounts} حساب، ${pendingRestore.stats.invoices} فاتورة، ${pendingRestore.stats.vouchers} سند، ${pendingRestore.stats.customers} عميل، ${pendingRestore.stats.items} صنف، ${pendingRestore.stats.journalEntries} قيد يومية. هل تريد استبدال قاعدة البيانات الحالية بهذه النسخة؟`
            : ''
        }
        confirmLabel="اعتماد الاستعادة الآن"
        onConfirm={() => {
          if (pendingRestore) {
            onRestoreDatabase(pendingRestore.db);
            onNotify?.('success', 'تمت استعادة قاعدة البيانات بنجاح.');
          }
          setPendingRestore(null);
        }}
        onCancel={() => setPendingRestore(null)}
      />

      {/* Reset confirmation */}
      <ConfirmModal
        isOpen={isResetModalOpen}
        title="تأكيد إعادة ضبط النظام بالكامل"
        variant="danger"
        message="هل أنت متأكد من رغبتك في إعادة ضبط قاعدة البيانات إلى الحالة التجريبية الافتراضية؟ سيتم حذف جميع العمليات المدخلة حالياً."
        confirmLabel="نعم، إعادة ضبط المصنع"
        onConfirm={() => {
          setIsResetModalOpen(false);
          onResetDatabase();
        }}
        onCancel={() => setIsResetModalOpen(false)}
      />
    </div>
  );
};
