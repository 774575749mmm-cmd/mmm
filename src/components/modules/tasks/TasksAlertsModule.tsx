/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Tasks, Alerts & WhatsApp Communication Module
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
  BellRing,
  Plus,
  CheckCircle,
  MessageCircle,
  ExternalLink,
  X,
  Copy,
  Check,
  AlertCircle,
} from 'lucide-react';
import {
  TaskAlert,
  Customer,
  Vendor,
  WhatsAppTemplates,
} from '../../../types/erp';
import {
  validateWhatsAppPhone,
  renderWhatsAppTemplate,
  buildWhatsAppLink,
} from '../../../services/exportService';

interface TasksAlertsModuleProps {
  taskAlerts: TaskAlert[];
  customers: Customer[];
  vendors: Vendor[];
  currencySymbol: string;
  companyName?: string;
  whatsappTemplates?: WhatsAppTemplates;
  onAddTask: (task: TaskAlert) => void;
  onToggleTaskComplete: (taskId: string) => void;
  onNavigateToRecord?: (module: string, recordId?: string) => void;
  onNotify?: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export const TasksAlertsModule: React.FC<TasksAlertsModuleProps> = ({
  taskAlerts,
  customers,
  vendors,
  currencySymbol,
  companyName = 'مجموعة المنصور المالية والإدارية',
  whatsappTemplates,
  onAddTask,
  onToggleTaskComplete,
  onNavigateToRecord,
  onNotify,
}) => {
  const [activeTab, setActiveTab] = useState<'alerts' | 'whatsapp'>('alerts');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'completed'>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);

  // New Task Form
  const [taskTitle, setTaskTitle] = useState('');
  const [taskSeverity, setTaskSeverity] = useState<TaskAlert['severity']>('medium');
  const [assignedTo, setAssignedTo] = useState('عصام الشرعبي');
  const [dueDate, setDueDate] = useState('');

  // WhatsApp Composer
  const [waTargetType, setWaTargetType] = useState<'customer' | 'vendor'>('customer');
  const [waSelectedEntityId, setWaSelectedEntityId] = useState(customers[0]?.id || '');
  const [waTemplate, setWaTemplate] = useState<'debt' | 'greeting' | 'statement' | 'custom'>('debt');
  const [waPhoneInput, setWaPhoneInput] = useState('');
  const [waComposedText, setWaComposedText] = useState('');
  const [copied, setCopied] = useState(false);

  const selectedEntity = useMemo(() => {
    if (waTargetType === 'customer') {
      return customers.find((item) => item.id === waSelectedEntityId);
    }
    return vendors.find((item) => item.id === waSelectedEntityId);
  }, [waTargetType, waSelectedEntityId, customers, vendors]);

  useEffect(() => {
    if (!selectedEntity) return;
    setWaPhoneInput(selectedEntity.whatsapp || selectedEntity.phone || '');
    const balStr = Math.abs(selectedEntity.currentBalance).toLocaleString();
    if (waTemplate === 'debt') {
      const tpl = whatsappTemplates?.overdueReminder;
      if (tpl) {
        setWaComposedText(
          renderWhatsAppTemplate(tpl, {
            name: selectedEntity.nameAr,
            balance: balStr,
            currency: currencySymbol,
            company: companyName,
          })
        );
      } else {
        setWaComposedText(
          `السلام عليكم ورحمة الله وبركاته،\nالأخوة الكرام في: ${selectedEntity.nameAr}\n\nنود إشعاركم بأن رصيدكم المستحق حالياً هو: ${balStr} ${currencySymbol}.\nنرجو التكرم بالاطلاع وترتيب السداد وفق التسهيلات المتفق عليها.\nمع فائق الاحترام والتقدير،\n${companyName}`
        );
      }
    } else if (waTemplate === 'statement') {
      const tpl = whatsappTemplates?.statement;
      setWaComposedText(
        tpl
          ? renderWhatsAppTemplate(tpl, {
              name: selectedEntity.nameAr,
              balance: balStr,
              currency: currencySymbol,
              company: companyName,
              date: new Date().toISOString().split('T')[0],
            })
          : `السلام عليكم ${selectedEntity.nameAr}، نرسل لكم خلاصة كشف الحساب بتاريخ اليوم برصيد: ${balStr} ${currencySymbol}.`
      );
    } else if (waTemplate === 'greeting') {
      setWaComposedText(
        `السلام عليكم ورحمة الله وبركاته،\nالسادة: ${selectedEntity.nameAr} المحترمين،\nنتمنى لكم دوام التوفيق والنجاح، ويسعدنا دائماً خدمتكم عبر ${companyName}.`
      );
    }
  }, [selectedEntity, waTemplate, whatsappTemplates, currencySymbol, companyName]);

  const phoneValidation = validateWhatsAppPhone(waPhoneInput);
  const waHref =
    phoneValidation.valid && waComposedText.trim()
      ? buildWhatsAppLink(phoneValidation.normalized, waComposedText)
      : '';

  const handleCreateTaskSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskTitle.trim()) {
      onNotify?.('error', 'يرجى إدخال عنوان المهمة.');
      return;
    }

    const newTask: TaskAlert = {
      id: `task-${Date.now()}`,
      title: taskTitle.trim(),
      type: 'مهمة_عمل',
      severity: taskSeverity,
      assignedTo,
      dueDate: dueDate || undefined,
      isRead: true,
      isCompleted: false,
      createdAt: new Date().toISOString().split('T')[0],
    };

    onAddTask(newTask);
    onNotify?.('success', 'تم إضافة المهمة وتعيينها في قائمة المتابعة.');
    setIsModalOpen(false);
    setTaskTitle('');
  };

  const handleCopyMessage = async () => {
    try {
      await navigator.clipboard.writeText(waComposedText);
      setCopied(true);
      onNotify?.('success', 'تم نسخ نص الرسالة إلى الحافظة.');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      onNotify?.('error', 'تعذر النسخ التلقائي؛ يمكنك نسخ النص يدوياً.');
    }
  };

  const filteredTasks = taskAlerts.filter((t) => {
    if (statusFilter === 'pending') return !t.isCompleted;
    if (statusFilter === 'completed') return t.isCompleted;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900 border border-slate-800 rounded-2xl p-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <BellRing className="w-5 h-5 text-amber-400" />
            <h2 className="text-lg font-bold text-white">مركز التنبيهات والمهام والتواصل</h2>
          </div>
          <p className="text-xs text-slate-400">
            تنبيهات استحقاق المديونيات، نواقص المخزون، تكليفات فريق العمل، وإرسال رسائل واتساب للعملاء والموردين
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="bg-slate-950 p-1 rounded-xl border border-slate-800 flex items-center gap-1 text-xs">
            <button
              type="button"
              onClick={() => setActiveTab('alerts')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                activeTab === 'alerts'
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              المهام والتنبيهات ({taskAlerts.filter((t) => !t.isCompleted).length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('whatsapp')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                activeTab === 'whatsapp'
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              مراسلات واتساب
            </button>
          </div>

          {activeTab === 'alerts' && (
            <button
              type="button"
              onClick={() => setIsModalOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-xl shadow-sm transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة مهمة جديدة</span>
            </button>
          )}
        </div>
      </div>

      {/* TAB 1: ALERTS & TASKS */}
      {activeTab === 'alerts' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs">
            {(['all', 'pending', 'completed'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setStatusFilter(f)}
                className={`px-3 py-1.5 rounded-lg font-semibold cursor-pointer ${
                  statusFilter === f
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                    : 'bg-slate-900 text-slate-400 border border-slate-800'
                }`}
              >
                {f === 'all' ? 'الكل' : f === 'pending' ? 'قيد المتابعة' : 'المنجزة'}
              </button>
            ))}
          </div>

          {filteredTasks.map((task) => (
            <div
              key={task.id}
              className={`p-4 rounded-xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs ${
                task.isCompleted
                  ? 'bg-slate-950/40 border-slate-900 opacity-60'
                  : task.severity === 'high' || task.severity === 'critical'
                  ? 'bg-rose-950/20 border-rose-900/40'
                  : 'bg-slate-900 border-slate-800'
              }`}
            >
              <div className="flex items-start gap-3">
                <button
                  type="button"
                  onClick={() => onToggleTaskComplete(task.id)}
                  className={`mt-0.5 p-1 rounded-md transition-colors cursor-pointer ${
                    task.isCompleted
                      ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                      : 'bg-slate-800 text-slate-400 hover:text-emerald-400'
                  }`}
                >
                  <CheckCircle className="w-4 h-4" />
                </button>
                <div>
                  <span
                    className={`font-semibold block text-sm ${
                      task.isCompleted ? 'line-through text-slate-500' : 'text-slate-100'
                    }`}
                  >
                    {task.title}
                  </span>
                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400 mt-1">
                    <span>النوع: {task.type.replace(/_/g, ' ')}</span>
                    {task.assignedTo && <span>· المسؤول: {task.assignedTo}</span>}
                    {task.dueDate && <span className="font-mono">· تاريخ الاستحقاق: {task.dueDate}</span>}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {task.linkModule && onNavigateToRecord && (
                  <button
                    type="button"
                    onClick={() => onNavigateToRecord(task.linkModule!, task.linkId)}
                    className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-amber-300 rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <ExternalLink className="w-3 h-3" />
                    <span>فتح السجل</span>
                  </button>
                )}
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    task.severity === 'high' || task.severity === 'critical'
                      ? 'bg-rose-950 text-rose-400 border border-rose-800/40'
                      : 'bg-amber-950 text-amber-400 border border-amber-800/40'
                  }`}
                >
                  {task.severity === 'high' || task.severity === 'critical' ? 'أولوية قصوى' : 'متابعة عادية'}
                </span>
                <span className="text-[11px] font-mono text-slate-500">{task.createdAt}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* TAB 2: WHATSAPP COMPOSER */}
      {activeTab === 'whatsapp' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-2xl mx-auto space-y-5 text-xs">
          <div className="border-b border-slate-800 pb-3">
            <h3 className="font-bold text-sm text-white flex items-center gap-2">
              <MessageCircle className="w-4 h-4 text-emerald-400" />
              تجهيز وإرسال رسائل واتساب رسمية
            </h3>
            <p className="text-slate-400 mt-0.5">
              تجهيز وتدقيق رقم الهاتف والرسالة وفتح محادثة واتساب عبر المتصفح مع إمكانية التعديل والنسخ
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">نوع الطرف</label>
              <select
                value={waTargetType}
                onChange={(e) => {
                  const t = e.target.value as 'customer' | 'vendor';
                  setWaTargetType(t);
                  if (t === 'customer') setWaSelectedEntityId(customers[0]?.id || '');
                  else setWaSelectedEntityId(vendors[0]?.id || '');
                }}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-amber-500 cursor-pointer"
              >
                <option value="customer">عميل</option>
                <option value="vendor">مورد</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">اختر الشخص / المؤسسة</label>
              {waTargetType === 'customer' ? (
                <select
                  value={waSelectedEntityId}
                  onChange={(e) => setWaSelectedEntityId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-amber-500 cursor-pointer"
                >
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nameAr} ({c.phone})
                    </option>
                  ))}
                </select>
              ) : (
                <select
                  value={waSelectedEntityId}
                  onChange={(e) => setWaSelectedEntityId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-amber-500 cursor-pointer"
                >
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.nameAr} ({v.phone})
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">رقم الواتساب (دولي)</label>
              <input
                type="text"
                dir="ltr"
                value={waPhoneInput}
                onChange={(e) => setWaPhoneInput(e.target.value)}
                placeholder="967770001111"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono text-left focus:outline-none focus:border-amber-500"
              />
              {!phoneValidation.valid && (
                <span className="text-[11px] text-rose-400 flex items-center gap-1 mt-1">
                  <AlertCircle className="w-3 h-3" />
                  {phoneValidation.error}
                </span>
              )}
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">قالب الرسالة</label>
              <select
                value={waTemplate}
                onChange={(e) => setWaTemplate(e.target.value as 'debt' | 'greeting' | 'statement' | 'custom')}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-amber-500 cursor-pointer"
              >
                <option value="debt">إشعار برصيد المديونية المستحق</option>
                <option value="statement">ملخص كشف الحساب</option>
                <option value="greeting">رسالة ترحيبية وتأكيد تعامل</option>
                <option value="custom">نص مخصص حر</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">نص الرسالة (معاينة وقابل للتعديل)</label>
            <textarea
              rows={5}
              value={waComposedText}
              onChange={(e) => setWaComposedText(e.target.value)}
              placeholder="اكتب رسالتك هنا..."
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-slate-100 leading-relaxed focus:outline-none focus:border-amber-500"
            />
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <button
              type="button"
              onClick={handleCopyMessage}
              className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold rounded-xl flex items-center justify-center gap-2 cursor-pointer"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              <span>{copied ? 'تم النسخ' : 'نسخ النص'}</span>
            </button>

            {waHref ? (
              <a
                href={waHref}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl flex items-center justify-center gap-2 transition-colors"
              >
                <MessageCircle className="w-4 h-4" />
                <span>فتح محادثة واتساب الآن</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            ) : (
              <span className="flex-1 py-2.5 bg-slate-800 text-slate-500 font-bold rounded-xl flex items-center justify-center gap-2 cursor-not-allowed">
                <MessageCircle className="w-4 h-4" />
                <span>أدخل رقماً دولياً صحيحاً ونص رسالة لتفعيل الرابط</span>
              </span>
            )}
          </div>
        </div>
      )}

      {/* CREATE TASK MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl flex flex-col text-slate-100">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between">
              <h3 className="font-bold text-base text-white">إضافة مهمة جديدة</h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateTaskSubmit} className="p-6 space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">عنوان المهمة *</label>
                <input
                  type="text"
                  required
                  value={taskTitle}
                  onChange={(e) => setTaskTitle(e.target.value)}
                  placeholder="مثال: مطابقة كشف حساب بنك التضامن"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">المسؤول عن التنفيذ</label>
                  <input
                    type="text"
                    value={assignedTo}
                    onChange={(e) => setAssignedTo(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">درجة الأهمية</label>
                  <select
                    value={taskSeverity}
                    onChange={(e) => setTaskSeverity(e.target.value as TaskAlert['severity'])}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-amber-500 cursor-pointer"
                  >
                    <option value="low">منخفضة</option>
                    <option value="medium">متوسطة</option>
                    <option value="high">قصوى / عاجلة</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">تاريخ الاستحقاق</label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="pt-4 border-t border-slate-800 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-lg transition-colors cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-lg transition-colors cursor-pointer"
                >
                  حفظ المهمة
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
