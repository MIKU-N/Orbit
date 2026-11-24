import { X } from 'lucide-react';
import { useOrbitHost } from '../sdk/host';
import { ExternalWidgetHost } from './ExternalWidgetHost';

export function SlideDrawerHost() {
  const host = useOrbitHost();
  if (!host.activeDrawer) return null;

  const unlockedDrawers = host.resolvedDrawers.filter((d) => !d.guestLocked);
  const current =
    unlockedDrawers.find((d) => d.drawer.id === host.activeDrawer) || unlockedDrawers[0];
  if (!current) return null;

  const DrawerBody = current.Component;

  return (
    <div className="fixed inset-0 z-40 flex items-end md:items-stretch md:justify-end">
      <div
        className="absolute inset-0 bg-black/35 backdrop-blur-[2px]"
        onClick={() => host.openDrawer(null)}
      />
      <aside className="drawer-panel relative w-full md:max-w-md h-[80vh] md:h-full glass-strong rounded-t-3xl md:rounded-none md:border-l flex flex-col">
        <div className="md:hidden pt-2.5 pb-1 flex justify-center">
          <span className="w-10 h-1 rounded-full bg-white/30" />
        </div>

        <div
          className="px-4 py-3 border-b flex items-center justify-between gap-2"
          style={{ borderColor: 'var(--glass-border)' }}
        >
          <div
            className="flex items-center p-0.5 rounded-xl text-xs overflow-x-auto"
            style={{ background: 'var(--pill-bg)' }}
          >
            {unlockedDrawers.map((d) => {
              const isSelected = d.drawer.id === current.drawer.id;
              return (
                <button
                  key={`${d.pluginId}:${d.drawer.id}`}
                  type="button"
                  onClick={() => host.openDrawer(d.drawer.id)}
                  className="px-3 py-1.5 rounded-lg font-medium cursor-pointer shrink-0"
                  style={{
                    background: isSelected ? 'var(--brand-solid)' : 'transparent',
                    color: isSelected ? '#fff' : 'var(--ink-muted)',
                  }}
                >
                  {d.drawer.title}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => host.openDrawer(null)}
            className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-white/10 cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {DrawerBody ? (
          <DrawerBody
            drawer={current.drawer}
            manifest={current.manifest}
            record={current.record}
            onClose={() => host.openDrawer(null)}
          />
        ) : (
          <div className="flex-1 p-4 overflow-y-auto">
            <ExternalWidgetHost
              manifest={current.manifest}
              record={current.record}
              title={current.drawer.title}
              compact
            />
          </div>
        )}
      </aside>
    </div>
  );
}
