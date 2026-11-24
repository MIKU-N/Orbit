import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { api } from '../../api/client';

interface ShareModalProps {
  target: { kind: 'file' | 'clip'; id: number; label: string } | null;
  onClose: () => void;
  onCopy: (text: string, label?: string) => void;
  onToast: (msg: string, warn?: boolean) => void;
}

export function ShareModal({ target, onClose, onCopy, onToast }: ShareModalProps) {
  const [ttlMinutes, setTtlMinutes] = useState(60);
  const [burnAfterRead, setBurnAfterRead] = useState(true);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setCode('');
  }, [target]);

  if (!target) return null;

  const generate = async () => {
    setLoading(true);
    try {
      const res = await api.createShare(target.kind, target.id, ttlMinutes, burnAfterRead);
      setCode(res.code);
    } catch (e) {
      onToast((e as Error).message || '生成取件码失败', true);
    } finally {
      setLoading(false);
    }
  };

  const fullUrl = code ? `${window.location.origin}/s/${code}` : '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-xs" onClick={onClose} />
      <div className="relative w-full max-w-xs glass-strong rounded-2xl p-5 space-y-4 pop-in text-xs">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">取件码</h3>
          <button type="button" onClick={onClose} className="cursor-pointer opacity-70 hover:opacity-100">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="truncate" style={{ color: 'var(--ink-muted)' }}>
          {target.label}
        </div>

        {code ? (
          <>
            <div className="p-4 rounded-2xl text-center space-y-1" style={{ background: 'var(--pill-bg)' }}>
              <div
                className="text-2xl font-mono font-bold tracking-[0.28em] select-all"
                style={{ color: 'var(--brand)' }}
              >
                {code}
              </div>
              <div className="font-mono truncate" style={{ color: 'var(--ink-muted)' }}>
                {fullUrl}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                onCopy(`Orbit 取件码：${code}\n${fullUrl}`, '已复制取件码与链接');
                onClose();
              }}
              className="w-full h-9 rounded-xl font-medium text-white cursor-pointer"
              style={{ background: 'var(--brand-solid)' }}
            >
              复制链接与取件码
            </button>
          </>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span style={{ color: 'var(--ink-muted)' }}>有效期</span>
              <select
                value={ttlMinutes}
                onChange={(e) => setTtlMinutes(Number(e.target.value))}
                className="h-8 px-2.5 rounded-lg focus:outline-none"
                style={{
                  background: 'rgba(var(--glass-rgb), 0.75)',
                  border: '1px solid var(--glass-border)',
                  color: 'var(--ink)',
                }}
              >
                <option value={10}>10 分钟</option>
                <option value={60}>1 小时</option>
                <option value={1440}>24 小时</option>
              </select>
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
              {loading ? '生成中...' : '生成 6 位取件码'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
