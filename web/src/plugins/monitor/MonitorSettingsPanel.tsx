import { ArrowDown, ArrowUp, Plus } from 'lucide-react';
import { useOrbitHost } from '../../sdk/host';
import { formatBytes } from '../../sdk/primitives';
import type { SettingsPanelProps } from '../../sdk/types';
import type { MonitorMetricKey, UserSettings } from '../../types';

const METRIC_LABELS: Record<MonitorMetricKey, string> = {
  cpu: 'CPU 使用率',
  ram: '内存使用率',
  disk: '磁盘使用率',
  swap: 'Swap 分区',
  load: '系统负载 (1m)',
  uptime: '运行时长',
  temp: 'CPU 温度',
  processes: '运行进程数',
  orbit: 'Orbit 内存',
  net_total: '累计下行流量',
};

const ALL_METRIC_KEYS: MonitorMetricKey[] = [
  'cpu',
  'ram',
  'disk',
  'swap',
  'load',
  'uptime',
  'temp',
  'processes',
  'orbit',
  'net_total',
];

export function MonitorSettingsPanel({ highlightSection }: SettingsPanelProps) {
  const host = useOrbitHost();
  const { canViewMonitor, metrics, settings, updateSettings, toast } = host;
  const mc = settings.monitorConfig;

  const sectionHighlightStyle = (sectionId: string): React.CSSProperties =>
    highlightSection === sectionId
      ? {
          boxShadow: '0 0 0 2px var(--brand)',
          borderRadius: 'var(--radius-lg)',
          padding: '8px',
          transition: 'all 220ms ease',
        }
      : { transition: 'all 220ms ease' };

  const updateMonitor = (patch: Partial<UserSettings['monitorConfig']>) => {
    updateSettings({ monitorConfig: { ...mc, ...patch } });
  };

  const handleToggleMetric = (key: MonitorMetricKey) => {
    const exists = mc.metrics.includes(key);
    if (exists && mc.metrics.length <= 1) {
      toast('至少保留 1 项监控指标', true);
      return;
    }
    const next = exists ? mc.metrics.filter((k) => k !== key) : [...mc.metrics, key];
    updateMonitor({ metrics: next });
  };

  const handleMoveMetric = (key: MonitorMetricKey, dir: -1 | 1) => {
    const idx = mc.metrics.indexOf(key);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= mc.metrics.length) return;
    const next = [...mc.metrics];
    const [moved] = next.splice(idx, 1);
    next.splice(target, 0, moved);
    updateMonitor({ metrics: next });
  };

  if (!canViewMonitor) {
    return (
      <div className="p-5 rounded-2xl text-center space-y-1.5" style={{ background: 'var(--pill-bg)' }}>
        <div className="text-sm font-medium">未开启系统监控共享</div>
        <div style={{ color: 'var(--ink-muted)' }}>
          管理员当前未向您的子账号共享宿主机实时监控数据，如需查看请联系管理员在「账号权限」中勾选「监控」。
        </div>
      </div>
    );
  }

  return (
    <>
      <section data-section="sec-mon-hdr" style={sectionHighlightStyle('sec-mon-hdr')} className="space-y-3">
        <div className="grid sm:grid-cols-2 gap-2.5">
          <label className="space-y-1">
            <span style={{ color: 'var(--ink-muted)' }}>自定义卡片名称（留空使用主机名）</span>
            <input
              type="text"
              value={mc.title}
              onChange={(e) => updateMonitor({ title: e.target.value })}
              placeholder={metrics?.hostname || 'Orbit-Node'}
              className="w-full h-8 px-2.5 rounded-lg focus:outline-none"
              style={{
                background: 'var(--pill-bg)',
                border: '1px solid var(--glass-border)',
                color: 'var(--ink)',
              }}
            />
          </label>
          <label className="space-y-1">
            <span style={{ color: 'var(--ink-muted)' }}>监控磁盘挂载点</span>
            <select
              value={mc.diskMount}
              onChange={(e) => updateMonitor({ diskMount: e.target.value })}
              className="w-full h-8 px-2.5 rounded-lg focus:outline-none"
              style={{
                background: 'rgba(var(--glass-rgb), 0.78)',
                border: '1px solid var(--glass-border)',
                color: 'var(--ink)',
              }}
            >
              <option value="">自动（默认根分区）</option>
              {(metrics?.mounts || []).map((m) => (
                <option key={m.mount} value={m.mount}>
                  {m.mount} ({formatBytes(m.used_bytes)} / {formatBytes(m.total_bytes)})
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => updateMonitor({ showNetSpeed: !mc.showNetSpeed })}
            className="p-2 rounded-xl text-left cursor-pointer"
            style={{
              background: mc.showNetSpeed ? 'var(--brand-solid)' : 'var(--pill-bg)',
              color: mc.showNetSpeed ? '#fff' : 'var(--ink-muted)',
            }}
          >
            <div className="font-medium">实时网速</div>
            <div className="opacity-80">顶部 ↑↓ 速率</div>
          </button>
          <button
            type="button"
            onClick={() => updateMonitor({ showSparkline: !mc.showSparkline })}
            className="p-2 rounded-xl text-left cursor-pointer"
            style={{
              background: mc.showSparkline ? 'var(--brand-solid)' : 'var(--pill-bg)',
              color: mc.showSparkline ? '#fff' : 'var(--ink-muted)',
            }}
          >
            <div className="font-medium">CPU 折线图</div>
            <div className="opacity-80">迷你历史曲线</div>
          </button>
          <button
            type="button"
            onClick={() => updateMonitor({ showLanIP: !mc.showLanIP })}
            className="p-2 rounded-xl text-left cursor-pointer"
            style={{
              background: mc.showLanIP ? 'var(--brand-solid)' : 'var(--pill-bg)',
              color: mc.showLanIP ? '#fff' : 'var(--ink-muted)',
            }}
          >
            <div className="font-medium">显示内网 IP</div>
            <div className="opacity-80">{metrics?.lan_ip || '局域网地址'}</div>
          </button>
        </div>
      </section>

      <section
        data-section="sec-mon-met"
        style={{ ...sectionHighlightStyle('sec-mon-met'), borderColor: 'var(--glass-border)' }}
        className="space-y-2.5 pt-4 border-t"
      >
        <div className="flex items-center justify-between flex-wrap gap-2">
          <span className="font-medium text-sm">自选指标项与显示顺序</span>
          <div className="flex items-center gap-2">
            <span style={{ color: 'var(--ink-muted)' }}>列数</span>
            {([2, 3, 4] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => updateMonitor({ columns: c })}
                className="px-2 py-0.5 rounded-md cursor-pointer"
                style={{
                  background: mc.columns === c ? 'var(--brand-solid)' : 'var(--pill-bg)',
                  color: mc.columns === c ? '#fff' : 'var(--ink-muted)',
                }}
              >
                {c}列
              </button>
            ))}
            <span style={{ color: 'var(--ink-muted)' }} className="ml-1">
              刷新
            </span>
            {([2, 3, 5, 10] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => updateMonitor({ refreshSeconds: s })}
                className="px-2 py-0.5 rounded-md cursor-pointer"
                style={{
                  background: mc.refreshSeconds === s ? 'var(--brand-solid)' : 'var(--pill-bg)',
                  color: mc.refreshSeconds === s ? '#fff' : 'var(--ink-muted)',
                }}
              >
                {s}s
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          {mc.metrics.map((k, idx) => (
            <div
              key={k}
              className="px-3 py-1.5 rounded-xl flex items-center justify-between"
              style={{ background: 'var(--pill-bg)', border: '1px solid var(--glass-border)' }}
            >
              <div className="flex items-center gap-2">
                <span className="font-mono opacity-60">#{idx + 1}</span>
                <span className="font-medium">{METRIC_LABELS[k]}</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={idx === 0}
                  onClick={() => handleMoveMetric(k, -1)}
                  className="p-1 rounded hover:bg-white/10 disabled:opacity-30 cursor-pointer"
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  disabled={idx === mc.metrics.length - 1}
                  onClick={() => handleMoveMetric(k, 1)}
                  className="p-1 rounded hover:bg-white/10 disabled:opacity-30 cursor-pointer"
                >
                  <ArrowDown className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => handleToggleMetric(k)}
                  className="px-2 py-0.5 rounded hover:bg-white/10 cursor-pointer"
                  style={{ color: 'var(--danger)' }}
                >
                  移除
                </button>
              </div>
            </div>
          ))}
        </div>

        {ALL_METRIC_KEYS.some((k) => !mc.metrics.includes(k)) && (
          <div className="space-y-1.5">
            <div style={{ color: 'var(--ink-muted)' }}>点击添加更多系统信息：</div>
            <div className="flex flex-wrap gap-1.5">
              {ALL_METRIC_KEYS.filter((k) => !mc.metrics.includes(k)).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => handleToggleMetric(k)}
                  className="px-2.5 py-1 rounded-lg flex items-center gap-1 cursor-pointer"
                  style={{ background: 'var(--pill-hover)' }}
                >
                  <Plus className="w-3 h-3" />
                  <span>{METRIC_LABELS[k]}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>
    </>
  );
}
