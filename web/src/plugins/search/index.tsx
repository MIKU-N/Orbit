import { useOrbitHost } from '../../sdk/host';
import type { OrbitPlugin } from '../../sdk/types';
import { SearchSettingsPanel } from './SearchSettingsPanel';
import { SearchWidget } from './SearchWidget';

function SearchPluginWidget({ layoutKey, manifest }: { layoutKey: string; manifest: OrbitPlugin['manifest'] }) {
  const host = useOrbitHost();
  const cardless = host.isWidgetCardless(layoutKey, Boolean(manifest.style?.defaultCardless));
  return (
    <SearchWidget
      engines={host.settings.engines}
      activeEngineId={host.settings.activeEngineId}
      iconOnly={host.settings.searchIconOnly}
      cardless={cardless}
      guestMode={host.isGuest}
      onSelectEngine={(id) => host.updateSettings({ activeEngineId: id })}
      onOpenEngineManager={() => host.openSettings('search')}
      searchAcrossPlugins={host.searchAcrossPlugins}
      onElevatingChange={host.setSearchElevated}
      onToast={host.toast}
      inputRef={host.searchInputRef}
    />
  );
}

export const searchPlugin: OrbitPlugin = {
  id: 'orbit.search',
  manifest: {
    id: 'orbit.search',
    name: '统一搜索',
    version: '1.0.0',
    description: '多引擎切换与站内聚合检索',
    icon: 'search',
    tier: 'core',
    source: 'official',
    defaultEnabled: true,
    access: {
      minRole: 'public',
      guest: { mode: 'readonly' },
      allowPublic: true,
    },
    style: {
      managed: true,
      supportsCardless: true,
    },
    contributes: {
      widgets: [
        {
          id: 'main',
          layoutKey: 'search',
          label: '搜索',
          minW: 280,
          defaultW: 580,
          resizable: true,
          defaultVisible: true,
        },
      ],
      settings: {
        tabId: 'search',
        label: '搜索设置',
        icon: 'search',
        searchKeywords: ['引擎', 'google', 'bing', '图标', '仅图标', '搜索栏'],
      },
    },
  },
  widgets: {
    main: SearchPluginWidget,
  },
  settingsPanel: SearchSettingsPanel,
};
