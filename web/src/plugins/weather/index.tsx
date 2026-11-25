import { useOrbitHost } from '../../sdk/host';
import { defineLightPlugin, type LightWidgetProps } from '../../sdk/light';
import { WeatherSettingsPanel } from './WeatherSettingsPanel';
import { WeatherWidget } from './WeatherWidget';

function WeatherLightRender({ ctx }: LightWidgetProps) {
  const host = useOrbitHost();
  return (
    <WeatherWidget
      weather={host.weather}
      config={host.settings.weatherConfig}
      theme={ctx.theme}
      cardless={ctx.cardless}
      managed={ctx.managed}
      showSeconds={host.settings.showSeconds}
      enableTilt={ctx.enableTilt}
      layoutEditing={ctx.layoutEditing}
      readOnly={ctx.readOnly}
      onOpenSettings={() => ctx.openSettings('weather')}
    />
  );
}

export const weatherPlugin = defineLightPlugin({
  manifest: {
    id: 'orbit.weather',
    name: '实时天气',
    version: '1.0.0',
    description: '实时气象与多日预报',
    icon: 'cloud-sun',
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
        searchKeywords: ['天气', '区县', '温度', '湿度', '风速', '气压', '预报', '样式'],
      },
    },
  },
  render: WeatherLightRender,
  settingsPanel: WeatherSettingsPanel,
});
