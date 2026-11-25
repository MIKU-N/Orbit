import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client';
import { WidgetSurface } from '../../sdk/primitives';
import type { HitokotoConfig, HitokotoQuote } from '../../types';

interface HitokotoWidgetProps {
  config: HitokotoConfig;
  cardless: boolean;
  managed: boolean;
  enableTilt: boolean;
  layoutEditing: boolean;
  onToast: (msg: string, warn?: boolean) => void;
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
  cardless,
  managed,
  enableTilt,
  layoutEditing,
  onToast,
}: HitokotoWidgetProps) {
  const [builtinPool, setBuiltinPool] = useState<HitokotoQuote[]>(LOCAL_FALLBACK_QUOTES);
  const [quote, setQuote] = useState<HitokotoQuote>(LOCAL_FALLBACK_QUOTES[0]);
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
        throw new Error('接口未返回有效文案');
      } catch (err) {
        if (config.mode === 'auto' || !manual) {
          const fallback = pickLocalNext();
          lastTextRef.current = fallback.text;
          setQuote(fallback);
        } else {
          onToast((err as Error).message || '获取一言失败', true);
        }
      }
    },
    [config.apiUrl, config.mode, config.types, onToast, pickLocalNext],
  );

  useEffect(() => {
    void fetchNext(false);
  }, [fetchNext]);

  useEffect(() => {
    if (!config.autoRotate) return;
    const ms = Math.max(5, config.intervalSeconds || 30) * 1000;
    const id = window.setInterval(() => {
      void fetchNext(false);
    }, ms);
    return () => window.clearInterval(id);
  }, [config.autoRotate, config.intervalSeconds, fetchNext]);

  const attribution = [quote.from_who, quote.from].filter(Boolean).join(' · ');
  const isLeft = config.align === 'left';

  return (
    <WidgetSurface
      cardless={cardless}
      managed={managed}
      enableTilt={enableTilt}
      layoutEditing={layoutEditing}
      onClick={() => {
        if (!layoutEditing) void fetchNext(true);
      }}
      cardClassName="rounded-2xl px-4 py-2.5 cursor-pointer"
      plainClassName="px-2 py-1 cursor-pointer"
      title="点击切换"
    >
      <div className={isLeft ? 'text-left' : 'text-center'}>
        <div className="text-xs sm:text-[13px] font-medium leading-relaxed break-words">
          {quote.text}
        </div>
        {config.showAuthor && attribution && (
          <div
            className={`text-[11px] mt-0.5 truncate ${cardless ? 'plain-muted' : ''}`}
            style={cardless ? undefined : { color: 'var(--ink-muted)' }}
          >
            —— {attribution}
          </div>
        )}
      </div>
    </WidgetSurface>
  );
}
