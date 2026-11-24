import { useOrbitHost } from '../../sdk/host';
import type { OrbitPlugin } from '../../sdk/types';
import { HitokotoSettingsPanel } from './HitokotoSettingsPanel';
import { HitokotoWidget } from './HitokotoWidget';

function HitokotoPluginWidget() {
  const host = useOrbitHost();
  return (
    <HitokotoWidget
      config={host.settings.hitokotoConfig}
      enableTilt={host.settings.enableTilt}
      layoutEditing={host.layoutEditing && !host.isGuest}
      readOnly={host.isGuest}
      onCopy={host.copyText}
      onOpenSettings={() => host.openSettings('hitokoto')}
    />
  );
}

export const hitokotoPlugin: OrbitPlugin = {
  id: 'orbit.hitokoto',
  manifest: {
    id: 'orbit.hitokoto',
    name: '每日一言',
    version: '1.0.0',
    description: '支持在线一言 API 与内置精选文案库，支持自动轮播与点击刷新',
    icon: 'quote',
    tier: 'builtin',
    defaultEnabled: true,
    access: {
      minRole: 'public',
      guest: { mode: 'readonly' },
    },
    contributes: {
      widgets: [
        {
          id: 'main',
          layoutKey: 'hitokoto',
          label: '一言',
          minW: 260,
          defaultW: 620,
          resizable: true,
          defaultVisible: true,
        },
      ],
      settings: {
        tabId: 'hitokoto',
        label: '一言卡片',
        icon: 'quote',
        searchKeywords: ['一言', 'hitokoto', '语录', '文案', '轮播', '刷新', 'api', '内置'],
      },
    },
  },
  widgets: {
    main: HitokotoPluginWidget,
  },
  settingsPanel: HitokotoSettingsPanel,
};
