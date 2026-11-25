import { useEffect, useState } from 'react';
import { Cloud, Loader2, LocateFixed, MapPin, RefreshCw, Search, Sun } from 'lucide-react';
import { api } from '../../api/client';
import { useOrbitHost } from '../../sdk/host';
import type { SettingsPanelProps } from '../../sdk/types';
import type { UserSettings, WeatherLocation, WeatherProvider } from '../../types';

const SOURCE_LABELS: Record<string, string> = {
  china: '中国天气',
  caiyun: '彩云天气',
  'open-meteo': 'Open-Meteo',
  fallback: '离线兜底',
};

export function WeatherSettingsPanel({ highlightSection }: SettingsPanelProps) {
  const host = useOrbitHost();
  const { settings, weather, updateSettings, refreshWeather, toast } = host;
  const wc = settings.weatherConfig;

  const [locQuery, setLocQuery] = useState('');
  const [locSearching, setLocSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locResults, setLocResults] = useState<WeatherLocation[]>([]);
  const [locSearched, setLocSearched] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [labelDraft, setLabelDraft] = useState(wc.label || '');
  const [latDraft, setLatDraft] = useState(wc.lat !== undefined ? String(wc.lat) : '');
  const [lonDraft, setLonDraft] = useState(wc.lon !== undefined ? String(wc.lon) : '');
  const [caiyunTokenDraft, setCaiyunTokenDraft] = useState(wc.caiyunToken || '');

  useEffect(() => {
    setLabelDraft(wc.label || '');
    setLatDraft(wc.lat !== undefined ? String(wc.lat) : '');
    setLonDraft(wc.lon !== undefined ? String(wc.lon) : '');
    setCaiyunTokenDraft(wc.caiyunToken || '');
  }, [wc.label, wc.lat, wc.lon, wc.caiyunToken]);

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
    if (refresh) {
      void refreshWeather(patch, true).catch((e) => {
        toast((e as Error).message || '刷新天气失败', true);
      });
    }
  };

  const handleSearchLocations = async () => {
    const q = locQuery.trim();
    if (!q) {
      toast('请输入城市或区县名称', true);
      return;
    }
    setLocSearching(true);
    setLocSearched(true);
    try {
      const res = await api.searchWeatherLocations(q);
      setLocResults(res.results || []);
    } catch (e) {
      toast((e as Error).message || '地区搜索失败', true);
    } finally {
      setLocSearching(false);
    }
  };

  const handleSelectLocation = (loc: WeatherLocation) => {
    setLabelDraft(loc.name);
    setLatDraft(loc.lat ? String(loc.lat) : '');
    setLonDraft(loc.lon ? String(loc.lon) : '');
    setLocResults([]);
    setLocSearched(false);
    setLocQuery('');
    updateWeather(
      {
        label: loc.name,
        query: loc.display_name || loc.name,
        stationId: loc.station_id || '',
        lat: loc.lat || undefined,
        lon: loc.lon || undefined,
      },
      true,
    );
    toast(`已切换至 ${loc.name}`);
  };

  const handleDirectLocate = async () => {
    setLocating(true);
    try {
      let browserCoords: { lat: number; lon: number } | undefined;
      if (window.isSecureContext && navigator.geolocation) {
        browserCoords = await new Promise<{ lat: number; lon: number } | undefined>((resolve) => {
          navigator.geolocation.getCurrentPosition(
            (pos) =>
              resolve({
                lat: Math.round(pos.coords.latitude * 10000) / 10000,
                lon: Math.round(pos.coords.longitude * 10000) / 10000,
              }),
            () => resolve(undefined),
            { enableHighAccuracy: false, timeout: 5000, maximumAge: 300000 },
          );
        });
      }

      const res = await api.locateWeather(browserCoords);
      const loc = res.location;
      setLabelDraft(loc.name);
      setLatDraft(loc.lat ? String(loc.lat) : '');
      setLonDraft(loc.lon ? String(loc.lon) : '');
      setLocResults([]);
      setLocSearched(false);
      updateWeather(
        {
          label: loc.name,
          query: loc.display_name || loc.name,
          stationId: loc.station_id || '',
          lat: loc.lat || undefined,
          lon: loc.lon || undefined,
        },
        true,
      );
      toast(`已定位至 ${loc.name}（${res.method === 'gps' ? '浏览器定位' : 'IP 定位'}）`);
    } catch (e) {
      toast((e as Error).message || '直接定位失败，请尝试搜索城市', true);
    } finally {
      setLocating(false);
    }
  };

  const handleSaveManualWeatherCoords = () => {
    const hasLat = latDraft.trim() !== '';
    const hasLon = lonDraft.trim() !== '';
    const patch: Partial<UserSettings['weatherConfig']> = {
      label: labelDraft.trim() || wc.label,
      stationId: '',
    };
    if (hasLat || hasLon) {
      const lat = Number(latDraft);
      const lon = Number(lonDraft);
      if (
        !hasLat ||
        !hasLon ||
        Number.isNaN(lat) ||
        Number.isNaN(lon) ||
        lat < -90 ||
        lat > 90 ||
        lon < -180 ||
        lon > 180
      ) {
        toast('请输入有效的经纬度坐标', true);
        return;
      }
      patch.lat = lat;
      patch.lon = lon;
    }
    updateWeather(patch, true);
    toast('已更新天气位置');
  };

  const activeProvider: WeatherProvider = wc.provider || 'auto';

  const handleSelectProvider = (provider: WeatherProvider) => {
    updateWeather({ provider }, true);
    const label = provider === 'caiyun' ? '彩云天气' : provider === 'china' ? '中国天气' : '智能切换';
    toast(`天气数据源已切换为：${label}`);
  };

  const handleSaveCaiyunToken = () => {
    const token = caiyunTokenDraft.trim();
    updateWeather(
      {
        caiyunToken: token,
        ...(token && activeProvider === 'china' ? { provider: 'auto' } : {}),
      },
      true,
    );
    toast(token ? '已保存彩云天气 Token 并刷新' : '已清除彩云天气 Token');
  };

  const handleManualRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshWeather({}, true);
      toast('天气已更新');
    } catch (e) {
      toast((e as Error).message || '天气更新失败', true);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <>
      <section data-section="sec-weather-loc" style={sectionHighlightStyle('sec-weather-loc')} className="space-y-3">
        <div className="font-medium text-sm flex items-center gap-1.5">
          <MapPin className="w-4 h-4" style={{ color: 'var(--brand)' }} />
          <span>地区设置</span>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={locQuery}
            onChange={(e) => setLocQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleSearchLocations();
            }}
            placeholder="搜索城市或区县（如：余杭区、浦东新区）"
            className="flex-1 h-9 px-3 rounded-xl focus:outline-none"
            style={{
              background: 'var(--input-bg)',
              border: '1px solid var(--glass-border)',
              color: 'var(--ink)',
            }}
          />
          <button
            type="button"
            disabled={locSearching}
            onClick={() => void handleSearchLocations()}
            className="h-9 px-3.5 rounded-xl text-white font-medium cursor-pointer flex items-center gap-1.5 shrink-0 disabled:opacity-60"
            style={{ background: 'var(--brand-solid)' }}
          >
            {locSearching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
            <span>搜索</span>
          </button>
          <button
            type="button"
            disabled={locating}
            onClick={() => void handleDirectLocate()}
            className="h-9 px-3 rounded-xl font-medium cursor-pointer flex items-center gap-1.5 shrink-0 orbit-hover disabled:opacity-60"
            style={{
              background: 'var(--pill-hover)',
              border: '1px solid var(--glass-border)',
              color: 'var(--ink)',
            }}
            title="自动获取当前所在位置（优先浏览器定位，自动回退 IP 定位）"
          >
            {locating ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: 'var(--brand)' }} />
            ) : (
              <LocateFixed className="w-3.5 h-3.5" style={{ color: 'var(--brand)' }} />
            )}
            <span>直接定位</span>
          </button>
        </div>

        {locSearched && (
          <div
            className="rounded-xl p-1.5 space-y-1 max-h-44 overflow-y-auto"
            style={{ background: 'var(--pill-bg)', border: '1px solid var(--glass-border)' }}
          >
            {locResults.length === 0 ? (
              <div className="p-2.5 text-center" style={{ color: 'var(--ink-muted)' }}>
                {locSearching ? '搜索中...' : '未找到匹配地区'}
              </div>
            ) : (
              locResults.map((loc, idx) => (
                <button
                  key={`${loc.station_id || loc.name}-${idx}`}
                  type="button"
                  onClick={() => handleSelectLocation(loc)}
                  className="w-full px-3 py-2 rounded-lg flex items-center justify-between gap-2 orbit-hover cursor-pointer text-left"
                >
                  <span className="font-medium truncate">{loc.display_name || loc.name}</span>
                  <span className="font-mono shrink-0" style={{ color: 'var(--ink-muted)' }}>
                    {loc.lat || loc.lon ? `${loc.lat.toFixed(2)}, ${loc.lon.toFixed(2)}` : loc.station_id || ''}
                  </span>
                </button>
              ))
            )}
          </div>
        )}

        <div className="grid sm:grid-cols-4 gap-2 items-end">
          <label className="sm:col-span-2 space-y-1">
            <span style={{ color: 'var(--ink-muted)' }}>展示地名</span>
            <input
              type="text"
              value={labelDraft}
              onChange={(e) => setLabelDraft(e.target.value)}
              placeholder="余杭区"
              className="w-full h-8 px-2.5 rounded-lg focus:outline-none"
              style={{
                background: 'var(--input-bg)',
                border: '1px solid var(--glass-border)',
                color: 'var(--ink)',
              }}
            />
          </label>
          <label className="space-y-1">
            <span style={{ color: 'var(--ink-muted)' }}>纬度</span>
            <input
              type="text"
              value={latDraft}
              onChange={(e) => setLatDraft(e.target.value)}
              className="w-full h-8 px-2.5 rounded-lg font-mono focus:outline-none"
              style={{
                background: 'var(--input-bg)',
                border: '1px solid var(--glass-border)',
                color: 'var(--ink)',
              }}
            />
          </label>
          <label className="space-y-1">
            <span style={{ color: 'var(--ink-muted)' }}>经度</span>
            <input
              type="text"
              value={lonDraft}
              onChange={(e) => setLonDraft(e.target.value)}
              className="w-full h-8 px-2.5 rounded-lg font-mono focus:outline-none"
              style={{
                background: 'var(--input-bg)',
                border: '1px solid var(--glass-border)',
                color: 'var(--ink)',
              }}
            />
          </label>
        </div>

        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <span style={{ color: 'var(--ink-muted)' }}>
              当前：{wc.label || wc.query}
              {wc.lat !== undefined && wc.lon !== undefined
                ? ` (${wc.lat.toFixed(2)}, ${wc.lon.toFixed(2)})`
                : ''}
            </span>
            {weather?.source && (
              <span className="kbd-chip" style={{ color: 'var(--brand)' }}>
                {SOURCE_LABELS[weather.source] || weather.source}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSaveManualWeatherCoords}
              className="h-8 px-3 rounded-lg cursor-pointer orbit-hover"
              style={{ background: 'var(--pill-hover)' }}
            >
              应用
            </button>
            <button
              type="button"
              disabled={refreshing}
              onClick={() => void handleManualRefresh()}
              className="h-8 px-3 rounded-lg flex items-center gap-1 cursor-pointer orbit-hover disabled:opacity-60"
              style={{ background: 'var(--pill-bg)' }}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              <span>刷新</span>
            </button>
          </div>
        </div>

        <div
          className="p-3 rounded-xl space-y-2.5"
          style={{ background: 'var(--pill-bg)', border: '1px solid var(--glass-border)' }}
        >
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 font-medium">
              <Cloud className="w-3.5 h-3.5" style={{ color: 'var(--brand)' }} />
              <span>天气数据源</span>
            </div>
            <div className="flex gap-1 p-0.5 rounded-lg" style={{ background: 'var(--code-bg)' }}>
              {(
                [
                  ['auto', '智能'],
                  ['china', '中国天气'],
                  ['caiyun', '彩云天气'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => handleSelectProvider(id)}
                  className="px-2.5 py-1 rounded-md cursor-pointer transition-colors"
                  style={{
                    background: activeProvider === id ? 'var(--brand-solid)' : 'transparent',
                    color: activeProvider === id ? '#fff' : 'var(--ink-muted)',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {(activeProvider === 'caiyun' || activeProvider === 'auto') && (
            <div className="space-y-1.5">
              <div className="flex gap-2">
                <input
                  type="password"
                  value={caiyunTokenDraft}
                  onChange={(e) => setCaiyunTokenDraft(e.target.value)}
                  placeholder="彩云天气 API Token（留空默认使用免 Key 的中国天气，也支持环境变量 ORBIT_CAIYUN_TOKEN）"
                  className="flex-1 h-8 px-2.5 rounded-lg font-mono focus:outline-none"
                  style={{
                    background: 'var(--input-bg)',
                    border: '1px solid var(--glass-border)',
                    color: 'var(--ink)',
                  }}
                />
                <button
                  type="button"
                  onClick={handleSaveCaiyunToken}
                  className="h-8 px-3 rounded-lg cursor-pointer orbit-hover shrink-0"
                  style={{ background: 'var(--pill-hover)' }}
                >
                  保存
                </button>
              </div>
              <div className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                {activeProvider === 'caiyun'
                  ? '优先调用彩云天气 v2.6 接口；若未填写 Token 或配额耗尽，将自动降级为中国天气官方实况。'
                  : '已填彩云 Token 时优先彩云天气，未填时默认使用中国天气（中国气象局官方数据，免 Key 直连）。'}
              </div>
            </div>
          )}
        </div>
      </section>

      <section
        data-section="sec-weather-fld"
        style={{ ...sectionHighlightStyle('sec-weather-fld'), borderColor: 'var(--glass-border)' }}
        className="space-y-3 pt-4 border-t"
      >
        <div className="space-y-2">
          <div className="font-medium text-sm">卡片样式</div>
          <div className="grid sm:grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => updateWeather({ style: 'standard' })}
              className="p-2.5 rounded-xl text-left cursor-pointer transition-all space-y-2"
              style={{
                background: (wc.style || 'standard') === 'standard' ? 'rgba(99, 102, 241, 0.16)' : 'var(--pill-bg)',
                border:
                  (wc.style || 'standard') === 'standard'
                    ? '1.5px solid var(--brand)'
                    : '1px solid var(--glass-border)',
              }}
            >
              <div
                className="rounded-lg p-2.5 flex items-center justify-between gap-2"
                style={{ background: 'var(--code-bg)', border: '1px solid var(--glass-border)' }}
              >
                <div className="flex items-center gap-2">
                  <Sun className="w-5 h-5 text-amber-400 shrink-0" />
                  <div>
                    <div className="text-sm font-semibold leading-none font-mono">24°C</div>
                    <div className="text-[10px] mt-1 opacity-65">晴 · 体感 25°</div>
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <div className="px-1.5 py-1 rounded text-[9px] font-mono text-center" style={{ background: 'var(--pill-bg)' }}>
                    <div>明天</div>
                    <div className="opacity-75">26°</div>
                  </div>
                  <div className="px-1.5 py-1 rounded text-[9px] font-mono text-center" style={{ background: 'var(--pill-bg)' }}>
                    <div>后天</div>
                    <div className="opacity-75">23°</div>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between px-0.5">
                <span className="font-medium">经典预报</span>
                <span className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                  实况 + 预报
                </span>
              </div>
            </button>

            <button
              type="button"
              onClick={() => updateWeather({ style: 'banner' })}
              className="p-2.5 rounded-xl text-left cursor-pointer transition-all space-y-2"
              style={{
                background: wc.style === 'banner' ? 'rgba(99, 102, 241, 0.16)' : 'var(--pill-bg)',
                border:
                  wc.style === 'banner'
                    ? '1.5px solid var(--brand)'
                    : '1px solid var(--glass-border)',
              }}
            >
              <div
                className="rounded-lg p-2.5 space-y-1.5"
                style={{ background: 'var(--code-bg)', border: '1px solid var(--glass-border)' }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium truncate">保持热爱</span>
                  <span className="text-sm font-semibold font-mono leading-none">14:30</span>
                </div>
                <div className="flex items-center justify-between text-[10px] opacity-70">
                  <span className="inline-flex items-center gap-1">
                    <Sun className="w-3 h-3 text-amber-400" /> 晴 24°C
                  </span>
                  <span>周三</span>
                </div>
              </div>
              <div className="flex items-center justify-between px-0.5">
                <span className="font-medium">文案时钟</span>
                <span className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                  标语 + 时间
                </span>
              </div>
            </button>
          </div>

          {wc.style === 'banner' && (
            <div className="p-3 rounded-xl space-y-1.5" style={{ background: 'var(--pill-bg)' }}>
              <div className="flex items-center justify-between">
                <span style={{ color: 'var(--ink-muted)' }}>自定义文案</span>
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
                placeholder="留空显示当前地点"
                maxLength={80}
                className="w-full h-8 px-2.5 rounded-lg focus:outline-none"
                style={{
                  background: 'var(--input-bg)',
                  border: '1px solid var(--glass-border)',
                  color: 'var(--ink)',
                }}
              />
            </div>
          )}
        </div>

        <div className="grid sm:grid-cols-3 gap-2.5">
          <div className="p-2.5 rounded-xl space-y-1.5" style={{ background: 'var(--pill-bg)' }}>
            <div style={{ color: 'var(--ink-muted)' }}>温标</div>
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
            <div style={{ color: 'var(--ink-muted)' }}>预报</div>
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
                  {d === 0 ? '关' : `${d}天`}
                </button>
              ))}
            </div>
          </div>

          <div className="p-2.5 rounded-xl space-y-1.5" style={{ background: 'var(--pill-bg)' }}>
            <div style={{ color: 'var(--ink-muted)' }}>刷新周期</div>
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
          <div style={{ color: 'var(--ink-muted)' }}>显示字段</div>
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
