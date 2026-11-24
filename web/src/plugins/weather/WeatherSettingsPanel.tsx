import { useEffect, useState } from 'react';
import { Loader2, MapPin, RefreshCw, Search } from 'lucide-react';
import { api } from '../../api/client';
import { useOrbitHost } from '../../sdk/host';
import type { SettingsPanelProps } from '../../sdk/types';
import type { UserSettings, WeatherLocation } from '../../types';

export function WeatherSettingsPanel({ highlightSection }: SettingsPanelProps) {
  const host = useOrbitHost();
  const { settings, updateSettings, refreshWeather, toast } = host;
  const wc = settings.weatherConfig;

  const [locQuery, setLocQuery] = useState('');
  const [locSearching, setLocSearching] = useState(false);
  const [locResults, setLocResults] = useState<WeatherLocation[]>([]);
  const [locSearched, setLocSearched] = useState(false);
  const [labelDraft, setLabelDraft] = useState(wc.label || '');
  const [latDraft, setLatDraft] = useState(wc.lat !== undefined ? String(wc.lat) : '');
  const [lonDraft, setLonDraft] = useState(wc.lon !== undefined ? String(wc.lon) : '');

  useEffect(() => {
    setLabelDraft(wc.label || '');
    setLatDraft(wc.lat !== undefined ? String(wc.lat) : '');
    setLonDraft(wc.lon !== undefined ? String(wc.lon) : '');
  }, [wc.label, wc.lat, wc.lon]);

  const sectionHighlightStyle = (sectionId: string): React.CSSProperties =>
    highlightSection === sectionId
      ? {
          boxShadow: '0 0 0 2px var(--brand)',
          borderRadius: 'var(--radius-lg)',
          padding: '8px',
          transition: 'all 220ms ease',
        }
      : { transition: 'all 220ms ease' };

  const updateWeather = (patch: Partial<UserSettings['weatherConfig']>, refresh = false) => {
    const next = { ...wc, ...patch };
    updateSettings({
      weatherConfig: next,
      weatherCity: next.query || settings.weatherCity,
      weatherLabel: next.label || settings.weatherLabel,
    });
    if (refresh) void refreshWeather(patch, true);
  };

  const handleSearchLocations = async () => {
    const q = locQuery.trim();
    if (!q) return;
    setLocSearching(true);
    setLocSearched(true);
    try {
      const res = await api.searchWeatherLocations(q);
      setLocResults(res.results || []);
    } catch {
      toast('地区搜索请求失败', true);
    } finally {
      setLocSearching(false);
    }
  };

  const handleSelectLocation = (loc: WeatherLocation) => {
    setLabelDraft(loc.name);
    setLatDraft(String(loc.lat));
    setLonDraft(String(loc.lon));
    setLocResults([]);
    setLocSearched(false);
    setLocQuery('');
    updateWeather(
      {
        label: loc.name,
        query: loc.display_name || loc.name,
        lat: loc.lat,
        lon: loc.lon,
      },
      true,
    );
    toast(`天气已切换至：${loc.name}`);
  };

  const handleSaveManualWeatherCoords = () => {
    const lat = Number(latDraft);
    const lon = Number(lonDraft);
    const patch: Partial<UserSettings['weatherConfig']> = {
      label: labelDraft.trim() || wc.label,
    };
    if (!Number.isNaN(lat) && !Number.isNaN(lon) && latDraft.trim() && lonDraft.trim()) {
      patch.lat = lat;
      patch.lon = lon;
    }
    updateWeather(patch, true);
    toast('已更新天气位置设置');
  };

  return (
    <>
      <section data-section="sec-weather-loc" style={sectionHighlightStyle('sec-weather-loc')} className="space-y-3">
        <div className="font-medium text-sm flex items-center gap-1.5">
          <MapPin className="w-4 h-4" style={{ color: 'var(--brand)' }} />
          <span>精确地区选择（支持到区 / 县）</span>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={locQuery}
            onChange={(e) => setLocQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleSearchLocations();
            }}
            placeholder="输入城市或区县名，如：浦东新区、余杭区、海淀区、南山区"
            className="flex-1 h-9 px-3 rounded-xl focus:outline-none"
            style={{
              background: 'var(--pill-bg)',
              border: '1px solid var(--glass-border)',
              color: 'var(--ink)',
            }}
          />
          <button
            type="button"
            disabled={locSearching}
            onClick={() => void handleSearchLocations()}
            className="h-9 px-4 rounded-xl text-white font-medium cursor-pointer flex items-center gap-1.5 shrink-0 disabled:opacity-60"
            style={{ background: 'var(--brand-solid)' }}
          >
            {locSearching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
            <span>搜索区县</span>
          </button>
        </div>

        {locSearched && (
          <div
            className="rounded-xl p-1.5 space-y-1 max-h-44 overflow-y-auto"
            style={{ background: 'var(--pill-bg)', border: '1px solid var(--glass-border)' }}
          >
            {locResults.length === 0 ? (
              <div className="p-2.5 text-center" style={{ color: 'var(--ink-muted)' }}>
                {locSearching ? '正在搜索地区坐标...' : '未找到匹配地区，可加上城市名如“杭州市余杭区”或手动填入坐标'}
              </div>
            ) : (
              locResults.map((loc, idx) => (
                <button
                  key={`${loc.name}-${idx}`}
                  type="button"
                  onClick={() => handleSelectLocation(loc)}
                  className="w-full px-3 py-2 rounded-lg flex items-center justify-between gap-2 hover:bg-white/10 cursor-pointer text-left"
                >
                  <span className="font-medium truncate">{loc.display_name || loc.name}</span>
                  <span className="font-mono shrink-0" style={{ color: 'var(--ink-muted)' }}>
                    {loc.lat.toFixed(3)}, {loc.lon.toFixed(3)}
                  </span>
                </button>
              ))
            )}
          </div>
        )}

        <div className="grid sm:grid-cols-4 gap-2 items-end">
          <label className="sm:col-span-2 space-y-1">
            <span style={{ color: 'var(--ink-muted)' }}>卡片展示地名</span>
            <input
              type="text"
              value={labelDraft}
              onChange={(e) => setLabelDraft(e.target.value)}
              placeholder="如：余杭区 / 家中"
              className="w-full h-8 px-2.5 rounded-lg focus:outline-none"
              style={{
                background: 'var(--pill-bg)',
                border: '1px solid var(--glass-border)',
                color: 'var(--ink)',
              }}
            />
          </label>
          <label className="space-y-1">
            <span style={{ color: 'var(--ink-muted)' }}>纬度 Lat</span>
            <input
              type="text"
              value={latDraft}
              onChange={(e) => setLatDraft(e.target.value)}
              className="w-full h-8 px-2.5 rounded-lg font-mono focus:outline-none"
              style={{
                background: 'var(--pill-bg)',
                border: '1px solid var(--glass-border)',
                color: 'var(--ink)',
              }}
            />
          </label>
          <label className="space-y-1">
            <span style={{ color: 'var(--ink-muted)' }}>经度 Lon</span>
            <input
              type="text"
              value={lonDraft}
              onChange={(e) => setLonDraft(e.target.value)}
              className="w-full h-8 px-2.5 rounded-lg font-mono focus:outline-none"
              style={{
                background: 'var(--pill-bg)',
                border: '1px solid var(--glass-border)',
                color: 'var(--ink)',
              }}
            />
          </label>
        </div>

        <div className="flex items-center justify-between gap-2">
          <span style={{ color: 'var(--ink-muted)' }}>
            当前生效：{wc.label || wc.query}
            {wc.lat !== undefined && wc.lon !== undefined ? ` (${wc.lat.toFixed(3)}, ${wc.lon.toFixed(3)})` : ''}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSaveManualWeatherCoords}
              className="h-8 px-3 rounded-lg cursor-pointer"
              style={{ background: 'var(--pill-hover)' }}
            >
              应用地名与坐标
            </button>
            <button
              type="button"
              onClick={() => void refreshWeather({}, true)}
              className="h-8 px-3 rounded-lg flex items-center gap-1 cursor-pointer"
              style={{ background: 'var(--pill-bg)' }}
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>立即刷新</span>
            </button>
          </div>
        </div>
      </section>

      <section
        data-section="sec-weather-fld"
        style={{ ...sectionHighlightStyle('sec-weather-fld'), borderColor: 'var(--glass-border)' }}
        className="space-y-3 pt-4 border-t"
      >
        <div className="space-y-2">
          <div className="font-medium text-sm">卡片样式与自定义文案</div>
          <div className="grid sm:grid-cols-2 gap-2">
            {(
              [
                {
                  id: 'standard' as const,
                  title: '样式一 · 经典预报',
                  desc: '左侧实况温度与细节，右侧展示多日预报槽位',
                },
                {
                  id: 'banner' as const,
                  title: '样式二 · 文案时钟',
                  desc: '左侧显示自定义文案，右侧显示实时时间与日期，底部展示天气',
                },
              ] as const
            ).map((opt) => {
              const active = (wc.style || 'standard') === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => updateWeather({ style: opt.id })}
                  className="p-3 rounded-xl text-left cursor-pointer transition-all space-y-0.5"
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

          {(wc.style || 'standard') === 'banner' && (
            <div className="p-3 rounded-xl space-y-1.5" style={{ background: 'var(--pill-bg)' }}>
              <div className="flex items-center justify-between">
                <span style={{ color: 'var(--ink-muted)' }}>左侧自定义文案（留空则显示当前地点）</span>
                {wc.customText && (
                  <button
                    type="button"
                    onClick={() => updateWeather({ customText: '' })}
                    className="hover:underline cursor-pointer"
                    style={{ color: 'var(--ink-muted)' }}
                  >
                    清空
                  </button>
                )}
              </div>
              <input
                type="text"
                value={wc.customText || ''}
                onChange={(e) => updateWeather({ customText: e.target.value })}
                placeholder="例如：星轨之上，保持热爱 / 欢迎回到个人空间"
                maxLength={80}
                className="w-full h-8 px-2.5 rounded-lg focus:outline-none"
                style={{
                  background: 'rgba(var(--glass-rgb), 0.5)',
                  border: '1px solid var(--glass-border)',
                  color: 'var(--ink)',
                }}
              />
            </div>
          )}
        </div>

        <div className="grid sm:grid-cols-3 gap-2.5">
          <div className="p-2.5 rounded-xl space-y-1.5" style={{ background: 'var(--pill-bg)' }}>
            <div style={{ color: 'var(--ink-muted)' }}>温度单位</div>
            <div className="flex gap-1">
              {(['C', 'F'] as const).map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => updateWeather({ unit: u })}
                  className="flex-1 py-1 rounded-lg cursor-pointer"
                  style={{
                    background: wc.unit === u ? 'var(--brand-solid)' : 'transparent',
                    color: wc.unit === u ? '#fff' : 'var(--ink-muted)',
                  }}
                >
                  °{u}
                </button>
              ))}
            </div>
          </div>

          <div className="p-2.5 rounded-xl space-y-1.5" style={{ background: 'var(--pill-bg)' }}>
            <div style={{ color: 'var(--ink-muted)' }}>预报槽位</div>
            <div className="flex gap-1">
              {([0, 2, 3] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => updateWeather({ forecastDays: d })}
                  className="flex-1 py-1 rounded-lg cursor-pointer"
                  style={{
                    background: wc.forecastDays === d ? 'var(--brand-solid)' : 'transparent',
                    color: wc.forecastDays === d ? '#fff' : 'var(--ink-muted)',
                  }}
                >
                  {d === 0 ? '隐藏' : `${d}天`}
                </button>
              ))}
            </div>
          </div>

          <div className="p-2.5 rounded-xl space-y-1.5" style={{ background: 'var(--pill-bg)' }}>
            <div style={{ color: 'var(--ink-muted)' }}>自动更新周期</div>
            <div className="flex gap-1">
              {([15, 30, 60] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => updateWeather({ refreshMinutes: m })}
                  className="flex-1 py-1 rounded-lg cursor-pointer"
                  style={{
                    background: wc.refreshMinutes === m ? 'var(--brand-solid)' : 'transparent',
                    color: wc.refreshMinutes === m ? '#fff' : 'var(--ink-muted)',
                  }}
                >
                  {m}m
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <div style={{ color: 'var(--ink-muted)' }}>卡片展示字段</div>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
            {(
              [
                ['showFeelsLike', '体感'],
                ['showHumidity', '湿度'],
                ['showHiLo', '温差'],
                ['showWind', '风速'],
                ['showPrecip', '降水'],
                ['showPressure', '气压'],
              ] as const
            ).map(([field, label]) => {
              const on = Boolean(wc[field]);
              return (
                <button
                  key={field}
                  type="button"
                  onClick={() => updateWeather({ [field]: !on })}
                  className="py-1.5 rounded-lg font-medium cursor-pointer transition-colors"
                  style={{
                    background: on ? 'var(--brand-solid)' : 'var(--pill-bg)',
                    color: on ? '#fff' : 'var(--ink-muted)',
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </section>
    </>
  );
}
