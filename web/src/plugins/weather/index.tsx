import { useOrbitHost } from '../../sdk/host';
import type { OrbitPlugin } from '../../sdk/types';
import { WeatherSettingsPanel } from './WeatherSettingsPanel';
import { WeatherWidget } from './WeatherWidget';

function WeatherPluginWidget() {
  const host = useOrbitHost();
  return (
    <WeatherWidget
      weather={host.weather}
      config={host.settings.weatherConfig}
      showSeconds={host.settings.showSeconds}
      enableTilt={host.settings.enableTilt}
      layoutEditing={host.layoutEditing && !host.isGuest}
      readOnly={host.isGuest}
      onOpenSettings={() => host.openSettings('weather')}
    />
  );
}

export const weatherPlugin: OrbitPlugin = {
  id: 'orbit.weather',
  manifest: {
    id: 'orbit.weather',
    name: '实况天气',
    version: '1.0.0',
    description: '精确到区县的实时气象与多日预报卡片',
    icon: 'cloud-sun',
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
          layoutKey: 'weather',
          label: '天气',
          minW: 260,
          defaultW: 420,
          resizable: true,
          defaultVisible: true,
        },
      ],
      settings: {
        tabId: 'weather',
        label: '天气卡片',
        icon: 'cloud-sun',
        searchKeywords: ['天气', '区县', '温度', '湿度', '风速', '气压', '预报', '样式', '自定义文案', '时间'],
      },
    },
  },
  widgets: {
    main: WeatherPluginWidget,
  },
  settingsPanel: WeatherSettingsPanel,
};
