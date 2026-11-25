import { useEffect, useState } from 'react';

interface RangeFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (val: number) => void;
}

export function RangeField({
  label,
  value,
  min,
  max,
  step = 1,
  unit = '',
  onChange,
}: RangeFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    if (!editing) {
      setDraft(String(value));
    }
  }, [value, editing]);

  const pct = max > min ? Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100)) : 0;

  const commit = () => {
    const parsed = Number(draft.trim());
    if (!Number.isNaN(parsed)) {
      const clamped = Math.max(min, Math.min(max, Math.round(parsed / step) * step));
      onChange(clamped);
    }
    setEditing(false);
  };

  return (
    <div className="p-3 rounded-xl space-y-2" style={{ background: 'var(--pill-bg)' }}>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span style={{ color: 'var(--ink-muted)' }}>{label}</span>
        {editing ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              type="number"
              min={min}
              max={max}
              step={step}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commit();
                } else if (e.key === 'Escape') {
                  setDraft(String(value));
                  setEditing(false);
                }
              }}
              className="w-16 h-6 px-1.5 rounded-md font-mono text-right focus:outline-none"
              style={{
                background: 'rgba(var(--glass-rgb), 0.65)',
                border: '1px solid var(--brand)',
                color: 'var(--ink)',
              }}
            />
            {unit && <span className="font-mono opacity-70">{unit}</span>}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraft(String(value));
              setEditing(true);
            }}
            title="点击直接输入精确数值"
            className="font-mono px-1.5 py-0.5 rounded-md orbit-hover cursor-text transition-colors"
            style={{ color: 'var(--ink)' }}
          >
            {value}
            {unit}
          </button>
        )}
      </div>

      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="orbit-range w-full"
        style={{ '--range-pct': `${pct.toFixed(1)}%` } as React.CSSProperties}
      />
    </div>
  );
}
