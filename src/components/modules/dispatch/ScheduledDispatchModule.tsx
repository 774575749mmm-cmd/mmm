/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Scheduled Dispatch & WhatsApp Templates Center
 */

import React, { useState } from 'react';
import {
  Send,
  Clock,
  RotateCw,
  Settings,
  Users,
  CheckCircle2,
  MessageCircle,
  Info,
  Copy,
  ExternalLink,
} from 'lucide-react';
import { ERPDatabase } from '../../../services/storageService';
import { DispatchLogEntry, TableColumnPref, WhatsAppTemplates } from '../../../types/erp';
import { ErpDataTable, ErpTableColumn } from '../../common/ErpDataTable';
import { WhatsAppShareModal } from '../../common/WhatsAppShareModal';
import {
  validateWhatsAppPhone,
  renderWhatsAppTemplate,
  buildWhatsAppLink,
} from '../../../services/exportService';
import { convertToBase, getEffectiveCurrencyRate } from '../../../services/currencyHelpers';

interface ScheduledDispatchModuleProps {
  db: ERPDatabase;
  onUpdateSettings: (newSettings: any) => void;
  onAddDispatchLog: (log: DispatchLogEntry) => void;
  onRetryDispatch: (logId: string) => void;
  savedColumnPrefs?: TableColumnPref[];
  onSaveColumnPrefs?: (tableId: string, prefs: TableColumnPref[]) => void;
  onNotify?: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export const ScheduledDispatchModule: React.FC<ScheduledDispatchModuleProps> = ({
  db,
  onUpdateSettings,
  onAddDispatchLog,
  onRetryDispatch,
  savedColumnPrefs,
  onSaveColumnPrefs,
  onNotify,
}) => {
  const [scheduledHour, setScheduledHour] = useState(db.settings.scheduledDispatchHour || '18:00');
  const [autoDownload, setAutoDownload] = useState(db.settings.autoDownloadInvoices ?? true);
  const [enableWhatsApp, setEnableWhatsApp] = useState(db.settings.enableWhatsAppAPI ?? false);
  const [notificationPhone, setNotificationPhone] = useState(
    db.settings.notificationPhone || db.company.phone || '967770000000'
  );
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [waModalData, setWaModalData] = useState<{
    isOpen: boolean;
    recipientName: string;
    phone: string;
    message: string;
    templateKey: keyof WhatsAppTemplates;
    recipientType: 'management' | 'customer' | 'vendor';
  }>({
    isOpen: false,
    recipientName: '',
    phone: '',
    message: '',
    templateKey: 'dailySummary',
    recipientType: 'management',
  });

  const phoneValidation = validateWhatsAppPhone(notificationPhone);
  const logs = db.dispatchLogs || [];

  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneValidation.valid) {
      onNotify?.('error', phoneValidation.error || 'رقم واتساب الإدارة غير صالح');
      return;
    }
    onUpdateSettings({
      ...db.settings,
      scheduledDispatchHour: scheduledHour,
      autoDownloadInvoices: autoDownload,
      enableWhatsAppAPI: enableWhatsApp,
      notificationPhone: phoneValidation.normalized,
    });
    setNotificationPhone(phoneValidation.normalized);
    setSaveSuccess(true);
    onNotify?.('success', 'تم حفظ إعدادات الجدولة والواتساب بنجاح.');
    setTimeout(() => setSaveSuccess(false), 2500);
  };

  const buildDailyReportMsg = () => {
    const netSales = db.invoices
      .filter((i) => i.type === 'مبيعات' && i.status !== 'cancelled')
      .reduce((s, i) => s + convertToBase(i.grandTotal, i.currency, db.currencies, i.exchangeRate), 0);
    const totalLiquidity = db.treasuryAccounts.reduce((s, t) => {
      const rate = getEffectiveCurrencyRate(db.currencies, t.currency);
      return s + t.balance * rate;
    }, 0);

    const tpl =
      db.settings.whatsappTemplates?.dailySummary ||
      'تقرير الإدارة اليومي ({date})\nإجمالي المبيعات: {netSales} {currency}\nالسيولة المتوفرة: {liquidity} {currency}\n{company}';
    return renderWhatsAppTemplate(tpl, {
      date: new Date().toISOString().split('T')[0],
      netSales: netSales.toLocaleString(),
      liquidity: totalLiquidity.toLocaleString(),
      currency: db.company.baseCurrency || 'YER',
      company: db.company.nameAr,
    });
  };

  const handleOpenManagementDispatch = () => {
    setWaModalData({
      isOpen: true,
      recipientName: 'الإدارة العليا / المدير العام',
      phone: notificationPhone,
      message: buildDailyReportMsg(),
      templateKey: 'dailySummary',
      recipientType: 'management',
    });
  };

  const handleQueueCustomerBatch = () => {
    const activeCustomers = db.customers.filter((c) => c.currentBalance > 0);
    if (activeCustomers.length === 0) {
      onNotify?.('info', 'لا يوجد عملاء عليهم أرصدة مستحقة حالياً.');
      return;
    }

    const targets = activeCustomers.slice(0, 5);
    targets.forEach((cust, idx) => {
      const targetPhone = cust.whatsapp || cust.phone || '';
      const check = validateWhatsAppPhone(targetPhone);
      const tpl =
        db.settings.whatsappTemplates?.statement ||
        'مرحباً {name}، نود إشعاركم بأن رصيدكم الحالي لدى {company} هو: {balance} {currency}.';
      const rendered = renderWhatsAppTemplate(tpl, {
        name: cust.nameAr,
        company: db.company.nameAr,
        balance: cust.currentBalance.toLocaleString(),
        currency: db.company.baseCurrency || 'YER',
      });

      const log: DispatchLogEntry = {
        id: `disp-${Date.now()}-${idx}`,
        timestamp: new Date().toISOString(),
        recipientType: 'customer',
        recipientName: cust.nameAr,
        recipientPhone: check.valid ? check.normalized : targetPhone,
        channel: 'whatsapp',
        reportType: 'customer_eod_statement',
        status: check.valid ? 'pending' : 'failed',
        details: rendered,
        errorMessage: check.valid ? undefined : check.error,
        retryCount: 0,
      };
      onAddDispatchLog(log);
    });

    onNotify?.(
      'success',
      `تم تجهيز ${targets.length} كشوف عملاء في طابور الإرسال اليدوي بالجدول أدناه؛ انقر على زر واتساب بجانب أي صف للفتح.`
    );
  };

  const handleCopyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      onNotify?.('success', 'تم نسخ نص الرسالة.');
    } catch {
      onNotify?.('error', 'تعذر النسخ التلقائي.');
    }
  };

  const columns: ErpTableColumn<DispatchLogEntry>[] = [
    {
      key: 'timestamp',
      label: 'وقت التجهيز',
      sortValue: (l) => l.timestamp,
      render: (l) => (
        <span className="font-mono text-slate-400 text-[11px]">
          {new Date(l.timestamp).toLocaleString('ar-YE')}
        </span>
      ),
    },
    {
      key: 'recipientName',
      label: 'المستلم',
      render: (l) => <span className="font-bold text-white">{l.recipientName}</span>,
    },
    {
      key: 'recipientPhone',
      label: 'رقم الهاتف',
      render: (l) => <span className="font-mono text-slate-300">{l.recipientPhone}</span>,
    },
    {
      key: 'details',
      label: 'نص الرسالة / التفاصيل',
      render: (l) => <span className="text-slate-300 block max-w-xs truncate">{l.details}</span>,
    },
    {
      key: 'status',
      label: 'الحالة',
      align: 'center',
      render: (l) => (
        <span
          className={`px-2 py-0.5 rounded text-[11px] font-bold ${
            l.status === 'sent'
              ? 'bg-emerald-500/20 text-emerald-400'
              : l.status === 'pending'
              ? 'bg-amber-500/20 text-amber-300'
              : 'bg-rose-500/20 text-rose-400'
          }`}
        >
          {l.status === 'sent' ? 'تم الفتح / الإرسال' : l.status === 'pending' ? 'جاهز للإطلاق' : 'فشل'}
        </span>
      ),
    },
    {
      key: '_actions',
      label: 'الإجراء',
      sortable: false,
      align: 'center',
      render: (l) => {
        const phoneCheck = validateWhatsAppPhone(l.recipientPhone);
        const link = phoneCheck.valid ? buildWhatsAppLink(phoneCheck.normalized, l.details) : '';
        return (
          <div className="flex items-center justify-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => handleCopyText(l.details)}
              className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
              title="نسخ الرسالة"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
            {link && (
              <a
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => onRetryDispatch(l.id)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold"
              >
                <ExternalLink className="w-3 h-3" />
                <span>واتساب</span>
              </a>
            )}
            <button
              type="button"
              onClick={() => {
                onRetryDispatch(l.id);
                onNotify?.('info', 'تم تحديث حالة سجل الإرسال.');
              }}
              className="p-1.5 text-slate-400 hover:text-amber-400 hover:bg-slate-800 rounded"
              title="تحديث الحالة"
            >
              <RotateCw className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      },
    },
  ];

  const hasCloudRelay = Boolean(
    db.settings.enableWhatsAppAPI && db.settings.whatsappApiEndpoint && db.settings.whatsappApiToken
  );

  return (
    <div className="space-y-5" dir="rtl">
      {/* Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl">
            <Clock className="w-5 h-5" />
          </span>
          <div>
            <h2 className="text-lg font-black text-white">مركز الإرسال والرسائل الجاهزة عبر واتساب</h2>
            <p className="text-xs text-slate-400">
              إعداد قوالب رسائل الإدارة وكشوف العملاء مع سجل تدقيق وحفظ تفضيلات التنزيل التلقائي للفواتير
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleOpenManagementDispatch}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl"
          >
            <Send className="w-4 h-4" />
            <span>معاينة وإرسال تقرير الإدارة</span>
          </button>
          <button
            type="button"
            onClick={handleQueueCustomerBatch}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-xl"
          >
            <Users className="w-4 h-4" />
            <span>تجهيز كشوف العملاء المدينين</span>
          </button>
        </div>
      </div>

      {/* Honest Mode Disclosure Banner */}
      <div className="bg-slate-900/80 border border-amber-500/30 rounded-xl p-3.5 flex items-start gap-2.5 text-xs text-slate-300">
        <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <div>
          {hasCloudRelay ? (
            <span>تم تكوين بيانات ربط WhatsApp Cloud API. الإطلاق من المتصفح يفتح رابط <code className="text-amber-300">wa.me</code> أو يستخدم نقطة الاتصال المحددة عند التفعيل السحابي.</span>
          ) : (
            <span>
              <strong>آلية الإرسال الحالية (إطلاق يدوي آمن عبر المتصفح):</strong> لا يوجد وسيط إرسال سحابي نشط في الخلفية؛ يقوم النظام بتجهيز الرسالة وتنسيق رقم الهاتف الدولي لتتمكن من إرسالها بضغطة واحدة عبر تطبيق واتساب أو <code className="text-amber-300">wa.me</code> وتوثيقها في سجل التدقيق.
            </span>
          )}
        </div>
      </div>

      {/* Schedule & Settings Form */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
        <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
          <Settings className="w-4 h-4 text-amber-400" />
          <span>إعدادات الإشعارات والتنزيل التلقائي</span>
        </h3>

        <form onSubmit={handleSaveSettings} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
          <div>
            <label className="text-slate-300 font-semibold block mb-1">ساعة التذكير اليومي للإغلاق</label>
            <input
              type="time"
              value={scheduledHour}
              onChange={(e) => setScheduledHour(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono focus:border-amber-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="text-slate-300 font-semibold block mb-1">رقم واتساب الإدارة المعتمد</label>
            <input
              type="text"
              dir="ltr"
              value={notificationPhone}
              onChange={(e) => setNotificationPhone(e.target.value)}
              placeholder="967770000000"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono focus:border-amber-500 focus:outline-none"
            />
            {!phoneValidation.valid && (
              <span className="text-[11px] text-rose-400 block mt-1">{phoneValidation.error}</span>
            )}
          </div>

          <div className="flex flex-col justify-center space-y-2">
            <label className="flex items-center gap-2 text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={autoDownload}
                onChange={(e) => setAutoDownload(e.target.checked)}
                className="rounded border-slate-700 accent-amber-500 w-4 h-4"
              />
              <span className="font-bold">تنزيل PDF تلقائي فور ترحيل الفاتورة</span>
            </label>
            <label className="flex items-center gap-2 text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={enableWhatsApp}
                onChange={(e) => setEnableWhatsApp(e.target.checked)}
                className="rounded border-slate-700 accent-amber-500 w-4 h-4"
              />
              <span>إظهار اختصارات واتساب الفورية</span>
            </label>
          </div>

          <div className="flex items-end">
            <button
              type="submit"
              className="w-full py-2.5 px-4 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl transition-colors flex items-center justify-center gap-1.5"
            >
              {saveSuccess ? <CheckCircle2 className="w-4 h-4" /> : <MessageCircle className="w-4 h-4" />}
              <span>{saveSuccess ? 'تم الحفظ' : 'حفظ الإعدادات'}</span>
            </button>
          </div>
        </form>
      </div>

      {/* Dispatch Audit Logs DataTable */}
      <ErpDataTable
        tableId="dispatch-logs"
        title="سجل تجهيز وإرسال الرسائل"
        data={logs}
        columns={columns}
        getRowId={(l) => l.id}
        searchPlaceholder="بحث باسم المستلم أو رقم الهاتف أو نص الرسالة..."
        savedColumnPrefs={savedColumnPrefs}
        onSaveColumnPrefs={onSaveColumnPrefs}
      />

      <WhatsAppShareModal
        isOpen={waModalData.isOpen}
        onClose={() => setWaModalData((p) => ({ ...p, isOpen: false }))}
        title="معاينة وإرسال رسالة واتساب"
        recipientName={waModalData.recipientName}
        defaultPhone={waModalData.phone}
        defaultTemplateKey={waModalData.templateKey}
        templates={db.settings.whatsappTemplates}
        defaultMessage={waModalData.message}
        onDispatched={({ phone, message }) => {
          onAddDispatchLog({
            id: `disp-${Date.now()}`,
            timestamp: new Date().toISOString(),
            recipientType: waModalData.recipientType,
            recipientName: waModalData.recipientName,
            recipientPhone: phone,
            channel: 'whatsapp',
            reportType: 'daily_management',
            status: 'sent',
            details: message,
            retryCount: 0,
          });
          onNotify?.('success', 'تم تسجيل عملية الإرسال في السجل.');
        }}
      />
    </div>
  );
};
