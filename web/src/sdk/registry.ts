import type {
  HostAPI,
  OrbitPlugin,
  PluginManifest,
  PluginStateRecord,
  ResolvedDrawer,
  ResolvedSettingsTab,
  ResolvedWidget,
  SearchSuggestion,
  SharingScopeDescriptor,
  UserSettings,
} from './types';

function normalizeManifest(m: PluginManifest): PluginManifest {
  const tier = m.tier === 'builtin' ? 'core' : m.tier === 'external' ? 'light' : m.tier;
  const source =
    m.source ||
    (m.tier === 'external' || (tier === 'light' && Boolean(m.external)) ? 'external' : 'official');
  return {
    ...m,
    tier,
    source,
    style: {
      managed: true,
      supportsCardless: true,
      ...(m.style || {}),
    },
  };
}

export function mergePluginRecords(
  codePlugins: OrbitPlugin[],
  backendRecords: PluginStateRecord[],
): PluginStateRecord[] {
  const byId = new Map<string, PluginStateRecord>();
  for (const r of backendRecords) {
    byId.set(r.manifest.id, { ...r, manifest: normalizeManifest(r.manifest) });
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
        manifest: normalizeManifest(cp.manifest),
        enabled: cp.manifest.defaultEnabled,
        config: {},
      });
    }
  }

  for (const r of backendRecords) {
    if (!seen.has(r.manifest.id)) {
      result.push({ ...r, manifest: normalizeManifest(r.manifest) });
    }
  }

  return result;
}

export function getWidgetLayoutKey(pluginId: string, widgetId: string, layoutKey?: string): string {
  return layoutKey && layoutKey.trim() ? layoutKey.trim() : `${pluginId}:${widgetId}`;
}

export function canSeePlugin(manifest: PluginManifest, isGuest: boolean, isAdmin: boolean): boolean {
  if (isAdmin) return true;
  if (manifest.access.minRole === 'admin') return false;
  if (isGuest) {
    return manifest.access.guest.mode !== 'hidden';
  }
  return true;
}

export function resolveWidgets(
  codePlugins: OrbitPlugin[],
  records: PluginStateRecord[],
  isGuest: boolean,
  settings: UserSettings,
  isAdmin = false,
): ResolvedWidget[] {
  const codeMap = new Map(codePlugins.map((p) => [p.id, p]));
  const out: ResolvedWidget[] = [];

  for (const rec of records) {
    if (!rec.enabled) continue;
    const m = rec.manifest;
    const widgets = m.contributes.widgets || [];
    if (widgets.length === 0) continue;

    if (!isAdmin && m.access.minRole === 'admin') continue;
    if (isGuest && (m.access.guest.mode === 'hidden' || m.access.guest.mode === 'login-prompt')) {
      continue;
    }

    const code = codeMap.get(m.id);
    const defaultCardless = Boolean(m.style?.defaultCardless);

    for (const w of widgets) {
      const key = getWidgetLayoutKey(m.id, w.id, w.layoutKey);
      const visible =
        settings.visibleItems[key] !== undefined ? Boolean(settings.visibleItems[key]) : w.defaultVisible;
      const userCardless = settings.cardlessItems?.[key];
      const cardless = userCardless !== undefined ? Boolean(userCardless) : defaultCardless;

      out.push({
        key,
        pluginId: m.id,
        widget: w,
        manifest: m,
        record: rec,
        visible,
        cardless,
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
  isAdmin = false,
): ResolvedDrawer[] {
  const codeMap = new Map(codePlugins.map((p) => [p.id, p]));
  const out: ResolvedDrawer[] = [];

  for (const rec of records) {
    if (!rec.enabled) continue;
    const m = rec.manifest;
    const drawers = m.contributes.drawers || [];
    if (drawers.length === 0) continue;
    if (!isAdmin && m.access.minRole === 'admin') continue;
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
  isAdmin = false,
): ResolvedSettingsTab[] {
  if (isGuest) return [];
  const codeMap = new Map(codePlugins.map((p) => [p.id, p]));
  const out: ResolvedSettingsTab[] = [];

  for (const rec of records) {
    if (!rec.enabled) continue;
    if (!isAdmin && rec.manifest.access.minRole === 'admin') continue;
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
      label: '外观',
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
  isAdmin = false,
): SearchSuggestion[] {
  const q = query.trim();
  if (!q) return [];

  const recMap = new Map(records.map((r) => [r.manifest.id, r]));
  const activeProviders = codePlugins
    .filter((cp) => {
      if (!cp.searchProvider) return false;
      const rec = recMap.get(cp.id);
      if (!rec?.enabled) return false;
      if (!isAdmin && rec.manifest.access.minRole === 'admin') return false;
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
