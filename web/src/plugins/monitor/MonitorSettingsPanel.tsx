import { useMemo, useState } from 'react';
import { Activity, ArrowDown, ArrowUp, Plus, RefreshCw } from 'lucide-react';
import { useOrbitHost } from '../../sdk/host';
import { OrbitSelect, formatBytes, formatSpeed } from '../../sdk/primitives';
import type { SettingsPanelProps } from '../../sdk/types';
import type { MonitorMetricKey, UserSettings } from '../../types';

function formatDetailedUptime(sec: number): string {
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  if (days > 0) return `${days} 天 ${hours} 小时`;
  const mins = Math.floor((sec % 3600) / 60);
  return `${hours} 时 ${mins} 分`;
}

const METRIC_LABELS: Record<MonitorMetricKey, string> = {
  cpu: 'CPU',
  ram: '内存',
  disk: '磁盘',
  swap: 'Swap',
  load: '负载 (1m)',
  uptime: '运行时长',
  temp: 'CPU 温度',
  processes: '进程数',
  orbit: 'Orbit 内存',
  net_total: '累计下行',
};

const ALL_METRIC_KEYS: MonitorMetricKey[] = [
  'cpu',
  'ram',
  'disk',
  'swap',
  'load',
  'uptime',
  'temp',
  'processes',
  'orbit',
  'net_total',
];

export function MonitorSettingsPanel({ highlightSection }: SettingsPanelProps) {
  const host = useOrbitHost();
  const { canViewMonitor, metrics, refreshMetrics, settings, updateSettings, toast } = host;
  const mc = settings.monitorConfig;
  const [refreshing, setRefreshing] = useState(false);

  const handleRefreshMetrics = async () => {
    setRefreshing(true);
    try {
      await refreshMetrics();
    } finally {
      setRefreshing(false);
    }
  };

  const mountOptions = useMemo(
    () => [
      { value: '', label: '自动（默认根分区）' },
      ...(metrics?.mounts || []).map((m) => ({
        value: m.mount,
        label: `${m.mount} (${formatBytes(m.used_bytes)} / ${formatBytes(m.total_bytes)})`,
      })),
    ],
    [metrics?.mounts],
  );

  const sectionHighlightStyle = (sectionId: string): React.CSSProperties =>
    highlightSection === sectionId
      ? {
          boxShadow: '0 0 0 2px var(--brand)',
          borderRadius: 'var(--radius-lg)',
          padding: '8px',
          transition: 'all 220ms ease',
        }
      : { transition: 'all 220ms ease' };

  const updateMonitor = (patch: Partial<UserSettings['monitorConfig']>) => {
    updateSettings({ monitorConfig: { ...mc, ...patch } });
  };

  const handleToggleMetric = (key: MonitorMetricKey) => {
    const exists = mc.metrics.includes(key);
    if (exists && mc.metrics.length <= 1) {
      toast('至少保留 1 项指标', true);
      return;
    }
    const next = exists ? mc.metrics.filter((k) => k !== key) : [...mc.metrics, key];
    updateMonitor({ metrics: next });
  };

  const handleMoveMetric = (key: MonitorMetricKey, dir: -1 | 1) => {
    const idx = mc.metrics.indexOf(key);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= mc.metrics.length) return;
    const next = [...mc.metrics];
    const [moved] = next.splice(idx, 1);
    next.splice(target, 0, moved);
    updateMonitor({ metrics: next });
  };

  if (!canViewMonitor) {
    return (
      <div className="p-5 rounded-2xl text-center space-y-1.5" style={{ background: 'var(--pill-bg)' }}>
        <div className="text-sm font-medium">未授权查看节点监控</div>
        <div style={{ color: 'var(--ink-muted)' }}>请联系管理员在「账号权限」中开启监控共享</div>
      </div>
    );
  }

  return (
    <>
      {metrics && (
        <section
          data-section="sec-mon-live"
          style={sectionHighlightStyle('sec-mon-live')}
          className="space-y-3"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex items-center gap-2">
              <Activity className="w-4 h-4 shrink-0" style={{ color: 'var(--brand)' }} />
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">{metrics.hostname}</div>
                <div className="font-mono text-[11px] truncate" style={{ color: 'var(--ink-muted)' }}>
                  {[metrics.os_name, metrics.kernel, metrics.arch].filter(Boolean).join(' · ')}
                </div>
              </div>
            </div>
            <button
              type="button"
              disabled={refreshing}
              onClick={() => void handleRefreshMetrics()}
              className="h-7 px-2.5 rounded-lg flex items-center gap-1 cursor-pointer orbit-hover shrink-0 disabled:opacity-60"
              style={{ background: 'var(--pill-bg)' }}
              title="刷新遥测"
            >
              <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
              <span>刷新</span>
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="p-2.5 rounded-xl" style={{ background: 'var(--pill-bg)' }}>
              <div style={{ color: 'var(--ink-muted)' }}>CPU ({metrics.cpu_cores || 1} 核)</div>
              <div className="font-mono font-semibold mt-0.5">{metrics.cpu_percent}%</div>
            </div>
            <div className="p-2.5 rounded-xl" style={{ background: 'var(--pill-bg)' }}>
              <div style={{ color: 'var(--ink-muted)' }}>负载 1 / 5 / 15</div>
              <div className="font-mono font-semibold mt-0.5">
                {metrics.load1.toFixed(2)} / {metrics.load5.toFixed(2)} / {metrics.load15.toFixed(2)}
              </div>
            </div>
            <div className="p-2.5 rounded-xl" style={{ background: 'var(--pill-bg)' }}>
              <div style={{ color: 'var(--ink-muted)' }}>运行时长</div>
              <div className="font-mono font-semibold mt-0.5">
                {formatDetailedUptime(metrics.uptime_seconds)}
              </div>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-1.5">
            {metrics.cpu_model && (
              <div
                className="sm:col-span-2 px-3 py-2 rounded-xl flex items-center justify-between gap-2"
                style={{ background: 'var(--pill-bg)' }}
              >
                <span className="shrink-0" style={{ color: 'var(--ink-muted)' }}>处理器</span>
                <span className="font-mono truncate">{metrics.cpu_model}</span>
              </div>
            )}
            <div
              className="px-3 py-2 rounded-xl flex items-center justify-between gap-2"
              style={{ background: 'var(--pill-bg)' }}
            >
              <span style={{ color: 'var(--ink-muted)' }}>内存 ({metrics.ram_percent}%)</span>
              <span className="font-mono shrink-0">
                {formatBytes(metrics.ram_used_bytes)} / {formatBytes(metrics.ram_total_bytes)}
              </span>
            </div>
            <div
              className="px-3 py-2 rounded-xl flex items-center justify-between gap-2"
              style={{ background: 'var(--pill-bg)' }}
            >
              <span style={{ color: 'var(--ink-muted)' }}>Swap</span>
              <span className="font-mono shrink-0">
                {metrics.swap_total_bytes > 0
                  ? `${formatBytes(metrics.swap_used_bytes)} / ${formatBytes(metrics.swap_total_bytes)} (${metrics.swap_percent}%)`
                  : '未启用'}
              </span>
            </div>
            <div
              className="px-3 py-2 rounded-xl flex items-center justify-between gap-2"
              style={{ background: 'var(--pill-bg)' }}
            >
              <span style={{ color: 'var(--ink-muted)' }}>实时速率</span>
              <span className="font-mono shrink-0">
                ↑ {formatSpeed(metrics.net_up_bps)} · ↓ {formatSpeed(metrics.net_down_bps)}
              </span>
            </div>
            <div
              className="px-3 py-2 rounded-xl flex items-center justify-between gap-2"
              style={{ background: 'var(--pill-bg)' }}
            >
              <span style={{ color: 'var(--ink-muted)' }}>累计流量</span>
              <span className="font-mono shrink-0">
                ↑ {formatBytes(metrics.net_tx_total_bytes)} · ↓ {formatBytes(metrics.net_rx_total_bytes)}
              </span>
            </div>
            {(metrics.lan_ip || metrics.tailscale_ip) && (
              <div
                className="px-3 py-2 rounded-xl flex items-center justify-between gap-2"
                style={{ background: 'var(--pill-bg)' }}
              >
                <span style={{ color: 'var(--ink-muted)' }}>节点地址</span>
                <span className="font-mono truncate">
                  {[
                    metrics.lan_ip && `LAN ${metrics.lan_ip}`,
                    metrics.tailscale_ip && `TS ${metrics.tailscale_ip}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
            )}
            <div
              className="px-3 py-2 rounded-xl flex items-center justify-between gap-2"
              style={{ background: 'var(--pill-bg)' }}
            >
              <span style={{ color: 'var(--ink-muted)' }}>进程 · 温度 · 内存</span>
              <span className="font-mono truncate">
                {metrics.processes} · {metrics.cpu_temp_c != null ? `${metrics.cpu_temp_c}°C` : '无传感器'} ·{' '}
                {metrics.orbit_alloc_mb}M/{metrics.orbit_sys_mb}M
              </span>
            </div>
          </div>

          {metrics.mounts && metrics.mounts.length > 0 && (
            <div className="space-y-1.5">
              <div style={{ color: 'var(--ink-muted)' }}>磁盘挂载点</div>
              <div className="grid sm:grid-cols-2 gap-1.5">
                {metrics.mounts.map((m) => (
                  <div
                    key={m.mount}
                    className="px-3 py-2 rounded-xl space-y-1"
                    style={{ background: 'var(--pill-bg)' }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-medium truncate">{m.mount}</span>
                      <span className="font-mono shrink-0">
                        {formatBytes(m.used_bytes)} / {formatBytes(m.total_bytes)} ({m.percent}%)
                      </span>
                    </div>
                    <div
                      className="h-1 rounded-full overflow-hidden"
                      style={{ background: 'var(--track-bg)' }}
                    >
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${Math.min(100, m.percent)}%`, background: 'var(--warn)' }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      <section
        data-section="sec-mon-hdr"
        style={{
          ...sectionHighlightStyle('sec-mon-hdr'),
          ...(metrics ? { borderColor: 'var(--glass-border)' } : {}),
        }}
        className={`space-y-3 ${metrics ? 'pt-4 border-t' : ''}`}
      >
        <div className="font-medium text-sm">卡片自定义</div>
        <div className="grid sm:grid-cols-2 gap-2.5">
          <label className="space-y-1">
            <span style={{ color: 'var(--ink-muted)' }}>卡片标题</span>
            <input
              type="text"
              value={mc.title}
              onChange={(e) => updateMonitor({ title: e.target.value })}
              placeholder={metrics?.hostname || 'Orbit-Node'}
              className="w-full h-8 px-2.5 rounded-lg focus:outline-none"
              style={{
                background: 'var(--input-bg)',
                border: '1px solid var(--glass-border)',
                color: 'var(--ink)',
              }}
            />
          </label>
          <div className="space-y-1">
            <span className="block" style={{ color: 'var(--ink-muted)' }}>
              磁盘挂载点
            </span>
            <OrbitSelect
              size="sm"
              value={mc.diskMount}
              options={mountOptions}
              onChange={(v) => updateMonitor({ diskMount: v })}
              className="w-full"
              ariaLabel="监控磁盘挂载点"
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => updateMonitor({ showNetSpeed: !mc.showNetSpeed })}
            className="p-2 rounded-xl text-left cursor-pointer"
            style={{
              background: mc.showNetSpeed ? 'var(--brand-solid)' : 'var(--pill-bg)',
              color: mc.showNetSpeed ? '#fff' : 'var(--ink-muted)',
            }}
          >
            <div className="font-medium">实时网速</div>
            <div className="opacity-80">↑↓ 速率</div>
          </button>
          <button
            type="button"
            onClick={() => updateMonitor({ showSparkline: !mc.showSparkline })}
            className="p-2 rounded-xl text-left cursor-pointer"
            style={{
              background: mc.showSparkline ? 'var(--brand-solid)' : 'var(--pill-bg)',
              color: mc.showSparkline ? '#fff' : 'var(--ink-muted)',
            }}
          >
            <div className="font-medium">CPU 曲线</div>
            <div className="opacity-80">历史折线</div>
          </button>
          <button
            type="button"
            onClick={() => updateMonitor({ showLanIP: !mc.showLanIP })}
            className="p-2 rounded-xl text-left cursor-pointer"
            style={{
              background: mc.showLanIP ? 'var(--brand-solid)' : 'var(--pill-bg)',
              color: mc.showLanIP ? '#fff' : 'var(--ink-muted)',
            }}
          >
            <div className="font-medium">内网 IP</div>
            <div className="opacity-80">{metrics?.lan_ip || 'LAN'}</div>
          </button>
        </div>
      </section>

      <section
        data-section="sec-mon-met"
        style={{ ...sectionHighlightStyle('sec-mon-met'), borderColor: 'var(--glass-border)' }}
        className="space-y-2.5 pt-4 border-t"
      >
        <div className="flex items-center justify-between flex-wrap gap-2">
          <span className="font-medium text-sm">监控指标</span>
          <div className="flex items-center gap-2">
            <span style={{ color: 'var(--ink-muted)' }}>列数</span>
            {([2, 3, 4] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => updateMonitor({ columns: c })}
                className="px-2 py-0.5 rounded-md cursor-pointer"
                style={{
                  background: mc.columns === c ? 'var(--brand-solid)' : 'var(--pill-bg)',
                  color: mc.columns === c ? '#fff' : 'var(--ink-muted)',
                }}
              >
                {c}列
              </button>
            ))}
            <span style={{ color: 'var(--ink-muted)' }} className="ml-1">
              刷新
            </span>
            {([2, 3, 5, 10] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => updateMonitor({ refreshSeconds: s })}
                className="px-2 py-0.5 rounded-md cursor-pointer"
                style={{
                  background: mc.refreshSeconds === s ? 'var(--brand-solid)' : 'var(--pill-bg)',
                  color: mc.refreshSeconds === s ? '#fff' : 'var(--ink-muted)',
                }}
              >
                {s}s
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          {mc.metrics.map((k, idx) => (
            <div
              key={k}
              className="px-3 py-1.5 rounded-xl flex items-center justify-between"
              style={{ background: 'var(--pill-bg)', border: '1px solid var(--glass-border)' }}
            >
              <div className="flex items-center gap-2">
                <span className="font-mono opacity-60">#{idx + 1}</span>
                <span className="font-medium">{METRIC_LABELS[k]}</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={idx === 0}
                  onClick={() => handleMoveMetric(k, -1)}
                  className="p-1 rounded orbit-hover disabled:opacity-30 cursor-pointer"
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  disabled={idx === mc.metrics.length - 1}
                  onClick={() => handleMoveMetric(k, 1)}
                  className="p-1 rounded orbit-hover disabled:opacity-30 cursor-pointer"
                >
                  <ArrowDown className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => handleToggleMetric(k)}
                  className="px-2 py-0.5 rounded orbit-hover cursor-pointer"
                  style={{ color: 'var(--danger)' }}
                >
                  移除
                </button>
              </div>
            </div>
          ))}
        </div>

        {ALL_METRIC_KEYS.some((k) => !mc.metrics.includes(k)) && (
          <div className="space-y-1.5">
            <div style={{ color: 'var(--ink-muted)' }}>添加指标</div>
            <div className="flex flex-wrap gap-1.5">
              {ALL_METRIC_KEYS.filter((k) => !mc.metrics.includes(k)).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => handleToggleMetric(k)}
                  className="px-2.5 py-1 rounded-lg flex items-center gap-1 cursor-pointer orbit-hover"
                  style={{ background: 'var(--pill-hover)' }}
                >
                  <Plus className="w-3 h-3" />
                  <span>{METRIC_LABELS[k]}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>
    </>
  );
}
