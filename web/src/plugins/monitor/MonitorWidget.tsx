import type { MonitorConfig, MonitorMetricKey, SystemMetrics } from '../../types';
import { WidgetSurface, formatBytes, formatSpeed } from '../../sdk/primitives';

interface MonitorWidgetProps {
  metrics: SystemMetrics | null;
  config: MonitorConfig;
  cardless?: boolean;
  enableTilt: boolean;
  layoutEditing: boolean;
  onOpenDetail: () => void;
}

function formatCompactUptime(sec: number): string {
  const days = Math.floor(sec / 86400);
  if (days > 0) return `${days}d${Math.floor((sec % 86400) / 3600)}h`;
  const hours = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  if (hours > 0) return `${hours}h${mins}m`;
  return `${mins}m`;
}

export function MonitorWidget({
  metrics,
  config,
  cardless = false,
  enableTilt,
  layoutEditing,
  onOpenDetail,
}: MonitorWidgetProps) {
  const hist = metrics?.cpu_history?.length ? metrics.cpu_history : [12, 16, 14, 18, 15, 17];
  const points = hist
    .map((v, i) => {
      const x = hist.length > 1 ? (i / (hist.length - 1)) * 56 : 56;
      const y = 18 - (Math.min(100, Math.max(0, v)) / 100) * 16;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const displayTitle = config.title?.trim() || metrics?.hostname || 'Orbit-Node';
  const metricList: MonitorMetricKey[] = config.metrics?.length
    ? config.metrics
    : ['cpu', 'ram', 'disk'];
  const cols = config.columns || 3;
  const gridClass =
    cols === 2 ? 'grid-cols-2' : cols === 4 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3';

  const tileStyle = cardless ? undefined : { background: 'var(--pill-bg)' };
  const mutedStyle = { color: cardless ? 'var(--hero-ink-muted)' : 'var(--ink-muted)' };
  const trackStyle = { background: cardless ? 'rgba(255,255,255,0.24)' : 'var(--track-bg)' };

  const renderTile = (key: MonitorMetricKey) => {
    switch (key) {
      case 'cpu':
        return (
          <div
            key={key}
            className="px-2.5 py-1.5 rounded-xl flex items-center justify-between gap-1.5"
            style={tileStyle}
          >
            <div className="min-w-0">
              <div style={mutedStyle}>CPU</div>
              <div className="font-mono font-semibold">{Math.round(metrics?.cpu_percent || 0)}%</div>
            </div>
            {config.showSparkline && (
              <svg viewBox="0 0 56 20" className="w-10 h-5 overflow-visible shrink-0 hidden sm:block">
                <polyline
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ color: 'var(--brand)' }}
                  points={points}
                />
              </svg>
            )}
          </div>
        );

      case 'ram':
        return (
          <div key={key} className="px-2.5 py-1.5 rounded-xl space-y-1.5" style={tileStyle}>
            <div className="flex justify-between gap-1">
              <span style={mutedStyle}>内存</span>
              <span className="font-mono font-semibold">{Math.round(metrics?.ram_percent || 0)}%</span>
            </div>
            <div className="h-1 rounded-full overflow-hidden" style={trackStyle}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.min(100, metrics?.ram_percent || 0)}%`,
                  background: 'var(--ok)',
                }}
              />
            </div>
          </div>
        );

      case 'disk':
        return (
          <div key={key} className="px-2.5 py-1.5 rounded-xl space-y-1.5" style={tileStyle}>
            <div className="flex justify-between gap-1">
              <span className="truncate" style={mutedStyle}>
                {metrics?.disk_mount && metrics.disk_mount !== '/' ? metrics.disk_mount : '存储'}
              </span>
              <span className="font-mono font-semibold shrink-0">{Math.round(metrics?.disk_percent || 0)}%</span>
            </div>
            <div className="h-1 rounded-full overflow-hidden" style={trackStyle}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.min(100, metrics?.disk_percent || 0)}%`,
                  background: 'var(--warn)',
                }}
              />
            </div>
          </div>
        );

      case 'swap':
        return (
          <div key={key} className="px-2.5 py-1.5 rounded-xl space-y-1.5" style={tileStyle}>
            <div className="flex justify-between gap-1">
              <span style={mutedStyle}>Swap</span>
              <span className="font-mono font-semibold">
                {metrics && metrics.swap_total_bytes > 0 ? `${Math.round(metrics.swap_percent)}%` : '—'}
              </span>
            </div>
            <div className="h-1 rounded-full overflow-hidden" style={trackStyle}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.min(100, metrics?.swap_percent || 0)}%`,
                  background: 'var(--brand)',
                }}
              />
            </div>
          </div>
        );

      case 'load':
        return (
          <div key={key} className="px-2.5 py-1.5 rounded-xl" style={tileStyle}>
            <div style={mutedStyle}>负载</div>
            <div className="font-mono font-semibold">{(metrics?.load1 || 0).toFixed(2)}</div>
          </div>
        );

      case 'uptime':
        return (
          <div key={key} className="px-2.5 py-1.5 rounded-xl" style={tileStyle}>
            <div style={mutedStyle}>运行</div>
            <div className="font-mono font-semibold truncate">
              {metrics ? formatCompactUptime(metrics.uptime_seconds) : '—'}
            </div>
          </div>
        );

      case 'temp':
        return (
          <div key={key} className="px-2.5 py-1.5 rounded-xl" style={tileStyle}>
            <div style={mutedStyle}>温度</div>
            <div className="font-mono font-semibold">
              {metrics?.cpu_temp_c != null ? `${metrics.cpu_temp_c}°C` : 'N/A'}
            </div>
          </div>
        );

      case 'processes':
        return (
          <div key={key} className="px-2.5 py-1.5 rounded-xl" style={tileStyle}>
            <div style={mutedStyle}>进程</div>
            <div className="font-mono font-semibold">{metrics?.processes || 0}</div>
          </div>
        );

      case 'orbit':
        return (
          <div key={key} className="px-2.5 py-1.5 rounded-xl" style={tileStyle}>
            <div style={mutedStyle}>Orbit</div>
            <div className="font-mono font-semibold">{metrics?.orbit_alloc_mb || 0}M</div>
          </div>
        );

      case 'net_total':
        return (
          <div key={key} className="px-2.5 py-1.5 rounded-xl" style={tileStyle}>
            <div style={mutedStyle}>总下行</div>
            <div className="font-mono font-semibold truncate">
              {formatBytes(metrics?.net_rx_total_bytes || 0)}
            </div>
          </div>
        );
    }
  };

  return (
    <WidgetSurface
      cardless={cardless}
      enableTilt={enableTilt}
      layoutEditing={layoutEditing}
      onClick={() => {
        if (!layoutEditing) onOpenDetail();
      }}
      cardClassName="rounded-2xl p-4 space-y-2.5 cursor-pointer min-h-[108px] flex flex-col justify-center"
      plainClassName="px-2 py-2 space-y-2 cursor-pointer flex flex-col justify-center"
    >
      <div className="flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: 'var(--ok)' }} />
          <span className="font-medium truncate">{displayTitle}</span>
          {config.showLanIP && (metrics?.lan_ip || metrics?.tailscale_ip) && (
            <span
              className="font-mono px-1.5 py-0.5 rounded-md truncate hidden sm:inline"
              style={{
                background: cardless ? 'rgba(255,255,255,0.14)' : 'var(--pill-bg)',
                color: cardless ? 'var(--hero-ink-muted)' : 'var(--ink-muted)',
              }}
            >
              {metrics.lan_ip || metrics.tailscale_ip}
            </span>
          )}
        </div>
        {config.showNetSpeed && (
          <div className="flex items-center gap-2.5 font-mono shrink-0" style={mutedStyle}>
            <span>↑ {formatSpeed(metrics?.net_up_bps || 0)}</span>
            <span>↓ {formatSpeed(metrics?.net_down_bps || 0)}</span>
          </div>
        )}
      </div>

      <div className={`grid ${gridClass} gap-2 items-center text-xs`}>
        {metricList.map((m) => renderTile(m))}
      </div>
    </WidgetSurface>
  );
}
