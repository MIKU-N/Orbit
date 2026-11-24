import { useEffect, useState } from 'react';
import { Quote } from 'lucide-react';
import { useOrbitHost } from '../../sdk/host';
import type { SettingsPanelProps } from '../../sdk/types';
import type { HitokotoConfig } from '../../types';

const HITOKOTO_TYPES = [
  { code: 'a', label: '动画' },
  { code: 'b', label: '漫画' },
  { code: 'c', label: '游戏' },
  { code: 'd', label: '文学' },
  { code: 'e', label: '原创' },
  { code: 'i', label: '诗词' },
  { code: 'k', label: '哲学' },
  { code: 'l', label: '抖机灵' },
] as const;

export function HitokotoSettingsPanel({ highlightSection }: SettingsPanelProps) {
  const host = useOrbitHost();
  const { settings, updateSettings, toast } = host;
  const hc = settings.hitokotoConfig;

  const [apiUrlDraft, setApiUrlDraft] = useState(hc.apiUrl || '');
  const [customLinesText, setCustomLinesText] = useState((hc.customQuotes || []).join('\n'));

  useEffect(() => {
    setApiUrlDraft(hc.apiUrl || '');
  }, [hc.apiUrl]);

  useEffect(() => {
    setCustomLinesText((hc.customQuotes || []).join('\n'));
  }, [hc.customQuotes]);

  const updateHitokoto = (patch: Partial<HitokotoConfig>) => {
    updateSettings({
      hitokotoConfig: { ...hc, ...patch },
    });
  };

  const toggleType = (code: string) => {
    const cur = hc.types || [];
    const next = cur.includes(code) ? cur.filter((x) => x !== code) : [...cur, code];
    updateHitokoto({ types: next });
  };

  const sectionHighlightStyle = (sectionId: string): React.CSSProperties =>
    highlightSection === sectionId
      ? {
          boxShadow: '0 0 0 2px var(--brand)',
          borderRadius: 'var(--radius-lg)',
          padding: '8px',
          transition: 'all 220ms ease',
        }
      : { transition: 'all 220ms ease' };

  return (
    <>
      <section
        data-section="sec-hitokoto-src"
        style={sectionHighlightStyle('sec-hitokoto-src')}
        className="space-y-3"
      >
        <div className="font-medium text-sm flex items-center gap-1.5">
          <Quote className="w-4 h-4" style={{ color: 'var(--brand)' }} />
          <span>一言来源与 API 设置</span>
        </div>

        <div className="grid sm:grid-cols-3 gap-2">
          {(
            [
              { id: 'auto' as const, title: 'API 优先（推荐）', desc: '优先拉取在线一言，离线时自动切换内置文案' },
              { id: 'api' as const, title: '仅在线 API', desc: '每次刷新直接请求一言或自定义接口' },
              { id: 'builtin' as const, title: '仅内置文案库', desc: '零网络延迟，在内置与自定义文案中轮播' },
            ] as const
          ).map((opt) => {
            const active = hc.mode === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => updateHitokoto({ mode: opt.id })}
                className="p-2.5 rounded-xl text-left cursor-pointer transition-all space-y-0.5"
                style={{
                  background: active ? 'var(--brand-solid)' : 'var(--pill-bg)',
                  color: active ? '#fff' : 'var(--ink)',
                  border: active ? '1px solid transparent' : '1px solid var(--glass-border)',
                }}
              >
                <div className="font-medium">{opt.title}</div>
                <div className="opacity-80 leading-relaxed">{opt.desc}</div>
              </button>
            );
          })}
        </div>

        {hc.mode !== 'builtin' && (
          <div className="space-y-2.5 p-3 rounded-xl" style={{ background: 'var(--pill-bg)' }}>
            <div className="space-y-1.5">
              <div style={{ color: 'var(--ink-muted)' }}>官方一言分类筛选（未选则随机全部分类）</div>
              <div className="flex flex-wrap gap-1.5">
                {HITOKOTO_TYPES.map((t) => {
                  const on = (hc.types || []).includes(t.code);
                  return (
                    <button
                      key={t.code}
                      type="button"
                      onClick={() => toggleType(t.code)}
                      className="px-2.5 py-1 rounded-lg cursor-pointer transition-colors"
                      style={{
                        background: on ? 'var(--brand-solid)' : 'rgba(255,255,255,0.06)',
                        color: on ? '#fff' : 'var(--ink-muted)',
                      }}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1">
              <div style={{ color: 'var(--ink-muted)' }}>
                自定义 API 地址（留空默认使用 https://v1.hitokoto.cn/，支持 JSON 或纯文本返回）
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={apiUrlDraft}
                  onChange={(e) => setApiUrlDraft(e.target.value)}
                  placeholder="https://v1.hitokoto.cn/?encode=json"
                  className="flex-1 h-8 px-2.5 rounded-lg font-mono focus:outline-none"
                  style={{
                    background: 'rgba(var(--glass-rgb), 0.5)',
                    border: '1px solid var(--glass-border)',
                    color: 'var(--ink)',
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    updateHitokoto({ apiUrl: apiUrlDraft.trim() });
                    toast('已保存一言 API 地址');
                  }}
                  className="h-8 px-3 rounded-lg cursor-pointer shrink-0"
                  style={{ background: 'var(--pill-hover)' }}
                >
                  应用
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      <section
        data-section="sec-hitokoto-play"
        style={{ ...sectionHighlightStyle('sec-hitokoto-play'), borderColor: 'var(--glass-border)' }}
        className="space-y-3 pt-4 border-t"
      >
        <div className="font-medium text-sm">轮播与显示设置</div>

        <div className="grid sm:grid-cols-2 gap-2">
          <label
            className="px-3 py-2 rounded-xl flex items-center justify-between cursor-pointer"
            style={{ background: 'var(--pill-bg)' }}
          >
            <span>自动定时轮播</span>
            <input
              type="checkbox"
              checked={hc.autoRotate}
              onChange={(e) => updateHitokoto({ autoRotate: e.target.checked })}
            />
          </label>
          <label
            className="px-3 py-2 rounded-xl flex items-center justify-between cursor-pointer"
            style={{ background: 'var(--pill-bg)' }}
          >
            <span>显示作者与出处</span>
            <input
              type="checkbox"
              checked={hc.showAuthor}
              onChange={(e) => updateHitokoto({ showAuthor: e.target.checked })}
            />
          </label>
        </div>

        <div className="grid sm:grid-cols-2 gap-2.5">
          <div className="p-2.5 rounded-xl space-y-1.5" style={{ background: 'var(--pill-bg)' }}>
            <div style={{ color: 'var(--ink-muted)' }}>轮播间隔</div>
            <div className="flex gap-1">
              {([10, 20, 30, 60, 300] as const).map((sec) => (
                <button
                  key={sec}
                  type="button"
                  onClick={() => updateHitokoto({ intervalSeconds: sec })}
                  className="flex-1 py-1 rounded-lg cursor-pointer"
                  style={{
                    background: hc.intervalSeconds === sec ? 'var(--brand-solid)' : 'transparent',
                    color: hc.intervalSeconds === sec ? '#fff' : 'var(--ink-muted)',
                  }}
                >
                  {sec >= 60 ? `${sec / 60}m` : `${sec}s`}
                </button>
              ))}
            </div>
          </div>

          <div className="p-2.5 rounded-xl space-y-1.5" style={{ background: 'var(--pill-bg)' }}>
            <div style={{ color: 'var(--ink-muted)' }}>文案对齐方式</div>
            <div className="flex gap-1">
              {(
                [
                  ['center', '居中对齐'],
                  ['left', '左对齐'],
                ] as const
              ).map(([al, lbl]) => (
                <button
                  key={al}
                  type="button"
                  onClick={() => updateHitokoto({ align: al })}
                  className="flex-1 py-1 rounded-lg cursor-pointer"
                  style={{
                    background: hc.align === al ? 'var(--brand-solid)' : 'transparent',
                    color: hc.align === al ? '#fff' : 'var(--ink-muted)',
                  }}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="p-3 rounded-xl space-y-2" style={{ background: 'var(--pill-bg)' }}>
          <div className="flex items-center justify-between">
            <span style={{ color: 'var(--ink-muted)' }}>
              自定义补充文案（每行一条，支持「文案 | 出处」格式，会加入内置轮播池）
            </span>
          </div>
          <textarea
            rows={4}
            value={customLinesText}
            onChange={(e) => setCustomLinesText(e.target.value)}
            placeholder={'例如：\n保持热爱，奔赴山海 | 随笔\n代码如诗，简洁即永恒 | Orbit'}
            className="w-full p-2.5 rounded-lg focus:outline-none resize-none"
            style={{
              background: 'rgba(var(--glass-rgb), 0.5)',
              border: '1px solid var(--glass-border)',
              color: 'var(--ink)',
            }}
          />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => {
                const lines = customLinesText
                  .split('\n')
                  .map((l) => l.trim())
                  .filter(Boolean);
                updateHitokoto({ customQuotes: lines });
                toast(`已保存 ${lines.length} 条自定义一言`);
              }}
              className="h-8 px-4 rounded-lg text-white font-medium cursor-pointer"
              style={{ background: 'var(--brand-solid)' }}
            >
              保存自定义文案
            </button>
          </div>
        </div>
      </section>
    </>
  );
}
