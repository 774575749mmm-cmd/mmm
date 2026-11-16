/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - True Multi-Window MDI Workspace Manager & Taskbar
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  LayoutGrid,
  Layers,
  Minus,
  Maximize2,
  Minimize2,
  X,
  AppWindow,
  MoveDiagonal2,
} from 'lucide-react';
import type { AppLanguage } from '../../services/i18n';

export type MdiWindowKind = 'workspace' | 'preview' | 'print';

export interface MdiBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MdiWindowRecord extends MdiBounds {
  id: string;
  title: string;
  kind: MdiWindowKind;
  minimized: boolean;
  maximized: boolean;
  zIndex: number;
}

interface RegisterOptions {
  title: string;
  kind: MdiWindowKind;
  defaultWidth?: number;
  defaultHeight?: number;
  onRequestClose?: () => void;
}

interface MdiWindowStateValue {
  windows: MdiWindowRecord[];
  activeWindowId: string | null;
}

interface MdiWindowActionsValue {
  registerWindow: (id: string, opts: RegisterOptions) => void;
  updateWindowMeta: (id: string, title: string, onRequestClose?: () => void) => void;
  unregisterWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  toggleMinimize: (id: string) => void;
  toggleMaximize: (id: string) => void;
  updateBounds: (id: string, bounds: Partial<MdiBounds>) => void;
  tileWindows: () => void;
  cascadeWindows: () => void;
  minimizeAll: () => void;
  closeWindow: (id: string) => void;
}

const MdiStateContext = createContext<MdiWindowStateValue | null>(null);
const MdiActionsContext = createContext<MdiWindowActionsValue | null>(null);

export function useMdiWindows(): (MdiWindowStateValue & MdiWindowActionsValue) | null {
  const st = useContext(MdiStateContext);
  const act = useContext(MdiActionsContext);
  return useMemo(() => (st && act ? { ...st, ...act } : null), [st, act]);
}

const TASKBAR_HEIGHT = 42;
const TOP_SAFE_OFFSET = 58;
const MIN_WIN_W = 420;
const MIN_WIN_H = 300;

function getViewportSize() {
  if (typeof window === 'undefined') return { vw: 1280, vh: 800 };
  return { vw: window.innerWidth, vh: window.innerHeight };
}

function clampBounds(b: MdiBounds): MdiBounds {
  const { vw, vh } = getViewportSize();
  const maxW = Math.max(MIN_WIN_W, vw - 16);
  const maxH = Math.max(MIN_WIN_H, vh - TASKBAR_HEIGHT - 16);
  const width = Math.max(MIN_WIN_W, Math.min(b.width, maxW));
  const height = Math.max(MIN_WIN_H, Math.min(b.height, maxH));
  const x = Math.max(8, Math.min(b.x, Math.max(8, vw - width - 8)));
  const y = Math.max(8, Math.min(b.y, Math.max(8, vh - TASKBAR_HEIGHT - 44)));
  return { x, y, width, height };
}

export const MdiWindowProvider: React.FC<{
  lang?: AppLanguage;
  children: React.ReactNode;
}> = ({ lang = 'ar', children }) => {
  const [state, setState] = useState<MdiWindowStateValue>({
    windows: [],
    activeWindowId: null,
  });
  const zCounterRef = useRef(200);
  const closeHandlersRef = useRef<Map<string, () => void>>(new Map());

  const registerWindow = useCallback((id: string, opts: RegisterOptions) => {
    if (opts.onRequestClose) {
      closeHandlersRef.current.set(id, opts.onRequestClose);
    }
    setState((prev) => {
      const existing = prev.windows.find((w) => w.id === id);
      zCounterRef.current += 1;
      const nextZ = zCounterRef.current;

      if (existing) {
        return {
          activeWindowId: id,
          windows: prev.windows.map((w) =>
            w.id === id ? { ...w, title: opts.title, kind: opts.kind, minimized: false, zIndex: nextZ } : w
          ),
        };
      }

      const { vw, vh } = getViewportSize();
      const idx = prev.windows.length;
      const defaultW = opts.defaultWidth || Math.min(1060, Math.max(620, vw - 90));
      const defaultH = opts.defaultHeight || Math.min(680, Math.max(440, vh - TASKBAR_HEIGHT - 120));
      const stagger = (idx % 6) * 28;
      const centeredX = Math.max(18, Math.round((vw - defaultW) / 2) + stagger - 36);
      const centeredY = Math.max(TOP_SAFE_OFFSET, Math.round((vh - defaultH - TASKBAR_HEIGHT) / 2) + stagger - 18);

      const initial = clampBounds({
        x: centeredX,
        y: centeredY,
        width: defaultW,
        height: defaultH,
      });

      return {
        activeWindowId: id,
        windows: [
          ...prev.windows,
          {
            id,
            title: opts.title,
            kind: opts.kind,
            minimized: false,
            maximized: false,
            zIndex: nextZ,
            ...initial,
          },
        ],
      };
    });
  }, []);

  const updateWindowMeta = useCallback((id: string, title: string, onRequestClose?: () => void) => {
    if (onRequestClose) {
      closeHandlersRef.current.set(id, onRequestClose);
    }
    setState((prev) => {
      const target = prev.windows.find((w) => w.id === id);
      if (!target || target.title === title) return prev;
      return {
        ...prev,
        windows: prev.windows.map((w) => (w.id === id ? { ...w, title } : w)),
      };
    });
  }, []);

  const unregisterWindow = useCallback((id: string) => {
    closeHandlersRef.current.delete(id);
    setState((prev) => {
      if (!prev.windows.some((w) => w.id === id) && prev.activeWindowId !== id) {
        return prev;
      }
      const nextWindows = prev.windows.filter((w) => w.id !== id);
      const nextActive = prev.activeWindowId === id ? null : prev.activeWindowId;
      return { windows: nextWindows, activeWindowId: nextActive };
    });
  }, []);

  const focusWindow = useCallback((id: string) => {
    setState((prev) => {
      const target = prev.windows.find((w) => w.id === id);
      if (!target) return prev;
      if (prev.activeWindowId === id && !target.minimized) {
        return prev;
      }
      zCounterRef.current += 1;
      const nextZ = zCounterRef.current;
      return {
        activeWindowId: id,
        windows: prev.windows.map((w) =>
          w.id === id ? { ...w, minimized: false, zIndex: nextZ } : w
        ),
      };
    });
  }, []);

  const toggleMinimize = useCallback((id: string) => {
    setState((prev) => {
      const target = prev.windows.find((w) => w.id === id);
      if (!target) return prev;
      const nextMin = !target.minimized;
      if (!nextMin) {
        zCounterRef.current += 1;
        const nextZ = zCounterRef.current;
        return {
          activeWindowId: id,
          windows: prev.windows.map((w) =>
            w.id === id ? { ...w, minimized: false, zIndex: nextZ } : w
          ),
        };
      }
      return {
        activeWindowId: prev.activeWindowId === id ? null : prev.activeWindowId,
        windows: prev.windows.map((w) => (w.id === id ? { ...w, minimized: true } : w)),
      };
    });
  }, []);

  const toggleMaximize = useCallback((id: string) => {
    setState((prev) => {
      if (!prev.windows.some((w) => w.id === id)) return prev;
      zCounterRef.current += 1;
      const nextZ = zCounterRef.current;
      return {
        activeWindowId: id,
        windows: prev.windows.map((w) =>
          w.id === id ? { ...w, minimized: false, maximized: !w.maximized, zIndex: nextZ } : w
        ),
      };
    });
  }, []);

  const updateBounds = useCallback((id: string, bounds: Partial<MdiBounds>) => {
    setState((prev) => {
      const target = prev.windows.find((w) => w.id === id);
      if (!target) return prev;
      const merged = clampBounds({
        x: bounds.x ?? target.x,
        y: bounds.y ?? target.y,
        width: bounds.width ?? target.width,
        height: bounds.height ?? target.height,
      });
      if (
        merged.x === target.x &&
        merged.y === target.y &&
        merged.width === target.width &&
        merged.height === target.height
      ) {
        return prev;
      }
      return {
        ...prev,
        windows: prev.windows.map((w) => (w.id === id ? { ...w, ...merged } : w)),
      };
    });
  }, []);

  const tileWindows = useCallback(() => {
    const { vw, vh } = getViewportSize();
    const usableTop = TOP_SAFE_OFFSET;
    const usableH = Math.max(MIN_WIN_H, vh - usableTop - TASKBAR_HEIGHT - 12);
    const usableW = Math.max(MIN_WIN_W, vw - 24);

    setState((prev) => {
      if (prev.windows.length === 0) return prev;
      const targets = prev.windows.filter((w) => !w.minimized);
      const list = targets.length > 0 ? targets : prev.windows;
      const count = list.length;
      const cols = count === 1 ? 1 : count <= 4 ? 2 : 3;
      const rows = Math.ceil(count / cols);
      const gap = 10;
      const cellW = Math.max(MIN_WIN_W, Math.floor((usableW - gap * (cols - 1)) / cols));
      const cellH = Math.max(MIN_WIN_H, Math.floor((usableH - gap * (rows - 1)) / rows));

      const mapPos = new Map<string, MdiBounds>();
      list.forEach((w, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        mapPos.set(w.id, {
          x: 12 + col * (cellW + gap),
          y: usableTop + row * (cellH + gap),
          width: cellW,
          height: cellH,
        });
      });

      return {
        ...prev,
        windows: prev.windows.map((w) => {
          const pos = mapPos.get(w.id);
          if (!pos) return w;
          return {
            ...w,
            minimized: false,
            maximized: false,
            ...pos,
          };
        }),
      };
    });
  }, []);

  const cascadeWindows = useCallback(() => {
    const { vw, vh } = getViewportSize();
    const baseW = Math.min(980, Math.max(560, Math.round(vw * 0.72)));
    const baseH = Math.min(640, Math.max(420, Math.round((vh - TASKBAR_HEIGHT) * 0.72)));

    setState((prev) => {
      if (prev.windows.length === 0) return prev;
      return {
        ...prev,
        windows: prev.windows.map((w, idx) => {
          zCounterRef.current += 1;
          const offset = (idx % 7) * 32;
          const bounds = clampBounds({
            x: 32 + offset,
            y: TOP_SAFE_OFFSET + offset,
            width: baseW,
            height: baseH,
          });
          return {
            ...w,
            minimized: false,
            maximized: false,
            zIndex: zCounterRef.current,
            ...bounds,
          };
        }),
      };
    });
  }, []);

  const minimizeAll = useCallback(() => {
    setState((prev) => {
      if (prev.windows.length === 0) return prev;
      return {
        activeWindowId: null,
        windows: prev.windows.map((w) => (w.minimized ? w : { ...w, minimized: true })),
      };
    });
  }, []);

  const closeWindow = useCallback(
    (id: string) => {
      const handler = closeHandlersRef.current.get(id);
      if (handler) {
        handler();
      } else {
        unregisterWindow(id);
      }
    },
    [unregisterWindow]
  );

  // Actions object NEVER changes identity so child useEffects don't re-run on window moves/updates
  const actions = useMemo<MdiWindowActionsValue>(
    () => ({
      registerWindow,
      updateWindowMeta,
      unregisterWindow,
      focusWindow,
      toggleMinimize,
      toggleMaximize,
      updateBounds,
      tileWindows,
      cascadeWindows,
      minimizeAll,
      closeWindow,
    }),
    [
      registerWindow,
      updateWindowMeta,
      unregisterWindow,
      focusWindow,
      toggleMinimize,
      toggleMaximize,
      updateBounds,
      tileWindows,
      cascadeWindows,
      minimizeAll,
      closeWindow,
    ]
  );

  const isEn = lang === 'en';

  return (
    <MdiActionsContext.Provider value={actions}>
      <MdiStateContext.Provider value={state}>
        <div className={state.windows.length > 0 ? 'pb-12' : ''}>{children}</div>

        {/* Global MDI Open Windows Taskbar */}
        {state.windows.length > 0 && (
          <div
            dir={isEn ? 'ltr' : 'rtl'}
            className="fixed bottom-0 inset-x-0 z-[9500] h-[42px] bg-[#060E18]/98 border-t-2 border-[var(--gold)] shadow-[0_-8px_30px_rgba(0,0,0,0.85)] px-2.5 flex items-center justify-between gap-2 no-print"
          >
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="hidden sm:inline-flex items-center gap-1 px-2 py-1 rounded bg-[#0D1A29] border border-[var(--border-strong)] text-[11px] font-black text-[var(--gold)] whitespace-nowrap">
                <AppWindow className="w-3.5 h-3.5" />
                <span>{isEn ? `Windows (${state.windows.length})` : `النوافذ (${state.windows.length})`}</span>
              </span>

              <button
                type="button"
                onClick={tileWindows}
                title={isEn ? 'Tile windows side-by-side' : 'ترتيب النوافذ متجاورة'}
                className="px-2 py-1 rounded bg-[#0C192A] border border-[var(--border-strong)] hover:border-[var(--gold)] text-[11px] font-bold text-slate-200 hover:text-[var(--gold)] flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer transition"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                <span className="hidden md:inline">{isEn ? 'Tile' : 'ترتيب متجاور'}</span>
              </button>

              <button
                type="button"
                onClick={cascadeWindows}
                title={isEn ? 'Cascade windows' : 'ترتيب متتالي'}
                className="px-2 py-1 rounded bg-[#0C192A] border border-[var(--border-strong)] hover:border-[var(--gold)] text-[11px] font-bold text-slate-200 hover:text-[var(--gold)] flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer transition"
              >
                <Layers className="w-3.5 h-3.5" />
                <span className="hidden md:inline">{isEn ? 'Cascade' : 'تتالي'}</span>
              </button>

              <button
                type="button"
                onClick={minimizeAll}
                title={isEn ? 'Minimize all windows' : 'تصغير كل النوافذ'}
                className="px-2 py-1 rounded bg-[#0C192A] border border-[var(--border-strong)] hover:border-sky-400 text-[11px] font-bold text-slate-300 hover:text-sky-300 flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer transition"
              >
                <Minus className="w-3.5 h-3.5" />
                <span className="hidden lg:inline">{isEn ? 'Min All' : 'تصغير الكل'}</span>
              </button>
            </div>

            <div className="flex-1 flex items-center gap-1.5 overflow-x-auto py-1">
              {state.windows.map((w) => {
                const isFocused = !w.minimized && state.activeWindowId === w.id;
                return (
                  <div
                    key={w.id}
                    className={`flex items-center gap-1.5 rounded border px-2 py-1 text-[11px] font-bold shrink-0 max-w-[230px] transition ${
                      isFocused
                        ? 'bg-[var(--gold)] text-[#03060A] border-[var(--gold)] shadow'
                        : w.minimized
                        ? 'bg-[#08121E] text-slate-400 border-slate-700 hover:border-slate-500'
                        : 'bg-[#0E1E32] text-slate-100 border-[var(--border-strong)] hover:border-[var(--gold)]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        if (isFocused) {
                          toggleMinimize(w.id);
                        } else {
                          focusWindow(w.id);
                        }
                      }}
                      className="truncate text-start cursor-pointer flex-1"
                      title={w.title}
                    >
                      {w.minimized ? `[—] ${w.title}` : w.title}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        closeWindow(w.id);
                      }}
                      className={`p-0.5 rounded cursor-pointer transition ${
                        isFocused
                          ? 'hover:bg-black/15 text-[#03060A]'
                          : 'hover:bg-rose-500/20 text-slate-400 hover:text-rose-300'
                      }`}
                      title={isEn ? 'Close window' : 'إغلاق النافذة'}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </MdiStateContext.Provider>
    </MdiActionsContext.Provider>
  );
};

interface MdiFloatingFrameProps {
  windowId: string;
  title: string;
  subtitle?: string;
  kind?: MdiWindowKind;
  defaultWidth?: number;
  defaultHeight?: number;
  dir?: 'rtl' | 'ltr';
  headerActions?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}

export const MdiFloatingFrame: React.FC<MdiFloatingFrameProps> = ({
  windowId,
  title,
  subtitle,
  kind = 'workspace',
  defaultWidth = 980,
  defaultHeight = 660,
  dir = 'rtl',
  headerActions,
  onClose,
  children,
}) => {
  const actions = useContext(MdiActionsContext);
  const state = useContext(MdiStateContext);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Register once per windowId
  useEffect(() => {
    if (!actions) return;
    actions.registerWindow(windowId, {
      title,
      kind,
      defaultWidth,
      defaultHeight,
      onRequestClose: () => onCloseRef.current(),
    });
    return () => {
      actions.unregisterWindow(windowId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actions, windowId]);

  // Keep title synced only when title changes
  useEffect(() => {
    actions?.updateWindowMeta(windowId, title, () => onCloseRef.current());
  }, [actions, windowId, title]);

  const win = state?.windows.find((w) => w.id === windowId);
  const isFocused = state?.activeWindowId === windowId;

  const dragStateRef = useRef<{
    mode: 'drag' | 'resize-br' | 'resize-bl';
    startX: number;
    startY: number;
    orig: MdiBounds;
  } | null>(null);

  useEffect(() => {
    if (!actions) return;
    const handlePointerMove = (e: PointerEvent) => {
      const st = dragStateRef.current;
      if (!st) return;
      const dx = e.clientX - st.startX;
      const dy = e.clientY - st.startY;
      if (st.mode === 'drag') {
        actions.updateBounds(windowId, {
          x: st.orig.x + dx,
          y: st.orig.y + dy,
        });
      } else if (st.mode === 'resize-br') {
        actions.updateBounds(windowId, {
          width: Math.max(MIN_WIN_W, st.orig.width + dx),
          height: Math.max(MIN_WIN_H, st.orig.height + dy),
        });
      } else if (st.mode === 'resize-bl') {
        const nextWidth = Math.max(MIN_WIN_W, st.orig.width - dx);
        const appliedDx = st.orig.width - nextWidth;
        actions.updateBounds(windowId, {
          x: st.orig.x + appliedDx,
          width: nextWidth,
          height: Math.max(MIN_WIN_H, st.orig.height + dy),
        });
      }
    };

    const handlePointerUp = () => {
      dragStateRef.current = null;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [actions, windowId]);

  const startDrag = (e: React.PointerEvent) => {
    if (!win || win.maximized) return;
    if ((e.target as HTMLElement).closest('button, input, select, a')) return;
    e.preventDefault();
    actions?.focusWindow(windowId);
    dragStateRef.current = {
      mode: 'drag',
      startX: e.clientX,
      startY: e.clientY,
      orig: { x: win.x, y: win.y, width: win.width, height: win.height },
    };
  };

  const startResize = (mode: 'resize-br' | 'resize-bl') => (e: React.PointerEvent) => {
    if (!win || win.maximized) return;
    e.preventDefault();
    e.stopPropagation();
    actions?.focusWindow(windowId);
    dragStateRef.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      orig: { x: win.x, y: win.y, width: win.width, height: win.height },
    };
  };

  // Fallback geometry before first effect tick
  const bounds: MdiBounds = win || {
    x: 40,
    y: 70,
    width: Math.min(defaultWidth, typeof window !== 'undefined' ? window.innerWidth - 60 : defaultWidth),
    height: Math.min(defaultHeight, typeof window !== 'undefined' ? window.innerHeight - 120 : defaultHeight),
  };

  const style: React.CSSProperties = win?.minimized
    ? { display: 'none' }
    : win?.maximized
    ? {
        position: 'fixed',
        top: 6,
        left: 6,
        right: 6,
        bottom: TASKBAR_HEIGHT + 6,
        zIndex: win.zIndex,
      }
    : {
        position: 'fixed',
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        height: bounds.height,
        zIndex: win?.zIndex || 220,
      };

  return (
    <div
      dir={dir}
      style={style}
      onPointerDown={() => actions?.focusWindow(windowId)}
      className={`flex flex-col rounded-xl overflow-hidden bg-[var(--bg-card)] shadow-[0_24px_65px_rgba(0,0,0,0.88)] transition-shadow no-print ${
        isFocused
          ? 'border-2 border-[var(--gold)]'
          : 'border-2 border-[#355276]'
      }`}
    >
      {/* Draggable Title Bar */}
      <div
        onPointerDown={startDrag}
        onDoubleClick={() => actions?.toggleMaximize(windowId)}
        className={`px-3 py-2 border-b-2 flex items-center justify-between gap-2 flex-wrap shrink-0 select-none ${
          win?.maximized ? 'cursor-default' : 'cursor-move'
        } ${
          isFocused
            ? 'bg-gradient-to-l from-[#071019] to-[#13263E] border-[var(--gold)]'
            : 'bg-[#09131F] border-[#2C4563]'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <AppWindow className={`w-4 h-4 shrink-0 ${isFocused ? 'text-[var(--gold)]' : 'text-slate-400'}`} />
          <div className="min-w-0">
            <div className={`font-black text-xs sm:text-sm truncate ${isFocused ? 'text-[var(--gold)]' : 'text-slate-200'}`}>
              {title}
            </div>
            {subtitle && (
              <div className="text-[10px] text-slate-400 truncate">{subtitle}</div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap shrink-0">
          {headerActions}

          <button
            type="button"
            onClick={() => actions?.toggleMinimize(windowId)}
            title={dir === 'ltr' ? 'Minimize to taskbar' : 'تصغير للشريط السفلي'}
            className="px-2 py-1.5 rounded-md text-xs font-bold bg-[#08121E] border border-[var(--border-strong)] text-slate-200 hover:border-sky-400 hover:text-sky-300 cursor-pointer"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => actions?.toggleMaximize(windowId)}
            title={win?.maximized ? (dir === 'ltr' ? 'Restore' : 'استعادة الحجم') : (dir === 'ltr' ? 'Maximize' : 'تكبير ملء الشاشة')}
            className="px-2 py-1.5 rounded-md text-xs font-bold bg-[#08121E] border border-[var(--border-strong)] text-white hover:border-[var(--gold)] cursor-pointer"
          >
            {win?.maximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>

          <button
            type="button"
            onClick={() => onCloseRef.current()}
            title={dir === 'ltr' ? 'Close' : 'إغلاق'}
            className="px-2.5 py-1.5 rounded-md text-xs font-bold bg-[#2B0B0E] border border-[var(--danger)] text-[var(--danger)] hover:bg-[var(--danger)] hover:text-white flex items-center gap-1 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{dir === 'ltr' ? 'Close' : 'إغلاق'}</span>
          </button>
        </div>
      </div>

      {/* Window Content Viewport */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden bg-[#071019] relative">
        {children}
      </div>

      {/* Bottom Resize Handles (available when floating) */}
      {!win?.maximized && (
        <>
          <div
            onPointerDown={startResize('resize-br')}
            title={dir === 'ltr' ? 'Resize window' : 'تغيير حجم النافذة'}
            className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize z-30 flex items-end justify-end p-0.5 text-[var(--gold)]/75 hover:text-[var(--gold)]"
          >
            <MoveDiagonal2 className="w-3 h-3" />
          </div>
          <div
            onPointerDown={startResize('resize-bl')}
            title={dir === 'ltr' ? 'Resize window' : 'تغيير حجم النافذة'}
            className="absolute bottom-0 left-0 w-4 h-4 cursor-nesw-resize z-30"
          />
        </>
      )}
    </div>
  );
};
