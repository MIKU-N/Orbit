import { Globe, Home, LogIn } from 'lucide-react';
import { useOrbitHost } from '../sdk/host';
import { getPluginIcon } from '../sdk/primitives';

interface TopBarProps {
  snap: boolean;
  onToggleSnap: (v: boolean) => void;
  onToggleAccount: () => void;
}

function TailscaleIcon() {
  return (
    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
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

export function TopBar({ snap, onToggleSnap, onToggleAccount }: TopBarProps) {
  const host = useOrbitHost();
  const { isGuest, zone, detectedZone, cycleZone, layoutEditing, setLayoutEditing, resetLayout, user } = host;

  const zoneMeta = {
    lan: { label: '局域网', dot: 'var(--ok)', icon: <Home className="w-4 h-4" /> },
    tailscale: { label: 'Tailscale', dot: 'var(--brand)', icon: <TailscaleIcon /> },
    wan: { label: '外网', dot: 'var(--warn)', icon: <Globe className="w-4 h-4" /> },
  }[zone];

  const initial = (user?.username?.[0] || 'O').toUpperCase();
  const topDrawers = host.resolvedDrawers.filter((d) => d.drawer.topBar);

  return (
    <header id="topBar" className="relative z-30 w-full px-4 sm:px-6 pt-4 flex items-center justify-between">
      {isGuest ? (
        <div className="h-9" aria-hidden="true" />
      ) : (
        <button
          onClick={cycleZone}
          className="glass rounded-full h-9 w-9 flex items-center justify-center relative hover:border-[var(--glass-border-hover)] cursor-pointer transition-transform active:scale-95"
          title={`当前显示：${zoneMeta.label}（服务端识别：${detectedZone.toUpperCase()}，点击切换）`}
        >
          {zoneMeta.icon}
          <span
            className="absolute bottom-1 right-1 w-2 h-2 rounded-full ring-2 ring-black/40"
            style={{ background: zoneMeta.dot }}
          />
        </button>
      )}

      {layoutEditing && !isGuest && (
        <div className="glass-strong rounded-full px-3 py-1.5 flex items-center gap-2 text-xs pop-in">
          <span className="font-medium">自由布局</span>
          <label className="flex items-center gap-1 cursor-pointer" style={{ color: 'var(--ink-muted)' }}>
            <input
              type="checkbox"
              checked={snap}
              onChange={(e) => onToggleSnap(e.target.checked)}
              className="accent-indigo-500"
            />
            磁吸
          </label>
          <button
            onClick={resetLayout}
            className="px-2 py-0.5 rounded-full hover:bg-white/10 cursor-pointer"
            style={{ color: 'var(--ink-muted)' }}
          >
            重置
          </button>
          <button
            onClick={() => setLayoutEditing(false)}
            className="px-3 py-0.5 rounded-full text-white font-medium cursor-pointer"
            style={{ background: 'var(--brand-solid)' }}
          >
            完成
          </button>
        </div>
      )}

      <div className="flex items-center gap-2">
        {topDrawers.map((d) => {
          const shortcutHint = d.drawer.shortcut ? ` (${d.drawer.shortcut.toUpperCase()})` : '';
          const title = d.guestLocked
            ? `${d.drawer.title}（需要登录）`
            : `${d.drawer.title}${shortcutHint}`;
          const dotColor =
            d.drawer.id === 'clipboard' && !d.guestLocked && host.clips.length > 0
              ? 'var(--brand)'
              : d.drawer.id === 'files' && !d.guestLocked
                ? 'var(--ok)'
                : null;

          return (
            <button
              key={`${d.pluginId}:${d.drawer.id}`}
              onClick={() => {
                if (d.guestLocked) {
                  host.promptGuestLogin(d.guestPrompt || `${d.drawer.title}需要登录后使用`);
                  return;
                }
                host.openDrawer(host.activeDrawer === d.drawer.id ? null : d.drawer.id);
              }}
              className="hidden md:flex glass rounded-full h-9 w-9 items-center justify-center relative hover:border-[var(--glass-border-hover)] cursor-pointer transition-transform active:scale-95"
              title={title}
            >
              {getPluginIcon(d.drawer.icon, 'w-4 h-4')}
              {dotColor && (
                <span
                  className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full"
                  style={{ background: dotColor }}
                />
              )}
            </button>
          );
        })}

        {isGuest ? (
          <button
            type="button"
            onClick={host.openLogin}
            className="glass rounded-full h-9 px-3.5 flex items-center gap-1.5 text-xs font-medium hover:border-[var(--glass-border-hover)] cursor-pointer transition-transform active:scale-95"
          >
            <LogIn className="w-3.5 h-3.5" style={{ color: 'var(--brand)' }} />
            <span>登录</span>
          </button>
        ) : (
          <button
            id="accountTrigger"
            onClick={onToggleAccount}
            className="glass rounded-full h-9 w-9 flex items-center justify-center hover:border-[var(--glass-border-hover)] cursor-pointer transition-transform active:scale-95"
            title="账号与设置"
          >
            <span
              className="w-6 h-6 rounded-full flex items-center justify-center font-semibold text-white text-xs"
              style={{ background: 'var(--brand-solid)' }}
            >
              {initial}
            </span>
          </button>
        )}
      </div>
    </header>
  );
}
