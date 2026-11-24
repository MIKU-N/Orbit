import { Clipboard, Globe, Home, UploadCloud, Wifi, WifiOff } from 'lucide-react';
import { useOrbitHost } from '../sdk/host';
import { formatBytes, formatLimitMB } from '../sdk/primitives';
import type { NetworkZone } from '../types';

interface ZoneStatusPopoverProps {
  open: boolean;
  onClose: () => void;
}

function TailscaleMiniIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
      <circle cx="6" cy="6" r="2" opacity=".45" />
      <circle cx="12" cy="6" r="2" opacity=".45" />
      <circle cx="18" cy="6" r="2" opacity=".45" />
      <circle cx="6" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="18" cy="12" r="2" />
      <circle cx="6" cy="18" r="2" opacity=".45" />
      <circle cx="12" cy="18" r="2" />
      <circle cx="18" cy="18" r="2" opacity=".45" />
    </svg>
  );
}

const ZONE_LABELS: Record<NetworkZone, string> = {
  lan: '局域网',
  tailscale: 'Tailscale',
  wan: '外网',
};

export function ZoneStatusPopover({ open, onClose }: ZoneStatusPopoverProps) {
  const host = useOrbitHost();
  if (!open) return null;

  const {
    zone,
    detectedZone,
    clientIp,
    setZone,
    limits,
    wsConnected,
    peers,
    clips,
    filesData,
    openDrawer,
    isPluginEnabled,
  } = host;

  const activeZoneLimitMB =
    zone === 'lan' ? limits.lan_mb : zone === 'tailscale' ? limits.ts_mb : limits.wan_mb;
  const detectedLimitMB =
    filesData?.zone_limit_mb ??
    (detectedZone === 'lan'
      ? limits.lan_mb
      : detectedZone === 'tailscale'
        ? limits.ts_mb
        : limits.wan_mb);

  const zones: { id: NetworkZone; label: string; icon: React.ReactNode; limitMB: number }[] = [
    { id: 'lan', label: '局域网', icon: <Home className="w-3.5 h-3.5" />, limitMB: limits.lan_mb },
    {
      id: 'tailscale',
      label: 'Tailscale',
      icon: <TailscaleMiniIcon />,
      limitMB: limits.ts_mb,
    },
    { id: 'wan', label: '外网', icon: <Globe className="w-3.5 h-3.5" />, limitMB: limits.wan_mb },
  ];

  return (
    <div
      id="zonePanel"
      onClick={(e) => e.stopPropagation()}
      className="fixed top-16 left-4 sm:left-6 z-40 w-72 max-w-[calc(100vw-2rem)] glass-strong rounded-2xl p-3 space-y-3 pop-in text-xs"
    >
      <div className="flex items-center justify-between gap-2 pb-2 border-b" style={{ borderColor: 'var(--glass-border)' }}>
        <div className="min-w-0">
          <div className="font-semibold text-sm">网络与连接状态</div>
          <div className="font-mono truncate mt-0.5" style={{ color: 'var(--ink-muted)' }}>
            识别：{ZONE_LABELS[detectedZone]}
            {clientIp ? ` · ${clientIp}` : ''}
          </div>
        </div>
        <span
          className="px-2 py-0.5 rounded-full flex items-center gap-1 shrink-0 font-medium"
          style={{
            background: 'var(--pill-bg)',
            color: wsConnected ? 'var(--ok)' : 'var(--ink-muted)',
          }}
        >
          {wsConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
          <span>{wsConnected ? '已连接' : '重连中'}</span>
        </span>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between" style={{ color: 'var(--ink-muted)' }}>
          <span>书签路由视图</span>
          <span className="font-mono">
            {zone === detectedZone ? `单文件 ≤ ${formatLimitMB(detectedLimitMB)}` : `视图限额 ${formatLimitMB(activeZoneLimitMB)}`}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-1 p-1 rounded-xl" style={{ background: 'var(--pill-bg)' }}>
          {zones.map((item) => {
            const active = zone === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setZone(item.id)}
                className="py-1.5 px-1.5 rounded-lg flex flex-col items-center gap-1 cursor-pointer transition-colors"
                style={{
                  background: active ? 'var(--brand-solid)' : 'transparent',
                  color: active ? '#fff' : 'var(--ink-muted)',
                }}
              >
                {item.icon}
                <span className="font-medium leading-none">{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-1.5 pt-1 border-t" style={{ borderColor: 'var(--glass-border)' }}>
        <div className="flex items-center justify-between" style={{ color: 'var(--ink-muted)' }}>
          <span>当前实际上传上限</span>
          <span className="font-mono font-medium" style={{ color: 'var(--ink)' }}>
            {ZONE_LABELS[detectedZone]} ≤ {formatLimitMB(detectedLimitMB)}
          </span>
        </div>
        <div className="flex items-center justify-between" style={{ color: 'var(--ink-muted)' }}>
          <span>在线 P2P 设备</span>
          <span className="font-mono" style={{ color: peers.length > 0 ? 'var(--ok)' : 'var(--ink-muted)' }}>
            {peers.length > 0 ? `${peers.length} 台在线` : '暂无其他设备'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1.5 pt-1 border-t" style={{ borderColor: 'var(--glass-border)' }}>
        {isPluginEnabled('orbit.clipboard') && (
          <button
            type="button"
            onClick={() => {
              onClose();
              openDrawer('clipboard');
            }}
            className="p-2 rounded-xl text-left hover:bg-white/10 cursor-pointer transition-colors"
            style={{ background: 'var(--pill-bg)' }}
          >
            <div className="flex items-center gap-1.5 font-medium">
              <Clipboard className="w-3.5 h-3.5 opacity-80" />
              <span>剪贴板</span>
            </div>
            <div className="font-mono mt-0.5" style={{ color: 'var(--ink-muted)' }}>
              {clips.length} 条记录
            </div>
          </button>
        )}

        {isPluginEnabled('orbit.transfer') && (
          <button
            type="button"
            onClick={() => {
              onClose();
              openDrawer('files');
            }}
            className="p-2 rounded-xl text-left hover:bg-white/10 cursor-pointer transition-colors"
            style={{ background: 'var(--pill-bg)' }}
          >
            <div className="flex items-center gap-1.5 font-medium">
              <UploadCloud className="w-3.5 h-3.5 opacity-80" />
              <span>文件快传</span>
            </div>
            <div className="font-mono mt-0.5 truncate" style={{ color: 'var(--ink-muted)' }}>
              {filesData ? `${filesData.files.length} 个 · ${formatBytes(filesData.storage_used)}` : '查看暂存箱'}
            </div>
          </button>
        )}
      </div>
    </div>
  );
}
