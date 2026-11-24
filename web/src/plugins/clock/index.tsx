import { useOrbitHost } from '../../sdk/host';
import type { OrbitPlugin } from '../../sdk/types';
import { ClockWidget } from './ClockWidget';

function ClockPluginWidget() {
  const host = useOrbitHost();
  return (
    <ClockWidget
      showSeconds={host.settings.showSeconds}
      onToggleSeconds={() => {
        if (!host.isGuest) {
          host.updateSettings({ showSeconds: !host.settings.showSeconds });
        }
      }}
      layoutEditing={host.layoutEditing && !host.isGuest}
    />
  );
}

export const clockPlugin: OrbitPlugin = {
  id: 'orbit.clock',
  manifest: {
    id: 'orbit.clock',
    name: '数字时钟',
    version: '1.0.0',
    description: '桌面极简数字时钟与星期显示，点击切换秒数',
    icon: 'clock',
    tier: 'builtin',
    defaultEnabled: true,
    access: {
      minRole: 'public',
      guest: { mode: 'full' },
    },
    contributes: {
      widgets: [
        {
          id: 'main',
          layoutKey: 'clock',
          label: '时钟',
          minW: 220,
          defaultW: 340,
          resizable: false,
          defaultVisible: true,
        },
      ],
    },
  },
  widgets: {
    main: ClockPluginWidget,
  },
};
