import { useRef, useState } from 'react';
import {
  Check,
  Loader2,
  PackagePlus,
  Plug,
  RefreshCw,
  Shield,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { api } from '../api/client';
import { useOrbitHost } from '../sdk/host';
import { getPluginIcon } from '../sdk/primitives';
import type { PluginManifest, PluginStateRecord } from '../sdk/types';

const SAMPLE_PING_MANIFEST: PluginManifest = {
  id: 'community.homelab-ping',
  name: '内网服务探测卡',
  version: '1.0.0',
  description: '轻量外部插件示例：通过后端代理直连内网 / Tailscale 地址，探测状态并保存备注。',
  icon: 'globe',
  tier: 'external',
  defaultEnabled: true,
  access: {
    minRole: 'user',
    guest: { mode: 'hidden' },
    permissions: ['kv', 'http:proxy'],
  },
  contributes: {
    widgets: [
      {
        id: 'main',
        label: '服务探测',
        minW: 260,
        defaultW: 400,
        resizable: true,
        defaultVisible: true,
      },
    ],
  },
  external: {
    entry: 'widget.html',
    renderMode: 'iframe',
    configFields: [
      {
        key: 'target_url',
        label: '探测目标 URL',
        type: 'url',
        placeholder: 'http://127.0.0.1:8090/api/public/config',
        defaultValue: 'http://127.0.0.1:8090/api/public/config',
      },
    ],
    httpProxy: {
      probe: {
        method: 'GET',
        url: '{{target_url}}',
        timeoutMs: 3500,
      },
    },
  },
};

const SAMPLE_PING_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  html, body {
    margin: 0; padding: 0; background: transparent;
    color: var(--ink, #f8fafc);
    font-family: var(--orbit-font, system-ui, sans-serif);
    font-size: 12px;
  }
  .box { display: flex; flex-direction: column; gap: 10px; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .pill {
    background: var(--pill-bg, rgba(255,255,255,0.08));
    border: 1px solid var(--glass-border, rgba(255,255,255,0.16));
    border-radius: var(--radius-sm, 8px);
    padding: 8px 10px;
  }
  button {
    background: var(--brand-solid, #6366f1); color: #fff; border: 0;
    border-radius: var(--radius-sm, 8px); padding: 6px 12px; cursor: pointer; font-weight: 500;
  }
  input {
    flex: 1; background: var(--pill-bg, rgba(255,255,255,0.08));
    border: 1px solid var(--glass-border, rgba(255,255,255,0.16));
    border-radius: var(--radius-sm, 8px); padding: 6px 8px; color: var(--ink, #f8fafc); outline: none;
  }
  .muted { color: var(--ink-muted, rgba(241,245,249,0.68)); }
</style>
</head>
<body>
  <div class="box">
    <div class="pill row">
      <div>
        <div style="font-weight:600">Homelab 直连代理状态</div>
        <div id="status" class="muted">点击右侧按钮发起探测</div>
      </div>
      <button id="btn">立即探测</button>
    </div>
    <div class="row">
      <input id="note" placeholder="用户隔离 KV 备注（自动保存）..." />
      <button id="save">保存备注</button>
    </div>
  </div>
  <script>
    const statusEl = document.getElementById('status');
    const noteEl = document.getElementById('note');
    let reqSeq = 0;
    const pending = new Map();
    function callHost(type, payload) {
      const reqId = String(++reqSeq);
      return new Promise((resolve, reject) => {
        pending.set(reqId, { resolve, reject });
        window.parent.postMessage({ type, reqId, ...payload }, window.location.origin);
      });
    }
    window.addEventListener('message', (ev) => {
      const d = ev.data || {};
      if (d.type === 'orbit:theme' && d.vars) {
        for (const [k, v] of Object.entries(d.vars)) {
          document.documentElement.style.setProperty(k, v);
        }
      } else if (d.reqId && pending.has(d.reqId)) {
        const p = pending.get(d.reqId); pending.delete(d.reqId);
        d.ok ? p.resolve(d.data) : p.reject(new Error(d.error || 'failed'));
      }
    });
    document.getElementById('btn').onclick = async () => {
      statusEl.textContent = '探测中...';
      try {
        const t0 = performance.now();
        const res = await callHost('orbit:proxy', { route: 'probe' });
        const ms = Math.round(performance.now() - t0);
        statusEl.textContent = '在线 HTTP 200 · ' + ms + 'ms · payload ' + JSON.stringify(res).length + 'B';
      } catch (e) {
        statusEl.textContent = '失败：' + e.message;
      }
    };
    document.getElementById('save').onclick = async () => {
      try {
        await callHost('orbit:kv:set', { key: 'note', value: noteEl.value });
        window.parent.postMessage({ type: 'orbit:toast', msg: '已写入用户隔离 KV' }, window.location.origin);
      } catch (e) {
        window.parent.postMessage({ type: 'orbit:toast', msg: e.message, warn: true }, window.location.origin);
      }
    };
    callHost('orbit:kv:get', { key: 'note' }).then((r) => {
      if (r && r.found && typeof r.value === 'string') noteEl.value = r.value;
    }).catch(() => {});
    window.parent.postMessage({ type: 'orbit:resize', height: 118 }, window.location.origin);
  </script>
</body>
</html>`;

export function PluginCenterPanel({ highlightSection }: { highlightSection?: string | null }) {
  const host = useOrbitHost();
  const zipInputRef = useRef<HTMLInputElement>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  const [installingZip, setInstallingZip] = useState(false);
  const [installingSample, setInstallingSample] = useState(false);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customManifestJson, setCustomManifestJson] = useState('');
  const [customHtml, setCustomHtml] = useState('');
  const [editingCfgId, setEditingCfgId] = useState<string | null>(null);
  const [cfgDraft, setCfgDraft] = useState<Record<string, unknown>>({});

  const builtins = host.plugins.filter((p) => p.manifest.tier === 'builtin');
  const externals = host.plugins.filter((p) => p.manifest.tier === 'external');

  const handleToggle = async (rec: PluginStateRecord) => {
    if (!host.isAdmin) return;
    setBusyId(rec.manifest.id);
    try {
      await host.togglePlugin(rec.manifest.id, !rec.enabled);
    } finally {
      setBusyId(null);
    }
  };

  const handleOpenConfig = (rec: PluginStateRecord) => {
    if (editingCfgId === rec.manifest.id) {
      setEditingCfgId(null);
      return;
    }
    const base: Record<string, unknown> = { ...(rec.config || {}) };
    for (const f of rec.manifest.external?.configFields || []) {
      if (base[f.key] === undefined && f.defaultValue !== undefined) {
        base[f.key] = f.defaultValue;
      }
    }
    setCfgDraft(base);
    setEditingCfgId(rec.manifest.id);
  };

  const handleSaveConfig = async (id: string) => {
    setBusyId(id);
    try {
      await host.savePluginConfig(id, cfgDraft);
      setEditingCfgId(null);
    } finally {
      setBusyId(null);
    }
  };

  const handleInstallZip = async (file: File) => {
    setInstallingZip(true);
    try {
      const res = await api.installExternalPluginZip(file);
      await host.refreshPlugins();
      host.toast(`已安装外部插件：${res.manifest.name}`);
    } catch (e) {
      host.toast((e as Error).message || '安装失败', true);
    } finally {
      setInstallingZip(false);
    }
  };

  const handleInstallSample = async () => {
    setInstallingSample(true);
    try {
      await api.installExternalPlugin(SAMPLE_PING_MANIFEST, {
        'widget.html': SAMPLE_PING_HTML,
      });
      await api.updatePlugin(SAMPLE_PING_MANIFEST.id, {
        enabled: true,
        config: {
          target_url: `${window.location.origin}/api/public/config`,
        },
      });
      await host.refreshPlugins();
      host.toast('已安装并启用示例插件「内网服务探测卡」');
    } catch (e) {
      host.toast((e as Error).message || '安装示例插件失败', true);
    } finally {
      setInstallingSample(false);
    }
  };

  const handleInstallCustom = async () => {
    try {
      const parsed = JSON.parse(customManifestJson) as PluginManifest;
      await api.installExternalPlugin(parsed, {
        [parsed.external?.entry || 'widget.html']: customHtml,
      });
      await host.refreshPlugins();
      setShowCustomForm(false);
      setCustomManifestJson('');
      setCustomHtml('');
      host.toast(`已安装外部插件：${parsed.name || parsed.id}`);
    } catch (e) {
      host.toast((e as Error).message || 'JSON 格式或安装参数有误', true);
    }
  };

  const handleUninstall = async (rec: PluginStateRecord) => {
    setBusyId(rec.manifest.id);
    try {
      await api.deleteExternalPlugin(rec.manifest.id);
      await host.refreshPlugins();
      host.toast(`已卸载插件：${rec.manifest.name}`);
    } catch (e) {
      host.toast((e as Error).message || '卸载失败', true);
    } finally {
      setBusyId(null);
    }
  };

  const handleReloadDir = async () => {
    setReloading(true);
    try {
      await api.reloadExternalPlugins();
      await host.refreshPlugins();
      host.toast('已重新扫描外部插件目录');
    } catch (e) {
      host.toast((e as Error).message || '重载失败', true);
    } finally {
      setReloading(false);
    }
  };

  const renderCard = (rec: PluginStateRecord) => {
    const m = rec.manifest;
    const isBusy = busyId === m.id;
    const fields = m.external?.configFields || [];
    const guestLabel =
      m.access.guest.mode === 'full'
        ? '访客完整'
        : m.access.guest.mode === 'readonly'
          ? '访客只读'
          : m.access.guest.mode === 'login-prompt'
            ? '需登录提示'
            : '访客隐藏';

    return (
      <div
        key={m.id}
        className="p-3 rounded-xl space-y-2.5"
        style={{ background: 'var(--pill-bg)' }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5 min-w-0">
            <span
              className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: 'rgba(var(--glass-rgb), 0.55)', color: 'var(--brand)' }}
            >
              {getPluginIcon(m.icon || 'plug', 'w-4 h-4')}
            </span>
            <div className="min-w-0 space-y-0.5">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-medium text-xs">{m.name}</span>
                <span className="kbd-chip">{m.id}</span>
                <span className="kbd-chip">v{m.version}</span>
                <span className="kbd-chip">{guestLabel}</span>
              </div>
              <div className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                {m.description}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {host.isAdmin && fields.length > 0 && (
              <button
                type="button"
                onClick={() => handleOpenConfig(rec)}
                className="px-2 py-1 rounded-lg cursor-pointer"
                style={{ background: 'var(--pill-hover)' }}
              >
                配置
              </button>
            )}
            {host.isAdmin && m.tier === 'external' && (
              <button
                type="button"
                disabled={isBusy}
                onClick={() => void handleUninstall(rec)}
                className="p-1.5 rounded-lg hover:bg-white/10 cursor-pointer"
                style={{ color: 'var(--danger)' }}
                title="卸载插件"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              disabled={!host.isAdmin || isBusy}
              onClick={() => void handleToggle(rec)}
              className="px-2.5 py-1 rounded-lg font-medium cursor-pointer transition-colors disabled:opacity-50"
              style={{
                background: rec.enabled ? 'var(--brand-solid)' : 'rgba(255,255,255,0.08)',
                color: rec.enabled ? '#fff' : 'var(--ink-muted)',
              }}
              title={host.isAdmin ? '切换插件启用状态' : '仅管理员可切换'}
            >
              {isBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : rec.enabled ? '已启用' : '已禁用'}
            </button>
          </div>
        </div>

        {host.isAdmin && editingCfgId === m.id && fields.length > 0 && (
          <div
            className="pt-2.5 border-t space-y-2"
            style={{ borderColor: 'var(--glass-border)' }}
          >
            {fields.map((f) => (
              <div key={f.key} className="space-y-1">
                <label className="block" style={{ color: 'var(--ink-muted)' }}>
                  {f.label} ({f.key})
                </label>
                {f.type === 'boolean' ? (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(cfgDraft[f.key])}
                      onChange={(e) =>
                        setCfgDraft((prev) => ({ ...prev, [f.key]: e.target.checked }))
                      }
                      className="accent-indigo-500"
                    />
                    <span>{f.label}</span>
                  </label>
                ) : (
                  <input
                    type={f.secret || f.type === 'password' ? 'password' : 'text'}
                    value={String(cfgDraft[f.key] ?? '')}
                    placeholder={f.placeholder || ''}
                    onChange={(e) =>
                      setCfgDraft((prev) => ({ ...prev, [f.key]: e.target.value }))
                    }
                    className="w-full h-8 px-2.5 rounded-lg font-mono focus:outline-none"
                    style={{
                      background: 'rgba(var(--glass-rgb), 0.5)',
                      border: '1px solid var(--glass-border)',
                      color: 'var(--ink)',
                    }}
                  />
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={() => void handleSaveConfig(m.id)}
              className="px-3 h-7 rounded-lg text-white font-medium flex items-center gap-1 cursor-pointer"
              style={{ background: 'var(--brand-solid)' }}
            >
              <Check className="w-3.5 h-3.5" />
              <span>保存配置</span>
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <section
        data-section="sec-plugins-builtin"
        className="space-y-3"
        style={
          highlightSection === 'sec-plugins-builtin'
            ? { outline: '1.5px solid var(--brand)', outlineOffset: 6, borderRadius: 12 }
            : undefined
        }
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 font-medium text-sm">
            <Shield className="w-4 h-4" style={{ color: 'var(--brand)' }} />
            <span>第一层 · 官方标准插件 ({builtins.length})</span>
          </div>
          {!host.isAdmin && (
            <span className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              仅管理员可启停插件
            </span>
          )}
        </div>
        <div className="space-y-2">{builtins.map(renderCard)}</div>
      </section>

      <section
        data-section="sec-plugins-external"
        className="space-y-3 pt-4 border-t"
        style={{
          borderColor: 'var(--glass-border)',
          ...(highlightSection === 'sec-plugins-external'
            ? { outline: '1.5px solid var(--brand)', outlineOffset: 6, borderRadius: 12 }
            : {}),
        }}
      >
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 font-medium text-sm">
            <Plug className="w-4 h-4" style={{ color: 'var(--ok)' }} />
            <span>第二层 · 外部轻量扩展 ({externals.length})</span>
          </div>
          {host.isAdmin && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <input
                ref={zipInputRef}
                type="file"
                accept=".zip"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleInstallZip(f);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                disabled={installingSample}
                onClick={() => void handleInstallSample()}
                className="px-2.5 py-1 rounded-lg flex items-center gap-1 cursor-pointer"
                style={{ background: 'var(--pill-hover)' }}
              >
                <Sparkles className="w-3.5 h-3.5" style={{ color: 'var(--brand)' }} />
                <span>{installingSample ? '安装中...' : '安装示例插件'}</span>
              </button>
              <button
                type="button"
                disabled={installingZip}
                onClick={() => zipInputRef.current?.click()}
                className="px-2.5 py-1 rounded-lg flex items-center gap-1 text-white cursor-pointer"
                style={{ background: 'var(--brand-solid)' }}
              >
                <Upload className="w-3.5 h-3.5" />
                <span>{installingZip ? '解析中...' : '上传 .zip'}</span>
              </button>
              <button
                type="button"
                onClick={() => setShowCustomForm((v) => !v)}
                className="px-2.5 py-1 rounded-lg flex items-center gap-1 cursor-pointer"
                style={{ background: 'var(--pill-bg)' }}
              >
                <PackagePlus className="w-3.5 h-3.5" />
                <span>JSON 安装</span>
              </button>
              <button
                type="button"
                disabled={reloading}
                onClick={() => void handleReloadDir()}
                className="p-1.5 rounded-lg cursor-pointer"
                style={{ background: 'var(--pill-bg)' }}
                title="重载磁盘插件目录"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${reloading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          )}
        </div>

        {host.isAdmin && showCustomForm && (
          <div className="p-3 rounded-xl space-y-2" style={{ background: 'var(--pill-bg)' }}>
            <textarea
              rows={5}
              value={customManifestJson}
              onChange={(e) => setCustomManifestJson(e.target.value)}
              placeholder='粘贴 manifest.json 内容（包含 id / name / contributes.widgets / external）'
              className="w-full p-2.5 rounded-lg font-mono text-[11px] focus:outline-none"
              style={{
                background: 'rgba(var(--glass-rgb), 0.5)',
                border: '1px solid var(--glass-border)',
                color: 'var(--ink)',
              }}
            />
            <textarea
              rows={5}
              value={customHtml}
              onChange={(e) => setCustomHtml(e.target.value)}
              placeholder="粘贴入口文件源码 (例如 widget.html 或 widget.mjs)..."
              className="w-full p-2.5 rounded-lg font-mono text-[11px] focus:outline-none"
              style={{
                background: 'rgba(var(--glass-rgb), 0.5)',
                border: '1px solid var(--glass-border)',
                color: 'var(--ink)',
              }}
            />
            <button
              type="button"
              onClick={() => void handleInstallCustom()}
              className="px-3 h-8 rounded-lg text-white font-medium cursor-pointer"
              style={{ background: 'var(--brand-solid)' }}
            >
              提交安装
            </button>
          </div>
        )}

        {externals.length === 0 ? (
          <div
            className="p-5 rounded-xl text-center text-xs space-y-1"
            style={{ background: 'var(--pill-bg)', color: 'var(--ink-muted)' }}
          >
            <div>尚未安装外部轻量扩展插件</div>
            <div>支持上传 .zip 插件包，或点击上方「安装示例插件」体验沙箱主题同步与 LAN 代理。</div>
          </div>
        ) : (
          <div className="space-y-2">{externals.map(renderCard)}</div>
        )}
      </section>
    </div>
  );
}
