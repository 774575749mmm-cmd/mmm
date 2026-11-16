/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Operational Control Center (Dynamic Modules, Policies, Fields, Statuses & Shortcuts)
 */

import React, { useState } from 'react';
import {
  Sliders,
  ToggleLeft,
  Shield,
  Coins,
  CreditCard,
  Keyboard,
  ListChecks,
  RotateCcw,
  Plus,
  Trash2,
  Save,
  Tag,
} from 'lucide-react';
import {
  OperationalControlConfig,
  SystemSettings,
  Currency,
  User,
  ScreenFieldRule,
  DocumentStatusConfig,
} from '../../../types/erp';
import { getDefaultOperationalControl } from '../../../services/storageService';

interface OperationalControlCenterProps {
  settings: SystemSettings;
  currencies: Currency[];
  currentUser: User;
  onUpdateSettings: (settings: SystemSettings) => void;
  onNotify: (type: 'success' | 'error' | 'info', msg: string) => void;
}

const MODULE_ITEMS: { key: keyof OperationalControlConfig['enabledModules']; labelAr: string; descAr: string }[] = [
  { key: 'sales', labelAr: 'وحدة المبيعات والفواتير', descAr: 'فواتير المبيعات، المرتجعات، وعروض الأسعار' },
  { key: 'purchases', labelAr: 'وحدة المشتريات والموردين', descAr: 'فواتير المشتريات وأوامر التوريد' },
  { key: 'vouchers', labelAr: 'السندات والخزينة والبنوك', descAr: 'سندات القبض والصرف والتحويلات النقدية والتسوية البنكية' },
  { key: 'accounting', labelAr: 'المحاسبة والقيود والدفاتر', descAr: 'القيود المزدوجة، الشجرة، والأستاذ العام' },
  { key: 'inventory', labelAr: 'المخزون والمستودعات والجرد', descAr: 'أرصدة المستودعات، FIFO، الباتشات والجرد' },
  { key: 'parties', labelAr: 'العملاء والموردون والمناطق', descAr: 'بطاقات الأطراف والائتمان وكشوف الحساب' },
  { key: 'reports', labelAr: 'التقارير ومصمم التقارير المرئي', descAr: 'التقرير الشامل، 22 مؤشراً، ومصمم السحب والإفلات' },
  { key: 'hrPayroll', labelAr: 'الموارد البشرية والرواتب', descAr: 'ملفات الموظفين ومسيرات الرواتب والاستقطاعات' },
  { key: 'fixedAssets', labelAr: 'الأصول الثابتة والإهلاك', descAr: 'الأصول، القسط الثابت، والاستبعاد المحاسبي' },
  { key: 'pos', labelAr: 'نقاط البيع السريعة (POS)', descAr: 'الورديات، تعليق السلال، والدفع المتعدد' },
  { key: 'distribution', labelAr: 'المندوبون والتوزيع والعمولات', descAr: 'خطوط السير ومبيعات وعمولات المندوبين' },
  { key: 'aiAdvisor', labelAr: 'المستشار المالي الذكي', descAr: 'لوحة التنبيهات والتحليلات الإدارية' },
];

const BUILTIN_REPORTS: { id: string; labelAr: string }[] = [
  { id: 'v20_comp', labelAr: 'التقرير الشامل للإدارة' },
  { id: 'statement', labelAr: 'كشف حساب عميل / مورد' },
  { id: 'daily_customers', labelAr: 'حركة العملاء اليومية' },
  { id: 'hub_22', labelAr: 'مركز التقارير (22 تقريراً)' },
  { id: 'daily_22', labelAr: 'التقرير الإداري اليومي' },
  { id: 'visual_designer', labelAr: 'مصمم التقارير المرئي (Drag & Drop)' },
  { id: 'smart_ai', labelAr: 'المستشار الذكي' },
];

export const OperationalControlCenter: React.FC<OperationalControlCenterProps> = ({
  settings,
  currencies,
  currentUser,
  onUpdateSettings,
  onNotify,
}) => {
  const canManage = currentUser.canManageSettings;
  const [draft, setDraft] = useState<OperationalControlConfig>(() => ({
    ...getDefaultOperationalControl(),
    ...(settings.operationalControl || {}),
    enabledModules: {
      ...getDefaultOperationalControl().enabledModules,
      ...(settings.operationalControl?.enabledModules || {}),
    },
    screenFieldRules: {
      ...getDefaultOperationalControl().screenFieldRules,
      ...(settings.operationalControl?.screenFieldRules || {}),
    },
  }));

  const [newStatusLabel, setNewStatusLabel] = useState('');
  const [newStatusColor, setNewStatusColor] = useState('#10b981');
  const [selectedScreenKey, setSelectedScreenKey] = useState<string>('sales_invoice');

  const paymentMethods = settings.paymentMethods || ['نقداً', 'شيك', 'تحويل_بنكي', 'دفع_إلكتروني'];

  const handleSave = () => {
    if (!canManage) {
      onNotify('error', 'لا تملك صلاحية تعديل مركز التحكم التشغيلي.');
      return;
    }
    onUpdateSettings({
      ...settings,
      operationalControl: draft,
    });
    onNotify('success', 'تم حفظ إعدادات مركز التحكم التشغيلي وتطبيقها فوراً على النظام.');
  };

  const handleResetDefaults = () => {
    if (!canManage) return;
    const def = getDefaultOperationalControl();
    setDraft(def);
    onUpdateSettings({
      ...settings,
      operationalControl: def,
    });
    onNotify('info', 'تمت استعادة الإعدادات الافتراضية لمركز التحكم التشغيلي.');
  };

  const toggleDisabledItem = (listKey: 'disabledReportIds' | 'disabledPaymentMethods' | 'disabledCurrencies', val: string) => {
    setDraft((prev) => {
      const list = prev[listKey] || [];
      const next = list.includes(val) ? list.filter((x) => x !== val) : [...list, val];
      return { ...prev, [listKey]: next };
    });
  };

  const updateFieldRule = (screenKey: string, fieldKey: string, patch: Partial<ScreenFieldRule>) => {
    setDraft((prev) => {
      const current = prev.screenFieldRules?.[screenKey] || [];
      return {
        ...prev,
        screenFieldRules: {
          ...prev.screenFieldRules,
          [screenKey]: current.map((f) => (f.fieldKey === fieldKey ? { ...f, ...patch } : f)),
        },
      };
    });
  };

  const addCustomStatus = () => {
    const clean = newStatusLabel.trim();
    if (!clean) return;
    const newItem: DocumentStatusConfig = {
      id: `st-${Date.now()}`,
      labelAr: clean,
      colorHex: newStatusColor,
      isActive: true,
    };
    setDraft((prev) => ({
      ...prev,
      customDocumentStatuses: [...(prev.customDocumentStatuses || []), newItem],
    }));
    setNewStatusLabel('');
  };

  return (
    <div className="space-y-4 text-xs" dir="rtl">
      {/* Header Bar */}
      <div className="v20-card p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-black text-sm text-[var(--gold)] flex items-center gap-2">
            <Sliders className="w-4 h-4" />
            <span>مركز التحكم التشغيلي (Operational Control Center)</span>
          </h3>
          <p className="text-[11px] text-slate-400 mt-0.5">
            تفعيل/تعطيل الوحدات، فرض قيود الائتمان والفترات المالية، تخصيص حقول الشاشات، الحالات المخصصة، واختصارات لوحة المفاتيح
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!canManage}
            onClick={handleResetDefaults}
            className="px-3 py-1.5 rounded-lg bg-[#08121E] border border-[var(--border-strong)] hover:border-amber-400 text-slate-200 font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>استعادة الافتراضي</span>
          </button>
          <button
            type="button"
            disabled={!canManage}
            onClick={handleSave}
            className="px-4 py-1.5 rounded-lg v20-btn-gold font-black flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            <span>حفظ وتطبيق الضوابط</span>
          </button>
        </div>
      </div>

      {/* 1. Core Financial & Security Policy Toggles */}
      <div className="v20-card p-4 space-y-3">
        <h4 className="font-black text-sm text-white flex items-center gap-2 border-b border-[var(--border-strong)] pb-2">
          <Shield className="w-4 h-4 text-[var(--gold)]" />
          <span>ضوابط الرقابة المالية والأمنية الصارمة</span>
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {[
            {
              key: 'enforceCreditLimitBlock' as const,
              title: 'منع ترحيل المبيعات عند تجاوز الحد الائتماني',
              desc: 'يرفض الفاتورة الآجلة تلقائياً إذا تجاوز الرصيد الجديد حد ائتمان العميل',
            },
            {
              key: 'enforceClosedFiscalPeriodBlock' as const,
              title: 'قفل الترحيل في الفترات المالية المغلقة',
              desc: 'يمنع تسجيل أي فاتورة أو سند أو قيد بتاريخ يقع في سنة مالية مقفلة',
            },
            {
              key: 'enableApprovalWorkflows' as const,
              title: 'تفعيل محرك دورة الاعتماد متعدد المستويات',
              desc: 'تحويل المستندات الكبيرة لصندوق الموافقات قبل التنفيذ الفعلي',
            },
            {
              key: 'enableFxRevaluation' as const,
              title: 'تفعيل إعادة تقييم العملات الأجنبية',
              desc: 'السماح بتوليد قيود فروق العملة الدورية للصناديق والبنوك',
            },
            {
              key: 'productionSecurityMode' as const,
              title: 'وضع الإنتاج الأمني (إخفاء كلمات المرور التجريبية)',
              desc: 'إخفاء أي بيانات تجريبية أو أزرار دخول سريعة في معالج التشغيل',
            },
          ].map((policy) => (
            <label
              key={policy.key}
              className="bg-[#060D15] border border-[var(--border-strong)] rounded-xl p-3 flex items-start justify-between gap-2 cursor-pointer hover:border-[var(--gold)]/60"
            >
              <div>
                <div className="font-bold text-white">{policy.title}</div>
                <div className="text-[11px] text-slate-400 mt-0.5">{policy.desc}</div>
              </div>
              <input
                type="checkbox"
                disabled={!canManage}
                checked={Boolean(draft[policy.key])}
                onChange={(e) => setDraft((prev) => ({ ...prev, [policy.key]: e.target.checked }))}
                className="w-4 h-4 accent-amber-400 mt-0.5 shrink-0 cursor-pointer"
              />
            </label>
          ))}
        </div>
      </div>

      {/* 2. Modules Visibility & Activation Grid */}
      <div className="v20-card p-4 space-y-3">
        <h4 className="font-black text-sm text-white flex items-center gap-2 border-b border-[var(--border-strong)] pb-2">
          <ToggleLeft className="w-4 h-4 text-[var(--gold)]" />
          <span>تفعيل وتعطيل وحدات النظام (Dynamic Modules)</span>
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {MODULE_ITEMS.map((m) => {
            const active = Boolean(draft.enabledModules[m.key]);
            return (
              <label
                key={m.key}
                className={`p-2.5 rounded-lg border flex items-center justify-between gap-2 cursor-pointer transition ${
                  active
                    ? 'bg-emerald-950/20 border-emerald-500/40'
                    : 'bg-[#060D15] border-slate-800 opacity-70'
                }`}
              >
                <div>
                  <div className="font-bold text-white">{m.labelAr}</div>
                  <div className="text-[10px] text-slate-400">{m.descAr}</div>
                </div>
                <input
                  type="checkbox"
                  disabled={!canManage}
                  checked={active}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      enabledModules: { ...prev.enabledModules, [m.key]: e.target.checked },
                    }))
                  }
                  className="w-4 h-4 accent-amber-400 cursor-pointer"
                />
              </label>
            );
          })}
        </div>
      </div>

      {/* 3. Reports, Payment Methods & Currencies Toggles */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="v20-card p-4 space-y-2.5">
          <h4 className="font-black text-white flex items-center gap-1.5 border-b border-[var(--border-strong)] pb-2">
            <ListChecks className="w-4 h-4 text-[var(--gold)]" />
            <span>التقارير المفعلة في المركز</span>
          </h4>
          <div className="space-y-1.5">
            {BUILTIN_REPORTS.map((r) => {
              const enabled = !(draft.disabledReportIds || []).includes(r.id);
              return (
                <label
                  key={r.id}
                  className="flex items-center justify-between bg-[#060D15] px-2.5 py-1.5 rounded border border-[var(--border-strong)] cursor-pointer"
                >
                  <span className="text-slate-200 font-bold">{r.labelAr}</span>
                  <input
                    type="checkbox"
                    disabled={!canManage}
                    checked={enabled}
                    onChange={() => toggleDisabledItem('disabledReportIds', r.id)}
                    className="w-4 h-4 accent-amber-400"
                  />
                </label>
              );
            })}
          </div>
        </div>

        <div className="v20-card p-4 space-y-2.5">
          <h4 className="font-black text-white flex items-center gap-1.5 border-b border-[var(--border-strong)] pb-2">
            <CreditCard className="w-4 h-4 text-[var(--gold)]" />
            <span>طرق الدفع النشطة</span>
          </h4>
          <div className="space-y-1.5">
            {paymentMethods.map((pm) => {
              const enabled = !(draft.disabledPaymentMethods || []).includes(pm);
              return (
                <label
                  key={pm}
                  className="flex items-center justify-between bg-[#060D15] px-2.5 py-1.5 rounded border border-[var(--border-strong)] cursor-pointer"
                >
                  <span className="text-slate-200 font-bold">{pm}</span>
                  <input
                    type="checkbox"
                    disabled={!canManage}
                    checked={enabled}
                    onChange={() => toggleDisabledItem('disabledPaymentMethods', pm)}
                    className="w-4 h-4 accent-amber-400"
                  />
                </label>
              );
            })}
          </div>
        </div>

        <div className="v20-card p-4 space-y-2.5">
          <h4 className="font-black text-white flex items-center gap-1.5 border-b border-[var(--border-strong)] pb-2">
            <Coins className="w-4 h-4 text-[var(--gold)]" />
            <span>العملات المتاحة بالمعاملات</span>
          </h4>
          <div className="space-y-1.5">
            {currencies.map((cur) => {
              const enabled = !(draft.disabledCurrencies || []).includes(cur.code);
              return (
                <label
                  key={cur.code}
                  className="flex items-center justify-between bg-[#060D15] px-2.5 py-1.5 rounded border border-[var(--border-strong)] cursor-pointer"
                >
                  <span className="text-slate-200 font-bold">
                    {cur.nameAr} ({cur.code})
                  </span>
                  <input
                    type="checkbox"
                    disabled={!canManage || cur.isBase}
                    checked={cur.isBase || enabled}
                    onChange={() => toggleDisabledItem('disabledCurrencies', cur.code)}
                    className="w-4 h-4 accent-amber-400"
                  />
                </label>
              );
            })}
          </div>
        </div>
      </div>

      {/* 4. Screen Field Rules, Custom Document Statuses & Keyboard Shortcuts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Field Visibility & Requiredness */}
        <div className="v20-card p-4 space-y-2.5">
          <div className="flex items-center justify-between border-b border-[var(--border-strong)] pb-2">
            <h4 className="font-black text-white">حقول الشاشات (إظهار / إلزامي)</h4>
            <select
              value={selectedScreenKey}
              onChange={(e) => setSelectedScreenKey(e.target.value)}
              className="v20-input px-2 py-1 text-[11px]"
            >
              <option value="sales_invoice">فاتورة المبيعات</option>
              <option value="purchase_invoice">فاتورة المشتريات</option>
              <option value="voucher">السندات المالية</option>
            </select>
          </div>
          <div className="space-y-1.5">
            {(draft.screenFieldRules?.[selectedScreenKey] || []).map((fr) => (
              <div
                key={fr.fieldKey}
                className="flex items-center justify-between bg-[#060D15] px-2.5 py-1.5 rounded border border-[var(--border-strong)]"
              >
                <span className="font-bold text-slate-200">{fr.labelAr}</span>
                <div className="flex items-center gap-3 text-[11px]">
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      disabled={!canManage}
                      checked={fr.visible}
                      onChange={(e) => updateFieldRule(selectedScreenKey, fr.fieldKey, { visible: e.target.checked })}
                      className="accent-amber-400"
                    />
                    <span>ظاهر</span>
                  </label>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      disabled={!canManage || !fr.visible}
                      checked={fr.required}
                      onChange={(e) => updateFieldRule(selectedScreenKey, fr.fieldKey, { required: e.target.checked })}
                      className="accent-rose-400"
                    />
                    <span>إلزامي</span>
                  </label>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Custom Document Statuses */}
        <div className="v20-card p-4 space-y-2.5">
          <h4 className="font-black text-white flex items-center gap-1.5 border-b border-[var(--border-strong)] pb-2">
            <Tag className="w-4 h-4 text-[var(--gold)]" />
            <span>حالات المستندات المخصصة</span>
          </h4>
          <div className="space-y-1.5 max-h-44 overflow-y-auto">
            {(draft.customDocumentStatuses || []).map((st) => (
              <div
                key={st.id}
                className="flex items-center justify-between bg-[#060D15] px-2.5 py-1.5 rounded border border-[var(--border-strong)]"
              >
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full" style={{ backgroundColor: st.colorHex }} />
                  <span className="font-bold text-slate-200">{st.labelAr}</span>
                </div>
                {!st.isDefault && canManage && (
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((prev) => ({
                        ...prev,
                        customDocumentStatuses: (prev.customDocumentStatuses || []).filter((x) => x.id !== st.id),
                      }))
                    }
                    className="text-rose-400 hover:text-rose-300 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
          {canManage && (
            <div className="flex items-center gap-1.5 pt-1">
              <input
                type="color"
                value={newStatusColor}
                onChange={(e) => setNewStatusColor(e.target.value)}
                className="w-8 h-8 rounded bg-[#050B12] border border-[var(--border-strong)] cursor-pointer"
              />
              <input
                type="text"
                value={newStatusLabel}
                onChange={(e) => setNewStatusLabel(e.target.value)}
                placeholder="اسم الحالة (مثال: بانتظار الشحن)"
                className="flex-1 v20-input px-2 py-1.5"
              />
              <button
                type="button"
                onClick={addCustomStatus}
                className="px-2.5 py-1.5 rounded v20-btn-gold font-black cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Keyboard Shortcuts */}
        <div className="v20-card p-4 space-y-2.5">
          <h4 className="font-black text-white flex items-center gap-1.5 border-b border-[var(--border-strong)] pb-2">
            <Keyboard className="w-4 h-4 text-[var(--gold)]" />
            <span>اختصارات التنقل السريع</span>
          </h4>
          <div className="space-y-1.5">
            {(draft.shortcuts || []).map((sc) => (
              <label
                key={sc.id}
                className="flex items-center justify-between bg-[#060D15] px-2.5 py-1.5 rounded border border-[var(--border-strong)] cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <span className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 font-mono text-[10px] text-amber-300">
                    {sc.keys}
                  </span>
                  <span className="font-bold text-slate-200">{sc.actionLabelAr}</span>
                </div>
                <input
                  type="checkbox"
                  disabled={!canManage}
                  checked={sc.enabled}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      shortcuts: (prev.shortcuts || []).map((x) =>
                        x.id === sc.id ? { ...x, enabled: e.target.checked } : x
                      ),
                    }))
                  }
                  className="w-4 h-4 accent-amber-400"
                />
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
