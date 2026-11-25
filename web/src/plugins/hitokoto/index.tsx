import { useOrbitHost } from '../../sdk/host';
import { defineLightPlugin, type LightWidgetProps } from '../../sdk/light';
import { HitokotoSettingsPanel } from './HitokotoSettingsPanel';
import { HitokotoWidget } from './HitokotoWidget';

function HitokotoLightRender({ ctx }: LightWidgetProps) {
  const host = useOrbitHost();
  return (
    <HitokotoWidget
      config={host.settings.hitokotoConfig}
      cardless={ctx.cardless}
      managed={ctx.managed}
      enableTilt={ctx.enableTilt}
      layoutEditing={ctx.layoutEditing}
      onToast={ctx.toast}
    />
  );
}

export const hitokotoPlugin = defineLightPlugin({
  manifest: {
    id: 'orbit.hitokoto',
    name: '每日一言',
    version: '1.0.0',
    description: '在线一言与内置语录轮播',
    icon: 'quote',
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
          layoutKey: 'hitokoto',
          label: '一言',
          minW: 240,
          defaultW: 620,
          resizable: true,
          defaultVisible: true,
        },
      ],
      settings: {
        tabId: 'hitokoto',
        label: '一言卡片',
        icon: 'quote',
        searchKeywords: ['一言', 'hitokoto', '语录', '文案', '轮播', 'api'],
      },
    },
  },
  render: HitokotoLightRender,
  settingsPanel: HitokotoSettingsPanel,
});
