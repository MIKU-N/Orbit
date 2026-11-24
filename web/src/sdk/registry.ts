import type {
  HostAPI,
  OrbitPlugin,
  PluginStateRecord,
  ResolvedDrawer,
  ResolvedSettingsTab,
  ResolvedWidget,
  SearchSuggestion,
  SharingScopeDescriptor,
  UserSettings,
} from './types';

export function mergePluginRecords(
  codePlugins: OrbitPlugin[],
  backendRecords: PluginStateRecord[],
): PluginStateRecord[] {
  const byId = new Map<string, PluginStateRecord>();
  for (const r of backendRecords) {
    byId.set(r.manifest.id, r);
  }

  const result: PluginStateRecord[] = [];
  const seen = new Set<string>();

  for (const cp of codePlugins) {
    seen.add(cp.id);
    const server = byId.get(cp.id);
    if (server) {
      result.push(server);
    } else {
      result.push({
        manifest: cp.manifest,
        enabled: cp.manifest.defaultEnabled,
        config: {},
      });
    }
  }

  for (const r of backendRecords) {
    if (!seen.has(r.manifest.id)) {
      result.push(r);
    }
  }

  return result;
}

export function getWidgetLayoutKey(pluginId: string, widgetId: string, layoutKey?: string): string {
  return layoutKey && layoutKey.trim() ? layoutKey.trim() : `${pluginId}:${widgetId}`;
}

export function resolveWidgets(
  codePlugins: OrbitPlugin[],
  records: PluginStateRecord[],
  isGuest: boolean,
  settings: UserSettings,
): ResolvedWidget[] {
  const codeMap = new Map(codePlugins.map((p) => [p.id, p]));
  const out: ResolvedWidget[] = [];

  for (const rec of records) {
    if (!rec.enabled) continue;
    const m = rec.manifest;
    const widgets = m.contributes.widgets || [];
    if (widgets.length === 0) continue;

    if (isGuest && (m.access.guest.mode === 'hidden' || m.access.guest.mode === 'login-prompt')) {
      continue;
    }

    const code = codeMap.get(m.id);
    for (const w of widgets) {
      const key = getWidgetLayoutKey(m.id, w.id, w.layoutKey);
      const visible =
        settings.visibleItems[key] !== undefined ? Boolean(settings.visibleItems[key]) : w.defaultVisible;
      out.push({
        key,
        pluginId: m.id,
        widget: w,
        manifest: m,
        record: rec,
        visible,
        guestReadonly: isGuest && m.access.guest.mode === 'readonly',
        Component: code?.widgets?.[w.id],
      });
    }
  }

  return out;
}

export function resolveDrawers(
  codePlugins: OrbitPlugin[],
  records: PluginStateRecord[],
  isGuest: boolean,
): ResolvedDrawer[] {
  const codeMap = new Map(codePlugins.map((p) => [p.id, p]));
  const out: ResolvedDrawer[] = [];

  for (const rec of records) {
    if (!rec.enabled) continue;
    const m = rec.manifest;
    const drawers = m.contributes.drawers || [];
    if (drawers.length === 0) continue;
    if (isGuest && m.access.guest.mode === 'hidden') continue;

    const code = codeMap.get(m.id);
    for (const d of drawers) {
      out.push({
        pluginId: m.id,
        drawer: d,
        manifest: m,
        record: rec,
        guestLocked: isGuest && m.access.guest.mode === 'login-prompt',
        guestPrompt: m.access.guest.prompt,
        Component: code?.drawers?.[d.id],
      });
    }
  }

  out.sort((a, b) => a.drawer.order - b.drawer.order);
  return out;
}

export function resolveSettingsTabs(
  codePlugins: OrbitPlugin[],
  records: PluginStateRecord[],
  isGuest: boolean,
): ResolvedSettingsTab[] {
  if (isGuest) return [];
  const codeMap = new Map(codePlugins.map((p) => [p.id, p]));
  const out: ResolvedSettingsTab[] = [];

  for (const rec of records) {
    if (!rec.enabled) continue;
    const s = rec.manifest.contributes.settings;
    if (!s) continue;
    const code = codeMap.get(rec.manifest.id);
    out.push({
      tabId: s.tabId,
      pluginId: rec.manifest.id,
      label: s.label,
      icon: s.icon,
      searchKeywords: s.searchKeywords || [s.label, rec.manifest.name],
      manifest: rec.manifest,
      record: rec,
      Component: code?.settingsPanel,
    });
  }

  return out;
}

export function resolveSharingScopes(records: PluginStateRecord[]): SharingScopeDescriptor[] {
  const out: SharingScopeDescriptor[] = [
    {
      pluginId: 'core',
      scopeKey: 'appearance',
      label: '共享全局外观、壁纸、字体、布局与页脚',
      mode: 'sync',
    },
  ];
  const seen = new Set<string>(['appearance']);

  for (const rec of records) {
    const sh = rec.manifest.access.sharing;
    if (!sh || !sh.shareable || !sh.scopeKey || seen.has(sh.scopeKey)) continue;
    seen.add(sh.scopeKey);
    out.push({
      pluginId: rec.manifest.id,
      scopeKey: sh.scopeKey,
      label: sh.label,
      mode: sh.mode,
    });
  }
  return out;
}

export function collectSearchSuggestions(
  query: string,
  codePlugins: OrbitPlugin[],
  records: PluginStateRecord[],
  isGuest: boolean,
  host: HostAPI,
): SearchSuggestion[] {
  const q = query.trim();
  if (!q) return [];

  const recMap = new Map(records.map((r) => [r.manifest.id, r]));
  const activeProviders = codePlugins
    .filter((cp) => {
      if (!cp.searchProvider) return false;
      const rec = recMap.get(cp.id);
      if (!rec?.enabled) return false;
      if (!rec.manifest.contributes.searchProvider?.enabled) return false;
      if (isGuest && (rec.manifest.access.guest.mode === 'hidden' || rec.manifest.access.guest.mode === 'login-prompt')) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      const pa = recMap.get(a.id)?.manifest.contributes.searchProvider?.priority ?? 100;
      const pb = recMap.get(b.id)?.manifest.contributes.searchProvider?.priority ?? 100;
      return pa - pb;
    });

  const out: SearchSuggestion[] = [];
  for (const cp of activeProviders) {
    try {
      const items = cp.searchProvider?.(q, host) || [];
      out.push(...items);
    } catch {
      // isolate individual plugin search errors
    }
  }
  return out;
}
