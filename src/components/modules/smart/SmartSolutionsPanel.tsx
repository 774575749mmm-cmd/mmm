/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Smart AI Solutions & Automated Diagnostics Panel
 */

import React, { useState, useMemo } from 'react';
import {
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  ArrowUpRight,
  Send,
  RefreshCw,
  ShieldAlert,
  TrendingUp,
  Layers,
  Loader2,
} from 'lucide-react';
import { ERPDatabase } from '../../../services/storageService';
import {
  buildErpAnalyticsSnapshot,
  runErpDiagnostics,
  ErpDiagnosticFinding,
} from '../../../services/smartDiagnostics';
import { AppLanguage } from '../../../services/i18n';

interface AiSolutionItem {
  title: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  category: string;
  rootCause: string;
  actionSteps: string[];
  expectedImpact: string;
  targetModule: string;
}

interface AiAnalysisResult {
  executiveSummary: string;
  overallRisk: 'low' | 'moderate' | 'high' | 'critical';
  directAnswer: string;
  solutions: AiSolutionItem[];
}

interface SmartSolutionsPanelProps {
  db: ERPDatabase;
  lang: AppLanguage;
  onNavigateToRecord: (moduleName: string, recordId?: string) => void;
  onNotify?: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export const SmartSolutionsPanel: React.FC<SmartSolutionsPanelProps> = ({
  db,
  lang,
  onNavigateToRecord,
  onNotify,
}) => {
  const isEn = lang === 'en';
  const [question, setQuestion] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [aiResult, setAiResult] = useState<AiAnalysisResult | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  const snapshot = useMemo(() => buildErpAnalyticsSnapshot(db), [db]);
  const localFindings = useMemo(() => runErpDiagnostics(db, lang), [db, lang]);

  const presetPrompts = useMemo(
    () =>
      isEn
        ? [
            'Diagnose receivables delays and design a collection plan',
            'Analyze SAR vs YER liquidity exposure and exchange risk',
            'Identify inventory bottlenecks, negative stock, and reorder steps',
            'Audit operating expense ratio and propose cost-cutting controls',
          ]
        : [
            'شخص تأخر تحصيل ذمم العملاء واقترح خطة تحصيل فورية',
            'حلل تعرض السيولة بين الريال السعودي واليمني ومخاطر الصرف',
            'اكشف اختناقات المخزون والأصناف السالبة وخطة إعادة الطلب',
            'حلل نسبة المصروفات التشغيلية واقترح ضوابط لخفض التكاليف',
          ],
    [isEn]
  );

  const handleRunAiAnalysis = async (customQuestion?: string) => {
    const activeQuestion = (customQuestion !== undefined ? customQuestion : question).trim();
    setIsLoading(true);
    setAiError(null);
    try {
      const response = await fetch('/api/ai/analyze', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lang,
          question: activeQuestion,
          snapshot,
          localFindings,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data?.analysis) {
        const msg =
          data?.error ||
          (isEn
            ? 'Smart AI service is temporarily unavailable. Review the instant local audit findings below.'
            : 'تعذر الوصول إلى خدمة الذكاء الاصطناعي حالياً. يمكنك الاعتماد على نتائج الفاحص المحاسبي المحلي الفوري.');
        setAiError(msg);
        onNotify?.('error', msg);
        return;
      }
      setAiResult(data.analysis as AiAnalysisResult);
      setGeneratedAt(data.generatedAt || new Date().toISOString());
      onNotify?.(
        'success',
        isEn ? 'Smart AI ERP advisory generated successfully.' : 'تم توليد التحليل والحلول الذكية للنظام بنجاح.'
      );
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : isEn
          ? 'Network error contacting AI advisor.'
          : 'خطأ في الاتصال بخادم التحليل الذكي.';
      setAiError(msg);
      onNotify?.('error', msg);
    } finally {
      setIsLoading(false);
    }
  };

  const severityBadgeClass = (sev: ErpDiagnosticFinding['severity']) => {
    switch (sev) {
      case 'critical':
        return 'bg-rose-950/80 border-rose-500 text-rose-200';
      case 'high':
        return 'bg-amber-950/70 border-amber-500 text-amber-200';
      case 'medium':
        return 'bg-sky-950/70 border-sky-500 text-sky-200';
      default:
        return 'bg-emerald-950/60 border-emerald-500 text-emerald-200';
    }
  };

  const severityLabel = (sev: ErpDiagnosticFinding['severity']) => {
    if (isEn) {
      return sev.toUpperCase();
    }
    switch (sev) {
      case 'critical':
        return 'حرج';
      case 'high':
        return 'عالي';
      case 'medium':
        return 'متوسط';
      default:
        return 'معلومة';
    }
  };

  return (
    <div className="space-y-4" dir={isEn ? 'ltr' : 'rtl'}>
      {/* Executive Header & Ask AI Prompt Bar */}
      <div className="v20-card p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-strong)] pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-[var(--gold)]/15 border border-[var(--gold)] flex items-center justify-center text-[var(--gold)]">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-black text-[var(--gold)]">
                {isEn
                  ? 'Smart ERP Solutions Advisor & Live Anomaly Scanner'
                  : 'مستشار الحلول الذكية والفحص المحاسبي والمخزني الفوري'}
              </h3>
              <p className="text-[11px] text-slate-400">
                {isEn
                  ? 'Combines deterministic accounting/stock checks with AI-powered root-cause action plans.'
                  : 'يدمج الفحص التلقائي المباشر للقيود والمخزون والعملاء مع مستشار الذكاء الاصطناعي لاقتراح حلول عملية قابلة للتنفيذ فوراً.'}
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={isLoading}
            onClick={() => void handleRunAiAnalysis()}
            className="px-4 py-2 rounded-md v20-btn-gold text-xs font-black flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            <span>{isEn ? 'Run Full AI Diagnosis' : 'تحليل ذكي شامل الآن'}</span>
          </button>
        </div>

        {/* Preset Executive Prompts */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-slate-400 font-bold">
            {isEn ? 'Quick Scenarios:' : 'استشارات سريعة:'}
          </span>
          {presetPrompts.map((p) => (
            <button
              key={p}
              type="button"
              disabled={isLoading}
              onClick={() => {
                setQuestion(p);
                void handleRunAiAnalysis(p);
              }}
              className="px-2.5 py-1 rounded bg-[#08121E] border border-[var(--border-strong)] hover:border-[var(--gold)] text-[11px] font-bold text-slate-200 transition cursor-pointer disabled:opacity-50"
            >
              {p}
            </button>
          ))}
        </div>

        {/* Custom Question Input */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleRunAiAnalysis();
          }}
          className="flex flex-col sm:flex-row gap-2"
        >
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={
              isEn
                ? 'Ask about cashflow, SAR/YER balances, customer risk, inventory shortages, or accounting discrepancies...'
                : 'اسأل المستشار الذكي عن أي مشكلة مالية، أو أرصدة السعودي واليمني، أو الديون المتأخرة، أو عجز المخزون...'
            }
            className="flex-1 v20-input px-3 py-2 text-xs"
          />
          <button
            type="submit"
            disabled={isLoading}
            className="px-4 py-2 rounded-md bg-[#0D2E1D] border border-[var(--success)] text-[var(--success)] hover:bg-emerald-900/50 font-black text-xs flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
          >
            <Send className="w-3.5 h-3.5" />
            <span>{isEn ? 'Ask Advisor' : 'استشارة ذكية'}</span>
          </button>
        </form>

        {aiError && (
          <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-500/60 text-rose-200 text-xs flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
            <div>{aiError}</div>
          </div>
        )}
      </div>

      {/* Gemini AI Structured Solutions Output */}
      {aiResult && (
        <div className="v20-card p-4 space-y-3 border-[var(--gold)]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-strong)] pb-2.5">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[var(--gold)]" />
              <h4 className="font-black text-sm text-[var(--gold)]">
                {isEn ? 'AI Advisory & Action Plan' : 'التشخيص الذكي وخطة الحلول التنفيذية'}
              </h4>
            </div>
            <div className="flex items-center gap-2 text-[11px]">
              <span
                className={`px-2 py-0.5 rounded font-black border ${severityBadgeClass(
                  aiResult.overallRisk === 'moderate' ? 'medium' : aiResult.overallRisk
                )}`}
              >
                {isEn ? `Risk: ${aiResult.overallRisk.toUpperCase()}` : `مستوى المخاطر: ${severityLabel(aiResult.overallRisk === 'moderate' ? 'medium' : aiResult.overallRisk)}`}
              </span>
              {generatedAt && (
                <span className="text-slate-400 tabular-nums">
                  {new Date(generatedAt).toLocaleTimeString(isEn ? 'en-US' : 'ar-YE', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              )}
            </div>
          </div>

          <div className="bg-[#08121E] border border-[var(--border-strong)] rounded-lg p-3 space-y-1.5 text-xs">
            <div className="font-black text-emerald-300">{aiResult.executiveSummary}</div>
            {aiResult.directAnswer && (
              <p className="text-slate-200 leading-relaxed">{aiResult.directAnswer}</p>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {aiResult.solutions.map((sol, idx) => (
              <div
                key={`${sol.title}-${idx}`}
                className="v20-card-alt p-3.5 space-y-2 flex flex-col justify-between"
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <h5 className="font-black text-xs text-white leading-snug">{sol.title}</h5>
                    <span className={`px-2 py-0.5 rounded border text-[10px] font-black shrink-0 ${severityBadgeClass(sol.priority)}`}>
                      {severityLabel(sol.priority)}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-300">
                    <span className="font-bold text-amber-300">
                      {isEn ? 'Root Cause: ' : 'السبب الجذري: '}
                    </span>
                    {sol.rootCause}
                  </div>
                  <ul className="space-y-1 text-[11px] text-slate-200">
                    {sol.actionSteps.map((step, sIdx) => (
                      <li key={sIdx} className="flex items-start gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                        <span>{step}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="pt-2 border-t border-[#1B2E44] flex items-center justify-between gap-2 text-[11px]">
                  <span className="text-sky-300 font-bold truncate">
                    {isEn ? 'Impact: ' : 'الأثر: '}
                    {sol.expectedImpact}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const fallbackByCat: Record<string, string> = {
                        accounting: 'accounting',
                        liquidity: 'treasury',
                        receivables: 'customers',
                        inventory: 'inventory',
                        currency: 'settings',
                        operations: 'expenses',
                      };
                      const validTargets = new Set([
                        'accounting',
                        'treasury',
                        'inventory',
                        'customers',
                        'vendors',
                        'sales',
                        'purchases',
                        'expenses',
                        'reports',
                        'settings',
                      ]);
                      const target = validTargets.has(sol.targetModule)
                        ? sol.targetModule
                        : fallbackByCat[sol.category] || 'reports';
                      onNavigateToRecord(target);
                    }}
                    className="px-2.5 py-1 rounded bg-[#08121E] border border-[var(--gold)] text-[var(--gold)] font-black flex items-center gap-1 shrink-0 cursor-pointer hover:bg-[var(--gold)] hover:text-[#03060A]"
                  >
                    <span>{isEn ? 'Open Module' : 'تنفيذ الحل'}</span>
                    <ArrowUpRight className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Instant Deterministic ERP Audit Findings */}
      <div className="v20-card p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-strong)] pb-2">
          <h4 className="font-black text-xs text-sky-300 flex items-center gap-1.5">
            <Layers className="w-4 h-4" />
            <span>
              {isEn
                ? `Instant Deterministic ERP Audit (${localFindings.length} Observations)`
                : `نتائج الفحص التلقائي المباشر لبيانات النظام (${localFindings.length} مؤشر وملاحظة)`}
            </span>
          </h4>
          <span className="text-[11px] text-slate-400 tabular-nums">
            {isEn
              ? `SAR Rate: ${snapshot.sarRate} YER · ${snapshot.activeInvoicesCount} Active Invoices`
              : `سعر الصرف: ${snapshot.sarRate} ر.ي · ${snapshot.activeInvoicesCount} فاتورة نشطة`}
          </span>
        </div>

        {localFindings.length === 0 ? (
          <div className="p-6 text-center text-emerald-300 text-xs font-bold flex flex-col items-center gap-2">
            <CheckCircle2 className="w-8 h-8" />
            <span>
              {isEn
                ? 'All accounting journals, treasury balances, and stock valuations passed deterministic health checks.'
                : 'جميع القيود المحاسبية وأرصدة الصناديق والمخزون سليمة ومتزنة بالكامل.'}
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {localFindings.map((finding) => (
              <div key={finding.id} className="v20-card-alt p-3 space-y-2 flex flex-col justify-between">
                <div className="space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 font-black text-xs text-white">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <span>{finding.title}</span>
                    </div>
                    <span className={`px-2 py-0.5 rounded border text-[10px] font-black shrink-0 ${severityBadgeClass(finding.severity)}`}>
                      {severityLabel(finding.severity)}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-300 leading-relaxed">{finding.detail}</p>
                  <p className="text-[11px] text-emerald-300 font-bold">
                    {isEn ? 'Action: ' : 'الحل المقترح: '}
                    {finding.recommendedAction}
                  </p>
                </div>
                <div className="pt-2 border-t border-[#1B2E44] flex items-center justify-between">
                  <span className="text-[10px] font-mono text-slate-400 tabular-nums">
                    {finding.metricValue || finding.category}
                  </span>
                  <button
                    type="button"
                    onClick={() => onNavigateToRecord(finding.moduleTarget, finding.recordId)}
                    className="px-2.5 py-1 rounded bg-[#08121E] border border-[var(--border-strong)] hover:border-[var(--gold)] text-[var(--gold)] text-[11px] font-black flex items-center gap-1 cursor-pointer"
                  >
                    <TrendingUp className="w-3 h-3" />
                    <span>{isEn ? 'Go to Fix' : 'انتقال للمعالجة'}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
