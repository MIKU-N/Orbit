import { LayoutGrid } from 'lucide-react';
import { useOrbitHost } from '../sdk/host';
import { getPluginIcon } from '../sdk/primitives';

export function MobileCapsule({ onBeforeSelect }: { onBeforeSelect?: () => void }) {
  const host = useOrbitHost();
  const dockDrawers = host.resolvedDrawers.filter((d) => d.drawer.mobileDock).slice(0, 3);
  const active = host.activeDrawer || 'home';

  return (
    <nav className="flex md:hidden fixed bottom-4 left-0 right-0 z-30 justify-center pointer-events-none px-4">
      <div className="pointer-events-auto glass-strong rounded-full px-1.5 py-1.5 inline-flex items-center gap-1 shadow-2xl">
        <button
          onClick={() => {
            onBeforeSelect?.();
            host.openDrawer(null);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          className="px-3.5 py-1.5 rounded-full inline-flex items-center gap-1.5 text-xs font-medium cursor-pointer transition-colors"
          style={{
            background: active === 'home' ? 'var(--pill-hover)' : 'transparent',
            color: active === 'home' ? 'var(--ink)' : 'var(--ink-muted)',
          }}
        >
          <LayoutGrid className="w-4 h-4" />
          <span>主页</span>
        </button>

        {dockDrawers.map((d) => {
          const isActive = active === d.drawer.id;
          const dotColor =
            d.drawer.id === 'clipboard'
              ? 'var(--brand)'
              : d.drawer.id === 'files'
                ? 'var(--ok)'
                : undefined;

          return (
            <button
              key={`${d.pluginId}:${d.drawer.id}`}
              onClick={() => {
                onBeforeSelect?.();
                if (d.guestLocked) {
                  host.promptGuestLogin(d.guestPrompt || `${d.drawer.title}需要登录后使用`);
                  return;
                }
                host.openDrawer(d.drawer.id);
              }}
              className="relative px-3.5 py-1.5 rounded-full inline-flex items-center gap-1.5 text-xs font-medium cursor-pointer transition-colors"
              style={{
                background: isActive ? 'var(--pill-hover)' : 'transparent',
                color: isActive ? 'var(--ink)' : 'var(--ink-muted)',
              }}
            >
              {getPluginIcon(d.drawer.icon, 'w-4 h-4')}
              <span>{d.drawer.title}</span>
              {dotColor && <span className="w-1.5 h-1.5 rounded-full" style={{ background: dotColor }} />}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
