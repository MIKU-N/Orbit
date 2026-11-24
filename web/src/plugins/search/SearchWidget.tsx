import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { AppIcon } from '../../sdk/primitives';
import type { SearchSuggestion } from '../../sdk/types';
import type { SearchEngine } from '../../types';

interface SearchWidgetProps {
  engines: SearchEngine[];
  activeEngineId: string;
  iconOnly: boolean;
  guestMode?: boolean;
  onSelectEngine: (id: string) => void;
  onOpenEngineManager: () => void;
  searchAcrossPlugins: (query: string) => SearchSuggestion[];
  onElevatingChange: (elevated: boolean) => void;
  onToast: (msg: string, warn?: boolean) => void;
  inputRef: React.RefObject<HTMLInputElement>;
}

export function SearchWidget({
  engines,
  activeEngineId,
  iconOnly,
  guestMode = false,
  onSelectEngine,
  onOpenEngineManager,
  searchAcrossPlugins,
  onElevatingChange,
  onToast,
  inputRef,
}: SearchWidgetProps) {
  const [query, setQuery] = useState('');
  const [engineMenuOpen, setEngineMenuOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const activeEngine = engines.find((e) => e.id === activeEngineId) || engines[0];
  const trimmed = query.trim();
  const showSuggestions = focused && trimmed.length > 0;

  useEffect(() => {
    onElevatingChange(engineMenuOpen || showSuggestions);
  }, [engineMenuOpen, showSuggestions, onElevatingChange]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setEngineMenuOpen(false);
        setFocused(false);
      }
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);

  const handleChange = (val: string) => {
    const pm = val.match(/^([a-zA-Z]{1,3})\s+(.*)$/);
    if (pm) {
      const matchEng = engines.find((e) => e.key.toLowerCase() === pm[1].toLowerCase());
      if (matchEng && matchEng.id !== activeEngineId) {
        onSelectEngine(matchEng.id);
        setQuery(pm[2]);
        return;
      }
    }
    setQuery(val);
  };

  const executeSearch = () => {
    if (!trimmed) return;
    if (!activeEngine?.url) {
      onToast('当前为仅站内检索模式', true);
      return;
    }
    const target = activeEngine.url.replace('{q}', encodeURIComponent(trimmed));
    window.open(target, '_blank', 'noopener,noreferrer');
    setQuery('');
    setFocused(false);
  };

  const suggestions = trimmed ? searchAcrossPlugins(trimmed) : [];

  return (
    <div ref={wrapRef} className="relative w-full">
      <div className="glass rounded-2xl p-1.5 flex items-center gap-2 focus-within:border-[var(--glass-border-hover)]">
        <button
          type="button"
          onClick={() => setEngineMenuOpen((v) => !v)}
          title={`${activeEngine?.name || 'Google'} (${activeEngine?.key || 'g'}，Tab 切换)`}
          className={`h-9 rounded-xl flex items-center justify-center shrink-0 cursor-pointer transition-colors ${
            iconOnly ? 'w-9' : 'pl-2.5 pr-2 gap-1.5 text-xs font-medium'
          }`}
          style={{ background: 'var(--pill-bg)' }}
        >
          <AppIcon
            icon={activeEngine?.icon}
            title={activeEngine?.name || 'G'}
            color={activeEngine?.color || '#60a5fa'}
            boxClass="w-5 h-5"
            iconClass="w-3.5 h-3.5"
            roundedClass="rounded-md"
          />
          {!iconOnly && (
            <>
              <span className="hidden sm:inline">{activeEngine?.name || 'Google'}</span>
              <ChevronDown className="w-3 h-3 opacity-60" />
            </>
          )}
        </button>

        <input
          ref={inputRef}
          type="text"
          value={query}
          autoComplete="off"
          placeholder={iconOnly ? `${activeEngine?.name || '搜索'}...` : '搜索...'}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={(e) => {
            if (e.key === 'Tab') {
              e.preventDefault();
              const idx = engines.findIndex((x) => x.id === activeEngine?.id);
              const next = engines[(idx + 1) % engines.length];
              if (next) onSelectEngine(next.id);
            } else if (e.key === 'Enter') {
              e.preventDefault();
              executeSearch();
            } else if (e.key === 'Escape') {
              setQuery('');
              setFocused(false);
              setEngineMenuOpen(false);
              (e.target as HTMLInputElement).blur();
            }
          }}
          className="flex-1 h-9 bg-transparent text-sm focus:outline-none min-w-0"
          style={{ color: 'var(--ink)' }}
        />

        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              inputRef.current?.focus();
            }}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-xs cursor-pointer"
            style={{ color: 'var(--ink-muted)' }}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}

        <button
          type="button"
          onClick={executeSearch}
          className="h-9 w-9 rounded-xl flex items-center justify-center text-white cursor-pointer hover:opacity-90 shrink-0"
          style={{ background: 'var(--brand-solid)' }}
          title="搜索"
        >
          <Search className="w-4 h-4" />
        </button>
      </div>

      {engineMenuOpen && (
        <div className="absolute left-0 top-14 w-64 glass-strong rounded-2xl p-1.5 z-50 pop-in space-y-0.5">
          <div
            className="px-2.5 py-1 flex items-center justify-between text-xs"
            style={{ color: 'var(--ink-muted)' }}
          >
            <span>搜索引擎</span>
            {!guestMode && (
              <button
                type="button"
                onClick={() => {
                  setEngineMenuOpen(false);
                  onOpenEngineManager();
                }}
                className="hover:underline cursor-pointer"
                style={{ color: 'var(--brand)' }}
              >
                管理与图标
              </button>
            )}
          </div>
          {engines.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => {
                onSelectEngine(e.id);
                setEngineMenuOpen(false);
                inputRef.current?.focus();
              }}
              className="w-full px-2.5 py-1.5 rounded-xl flex items-center justify-between text-xs cursor-pointer"
              style={{
                background: e.id === activeEngine?.id ? 'var(--pill-hover)' : 'transparent',
              }}
            >
              <span className="flex items-center gap-2 min-w-0">
                <AppIcon
                  icon={e.icon}
                  title={e.name}
                  color={e.color}
                  boxClass="w-5 h-5"
                  iconClass="w-3.5 h-3.5"
                  roundedClass="rounded-md"
                />
                <span className="truncate">{e.name}</span>
              </span>
              <span className="kbd-chip shrink-0">{e.key}</span>
            </button>
          ))}
        </div>
      )}

      {showSuggestions && (
        <div className="absolute left-0 right-0 top-14 glass-strong rounded-2xl p-1.5 z-50 pop-in max-h-64 overflow-y-auto space-y-0.5">
          {suggestions.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                s.action();
                setQuery('');
                setFocused(false);
              }}
              className="w-full px-3 py-2 rounded-xl flex items-center justify-between gap-2 text-xs hover:bg-white/10 cursor-pointer text-left"
            >
              <span className="flex items-center gap-2 min-w-0">
                {s.icon !== undefined ? (
                  <AppIcon
                    icon={s.icon}
                    title={s.title}
                    color={s.color}
                    boxClass="w-5 h-5"
                    iconClass="w-3 h-3"
                    roundedClass="rounded-md"
                  />
                ) : (
                  <span className="kbd-chip shrink-0">{s.sourceLabel}</span>
                )}
                <span className="font-medium truncate">{s.title}</span>
              </span>
              {s.subtitle && (
                <span
                  className="font-mono truncate max-w-[46%]"
                  style={{ color: 'var(--ink-muted)' }}
                >
                  {s.subtitle}
                </span>
              )}
            </button>
          ))}

          {activeEngine?.url && (
            <button
              type="button"
              onClick={executeSearch}
              className="w-full px-3 py-2 rounded-xl flex items-center justify-between gap-2 text-xs hover:bg-white/10 cursor-pointer text-left border-t mt-1"
              style={{ borderColor: 'var(--glass-border)' }}
            >
              <span>
                {activeEngine.name}：{trimmed}
              </span>
              <span className="kbd-chip">↵</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
