import { useEffect, useState } from 'react';
import { Copy, Download, Info, Moon, Sun, X } from 'lucide-react';
import { api } from '../api/client';
import { copyToClipboard } from '../lib/clipboard';
import { PRESET_WALLPAPERS } from '../lib/wallpapers';
import { CenteredModal, formatBytes } from '../sdk/primitives';
import type { PublicShareMeta } from '../types';

interface AuthScreenProps {
  initialized: boolean;
  initialShareCode?: string;
  modal?: boolean;
  open?: boolean;
  notice?: string | null;
  theme?: 'dark' | 'light';
  onToggleTheme?: (ev?: React.MouseEvent<HTMLElement>) => void;
  onClose?: () => void;
  onAuthenticated: () => Promise<void>;
  onToast: (msg: string, warn?: boolean) => void;
}

export function AuthScreen({
  initialized,
  initialShareCode,
  modal = false,
  open = true,
  notice,
  theme = 'dark',
  onToggleTheme,
  onClose,
  onAuthenticated,
  onToast,
}: AuthScreenProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const [pickupCode, setPickupCode] = useState(initialShareCode || '');
  const [shareMeta, setShareMeta] = useState<PublicShareMeta | null>(null);
  const [shareLoading, setShareLoading] = useState(false);

  const lookupShare = async (rawCode: string) => {
    const c = rawCode.trim().toUpperCase();
    if (!c) {
      onToast('请输入取件码', true);
      return;
    }
    setShareLoading(true);
    try {
      const meta = await api.getPublicShare(c);
      setShareMeta(meta);
    } catch (e) {
      setShareMeta(null);
      onToast((e as Error).message || '取件码无效或已过期', true);
    } finally {
      setShareLoading(false);
    }
  };

  useEffect(() => {
    if (initialShareCode) {
      void lookupShare(initialShareCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialShareCode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (username.trim().length < 2 || password.length < 6) {
      onToast('用户名至少 2 位，密码至少 6 位', true);
      return;
    }
    setLoading(true);
    try {
      if (!initialized) {
        await api.setup(username.trim(), password);
        onToast('管理员初始化成功');
      } else {
        await api.login(username.trim(), password);
        onToast('登录成功');
      }
      await onAuthenticated();
      onClose?.();
    } catch (err) {
      onToast((err as Error).message || '验证失败', true);
    } finally {
      setLoading(false);
    }
  };

  const handleCopyShareContent = async () => {
    const content = shareMeta?.content || '';
    if (!content) {
      onToast('没有可复制的内容', true);
      return;
    }
    const ok = await copyToClipboard(content);
    if (ok) onToast('已复制内容');
    else onToast('复制失败，请手动选中复制', true);
  };

  const cardInner = (
    <>
      {modal && onClose ? (
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg opacity-70 hover:opacity-100 cursor-pointer"
          title="关闭"
        >
          <X className="w-4 h-4" />
        </button>
      ) : (
        onToggleTheme && (
          <button
            type="button"
            onClick={(e) => onToggleTheme(e)}
            className="theme-toggle-btn absolute top-4 right-4 p-1.5 rounded-lg opacity-80 hover:opacity-100 orbit-hover cursor-pointer transition-transform active:scale-95"
            title={theme === 'dark' ? '切换白天模式' : '切换夜间模式'}
            aria-label={theme === 'dark' ? '切换白天模式' : '切换夜间模式'}
          >
            <span className="theme-icon-wrap" data-theme={theme} aria-hidden="true">
              <span className="theme-icon-sun">
                <Sun className="w-4 h-4 text-amber-300" />
              </span>
              <span className="theme-icon-moon">
                <Moon className="w-4 h-4 text-indigo-600" />
              </span>
            </span>
          </button>
        )
      )}

      <div className="text-center space-y-1.5">
        <img
          src="/apple-touch-icon.png"
          alt="Orbit · 星轨"
          className="w-12 h-12 mx-auto rounded-2xl shadow-lg select-none"
        />
        <h1 className="text-base font-semibold tracking-tight">Orbit · 星轨</h1>
        <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
          {!initialized ? '创建管理员账号' : '登录工作台'}
        </p>
      </div>

      {notice && (
        <div
          className="px-3 py-2 rounded-xl text-xs flex items-center gap-2"
          style={{
            background: 'rgba(245, 158, 11, 0.16)',
            border: '1px solid rgba(251, 191, 36, 0.4)',
          }}
        >
          <Info className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--warn)' }} />
          <span>{notice}</span>
        </div>
      )}

      {shareMeta ? (
        <div className="space-y-3 text-xs">
          <div className="p-4 rounded-2xl space-y-2" style={{ background: 'var(--pill-bg)' }}>
            <div className="flex items-center justify-between">
              <span className="font-mono font-semibold" style={{ color: 'var(--brand)' }}>
                取件码 {shareMeta.code}
              </span>
              {shareMeta.burn_after_read && (
                <span style={{ color: 'var(--warn)' }}>阅后即焚</span>
              )}
            </div>

            {shareMeta.kind === 'file' ? (
              <div className="space-y-2 pt-1">
                <div className="font-medium truncate">{shareMeta.file_name}</div>
                <div className="font-mono" style={{ color: 'var(--ink-muted)' }}>
                  {formatBytes(shareMeta.size_bytes || 0)}
                </div>
                <a
                  href={shareMeta.download_url}
                  className="w-full h-9 rounded-xl font-medium text-white flex items-center justify-center gap-1.5"
                  style={{ background: 'var(--brand-solid)' }}
                >
                  <Download className="w-4 h-4" />
                  <span>下载</span>
                </a>
              </div>
            ) : (
              <div className="space-y-2 pt-1">
                <div
                  className="p-2.5 rounded-xl break-words whitespace-pre-wrap max-h-40 overflow-y-auto select-text"
                  style={{ background: 'var(--code-bg)' }}
                >
                  {shareMeta.content}
                </div>
                <button
                  type="button"
                  onClick={() => void handleCopyShareContent()}
                  className="w-full h-9 rounded-xl font-medium text-white flex items-center justify-center gap-1.5 cursor-pointer"
                  style={{ background: 'var(--brand-solid)' }}
                >
                  <Copy className="w-4 h-4" />
                  <span>复制文本</span>
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              setShareMeta(null);
              if (window.location.pathname.startsWith('/s/')) {
                window.history.replaceState(null, '', '/');
              }
            }}
            className="w-full py-1.5 text-center cursor-pointer"
            style={{ color: 'var(--ink-muted)' }}
          >
            返回登录
          </button>
        </div>
      ) : (
        <>
          <form onSubmit={handleSubmit} className="space-y-2.5 text-xs">
            <input
              type="text"
              placeholder="用户名"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full h-10 px-3.5 rounded-xl focus:outline-none"
              style={{
                background: 'var(--input-bg)',
                border: '1px solid var(--glass-border)',
                color: 'var(--ink)',
              }}
            />
            <input
              type="password"
              placeholder="密码 (至少 6 位)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full h-10 px-3.5 rounded-xl focus:outline-none"
              style={{
                background: 'var(--input-bg)',
                border: '1px solid var(--glass-border)',
                color: 'var(--ink)',
              }}
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full h-10 rounded-xl font-medium text-white cursor-pointer disabled:opacity-60"
              style={{ background: 'var(--brand-solid)' }}
            >
              {loading ? '请稍候...' : !initialized ? '初始化并进入' : '登录'}
            </button>
          </form>

          {initialized && (
            <div className="pt-3 border-t space-y-2 text-xs" style={{ borderColor: 'var(--glass-border)' }}>
              <div className="text-center" style={{ color: 'var(--ink-muted)' }}>
                取件码提取
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  maxLength={8}
                  value={pickupCode}
                  onChange={(e) => setPickupCode(e.target.value.toUpperCase())}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void lookupShare(pickupCode);
                    }
                  }}
                  placeholder="6 位取件码"
                  className="flex-1 h-9 px-3 rounded-xl font-mono focus:outline-none"
                  style={{
                    background: 'var(--input-bg)',
                    border: '1px solid var(--glass-border)',
                    color: 'var(--ink)',
                  }}
                />
                <button
                  type="button"
                  disabled={shareLoading}
                  onClick={() => void lookupShare(pickupCode)}
                  className="px-3.5 rounded-xl font-medium cursor-pointer"
                  style={{ background: 'var(--pill-hover)' }}
                >
                  {shareLoading ? '...' : '取件'}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );

  if (modal) {
    return (
      <CenteredModal
        open={open}
        onClose={onClose}
        zIndexClass="z-50"
        panelClassName="w-full max-w-sm p-6 space-y-5"
      >
        {cardInner}
      </CenteredModal>
    );
  }

  return (
    <div
      className="orbit-shell relative min-h-screen w-full flex items-center justify-center p-4"
      data-glass={theme}
    >
      <div
        className="wallpaper-layer"
        style={{ backgroundImage: PRESET_WALLPAPERS[0].bg }}
      />
      <div className="wallpaper-dim" />
      <div className="relative z-10 w-full max-w-sm glass-strong rounded-3xl p-6 space-y-5 pop-in">
        {cardInner}
      </div>
    </div>
  );
}
