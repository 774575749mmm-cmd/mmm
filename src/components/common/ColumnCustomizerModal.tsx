/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Column Visibility & Ordering Modal
 */

import React, { useState, useEffect } from 'react';
import { X, ArrowUp, ArrowDown, RotateCcw, Columns3, Check, GripVertical } from 'lucide-react';
import { TableColumnPref } from '../../types/erp';

interface ColumnCustomizerModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  columns: TableColumnPref[];
  onSave: (updated: TableColumnPref[]) => void;
  onReset: () => void;
}

export const ColumnCustomizerModal: React.FC<ColumnCustomizerModalProps> = ({
  isOpen,
  onClose,
  title,
  columns,
  onSave,
  onReset,
}) => {
  const [localCols, setLocalCols] = useState<TableColumnPref[]>([]);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  useEffect(() => {
    if (isOpen) {
      setLocalCols([...columns].sort((a, b) => a.order - b.order));
    }
  }, [isOpen, columns]);

  if (!isOpen) return null;

  const toggleVisible = (key: string) => {
    const visibleCount = localCols.filter((c) => c.visible).length;
    setLocalCols((prev) =>
      prev.map((c) => {
        if (c.key !== key) return c;
        if (c.visible && visibleCount <= 1) return c; // Keep at least 1 visible column
        return { ...c, visible: !c.visible };
      })
    );
  };

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= localCols.length) return;
    const copy = [...localCols];
    const tmp = copy[index];
    copy[index] = copy[target];
    copy[target] = tmp;
    setLocalCols(copy.map((c, idx) => ({ ...c, order: idx })));
  };

  const handleDrop = (targetIdx: number) => {
    if (dragIdx === null || dragIdx === targetIdx) {
      setDragIdx(null);
      setOverIdx(null);
      return;
    }
    const copy = [...localCols];
    const [moved] = copy.splice(dragIdx, 1);
    copy.splice(targetIdx, 0, moved);
    setDragIdx(null);
    setOverIdx(null);
    setLocalCols(copy.map((c, idx) => ({ ...c, order: idx })));
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-4" dir="rtl">
      <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-900/90">
          <div className="flex items-center gap-2.5">
            <Columns3 className="w-5 h-5 text-amber-400" />
            <div>
              <h3 className="text-sm font-bold text-white">تخصيص وترتيب الأعمدة</h3>
              <p className="text-xs text-slate-400">{title} (اسحب وأفلت للترتيب)</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 max-h-96 overflow-y-auto space-y-2">
          {localCols.map((col, idx) => (
            <div
              key={col.key}
              draggable
              onDragStart={() => setDragIdx(idx)}
              onDragOver={(e) => {
                e.preventDefault();
                if (overIdx !== idx) setOverIdx(idx);
              }}
              onDragLeave={() => setOverIdx(null)}
              onDrop={(e) => {
                e.preventDefault();
                handleDrop(idx);
              }}
              onDragEnd={() => {
                setDragIdx(null);
                setOverIdx(null);
              }}
              className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border transition-colors ${
                overIdx === idx && dragIdx !== idx
                  ? 'bg-slate-800 border-amber-400'
                  : 'bg-slate-800/70 border-slate-700/70'
              }`}
            >
              <div className="flex items-center gap-2 flex-1">
                <span className="cursor-grab active:cursor-grabbing text-amber-400" title="اسحب للترتيب">
                  <GripVertical className="w-4 h-4" />
                </span>
                <label className="flex items-center gap-2.5 cursor-pointer flex-1 select-none">
                  <input
                    type="checkbox"
                    checked={col.visible}
                    onChange={() => toggleVisible(col.key)}
                    className="w-4 h-4 rounded accent-amber-500"
                  />
                  <span className={`text-sm ${col.visible ? 'text-slate-100 font-medium' : 'text-slate-500 line-through'}`}>
                    {col.label}
                  </span>
                </label>
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={idx === 0}
                  onClick={() => move(idx, -1)}
                  className="p-1 rounded bg-slate-900 text-slate-300 hover:text-amber-400 disabled:opacity-30"
                  title="تحريك للأعلى"
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  disabled={idx === localCols.length - 1}
                  onClick={() => move(idx, 1)}
                  className="p-1 rounded bg-slate-900 text-slate-300 hover:text-amber-400 disabled:opacity-30"
                  title="تحريك للأسفل"
                >
                  <ArrowDown className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between px-5 py-3.5 border-t border-slate-800 bg-slate-950/60">
          <button
            type="button"
            onClick={() => {
              onReset();
              onClose();
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800 border border-slate-700"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            استعادة الافتراضي
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-slate-300 hover:bg-slate-800"
            >
              إلغاء
            </button>
            <button
              type="button"
              onClick={() => {
                onSave(localCols.map((c, idx) => ({ ...c, order: idx })));
                onClose();
              }}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold bg-amber-500 hover:bg-amber-400 text-slate-950"
            >
              <Check className="w-3.5 h-3.5" />
              حفظ التنسيق
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
