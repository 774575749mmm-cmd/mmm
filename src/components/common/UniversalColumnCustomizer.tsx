/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Universal Column Order, Visibility & Width Customizer
 */

import React, { useState } from 'react';
import { SlidersHorizontal, ArrowUp, ArrowDown, Plus, Trash2, RotateCcw, X, GripVertical, Pin } from 'lucide-react';
import { TableColumnPref } from '../../types/erp';

interface UniversalColumnCustomizerProps {
  isOpen: boolean;
  title: string;
  columns: TableColumnPref[];
  allowAddCustom?: boolean;
  onChange: (updated: TableColumnPref[]) => void;
  onReset?: () => void;
  onClose: () => void;
}

export const UniversalColumnCustomizer: React.FC<UniversalColumnCustomizerProps> = ({
  isOpen,
  title,
  columns,
  allowAddCustom = false,
  onChange,
  onReset,
  onClose,
}) => {
  const [newColLabel, setNewColLabel] = useState('');
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  if (!isOpen) return null;

  const sorted = [...columns].sort((a, b) => a.order - b.order);

  const normalizeOrders = (list: TableColumnPref[]) =>
    list.map((c, idx) => ({ ...c, order: idx }));

  const toggleVisible = (key: string) => {
    const visibleCount = sorted.filter((c) => c.visible).length;
    const target = sorted.find((c) => c.key === key);
    if (target?.visible && visibleCount <= 1) return;
    onChange(
      sorted.map((c) => (c.key === key ? { ...c, visible: !c.visible } : c))
    );
  };

  const moveCol = (idx: number, dir: -1 | 1) => {
    const targetIdx = idx + dir;
    if (targetIdx < 0 || targetIdx >= sorted.length) return;
    const copy = [...sorted];
    const tmp = copy[idx];
    copy[idx] = copy[targetIdx];
    copy[targetIdx] = tmp;
    onChange(normalizeOrders(copy));
  };

  const handleDropReorder = (targetIdx: number) => {
    if (dragIndex === null || dragIndex === targetIdx) {
      setDragIndex(null);
      setDragOverIndex(null);
      return;
    }
    const copy = [...sorted];
    const [moved] = copy.splice(dragIndex, 1);
    copy.splice(targetIdx, 0, moved);
    setDragIndex(null);
    setDragOverIndex(null);
    onChange(normalizeOrders(copy));
  };

  const updateWidth = (key: string, widthVal: number) => {
    const w = Math.max(40, Math.min(500, widthVal || 100));
    onChange(sorted.map((c) => (c.key === key ? { ...c, width: w } : c)));
  };

  const updatePin = (key: string, pin: 'none' | 'right' | 'left') => {
    onChange(sorted.map((c) => (c.key === key ? { ...c, pin } : c)));
  };

  const updateAlign = (key: string, align: 'right' | 'center' | 'left') => {
    onChange(sorted.map((c) => (c.key === key ? { ...c, align } : c)));
  };

  const handleAddCustomCol = () => {
    const label = newColLabel.trim();
    if (!label) return;
    const next: TableColumnPref = {
      key: `custom_${Date.now()}`,
      label,
      visible: true,
      order: sorted.length,
      width: 130,
      pin: 'none',
      align: 'right',
    };
    onChange(normalizeOrders([...sorted, next]));
    setNewColLabel('');
  };

  const removeCustomCol = (key: string) => {
    onChange(normalizeOrders(sorted.filter((c) => c.key !== key)));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-xs"
      dir="rtl"
    >
      <div className="bg-[var(--bg-card)] border-[3px] border-[var(--gold)] rounded-xl w-full max-w-3xl max-h-[88vh] flex flex-col shadow-2xl overflow-hidden">
        <div className="px-4 py-3 bg-[#071019] border-b-2 border-[var(--gold)] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[var(--gold)] font-black text-sm sm:text-base">
            <SlidersHorizontal className="w-4 h-4" />
            <span>{title}</span>
          </div>
          <div className="flex items-center gap-2">
            {onReset && (
              <button
                type="button"
                onClick={onReset}
                className="px-2.5 py-1.5 rounded-md text-xs font-bold bg-[#08121E] border border-[var(--border-strong)] text-slate-200 hover:border-[var(--gold)] flex items-center gap-1 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>الافتراضي</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-2.5 py-1.5 rounded-md text-xs font-bold bg-[#2B0B0E] border border-[var(--danger)] text-[var(--danger)] hover:bg-[var(--danger)] hover:text-white flex items-center gap-1 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
              <span>إغلاق</span>
            </button>
          </div>
        </div>

        <div className="p-4 flex-1 overflow-y-auto space-y-3">
          <p className="text-xs text-[var(--text-secondary)]">
            اسحب الأعمدة وأفلتها لتغيير الترتيب، أو استخدم أزرار التثبيت والمحاذاة والعرض بالبكسل:
          </p>

          <div className="space-y-2 bg-[#060D15] p-3 rounded-lg border border-[var(--border-strong)]">
            {sorted.map((col, idx) => {
              const isCustom = col.key.startsWith('custom_');
              const isDragTarget = dragOverIndex === idx && dragIndex !== idx;
              return (
                <div
                  key={col.key}
                  draggable
                  onDragStart={() => setDragIndex(idx)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (dragOverIndex !== idx) setDragOverIndex(idx);
                  }}
                  onDragLeave={() => setDragOverIndex(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleDropReorder(idx);
                  }}
                  onDragEnd={() => {
                    setDragIndex(null);
                    setDragOverIndex(null);
                  }}
                  className={`flex flex-wrap items-center justify-between gap-2 bg-[var(--bg-card)] px-3 py-2 rounded-lg border transition-colors ${
                    isDragTarget
                      ? 'border-2 border-[var(--gold)] bg-[#132539]'
                      : dragIndex === idx
                      ? 'opacity-50 border-dashed border-[var(--gold)]'
                      : 'border-[var(--border-strong)]'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      title="اسحب وأفلت لإعادة الترتيب"
                      className="cursor-grab active:cursor-grabbing text-[var(--gold)] p-1 hover:bg-[#08121E] rounded"
                    >
                      <GripVertical className="w-4 h-4" />
                    </span>
                    <button
                      type="button"
                      onClick={() => moveCol(idx, -1)}
                      disabled={idx === 0}
                      title="نقل لأعلى"
                      className="p-1 rounded bg-[#08121E] border border-[var(--border-strong)] text-slate-200 hover:border-[var(--gold)] disabled:opacity-35 cursor-pointer"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveCol(idx, 1)}
                      disabled={idx === sorted.length - 1}
                      title="نقل لأسفل"
                      className="p-1 rounded bg-[#08121E] border border-[var(--border-strong)] text-slate-200 hover:border-[var(--gold)] disabled:opacity-35 cursor-pointer"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>

                    <label className="flex items-center gap-2 cursor-pointer text-white text-xs font-bold select-none">
                      <input
                        type="checkbox"
                        checked={col.visible}
                        onChange={() => toggleVisible(col.key)}
                        className="w-4 h-4 accent-amber-400 cursor-pointer"
                      />
                      <span>{col.label}</span>
                    </label>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-1 bg-[#050B12] border border-[var(--border-strong)] rounded px-1.5 py-0.5">
                      <Pin className="w-3 h-3 text-[var(--gold)]" />
                      <select
                        value={col.pin || 'none'}
                        onChange={(e) => updatePin(col.key, e.target.value as 'none' | 'right' | 'left')}
                        className="bg-transparent text-[11px] font-bold text-slate-200 focus:outline-none cursor-pointer"
                      >
                        <option value="none" className="bg-[#08121E]">حر</option>
                        <option value="right" className="bg-[#08121E]">تثبيت يمين</option>
                        <option value="left" className="bg-[#08121E]">تثبيت يسار</option>
                      </select>
                    </div>
                    <select
                      value={col.align || 'right'}
                      onChange={(e) => updateAlign(col.key, e.target.value as 'right' | 'center' | 'left')}
                      className="bg-[#050B12] border border-[var(--border-strong)] rounded px-1.5 py-1 text-[11px] font-bold text-slate-200 focus:outline-none cursor-pointer"
                    >
                      <option value="right">يمين</option>
                      <option value="center">وسط</option>
                      <option value="left">يسار</option>
                    </select>
                    <span className="text-[11px] text-[var(--text-secondary)]">العرض:</span>
                    <input
                      type="number"
                      min={40}
                      max={500}
                      value={col.width || 110}
                      onChange={(e) => updateWidth(col.key, parseInt(e.target.value, 10))}
                      className="w-16 bg-[#050B12] border border-[var(--border-strong)] rounded px-2 py-1 text-xs font-bold text-center text-white tabular-nums focus:border-[var(--gold)] focus:outline-none"
                    />
                    <span className="text-[10px] text-slate-400">px</span>
                    {isCustom && (
                      <button
                        type="button"
                        onClick={() => removeCustomCol(col.key)}
                        className="p-1 rounded bg-[#2B0B0E] border border-[var(--danger)] text-[var(--danger)] hover:bg-[var(--danger)] hover:text-white cursor-pointer"
                        title="حذف العمود الإضافي"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {allowAddCustom && (
            <div className="flex items-center gap-2 pt-2 border-t border-[var(--border-strong)]">
              <input
                type="text"
                value={newColLabel}
                onChange={(e) => setNewColLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddCustomCol();
                  }
                }}
                placeholder="اسم عمود إضافي جديد (مثال: رقم اللوت / المقاس)..."
                className="flex-1 bg-[#050B12] border-2 border-[var(--border-strong)] rounded-lg px-3 py-2 text-xs font-bold text-white focus:border-[var(--gold)] focus:outline-none"
              />
              <button
                type="button"
                onClick={handleAddCustomCol}
                className="px-3.5 py-2 rounded-lg text-xs font-black bg-[var(--gold)] text-[#03060A] hover:bg-[var(--gold-hover)] flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>إضافة عمود</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
