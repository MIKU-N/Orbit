import { useRef, useState } from 'react';
import {
  Check,
  Loader2,
  PackagePlus,
  Plug,
  RefreshCw,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { api } from '../api/client';
import { useOrbitHost } from '../sdk/host';
import { OrbitSelect, getPluginIcon } from '../sdk/primitives';
import type {
  PluginManifest,
  PluginStateRecord,
  PluginStyleOverride,
  PluginVisibilityOverride,
} from '../sdk/types';

const SAMPLE_PING_MANIFEST: PluginManifest = {
  id: 'community.homelab-ping',
  name: '星轨探测 · 样式示例',
  version: '2.0.0',
  description: '官方示例扩展：集成内网代理探测、延迟曲线、KV 备注标签与 Orbit 全局样式画廊（昼夜/圆角/字体/无卡片全联动）。',
  icon: 'activity',
  tier: 'light',
  source: 'external',
  defaultEnabled: true,
  access: {
    minRole: 'user',
    allowPublic: true,
    guest: { mode: 'hidden' },
    permissions: ['kv', 'http:proxy'],
  },
  style: {
    managed: true,
    supportsCardless: true,
    defaultCardless: false,
    hideHeader: false,
  },
  contributes: {
    widgets: [
      {
        id: 'main',
        label: '探测与样式',
        minW: 280,
        defaultW: 440,
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
        label: '探测地址',
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
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0; background: transparent;
    color: var(--ink, #f8fafc);
    font-family: var(--orbit-font, system-ui, -apple-system, sans-serif);
    font-size: 12px;
    line-height: 1.45;
    -webkit-font-smoothing: antialiased;
    overflow: hidden;
    transition: color 260ms ease;
  }
  :root[data-cardless="true"] body {
    color: var(--hero-ink, #ffffff);
    text-shadow: var(--hero-shadow, 0 2px 14px rgba(0,0,0,0.42));
  }
  .mono { font-variant-numeric: tabular-nums; font-family: ui-monospace, var(--orbit-font, monospace); }
  .muted { color: var(--ink-muted, rgba(241,245,249,0.68)); }
  .subtle { color: var(--ink-subtle, rgba(241,245,249,0.44)); }
  :root[data-cardless="true"] .muted,
  :root[data-cardless="true"] .subtle { color: var(--hero-ink-muted, rgba(255,255,255,0.84)); }

  .wrap { display: flex; flex-direction: column; gap: 10px; padding-bottom: 2px; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .row-wrap { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

  /* Surface containers synced with global radius & glass tokens */
  .panel {
    background: var(--pill-bg, rgba(255,255,255,0.085));
    border: 1px solid var(--glass-border, rgba(255,255,255,0.16));
    border-radius: var(--radius-lg, 12px);
    padding: 10px 11px;
    transition: background-color 260ms ease, border-color 220ms ease, border-radius 220ms ease;
  }
  :root[data-cardless="true"] .panel {
    background: rgba(15, 23, 42, 0.24);
    border-color: rgba(255, 255, 255, 0.2);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
  }
  .panel:hover { border-color: var(--glass-border-hover, rgba(255,255,255,0.32)); }

  /* Segmented Tabs */
  .tabs {
    display: inline-flex;
    padding: 2px;
    gap: 2px;
    border-radius: var(--radius-sm, 8px);
    background: var(--pill-bg, rgba(255,255,255,0.085));
    border: 1px solid var(--glass-border, rgba(255,255,255,0.16));
  }
  .tab {
    border: 0;
    background: transparent;
    color: var(--ink-muted, rgba(241,245,249,0.7));
    padding: 4px 10px;
    border-radius: max(4px, calc(var(--radius-sm, 8px) - 2px));
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    transition: background-color 180ms ease, color 180ms ease, transform 120ms ease;
  }
  .tab:hover { color: var(--ink, #f8fafc); }
  .tab.active {
    background: var(--brand-solid, #6366f1);
    color: #ffffff;
    box-shadow: 0 2px 8px rgba(99, 102, 241, 0.32);
  }

  /* Badges & Chips */
  .badge {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 10.5px;
    font-weight: 500;
    background: var(--pill-bg, rgba(255,255,255,0.085));
    border: 1px solid var(--glass-border, rgba(255,255,255,0.16));
    transition: background-color 220ms ease, border-color 220ms ease, color 220ms ease;
  }
  .badge.brand { background: color-mix(in srgb, var(--brand-solid, #6366f1) 18%, transparent); border-color: color-mix(in srgb, var(--brand, #818cf8) 42%, transparent); color: var(--brand, #818cf8); }
  .badge.ok { background: color-mix(in srgb, var(--ok, #34d399) 16%, transparent); border-color: color-mix(in srgb, var(--ok, #34d399) 40%, transparent); color: var(--ok, #34d399); }
  .badge.warn { background: color-mix(in srgb, var(--warn, #fbbf24) 16%, transparent); border-color: color-mix(in srgb, var(--warn, #fbbf24) 40%, transparent); color: var(--warn, #fbbf24); }
  .badge.danger { background: color-mix(in srgb, var(--danger, #f87171) 16%, transparent); border-color: color-mix(in srgb, var(--danger, #f87171) 40%, transparent); color: var(--danger, #f87171); }

  .dot { width: 7px; height: 7px; border-radius: 999px; background: var(--ink-subtle, #94a3b8); flex-shrink: 0; position: relative; }
  .dot.ok { background: var(--ok, #34d399); box-shadow: 0 0 8px color-mix(in srgb, var(--ok, #34d399) 70%, transparent); }
  .dot.ok::after {
    content: ''; position: absolute; inset: -3px; border-radius: 999px;
    border: 1.5px solid var(--ok, #34d399); opacity: 0;
    animation: ping 2s cubic-bezier(0,0,0.2,1) infinite;
  }
  .dot.busy { background: var(--brand, #818cf8); animation: pulse 1s ease-in-out infinite; }
  .dot.err { background: var(--danger, #f87171); }
  @keyframes ping { 0% { transform: scale(0.8); opacity: 0.7; } 80%, 100% { transform: scale(2.1); opacity: 0; } }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* KPI Grid */
  .kpi-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px; }
  .kpi {
    background: var(--code-bg, rgba(0,0,0,0.22));
    border: 1px solid var(--glass-border, rgba(255,255,255,0.12));
    border-radius: var(--radius-sm, 8px);
    padding: 7px 8px;
    display: flex; flex-direction: column; gap: 2px;
    transition: border-color 180ms ease, background-color 260ms ease;
  }
  .kpi-val { font-size: 14px; font-weight: 700; letter-spacing: -0.02em; }
  .kpi-lbl { font-size: 10px; }

  /* Progress track */
  .track {
    height: 6px; width: 100%; border-radius: 999px; overflow: hidden;
    background: var(--track-bg, rgba(255,255,255,0.14));
  }
  .bar {
    height: 100%; border-radius: 999px;
    background: linear-gradient(90deg, var(--brand-solid, #6366f1), var(--ok, #34d399));
    transition: width 360ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  /* Sparkline */
  .spark-box {
    height: 44px; width: 100%;
    border-radius: var(--radius-sm, 8px);
    background: var(--code-bg, rgba(0,0,0,0.22));
    border: 1px solid var(--glass-border, rgba(255,255,255,0.12));
    padding: 4px 6px;
    display: flex; align-items: center;
  }
  .spark-svg { width: 100%; height: 100%; display: block; overflow: visible; }

  /* Buttons */
  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 5px;
    border-radius: var(--radius-sm, 8px);
    padding: 6px 11px;
    font-size: 11.5px;
    font-weight: 500;
    cursor: pointer;
    border: 1px solid transparent;
    transition: background-color 160ms ease, border-color 160ms ease, transform 100ms ease, opacity 160ms ease;
  }
  .btn:active { transform: scale(0.96); }
  .btn-primary {
    background: var(--brand-solid, #6366f1); color: #ffffff;
    box-shadow: 0 3px 12px color-mix(in srgb, var(--brand-solid, #6366f1) 36%, transparent);
  }
  .btn-primary:hover { filter: brightness(1.08); }
  .btn-secondary {
    background: var(--pill-hover, rgba(255,255,255,0.15));
    color: var(--ink, #f8fafc);
    border-color: var(--glass-border, rgba(255,255,255,0.16));
  }
  .btn-secondary:hover { border-color: var(--glass-border-hover, rgba(255,255,255,0.34)); }
  .btn-ghost {
    background: transparent; color: var(--ink-muted, rgba(241,245,249,0.72));
    border-color: var(--glass-border, rgba(255,255,255,0.16));
  }
  .btn-ghost:hover { background: var(--hover-bg, rgba(255,255,255,0.1)); color: var(--ink, #f8fafc); }
  .btn-danger {
    background: color-mix(in srgb, var(--danger, #f87171) 16%, transparent);
    color: var(--danger, #f87171);
    border-color: color-mix(in srgb, var(--danger, #f87171) 38%, transparent);
  }
  .btn-sm { padding: 4px 8px; font-size: 11px; }

  /* Inputs & Chips */
  input[type="text"] {
    flex: 1; min-width: 0;
    height: 30px;
    background: var(--input-bg, var(--pill-bg, rgba(255,255,255,0.08)));
    border: 1px solid var(--glass-border, rgba(255,255,255,0.16));
    border-radius: var(--radius-sm, 8px);
    padding: 0 9px;
    color: var(--ink, #f8fafc);
    font-size: 11.5px;
    outline: none;
    transition: border-color 150ms ease, box-shadow 150ms ease, background-color 220ms ease;
  }
  input[type="text"]::placeholder { color: var(--ink-subtle, rgba(241,245,249,0.44)); }
  input[type="text"]:focus {
    border-color: var(--brand, #818cf8);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--brand-solid, #6366f1) 25%, transparent);
  }

  .chip {
    border: 1px solid var(--glass-border, rgba(255,255,255,0.16));
    background: var(--pill-bg, rgba(255,255,255,0.08));
    color: var(--ink-muted, rgba(241,245,249,0.72));
    border-radius: 999px;
    padding: 2px 8px;
    font-size: 10.5px;
    cursor: pointer;
    transition: all 160ms ease;
  }
  .chip:hover { border-color: var(--glass-border-hover, rgba(255,255,255,0.34)); color: var(--ink, #f8fafc); }
  .chip.active {
    background: color-mix(in srgb, var(--brand-solid, #6366f1) 24%, transparent);
    border-color: var(--brand, #818cf8);
    color: var(--brand, #818cf8);
    font-weight: 600;
  }

  /* Orbit-style Switch */
  .switch {
    position: relative; width: 30px; height: 17px; border-radius: 999px; border: 0;
    background: var(--track-bg, rgba(255,255,255,0.18));
    cursor: pointer; padding: 0; transition: background-color 200ms ease;
    flex-shrink: 0;
  }
  .switch::after {
    content: ''; position: absolute; top: 2px; left: 2px;
    width: 13px; height: 13px; border-radius: 999px; background: #fff;
    box-shadow: 0 1px 4px rgba(0,0,0,0.32);
    transition: transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .switch[aria-checked="true"] { background: var(--brand-solid, #6366f1); }
  .switch[aria-checked="true"]::after { transform: translateX(13px); }

  /* Style Showcase helpers */
  .swatch-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px; }
  .swatch {
    display: flex; flex-direction: column; align-items: center; gap: 4px;
    padding: 6px 4px; border-radius: var(--radius-sm, 8px);
    background: var(--code-bg, rgba(0,0,0,0.22));
    border: 1px solid var(--glass-border, rgba(255,255,255,0.12));
  }
  .swatch-dot { width: 20px; height: 20px; border-radius: 999px; box-shadow: inset 0 1px 2px rgba(255,255,255,0.35), 0 2px 6px rgba(0,0,0,0.25); }
  .radius-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
  .radius-box {
    padding: 7px 6px; text-align: center;
    background: var(--pill-bg, rgba(255,255,255,0.08));
    border: 1px solid var(--glass-border, rgba(255,255,255,0.16));
  }
  .kbd {
    display: inline-block; padding: 1px 6px; font-size: 10.5px;
    border-radius: max(4px, calc(var(--radius-sm, 8px) * 0.75));
    background: var(--code-bg, rgba(0,0,0,0.24));
    border: 1px solid var(--glass-border, rgba(255,255,255,0.16));
    color: var(--ink-muted, rgba(241,245,249,0.72));
  }
  .code-line {
    padding: 6px 8px; border-radius: var(--radius-sm, 8px);
    background: var(--code-bg, rgba(0,0,0,0.26));
    border: 1px solid var(--glass-border, rgba(255,255,255,0.12));
    font-size: 10.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  input[type="range"] {
    width: 100%; accent-color: var(--brand-solid, #6366f1); cursor: pointer; height: 5px;
  }
  .hidden { display: none !important; }
  .spin { animation: spin 0.9s linear infinite; }
</style>
</head>
<body>
  <div class="wrap" id="root">
    <!-- Header bar: live host bindings + mode switcher -->
    <div class="row" style="flex-wrap:wrap">
      <div class="row-wrap">
        <span class="badge brand" id="envTheme">夜间</span>
        <span class="badge" id="envZone">LAN</span>
        <span class="badge" id="envSurface">卡片</span>
      </div>
      <div class="tabs" role="tablist">
        <button class="tab active" id="tabProbe" type="button" role="tab">服务探测</button>
        <button class="tab" id="tabStyle" type="button" role="tab">样式画廊</button>
      </div>
    </div>

    <!-- View 1: Functional Homelab Probe + Sparkline + KV -->
    <div id="viewProbe" class="wrap">
      <div class="panel" style="display:flex;flex-direction:column;gap:9px">
        <div class="row">
          <div class="row-wrap" style="min-width:0">
            <span class="dot" id="statusDot"></span>
            <div style="min-width:0">
              <div style="font-weight:600" id="statusTitle">待探测</div>
              <div class="muted mono" style="font-size:10.5px" id="statusSub">通过 httpProxy 直连内网目标</div>
            </div>
          </div>
          <div class="row-wrap" style="flex-shrink:0">
            <button class="btn btn-primary btn-sm" id="btnProbe" type="button">
              <svg id="probeSpinner" class="hidden spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M21 12a9 9 0 1 1-6.2-8.56"/></svg>
              <span>探测</span>
            </button>
          </div>
        </div>

        <div class="kpi-grid">
          <div class="kpi">
            <span class="kpi-lbl muted">延迟</span>
            <span class="kpi-val mono" id="kpiMs" style="color:var(--brand)">--</span>
          </div>
          <div class="kpi">
            <span class="kpi-lbl muted">载荷</span>
            <span class="kpi-val mono" id="kpiSize">--</span>
          </div>
          <div class="kpi">
            <span class="kpi-lbl muted">在线率</span>
            <span class="kpi-val mono" id="kpiRate" style="color:var(--ok)">--</span>
          </div>
        </div>

        <div class="spark-box" title="最近 12 次探测延迟曲线">
          <svg class="spark-svg" id="sparkSvg" viewBox="0 0 240 34" preserveAspectRatio="none">
            <defs>
              <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="var(--brand, #818cf8)" stop-opacity="0.42"/>
                <stop offset="100%" stop-color="var(--brand, #818cf8)" stop-opacity="0"/>
              </linearGradient>
            </defs>
            <path id="sparkArea" d="" fill="url(#sparkFill)"/>
            <polyline id="sparkLine" points="" fill="none" stroke="var(--brand, #818cf8)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>

        <div class="row">
          <div class="row-wrap" style="gap:6px">
            <button class="switch" id="autoSwitch" type="button" role="switch" aria-checked="false" aria-label="自动轮询"></button>
            <span class="muted" style="font-size:11px">每 8s 自动轮询</span>
          </div>
          <span class="kbd mono" id="lastAt">未记录</span>
        </div>
      </div>

      <!-- KV note + status tag chips -->
      <div class="panel" style="display:flex;flex-direction:column;gap:8px">
        <div class="row">
          <span style="font-weight:600;font-size:11.5px">节点备注与标签 (KV)</span>
          <span class="subtle" style="font-size:10.5px">用户隔离持久化</span>
        </div>
        <div class="row-wrap" id="tagBar">
          <button type="button" class="chip" data-tag="核心节点">核心节点</button>
          <button type="button" class="chip" data-tag="NAS">NAS</button>
          <button type="button" class="chip" data-tag="反代入口">反代入口</button>
          <button type="button" class="chip" data-tag="需关注">需关注</button>
        </div>
        <div class="row">
          <input id="note" type="text" placeholder="记录节点说明或运维备注..." />
          <button class="btn btn-secondary btn-sm" id="btnSave" type="button">保存</button>
        </div>
      </div>
    </div>

    <!-- View 2: Comprehensive Orbit Style Gallery -->
    <div id="viewStyle" class="wrap hidden">
      <div class="panel" style="display:flex;flex-direction:column;gap:8px">
        <div class="row">
          <span style="font-weight:600;font-size:11.5px">语义色板 (CSS Tokens)</span>
          <span class="muted mono" style="font-size:10.5px" id="fontName">全局字体同步</span>
        </div>
        <div class="swatch-grid">
          <div class="swatch"><span class="swatch-dot" style="background:var(--brand)"></span><span class="muted" style="font-size:10px">Brand</span></div>
          <div class="swatch"><span class="swatch-dot" style="background:var(--brand-solid)"></span><span class="muted" style="font-size:10px">Solid</span></div>
          <div class="swatch"><span class="swatch-dot" style="background:var(--ok)"></span><span class="muted" style="font-size:10px">OK</span></div>
          <div class="swatch"><span class="swatch-dot" style="background:var(--warn)"></span><span class="muted" style="font-size:10px">Warn</span></div>
          <div class="swatch"><span class="swatch-dot" style="background:var(--danger)"></span><span class="muted" style="font-size:10px">Danger</span></div>
        </div>
      </div>

      <div class="panel" style="display:flex;flex-direction:column;gap:8px">
        <div class="row">
          <span style="font-weight:600;font-size:11.5px">动态圆角联动</span>
          <span class="muted" style="font-size:10.5px">拖动设置圆角实时生效</span>
        </div>
        <div class="radius-grid">
          <div class="radius-box" style="border-radius:var(--radius-card, 16px)">
            <div style="font-weight:600">Card</div>
            <div class="muted mono" style="font-size:10px" id="radCard">16px</div>
          </div>
          <div class="radius-box" style="border-radius:var(--radius-lg, 12px)">
            <div style="font-weight:600">Large</div>
            <div class="muted mono" style="font-size:10px" id="radLg">12px</div>
          </div>
          <div class="radius-box" style="border-radius:var(--radius-sm, 8px)">
            <div style="font-weight:600">Small</div>
            <div class="muted mono" style="font-size:10px" id="radSm">8px</div>
          </div>
        </div>
      </div>

      <div class="panel" style="display:flex;flex-direction:column;gap:8px">
        <span style="font-weight:600;font-size:11.5px">按钮 · 徽章 · 进度条 · 通知联动</span>
        <div class="row-wrap">
          <button type="button" class="btn btn-primary btn-sm" id="demoToastOk">常规 Toast</button>
          <button type="button" class="btn btn-secondary btn-sm" id="demoToastWarn">警告 Toast</button>
          <button type="button" class="btn btn-ghost btn-sm" id="demoGhost">幽灵按钮</button>
          <button type="button" class="btn btn-danger btn-sm" id="demoDanger">危险态</button>
        </div>
        <div class="row-wrap">
          <span class="badge ok">在线</span>
          <span class="badge warn">限速</span>
          <span class="badge danger">告警</span>
          <span class="badge brand">扩展</span>
          <span class="kbd mono">Ctrl + K</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:4px">
          <div class="row" style="font-size:10.5px">
            <span class="muted">进度条与滑块演示</span>
            <span class="mono" id="demoPct">72%</span>
          </div>
          <div class="track"><div class="bar" id="demoBar" style="width:72%"></div></div>
          <input type="range" id="demoRange" min="0" max="100" value="72" />
        </div>
        <div class="code-line mono muted">var(--brand-solid) · var(--glass-border) · var(--radius-card)</div>
      </div>
    </div>
  </div>

  <script>
    const rootEl = document.getElementById('root');
    const envTheme = document.getElementById('envTheme');
    const envZone = document.getElementById('envZone');
    const envSurface = document.getElementById('envSurface');
    const statusDot = document.getElementById('statusDot');
    const statusTitle = document.getElementById('statusTitle');
    const statusSub = document.getElementById('statusSub');
    const kpiMs = document.getElementById('kpiMs');
    const kpiSize = document.getElementById('kpiSize');
    const kpiRate = document.getElementById('kpiRate');
    const lastAt = document.getElementById('lastAt');
    const probeSpinner = document.getElementById('probeSpinner');
    const sparkLine = document.getElementById('sparkLine');
    const sparkArea = document.getElementById('sparkArea');
    const noteEl = document.getElementById('note');
    const autoSwitch = document.getElementById('autoSwitch');

    const tabProbe = document.getElementById('tabProbe');
    const tabStyle = document.getElementById('tabStyle');
    const viewProbe = document.getElementById('viewProbe');
    const viewStyle = document.getElementById('viewStyle');

    let reqSeq = 0;
    const pending = new Map();
    const samples = [];
    let okCount = 0;
    let totalCount = 0;
    let autoTimer = null;
    let selectedTags = [];

    function callHost(type, payload) {
      const reqId = String(++reqSeq);
      return new Promise((resolve, reject) => {
        pending.set(reqId, { resolve, reject });
        window.parent.postMessage({ type, reqId, ...payload }, window.location.origin);
      });
    }

    function reportHeight() {
      const h = Math.ceil(rootEl.getBoundingClientRect().height) + 4;
      if (h > 40) {
        window.parent.postMessage({ type: 'orbit:resize', height: h }, window.location.origin);
      }
    }

    function updateStyleReadout() {
      const cs = getComputedStyle(document.documentElement);
      document.getElementById('radCard').textContent = cs.getPropertyValue('--radius-card').trim() || '16px';
      document.getElementById('radLg').textContent = cs.getPropertyValue('--radius-lg').trim() || '12px';
      document.getElementById('radSm').textContent = cs.getPropertyValue('--radius-sm').trim() || '8px';
      const fontRaw = cs.getPropertyValue('--orbit-font').trim();
      if (fontRaw) {
        document.getElementById('fontName').textContent = fontRaw.split(',')[0].replace(/['"]/g, '');
      }
    }

    function renderSparkline() {
      const data = samples.length > 0 ? samples : [18, 22, 16, 19, 14, 17];
      const max = Math.max(30, ...data);
      const w = 240, h = 30, pad = 2;
      const step = data.length > 1 ? w / (data.length - 1) : w;
      const pts = data.map((v, i) => {
        const x = data.length > 1 ? i * step : w / 2;
        const y = h - pad - ((v / max) * (h - pad * 2));
        return [x.toFixed(1), y.toFixed(1)];
      });
      const lineStr = pts.map((p) => p.join(',')).join(' ');
      sparkLine.setAttribute('points', lineStr);
      if (pts.length > 1) {
        sparkArea.setAttribute('d', 'M ' + pts[0][0] + ',' + h + ' L ' + pts.map((p) => p.join(',')).join(' L ') + ' L ' + pts[pts.length - 1][0] + ',' + h + ' Z');
      } else {
        sparkArea.setAttribute('d', '');
      }
    }

    function renderTags() {
      document.querySelectorAll('#tagBar .chip').forEach((btn) => {
        const active = selectedTags.includes(btn.dataset.tag);
        btn.classList.toggle('active', active);
      });
    }

    function fmtSize(n) {
      if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
      return n + ' B';
    }

    async function runProbe(silent) {
      statusDot.className = 'dot busy';
      statusTitle.textContent = '探测中...';
      probeSpinner.classList.remove('hidden');
      totalCount++;
      try {
        const t0 = performance.now();
        const res = await callHost('orbit:proxy', { route: 'probe' });
        const ms = Math.max(1, Math.round(performance.now() - t0));
        const bytes = JSON.stringify(res || '').length;
        okCount++;
        samples.push(ms);
        if (samples.length > 12) samples.shift();

        statusDot.className = 'dot ok';
        statusTitle.textContent = '服务在线';
        statusSub.textContent = 'httpProxy 直连正常 · HTTP 200';
        kpiMs.textContent = ms + ' ms';
        kpiMs.style.color = ms > 300 ? 'var(--warn)' : 'var(--brand)';
        kpiSize.textContent = fmtSize(bytes);
        const rate = Math.round((okCount / totalCount) * 100);
        kpiRate.textContent = rate + '%';
        kpiRate.style.color = rate >= 90 ? 'var(--ok)' : 'var(--warn)';
        const now = new Date();
        lastAt.textContent = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0') + ':' + String(now.getSeconds()).padStart(2, '0');
        renderSparkline();
      } catch (e) {
        statusDot.className = 'dot err';
        statusTitle.textContent = '探测异常';
        statusSub.textContent = e.message || '目标不可达';
        const rate = Math.round((okCount / totalCount) * 100);
        kpiRate.textContent = rate + '%';
        kpiRate.style.color = 'var(--danger)';
        if (!silent) {
          window.parent.postMessage({ type: 'orbit:toast', msg: '探测失败：' + (e.message || '未知错误'), warn: true }, window.location.origin);
        }
      } finally {
        probeSpinner.classList.add('hidden');
        reportHeight();
      }
    }

    function setActiveTab(name) {
      const isStyle = name === 'style';
      tabProbe.classList.toggle('active', !isStyle);
      tabStyle.classList.toggle('active', isStyle);
      viewProbe.classList.toggle('hidden', isStyle);
      viewStyle.classList.toggle('hidden', !isStyle);
      if (isStyle) updateStyleReadout();
      requestAnimationFrame(reportHeight);
    }

    tabProbe.onclick = () => setActiveTab('probe');
    tabStyle.onclick = () => setActiveTab('style');
    document.getElementById('btnProbe').onclick = () => runProbe(false);

    autoSwitch.onclick = () => {
      const next = autoSwitch.getAttribute('aria-checked') !== 'true';
      autoSwitch.setAttribute('aria-checked', String(next));
      if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
      if (next) {
        runProbe(true);
        autoTimer = setInterval(() => runProbe(true), 8000);
      }
    };

    document.querySelectorAll('#tagBar .chip').forEach((btn) => {
      btn.onclick = () => {
        const tag = btn.dataset.tag;
        if (selectedTags.includes(tag)) selectedTags = selectedTags.filter((t) => t !== tag);
        else selectedTags = [...selectedTags, tag];
        renderTags();
      };
    });

    document.getElementById('btnSave').onclick = async () => {
      try {
        await callHost('orbit:kv:set', { key: 'note', value: noteEl.value });
        await callHost('orbit:kv:set', { key: 'tags', value: selectedTags });
        window.parent.postMessage({ type: 'orbit:toast', msg: '备注与标签已保存' }, window.location.origin);
      } catch (e) {
        window.parent.postMessage({ type: 'orbit:toast', msg: e.message || '保存失败', warn: true }, window.location.origin);
      }
    };

    document.getElementById('demoToastOk').onclick = () =>
      window.parent.postMessage({ type: 'orbit:toast', msg: '来自示例组件的常规通知' }, window.location.origin);
    document.getElementById('demoToastWarn').onclick = () =>
      window.parent.postMessage({ type: 'orbit:toast', msg: '来自示例组件的警告通知', warn: true }, window.location.origin);
    document.getElementById('demoGhost').onclick = () => setActiveTab('probe');
    document.getElementById('demoDanger').onclick = () =>
      window.parent.postMessage({ type: 'orbit:toast', msg: '危险操作样式演示（未执行任何删除）', warn: true }, window.location.origin);

    const demoRange = document.getElementById('demoRange');
    const demoBar = document.getElementById('demoBar');
    const demoPct = document.getElementById('demoPct');
    demoRange.oninput = () => {
      demoBar.style.width = demoRange.value + '%';
      demoPct.textContent = demoRange.value + '%';
    };

    window.addEventListener('message', (ev) => {
      const d = ev.data || {};
      if (d.type === 'orbit:theme') {
        if (d.theme) {
          document.documentElement.dataset.theme = d.theme;
          envTheme.textContent = d.theme === 'light' ? '白天' : '夜间';
        }
        if (typeof d.cardless === 'boolean') {
          document.documentElement.dataset.cardless = d.cardless ? 'true' : 'false';
          envSurface.textContent = d.cardless ? '无卡片' : '卡片';
        }
        if (d.zone) {
          envZone.textContent = d.zone === 'lan' ? 'LAN' : d.zone === 'tailscale' ? 'TS' : 'WAN';
        }
        if (d.vars) {
          for (const [k, v] of Object.entries(d.vars)) {
            document.documentElement.style.setProperty(k, v);
          }
        }
        updateStyleReadout();
        requestAnimationFrame(reportHeight);
      } else if (d.reqId && pending.has(d.reqId)) {
        const p = pending.get(d.reqId); pending.delete(d.reqId);
        d.ok ? p.resolve(d.data) : p.reject(new Error(d.error || 'failed'));
      }
    });

    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => reportHeight()).observe(rootEl);
    }

    Promise.all([
      callHost('orbit:kv:get', { key: 'note' }).catch(() => null),
      callHost('orbit:kv:get', { key: 'tags' }).catch(() => null),
    ]).then(([noteRes, tagsRes]) => {
      if (noteRes && noteRes.found && typeof noteRes.value === 'string') noteEl.value = noteRes.value;
      if (tagsRes && tagsRes.found && Array.isArray(tagsRes.value)) {
        selectedTags = tagsRes.value.filter((x) => typeof x === 'string');
        renderTags();
      }
    });

    renderSparkline();
    window.parent.postMessage({ type: 'orbit:ready' }, window.location.origin);
    requestAnimationFrame(() => {
      reportHeight();
      runProbe(true);
    });
  </script>
</body>
</html>`;

const SAMPLE_ESM_MANIFEST: PluginManifest = {
  id: 'community.style-card-esm',
  name: '原生 ESM 样式卡示例',
  version: '1.0.0',
  description: '零 iframe 原生 ESM 微件示例：直接挂载到宿主 DOM，自动继承毛玻璃、昼夜主题与无卡片样式。',
  icon: 'palette',
  tier: 'light',
  source: 'external',
  defaultEnabled: true,
  access: {
    minRole: 'user',
    allowPublic: true,
    guest: { mode: 'readonly' },
    permissions: ['kv'],
  },
  style: {
    managed: true,
    supportsCardless: true,
    defaultCardless: false,
    hideHeader: false,
  },
  contributes: {
    widgets: [
      {
        id: 'main',
        label: 'ESM 样式示例',
        minW: 260,
        defaultW: 360,
        resizable: true,
        defaultVisible: true,
      },
    ],
  },
  external: {
    entry: 'widget.mjs',
    renderMode: 'esm',
  },
};

const SAMPLE_ESM_SOURCE = `export function mount(el, ctx) {
  let count = 0;
  const render = (state) => {
    const isLight = state.theme === 'light';
    const cardless = Boolean(state.cardless);
    el.innerHTML = \`
      <div style="display:flex;flex-direction:column;gap:8px;font-size:12px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
          <span style="font-weight:600;">原生 ESM 渲染</span>
          <span class="kbd-chip">\${isLight ? '白天' : '夜间'} · \${cardless ? '无卡片' : '卡片'}</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;">
          <div style="padding:8px;border-radius:var(--radius-sm);background:var(--pill-bg);border:1px solid var(--glass-border);text-align:center;">
            <div style="font-size:15px;font-weight:700;color:var(--brand);" class="font-mono">\${count}</div>
            <div style="font-size:10px;color:var(--ink-muted);">KV 计数</div>
          </div>
          <div style="padding:8px;border-radius:var(--radius-sm);background:var(--pill-bg);border:1px solid var(--glass-border);text-align:center;">
            <div style="font-size:15px;font-weight:700;color:var(--ok);" class="font-mono">\${String(ctx.zone || 'lan').toUpperCase()}</div>
            <div style="font-size:10px;color:var(--ink-muted);">当前网络</div>
          </div>
          <div style="padding:8px;border-radius:var(--radius-sm);background:var(--pill-bg);border:1px solid var(--glass-border);text-align:center;">
            <div style="font-size:15px;font-weight:700;color:var(--warn);" class="font-mono">ESM</div>
            <div style="font-size:10px;color:var(--ink-muted);">零沙箱开销</div>
          </div>
        </div>
        <div style="display:flex;gap:6px;">
          <button data-act="inc" style="flex:1;padding:6px 10px;border-radius:var(--radius-sm);background:var(--brand-solid);color:#fff;font-weight:500;cursor:pointer;">+1 并持久化</button>
          <button data-act="reset" style="padding:6px 10px;border-radius:var(--radius-sm);background:var(--pill-hover);border:1px solid var(--glass-border);cursor:pointer;">归零</button>
        </div>
      </div>
    \`;
    el.querySelector('[data-act="inc"]')?.addEventListener('click', async () => {
      count += 1;
      render(current);
      try { await ctx.kv.set('count', count); ctx.toast('ESM 计数已保存：' + count); } catch {}
    });
    el.querySelector('[data-act="reset"]')?.addEventListener('click', async () => {
      count = 0;
      render(current);
      try { await ctx.kv.set('count', 0); } catch {}
    });
  };

  let current = { theme: ctx.theme, cardless: ctx.cardless };
  render(current);
  ctx.kv.get('count').then((r) => {
    if (r && r.found && typeof r.value === 'number') { count = r.value; render(current); }
  }).catch(() => {});
  const off = ctx.onThemeChange((next) => { current = next; render(current); });
  return () => { off?.(); };
}`;

interface PolicyDraft {
  minRole: 'public' | 'user' | 'admin';
  guestMode: 'hidden' | 'readonly' | 'full' | 'login-prompt';
  managed: boolean;
  cardless: boolean;
  hideHeader: boolean;
}

function isCorePlugin(rec: PluginStateRecord): boolean {
  if (rec.manifest.tier === 'core') return true;
  if (rec.manifest.tier === 'light' || rec.manifest.tier === 'external') return false;
  return [
    'orbit.bookmarks',
    'orbit.search',
    'orbit.monitor',
    'orbit.clipboard',
    'orbit.transfer',
  ].includes(rec.manifest.id);
}

function isExternalPlugin(rec: PluginStateRecord): boolean {
  return rec.manifest.source === 'external' || rec.manifest.tier === 'external';
}

function effectiveMinRole(rec: PluginStateRecord): 'public' | 'user' | 'admin' {
  return rec.visibility?.minRole || rec.manifest.access.minRole;
}

function effectiveGuestMode(
  rec: PluginStateRecord,
): 'hidden' | 'readonly' | 'full' | 'login-prompt' {
  return rec.visibility?.guestMode || rec.manifest.access.guest.mode;
}

function roleLabel(role: 'public' | 'user' | 'admin'): string {
  if (role === 'public') return '所有人';
  if (role === 'admin') return '仅管理员';
  return '仅登录';
}

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

  const [editingPolicyId, setEditingPolicyId] = useState<string | null>(null);
  const [policyDraft, setPolicyDraft] = useState<PolicyDraft | null>(null);

  const corePlugins = host.plugins.filter((p) => isCorePlugin(p));
  const lightPlugins = host.plugins.filter((p) => !isCorePlugin(p));

  const handleToggle = async (rec: PluginStateRecord) => {
    if (!host.isAdmin) {
      host.toast('仅管理员可启停组件', true);
      return;
    }
    setBusyId(rec.manifest.id);
    try {
      await host.togglePlugin(rec.manifest.id, !rec.enabled);
    } finally {
      setBusyId(null);
    }
  };

  const handleOpenPolicy = (rec: PluginStateRecord) => {
    if (editingPolicyId === rec.manifest.id) {
      setEditingPolicyId(null);
      setPolicyDraft(null);
      return;
    }
    setEditingCfgId(null);
    setEditingPolicyId(rec.manifest.id);
    setPolicyDraft({
      minRole: effectiveMinRole(rec),
      guestMode: effectiveGuestMode(rec),
      managed: rec.style?.managed ?? rec.manifest.style?.managed ?? true,
      cardless: rec.style?.cardless ?? rec.manifest.style?.defaultCardless ?? false,
      hideHeader: rec.style?.hideHeader ?? rec.manifest.style?.hideHeader ?? false,
    });
  };

  const handleSavePolicy = async (rec: PluginStateRecord) => {
    if (!policyDraft) return;
    setBusyId(rec.manifest.id);
    try {
      const visibility: PluginVisibilityOverride = {
        minRole: policyDraft.minRole,
        guestMode: policyDraft.minRole === 'public' ? policyDraft.guestMode : 'hidden',
      };
      const style: PluginStyleOverride = {
        managed: policyDraft.managed,
        cardless: policyDraft.cardless,
        hideHeader: policyDraft.hideHeader,
      };
      await host.updatePluginPolicy(rec.manifest.id, { visibility, style });
      setEditingPolicyId(null);
      setPolicyDraft(null);
    } finally {
      setBusyId(null);
    }
  };

  const handleOpenConfig = (rec: PluginStateRecord) => {
    if (editingCfgId === rec.manifest.id) {
      setEditingCfgId(null);
      return;
    }
    setEditingPolicyId(null);
    setPolicyDraft(null);
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
      host.toast(`已安装：${res.manifest.name}`);
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
      host.toast(`已安装示例组件「${SAMPLE_PING_MANIFEST.name}」`);
    } catch (e) {
      host.toast((e as Error).message || '安装示例失败', true);
    } finally {
      setInstallingSample(false);
    }
  };

  const handleInstallCustom = async () => {
    if (!customManifestJson.trim()) {
      host.toast('请填写 manifest.json', true);
      return;
    }
    if (!customHtml.trim()) {
      host.toast('请填写入口文件源码', true);
      return;
    }
    try {
      const parsed = JSON.parse(customManifestJson) as PluginManifest;
      await api.installExternalPlugin(parsed, {
        [parsed.external?.entry || 'widget.html']: customHtml,
      });
      await host.refreshPlugins();
      setShowCustomForm(false);
      setCustomManifestJson('');
      setCustomHtml('');
      host.toast(`已安装：${parsed.name || parsed.id}`);
    } catch (e) {
      host.toast((e as Error).message || 'JSON 格式或参数错误', true);
    }
  };

  const handleUninstall = async (rec: PluginStateRecord) => {
    setBusyId(rec.manifest.id);
    try {
      await api.deleteExternalPlugin(rec.manifest.id);
      await host.refreshPlugins();
      host.toast(`已卸载：${rec.manifest.name}`);
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
      host.toast('已重载外部组件目录');
    } catch (e) {
      host.toast((e as Error).message || '重载失败', true);
    } finally {
      setReloading(false);
    }
  };

  const renderCard = (rec: PluginStateRecord) => {
    const m = rec.manifest;
    const isBusy = busyId === m.id;
    const external = isExternalPlugin(rec);
    const fields = m.external?.configFields || [];
    const effRole = effectiveMinRole(rec);
    const hasWidgets = Boolean(m.contributes.widgets?.length);
    const supportsCardless = m.style?.supportsCardless !== false && hasWidgets;
    const canBePublic = Boolean(m.access.allowPublic || m.access.minRole === 'public');

    const roleOptions = [
      ...(canBePublic ? [{ value: 'public', label: '所有人（含游客）' }] : []),
      { value: 'user', label: '仅登录账号' },
      { value: 'admin', label: '仅管理员' },
    ];

    const guestOptions = [
      ...(canBePublic ? [{ value: 'full', label: '游客可用' }] : []),
      ...(canBePublic ? [{ value: 'readonly', label: '游客只读' }] : []),
      { value: 'login-prompt', label: '提示登录' },
      { value: 'hidden', label: '对游客隐藏' },
    ];

    return (
      <div
        key={m.id}
        className="p-3 rounded-xl space-y-2.5"
        style={{ background: 'var(--pill-bg)', border: '1px solid var(--glass-border)' }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5 min-w-0">
            <span
              className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: 'var(--code-bg)', color: 'var(--brand)' }}
            >
              {getPluginIcon(m.icon || 'plug', 'w-4 h-4')}
            </span>
            <div className="min-w-0 space-y-0.5">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-medium text-xs">{m.name}</span>
                {!rec.enabled && (
                  <span
                    className="kbd-chip"
                    style={{
                      color: 'var(--danger)',
                      borderColor: 'rgba(239, 68, 68, 0.35)',
                      background: 'rgba(239, 68, 68, 0.12)',
                    }}
                  >
                    已禁用
                  </span>
                )}
                <span className="kbd-chip">{roleLabel(effRole)}</span>
                {external && <span className="kbd-chip">外部</span>}
                {(rec.style?.managed ?? m.style?.managed ?? true) && (
                  <span className="kbd-chip">全局样式</span>
                )}
              </div>
              {m.description && (
                <div className="text-[11px] truncate" style={{ color: 'var(--ink-muted)' }}>
                  {m.description}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {host.isAdmin && (
              <button
                type="button"
                onClick={() => handleOpenPolicy(rec)}
                className="px-2 py-1 rounded-lg flex items-center gap-1 cursor-pointer orbit-hover"
                style={{
                  background: editingPolicyId === m.id ? 'var(--brand-solid)' : 'var(--pill-hover)',
                  color: editingPolicyId === m.id ? '#fff' : 'var(--ink)',
                }}
                title="显示权限与样式管理"
              >
                <SlidersHorizontal className="w-3 h-3" />
                <span>权限/样式</span>
              </button>
            )}
            {host.isAdmin && fields.length > 0 && (
              <button
                type="button"
                onClick={() => handleOpenConfig(rec)}
                className="px-2 py-1 rounded-lg cursor-pointer orbit-hover"
                style={{ background: 'var(--pill-hover)' }}
              >
                配置
              </button>
            )}
            {host.isAdmin && external && (
              <button
                type="button"
                disabled={isBusy}
                onClick={() => void handleUninstall(rec)}
                className="p-1.5 rounded-lg orbit-hover cursor-pointer"
                style={{ color: 'var(--danger)' }}
                title="卸载"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              disabled={!host.isAdmin || isBusy}
              onClick={() => void handleToggle(rec)}
              className="px-2.5 py-1 rounded-lg font-medium text-white cursor-pointer transition-all hover:brightness-110 active:scale-95 disabled:opacity-50"
              style={{
                background: rec.enabled ? '#ef4444' : '#3b82f6',
              }}
              title={
                host.isAdmin
                  ? rec.enabled
                    ? '点击禁用此组件'
                    : '点击启用此组件'
                  : '仅管理员可操作'
              }
            >
              {isBusy ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : rec.enabled ? (
                '禁用'
              ) : (
                '启用'
              )}
            </button>
          </div>
        </div>

        {host.isAdmin && editingPolicyId === m.id && policyDraft && (
          <div
            className="pt-2.5 border-t space-y-2.5"
            style={{ borderColor: 'var(--glass-border)' }}
          >
            <div className="grid sm:grid-cols-2 gap-2">
              <div className="space-y-1">
                <div style={{ color: 'var(--ink-muted)' }}>显示权限</div>
                <OrbitSelect
                  size="sm"
                  value={policyDraft.minRole}
                  options={roleOptions}
                  onChange={(v) =>
                    setPolicyDraft((prev) =>
                      prev
                        ? {
                            ...prev,
                            minRole: v as PolicyDraft['minRole'],
                            guestMode:
                              v === 'public'
                                ? prev.guestMode === 'hidden'
                                  ? 'readonly'
                                  : prev.guestMode
                                : 'hidden',
                          }
                        : prev,
                    )
                  }
                  className="w-full"
                />
              </div>

              {policyDraft.minRole === 'public' && (
                <div className="space-y-1">
                  <div style={{ color: 'var(--ink-muted)' }}>游客权限</div>
                  <OrbitSelect
                    size="sm"
                    value={policyDraft.guestMode}
                    options={guestOptions}
                    onChange={(v) =>
                      setPolicyDraft((prev) =>
                        prev ? { ...prev, guestMode: v as PolicyDraft['guestMode'] } : prev,
                      )
                    }
                    className="w-full"
                  />
                </div>
              )}
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={policyDraft.managed}
                  onChange={(e) =>
                    setPolicyDraft((prev) => (prev ? { ...prev, managed: e.target.checked } : prev))
                  }
                  className="accent-indigo-500"
                />
                <span>接受全局样式管理</span>
              </label>

              {supportsCardless && (
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={policyDraft.cardless}
                    onChange={(e) =>
                      setPolicyDraft((prev) =>
                        prev ? { ...prev, cardless: e.target.checked } : prev,
                      )
                    }
                    className="accent-indigo-500"
                  />
                  <span>默认无卡片样式</span>
                </label>
              )}

              {external && (
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={policyDraft.hideHeader}
                    onChange={(e) =>
                      setPolicyDraft((prev) =>
                        prev ? { ...prev, hideHeader: e.target.checked } : prev,
                      )
                    }
                    className="accent-indigo-500"
                  />
                  <span>隐藏标题栏</span>
                </label>
              )}
            </div>

            <div className="flex items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setEditingPolicyId(null);
                  setPolicyDraft(null);
                }}
                className="px-2.5 h-7 rounded-lg cursor-pointer"
                style={{ background: 'var(--pill-hover)' }}
              >
                取消
              </button>
              <button
                type="button"
                disabled={isBusy}
                onClick={() => void handleSavePolicy(rec)}
                className="px-3 h-7 rounded-lg text-white font-medium flex items-center gap-1 cursor-pointer disabled:opacity-50"
                style={{ background: 'var(--brand-solid)' }}
              >
                <Check className="w-3.5 h-3.5" />
                <span>保存</span>
              </button>
            </div>
          </div>
        )}

        {host.isAdmin && editingCfgId === m.id && fields.length > 0 && (
          <div
            className="pt-2.5 border-t space-y-2"
            style={{ borderColor: 'var(--glass-border)' }}
          >
            {fields.map((f) => (
              <div key={f.key} className="space-y-1">
                <label className="block" style={{ color: 'var(--ink-muted)' }}>
                  {f.label}
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
                      background: 'var(--input-bg)',
                      border: '1px solid var(--glass-border)',
                      color: 'var(--ink)',
                    }}
                  />
                )}
              </div>
            ))}
            <button
              type="button"
              disabled={isBusy}
              onClick={() => void handleSaveConfig(m.id)}
              className="px-3 h-7 rounded-lg text-white font-medium flex items-center gap-1 cursor-pointer disabled:opacity-50"
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
            <span>核心组件 ({corePlugins.length})</span>
          </div>
          {!host.isAdmin && (
            <span className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              仅管理员可调整
            </span>
          )}
        </div>
        <div className="space-y-2">{corePlugins.map(renderCard)}</div>
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
            <span>轻量组件 ({lightPlugins.length})</span>
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
                className="px-2.5 py-1 rounded-lg flex items-center gap-1 cursor-pointer orbit-hover"
                style={{ background: 'var(--pill-hover)' }}
              >
                <Sparkles className="w-3.5 h-3.5" style={{ color: 'var(--brand)' }} />
                <span>{installingSample ? '安装中...' : '示例组件'}</span>
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
                className="px-2.5 py-1 rounded-lg flex items-center gap-1 cursor-pointer orbit-hover"
                style={{ background: 'var(--pill-bg)' }}
              >
                <PackagePlus className="w-3.5 h-3.5" />
                <span>JSON</span>
              </button>
              <button
                type="button"
                disabled={reloading}
                onClick={() => void handleReloadDir()}
                className="p-1.5 rounded-lg cursor-pointer orbit-hover"
                style={{ background: 'var(--pill-bg)' }}
                title="重载目录"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${reloading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          )}
        </div>

        {host.isAdmin && showCustomForm && (
          <div className="p-3 rounded-xl space-y-2" style={{ background: 'var(--pill-bg)' }}>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                自定义外部扩展源码
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setCustomManifestJson(JSON.stringify(SAMPLE_PING_MANIFEST, null, 2));
                    setCustomHtml(SAMPLE_PING_HTML);
                  }}
                  className="px-2 py-0.5 rounded-md text-[11px] orbit-hover cursor-pointer"
                  style={{ background: 'var(--code-bg)', color: 'var(--brand)' }}
                >
                  填入 Iframe 示例
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCustomManifestJson(JSON.stringify(SAMPLE_ESM_MANIFEST, null, 2));
                    setCustomHtml(SAMPLE_ESM_SOURCE);
                  }}
                  className="px-2 py-0.5 rounded-md text-[11px] orbit-hover cursor-pointer"
                  style={{ background: 'var(--code-bg)', color: 'var(--ok)' }}
                >
                  填入 ESM 示例
                </button>
              </div>
            </div>
            <textarea
              rows={5}
              value={customManifestJson}
              onChange={(e) => setCustomManifestJson(e.target.value)}
              placeholder="manifest.json 内容"
              className="w-full p-2.5 rounded-lg font-mono text-[11px] focus:outline-none"
              style={{
                background: 'var(--input-bg)',
                border: '1px solid var(--glass-border)',
                color: 'var(--ink)',
              }}
            />
            <textarea
              rows={5}
              value={customHtml}
              onChange={(e) => setCustomHtml(e.target.value)}
              placeholder="入口文件源码 (widget.html / widget.mjs)"
              className="w-full p-2.5 rounded-lg font-mono text-[11px] focus:outline-none"
              style={{
                background: 'var(--input-bg)',
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
              安装
            </button>
          </div>
        )}

        <div className="space-y-2">{lightPlugins.map(renderCard)}</div>
      </section>
    </div>
  );
}
