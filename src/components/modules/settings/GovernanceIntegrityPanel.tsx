/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Financial Integrity Center, Approvals, Fiscal Year Closing, FX Revaluation & Diff Audit
 */

import React, { useMemo, useState } from 'react';
import {
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Lock,
  RefreshCw,
  CalendarCheck,
  Coins,
  FileSearch,
  Activity,
} from 'lucide-react';
import { ERPDatabase, scopeDatabaseToCompany } from '../../../services/storageService';
import {
  ApprovalWorkflowRule,
  FiscalPeriod,
  User,
} from '../../../types/erp';
import { runFinancialIntegrityScan } from '../../../services/financialIntegrityService';
import {
  executeFxRevaluationTransaction,
  executeYearEndClosingTransaction,
  processApprovalDecisionTransaction,
  toggleFiscalPeriodTransaction,
  updateApprovalRuleTransaction,
} from '../../../services/erpTransactionService';
import { ConfirmModal } from '../../common/ConfirmModal';

interface GovernanceIntegrityPanelProps {
  db: ERPDatabase;
  currentUser: User;
  onUpdateDatabase: (nextDb: ERPDatabase) => void;
  onNotify: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export const GovernanceIntegrityPanel: React.FC<GovernanceIntegrityPanelProps> = ({
  db,
  currentUser,
  onUpdateDatabase,
  onNotify,
}) => {
  const [activeSection, setActiveSection] = useState<'integrity' | 'approvals' | 'fiscal_fx' | 'audit_diff'>('integrity');
  const [severityFilter, setSeverityFilter] = useState<'all' | 'critical' | 'warning' | 'info'>('all');
  const [closingYear, setClosingYear] = useState(db.settings.fiscalYear || '2026');
  const [closingDate, setClosingDate] = useState(`${db.settings.fiscalYear || '2026'}-12-31`);
  const [fxDate, setFxDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);

  const scopedDb = useMemo(() => scopeDatabaseToCompany(db), [db]);
  const scanReport = useMemo(() => runFinancialIntegrityScan(scopedDb), [scopedDb]);

  const filteredIssues = useMemo(
    () =>
      scanReport.issues.filter((i) => severityFilter === 'all' || i.severity === severityFilter),
    [scanReport.issues, severityFilter]
  );

  const pendingApprovals = useMemo(
    () => (scopedDb.approvalRequests || []).filter((r) => r.status === 'pending'),
    [scopedDb.approvalRequests]
  );

  const activeCompanyId = db.activeCompanyId || db.company.id;
  const companyPeriods: FiscalPeriod[] = useMemo(
    () => (scopedDb.fiscalPeriods || []).filter((fp) => fp.companyId === activeCompanyId),
    [scopedDb.fiscalPeriods, activeCompanyId]
  );

  const handleToggleRule = (rule: ApprovalWorkflowRule, patch: Partial<ApprovalWorkflowRule>) => {
    const res = updateApprovalRuleTransaction(db, currentUser, rule.id, patch);
    if (!res.ok || !res.nextDb) {
      onNotify('error', res.error || 'عذراً، لا تملك صلاحية تعديل قواعد الاعتماد.');
      return;
    }
    onUpdateDatabase(res.nextDb);
    onNotify('success', `تم تحديث قاعدة الاعتماد "${rule.nameAr}".`);
  };

  const handleApprovalDecision = (requestId: string, decision: 'approved' | 'rejected') => {
    const res = processApprovalDecisionTransaction(db, currentUser, requestId, decision);
    if (!res.ok || !res.nextDb) {
      onNotify('error', res.error || 'تعذر معالجة طلب الاعتماد.');
      return;
    }
    onUpdateDatabase(res.nextDb);
    onNotify(
      'success',
      decision === 'approved' ? 'تم اعتماد الطلب وتنفيذ الأثر المحاسبي بنجاح.' : 'تم رفض طلب الاعتماد.'
    );
  };

  const handleTogglePeriodStatus = (period: FiscalPeriod) => {
    const res = toggleFiscalPeriodTransaction(db, currentUser, period.id);
    if (!res.ok || !res.nextDb || !res.data) {
      onNotify('error', res.error || 'تعذر تحديث حالة الفترة المالية.');
      return;
    }
    onUpdateDatabase(res.nextDb);
    onNotify(
      'info',
      `تم تغيير حالة (${period.periodName}) إلى ${res.data.status === 'open' ? 'مفتوحة' : 'مقفلة'}.`
    );
  };

  const handleRunYearEndClosing = () => {
    const res = executeYearEndClosingTransaction(db, currentUser, closingYear, closingDate, true);
    setConfirmCloseOpen(false);
    if (!res.ok || !res.nextDb) {
      onNotify('error', res.error || 'تعذر تنفيذ إقفال السنة المالية.');
      return;
    }
    onUpdateDatabase(res.nextDb);
    onNotify(
      'success',
      `تم إقفال السنة المالية (${closingYear}) بنجاح وترحيل صافي النتيجة (${res.data?.netProfitClosed.toLocaleString()}) وفتح السنة التالية.`
    );
  };

  const handleRunFxRevaluation = () => {
    const res = executeFxRevaluationTransaction(db, currentUser, fxDate);
    if (!res.ok || !res.nextDb) {
      onNotify('error', res.error || 'لا توجد فروقات تقييم عملات أجنبية للتسوية.');
      return;
    }
    onUpdateDatabase(res.nextDb);
    onNotify('success', 'تم احتساب وترحيل قيد إعادة تقييم العملات الأجنبية بنجاح.');
  };

  return (
    <div className="space-y-4 text-xs" dir="rtl">
      {/* Sub-navigation */}
      <div className="v20-card-alt px-3 py-2 flex flex-wrap items-center gap-1.5">
        {[
          { id: 'integrity', label: `مركز السلامة المالية والمطابقة (${scanReport.issues.length})`, icon: Activity },
          { id: 'approvals', label: `صندوق الاعتمادات والقواعد (${pendingApprovals.length} معلق)`, icon: ShieldCheck },
          { id: 'fiscal_fx', label: 'الفترات المالية، الإقفال السنوي وإعادة تقييم العملات', icon: CalendarCheck },
          { id: 'audit_diff', label: 'سجل الرقابة التفصيلي (قبل/بعد)', icon: FileSearch },
        ].map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveSection(tab.id as typeof activeSection)}
              className={`px-3 py-1.5 rounded-md font-black flex items-center gap-1.5 cursor-pointer ${
                activeSection === tab.id
                  ? 'bg-[var(--gold)] text-[#03060A]'
                  : 'bg-[#08121E] border border-[var(--border-strong)] text-white'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* SECTION 1: FINANCIAL INTEGRITY CENTER */}
      {activeSection === 'integrity' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="v20-card p-3.5">
              <div className="text-[11px] text-slate-400">مؤشر السلامة المحاسبية</div>
              <div
                className={`text-2xl font-black tabular-nums mt-1 ${
                  scanReport.healthScore >= 90
                    ? 'text-emerald-400'
                    : scanReport.healthScore >= 70
                    ? 'text-amber-400'
                    : 'text-rose-400'
                }`}
              >
                {scanReport.healthScore}%
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                حرج: <strong className="text-rose-400">{scanReport.criticalCount}</strong> · تنبيهات:{' '}
                <strong className="text-amber-300">{scanReport.warningCount}</strong>
              </div>
            </div>

            <div className="v20-card p-3.5">
              <div className="text-[11px] text-slate-400">مراقبة العملاء (GL مقابل البطاقات)</div>
              <div className="font-mono text-sm font-black text-white mt-1 tabular-nums">
                {scanReport.summaryMetrics.glReceivablesControlBalance.toLocaleString()} /{' '}
                {scanReport.summaryMetrics.customersSubledgerSum.toLocaleString()}
              </div>
              <div className="text-[10px] text-amber-300 mt-0.5 tabular-nums">
                الفارق: {scanReport.summaryMetrics.receivablesVariance.toLocaleString()}
              </div>
            </div>

            <div className="v20-card p-3.5">
              <div className="text-[11px] text-slate-400">مراقبة الموردين (GL مقابل البطاقات)</div>
              <div className="font-mono text-sm font-black text-white mt-1 tabular-nums">
                {scanReport.summaryMetrics.glPayablesControlBalance.toLocaleString()} /{' '}
                {scanReport.summaryMetrics.vendorsSubledgerSum.toLocaleString()}
              </div>
              <div className="text-[10px] text-amber-300 mt-0.5 tabular-nums">
                الفارق: {scanReport.summaryMetrics.payablesVariance.toLocaleString()}
              </div>
            </div>

            <div className="v20-card p-3.5">
              <div className="text-[11px] text-slate-400">مراقبة المخزون (GL مقابل التقييم)</div>
              <div className="font-mono text-sm font-black text-white mt-1 tabular-nums">
                {scanReport.summaryMetrics.glInventoryControlBalance.toLocaleString()} /{' '}
                {scanReport.summaryMetrics.warehouseValuationSum.toLocaleString()}
              </div>
              <div className="text-[10px] text-amber-300 mt-0.5 tabular-nums">
                الفارق: {scanReport.summaryMetrics.inventoryVariance.toLocaleString()}
              </div>
            </div>
          </div>

          <div className="v20-card p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-strong)] pb-2.5">
              <div className="font-black text-sm text-[var(--gold)]">
                نتائج الفحص المالي والتدقيق التلقائي (كشف بدون تعديل قسري صامت)
              </div>
              <div className="flex items-center gap-1.5">
                {(['all', 'critical', 'warning', 'info'] as const).map((sev) => (
                  <button
                    key={sev}
                    type="button"
                    onClick={() => setSeverityFilter(sev)}
                    className={`px-2.5 py-1 rounded text-[11px] font-bold cursor-pointer ${
                      severityFilter === sev
                        ? 'bg-[var(--gold)] text-[#03060A]'
                        : 'bg-[#08121E] border border-[var(--border-strong)] text-slate-300'
                    }`}
                  >
                    {sev === 'all' ? 'الكل' : sev === 'critical' ? 'حرج' : sev === 'warning' ? 'تحذير' : 'معلومة'}
                  </button>
                ))}
              </div>
            </div>

            {filteredIssues.length === 0 ? (
              <div className="py-8 text-center text-emerald-400 font-bold flex items-center justify-center gap-2">
                <CheckCircle2 className="w-5 h-5" />
                <span>لا توجد أي اختلالات محاسبية أو مخزنية مطابقة لهذا الفلتر.</span>
              </div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {filteredIssues.map((issue) => (
                  <div
                    key={issue.id}
                    className={`p-3 rounded-xl border ${
                      issue.severity === 'critical'
                        ? 'bg-rose-950/30 border-rose-500/50'
                        : issue.severity === 'warning'
                        ? 'bg-amber-950/25 border-amber-500/40'
                        : 'bg-sky-950/20 border-sky-500/30'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-black text-white flex items-center gap-1.5">
                        <AlertTriangle
                          className={`w-4 h-4 ${
                            issue.severity === 'critical'
                              ? 'text-rose-400'
                              : issue.severity === 'warning'
                              ? 'text-amber-400'
                              : 'text-sky-400'
                          }`}
                        />
                        {issue.titleAr}
                      </span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#08121E] text-slate-300">
                        {issue.category}
                      </span>
                    </div>
                    <p className="text-slate-300 mt-1">{issue.descriptionAr}</p>
                    <p className="text-[11px] text-emerald-300 mt-1">
                      الإجراء المقترح: {issue.suggestedResolutionAr}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* SECTION 2: APPROVAL WORKFLOW INBOX & RULES */}
      {activeSection === 'approvals' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="v20-card p-4 space-y-3">
            <h4 className="font-black text-sm text-[var(--gold)] border-b border-[var(--border-strong)] pb-2">
              طلبات الاعتماد المعلقة ({pendingApprovals.length})
            </h4>
            {pendingApprovals.length === 0 ? (
              <div className="py-8 text-center text-slate-400">لا توجد معاملات بانتظار الاعتماد حالياً.</div>
            ) : (
              <div className="space-y-2.5 max-h-96 overflow-y-auto">
                {pendingApprovals.map((req) => (
                  <div key={req.id} className="v20-card-alt p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-black text-white">
                        {req.requestNumber} · {req.documentNumber}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[10px] font-black">
                        مستوى {req.currentLevel} / {req.requiredLevels}
                      </span>
                    </div>
                    <div className="text-slate-300">
                      {req.entityLabel} — المبلغ:{' '}
                      <strong className="text-[var(--gold)] font-mono">
                        {req.amount.toLocaleString()} {req.currency}
                      </strong>
                    </div>
                    <div className="text-[10px] text-slate-400">
                      طالب الترحيل: {req.requestedByName} · {req.requestedAt.slice(0, 16).replace('T', ' ')}
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => handleApprovalDecision(req.id, 'approved')}
                        className="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-black flex items-center gap-1 cursor-pointer"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>اعتماد وتنفيذ</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleApprovalDecision(req.id, 'rejected')}
                        className="px-3 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white font-black flex items-center gap-1 cursor-pointer"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        <span>رفض</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="v20-card p-4 space-y-3">
            <h4 className="font-black text-sm text-white border-b border-[var(--border-strong)] pb-2">
              قواعد وحدود الموافقات التلقائية
            </h4>
            <div className="space-y-2.5">
              {(scopedDb.approvalRules || []).map((rule) => (
                <div key={rule.id} className="bg-[#060D15] border border-[var(--border-strong)] rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-white">{rule.nameAr}</span>
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      onChange={(e) => handleToggleRule(rule, { enabled: e.target.checked })}
                      className="w-4 h-4 accent-amber-400 cursor-pointer"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-1">الحد الأدنى للمبلغ (أساس)</label>
                      <input
                        type="number"
                        value={rule.minAmountThreshold}
                        onChange={(e) =>
                          handleToggleRule(rule, { minAmountThreshold: Math.max(0, Number(e.target.value) || 0) })
                        }
                        className="w-full v20-input px-2 py-1 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-1">مستويات الاعتماد</label>
                      <select
                        value={rule.requiredLevels}
                        onChange={(e) => handleToggleRule(rule, { requiredLevels: Number(e.target.value) as 1 | 2 })}
                        className="w-full v20-input px-2 py-1"
                      >
                        <option value={1}>مستوى واحد (المدير المالي / المالك)</option>
                        <option value={2}>مستويان (المدير المالي ثم المالك)</option>
                      </select>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* SECTION 3: FISCAL PERIODS, YEAR-END CLOSING & FX REVALUATION */}
      {activeSection === 'fiscal_fx' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="v20-card p-4 space-y-3">
            <h4 className="font-black text-sm text-[var(--gold)] border-b border-[var(--border-strong)] pb-2">
              الفترات المالية وإقفال السنة (Year-End Closing)
            </h4>
            <div className="space-y-2">
              {companyPeriods.map((fp) => (
                <div
                  key={fp.id}
                  className="bg-[#060D15] border border-[var(--border-strong)] rounded-lg p-3 flex items-center justify-between"
                >
                  <div>
                    <div className="font-black text-white">{fp.periodName}</div>
                    <div className="text-[11px] font-mono text-slate-400">
                      {fp.startDate} → {fp.endDate}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleTogglePeriodStatus(fp)}
                    className={`px-3 py-1 rounded text-[11px] font-black flex items-center gap-1 cursor-pointer ${
                      fp.status === 'open'
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                        : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                    }`}
                  >
                    <Lock className="w-3 h-3" />
                    <span>{fp.status === 'open' ? 'مفتوحة (اضغط للإغلاق)' : 'مقفلة (اضغط للفتح)'}</span>
                  </button>
                </div>
              ))}
            </div>

            <div className="bg-[#060D15] border border-amber-500/30 rounded-xl p-3 space-y-2">
              <div className="font-black text-amber-300">تنفيذ الإقفال السنوي وترحيل الأرباح المبقاة (330/320)</div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] text-slate-400 mb-1">السنة المالية للإقفال</label>
                  <input
                    type="text"
                    value={closingYear}
                    onChange={(e) => setClosingYear(e.target.value)}
                    className="w-full v20-input px-2 py-1.5 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-400 mb-1">تاريخ قيد الإقفال</label>
                  <input
                    type="date"
                    value={closingDate}
                    onChange={(e) => setClosingDate(e.target.value)}
                    className="w-full v20-input px-2 py-1.5 font-mono"
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={() => setConfirmCloseOpen(true)}
                className="w-full py-2 rounded v20-btn-gold font-black flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>تنفيذ قيد الإقفال السنوي وفتح السنة الجديدة</span>
              </button>
            </div>
          </div>

          <div className="v20-card p-4 space-y-3">
            <h4 className="font-black text-sm text-[var(--gold)] border-b border-[var(--border-strong)] pb-2 flex items-center gap-2">
              <Coins className="w-4 h-4" />
              <span>إعادة تقييم العملات الأجنبية (FX Revaluation)</span>
            </h4>
            <p className="text-[11px] text-slate-300">
              يقارن القيمة الدفترية التاريخية لحسابات الصناديق والبنوك بالعملات الأجنبية مقابل القيمة السوقية بسعر الصرف الحالي ويولد قيد أرباح/خسائر فروق العملة تلقائياً.
            </p>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label className="block text-[10px] text-slate-400 mb-1">تاريخ التقييم</label>
                <input
                  type="date"
                  value={fxDate}
                  onChange={(e) => setFxDate(e.target.value)}
                  className="w-full v20-input px-2.5 py-1.5 font-mono"
                />
              </div>
              <button
                type="button"
                onClick={handleRunFxRevaluation}
                className="px-4 py-1.5 rounded v20-btn-gold font-black flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>توليد وترحيل قيد الفروقات</span>
              </button>
            </div>

            <div className="space-y-1.5 max-h-56 overflow-y-auto pt-2">
              {(scopedDb.fxRevaluations || []).map((fx) => (
                <div key={fx.id} className="v20-card-alt p-2.5 flex items-center justify-between">
                  <div>
                    <div className="font-bold text-white">{fx.revaluationNumber}</div>
                    <div className="text-[10px] text-slate-400">
                      {fx.date} · {fx.performedBy}
                    </div>
                  </div>
                  <div className="font-mono font-black text-[var(--gold)]">
                    {fx.totalGainLossBase >= 0 ? '+' : ''}
                    {fx.totalGainLossBase.toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* SECTION 4: AUDIT TRAIL WITH BEFORE/AFTER SNAPSHOTS */}
      {activeSection === 'audit_diff' && (
        <div className="v20-card p-4 space-y-3">
          <h4 className="font-black text-sm text-[var(--gold)] border-b border-[var(--border-strong)] pb-2">
            سجل التدقيق الأمني مع لقطات القيم (قبل / بعد)
          </h4>
          <div className="overflow-x-auto max-h-[460px]">
            <table className="w-full text-right text-xs border-collapse">
              <thead className="bg-[#0B192C] text-[var(--gold)] sticky top-0">
                <tr>
                  <th className="p-2">التاريخ</th>
                  <th className="p-2">المستخدم</th>
                  <th className="p-2">الإجراء</th>
                  <th className="p-2">التفاصيل</th>
                  <th className="p-2">قبل / بعد</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {scopedDb.auditLogs.slice(0, 80).map((log) => (
                  <tr key={log.id} className="hover:bg-slate-800/40">
                    <td className="p-2 font-mono text-[11px] text-slate-400">
                      {log.timestamp.replace('T', ' ').slice(0, 19)}
                    </td>
                    <td className="p-2 font-bold text-white">{log.userName}</td>
                    <td className="p-2">
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-amber-300 text-[10px] font-black">
                        {log.action} · {log.module}
                      </span>
                    </td>
                    <td className="p-2 text-slate-200">{log.details}</td>
                    <td className="p-2 font-mono text-[10px] text-slate-400 max-w-xs truncate">
                      {log.beforeSnapshot || log.afterSnapshot
                        ? `قبل: ${JSON.stringify(log.beforeSnapshot || {})} | بعد: ${JSON.stringify(log.afterSnapshot || {})}`
                        : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={confirmCloseOpen}
        title="تأكيد إقفال السنة المالية"
        variant="warning"
        message={`هل تريد تنفيذ قيد الإقفال السنوي للسنة (${closingYear}) بتاريخ ${closingDate}؟ سيتم تصفير حسابات الإيرادات والمصروفات وترحيل صافي النتيجة إلى الأرباح المبقاة وإغلاق الفترة عن التعديل.`}
        confirmLabel="اعتماد الإقفال السنوي"
        onConfirm={handleRunYearEndClosing}
        onCancel={() => setConfirmCloseOpen(false)}
      />
    </div>
  );
};
