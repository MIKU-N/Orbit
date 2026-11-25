import { useOrbitHost } from '../../sdk/host';
import { defineLightPlugin, type LightWidgetProps } from '../../sdk/light';
import { ClockWidget } from './ClockWidget';

function ClockLightRender({ ctx }: LightWidgetProps) {
  const host = useOrbitHost();
  return (
    <ClockWidget
      showSeconds={host.settings.showSeconds}
      cardless={ctx.cardless}
      managed={ctx.managed}
      enableTilt={ctx.enableTilt}
      onToggleSeconds={() => {
        if (!ctx.readOnly) {
          host.updateSettings({ showSeconds: !host.settings.showSeconds });
        }
      }}
      layoutEditing={ctx.layoutEditing}
    />
  );
}

export const clockPlugin = defineLightPlugin({
  manifest: {
    id: 'orbit.clock',
    name: '数字时钟',
    version: '1.0.0',
    description: '数字时钟与日期显示',
    icon: 'clock',
    defaultEnabled: true,
    access: {
      minRole: 'public',
      guest: { mode: 'full' },
      allowPublic: true,
    },
    style: {
      managed: true,
      supportsCardless: true,
      defaultCardless: true,
    },
    contributes: {
      widgets: [
        {
          id: 'main',
          layoutKey: 'clock',
          label: '时钟',
          minW: 220,
          defaultW: 340,
          resizable: true,
          defaultVisible: true,
        },
      ],
    },
  },
  render: ClockLightRender,
});
