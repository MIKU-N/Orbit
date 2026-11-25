import type React from 'react';
import { useOrbitHost } from './host';
import type { OrbitPlugin, PluginManifest, SettingsPanelProps, WidgetProps } from './types';

export interface LightWidgetContext {
  theme: 'dark' | 'light';
  cardless: boolean;
  managed: boolean;
  enableTilt: boolean;
  layoutEditing: boolean;
  readOnly: boolean;
  openSettings: (tabId?: string) => void;
  toast: (msg: string, warn?: boolean) => void;
  copyText: (text: string, label?: string) => Promise<boolean>;
}

export interface LightWidgetProps extends WidgetProps {
  ctx: LightWidgetContext;
}

interface DefineLightPluginOptions {
  manifest: Omit<PluginManifest, 'tier' | 'source'> & {
    source?: 'official' | 'external';
  };
  render: React.ComponentType<LightWidgetProps>;
  settingsPanel?: React.ComponentType<SettingsPanelProps>;
}

/**
 * Defines a standardized Orbit Lightweight Component (轻量组件) bound to global style
 * management, Day/Night theme adaptation, and cardless mode.
 */
export function defineLightPlugin(opts: DefineLightPluginOptions): OrbitPlugin {
  const fullManifest: PluginManifest = {
    ...opts.manifest,
    tier: 'light',
    source: opts.manifest.source || 'official',
    style: {
      managed: true,
      supportsCardless: true,
      ...(opts.manifest.style || {}),
    },
  };

  const RenderComp = opts.render;

  function BoundLightWidget(props: WidgetProps) {
    const host = useOrbitHost();
    const styleSpec = props.manifest.style;
    const managed = styleSpec?.managed !== false;
    const defaultCardless = Boolean(styleSpec?.defaultCardless);
    const userPref = host.settings.cardlessItems?.[props.layoutKey];
    const cardless = userPref !== undefined ? Boolean(userPref) : defaultCardless;

    const ctx: LightWidgetContext = {
      theme: host.resolvedTheme,
      cardless,
      managed,
      enableTilt: host.settings.enableTilt && host.settings.enableAnimations !== false,
      layoutEditing: host.layoutEditing && !host.isGuest,
      readOnly: host.isGuest,
      openSettings: host.openSettings,
      toast: host.toast,
      copyText: host.copyText,
    };

    return <RenderComp {...props} ctx={ctx} />;
  }

  const primaryWidgetId = fullManifest.contributes.widgets?.[0]?.id || 'main';

  return {
    id: fullManifest.id,
    manifest: fullManifest,
    widgets: {
      [primaryWidgetId]: BoundLightWidget,
    },
    settingsPanel: opts.settingsPanel,
  };
}
