import { useEffect, useState } from 'react';
import { Copy, X } from 'lucide-react';
import { api } from '../../api/client';
import { CenteredModal, OrbitSelect } from '../../sdk/primitives';

interface ShareModalProps {
  target: { kind: 'file' | 'clip'; id: number; label: string } | null;
  onClose: () => void;
  onCopy: (text: string, label?: string) => Promise<boolean>;
  onToast: (msg: string, warn?: boolean) => void;
}

const TTL_OPTIONS = [
  { value: '10', label: '10 分钟' },
  { value: '60', label: '1 小时' },
  { value: '1440', label: '24 小时' },
  { value: '10080', label: '7 天' },
];

export function ShareModal({ target, onClose, onCopy, onToast }: ShareModalProps) {
  const [ttlMinutes, setTtlMinutes] = useState(60);
  const [burnAfterRead, setBurnAfterRead] = useState(true);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [cachedTarget, setCachedTarget] = useState(target);

  useEffect(() => {
    if (target) {
      setCachedTarget(target);
      setCode('');
    }
  }, [target]);

  const activeTarget = target || cachedTarget;

  const generate = async () => {
    if (!activeTarget) return;
    setLoading(true);
    try {
      const res = await api.createShare(activeTarget.kind, activeTarget.id, ttlMinutes, burnAfterRead);
      setCode(res.code);
    } catch (e) {
      onToast((e as Error).message || '生成取件码失败', true);
    } finally {
      setLoading(false);
    }
  };

  const fullUrl = code ? `${window.location.origin}/s/${code}` : '';

  const handleCopyShare = async (payload: string, msg: string, closeOnOk: boolean) => {
    const ok = await onCopy(payload, msg);
    if (ok && closeOnOk) {
      onClose();
    }
  };

  return (
    <CenteredModal
      open={Boolean(target)}
      onClose={onClose}
      zIndexClass="z-[60]"
      panelClassName="w-full max-w-xs p-5 space-y-4 text-xs"
    >
      {activeTarget && (
        <>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">快速分享</h3>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer opacity-70 hover:opacity-100 p-0.5"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="truncate" style={{ color: 'var(--ink-muted)' }}>
          {activeTarget.label}
        </div>

        {code ? (
          <>
            <div className="p-4 rounded-2xl text-center space-y-1.5" style={{ background: 'var(--pill-bg)' }}>
              <div
                className="text-2xl font-mono font-bold tracking-[0.28em] select-all"
                style={{ color: 'var(--brand)' }}
              >
                {code}
              </div>
              <div className="font-mono text-[11px] break-all select-all" style={{ color: 'var(--ink-muted)' }}>
                {fullUrl}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void handleCopyShare(code, '已复制取件码', false)}
                className="flex-1 h-9 rounded-xl font-medium flex items-center justify-center gap-1 cursor-pointer"
                style={{ background: 'var(--pill-hover)' }}
              >
                <Copy className="w-3.5 h-3.5" />
                <span>复制取件码</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  void handleCopyShare(`Orbit 取件码：${code}\n${fullUrl}`, '已复制链接与取件码', true)
                }
                className="flex-1 h-9 rounded-xl font-medium text-white flex items-center justify-center gap-1 cursor-pointer"
                style={{ background: 'var(--brand-solid)' }}
              >
                <Copy className="w-3.5 h-3.5" />
                <span>复制链接</span>
              </button>
            </div>
          </>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span style={{ color: 'var(--ink-muted)' }}>有效期</span>
              <OrbitSelect
                value={String(ttlMinutes)}
                options={TTL_OPTIONS}
                onChange={(v) => setTtlMinutes(Number(v))}
                className="w-32"
                ariaLabel="分享有效期"
              />
            </div>
            <label className="flex items-center justify-between cursor-pointer">
              <span style={{ color: 'var(--ink-muted)' }}>阅后即焚</span>
              <input
                type="checkbox"
                checked={burnAfterRead}
                onChange={(e) => setBurnAfterRead(e.target.checked)}
                className="w-4 h-4 accent-indigo-500"
              />
            </label>
            <button
              type="button"
              disabled={loading}
              onClick={() => void generate()}
              className="w-full h-9 rounded-xl font-medium text-white cursor-pointer disabled:opacity-60"
              style={{ background: 'var(--brand-solid)' }}
            >
              {loading ? '生成中...' : '生成取件码'}
            </button>
          </div>
        )}
        </>
      )}
    </CenteredModal>
  );
}
