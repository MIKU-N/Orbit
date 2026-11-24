import { UploadCloud } from 'lucide-react';
import type { NetworkZone } from '../types';

interface DragUploadOverlayProps {
  visible: boolean;
  detectedZone: NetworkZone;
  wanMaxMB: number;
}

export function DragUploadOverlay({ visible, detectedZone, wanMaxMB }: DragUploadOverlayProps) {
  if (!visible) return null;

  const hint =
    detectedZone === 'wan'
      ? `外网模式单文件限 ${wanMaxMB} MB`
      : detectedZone === 'tailscale'
        ? 'Tailscale 组网直传'
        : '局域网直传 · 高速写入';

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
