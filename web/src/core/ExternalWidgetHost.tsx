import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from '../api/client';
import { useOrbitHost } from '../sdk/host';
import { WidgetSurface, getPluginIcon } from '../sdk/primitives';
import type { PluginManifest, PluginStateRecord } from '../sdk/types';

function readShellCssVars(): Record<string, string> {
  const shell = document.querySelector('.orbit-shell') || document.documentElement;
  const cs = getComputedStyle(shell);
  const rootCs = getComputedStyle(document.documentElement);
  const keys = [
    '--glass-rgb',
    '--glass-strong-rgb',
    '--glass-alpha',
    '--glass-blur',
    '--glass-border',
    '--glass-border-hover',
    '--ink',
    '--ink-muted',
    '--ink-subtle',
    '--hero-ink',
    '--hero-ink-muted',
    '--hero-shadow',
    '--pill-bg',
    '--pill-hover',
    '--hover-bg',
    '--input-bg',
    '--code-bg',
    '--track-bg',
    '--brand',
    '--brand-solid',
    '--ok',
    '--warn',
    '--danger',
    '--radius-card',
    '--radius-lg',
    '--radius-sm',
    '--orbit-font',
  ];
  const vars: Record<string, string> = {};
  for (const k of keys) {
    const val = cs.getPropertyValue(k).trim() || rootCs.getPropertyValue(k).trim();
    if (val) vars[k] = val;
  }
  return vars;
}

interface ExternalWidgetHostProps {
  manifest: PluginManifest;
  record: PluginStateRecord;
  title?: string;
  compact?: boolean;
  cardless?: boolean;
}

export function ExternalWidgetHost({
  manifest,
  record,
  title,
  compact = false,
  cardless = false,
}: ExternalWidgetHostProps) {
  const host = useOrbitHost();
  const [reloadKey, setReloadKey] = useState(0);
  const [frameHeight, setFrameHeight] = useState(compact ? 320 : 180);
  const [esmError, setEsmError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const esmMountRef = useRef<HTMLDivElement>(null);
  const esmThemeListenersRef = useRef<Set<(payload: { theme: 'dark' | 'light'; cardless: boolean; vars: Record<string, string> }) => void>>(new Set());

  const ext = manifest.external;
  const entry = ext?.entry || 'widget.html';
  const renderMode = ext?.renderMode || (entry.endsWith('.mjs') || entry.endsWith('.js') ? 'esm' : 'iframe');
  const assetUrl = `/api/p/${encodeURIComponent(manifest.id)}/assets/${entry}?v=${encodeURIComponent(manifest.version)}_${reloadKey}`;

  const styleManaged = manifest.style?.managed !== false;
  const hideHeader = Boolean(manifest.style?.hideHeader) || cardless;
  const theme = host.resolvedTheme;

  const pushTheme = useCallback(() => {
    const vars = styleManaged ? readShellCssVars() : {};
    const win = iframeRef.current?.contentWindow;
    if (win) {
      win.postMessage(
        {
          type: 'orbit:theme',
          theme,
          mode: theme,
          managed: styleManaged,
          cardless,
          vars,
          animations: host.settings.enableAnimations !== false,
          cdnBase: host.cdnBase,
          zone: host.zone,
          isGuest: host.isGuest,
        },
        window.location.origin,
      );
    }
    // Also notify active ESM plugin listeners without remounting
    if (esmThemeListenersRef.current.size > 0) {
      const payload = { theme, cardless, vars };
      esmThemeListenersRef.current.forEach((cb) => {
        try {
          cb(payload);
        } catch {
          // isolate external listener error
        }
      });
    }
  }, [cardless, host.cdnBase, host.isGuest, host.settings.enableAnimations, host.zone, styleManaged, theme]);

  useEffect(() => {
    pushTheme();
  }, [
    pushTheme,
    host.settings.glassAlpha,
    host.settings.glassBlur,
    host.settings.glassRadius,
    host.settings.fontConfig,
  ]);

  useEffect(() => {
    if (renderMode !== 'iframe') return;
    const onMessage = async (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin) return;
      if (ev.source !== iframeRef.current?.contentWindow) return;
      const payload = ev.data as {
        type?: string;
        reqId?: string;
        route?: string;
        query?: Record<string, string>;
        method?: string;
        body?: unknown;
        key?: string;
        value?: unknown;
        msg?: string;
        warn?: boolean;
        height?: number;
      };
      if (!payload || typeof payload.type !== 'string') return;
      const reply = (ok: boolean, data?: unknown, error?: string) => {
        iframeRef.current?.contentWindow?.postMessage(
          { type: `${payload.type}:res`, reqId: payload.reqId, ok, data, error },
          window.location.origin,
        );
      };

      try {
        switch (payload.type) {
          case 'orbit:ready': {
            pushTheme();
            break;
          }
          case 'orbit:resize': {
            if (typeof payload.height === 'number' && Number.isFinite(payload.height)) {
              setFrameHeight(Math.max(60, Math.min(620, Math.round(payload.height))));
            }
            break;
          }
          case 'orbit:toast': {
            if (payload.msg) host.toast(payload.msg, payload.warn);
            break;
          }
          case 'orbit:proxy': {
            const data = await api.callPluginProxy(manifest.id, payload.route || '', {
              method: payload.method || 'GET',
              query: payload.query,
              body: payload.body !== undefined ? JSON.stringify(payload.body) : undefined,
            });
            reply(true, data);
            break;
          }
          case 'orbit:kv:get': {
            const res = await api.getPluginKV(manifest.id, payload.key);
            reply(true, res);
            break;
          }
          case 'orbit:kv:set': {
            if (!payload.key) {
              reply(false, undefined, 'key required');
              return;
            }
            await api.setPluginKV(manifest.id, payload.key, payload.value);
            reply(true, { ok: true });
            break;
          }
          case 'orbit:kv:delete': {
            if (!payload.key) {
              reply(false, undefined, 'key required');
              return;
            }
            await api.deletePluginKV(manifest.id, payload.key);
            reply(true, { ok: true });
            break;
          }
        }
      } catch (err) {
        reply(false, undefined, (err as Error).message || 'plugin bridge error');
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [host, manifest.id, pushTheme, renderMode]);

  useEffect(() => {
    if (renderMode !== 'esm') return;
    const container = esmMountRef.current;
    if (!container) return;

    let cancelled = false;
    let cleanup: void | (() => void);
    let modRef: { unmount?: (el: HTMLElement) => void } | null = null;
    setEsmError(null);
    container.innerHTML = '';
    esmThemeListenersRef.current.clear();

    void import(/* @vite-ignore */ assetUrl)
      .then((mod) => {
        if (cancelled) return;
        modRef = mod as {
          mount?: (el: HTMLElement, ctx: Record<string, unknown>) => void | (() => void);
          unmount?: (el: HTMLElement) => void;
        };
        const ctx = {
          theme,
          managed: styleManaged,
          cardless,
          vars: styleManaged ? readShellCssVars() : {},
          onThemeChange: (
            cb: (p: { theme: 'dark' | 'light'; cardless: boolean; vars: Record<string, string> }) => void,
          ) => {
            esmThemeListenersRef.current.add(cb);
            return () => esmThemeListenersRef.current.delete(cb);
          },
          zone: host.zone,
          isGuest: host.isGuest,
          cdnBase: host.cdnBase,
          config: record.config,
          toast: host.toast,
          proxy: (
            route: string,
            init?: RequestInit & { query?: Record<string, string> },
          ) => api.callPluginProxy(manifest.id, route, init),
          kv: {
            get: (key?: string) => api.getPluginKV(manifest.id, key),
            set: (key: string, value: unknown) => api.setPluginKV(manifest.id, key, value),
            delete: (key: string) => api.deletePluginKV(manifest.id, key),
          },
        };
        if (typeof (modRef as { mount?: (el: HTMLElement, ctx: Record<string, unknown>) => void | (() => void) }).mount === 'function') {
          cleanup = (modRef as { mount: (el: HTMLElement, ctx: Record<string, unknown>) => void | (() => void) }).mount(container, ctx);
        } else {
          setEsmError('ESM 插件缺少 mount(el, ctx) 导出');
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setEsmError((err as Error).message || '加载扩展组件失败');
        }
      });

    return () => {
      cancelled = true;
      esmThemeListenersRef.current.clear();
      if (typeof cleanup === 'function') cleanup();
      else if (modRef?.unmount) modRef.unmount(container);
      container.innerHTML = '';
    };
    // Theme updates are dispatched reactively via onThemeChange without remounting
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetUrl, host.isGuest, host.zone, manifest.id, record.config, renderMode]);

  const cardInner = (
    <div
      data-theme={theme}
      data-cardless={cardless ? 'true' : 'false'}
      className={compact ? 'space-y-2' : cardless ? 'p-1 h-full flex flex-col' : 'p-4 space-y-2.5 h-full flex flex-col'}
    >
      {!hideHeader && (
        <div className="flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <span style={{ color: 'var(--brand)' }}>
              {getPluginIcon(manifest.icon || 'plug', 'w-4 h-4')}
            </span>
            <span className="font-semibold truncate">{title || manifest.name}</span>
          </div>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="p-1 rounded-lg orbit-hover cursor-pointer shrink-0"
            style={{ color: 'var(--ink-muted)' }}
            title="刷新"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {!ext ? (
        <div className="text-xs py-6 text-center" style={{ color: 'var(--ink-muted)' }}>
          {manifest.description || manifest.name}
        </div>
      ) : renderMode === 'esm' ? (
        <div className="min-h-[80px]">
          {esmError ? (
            <div className="text-xs p-3 rounded-xl" style={{ background: 'var(--pill-bg)', color: 'var(--danger)' }}>
              {esmError}
            </div>
          ) : (
            <div ref={esmMountRef} className="w-full" />
          )}
        </div>
      ) : (
        <iframe
          ref={iframeRef}
          src={assetUrl}
          title={title || manifest.name}
          onLoad={pushTheme}
          sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
          className="w-full border-0 rounded-xl bg-transparent block"
          style={{ height: `${frameHeight}px`, colorScheme: theme }}
        />
      )}
    </div>
  );

  if (compact) return cardInner;

  return (
    <WidgetSurface
      cardless={cardless}
      managed={styleManaged}
      enableTilt={host.settings.enableTilt && host.settings.enableAnimations !== false}
      layoutEditing={host.layoutEditing}
    >
      {cardInner}
    </WidgetSurface>
  );
}
