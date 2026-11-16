/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Contextual Operational Help Modal
 */

import React from 'react';
import { HelpCircle, X, CheckCircle2, AlertTriangle, BookOpen, Layers } from 'lucide-react';

export interface HelpTopic {
  title: string;
  purpose: string;
  responsibleRole: string;
  operationalSteps: string[];
  accountingImpact: string;
  inventoryImpact: string;
  commonMistakes: string[];
  bestPractices: string;
}

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
  topic: HelpTopic;
  lang?: 'ar' | 'en';
}

export const HelpModal: React.FC<HelpModalProps> = ({ isOpen, onClose, topic, lang = 'ar' }) => {
  if (!isOpen) return null;
  const isEn = lang === 'en';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200" dir={isEn ? 'ltr' : 'rtl'}>
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl text-slate-100 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-800 bg-slate-900/90 sticky top-0 backdrop-blur z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-100">{topic.title}</h3>
              <p className="text-xs text-slate-400">
                {isEn ? 'Standard Operational & Accounting Quick Guide' : 'الدليل التشغيلي والمحاسبي المعتمد للإجراء'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 text-sm">
          {/* Purpose & Responsible */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-slate-950/50 p-4 rounded-xl border border-slate-800">
              <span className="text-xs font-semibold text-amber-400 block mb-1">الهدف التشغيلي</span>
              <p className="text-slate-300 leading-relaxed">{topic.purpose}</p>
            </div>
            <div className="bg-slate-950/50 p-4 rounded-xl border border-slate-800">
              <span className="text-xs font-semibold text-amber-400 block mb-1">المستخدم المسؤول</span>
              <p className="text-slate-300 leading-relaxed">{topic.responsibleRole}</p>
            </div>
          </div>

          {/* Operational Steps */}
          <div>
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              خطوات تنفيذ العملية خطوة بخطوة
            </h4>
            <ol className="space-y-2">
              {topic.operationalSteps.map((step, idx) => (
                <li key={idx} className="flex items-start gap-3 bg-slate-800/40 p-3 rounded-lg border border-slate-800/80">
                  <span className="w-5 h-5 rounded-full bg-slate-700 text-amber-400 text-xs flex items-center justify-center font-bold shrink-0 mt-0.5">
                    {idx + 1}
                  </span>
                  <span className="text-slate-200">{step}</span>
                </li>
              ))}
            </ol>
          </div>

          {/* Financial & Inventory Impacts */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <Layers className="w-4 h-4 text-amber-400" />
              الأثر المحاسبي والتشغيلي المترابط
            </h4>
            <div className="bg-slate-950/60 p-3.5 rounded-lg border border-slate-800 text-xs space-y-2">
              <div>
                <strong className="text-amber-300">الأثر المالي والقيد المحاسبي: </strong>
                <span className="text-slate-300">{topic.accountingImpact}</span>
              </div>
              <div>
                <strong className="text-sky-300">الأثر على المخزون والمستودع: </strong>
                <span className="text-slate-300">{topic.inventoryImpact}</span>
              </div>
            </div>
          </div>

          {/* Common Mistakes */}
          <div className="bg-rose-950/20 border border-rose-900/30 p-4 rounded-xl">
            <h4 className="text-xs font-bold text-rose-300 flex items-center gap-2 mb-2">
              <AlertTriangle className="w-4 h-4 text-rose-400" />
              أخطاء تشغيلية شائعة يجب تجنبها
            </h4>
            <ul className="list-disc list-inside space-y-1 text-xs text-rose-200/90">
              {topic.commonMistakes.map((mistake, idx) => (
                <li key={idx}>{mistake}</li>
              ))}
            </ul>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-900/80 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-colors"
          >
            {isEn ? 'Close Guide' : 'إغلاق الدليل'}
          </button>
        </div>
      </div>
    </div>
  );
};
