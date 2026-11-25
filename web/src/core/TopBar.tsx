import { useEffect, useState } from 'react';
import { Check, EyeOff, Globe, Home, LogIn, Moon, Plug, Plus, Sun } from 'lucide-react';
import { useOrbitHost } from '../sdk/host';
import { getPluginIcon } from '../sdk/primitives';
import { UserAvatar } from './UserAvatar';

interface TopBarProps {
  snap: boolean;
  onToggleSnap: (v: boolean) => void;
  onToggleZonePanel: () => void;
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

export function TopBar({ snap, onToggleSnap, onToggleZonePanel, onToggleAccount }: TopBarProps) {
  const host = useOrbitHost();
  const {
    isGuest,
    zone,
    layoutEditing,
    setLayoutEditing,
    resetLayout,
    resolvedWidgets,
    settings,
    updateSettings,
    openSettings,
    toast,
    user,
    resolvedTheme,
    toggleDayNight,
  } = host;

  const [addCardOpen, setAddCardOpen] = useState(false);

  useEffect(() => {
    if (!layoutEditing) {
      setAddCardOpen(false);
    }
  }, [layoutEditing]);

  useEffect(() => {
    if (!addCardOpen) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        !target.closest('#layoutAddCardPanel') &&
        !target.closest('#layoutAddCardTrigger')
      ) {
        setAddCardOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAddCardOpen(false);
      }
    };
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [addCardOpen]);

  const zoneMeta = {
    lan: { label: '局域网', icon: <Home className="w-4 h-4" /> },
    tailscale: { label: 'Tailscale', icon: <TailscaleIcon /> },
    wan: { label: '外网', icon: <Globe className="w-4 h-4" /> },
  }[zone];

  const topDrawers = host.resolvedDrawers.filter((d) => d.drawer.topBar);
  const hiddenWidgets = resolvedWidgets.filter((w) => !w.visible);
  const visibleWidgets = resolvedWidgets.filter((w) => w.visible);

  const toggleWidgetVisibility = (key: string, label: string, nextVisible: boolean) => {
    updateSettings({
      visibleItems: { ...settings.visibleItems, [key]: nextVisible },
    });
    toast(nextVisible ? `已添加卡片：${label}` : `已隐藏卡片：${label}`);
  };

  return (
    <>
      <header id="topBar" className="relative z-30 w-full px-4 sm:px-6 pt-3.5 flex items-center justify-between">
        {isGuest ? (
          <div className="h-9" aria-hidden="true" />
        ) : (
          <button
            id="zoneTrigger"
            type="button"
            onClick={onToggleZonePanel}
            className="glass rounded-full h-9 w-9 flex items-center justify-center relative hover:border-[var(--glass-border-hover)] cursor-pointer transition-transform active:scale-95"
            title={`网络：${zoneMeta.label}`}
          >
            {zoneMeta.icon}
          </button>
        )}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={(e) => toggleDayNight(e)}
            className="glass theme-toggle-btn rounded-full h-9 w-9 flex items-center justify-center hover:border-[var(--glass-border-hover)] cursor-pointer transition-transform active:scale-95"
            title={resolvedTheme === 'dark' ? '切换白天模式' : '切换夜间模式'}
            aria-label={resolvedTheme === 'dark' ? '切换白天模式' : '切换夜间模式'}
          >
            <span className="theme-icon-wrap" data-theme={resolvedTheme} aria-hidden="true">
              <span className="theme-icon-sun">
                <Sun className="w-4 h-4 text-amber-300" />
              </span>
              <span className="theme-icon-moon">
                <Moon className="w-4 h-4 text-indigo-600" />
              </span>
            </span>
          </button>

          {topDrawers.map((d) => {
            const isOpen = host.activeDrawer === d.drawer.id;
            const shortcutHint = d.drawer.shortcut ? ` (${d.drawer.shortcut.toUpperCase()})` : '';
            const title = d.guestLocked ? `${d.drawer.title}（需登录）` : `${d.drawer.title}${shortcutHint}`;

            return (
              <button
                key={`${d.pluginId}:${d.drawer.id}`}
                id={`drawerTrigger-${d.drawer.id}`}
                data-drawer-trigger={d.drawer.id}
                type="button"
                onClick={() => {
                  if (d.guestLocked) {
                    host.promptGuestLogin(d.guestPrompt || `${d.drawer.title}需要登录后使用`);
                    return;
                  }
                  host.openDrawer(isOpen ? null : d.drawer.id);
                }}
                className="hidden md:flex glass rounded-full h-9 w-9 items-center justify-center relative hover:border-[var(--glass-border-hover)] cursor-pointer transition-transform active:scale-95"
                style={
                  isOpen
                    ? {
                        borderColor: 'var(--brand)',
                        color: 'var(--brand)',
                      }
                    : undefined
                }
                title={title}
              >
                {getPluginIcon(d.drawer.icon, 'w-4 h-4')}
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
              type="button"
              onClick={onToggleAccount}
              className="rounded-full h-9 w-9 p-0 border-0 overflow-hidden block ring-1 ring-[var(--glass-border)] hover:ring-[var(--glass-border-hover)] shadow-md cursor-pointer transition-transform active:scale-95"
              title="账号与设置"
            >
              <UserAvatar user={user} sizeClass="w-full h-full" textClass="text-sm" />
            </button>
          )}
        </div>
      </header>

      {/* Window-centered Free Layout Floating Toolbar */}
      {layoutEditing && !isGuest && (
        <div className="fixed top-3.5 left-1/2 -translate-x-1/2 z-40 flex flex-col items-center gap-2 max-w-[calc(100vw-2rem)]">
          <div className="glass-strong rounded-full px-3 py-1.5 flex items-center gap-2 text-xs pop-in shadow-xl whitespace-nowrap">
            <span className="font-medium pl-0.5">自由布局</span>

            <button
              id="layoutAddCardTrigger"
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setAddCardOpen((v) => !v);
              }}
              className="px-2.5 py-0.5 rounded-full flex items-center gap-1 font-medium cursor-pointer transition-colors"
              style={{
                background: addCardOpen ? 'var(--brand-solid)' : 'var(--pill-bg)',
                color: addCardOpen ? '#fff' : 'var(--ink)',
              }}
              title="添加或切换桌面卡片"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>添加卡片</span>
              {hiddenWidgets.length > 0 && (
                <span
                  className="px-1.5 py-0 rounded-full text-[10px] font-mono leading-4"
                  style={{
                    background: addCardOpen ? 'rgba(255,255,255,0.22)' : 'var(--brand-solid)',
                    color: '#fff',
                  }}
                >
                  {hiddenWidgets.length}
                </span>
              )}
            </button>

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
              type="button"
              onClick={resetLayout}
              className="px-2 py-0.5 rounded-full orbit-hover cursor-pointer"
              style={{ color: 'var(--ink-muted)' }}
            >
              重置
            </button>

            <button
              type="button"
              onClick={() => {
                setAddCardOpen(false);
                setLayoutEditing(false);
              }}
              className="px-3 py-0.5 rounded-full text-white font-medium cursor-pointer"
              style={{ background: 'var(--brand-solid)' }}
            >
              完成
            </button>
          </div>

          {addCardOpen && (
            <div
              id="layoutAddCardPanel"
              onClick={(e) => e.stopPropagation()}
              className="w-72 max-w-[calc(100vw-2rem)] glass-strong rounded-2xl p-2.5 space-y-2.5 pop-in shadow-2xl text-xs"
            >
              <div className="space-y-1">
                <div
                  className="px-2 flex items-center justify-between text-[11px]"
                  style={{ color: 'var(--ink-muted)' }}
                >
                  <span>可添加卡片</span>
                  <span className="font-mono">{hiddenWidgets.length}</span>
                </div>

                {hiddenWidgets.length === 0 ? (
                  <div
                    className="px-3 py-2.5 rounded-xl text-center"
                    style={{ background: 'var(--pill-bg)', color: 'var(--ink-muted)' }}
                  >
                    全部已启用卡片均已显示在桌面
                  </div>
                ) : (
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {hiddenWidgets.map((rw) => {
                      const label = rw.widget.label || rw.manifest.name;
                      return (
                        <button
                          key={rw.key}
                          type="button"
                          onClick={() => toggleWidgetVisibility(rw.key, label, true)}
                          className="w-full px-2.5 py-2 rounded-xl flex items-center justify-between gap-2 orbit-hover cursor-pointer text-left"
                          style={{ background: 'var(--pill-bg)' }}
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <span
                              className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0"
                              style={{ background: 'var(--code-bg)', color: 'var(--brand)' }}
                            >
                              {getPluginIcon(rw.manifest.icon || 'plug', 'w-3.5 h-3.5')}
                            </span>
                            <span className="min-w-0">
                              <span className="font-medium block truncate">{label}</span>
                              {rw.manifest.description && (
                                <span
                                  className="block text-[10px] truncate"
                                  style={{ color: 'var(--ink-muted)' }}
                                >
                                  {rw.manifest.description}
                                </span>
                              )}
                            </span>
                          </span>
                          <span
                            className="px-2 py-0.5 rounded-md text-white font-medium shrink-0 inline-flex items-center gap-0.5"
                            style={{ background: 'var(--brand-solid)' }}
                          >
                            <Plus className="w-3 h-3" />
                            <span>添加</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {visibleWidgets.length > 0 && (
                <div
                  className="pt-2 border-t space-y-1"
                  style={{ borderColor: 'var(--glass-border)' }}
                >
                  <div
                    className="px-2 flex items-center justify-between text-[11px]"
                    style={{ color: 'var(--ink-muted)' }}
                  >
                    <span>当前已显示</span>
                    <span className="font-mono">{visibleWidgets.length}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 px-1">
                    {visibleWidgets.map((rw) => {
                      const label = rw.widget.label || rw.manifest.name;
                      return (
                        <button
                          key={rw.key}
                          type="button"
                          onClick={() => toggleWidgetVisibility(rw.key, label, false)}
                          className="px-2 py-1 rounded-lg inline-flex items-center gap-1 cursor-pointer orbit-hover"
                          style={{ background: 'var(--pill-bg)', color: 'var(--ink)' }}
                          title={`点击隐藏「${label}」`}
                        >
                          <Check className="w-3 h-3" style={{ color: 'var(--ok)' }} />
                          <span>{label}</span>
                          <EyeOff className="w-3 h-3 opacity-50 ml-0.5" />
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="pt-1.5 border-t" style={{ borderColor: 'var(--glass-border)' }}>
                <button
                  type="button"
                  onClick={() => {
                    setAddCardOpen(false);
                    setLayoutEditing(false);
                    openSettings('plugins');
                  }}
                  className="w-full px-2.5 py-1.5 rounded-xl flex items-center justify-center gap-1.5 orbit-hover cursor-pointer"
                  style={{ color: 'var(--brand)' }}
                >
                  <Plug className="w-3.5 h-3.5" />
                  <span>前往组件中心管理更多扩展</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
