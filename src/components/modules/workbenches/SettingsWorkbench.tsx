/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - V20 Tab 8: Live Theme, Tabs Visibility, Document Books, Granular RBAC Matrix, Currencies, Banner & Backup/Migration
 */

import React, { useState } from 'react';
import {
  Palette,
  BookOpen,
  ShieldCheck,
  Coins,
  Database,
  Sliders,
  Plus,
  RotateCcw,
  Globe,
  Edit3,
  Trash2,
  X,
  LayoutTemplate,
  Landmark,
} from 'lucide-react';
import {
  Company,
  Branch,
  Warehouse,
  Currency,
  UnitOfMeasure,
  SystemSettings,
  User,
  UserRoleType,
  DocumentBook,
  TabVisibilityConfig,
  PrintDocumentType,
  PrintTemplateConfig,
} from '../../../types/erp';
import {
  ERPDatabase,
  PersistenceResult,
  defaultTabsConfig,
  scopeDatabaseToCompany,
  filterDatabaseForUserTenants,
} from '../../../services/storageService';
import { AppLanguage, getTabLabel, t } from '../../../services/i18n';
import { sanitizeImageSrc } from '../../../services/exportService';
import { DocumentBooksModal } from '../../common/DocumentBooksModal';
import { ConfirmModal } from '../../common/ConfirmModal';
import { SettingsModule } from '../settings/SettingsModule';
import { PrintTemplateDesigner } from '../settings/PrintTemplateDesigner';
import { OperationalControlCenter } from '../settings/OperationalControlCenter';
import { GovernanceIntegrityPanel } from '../settings/GovernanceIntegrityPanel';
import {
  buildUserRoleMatrix,
  generateSaltHex,
  getRoleDisplayLabel,
  hashPasswordAsync,
  isPlatformSuperAdmin,
  isTenantAdminUser,
  validatePasswordStrength,
  validateUploadFile,
} from '../../../services/securityService';
import { cloudApiService } from '../../../services/cloudApiService';

interface SettingsWorkbenchProps {
  db: ERPDatabase;
  currentUser: User;
  lang?: AppLanguage;
  onChangeLanguage?: (lang: AppLanguage) => void;
  onUpdateCompany: (company: Company) => void;
  onUpdateSettings: (settings: SystemSettings) => void;
  onSavePrintTemplates?: (
    map: Record<PrintDocumentType, PrintTemplateConfig>
  ) => Promise<PersistenceResult | { ok: boolean; error?: string }>;
  onSaveBranch: (branch: Branch) => void;
  onSaveWarehouse: (wh: Warehouse) => void;
  onSaveUnitOfMeasure: (uom: UnitOfMeasure) => void;
  onUpdateCurrencies: (currencies: Currency[]) => void;
  onUpdateUserPermissions: (user: User) => void;
  onAddUser: (user: User) => void;
  onSaveDocumentBook: (book: DocumentBook) => void;
  onToggleDocumentBook: (bookId: string) => void;
  onSetDefaultDocumentBook: (bookId: string) => void;
  onResetDatabase: () => void;
  onRestoreDatabase: (
    restored: ERPDatabase,
    options?: {
      targetMode?: 'current_company' | 'restored_company';
      allowReplaceExisting?: boolean;
      sourceLabel?: string;
    }
  ) => Promise<{ ok: boolean; error?: string; code?: string; status?: number } | void> | void;
  onUpdateDatabase?: (nextDb: ERPDatabase) => void;
  onNotify: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export const SettingsWorkbench: React.FC<SettingsWorkbenchProps> = ({
  db,
  currentUser,
  lang = 'ar',
  onChangeLanguage,
  onUpdateCompany,
  onUpdateSettings,
  onSavePrintTemplates,
  onSaveBranch,
  onSaveWarehouse,
  onSaveUnitOfMeasure,
  onUpdateCurrencies,
  onUpdateUserPermissions,
  onAddUser,
  onSaveDocumentBook,
  onToggleDocumentBook,
  onSetDefaultDocumentBook,
  onResetDatabase,
  onRestoreDatabase,
  onUpdateDatabase,
  onNotify,
}) => {
  const isEn = lang === 'en';
  type SettingsSubTabId =
    | 'v20_customizer'
    | 'print_templates'
    | 'control_center'
    | 'integrity_approvals'
    | 'books'
    | 'rbac'
    | 'currencies'
    | 'full_settings'
    | 'platform_subscriptions';
  const [subTab, setSubTab] = useState<SettingsSubTabId>('v20_customizer');
  const [templateEditorDirty, setTemplateEditorDirty] = useState(false);
  const [pendingSubTab, setPendingSubTab] = useState<SettingsSubTabId | null>(null);
  const [isBooksModalOpen, setIsBooksModalOpen] = useState(false);
  const [platformCompanies, setPlatformCompanies] = useState<
    Array<{
      id: string;
      nameAr: string;
      countryCode: string;
      baseCurrency: string;
      status: string;
      licenseStatus: string;
      planCode: string;
      createdAt: string;
    }>
  >([]);
  const [platformLoading, setPlatformLoading] = useState(false);

  const requestSubTabSwitch = (nextTab: SettingsSubTabId) => {
    if (nextTab === subTab) return;
    if (subTab === 'print_templates' && templateEditorDirty) {
      setPendingSubTab(nextTab);
      return;
    }
    setSubTab(nextTab);
  };

  // New / Edit User Form
  const [newFullName, setNewFullName] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<UserRoleType>('محاسب');
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editUserPassword, setEditUserPassword] = useState('');

  // New / Edit Currency Form
  const [newCurCode, setNewCurCode] = useState<string>('AED');
  const [newCurName, setNewCurName] = useState('');
  const [newCurSymbol, setNewCurSymbol] = useState('د.إ');
  const [newCurDecimals, setNewCurDecimals] = useState(2);
  const [newCurRate, setNewCurRate] = useState(145);

  const uiPrefs = db.settings.uiPreferences || {
    fontSize: 14,
    accentPreset: 'amber' as const,
    goldColor: '#f5c748',
    cardColor: '#101e2e',
    hiddenModules: [],
    tabsConfig: defaultTabsConfig,
    tableColumnPrefs: {},
  };

  const tabsList: TabVisibilityConfig[] = uiPrefs.tabsConfig && uiPrefs.tabsConfig.length > 0
    ? uiPrefs.tabsConfig
    : defaultTabsConfig;

  const scopedDb = React.useMemo(() => scopeDatabaseToCompany(db), [db]);
  const isSuperAdmin = isPlatformSuperAdmin(currentUser);
  const canManage = isTenantAdminUser(currentUser);
  const canEditRates = currentUser.canEditExchangeRates ?? canManage;

  const loadPlatformOverview = async () => {
    if (!isSuperAdmin) return;
    setPlatformLoading(true);
    try {
      const ov = await cloudApiService.getAdminOverview();
      setPlatformCompanies(ov.companies || []);
    } catch (err: unknown) {
      onNotify('error', err instanceof Error ? err.message : 'تعذر تحميل قائمة اشتراكات المنشآت.');
    } finally {
      setPlatformLoading(false);
    }
  };

  const updateUiPref = (patch: Partial<typeof uiPrefs>) => {
    if (!canManage) {
      onNotify('error', 'عذراً، لا تملك صلاحية تعديل إعدادات المظهر والتبويبات.');
      return;
    }
    onUpdateSettings({
      ...db.settings,
      uiPreferences: {
        ...uiPrefs,
        ...patch,
      },
    });
  };

  const handleBannerUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!canManage) {
      onNotify('error', 'عذراً، لا تملك صلاحية رفع أو تعديل ترويسة المنشأة.');
      return;
    }
    if (!file) return;
    const check = validateUploadFile(file, 'image');
    if (!check.ok) {
      onNotify('error', check.error || 'صيغة ملف الترويسة غير مدعومة.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const safeSrc = sanitizeImageSrc(String(reader.result || ''));
      if (!safeSrc) {
        onNotify('error', 'محتوى الصورة غير آمن أو غير مدعوم.');
        return;
      }
      onUpdateCompany({
        ...db.company,
        bannerBase64: safeSrc,
        useFullBanner: true,
      });
      onNotify('success', 'تم رفع ترويسة الشركة المخصصة للطباعة والـ PDF.');
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-3" dir={isEn ? 'ltr' : 'rtl'}>
      <div className="v20-card-alt px-3 py-2 flex items-center gap-1.5 flex-wrap">
        <button
          type="button"
          onClick={() => requestSubTabSwitch('v20_customizer')}
          className={`px-3 py-1.5 rounded-md text-xs font-black flex items-center gap-1.5 cursor-pointer ${
            subTab === 'v20_customizer' ? 'bg-[var(--gold)] text-[#03060A]' : 'bg-[#08121E] border border-[var(--border-strong)] text-white'
          }`}
        >
          <Palette className="w-3.5 h-3.5" />
          <span>{isEn ? '1. Theme, Language, Tabs & Print Banner' : '1. المظهر، اللغة، التبويبات وترويسة الطباعة'}</span>
        </button>
        <button
          type="button"
          onClick={() => requestSubTabSwitch('print_templates')}
          className={`px-3 py-1.5 rounded-md text-xs font-black flex items-center gap-1.5 cursor-pointer ${
            subTab === 'print_templates' ? 'bg-[var(--gold)] text-[#03060A]' : 'bg-[#08121E] border border-[var(--border-strong)] text-white'
          }`}
        >
          <LayoutTemplate className="w-3.5 h-3.5" />
          <span>{isEn ? '2. Print & PDF Template Designer' : '2. مصمم قوالب الطباعة والـ PDF'}</span>
          {templateEditorDirty && <span className="w-2 h-2 rounded-full bg-amber-400" />}
        </button>
        <button
          type="button"
          onClick={() => requestSubTabSwitch('books')}
          className={`px-3 py-1.5 rounded-md text-xs font-black flex items-center gap-1.5 cursor-pointer ${
            subTab === 'books' ? 'bg-[var(--gold)] text-[#03060A]' : 'bg-[#08121E] border border-[var(--border-strong)] text-white'
          }`}
        >
          <BookOpen className="w-3.5 h-3.5" />
          <span>{isEn ? `3. Document Books (${scopedDb.documentBooks?.length || 0})` : `3. دفاتر الفواتير والسندات (${scopedDb.documentBooks?.length || 0})`}</span>
        </button>
        <button
          type="button"
          onClick={() => requestSubTabSwitch('rbac')}
          className={`px-3 py-1.5 rounded-md text-xs font-black flex items-center gap-1.5 cursor-pointer ${
            subTab === 'rbac' ? 'bg-[var(--gold)] text-[#03060A]' : 'bg-[#08121E] border border-[var(--border-strong)] text-white'
          }`}
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>{isEn ? `4. Users & RBAC Matrix (${db.users.length})` : `4. المستخدمون ومصفوفة الصلاحيات (${db.users.length})`}</span>
        </button>
        <button
          type="button"
          onClick={() => requestSubTabSwitch('currencies')}
          className={`px-3 py-1.5 rounded-md text-xs font-black flex items-center gap-1.5 cursor-pointer ${
            subTab === 'currencies' ? 'bg-[var(--gold)] text-[#03060A]' : 'bg-[#08121E] border border-[var(--border-strong)] text-white'
          }`}
        >
          <Coins className="w-3.5 h-3.5" />
          <span>{isEn ? '5. Currencies & FX Rates' : '5. العملات وأسعار الصرف'}</span>
        </button>
        <button
          type="button"
          onClick={() => requestSubTabSwitch('full_settings')}
          className={`px-3 py-1.5 rounded-md text-xs font-black flex items-center gap-1.5 cursor-pointer ${
            subTab === 'full_settings' ? 'bg-[var(--gold)] text-[#03060A]' : 'bg-[#08121E] border border-[var(--border-strong)] text-white'
          }`}
        >
          <Database className="w-3.5 h-3.5" />
          <span>{isEn ? '6. Backup, SQL/CSV Import & Policies' : '6. النسخ الاحتياطي، استيراد SQL/CSV، والسياسات'}</span>
        </button>
        <button
          type="button"
          onClick={() => requestSubTabSwitch('control_center')}
          className={`px-3 py-1.5 rounded-md text-xs font-black flex items-center gap-1.5 cursor-pointer ${
            subTab === 'control_center' ? 'bg-[var(--gold)] text-[#03060A]' : 'bg-[#08121E] border border-[var(--border-strong)] text-white'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          <span>{isEn ? '7. Operational Control Center' : '7. مركز التحكم التشغيلي'}</span>
        </button>
        <button
          type="button"
          onClick={() => requestSubTabSwitch('integrity_approvals')}
          className={`px-3 py-1.5 rounded-md text-xs font-black flex items-center gap-1.5 cursor-pointer ${
            subTab === 'integrity_approvals' ? 'bg-[var(--gold)] text-[#03060A]' : 'bg-[#08121E] border border-[var(--border-strong)] text-white'
          }`}
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>{isEn ? '8. Integrity, Approvals & Closing' : '8. السلامة المالية، الموافقات والإقفال'}</span>
        </button>
        {isSuperAdmin && (
          <button
            type="button"
            onClick={() => {
              requestSubTabSwitch('platform_subscriptions');
              void loadPlatformOverview();
            }}
            className={`px-3 py-1.5 rounded-md text-xs font-black flex items-center gap-1.5 cursor-pointer ${
              subTab === 'platform_subscriptions'
                ? 'bg-[var(--gold)] text-[#03060A]'
                : 'bg-[#08121E] border border-amber-500/40 text-amber-300'
            }`}
          >
            <Landmark className="w-3.5 h-3.5" />
            <span>{isEn ? '9. Platform Subscriptions (Super Admin)' : '9. إدارة المنشآت والاشتراكات (Super Admin)'}</span>
          </button>
        )}
      </div>

      {/* 1. V20 Theme, Typography, Tabs Visibility & Print Banner */}
      {subTab === 'v20_customizer' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 text-xs">
          <div className="v20-card p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-[var(--border-strong)] pb-2">
              <h3 className="font-black text-sm text-[var(--gold)] flex items-center gap-1.5">
                <Sliders className="w-4 h-4" />
                <span>تخصيص الألوان وحجم الخط المباشر</span>
              </h3>
              <button
                type="button"
                onClick={() =>
                  updateUiPref({
                    fontSize: 14,
                    goldColor: '#f5c748',
                    cardColor: '#101e2e',
                  })
                }
                className="px-2.5 py-1 rounded bg-[#08121E] border border-[var(--border-strong)] text-slate-200 flex items-center gap-1 cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>استعادة الافتراضي</span>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-300 mb-1">اللون الذهبي الرئيسي (--gold):</label>
                <input
                  type="color"
                  value={uiPrefs.goldColor || '#f5c748'}
                  onChange={(e) => updateUiPref({ goldColor: e.target.value })}
                  className="w-full h-9 rounded border border-[var(--border-strong)] bg-[#050B12] cursor-pointer"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-300 mb-1">لون خلفية البطاقات (--bg-card):</label>
                <input
                  type="color"
                  value={uiPrefs.cardColor || '#101e2e'}
                  onChange={(e) => updateUiPref({ cardColor: e.target.value })}
                  className="w-full h-9 rounded border border-[var(--border-strong)] bg-[#050B12] cursor-pointer"
                />
              </div>
            </div>

            <div className="flex items-center justify-between bg-[#060D15] p-2.5 rounded-lg border border-[var(--border-strong)]">
              <span className="font-bold">حجم الخط العام ({uiPrefs.fontSize}px):</span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => updateUiPref({ fontSize: Math.max(11, uiPrefs.fontSize - 1) })}
                  className="px-3 py-1 rounded bg-[#08121E] border border-[var(--border-strong)] font-black cursor-pointer"
                >
                  A-
                </button>
                <button
                  type="button"
                  onClick={() => updateUiPref({ fontSize: Math.min(22, uiPrefs.fontSize + 1) })}
                  className="px-3 py-1 rounded bg-[#08121E] border border-[var(--border-strong)] font-black cursor-pointer"
                >
                  A+
                </button>
              </div>
            </div>

            {/* Interface Language & Direction Switcher */}
            <div className="bg-[#060D15] p-3 rounded-lg border border-[var(--border-strong)] space-y-2">
              <div className="font-black text-[var(--gold)] flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5" />
                <span>{t('languageLabel', lang)}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (onChangeLanguage) onChangeLanguage('ar');
                    else onUpdateSettings({ ...db.settings, language: 'ar' });
                  }}
                  className={`px-3 py-2 rounded-md border font-black text-xs cursor-pointer transition ${
                    lang === 'ar'
                      ? 'bg-[var(--gold)] text-[#03060A] border-[var(--gold)]'
                      : 'bg-[#08121E] text-slate-200 border-[var(--border-strong)]'
                  }`}
                >
                  {t('arabicOption', lang)}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (onChangeLanguage) onChangeLanguage('en');
                    else onUpdateSettings({ ...db.settings, language: 'en' });
                  }}
                  className={`px-3 py-2 rounded-md border font-black text-xs cursor-pointer transition ${
                    lang === 'en'
                      ? 'bg-[var(--gold)] text-[#03060A] border-[var(--gold)]'
                      : 'bg-[#08121E] text-slate-200 border-[var(--border-strong)]'
                  }`}
                >
                  {t('englishOption', lang)}
                </button>
              </div>
            </div>

            {/* Banner Upload for Printing */}
            <div className="bg-[#060D15] p-3 rounded-lg border border-[var(--border-strong)] space-y-2">
              <div className="font-black text-[var(--gold)]">
                {isEn ? 'Company Print / PDF Header Banner:' : 'صورة ترويسة الشركة في الطباعة والـ PDF:'}
              </div>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                disabled={!canManage}
                onChange={handleBannerUpload}
                className="text-xs text-slate-300 file:mr-2 file:py-1 file:px-3 file:rounded file:border-0 file:bg-[var(--gold)] file:text-[#03060A] file:font-black cursor-pointer disabled:opacity-50"
              />
              <label className="flex items-center gap-2 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  disabled={!canManage}
                  checked={Boolean(db.company.useFullBanner)}
                  onChange={(e) => {
                    if (!canManage) return;
                    onUpdateCompany({ ...db.company, useFullBanner: e.target.checked });
                  }}
                  className="w-4 h-4 accent-amber-400"
                />
                <span>
                  {isEn
                    ? 'Use full custom header banner image in preview & print instead of text'
                    : 'استخدام صورة الترويسة الكاملة بدلاً من النص الافتراضي عند المعاينة والطباعة'}
                </span>
              </label>
            </div>
          </div>

          {/* Horizontal Tabs Visibility Checklist */}
          <div className="v20-card p-4 space-y-2.5">
            <h3 className="font-black text-sm text-[var(--gold)] border-b border-[var(--border-strong)] pb-2">
              {isEn ? 'Top Navigation Tabs Visibility Control' : 'التحكم في إظهار وإخفاء التبويبات الرئيسية (الشريط العلوي)'}
            </h3>
            <div className="space-y-1.5">
              {tabsList.map((tab) => (
                <label
                  key={tab.id}
                  className="flex items-center justify-between bg-[#060D15] px-3 py-2 rounded-lg border border-[var(--border-strong)] cursor-pointer"
                >
                  <span className="font-bold text-white">{getTabLabel(tab.id, tab.label, lang)}</span>
                  <input
                    type="checkbox"
                    disabled={tab.id === 'tab-admin'}
                    checked={tab.visible}
                    onChange={() => {
                      const next = tabsList.map((tItem) =>
                        tItem.id === tab.id ? { ...tItem, visible: !tItem.visible } : tItem
                      );
                      updateUiPref({ tabsConfig: next });
                    }}
                    className="w-4 h-4 accent-amber-400 cursor-pointer"
                  />
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 2. Unified Print & PDF Template Designer */}
      {subTab === 'print_templates' && (
        <PrintTemplateDesigner
          company={db.company}
          branch={db.branches[0] || { id: 'br-1', companyId: db.company.id, code: 'BR-01', nameAr: 'الفرع الرئيسي', address: '', phone: '', managerName: 'المدير العام', isMain: true, status: 'active' }}
          settings={db.settings}
          canManageSettings={canManage}
          lang={lang}
          onSaveTemplates={async (map) => {
            if (onSavePrintTemplates) {
              return onSavePrintTemplates(map);
            }
            onUpdateSettings({
              ...db.settings,
              printTemplates: map,
              companyPrintTemplates: {
                ...(db.settings.companyPrintTemplates || {}),
                [db.company.id]: map,
              },
            });
            return { ok: true, backend: 'both', verified: true };
          }}
          onDirtyChange={setTemplateEditorDirty}
          onNotify={onNotify}
        />
      )}

      {/* 3. Document Books Overview + Modal */}
      {subTab === 'books' && (
        <div className="v20-card p-4 space-y-3 text-xs">
          <div className="flex items-center justify-between">
            <h3 className="font-black text-sm text-[var(--gold)]">دفاتر الفواتير والسندات وتسلسل الترقيم الآلي</h3>
            <button
              type="button"
              onClick={() => setIsBooksModalOpen(true)}
              className="px-4 py-2 rounded v20-btn-gold flex items-center gap-1.5 cursor-pointer"
            >
              <BookOpen className="w-4 h-4" />
              <span>فتح مدير الدفاتر الكامل</span>
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {(scopedDb.documentBooks || []).map((b) => (
              <div key={b.id} className="v20-card-alt p-3 space-y-1">
                <div className="flex justify-between items-center">
                  <span className="font-black text-white">{b.nameAr}</span>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-black ${
                      b.isActive ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
                    }`}
                  >
                    {b.isActive ? 'مفعل' : 'موقوف'}
                  </span>
                </div>
                <div className="text-slate-400 font-mono">
                  البادئة: <strong className="text-[var(--gold)]">{b.prefix}</strong> · الرقم القادم:{' '}
                  <strong>{b.prefix}{String(b.nextSequence).padStart(b.padLength, '0')}</strong>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3. Granular RBAC Matrix & Add User */}
      {subTab === 'rbac' && (
        <div className="v20-card p-4 space-y-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-strong)] pb-2.5">
            <h3 className="font-black text-sm text-[var(--gold)]">مصفوفة الصلاحيات التفصيلية للمستخدمين</h3>
            {canManage && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <input
                  type="text"
                  value={newFullName}
                  onChange={(e) => setNewFullName(e.target.value)}
                  placeholder="الاسم الكامل *"
                  className="v20-input px-2.5 py-1.5 w-40"
                />
                <input
                  type="text"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="اسم الدخول *"
                  className="v20-input px-2.5 py-1.5 w-28 font-mono"
                />
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="كلمة مرور (8+ أرقام وحروف) *"
                  className="v20-input px-2.5 py-1.5 w-44 font-mono"
                />
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as UserRoleType)}
                  className="v20-input px-2 py-1.5 cursor-pointer"
                >
                  <option value="محاسب">محاسب</option>
                  <option value="أمين الصندوق">أمين الصندوق</option>
                  <option value="مسؤول المبيعات">مسؤول المبيعات</option>
                  <option value="مسؤول المشتريات">مسؤول المشتريات</option>
                  <option value="مسؤول المخزون">مسؤول المخزون</option>
                  <option value="المدير المالي">المدير المالي</option>
                  <option value="Tenant Admin">مدير المنشأة (Tenant Admin)</option>
                  <option value="مستخدم محدود">مستخدم محدود</option>
                </select>
                <button
                  type="button"
                  onClick={async () => {
                    if (!newFullName.trim()) {
                      onNotify('error', 'أدخل اسم المستخدم الكامل.');
                      return;
                    }
                    const cleanUsername = newUsername.trim() || `user${db.users.length + 1}`;
                    if (db.users.some((u) => u.username.trim().toLowerCase() === cleanUsername.toLowerCase())) {
                      onNotify('error', 'اسم الدخول مستخدم مسبقاً لموظف آخر.');
                      return;
                    }
                    const strength = validatePasswordStrength(newPassword);
                    if (!strength.ok) {
                      onNotify('error', strength.error || 'يجب إدخال كلمة مرور قوية (8 أحرف: أحرف + أرقام).');
                      return;
                    }
                    const salt = generateSaltHex(16);
                    const hash = await hashPasswordAsync(newPassword, salt);
                    const activeCoId = db.activeCompanyId || db.company.id;
                    const isTenantAdminRole = newRole === 'Tenant Admin';
                    const newUser: User = {
                      id: `usr-${Date.now()}`,
                      username: cleanUsername,
                      fullName: newFullName.trim(),
                      role: newRole,
                      branchId: db.branches[0]?.id || 'br-01',
                      allowedCompanyIds: [activeCoId],
                      email: `${cleanUsername}@almansoor.erp`,
                      active: true,
                      passwordSalt: salt,
                      passwordHash: hash,
                      mustChangePassword: true,
                      canViewReports: true,
                      canPostEntries: newRole !== 'مستخدم محدود' && newRole !== 'مسؤول المبيعات',
                      canAdjustInventory: isTenantAdminRole || newRole === 'مسؤول المخزون' || newRole === 'المدير المالي',
                      canViewCostsAndProfits: isTenantAdminRole || newRole === 'المدير المالي' || newRole === 'مسؤول المخزون',
                      canManageSettings: isTenantAdminRole,
                      canEditInvoices: newRole !== 'مستخدم محدود',
                      canDeleteInvoices: isTenantAdminRole,
                      canEditVouchers: newRole !== 'مستخدم محدود',
                      canDeleteVouchers: isTenantAdminRole,
                      canEditExchangeRates: isTenantAdminRole,
                      permissionMatrix: buildUserRoleMatrix(newRole),
                    };
                    try {
                      await cloudApiService.saveCompanyUser({
                        id: newUser.id,
                        username: newUser.username,
                        fullName: newUser.fullName,
                        email: newUser.email,
                        role: newUser.role,
                        allowedCompanyIds: newUser.allowedCompanyIds,
                        branchId: newUser.branchId,
                        active: newUser.active,
                        password: newPassword,
                        mustChangePassword: true,
                        flags: {
                          canViewReports: newUser.canViewReports,
                          canPostEntries: newUser.canPostEntries,
                          canAdjustInventory: newUser.canAdjustInventory,
                          canViewCostsAndProfits: newUser.canViewCostsAndProfits,
                          canManageSettings: newUser.canManageSettings,
                          canEditInvoices: newUser.canEditInvoices,
                          canDeleteInvoices: newUser.canDeleteInvoices,
                          canEditVouchers: newUser.canEditVouchers,
                          canDeleteVouchers: newUser.canDeleteVouchers,
                          canEditExchangeRates: newUser.canEditExchangeRates,
                        },
                        permissionMatrix: newUser.permissionMatrix,
                      });
                    } catch (err: unknown) {
                      if (!(err instanceof TypeError)) {
                        onNotify('error', err instanceof Error ? err.message : 'فشل حفظ المستخدم على الخادم.');
                        return;
                      }
                    }

                    onAddUser(newUser);
                    setNewFullName('');
                    setNewUsername('');
                    setNewPassword('');
                    onNotify('success', 'تم إضافة المستخدم بكلمة مرور مشفرة (PBKDF2) وسيُطلب منه تغييرها عند أول دخول.');
                  }}
                  className="px-3 py-1.5 rounded v20-btn-gold flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>إضافة مستخدم</span>
                </button>
              </div>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs border-collapse">
              <thead className="bg-[#0B192C] text-[var(--gold)] border-b-2 border-[var(--gold)]">
                <tr>
                  <th className="p-2">المستخدم</th>
                  <th className="p-2">الدور</th>
                  <th className="p-2 text-center">الحالة</th>
                  <th className="p-2 text-center">التكلفة والربح</th>
                  <th className="p-2 text-center">الترحيل</th>
                  <th className="p-2 text-center">تعديل الفواتير</th>
                  <th className="p-2 text-center">حذف/عكس</th>
                  <th className="p-2 text-center">تعديل الصرف</th>
                  <th className="p-2 text-center">الإعدادات</th>
                  <th className="p-2 text-center">تعديل</th>
                </tr>
              </thead>
              <tbody>
                {filterDatabaseForUserTenants(db, currentUser).users.map((u) => {
                  const tenantUsers = filterDatabaseForUserTenants(db, currentUser).users;
                  const activeAdmins = tenantUsers.filter((usr) => usr.active && usr.canManageSettings);
                  const isLastActiveAdmin = u.active && u.canManageSettings && activeAdmins.length <= 1;
                  return (
                    <tr key={u.id} className="border-b border-[#1B2E44] hover:bg-amber-500/10">
                      <td className="p-2">
                        <div className="font-bold text-white">{u.fullName}</div>
                        <div className="text-[10px] font-mono text-slate-400">@{u.username}</div>
                      </td>
                      <td className="p-2 text-slate-300">{getRoleDisplayLabel(u.role, lang)}</td>
                      <td className="p-2 text-center">
                        <button
                          type="button"
                          disabled={!canManage || isLastActiveAdmin}
                          onClick={() =>
                            onUpdateUserPermissions({
                              ...u,
                              active: !u.active,
                            })
                          }
                          className={`px-2 py-0.5 rounded text-[10px] font-black border cursor-pointer disabled:opacity-50 ${
                            u.active
                              ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-300'
                              : 'bg-rose-950/60 border-rose-500/50 text-rose-300'
                          }`}
                          title={isLastActiveAdmin ? 'لا يمكن تعطيل آخر مدير نظام نشط' : 'تبديل حالة الحساب'}
                        >
                          {u.active ? 'نشط' : 'موقوف'}
                        </button>
                      </td>
                      {[
                        { k: 'canViewCostsAndProfits' as const, val: u.canViewCostsAndProfits },
                        { k: 'canPostEntries' as const, val: u.canPostEntries },
                        { k: 'canEditInvoices' as const, val: u.canEditInvoices ?? true },
                        { k: 'canDeleteInvoices' as const, val: u.canDeleteInvoices ?? u.canManageSettings },
                        { k: 'canEditExchangeRates' as const, val: u.canEditExchangeRates ?? u.canManageSettings },
                        { k: 'canManageSettings' as const, val: u.canManageSettings },
                      ].map((perm) => (
                        <td key={perm.k} className="p-2 text-center">
                          <input
                            type="checkbox"
                            disabled={!canManage || (perm.k === 'canManageSettings' && isLastActiveAdmin && u.canManageSettings)}
                            checked={Boolean(perm.val)}
                            onChange={() =>
                              onUpdateUserPermissions({
                                ...u,
                                [perm.k]: !perm.val,
                              })
                            }
                            className="w-4 h-4 accent-amber-400 cursor-pointer"
                          />
                        </td>
                      ))}
                      <td className="p-2 text-center">
                        <button
                          type="button"
                          disabled={!canManage}
                          onClick={() => {
                            setEditingUser({ ...u });
                            setEditUserPassword('');
                          }}
                          className="p-1 rounded bg-[#08121E] border border-[var(--border-strong)] hover:border-[var(--gold)] text-[var(--gold)] disabled:opacity-40 cursor-pointer"
                          title="تعديل بيانات المستخدم"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {editingUser && (
            <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!editingUser.fullName.trim()) {
                    onNotify('error', 'الاسم الكامل للمستخدم مطلوب.');
                    return;
                  }
                  let nextUser: User = {
                    ...editingUser,
                    fullName: editingUser.fullName.trim(),
                    username: editingUser.username.trim() || editingUser.username,
                    allowedCompanyIds: Array.isArray(editingUser.allowedCompanyIds)
                      ? editingUser.allowedCompanyIds
                      : [db.activeCompanyId || db.company.id],
                  };
                  if (editUserPassword.trim()) {
                    const strength = validatePasswordStrength(editUserPassword.trim());
                    if (!strength.ok) {
                      onNotify('error', strength.error || 'كلمة المرور ضعيفة.');
                      return;
                    }
                    const salt = generateSaltHex(16);
                    const hash = await hashPasswordAsync(editUserPassword.trim(), salt);
                    nextUser = {
                      ...nextUser,
                      passwordSalt: salt,
                      passwordHash: hash,
                      mustChangePassword: true,
                    };
                  }
                  try {
                    await cloudApiService.saveCompanyUser({
                      id: nextUser.id,
                      username: nextUser.username,
                      fullName: nextUser.fullName,
                      email: nextUser.email,
                      role: nextUser.role,
                      allowedCompanyIds: nextUser.allowedCompanyIds,
                      branchId: nextUser.branchId,
                      active: nextUser.active,
                      ...(editUserPassword.trim()
                        ? { password: editUserPassword.trim(), mustChangePassword: true }
                        : {}),
                      flags: {
                        canViewReports: nextUser.canViewReports,
                        canPostEntries: nextUser.canPostEntries,
                        canAdjustInventory: nextUser.canAdjustInventory,
                        canViewCostsAndProfits: nextUser.canViewCostsAndProfits,
                        canManageSettings: nextUser.canManageSettings,
                        canEditInvoices: nextUser.canEditInvoices,
                        canDeleteInvoices: nextUser.canDeleteInvoices,
                        canEditVouchers: nextUser.canEditVouchers,
                        canDeleteVouchers: nextUser.canDeleteVouchers,
                        canEditExchangeRates: nextUser.canEditExchangeRates,
                      },
                      permissionMatrix: nextUser.permissionMatrix,
                    });
                  } catch (err: unknown) {
                    if (!(err instanceof TypeError)) {
                      onNotify('error', err instanceof Error ? err.message : 'فشل تحديث المستخدم على الخادم.');
                      return;
                    }
                  }

                  onUpdateUserPermissions(nextUser);
                  setEditingUser(null);
                  setEditUserPassword('');
                  onNotify('success', 'تم تحديث بيانات المستخدم وكلمة المرور بأمان.');
                }}
                className="v20-card w-full max-w-md p-4 space-y-3 text-xs"
              >
                <div className="flex items-center justify-between border-b border-[var(--border-strong)] pb-2">
                  <h4 className="font-black text-sm text-[var(--gold)]">تعديل ملف المستخدم</h4>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingUser(null);
                      setEditUserPassword('');
                    }}
                    className="text-slate-400 hover:text-white cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="col-span-2">
                    <label className="block text-slate-300 font-bold mb-1">الاسم الكامل *</label>
                    <input
                      type="text"
                      required
                      value={editingUser.fullName}
                      onChange={(e) => setEditingUser({ ...editingUser, fullName: e.target.value })}
                      className="w-full v20-input px-2.5 py-1.5"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-300 font-bold mb-1">اسم الدخول</label>
                    <input
                      type="text"
                      value={editingUser.username}
                      onChange={(e) => setEditingUser({ ...editingUser, username: e.target.value })}
                      className="w-full v20-input px-2.5 py-1.5 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-300 font-bold mb-1">الدور الوظيفي</label>
                    <select
                      value={editingUser.role}
                      onChange={(e) => setEditingUser({ ...editingUser, role: e.target.value as UserRoleType })}
                      className="w-full v20-input px-2 py-1.5"
                    >
                      <option value="محاسب">محاسب</option>
                      <option value="أمين الصندوق">أمين الصندوق</option>
                      <option value="مسؤول المبيعات">مسؤول المبيعات</option>
                      <option value="مسؤول المشتريات">مسؤول المشتريات</option>
                      <option value="مسؤول المخزون">مسؤول المخزون</option>
                      <option value="المدير المالي">المدير المالي</option>
                      <option value="Tenant Admin">مدير المنشأة (Tenant Admin)</option>
                      <option value="مستخدم محدود">مستخدم محدود</option>
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-slate-300 font-bold mb-1">
                      تعيين / إعادة تعيين كلمة المرور (اختياري — 8+ أحرف وأرقام)
                    </label>
                    <input
                      type="password"
                      value={editUserPassword}
                      onChange={(e) => setEditUserPassword(e.target.value)}
                      placeholder="اتركه فارغاً للإبقاء على كلمة المرور الحالية"
                      className="w-full v20-input px-2.5 py-1.5 font-mono"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border-strong)]">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingUser(null);
                      setEditUserPassword('');
                    }}
                    className="px-3 py-1.5 rounded bg-[#08121E] border border-[var(--border-strong)] cursor-pointer"
                  >
                    إلغاء
                  </button>
                  <button type="submit" className="px-4 py-1.5 rounded v20-btn-gold cursor-pointer">
                    حفظ التعديل
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      )}

      {/* 4. Currencies & FX Editor (Custom + Built-in Currencies CRUD) */}
      {subTab === 'currencies' && (
        <div className="v20-card p-4 space-y-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-strong)] pb-2.5">
            <div>
              <h3 className="font-black text-sm text-[var(--gold)]">إدارة العملات وأسعار الصرف مقابل الأساس (YER)</h3>
              <p className="text-[11px] text-slate-400">يمكنك إضافة أي عملة عالمية أو خليجية (AED, OMR, KWD, EUR...) وتعديل رمزها ومعدل صرفها</p>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {[
                { code: 'SAR', name: 'ريال سعودي', sym: 'ر.س', rate: 142 },
                { code: 'USD', name: 'دولار أمريكي', sym: '$', rate: 535 },
                { code: 'AED', name: 'درهم إماراتي', sym: 'د.إ', rate: 145 },
                { code: 'OMR', name: 'ريال عماني', sym: 'ر.ع', rate: 1388 },
                { code: 'EUR', name: 'يورو أوروبي', sym: '€', rate: 580 },
              ].map((preset) => (
                <button
                  key={preset.code}
                  type="button"
                  onClick={() => {
                    setNewCurCode(preset.code);
                    setNewCurName(preset.name);
                    setNewCurSymbol(preset.sym);
                    setNewCurRate(preset.rate);
                  }}
                  className="px-2 py-1 rounded bg-[#08121E] border border-[var(--border-strong)] hover:border-[var(--gold)] text-[11px] font-mono text-amber-300 cursor-pointer"
                >
                  {preset.code}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-[#060D15] border border-[var(--border-strong)] rounded-lg p-3 flex flex-wrap items-end gap-2">
            <div>
              <label className="block text-[10px] text-slate-400 mb-1">رمز العملة (3 أحرف)</label>
              <input
                type="text"
                maxLength={5}
                value={newCurCode}
                onChange={(e) => setNewCurCode(e.target.value.toUpperCase())}
                placeholder="AED / USD"
                className="v20-input px-2.5 py-1.5 w-24 font-mono font-bold uppercase text-center"
              />
            </div>
            <div className="flex-1 min-w-[140px]">
              <label className="block text-[10px] text-slate-400 mb-1">اسم العملة بالعربي *</label>
              <input
                type="text"
                value={newCurName}
                onChange={(e) => setNewCurName(e.target.value)}
                placeholder="درهم إماراتي..."
                className="w-full v20-input px-2.5 py-1.5"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-400 mb-1">الرمز المختصر</label>
              <input
                type="text"
                maxLength={6}
                value={newCurSymbol}
                onChange={(e) => setNewCurSymbol(e.target.value)}
                placeholder="د.إ"
                className="v20-input px-2.5 py-1.5 w-20 text-center"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-400 mb-1">المنازل العشرية</label>
              <input
                type="number"
                min={0}
                max={4}
                value={newCurDecimals}
                onChange={(e) => setNewCurDecimals(Math.max(0, Math.min(4, Number(e.target.value) || 0)))}
                className="v20-input px-2.5 py-1.5 w-20 text-center tabular-nums"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-400 mb-1">سعر الصرف مقابل الأساس</label>
              <input
                type="number"
                min={0.01}
                step="0.01"
                value={newCurRate}
                onChange={(e) => setNewCurRate(parseFloat(e.target.value) || 1)}
                className="v20-input px-2.5 py-1.5 w-28 text-center font-bold tabular-nums"
              />
            </div>
            <button
              type="button"
              disabled={!canEditRates}
              onClick={() => {
                if (!canEditRates) {
                  onNotify('error', 'عذراً، لا تملك صلاحية تعديل العملات وأسعار الصرف.');
                  return;
                }
                const code = newCurCode.trim().toUpperCase();
                if (!code || code.length < 2) {
                  onNotify('error', 'أدخل رمز عملة صحيحاً (مثال USD أو AED).');
                  return;
                }
                if (!(newCurRate > 0)) {
                  onNotify('error', 'سعر الصرف يجب أن يكون أكبر من صفر.');
                  return;
                }
                const exists = db.currencies.some((c) => c.code === code);
                const next = exists
                  ? db.currencies.map((c) =>
                      c.code === code
                        ? {
                            ...c,
                            nameAr: newCurName.trim() || c.nameAr,
                            symbol: newCurSymbol.trim() || c.symbol,
                            decimalPlaces: newCurDecimals,
                            exchangeRate: c.isBase ? 1 : newCurRate,
                          }
                        : c
                    )
                  : [
                      ...db.currencies,
                      {
                        code,
                        nameAr: newCurName.trim() || code,
                        symbol: newCurSymbol.trim() || code,
                        exchangeRate: newCurRate,
                        isBase: false,
                        decimalPlaces: newCurDecimals,
                      },
                    ];
                onUpdateCurrencies(next);
                onNotify('success', `تم حفظ/تحديث العملة ${code} بسعر صرف ${newCurRate}.`);
              }}
              className="px-4 py-1.5 rounded v20-btn-gold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              حفظ / إضافة العملة
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {db.currencies.map((c) => {
              const isInUse =
                c.isBase ||
                scopedDb.treasuryAccounts.some((t) => t.currency === c.code) ||
                scopedDb.customers.some((cu) => cu.currency === c.code) ||
                scopedDb.vendors.some((v) => v.currency === c.code);
              return (
                <div key={c.code} className="v20-card-alt p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-black text-white">
                        {c.nameAr} ({c.code}) <span className="text-[var(--gold)] font-mono">[{c.symbol}]</span>
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {c.isBase
                          ? 'العملة الأساسية للنظام (ثابتة 1)'
                          : `1 ${c.code} = ${c.exchangeRate} ${db.company.baseCurrency || 'YER'} · ${c.decimalPlaces} خانات عشرية`}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={!canEditRates}
                        onClick={() => {
                          setNewCurCode(c.code);
                          setNewCurName(c.nameAr);
                          setNewCurSymbol(c.symbol);
                          setNewCurDecimals(c.decimalPlaces);
                          setNewCurRate(c.exchangeRate);
                        }}
                        className="p-1 rounded bg-[#08121E] border border-[var(--border-strong)] hover:border-[var(--gold)] text-[var(--gold)] cursor-pointer disabled:opacity-40"
                        title="تحميل للتعديل"
                      >
                        <Edit3 className="w-3 h-3" />
                      </button>
                      {!c.isBase && (
                        <button
                          type="button"
                          disabled={!canEditRates}
                          onClick={() => {
                            if (!canEditRates) {
                              onNotify('error', 'عذراً، لا تملك صلاحية حذف العملات.');
                              return;
                            }
                            if (isInUse) {
                              onNotify('error', `لا يمكن حذف العملة ${c.code} لوجود حسابات أو أطراف مرتبطة بها.`);
                              return;
                            }
                            onUpdateCurrencies(db.currencies.filter((x) => x.code !== c.code));
                            onNotify('info', `تم حذف العملة ${c.code}.`);
                          }}
                          className="p-1 rounded bg-[#08121E] border border-[var(--border-strong)] hover:border-rose-500 text-rose-400 cursor-pointer disabled:opacity-40"
                          title={isInUse ? 'عملة مرتبطة بحسابات' : 'حذف العملة'}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                  {!c.isBase && (
                    <div className="flex items-center justify-between gap-2 pt-1 border-t border-[var(--border-strong)]">
                      <span className="text-[11px] text-slate-400">تعديل الصرف المباشر:</span>
                      <input
                        type="number"
                        step="0.01"
                        min={0.01}
                        disabled={!(currentUser.canEditExchangeRates ?? canManage)}
                        value={c.exchangeRate}
                        onChange={(e) => {
                          const val = Math.max(0.01, parseFloat(e.target.value) || 1);
                          onUpdateCurrencies(
                            db.currencies.map((x) => (x.code === c.code ? { ...x, exchangeRate: val } : x))
                          );
                        }}
                        className="w-24 v20-input px-2 py-1 text-center font-black text-[var(--gold)] tabular-nums"
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 5. Full Institutional Settings, Backup, SQL/CSV Migration & Audit Logs */}
      {subTab === 'full_settings' && (
        <SettingsModule
          db={db}
          currentUser={currentUser}
          onUpdateCompany={onUpdateCompany}
          onUpdateSettings={onUpdateSettings}
          onSaveBranch={onSaveBranch}
          onSaveWarehouse={onSaveWarehouse}
          onSaveUnitOfMeasure={onSaveUnitOfMeasure}
          onUpdateCurrencies={onUpdateCurrencies}
          onUpdateUserPermissions={onUpdateUserPermissions}
          onResetDatabase={onResetDatabase}
          onRestoreDatabase={onRestoreDatabase}
          onUpdateDatabase={onUpdateDatabase}
          onNotify={onNotify}
        />
      )}

      {/* 7. Operational Control Center */}
      {subTab === 'control_center' && (
        <OperationalControlCenter
          settings={db.settings}
          currencies={db.currencies}
          currentUser={currentUser}
          onUpdateSettings={onUpdateSettings}
          onNotify={onNotify}
        />
      )}

      {/* 8. Financial Integrity Center, Approvals, Fiscal Closing & FX Revaluation */}
      {subTab === 'integrity_approvals' && (
        <GovernanceIntegrityPanel
          db={db}
          currentUser={currentUser}
          onUpdateDatabase={onUpdateDatabase || onRestoreDatabase}
          onNotify={onNotify}
        />
      )}

      {/* 9. Platform Subscriptions Management (Strictly Super Admin Only) */}
      {subTab === 'platform_subscriptions' && isSuperAdmin && (
        <div className="v20-card p-4 space-y-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-strong)] pb-2.5">
            <div>
              <h3 className="font-black text-sm text-[var(--gold)]">
                إدارة المنشآت وحالة الاشتراكات (مالك المنصة المركزي - Super Admin)
              </h3>
              <p className="text-[11px] text-slate-400">
                تفعيل أو إيقاف اشتراكات المنشآت في قاعدة بيانات PostgreSQL
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadPlatformOverview()}
              className="px-3 py-1.5 rounded bg-[#08121E] border border-[var(--border-strong)] hover:border-[var(--gold)] text-white font-bold cursor-pointer"
            >
              {platformLoading ? 'جاري التحديث...' : 'تحديث القائمة'}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs border-collapse">
              <thead className="bg-[#0B192C] text-[var(--gold)] border-b-2 border-[var(--gold)]">
                <tr>
                  <th className="p-2">المنشأة</th>
                  <th className="p-2">الدولة / العملة</th>
                  <th className="p-2 text-center">حالة المنشأة</th>
                  <th className="p-2 text-center">الإجراء</th>
                </tr>
              </thead>
              <tbody>
                {platformCompanies.map((comp) => {
                  const isActiveComp = comp.status === 'active';
                  return (
                    <tr key={comp.id} className="border-b border-[#1B2E44]">
                      <td className="p-2">
                        <div className="font-bold text-white">{comp.nameAr}</div>
                        <div className="text-[10px] font-mono text-slate-400">{comp.id}</div>
                      </td>
                      <td className="p-2 font-mono text-slate-300">
                        {comp.countryCode} · {comp.baseCurrency}
                      </td>
                      <td className="p-2 text-center">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-black border ${
                            isActiveComp
                              ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-300'
                              : 'bg-rose-950/60 border-rose-500/50 text-rose-300'
                          }`}
                        >
                          {isActiveComp ? 'نشطة (Active)' : `موقوفة (${comp.status})`}
                        </span>
                      </td>
                      <td className="p-2 text-center">
                        <button
                          type="button"
                          onClick={async () => {
                            const nextStatus = isActiveComp ? 'suspended' : 'active';
                            try {
                              await cloudApiService.updateCompanyStatus(comp.id, nextStatus);
                              onNotify(
                                'success',
                                `تم تحديث حالة اشتراك (${comp.nameAr}) إلى ${nextStatus}.`
                              );
                              await loadPlatformOverview();
                            } catch (err: unknown) {
                              onNotify(
                                'error',
                                err instanceof Error ? err.message : 'تعذر تغيير حالة الاشتراك.'
                              );
                            }
                          }}
                          className={`px-3 py-1 rounded text-[11px] font-black cursor-pointer ${
                            isActiveComp
                              ? 'bg-rose-900/60 hover:bg-rose-800 text-rose-200 border border-rose-500/40'
                              : 'bg-emerald-900/60 hover:bg-emerald-800 text-emerald-200 border border-emerald-500/40'
                          }`}
                        >
                          {isActiveComp ? 'إيقاف الاشتراك' : 'تفعيل الاشتراك'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {platformCompanies.length === 0 && (
                  <tr>
                    <td colSpan={4} className="p-4 text-center text-slate-400">
                      {platformLoading ? 'جاري تحميل بيانات المنشآت...' : 'لا توجد منشآت مسجلة في الخادم السحابي.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <DocumentBooksModal
        isOpen={isBooksModalOpen}
        books={scopedDb.documentBooks || []}
        onSaveBook={onSaveDocumentBook}
        onToggleBookActive={onToggleDocumentBook}
        onSetDefaultBook={onSetDefaultDocumentBook}
        onClose={() => setIsBooksModalOpen(false)}
        onNotify={onNotify}
      />

      <ConfirmModal
        isOpen={Boolean(pendingSubTab)}
        title="تغييرات غير محفوظة في محرر القوالب"
        variant="warning"
        message="لديك تعديلات غير محفوظة في مصمم قوالب الطباعة. إذا انتقلت الآن سيتم تجاهل تلك المسودة والعودة إلى آخر نسخة محفوظة. هل تريد المتابعة؟"
        confirmLabel="تجاهل التعديلات والانتقال"
        cancelLabel="البقاء وحفظ التغييرات"
        onConfirm={() => {
          const target = pendingSubTab;
          setPendingSubTab(null);
          setTemplateEditorDirty(false);
          if (target) setSubTab(target);
        }}
        onCancel={() => setPendingSubTab(null)}
      />
    </div>
  );
};
