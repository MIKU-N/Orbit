import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Pause, Play, Quote, RefreshCw, Settings2 } from 'lucide-react';
import { api } from '../../api/client';
import { MotionCard } from '../../sdk/primitives';
import type { HitokotoConfig, HitokotoQuote } from '../../types';

interface HitokotoWidgetProps {
  config: HitokotoConfig;
  enableTilt: boolean;
  layoutEditing: boolean;
  readOnly?: boolean;
  onCopy: (text: string, label?: string) => void;
  onOpenSettings: () => void;
}

const LOCAL_FALLBACK_QUOTES: HitokotoQuote[] = [
  { text: '凡是过往，皆为序章。', from: '暴风雨', from_who: '莎士比亚', source: 'builtin' },
  { text: '星光不问赶路人，时光不负有心人。', from: '随笔', from_who: '', source: 'builtin' },
  { text: '行到水穷处，坐看云起时。', from: '终南别业', from_who: '王维', source: 'builtin' },
  { text: '保持热爱，奔赴下一场山海。', from: '随笔', from_who: '', source: 'builtin' },
  { text: '醉后不知天在水，满船清梦压星河。', from: '题龙阳县青草湖', from_who: '唐温如', source: 'builtin' },
  { text: '万物皆有裂痕，那是光照进来的地方。', from: 'Anthem', from_who: '莱昂纳德·科恩', source: 'builtin' },
];

function parseCustomLines(lines: string[]): HitokotoQuote[] {
  return lines
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((line) => {
      const sepIdx = line.indexOf('|');
      if (sepIdx > 0) {
        return {
          text: line.slice(0, sepIdx).trim(),
          from: line.slice(sepIdx + 1).trim(),
          from_who: '',
          source: 'custom' as const,
        };
      }
      return { text: line, from: '', from_who: '', source: 'custom' as const };
    })
    .filter((q) => q.text.length > 0);
}

export function HitokotoWidget({
  config,
  enableTilt,
  layoutEditing,
  readOnly = false,
  onCopy,
  onOpenSettings,
}: HitokotoWidgetProps) {
  const [builtinPool, setBuiltinPool] = useState<HitokotoQuote[]>(LOCAL_FALLBACK_QUOTES);
  const [quote, setQuote] = useState<HitokotoQuote>(LOCAL_FALLBACK_QUOTES[0]);
  const [loading, setLoading] = useState(false);
  const [paused, setPaused] = useState(false);
  const lastTextRef = useRef(LOCAL_FALLBACK_QUOTES[0].text);
  const customIdxRef = useRef(0);

  const customParsed = useMemo(
    () => parseCustomLines(config.customQuotes || []),
    [config.customQuotes],
  );

  const localPool = useMemo(
    () => (customParsed.length > 0 ? [...customParsed, ...builtinPool] : builtinPool),
    [builtinPool, customParsed],
  );

  useEffect(() => {
    void api
      .listBuiltinHitokoto()
      .then((res) => {
        if (Array.isArray(res.quotes) && res.quotes.length > 0) {
          setBuiltinPool(res.quotes);
        }
      })
      .catch(() => {});
  }, []);

  const pickLocalNext = useCallback((): HitokotoQuote => {
    const pool = localPool.length > 0 ? localPool : LOCAL_FALLBACK_QUOTES;
    if (pool.length === 1) return pool[0];
    // Rotate sequentially through custom quotes first when user added custom lines in builtin mode
    if (customParsed.length > 0 && config.mode === 'builtin') {
      const idx = customIdxRef.current % pool.length;
      customIdxRef.current += 1;
      const cand = pool[idx];
      if (cand.text !== lastTextRef.current) return cand;
    }
    for (let i = 0; i < 6; i += 1) {
      const cand = pool[Math.floor(Math.random() * pool.length)];
      if (cand.text !== lastTextRef.current) return cand;
    }
    return pool[0];
  }, [config.mode, customParsed.length, localPool]);

  const fetchNext = useCallback(
    async (manual = false) => {
      if (config.mode === 'builtin') {
        const next = pickLocalNext();
        lastTextRef.current = next.text;
        setQuote(next);
        return;
      }

      setLoading(true);
      try {
        const res = await api.getHitokoto({
          mode: config.mode,
          types: config.types,
          apiUrl: config.apiUrl,
          exclude: lastTextRef.current,
        });
        if (res?.text) {
          lastTextRef.current = res.text;
          setQuote(res);
          return;
        }
        throw new Error('empty quote');
      } catch {
        if (config.mode === 'auto' || !manual) {
          const fallback = pickLocalNext();
          lastTextRef.current = fallback.text;
          setQuote(fallback);
        }
      } finally {
        setLoading(false);
      }
    },
    [config.apiUrl, config.mode, config.types, pickLocalNext],
  );

  useEffect(() => {
    void fetchNext(false);
  }, [fetchNext]);

  useEffect(() => {
    if (!config.autoRotate || paused) return;
    const ms = Math.max(5, config.intervalSeconds || 30) * 1000;
    const id = window.setInterval(() => {
      void fetchNext(false);
    }, ms);
    return () => window.clearInterval(id);
  }, [config.autoRotate, config.intervalSeconds, fetchNext, paused]);

  const attribution = [quote.from_who, quote.from].filter(Boolean).join(' · ');
  const isLeft = config.align === 'left';

  return (
    <MotionCard
      enableTilt={enableTilt}
      disabled={layoutEditing}
      className="rounded-2xl px-4 py-3 group"
    >
      <div className="flex items-center gap-3">
        <span
          className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: 'var(--pill-bg)', color: 'var(--brand)' }}
        >
          <Quote className="w-4 h-4" />
        </span>

        <button
          type="button"
          onClick={() => {
            if (!layoutEditing) void fetchNext(true);
          }}
          className={`min-w-0 flex-1 cursor-pointer ${isLeft ? 'text-left' : 'text-center'}`}
          title="点击切换下一条一言"
        >
          <div className="text-xs sm:text-[13px] font-medium leading-relaxed break-words">
            {quote.text}
          </div>
          {config.showAuthor && attribution && (
            <div className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--ink-muted)' }}>
              —— {attribution}
            </div>
          )}
        </button>

        <div className="flex items-center gap-1 shrink-0 opacity-75 group-hover:opacity-100 transition-opacity">
          {config.autoRotate && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setPaused((v) => !v);
              }}
              className="p-1.5 rounded-lg hover:bg-white/10 cursor-pointer"
              title={paused ? '继续轮播' : '暂停轮播'}
            >
              {paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
            </button>
          )}
          <button
            type="button"
            disabled={loading}
            onClick={(e) => {
              e.stopPropagation();
              void fetchNext(true);
            }}
            className="p-1.5 rounded-lg hover:bg-white/10 cursor-pointer disabled:opacity-50"
            title="换一条"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              const text = attribution ? `${quote.text} —— ${attribution}` : quote.text;
              onCopy(text, '已复制一言');
            }}
            className="p-1.5 rounded-lg hover:bg-white/10 cursor-pointer"
            title="复制文案"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
          {!readOnly && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenSettings();
              }}
              className="p-1.5 rounded-lg hover:bg-white/10 cursor-pointer"
              title="一言设置"
            >
              <Settings2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </MotionCard>
  );
}
