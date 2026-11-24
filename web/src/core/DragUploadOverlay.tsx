import { UploadCloud } from 'lucide-react';
import { formatLimitMB } from '../sdk/primitives';
import type { NetworkZone } from '../types';

interface DragUploadOverlayProps {
  visible: boolean;
  detectedZone: NetworkZone;
  limits: { lan_mb: number; ts_mb: number; wan_mb: number };
}

export function DragUploadOverlay({ visible, detectedZone, limits }: DragUploadOverlayProps) {
  if (!visible) return null;

  const limitMB =
    detectedZone === 'lan'
      ? limits.lan_mb
      : detectedZone === 'tailscale'
        ? limits.ts_mb
        : limits.wan_mb;
  const zoneName =
    detectedZone === 'lan' ? '局域网模式' : detectedZone === 'tailscale' ? 'Tailscale 模式' : '外网模式';
  const hint = `${zoneName} · 单文件上限 ${formatLimitMB(limitMB)}`;

  return (
    <div className="fixed inset-0 z-50 glass-strong flex items-center justify-center p-6 pointer-events-none">
      <div
        className="max-w-sm w-full text-center space-y-2.5 p-8 rounded-3xl border-2 border-dashed"
        style={{ borderColor: 'var(--brand)' }}
      >
        <UploadCloud className="w-8 h-8 mx-auto" style={{ color: 'var(--brand)' }} />
        <div className="text-base font-semibold">松手上传到 Orbit 暂存箱</div>
        <div className="text-xs font-mono" style={{ color: 'var(--ink-muted)' }}>
          {hint}
        </div>
      </div>
    </div>
  );
}
