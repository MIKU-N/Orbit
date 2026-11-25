import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

export interface OrbitSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface OrbitSelectProps {
  value: string | number;
  options: OrbitSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
  ariaLabel?: string;
}

function readShellThemeVars(): { glassTheme: string; styleVars: Record<string, string> } {
  const shell = document.querySelector<HTMLElement>('.orbit-shell');
  const glassTheme = shell?.getAttribute('data-glass') || 'dark';
  const styleVars: Record<string, string> = {};
  if (shell) {
    const cs = getComputedStyle(shell);
    for (const k of [
      '--glass-blur',
      '--glass-alpha',
      '--glass-rgb',
      '--glass-strong-rgb',
      '--glass-border',
      '--glass-border-hover',
      '--glass-highlight',
      '--ink',
      '--ink-muted',
      '--ink-subtle',
      '--pill-bg',
      '--pill-hover',
      '--hover-bg',
      '--brand',
      '--brand-solid',
      '--radius-card',
      '--radius-lg',
      '--radius-sm',
      '--orbit-font',
    ]) {
      const v = cs.getPropertyValue(k).trim();
      if (v) styleVars[k] = v;
    }
  }
  return { glassTheme, styleVars };
}

export function OrbitSelect({
  value,
  options,
  onChange,
  placeholder = '请选择',
  disabled = false,
  size = 'sm',
  className = '',
  ariaLabel,
}: OrbitSelectProps) {
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const [menuPos, setMenuPos] = useState<{
    left: number;
    top: number;
    width: number;
    openUp: boolean;
    maxHeight: number;
  } | null>(null);
  const [themeSnapshot, setThemeSnapshot] = useState<{
    glassTheme: string;
    styleVars: Record<string, string>;
  }>({ glassTheme: 'dark', styleVars: {} });

  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const strValue = String(value);
  const selected = options.find((o) => o.value === strValue);

  const computePos = useCallback(() => {
    const btn = triggerRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const spaceAbove = rect.top - 12;
    const estHeight = Math.min(240, options.length * 34 + 12);
    const openUp = spaceBelow < estHeight && spaceAbove > spaceBelow;
    const maxHeight = Math.max(120, Math.min(240, openUp ? spaceAbove : spaceBelow));
    const width = Math.max(rect.width, 132);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const top = openUp ? rect.top - 6 : rect.bottom + 6;
    setMenuPos({ left, top, width, openUp, maxHeight });
  }, [options.length]);

  useLayoutEffect(() => {
    if (!open) return;
    setThemeSnapshot(readShellThemeVars());
    computePos();
    const curIdx = options.findIndex((o) => o.value === strValue);
    setHighlightIdx(curIdx >= 0 ? curIdx : 0);
  }, [open, computePos, options, strValue]);

  useEffect(() => {
    if (!open) return;
    const onOutside = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onResizeOrScroll = (e: Event) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) {
        return;
      }
      computePos();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightIdx((i) => {
          let next = i + 1;
          while (next < options.length && options[next]?.disabled) next += 1;
          return next < options.length ? next : i;
        });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightIdx((i) => {
          let next = i - 1;
          while (next >= 0 && options[next]?.disabled) next -= 1;
          return next >= 0 ? next : i;
        });
      } else if (e.key === 'Enter' && highlightIdx >= 0 && options[highlightIdx] && !options[highlightIdx].disabled) {
        e.preventDefault();
        onChange(options[highlightIdx].value);
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onOutside, true);
    window.addEventListener('resize', onResizeOrScroll);
    window.addEventListener('scroll', onResizeOrScroll, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', onOutside, true);
      window.removeEventListener('resize', onResizeOrScroll);
      window.removeEventListener('scroll', onResizeOrScroll, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open, computePos, highlightIdx, onChange, options]);

  const heightCls = size === 'xs' ? 'h-7 px-2 text-[11px]' : size === 'md' ? 'h-9 px-3 text-xs' : 'h-8 px-2.5 text-xs';

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={(e) => {
          e.stopPropagation();
          if (!disabled) setOpen((v) => !v);
        }}
        className={`orbit-select-trigger ${heightCls} rounded-lg inline-flex items-center justify-between gap-2 text-left transition-colors focus:outline-none disabled:opacity-45 cursor-pointer ${className}`}
        style={{
          background: 'var(--input-bg, var(--pill-bg))',
          border: `1px solid ${open ? 'var(--brand)' : 'var(--glass-border)'}`,
          color: selected ? 'var(--ink)' : 'var(--ink-subtle)',
          boxShadow: open ? '0 0 0 2px rgba(99, 102, 241, 0.22)' : undefined,
        }}
      >
        <span className="truncate flex-1 min-w-0">{selected ? selected.label : placeholder}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 shrink-0 opacity-65 transition-transform duration-150 ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open &&
        menuPos &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            data-glass={themeSnapshot.glassTheme}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="orbit-shell fixed z-[120] glass-strong rounded-xl p-1 overflow-y-auto pop-in shadow-2xl text-xs"
            style={{
              ...themeSnapshot.styleVars,
              left: `${menuPos.left}px`,
              top: menuPos.openUp ? undefined : `${menuPos.top}px`,
              bottom: menuPos.openUp ? `${window.innerHeight - menuPos.top}px` : undefined,
              width: `${menuPos.width}px`,
              maxHeight: `${menuPos.maxHeight}px`,
            } as React.CSSProperties}
          >
            {options.map((opt, idx) => {
              const isSelected = opt.value === strValue;
              const isHighlighted = idx === highlightIdx;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  disabled={opt.disabled}
                  onMouseEnter={() => setHighlightIdx(idx)}
                  onClick={() => {
                    if (opt.disabled) return;
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  className="w-full px-2.5 py-1.5 rounded-lg flex items-center justify-between gap-2 text-left transition-colors cursor-pointer disabled:opacity-40"
                  style={{
                    background: isSelected
                      ? 'var(--brand-solid)'
                      : isHighlighted
                        ? 'var(--hover-bg, var(--pill-hover))'
                        : 'transparent',
                    color: isSelected ? '#ffffff' : 'var(--ink)',
                  }}
                >
                  <span className="truncate">{opt.label}</span>
                  {isSelected && <Check className="w-3.5 h-3.5 shrink-0" />}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
