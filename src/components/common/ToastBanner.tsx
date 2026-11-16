/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Non-blocking Toast Banner
 */

import React from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}

interface ToastBannerProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export const ToastBanner: React.FC<ToastBannerProps> = ({ toasts, onDismiss }) => {
  if (!toasts || toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 left-4 z-[60] flex flex-col gap-2 max-w-md w-full px-4 pointer-events-none" dir="rtl">
      {toasts.map((t) => {
        const styles =
          t.type === 'success'
            ? 'bg-emerald-950/95 border-emerald-500/60 text-emerald-100'
            : t.type === 'error'
            ? 'bg-rose-950/95 border-rose-500/60 text-rose-100'
            : 'bg-slate-900/95 border-amber-500/60 text-slate-100';

        const Icon =
          t.type === 'success' ? CheckCircle2 : t.type === 'error' ? AlertTriangle : Info;

        return (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-2.5 p-3.5 rounded-xl border shadow-2xl backdrop-blur-md ${styles}`}
          >
            <Icon className="w-4 h-4 shrink-0 mt-0.5" />
            <p className="text-xs sm:text-sm font-medium flex-1 leading-relaxed">{t.message}</p>
            <button
              type="button"
              onClick={() => onDismiss(t.id)}
              className="p-0.5 rounded hover:bg-white/10 text-current/70 hover:text-current"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
