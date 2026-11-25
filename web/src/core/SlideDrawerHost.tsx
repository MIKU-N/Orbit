import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useOrbitHost } from '../sdk/host';
import { ExternalWidgetHost } from './ExternalWidgetHost';

interface AnchorPos {
  top: number;
  right: number;
  maxHeight: number;
}

export function SlideDrawerHost() {
  const host = useOrbitHost();
  const [anchorPos, setAnchorPos] = useState<AnchorPos | null>(null);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false,
  );

  const computeAnchor = useCallback(() => {
    const mobile = window.innerWidth < 768;
    setIsMobile(mobile);
    if (mobile || !host.activeDrawer) {
      setAnchorPos(null);
      return;
    }
    const trigger = document.getElementById(`drawerTrigger-${host.activeDrawer}`);
    if (trigger) {
      const rect = trigger.getBoundingClientRect();
      const top = Math.round(rect.bottom + 8);
      const panelW = Math.min(392, window.innerWidth - 24);
      const desiredRight = Math.round(window.innerWidth - rect.right);
      const maxRight = Math.max(12, window.innerWidth - panelW - 12);
      const right = Math.max(12, Math.min(desiredRight, maxRight));
      const maxHeight = Math.max(280, Math.min(540, window.innerHeight - top - 16));
      setAnchorPos({ top, right, maxHeight });
    } else {
      setAnchorPos({
        top: 62,
        right: 20,
        maxHeight: Math.max(280, Math.min(540, window.innerHeight - 78)),
      });
    }
  }, [host.activeDrawer]);

  useLayoutEffect(() => {
    computeAnchor();
  }, [computeAnchor]);

  useEffect(() => {
    if (!host.activeDrawer) return;
    window.addEventListener('resize', computeAnchor);
    return () => window.removeEventListener('resize', computeAnchor);
  }, [computeAnchor, host.activeDrawer]);

  if (!host.activeDrawer) return null;

  const unlockedDrawers = host.resolvedDrawers.filter((d) => !d.guestLocked);
  const current =
    unlockedDrawers.find((d) => d.drawer.id === host.activeDrawer) || unlockedDrawers[0];
  if (!current) return null;

  const DrawerBody = current.Component;

  return (
    <div
      id="drawerPopover"
      onClick={(e) => e.stopPropagation()}
      className={
        isMobile
          ? 'fixed bottom-20 left-3 right-3 z-40 glass-strong rounded-2xl flex flex-col pop-in shadow-2xl overflow-hidden max-h-[68vh]'
          : 'fixed z-40 w-[388px] max-w-[calc(100vw-1.5rem)] glass-strong rounded-2xl flex flex-col pop-in shadow-2xl overflow-hidden'
      }
      style={
        !isMobile && anchorPos
          ? {
              top: `${anchorPos.top}px`,
              right: `${anchorPos.right}px`,
              maxHeight: `${anchorPos.maxHeight}px`,
            }
          : undefined
      }
    >
      <div
        className="px-3.5 py-2.5 border-b flex items-center justify-between gap-2 shrink-0"
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
                className="px-2.5 py-1 rounded-lg font-medium cursor-pointer shrink-0 transition-colors"
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
          className="w-7 h-7 rounded-lg flex items-center justify-center orbit-hover cursor-pointer shrink-0"
          title="关闭"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {DrawerBody ? (
          <DrawerBody
            drawer={current.drawer}
            manifest={current.manifest}
            record={current.record}
            onClose={() => host.openDrawer(null)}
          />
        ) : (
          <div className="flex-1 p-3.5 overflow-y-auto">
            <ExternalWidgetHost
              manifest={current.manifest}
              record={current.record}
              title={current.drawer.title}
              compact
            />
          </div>
        )}
      </div>
    </div>
  );
}
