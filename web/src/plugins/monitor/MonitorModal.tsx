import { Settings, X } from 'lucide-react';
import type { SystemMetrics } from '../../types';
import { formatBytes, formatSpeed } from '../../sdk/primitives';

interface MonitorModalProps {
  open: boolean;
  metrics: SystemMetrics | null;
  onClose: () => void;
  onOpenCustomize: () => void;
}

function formatUptime(sec: number): string {
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  if (days > 0) return `${days} 天 ${hours} 小时`;
  const mins = Math.floor((sec % 3600) / 60);
  return `${hours} 时 ${mins} 分`;
}

export function MonitorModal({ open, metrics, onClose, onOpenCustomize }: MonitorModalProps) {
  if (!open || !metrics) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-xs" onClick={onClose} />
      <div className="relative w-full max-w-md max-h-[88vh] overflow-y-auto glass-strong rounded-2xl p-5 space-y-4 pop-in text-xs">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold truncate">{metrics.hostname}</h3>
            <p className="font-mono truncate" style={{ color: 'var(--ink-muted)' }}>
              {[metrics.os_name, metrics.kernel, metrics.arch].filter(Boolean).join(' · ')}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenCustomize();
              }}
              className="px-2.5 py-1 rounded-lg flex items-center gap-1 cursor-pointer"
              style={{ background: 'var(--pill-bg)' }}
              title="自定义监控卡片字段"
            >
              <Settings className="w-3.5 h-3.5" />
              <span>自定义</span>
            </button>
            <button type="button" onClick={onClose} className="cursor-pointer opacity-70 hover:opacity-100 p-1">
              <X className="w-4 h-4" />
            </button>
          </div>
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
            <div className="font-mono font-semibold mt-0.5">{formatUptime(metrics.uptime_seconds)}</div>
          </div>
        </div>

        <div className="space-y-1.5">
          {metrics.cpu_model && (
            <div className="px-3 py-2 rounded-xl flex items-center justify-between gap-2" style={{ background: 'var(--pill-bg)' }}>
              <span className="shrink-0">处理器</span>
              <span className="font-mono truncate">{metrics.cpu_model}</span>
            </div>
          )}
          <div className="px-3 py-2 rounded-xl flex items-center justify-between gap-2" style={{ background: 'var(--pill-bg)' }}>
            <span>系统内存 ({metrics.ram_percent}%)</span>
            <span className="font-mono">
              {formatBytes(metrics.ram_used_bytes)} / {formatBytes(metrics.ram_total_bytes)}
            </span>
          </div>
          <div className="px-3 py-2 rounded-xl flex items-center justify-between gap-2" style={{ background: 'var(--pill-bg)' }}>
            <span>Swap 交换分区</span>
            <span className="font-mono">
              {metrics.swap_total_bytes > 0
                ? `${formatBytes(metrics.swap_used_bytes)} / ${formatBytes(metrics.swap_total_bytes)} (${metrics.swap_percent}%)`
                : '未启用'}
            </span>
          </div>
          <div className="px-3 py-2 rounded-xl flex items-center justify-between gap-2" style={{ background: 'var(--pill-bg)' }}>
            <span>实时速率</span>
            <span className="font-mono">
              ↑ {formatSpeed(metrics.net_up_bps)} · ↓ {formatSpeed(metrics.net_down_bps)}
            </span>
          </div>
          <div className="px-3 py-2 rounded-xl flex items-center justify-between gap-2" style={{ background: 'var(--pill-bg)' }}>
            <span>累计流量</span>
            <span className="font-mono">
              ↑ {formatBytes(metrics.net_tx_total_bytes)} · ↓ {formatBytes(metrics.net_rx_total_bytes)}
            </span>
          </div>
          {(metrics.lan_ip || metrics.tailscale_ip) && (
            <div className="px-3 py-2 rounded-xl flex items-center justify-between gap-2" style={{ background: 'var(--pill-bg)' }}>
              <span>节点地址</span>
              <span className="font-mono">
                {[metrics.lan_ip && `LAN ${metrics.lan_ip}`, metrics.tailscale_ip && `TS ${metrics.tailscale_ip}`]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </div>
          )}
          <div className="px-3 py-2 rounded-xl flex items-center justify-between gap-2" style={{ background: 'var(--pill-bg)' }}>
            <span>进程 · 温度 · Orbit 内存</span>
            <span className="font-mono">
              {metrics.processes} 进程 · {metrics.cpu_temp_c != null ? `${metrics.cpu_temp_c}°C` : '无传感器'} · {metrics.orbit_alloc_mb}M/{metrics.orbit_sys_mb}M
            </span>
          </div>
        </div>

        {metrics.mounts && metrics.mounts.length > 0 && (
          <div className="space-y-1.5 pt-2 border-t" style={{ borderColor: 'var(--glass-border)' }}>
            <div className="font-medium" style={{ color: 'var(--ink-muted)' }}>磁盘挂载点</div>
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
                <div className="h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.12)' }}>
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${Math.min(100, m.percent)}%`, background: 'var(--warn)' }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
