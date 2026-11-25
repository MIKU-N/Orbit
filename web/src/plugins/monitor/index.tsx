import { useOrbitHost } from '../../sdk/host';
import type { OrbitPlugin } from '../../sdk/types';
import { MonitorSettingsPanel } from './MonitorSettingsPanel';
import { MonitorWidget } from './MonitorWidget';

function MonitorPluginWidget({ layoutKey, manifest }: { layoutKey: string; manifest: OrbitPlugin['manifest'] }) {
  const host = useOrbitHost();
  const cardless = host.isWidgetCardless(layoutKey, Boolean(manifest.style?.defaultCardless));
  return (
    <MonitorWidget
      metrics={host.metrics}
      config={host.settings.monitorConfig}
      cardless={cardless}
      enableTilt={host.settings.enableTilt && host.settings.enableAnimations !== false}
      layoutEditing={host.layoutEditing}
      onOpenDetail={() => host.openSettings('monitor')}
    />
  );
}

export const monitorPlugin: OrbitPlugin = {
  id: 'orbit.monitor',
  manifest: {
    id: 'orbit.monitor',
    name: '节点监控',
    version: '1.0.0',
    description: '宿主机实时遥测',
    icon: 'cpu',
    tier: 'core',
    source: 'official',
    defaultEnabled: true,
    style: {
      managed: true,
      supportsCardless: true,
    },
    access: {
      minRole: 'user',
      guest: { mode: 'hidden' },
      sharing: {
        shareable: true,
        scopeKey: 'monitor',
        label: '监控',
        defaultShared: false,
        mode: 'readonly',
      },
    },
    contributes: {
      widgets: [
        {
          id: 'main',
          layoutKey: 'monitor',
          label: '监控',
          minW: 300,
          defaultW: 540,
          resizable: true,
          defaultVisible: true,
        },
      ],
      settings: {
        tabId: 'monitor',
        label: '系统监控',
        icon: 'cpu',
        searchKeywords: ['监控', 'cpu', '内存', '磁盘', '挂载点', '网速', 'ip'],
      },
    },
  },
  widgets: {
    main: MonitorPluginWidget,
  },
  settingsPanel: MonitorSettingsPanel,
};
