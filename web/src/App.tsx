import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Square, SquareDashed, X } from 'lucide-react';
import { APIError, api, apiFetch } from './api/client';
import { AccountPopover } from './core/AccountPopover';
import { AuthScreen } from './core/AuthScreen';
import { DragUploadOverlay } from './core/DragUploadOverlay';
import { ExternalWidgetHost } from './core/ExternalWidgetHost';
import { FooterBar } from './core/FooterBar';
import { MobileCapsule } from './core/MobileCapsule';
import { NotificationStack, type OrbitNotification } from './core/NotificationStack';
import { SettingsModal } from './core/SettingsModal';
import { SlideDrawerHost } from './core/SlideDrawerHost';
import { TopBar } from './core/TopBar';
import { ZoneStatusPopover } from './core/ZoneStatusPopover';
import { useFreeLayout } from './core/useFreeLayout';
import { useOrbitWS } from './core/useOrbitWS';
import { DEFAULT_RESOURCE_CDN, resolveCdnBase } from './lib/cdn';
import { copyToClipboard } from './lib/clipboard';
import { applyGlobalFont } from './lib/fonts';
import { runThemeTransition } from './lib/themeTransition';
import { PRESET_WALLPAPERS } from './lib/wallpapers';
import { BUILTIN_PLUGINS, BookmarkModal, ShareModal } from './plugins';
import { OrbitHostProvider } from './sdk/host';
import { formatBytes, formatLimitMB, formatSpeed, getBookmarkActiveUrl } from './sdk/primitives';
import {
  collectSearchSuggestions,
  mergePluginRecords,
  resolveDrawers,
  resolveSettingsTabs,
  resolveSharingScopes,
  resolveWidgets,
} from './sdk/registry';
import type {
  HostAPI,
  PluginStyleOverride,
  PluginVisibilityOverride,
  SearchSuggestion,
} from './sdk/types';
import type {
  AuthStatus,
  BingWallpaperItem,
  Bookmark,
  BookmarkGroup,
  ClipItem,
  FilesResponse,
  FreeLayoutMap,
  NetworkZone,
  PluginStateRecord,
  PublicConfig,
  SystemMetrics,
  UserSettings,
  WeatherPayload,
} from './types';

const GUEST_THEME_KEY = 'orbit_guest_theme';
const LAST_THEME_KEY = 'orbit_last_theme';

const DEFAULT_SETTINGS: UserSettings = {
  glassTheme: 'dark',
  themeMode: 'dark',
  glassBlur: 0,
  glassBlurMode: 'pct',
  glassAlpha: 40,
  glassRadius: 10,
  bgDim: 0,
  fontConfig: {
    activeId: 'system',
    customFonts: [],
  },
  resourceCdn: DEFAULT_RESOURCE_CDN,
  wallpaperMode: 'preset',
  wallpaperPreset: 0,
  wallpaperCustom: '',
  localWallpapers: [],
  localWallpaperRotate: false,
  localWallpaperIntervalMin: 15,
  bingAuto: false,
  enableTilt: true,
  enableAnimations: true,
  showSeconds: false,
  dockStyle: 'card',
  searchIconOnly: false,
  allowGuest: true,
  weatherCity: 'Shanghai',
  weatherLabel: '上海',
  weatherConfig: {
    label: '上海',
    query: '上海',
    lat: 31.2304,
    lon: 121.4737,
    unit: 'C',
    style: 'standard',
    customText: '',
    showFeelsLike: true,
    showHumidity: true,
    showWind: false,
    showPrecip: false,
    showPressure: false,
    showHiLo: true,
    forecastDays: 2,
    refreshMinutes: 30,
  },
  hitokotoConfig: {
    mode: 'auto',
    apiUrl: '',
    types: ['a', 'd', 'i', 'k'],
    autoRotate: true,
    intervalSeconds: 30,
    showAuthor: true,
    align: 'center',
    customQuotes: [],
  },
  monitorConfig: {
    title: '',
    showNetSpeed: true,
    showSparkline: true,
    showLanIP: false,
    diskMount: '',
    columns: 3,
    metrics: ['cpu', 'ram', 'disk'],
    refreshSeconds: 3,
  },
  footer: {
    enabled: true,
    text: 'Orbit · 星轨',
    align: 'center',
    links: [],
    showPoweredBy: true,
    glassBg: false,
  },
  visibleItems: {
    clock: true,
    search: true,
    weather: true,
    monitor: true,
    hitokoto: true,
    bookmarks: true,
  },
  cardlessItems: {
    clock: true,
  },
  hasCustomLayout: false,
  layout: null,
  engines: [
    { id: 'google', name: 'Google', key: 'g', url: 'https://www.google.com/search?q={q}', color: '#4285f4', icon: 'brand:google' },
    { id: 'bing', name: 'Bing', key: 'b', url: 'https://www.bing.com/search?q={q}', color: '#00809d', icon: 'brand:bing' },
    { id: 'github', name: 'GitHub', key: 'gh', url: 'https://github.com/search?q={q}', color: '#1f2937', icon: 'brand:github' },
    { id: 'bilibili', name: 'Bilibili', key: 'bl', url: 'https://search.bilibili.com/all?keyword={q}', color: '#00aeec', icon: 'brand:bilibili' },
    { id: 'local', name: '站内', key: 's', url: '', color: '#6366f1', icon: 'brand:local' },
  ],
  activeEngineId: 'google',
};

function mergeUserSettings(raw?: Partial<UserSettings> | Partial<PublicConfig>): UserSettings {
  const s = (raw || {}) as Partial<UserSettings>;
  const hasLegacyCity = Boolean(s.weatherCity && !s.weatherConfig);
  const weatherConfig = {
    ...DEFAULT_SETTINGS.weatherConfig,
    ...(s.weatherConfig || {}),
    ...(hasLegacyCity
      ? {
          query: s.weatherCity || DEFAULT_SETTINGS.weatherConfig.query,
          label: s.weatherLabel || s.weatherCity || DEFAULT_SETTINGS.weatherConfig.label,
          lat: undefined,
          lon: undefined,
        }
      : {}),
  };

  const resolvedBlur =
    typeof s.glassBlur === 'number'
      ? s.glassBlurMode === 'pct' || s.glassBlur > 36
        ? Math.max(0, Math.min(100, Math.round(s.glassBlur)))
        : Math.max(0, Math.min(100, Math.round((s.glassBlur / 36) * 100)))
      : DEFAULT_SETTINGS.glassBlur;

  const themeMode = s.themeMode || s.glassTheme || DEFAULT_SETTINGS.themeMode;

  return {
    ...DEFAULT_SETTINGS,
    ...s,
    themeMode,
    glassBlur: resolvedBlur,
    glassBlurMode: 'pct',
    glassRadius: typeof s.glassRadius === 'number' ? s.glassRadius : DEFAULT_SETTINGS.glassRadius,
    enableAnimations:
      typeof s.enableAnimations === 'boolean'
        ? s.enableAnimations
        : DEFAULT_SETTINGS.enableAnimations,
    fontConfig: {
      activeId: s.fontConfig?.activeId || DEFAULT_SETTINGS.fontConfig.activeId,
      customFonts: Array.isArray(s.fontConfig?.customFonts) ? s.fontConfig.customFonts : [],
    },
    resourceCdn: {
      mode: s.resourceCdn?.mode || DEFAULT_SETTINGS.resourceCdn.mode,
      customUrl: typeof s.resourceCdn?.customUrl === 'string' ? s.resourceCdn.customUrl : '',
    },
    localWallpapers: Array.isArray(s.localWallpapers) ? s.localWallpapers : [],
    weatherConfig,
    hitokotoConfig: {
      ...DEFAULT_SETTINGS.hitokotoConfig,
      ...(s.hitokotoConfig || {}),
      types: Array.isArray(s.hitokotoConfig?.types)
        ? s.hitokotoConfig.types
        : DEFAULT_SETTINGS.hitokotoConfig.types,
      customQuotes: Array.isArray(s.hitokotoConfig?.customQuotes)
        ? s.hitokotoConfig.customQuotes
        : DEFAULT_SETTINGS.hitokotoConfig.customQuotes,
    },
    monitorConfig: {
      ...DEFAULT_SETTINGS.monitorConfig,
      ...(s.monitorConfig || {}),
      metrics: s.monitorConfig?.metrics?.length
        ? s.monitorConfig.metrics
        : DEFAULT_SETTINGS.monitorConfig.metrics,
    },
    footer: {
      ...DEFAULT_SETTINGS.footer,
      ...(s.footer || {}),
      links: Array.isArray(s.footer?.links) ? s.footer.links : DEFAULT_SETTINGS.footer.links,
    },
    visibleItems: {
      ...DEFAULT_SETTINGS.visibleItems,
      ...(s.visibleItems || {}),
    },
    cardlessItems: {
      ...DEFAULT_SETTINGS.cardlessItems,
      ...(s.cardlessItems || {}),
    },
    engines: s.engines?.length
      ? s.engines.map((e) => ({ ...e, icon: e.icon || '' }))
      : DEFAULT_SETTINGS.engines,
  };
}

function readGuestTheme(): 'dark' | 'light' | null {
  try {
    const v = window.localStorage.getItem(GUEST_THEME_KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

function readLastBootTheme(): 'dark' | 'light' {
  try {
    const v = window.localStorage.getItem(LAST_THEME_KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    // ignore
  }
  return 'dark';
}

const MAX_NOTIFICATIONS = 3;

export function App() {
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [splashState, setSplashState] = useState<'visible' | 'leaving' | 'gone'>('visible');
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [publicCfg, setPublicCfg] = useState<PublicConfig | null>(null);
  const [backendPlugins, setBackendPlugins] = useState<PluginStateRecord[]>([]);
  const [zone, setZone] = useState<NetworkZone>('lan');
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [systemTheme, setSystemTheme] = useState<'dark' | 'light'>(() =>
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark',
  );
  const [guestTheme, setGuestTheme] = useState<'dark' | 'light' | null>(() => readGuestTheme());
  const [groups, setGroups] = useState<BookmarkGroup[]>([]);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [clips, setClips] = useState<ClipItem[]>([]);
  const [filesData, setFilesData] = useState<FilesResponse | null>(null);
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [weather, setWeather] = useState<WeatherPayload | null>(null);
  const [bingItems, setBingItems] = useState<BingWallpaperItem[]>([]);
  const [bingIdx, setBingIdx] = useState(0);

  const [activeGroupId, setActiveGroupId] = useState<number | 'all'>('all');
  const [activeDrawer, setActiveDrawer] = useState<string | null>(null);
  const [zonePanelOpen, setZonePanelOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<string>('appearance');
  const [layoutEditing, setLayoutEditing] = useState(false);
  const [searchElevated, setSearchElevated] = useState(false);

  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authNotice, setAuthNotice] = useState<string | null>(null);

  const [bookmarkModalOpen, setBookmarkModalOpen] = useState(false);
  const [editingBookmark, setEditingBookmark] = useState<Bookmark | null>(null);
  const [shareTarget, setShareTarget] = useState<{
    kind: 'file' | 'clip';
    id: number;
    label: string;
  } | null>(null);

  const [uploadProgress, setUploadProgress] = useState<{
    fileName: string;
    percent: number;
    loaded: number;
    total: number;
    speedBps: number;
  } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [externalDragVisible, setExternalDragVisible] = useState(false);
  const [notifications, setNotifications] = useState<OrbitNotification[]>([]);

  const canvasRef = useRef<HTMLElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const saveTimerRef = useRef<number | undefined>(undefined);
  const dragCounterRef = useRef(0);
  const notifTimersRef = useRef<Map<string, number>>(new Map());
  const localClipIdsRef = useRef<Set<number>>(new Set());
  const localFileIdsRef = useRef<Set<number>>(new Set());
  const selfPeerIdRef = useRef<string>('');
  const dismissedProgressKeysRef = useRef<Set<string>>(new Set());
  const loadedRef = useRef({
    bookmarks: false,
    clips: false,
    files: false,
    weather: false,
    bing: false,
  });

  const initialShareMatch = window.location.pathname.match(/^\/s\/([A-Za-z0-9]+)$/);
  const initialShareCode = initialShareMatch ? initialShareMatch[1].toUpperCase() : undefined;

  const isAuthenticated = Boolean(auth?.authenticated && auth?.user);
  const isAdmin = Boolean(isAuthenticated && auth?.user?.role === 'admin');
  const isGuest = Boolean(
    auth && auth.initialized && !isAuthenticated && publicCfg?.allowGuest && !initialShareCode,
  );
  const canViewMonitor = Boolean(
    isAuthenticated && (auth?.user?.role === 'admin' || auth?.user?.share_scopes?.monitor),
  );

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: light)');
    if (!mq) return;
    const onChange = (e: MediaQueryListEvent) => setSystemTheme(e.matches ? 'light' : 'dark');
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  const resolvedTheme: 'dark' | 'light' = useMemo(() => {
    if (!isAuthenticated && guestTheme) return guestTheme;
    const mode = settings.themeMode || settings.glassTheme || 'dark';
    if (mode === 'auto') return systemTheme;
    return mode === 'light' ? 'light' : 'dark';
  }, [guestTheme, isAuthenticated, settings.glassTheme, settings.themeMode, systemTheme]);

  const plugins = useMemo(
    () => mergePluginRecords(BUILTIN_PLUGINS, backendPlugins),
    [backendPlugins],
  );

  const pluginEnabledMap = useMemo(
    () => new Map(plugins.map((p) => [p.manifest.id, p.enabled])),
    [plugins],
  );

  const isPluginEnabled = useCallback(
    (id: string) => pluginEnabledMap.get(id) !== false,
    [pluginEnabledMap],
  );

  const resolvedWidgets = useMemo(
    () =>
      resolveWidgets(BUILTIN_PLUGINS, plugins, isGuest, settings, isAdmin).filter(
        (w) => !(w.pluginId === 'orbit.monitor' && !canViewMonitor),
      ),
    [canViewMonitor, isAdmin, isGuest, plugins, settings],
  );

  const resolvedDrawers = useMemo(
    () => resolveDrawers(BUILTIN_PLUGINS, plugins, isGuest, isAdmin),
    [isAdmin, isGuest, plugins],
  );

  const resolvedSettingsTabs = useMemo(
    () => resolveSettingsTabs(BUILTIN_PLUGINS, plugins, isGuest, isAdmin),
    [isAdmin, isGuest, plugins],
  );

  const sharingScopes = useMemo(() => resolveSharingScopes(plugins), [plugins]);

  const cdnBase = useMemo(() => resolveCdnBase(settings.resourceCdn), [settings.resourceCdn]);

  useEffect(() => {
    if (!workspaceReady) return;
    applyGlobalFont(settings.fontConfig, settings.resourceCdn);
  }, [workspaceReady, settings.fontConfig, settings.resourceCdn]);

  const animationsEnabled = settings.enableAnimations !== false;

  useEffect(() => {
    document.documentElement.dataset.orbitAnimations = animationsEnabled ? 'on' : 'off';
    return () => {
      delete document.documentElement.dataset.orbitAnimations;
    };
  }, [animationsEnabled]);

  useEffect(() => {
    if (!workspaceReady) return;
    try {
      window.localStorage.setItem(LAST_THEME_KEY, resolvedTheme);
    } catch {
      // ignore
    }
    document.documentElement.dataset.bootTheme = resolvedTheme;
  }, [workspaceReady, resolvedTheme]);

  useEffect(() => {
    if (!workspaceReady) {
      setSplashState('visible');
      return;
    }
    if (!animationsEnabled) {
      setSplashState('gone');
      return;
    }
    setSplashState('leaving');
    const timer = window.setTimeout(() => setSplashState('gone'), 250);
    return () => window.clearTimeout(timer);
  }, [workspaceReady, animationsEnabled]);

  const appVersion = auth?.version || publicCfg?.version || '0.2.0';

  const clearNotifTimer = useCallback((id: string) => {
    const t = notifTimersRef.current.get(id);
    if (t !== undefined) {
      window.clearTimeout(t);
      notifTimersRef.current.delete(id);
    }
  }, []);

  const dismissNotification = useCallback(
    (id: string) => {
      clearNotifTimer(id);
      if (id === 'k:http-upload') dismissedProgressKeysRef.current.add('http-upload');
      if (id === 'k:p2p-transfer') dismissedProgressKeysRef.current.add('p2p-transfer');
      setNotifications((prev) => prev.filter((item) => item.id !== id));
    },
    [clearNotifTimer],
  );

  const dismissNotificationByKey = useCallback(
    (key: string) => {
      setNotifications((prev) => {
        const removed = prev.filter((item) => item.key === key);
        for (const r of removed) clearNotifTimer(r.id);
        return prev.filter((item) => item.key !== key);
      });
    },
    [clearNotifTimer],
  );

  const pushNotification = useCallback(
    (input: Omit<OrbitNotification, 'id'>, ttlMs = 2800) => {
      const id = input.key
        ? `k:${input.key}`
        : `n:${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      clearNotifTimer(id);
      if (ttlMs > 0) {
        const timer = window.setTimeout(() => {
          notifTimersRef.current.delete(id);
          setNotifications((prev) => prev.filter((x) => x.id !== id));
        }, ttlMs);
        notifTimersRef.current.set(id, timer);
      }
      setNotifications((prev) => {
        const nextItem: OrbitNotification = { ...input, id };
        const existingIdx = prev.findIndex((x) => x.id === id);
        if (existingIdx >= 0) {
          const copy = [...prev];
          copy[existingIdx] = nextItem;
          return copy;
        }
        const combined = [...prev, nextItem];
        while (combined.length > MAX_NOTIFICATIONS) {
          const evictIdx = combined.findIndex((x) => x.kind !== 'progress');
          const idxToRemove = evictIdx >= 0 ? evictIdx : 0;
          const [evicted] = combined.splice(idxToRemove, 1);
          if (evicted) clearNotifTimer(evicted.id);
        }
        return combined;
      });
    },
    [clearNotifTimer],
  );

  useEffect(() => {
    const timers = notifTimersRef.current;
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      timers.clear();
    };
  }, []);

  const showToast = useCallback(
    (msg: string, warn?: boolean) => {
      pushNotification({ kind: 'toast', msg, warn }, 2600);
    },
    [pushNotification],
  );

  const markLocalClipCreated = useCallback((id: number) => {
    localClipIdsRef.current.add(id);
    window.setTimeout(() => localClipIdsRef.current.delete(id), 8000);
  }, []);

  const markLocalFileCreated = useCallback((id: number) => {
    localFileIdsRef.current.add(id);
    window.setTimeout(() => localFileIdsRef.current.delete(id), 8000);
  }, []);

  const promptGuestLogin = useCallback(
    (msg: string) => {
      showToast(msg, true);
      setAuthNotice(msg);
      setAuthModalOpen(true);
    },
    [showToast],
  );

  const copyText = useCallback(
    async (text: string, label = '已复制'): Promise<boolean> => {
      const ok = await copyToClipboard(text);
      if (ok) {
        showToast(label);
      } else {
        showToast('复制失败，请手动选中复制', true);
      }
      return ok;
    },
    [showToast],
  );

  const openSettings = useCallback((tab = 'appearance') => {
    setAccountOpen(false);
    setZonePanelOpen(false);
    setActiveDrawer(null);
    setSettingsTab(tab);
    setSettingsModalOpen(true);
  }, []);

  const refreshClips = useCallback(async () => {
    if (!isPluginEnabled('orbit.clipboard')) return;
    try {
      const res = await api.listClips();
      setClips(res.clips);
    } catch {
      // ignore transient error
    }
  }, [isPluginEnabled]);

  const refreshFiles = useCallback(async () => {
    if (!isPluginEnabled('orbit.transfer')) return;
    try {
      const res = await api.listFiles();
      setFilesData(res);
    } catch {
      // ignore transient error
    }
  }, [isPluginEnabled]);

  const refreshBookmarks = useCallback(async () => {
    if (!isPluginEnabled('orbit.bookmarks')) return;
    const res = await api.listBookmarks();
    setGroups(res.groups);
    setBookmarks(res.bookmarks);
  }, [isPluginEnabled]);

  const refreshMetrics = useCallback(
    async (mount?: string) => {
      if (!canViewMonitor || !isPluginEnabled('orbit.monitor')) return;
      try {
        const res = await api.getSystemMetrics(mount ?? settings.monitorConfig.diskMount);
        setMetrics(res.metrics);
      } catch {
        // ignore transient error
      }
    },
    [canViewMonitor, isPluginEnabled, settings.monitorConfig.diskMount],
  );

  const fetchWeather = useCallback(
    async (wc: UserSettings['weatherConfig'], refresh = false, throwOnError = false) => {
      try {
        const w = await api.getWeather({
          lat: wc.lat,
          lon: wc.lon,
          label: wc.label,
          city: wc.query,
          stationId: wc.stationId,
          provider: wc.provider,
          caiyunToken: wc.caiyunToken,
          refresh,
        });
        setWeather(w);
      } catch (e) {
        if (throwOnError) throw e;
      }
    },
    [],
  );

  const refreshPlugins = useCallback(async () => {
    try {
      const res = await api.listPlugins();
      setBackendPlugins(res.plugins || []);
    } catch (e) {
      showToast((e as Error).message || '刷新组件列表失败', true);
    }
  }, [showToast]);

  const loadWorkspace = useCallback(async () => {
    loadedRef.current = {
      bookmarks: false,
      clips: false,
      files: false,
      weather: false,
      bing: false,
    };

    const st = await api.authStatus();

    if (!st.authenticated) {
      try {
        const pub = await api.getPublicConfig();
        const pubPlugins = pub.plugins || [];
        const mergedPub = mergePluginRecords(BUILTIN_PLUGINS, pubPlugins);
        const weatherRec = mergedPub.find((p) => p.manifest.id === 'orbit.weather');
        const weatherOn = weatherRec?.enabled !== false && weatherRec?.manifest.access.guest.mode !== 'hidden';

        if (st.initialized && pub.allowGuest) {
          const guestSettings = mergeUserSettings(pub);
          guestSettings.visibleItems = {
            ...guestSettings.visibleItems,
            clock: guestSettings.visibleItems.clock !== false,
            search: guestSettings.visibleItems.search !== false,
            weather: guestSettings.visibleItems.weather !== false,
            hitokoto: guestSettings.visibleItems.hitokoto !== false,
            monitor: false,
            bookmarks: false,
          };
          guestSettings.hasCustomLayout = false;
          guestSettings.layout = null;

          applyGlobalFont(guestSettings.fontConfig, guestSettings.resourceCdn);

          // On-demand: only load Bing wallpapers if wallpaperMode is 'bing'
          const bingItemsNext =
            guestSettings.wallpaperMode === 'bing'
              ? (await api.listBingWallpapers().catch(() => ({ items: [] as BingWallpaperItem[] }))).items || []
              : [];
          if (guestSettings.wallpaperMode === 'bing') {
            loadedRef.current.bing = true;
          }

          setAuth(st);
          setZone(st.detected_zone);
          setPublicCfg(pub);
          setBackendPlugins(pubPlugins);
          setSettings(guestSettings);
          setBingItems(bingItemsNext);
          setGroups([]);
          setBookmarks([]);
          setClips([]);
          setFilesData(null);
          setMetrics(null);
          setWorkspaceReady(true);

          // On-demand: only fetch public weather if the weather widget is visible
          if (weatherOn && guestSettings.visibleItems.weather !== false) {
            loadedRef.current.weather = true;
            void api
              .getPublicWeather()
              .then((pw) => {
                if (pw) setWeather(pw);
              })
              .catch(() => {});
          } else {
            setWeather(null);
          }
          return;
        }

        setAuth(st);
        setZone(st.detected_zone);
        setPublicCfg(pub);
        setBackendPlugins(pubPlugins);
        setWorkspaceReady(true);
      } catch {
        setAuth(st);
        setZone(st.detected_zone);
        setPublicCfg({ allowGuest: false });
        setWorkspaceReady(true);
      }
      return;
    }

    const userCanMonitor = st.user?.role === 'admin' || Boolean(st.user?.share_scopes?.monitor);

    // Phase 1: fast local settings + plugin records (prevents any flash of default/old page)
    const [pluginRes, setRes] = await Promise.all([
      api.listPlugins().catch(() => ({ plugins: [] as PluginStateRecord[] })),
      api.getSettings(),
    ]);

    const mergedRecords = mergePluginRecords(BUILTIN_PLUGINS, pluginRes.plugins || []);
    const enabled = (id: string) =>
      mergedRecords.find((r) => r.manifest.id === id)?.enabled !== false;

    const mergedSettings = mergeUserSettings(setRes.settings);
    applyGlobalFont(mergedSettings.fontConfig, mergedSettings.resourceCdn);
    document.documentElement.dataset.orbitAnimations =
      mergedSettings.enableAnimations === false ? 'off' : 'on';

    // Strict on-demand: only load resources for components that are actually visible
    const bookmarksVisibleOnBoot =
      enabled('orbit.bookmarks') && mergedSettings.visibleItems.bookmarks !== false;
    const monitorVisibleOnBoot =
      userCanMonitor && enabled('orbit.monitor') && mergedSettings.visibleItems.monitor !== false;
    const weatherVisibleOnBoot =
      enabled('orbit.weather') && mergedSettings.visibleItems.weather !== false;
    const bingNeededOnBoot = mergedSettings.wallpaperMode === 'bing';

    // Fetch only fast local data for currently visible desktop cards before revealing workspace
    const [bmRes, metricRes] = await Promise.all([
      bookmarksVisibleOnBoot
        ? api.listBookmarks().catch(() => ({ groups: [] as BookmarkGroup[], bookmarks: [] as Bookmark[] }))
        : Promise.resolve(null),
      monitorVisibleOnBoot
        ? api
            .getSystemMetrics(mergedSettings.monitorConfig.diskMount)
            .catch(() => ({ metrics: null as SystemMetrics | null }))
        : Promise.resolve(null),
    ]);

    if (bookmarksVisibleOnBoot) loadedRef.current.bookmarks = true;

    // Atomic state commit so first visible frame already has real settings, theme, layout & widgets
    setAuth(st);
    setZone(st.detected_zone);
    setPublicCfg(null);
    setAuthModalOpen(false);
    setAuthNotice(null);
    setBackendPlugins(pluginRes.plugins || []);
    setSettings(mergedSettings);
    setGroups(bmRes?.groups || []);
    setBookmarks(bmRes?.bookmarks || []);
    setClips([]);
    setFilesData(null);
    setMetrics(metricRes?.metrics || null);
    if (!weatherVisibleOnBoot) setWeather(null);
    if (!bingNeededOnBoot) setBingItems([]);
    setWorkspaceReady(true);

    // Kick off optional async network resources strictly on demand
    if (bingNeededOnBoot) {
      loadedRef.current.bing = true;
      void api
        .listBingWallpapers()
        .then((res) => setBingItems(res.items || []))
        .catch(() => {});
    }
    if (weatherVisibleOnBoot) {
      loadedRef.current.weather = true;
      void fetchWeather(mergedSettings.weatherConfig);
    }
  }, [fetchWeather]);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  const bookmarksEnabled = isPluginEnabled('orbit.bookmarks');
  const clipboardEnabled = isPluginEnabled('orbit.clipboard');
  const monitorEnabled = isPluginEnabled('orbit.monitor');
  const weatherEnabled = isPluginEnabled('orbit.weather');

  const bookmarksVisible = useMemo(
    () => resolvedWidgets.some((w) => w.key === 'bookmarks' && w.visible),
    [resolvedWidgets],
  );
  const monitorVisible = useMemo(
    () => resolvedWidgets.some((w) => w.key === 'monitor' && w.visible),
    [resolvedWidgets],
  );
  const weatherVisible = useMemo(
    () => resolvedWidgets.some((w) => w.key === 'weather' && w.visible),
    [resolvedWidgets],
  );

  // On-demand Monitor polling: only active when Monitor card is visible or Monitor settings tab is open
  const monitorActive =
    workspaceReady &&
    canViewMonitor &&
    monitorEnabled &&
    (monitorVisible || (settingsModalOpen && settingsTab === 'monitor'));
  const monitorRefreshSec = settings.monitorConfig?.refreshSeconds || 3;
  const monitorMount = settings.monitorConfig?.diskMount || '';
  useEffect(() => {
    if (!monitorActive) return;
    const fetchMetrics = () => {
      void api
        .getSystemMetrics(monitorMount)
        .then((res) => setMetrics(res.metrics))
        .catch(() => {});
    };
    fetchMetrics();
    const id = window.setInterval(fetchMetrics, Math.max(2, monitorRefreshSec) * 1000);
    return () => window.clearInterval(id);
  }, [monitorActive, monitorMount, monitorRefreshSec]);

  // On-demand Weather loading & polling: only active when Weather card is visible or Weather settings tab is open
  const weatherActive =
    workspaceReady &&
    (isAuthenticated || isGuest) &&
    weatherEnabled &&
    (weatherVisible || (settingsModalOpen && settingsTab === 'weather'));
  const weatherRefreshMin = settings.weatherConfig?.refreshMinutes || 30;
  useEffect(() => {
    if (!weatherActive) return;
    if (!loadedRef.current.weather) {
      loadedRef.current.weather = true;
      if (isAuthenticated) {
        void fetchWeather(settings.weatherConfig, false);
      } else {
        void api
          .getPublicWeather()
          .then((pw) => {
            if (pw) setWeather(pw);
          })
          .catch(() => {});
      }
    }
    const id = window.setInterval(() => {
      if (isAuthenticated) {
        void fetchWeather(settings.weatherConfig, true);
      } else {
        void api.getPublicWeather().then(setWeather).catch(() => {});
      }
    }, Math.max(5, weatherRefreshMin) * 60 * 1000);
    return () => window.clearInterval(id);
  }, [
    fetchWeather,
    isAuthenticated,
    settings.weatherConfig,
    weatherActive,
    weatherRefreshMin,
  ]);

  // On-demand Bookmarks loading when card is revealed, settings tab opens, modal opens, or search activates
  const bookmarksNeeded =
    workspaceReady &&
    isAuthenticated &&
    bookmarksEnabled &&
    (bookmarksVisible ||
      (settingsModalOpen && settingsTab === 'bookmarks') ||
      bookmarkModalOpen ||
      searchElevated);
  useEffect(() => {
    if (!bookmarksNeeded || loadedRef.current.bookmarks) return;
    loadedRef.current.bookmarks = true;
    void refreshBookmarks().catch(() => {});
  }, [bookmarksNeeded, refreshBookmarks]);

  // On-demand Clipboard loading when drawer / zone panel / search opens
  const clipsNeeded =
    workspaceReady &&
    isAuthenticated &&
    clipboardEnabled &&
    (activeDrawer === 'clipboard' || zonePanelOpen || searchElevated);
  useEffect(() => {
    if (!clipsNeeded || loadedRef.current.clips) return;
    loadedRef.current.clips = true;
    void refreshClips();
  }, [clipsNeeded, refreshClips]);

  // On-demand Transfer files loading when drawer / zone panel / file manager / search opens
  const transferNeeded =
    workspaceReady &&
    isAuthenticated &&
    isPluginEnabled('orbit.transfer') &&
    (activeDrawer === 'files' ||
      zonePanelOpen ||
      (settingsModalOpen && settingsTab === 'files') ||
      searchElevated);
  useEffect(() => {
    if (!transferNeeded || loadedRef.current.files) return;
    loadedRef.current.files = true;
    void refreshFiles();
  }, [transferNeeded, refreshFiles]);

  // On-demand Bing wallpaper loading only when Bing wallpaper mode is active
  useEffect(() => {
    if (!workspaceReady || settings.wallpaperMode !== 'bing' || loadedRef.current.bing) return;
    loadedRef.current.bing = true;
    void api
      .listBingWallpapers()
      .then((res) => setBingItems(res.items || []))
      .catch(() => {});
  }, [workspaceReady, settings.wallpaperMode]);

  const { peers, selfPeerId, wsConnected, p2pProgress, sendFileP2P } = useOrbitWS({
    enabled: workspaceReady && isAuthenticated && (clipboardEnabled || isPluginEnabled('orbit.transfer')),
    onClipsChanged: (ev) => {
      void refreshClips();
      const shouldNotify =
        ev?.action === 'created' &&
        Boolean(ev.clip) &&
        ev.notify !== false &&
        (!ev.sender_peer_id || ev.sender_peer_id !== selfPeerIdRef.current) &&
        (!ev.target_peer_id || ev.target_peer_id === selfPeerIdRef.current) &&
        !localClipIdsRef.current.has(ev.clip!.id);

      if (shouldNotify && ev?.clip) {
        const clip = ev.clip;
        pushNotification(
          {
            kind: 'clipboard',
            title: ev.target_peer_id ? '收到定向剪贴板' : '收到新剪贴板',
            meta: `${clip.device || '其他设备'}`,
            msg: clip.content || '新剪贴板内容',
            imageUrl: clip.kind === 'image' ? clip.image_path : undefined,
            copyValue: clip.kind !== 'image' ? clip.content : undefined,
            drawerTarget: 'clipboard',
          },
          6000,
        );
      }
    },
    onFilesChanged: (ev) => {
      void refreshFiles();
      const shouldNotify =
        ev?.action === 'created' &&
        Boolean(ev.file) &&
        ev.notify !== false &&
        (!ev.sender_peer_id || ev.sender_peer_id !== selfPeerIdRef.current) &&
        (!ev.target_peer_id || ev.target_peer_id === selfPeerIdRef.current) &&
        !localFileIdsRef.current.has(ev.file!.id);

      if (shouldNotify && ev?.file) {
        const f = ev.file;
        pushNotification(
          {
            kind: 'file',
            title: ev.target_peer_id ? '收到定向文件' : '收到新文件',
            meta: `${formatBytes(f.size_bytes)} · ${f.zone.toUpperCase()}`,
            msg: f.orig_name,
            downloadUrl: `/api/files/${f.id}/download`,
            drawerTarget: 'files',
          },
          6000,
        );
      }
    },
    onP2PComplete: (info) => {
      dismissNotificationByKey('p2p-transfer');
      pushNotification(
        {
          kind: 'file',
          title: info.direction === 'receive' ? 'P2P 接收完成' : 'P2P 直传完成',
          meta: `${formatBytes(info.sizeBytes)} · ${formatSpeed(info.speedBps)}`,
          msg: info.fileName,
          drawerTarget: 'files',
        },
        5000,
      );
    },
  });

  useEffect(() => {
    selfPeerIdRef.current = selfPeerId;
  }, [selfPeerId]);

  useEffect(() => {
    if (!p2pProgress) {
      dismissedProgressKeysRef.current.delete('p2p-transfer');
      dismissNotificationByKey('p2p-transfer');
      return;
    }
    if (activeDrawer === 'files' || dismissedProgressKeysRef.current.has('p2p-transfer')) {
      dismissNotificationByKey('p2p-transfer');
      return;
    }
    pushNotification(
      {
        key: 'p2p-transfer',
        kind: 'progress',
        title: p2pProgress.direction === 'receive' ? '正在 P2P 接收' : '正在 P2P 发送',
        msg: p2pProgress.fileName,
        drawerTarget: 'files',
        progress: {
          direction: p2pProgress.direction,
          percent: p2pProgress.percent,
          speedBps: p2pProgress.speedBps,
          transferredBytes: p2pProgress.transferredBytes,
          totalBytes: p2pProgress.totalBytes,
        },
      },
      0,
    );
  }, [activeDrawer, dismissNotificationByKey, p2pProgress, pushNotification]);

  useEffect(() => {
    if (!uploadProgress) {
      dismissedProgressKeysRef.current.delete('http-upload');
      dismissNotificationByKey('http-upload');
      return;
    }
    if (activeDrawer === 'files' || dismissedProgressKeysRef.current.has('http-upload')) {
      dismissNotificationByKey('http-upload');
      return;
    }
    pushNotification(
      {
        key: 'http-upload',
        kind: 'progress',
        title: '正在上传文件',
        msg: uploadProgress.fileName,
        drawerTarget: 'files',
        progress: {
          direction: 'upload',
          percent: uploadProgress.percent,
          speedBps: uploadProgress.speedBps,
          transferredBytes: uploadProgress.loaded,
          totalBytes: uploadProgress.total,
        },
      },
      0,
    );
  }, [activeDrawer, dismissNotificationByKey, pushNotification, uploadProgress]);

  const persistSettings = useCallback(
    (next: UserSettings) => {
      if (!isAuthenticated) return;
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => {
        void api.putSettings(next).catch((e) => {
          showToast((e as Error).message || '保存设置失败', true);
        });
      }, 450);
    },
    [isAuthenticated, showToast],
  );

  const updateSettings = useCallback(
    (patchOrUpdater: Partial<UserSettings> | ((prev: UserSettings) => UserSettings)) => {
      setSettings((prev) => {
        const next =
          typeof patchOrUpdater === 'function'
            ? patchOrUpdater(prev)
            : { ...prev, ...patchOrUpdater };
        persistSettings(next);
        return next;
      });
    },
    [persistSettings],
  );

  const toggleDayNight = useCallback(
    (ev?: React.MouseEvent<HTMLElement>) => {
      const next: 'dark' | 'light' = resolvedTheme === 'dark' ? 'light' : 'dark';
      runThemeTransition(
        () => {
          if (!isAuthenticated) {
            setGuestTheme(next);
            try {
              window.localStorage.setItem(GUEST_THEME_KEY, next);
            } catch {
              // ignore storage restrictions
            }
          } else {
            updateSettings({ themeMode: next, glassTheme: next });
          }
        },
        ev,
        next,
      );
    },
    [isAuthenticated, resolvedTheme, updateSettings],
  );

  const isWidgetCardless = useCallback(
    (key: string, defaultCardless = false): boolean => {
      const explicit = settings.cardlessItems?.[key];
      if (typeof explicit === 'boolean') return explicit;
      const rw = resolvedWidgets.find((w) => w.key === key);
      if (rw) return rw.cardless;
      return defaultCardless;
    },
    [resolvedWidgets, settings.cardlessItems],
  );

  const toggleWidgetCardless = useCallback(
    (key: string, defaultCardless = false) => {
      const cur = isWidgetCardless(key, defaultCardless);
      updateSettings((prev) => ({
        ...prev,
        cardlessItems: {
          ...(prev.cardlessItems || {}),
          [key]: !cur,
        },
      }));
    },
    [isWidgetCardless, updateSettings],
  );

  const localWps = settings.localWallpapers || [];
  useEffect(() => {
    if (!settings.localWallpaperRotate || localWps.length < 2) return;
    const mins = settings.localWallpaperIntervalMin || 15;
    const id = window.setInterval(() => {
      setSettings((prev) => {
        const list = prev.localWallpapers || [];
        if (list.length < 2) return prev;
        const curIdx = list.findIndex((x) => x.url === prev.wallpaperCustom);
        const nextIdx = curIdx >= 0 ? (curIdx + 1) % list.length : 0;
        const next = {
          ...prev,
          wallpaperMode: 'local' as const,
          wallpaperCustom: list[nextIdx].url,
        };
        if (isAuthenticated) persistSettings(next);
        return next;
      });
    }, Math.max(1, mins) * 60 * 1000);
    return () => window.clearInterval(id);
  }, [
    isAuthenticated,
    localWps.length,
    persistSettings,
    settings.localWallpaperIntervalMin,
    settings.localWallpaperRotate,
  ]);

  const togglePlugin = useCallback(
    async (id: string, enabled: boolean) => {
      try {
        const res = await api.updatePlugin(id, { enabled });
        setBackendPlugins(res.plugins || []);
        const rec = (res.plugins || []).find((p) => p.manifest.id === id);
        const label = rec?.manifest.name || id;
        showToast(`${enabled ? '已启用' : '已禁用'}：${label}`);

        if (enabled) {
          if (id === 'orbit.bookmarks') loadedRef.current.bookmarks = false;
          if (id === 'orbit.clipboard') loadedRef.current.clips = false;
          if (id === 'orbit.transfer') loadedRef.current.files = false;
          if (id === 'orbit.weather') loadedRef.current.weather = false;
        } else {
          if (id === 'orbit.clipboard' && activeDrawer === 'clipboard') setActiveDrawer(null);
          if (id === 'orbit.transfer' && activeDrawer === 'files') setActiveDrawer(null);
          if (id === 'orbit.bookmarks') setBookmarkModalOpen(false);
        }
      } catch (e) {
        showToast((e as Error).message || '更新组件状态失败', true);
      }
    },
    [activeDrawer, showToast],
  );

  const savePluginConfig = useCallback(
    async (id: string, config: Record<string, unknown>) => {
      try {
        const res = await api.updatePlugin(id, { config });
        setBackendPlugins(res.plugins || []);
        showToast('已保存组件配置');
      } catch (e) {
        showToast((e as Error).message || '保存配置失败', true);
      }
    },
    [showToast],
  );

  const updatePluginPolicy = useCallback(
    async (
      id: string,
      patch: { visibility?: PluginVisibilityOverride; style?: PluginStyleOverride },
    ) => {
      try {
        const res = await api.updatePlugin(id, patch);
        setBackendPlugins(res.plugins || []);
        showToast('已保存组件权限与样式');
      } catch (e) {
        showToast((e as Error).message || '保存组件策略失败', true);
      }
    },
    [showToast],
  );

  const handlePersistLayout = useCallback(
    (nextLayout: {
      hasCustomLayout: boolean;
      layout: FreeLayoutMap | null;
      visibleItems: Record<string, boolean>;
    }) => {
      updateSettings(nextLayout);
    },
    [updateSettings],
  );

  const {
    snap,
    setSnap,
    guideV,
    guideH,
    draggingId,
    resizingDim,
    startDragItem,
    startResizeItem,
    resetItemHeight,
  } = useFreeLayout({
    canvasRef,
    widgets: resolvedWidgets,
    settings,
    layoutEditing: layoutEditing && isAuthenticated,
    onPersistLayout: handlePersistLayout,
    depsKey: [
      isGuest ? 'guest' : 'auth',
      canViewMonitor ? 'mon' : 'nomon',
      resolvedWidgets.map((w) => `${w.key}:${w.visible}:${w.cardless}`).join(','),
      bookmarks.length,
      activeGroupId,
      settings.dockStyle,
      Boolean(weather),
      Boolean(metrics),
      settings.monitorConfig.metrics.join(','),
      settings.monitorConfig.columns,
      settings.weatherConfig.forecastDays,
      settings.weatherConfig.style || 'standard',
      settings.weatherConfig.customText || '',
      settings.hitokotoConfig.showAuthor ? 'ha' : 'nha',
      settings.searchIconOnly,
      settings.footer.enabled ? 'fe' : 'nfe',
      settings.footer.links.length,
    ].join('-'),
  });

  const transferEnabled = isPluginEnabled('orbit.transfer');

  const uploadFiles = useCallback(
    async (
      fileList: FileList | File[],
      opts?: { ttlHours?: number; permanent?: boolean; targetPeerId?: string; openPopover?: boolean },
    ) => {
      if (!transferEnabled) {
        showToast('文件快传组件已禁用', true);
        return;
      }
      if (!isAuthenticated) {
        promptGuestLogin('上传文件需要登录后使用');
        return;
      }
      const files = Array.from(fileList);
      if (!files.length) return;
      if (opts?.openPopover !== false) {
        setAccountOpen(false);
        setZonePanelOpen(false);
        setActiveDrawer('files');
      }
      setUploadError(null);

      for (const file of files) {
        dismissedProgressKeysRef.current.delete('http-upload');
        const initProg = {
          fileName: file.name,
          percent: 0,
          loaded: 0,
          total: file.size,
          speedBps: 0,
        };
        setUploadProgress(initProg);
        let uploadFinished = false;
        try {
          const uploaded = await api.uploadFileWithProgress(
            file,
            opts?.ttlHours ?? 24,
            (prog) => {
              if (uploadFinished) return;
              setUploadProgress({ fileName: file.name, ...prog });
            },
            {
              permanent: opts?.permanent,
              targetPeerId: opts?.targetPeerId,
            },
          );
          uploadFinished = true;
          setUploadProgress(null);
          dismissNotificationByKey('http-upload');
          if (uploaded.file?.id) {
            markLocalFileCreated(uploaded.file.id);
          }
          await refreshFiles();
          showToast(`已上传：${file.name}`);
        } catch (e) {
          uploadFinished = true;
          setUploadProgress(null);
          dismissNotificationByKey('http-upload');
          if (e instanceof APIError && e.status === 413) {
            const errZone = String(e.data.zone || zone).toUpperCase();
            const errLimitMB = Number(e.data.limit_mb ?? 0);
            const msg =
              errLimitMB > 0
                ? `当前为 ${errZone} 访问，单文件限 ${formatLimitMB(errLimitMB)}`
                : `当前为 ${errZone} 访问，文件超过允许大小限制`;
            setUploadError(msg);
            showToast(msg, true);
          } else {
            showToast((e as Error).message || '上传失败', true);
          }
        } finally {
          uploadFinished = true;
          dismissNotificationByKey('http-upload');
          setUploadProgress(null);
        }
      }
    },
    [
      dismissNotificationByKey,
      isAuthenticated,
      markLocalFileCreated,
      promptGuestLogin,
      refreshFiles,
      showToast,
      transferEnabled,
      zone,
    ],
  );

  useEffect(() => {
    if ((!isAuthenticated && !isGuest) || !transferEnabled) return;
    const onEnter = (e: DragEvent) => {
      if (layoutEditing) return;
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) {
        dragCounterRef.current += 1;
        if (isAuthenticated) setExternalDragVisible(true);
      }
    };
    const onLeave = () => {
      dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
      if (dragCounterRef.current === 0) setExternalDragVisible(false);
    };
    const onOver = (e: DragEvent) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) {
        e.preventDefault();
      }
    };
    const onDrop = (e: DragEvent) => {
      if (e.dataTransfer?.files?.length) {
        e.preventDefault();
        dragCounterRef.current = 0;
        setExternalDragVisible(false);
        void uploadFiles(e.dataTransfer.files);
      } else {
        dragCounterRef.current = 0;
        setExternalDragVisible(false);
      }
    };

    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [isAuthenticated, isGuest, layoutEditing, transferEnabled, uploadFiles]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (e.key === 'Escape') {
        setLayoutEditing(false);
        setActiveDrawer(null);
        setZonePanelOpen(false);
        setAccountOpen(false);
        setSettingsModalOpen(false);
        setAuthModalOpen(false);
        setBookmarkModalOpen(false);
        setShareTarget(null);
        return;
      }
      if (inInput || settingsModalOpen || authModalOpen) return;
      if (e.key === '/') {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (e.key.toLowerCase() === 'e' && isAuthenticated) {
        if (window.innerWidth >= 768) {
          setLayoutEditing((v) => !v);
        }
        return;
      }

      const keyLower = e.key.toLowerCase();
      const matchedDrawer = resolvedDrawers.find(
        (d) => d.drawer.shortcut && d.drawer.shortcut.toLowerCase() === keyLower,
      );
      if (matchedDrawer) {
        if (matchedDrawer.guestLocked) {
          promptGuestLogin(matchedDrawer.guestPrompt || `${matchedDrawer.drawer.title}需要登录后使用`);
        } else {
          setAccountOpen(false);
          setZonePanelOpen(false);
          setActiveDrawer((cur) =>
            cur === matchedDrawer.drawer.id ? null : matchedDrawer.drawer.id,
          );
        }
      }
    };

    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('#accountPanel') && !target.closest('#accountTrigger')) {
        setAccountOpen(false);
      }
      if (!target.closest('#zonePanel') && !target.closest('#zoneTrigger')) {
        setZonePanelOpen(false);
      }
      if (
        !target.closest('#drawerPopover') &&
        !target.closest('#mobileCapsule') &&
        !target.closest('#notificationStack') &&
        !target.closest('[data-drawer-trigger]') &&
        !target.closest('[role="listbox"]') &&
        !target.closest('.orbit-select-trigger') &&
        !target.closest('.orbit-modal-shell')
      ) {
        setActiveDrawer(null);
      }
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('click', onDocClick);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('click', onDocClick);
    };
  }, [authModalOpen, isAuthenticated, promptGuestLogin, resolvedDrawers, settingsModalOpen]);

  const cycleZone = useCallback(() => {
    const order: NetworkZone[] = ['lan', 'tailscale', 'wan'];
    const next = order[(order.indexOf(zone) + 1) % order.length];
    setZone(next);
    showToast({ lan: '局域网', tailscale: 'Tailscale', wan: '外网' }[next]);
  }, [showToast, zone]);

  const handleOpenBookmark = useCallback(
    (bm: Bookmark) => {
      const url = getBookmarkActiveUrl(bm, zone);
      if (!url) {
        showToast('该服务仅内网可达，请切回局域网或 Tailscale', true);
        return;
      }
      window.open(url, '_blank', 'noopener,noreferrer');
    },
    [showToast, zone],
  );

  const handleNextBing = useCallback(() => {
    if (bingItems.length > 0) {
      setBingIdx((i) => (i + 1) % bingItems.length);
      updateSettings({ wallpaperMode: 'bing', localWallpaperRotate: false });
      return;
    }
    if (settings.bingAuto || settings.wallpaperMode === 'bing') {
      loadedRef.current.bing = true;
      void api
        .listBingWallpapers()
        .then((res) => {
          const list = res.items || [];
          if (list.length > 0) {
            setBingItems(list);
            setBingIdx(0);
            updateSettings({ wallpaperMode: 'bing', localWallpaperRotate: false });
          } else {
            const nextPreset = (settings.wallpaperPreset + 1) % PRESET_WALLPAPERS.length;
            updateSettings({ wallpaperMode: 'preset', wallpaperPreset: nextPreset });
          }
        })
        .catch(() => {
          const nextPreset = (settings.wallpaperPreset + 1) % PRESET_WALLPAPERS.length;
          updateSettings({ wallpaperMode: 'preset', wallpaperPreset: nextPreset });
        });
      return;
    }
    const nextPreset = (settings.wallpaperPreset + 1) % PRESET_WALLPAPERS.length;
    updateSettings({ wallpaperMode: 'preset', wallpaperPreset: nextPreset });
  }, [bingItems.length, settings.bingAuto, settings.wallpaperMode, settings.wallpaperPreset, updateSettings]);

  const handleNextLocalWallpaper = useCallback(() => {
    if (localWps.length === 0) return;
    const curIdx = localWps.findIndex((x) => x.url === settings.wallpaperCustom);
    const nextIdx = curIdx >= 0 ? (curIdx + 1) % localWps.length : 0;
    updateSettings({
      wallpaperMode: 'local',
      wallpaperCustom: localWps[nextIdx].url,
      bingAuto: false,
    });
  }, [localWps, settings.wallpaperCustom, updateSettings]);

  const handleUploadWallpaper = useCallback(
    async (file: File) => {
      try {
        const res = await api.uploadCustomWallpaper(file);
        updateSettings((prev) => ({
          ...prev,
          wallpaperMode: 'local',
          wallpaperCustom: res.url,
          bingAuto: false,
          localWallpapers: [
            ...(prev.localWallpapers || []),
            {
              id: `lw_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              name: file.name,
              url: res.url,
            },
          ],
        }));
        showToast('已添加并应用壁纸');
      } catch (e) {
        showToast((e as Error).message || '上传壁纸失败', true);
      }
    },
    [showToast, updateSettings],
  );

  const handleDeleteLocalWallpaper = useCallback(
    async (url: string) => {
      try {
        if (url.startsWith('/api/wallpaper/custom/')) {
          const name = url.split('/').pop() || '';
          if (name) await api.deleteCustomWallpaper(name);
        }
        updateSettings((prev) => {
          const remaining = (prev.localWallpapers || []).filter((x) => x.url !== url);
          const nextCustom =
            prev.wallpaperCustom === url ? remaining[0]?.url || '' : prev.wallpaperCustom;
          return {
            ...prev,
            localWallpapers: remaining,
            wallpaperCustom: nextCustom,
            localWallpaperRotate: remaining.length < 2 ? false : prev.localWallpaperRotate,
            wallpaperMode:
              prev.wallpaperMode === 'local' && remaining.length === 0
                ? prev.bingAuto
                  ? 'bing'
                  : 'preset'
                : prev.wallpaperMode,
          };
        });
        showToast('已删除壁纸');
      } catch (e) {
        showToast((e as Error).message || '删除壁纸失败', true);
      }
    },
    [showToast, updateSettings],
  );

  const startLayoutEdit = useCallback(() => {
    if (isGuest) return;
    if (window.innerWidth < 768) {
      showToast('请在宽屏桌面视图下拖拽布局', true);
      return;
    }
    setActiveDrawer(null);
    setLayoutEditing(true);
    showToast('拖动组件调整位置，拖边缘或右下角自由调整大小');
  }, [isGuest, showToast]);

  const resetLayout = useCallback(() => {
    const nextVis: Record<string, boolean> = { ...DEFAULT_SETTINGS.visibleItems };
    for (const rw of resolvedWidgets) {
      nextVis[rw.key] = rw.widget.defaultVisible;
    }
    updateSettings({
      hasCustomLayout: false,
      layout: null,
      visibleItems: nextVis,
    });
    showToast('已重置布局');
  }, [resolvedWidgets, showToast, updateSettings]);

  const hostRef = useRef<HostAPI | null>(null);

  const host: HostAPI = {
    appVersion,
    authInitialized: Boolean(auth?.initialized),
    authenticated: isAuthenticated,
    user: auth?.user || null,
    isGuest,
    isAdmin,
    canViewMonitor,
    zone,
    detectedZone: auth?.detected_zone || 'lan',
    clientIp: auth?.client_ip || '',
    setZone,
    cycleZone,
    limits: auth?.limits || { lan_mb: 0, ts_mb: 2048, wan_mb: 100 },
    publicConfig: publicCfg,

    settings,
    cdnBase,
    resolvedTheme,
    toggleDayNight,
    updateSettings,
    isWidgetCardless,
    toggleWidgetCardless,
    layoutEditing: layoutEditing && !isGuest,
    setLayoutEditing,
    startLayoutEdit,
    resetLayout,

    plugins,
    resolvedWidgets,
    resolvedDrawers,
    resolvedSettingsTabs,
    sharingScopes,
    isPluginEnabled,
    refreshPlugins,
    togglePlugin,
    savePluginConfig,
    updatePluginPolicy,

    activeDrawer,
    openDrawer: (drawerId) => {
      setAccountOpen(false);
      setZonePanelOpen(false);
      setActiveDrawer(drawerId);
    },
    settingsOpen: settingsModalOpen,
    settingsInitialTab: settingsTab,
    openSettings,
    closeSettings: () => setSettingsModalOpen(false),
    openLogin: () => {
      setAuthNotice(null);
      setAuthModalOpen(true);
    },
    promptGuestLogin,
    toast: showToast,
    copyText,
    rotateToken: async () => {
      try {
        const res = await api.rotateToken();
        setAuth((prev) =>
          prev && prev.user
            ? { ...prev, user: { ...prev.user, api_token: res.api_token } }
            : prev,
        );
        showToast('已重置 API Token');
      } catch (e) {
        showToast((e as Error).message || '重置 Token 失败', true);
        throw e;
      }
    },
    uploadAvatar: async (file) => {
      try {
        const res = await api.uploadAvatar(file);
        setAuth((prev) =>
          prev && prev.user
            ? { ...prev, user: { ...prev.user, avatar: res.avatar } }
            : prev,
        );
        showToast('头像已更新');
      } catch (e) {
        showToast((e as Error).message || '上传头像失败', true);
        throw e;
      }
    },
    deleteAvatar: async () => {
      try {
        await api.deleteAvatar();
        setAuth((prev) =>
          prev && prev.user
            ? { ...prev, user: { ...prev.user, avatar: '' } }
            : prev,
        );
        showToast('已恢复默认头像');
      } catch (e) {
        showToast((e as Error).message || '重置头像失败', true);
        throw e;
      }
    },

    searchInputRef,
    searchElevated,
    setSearchElevated,

    bookmarks,
    bookmarkGroups: groups,
    activeGroupId,
    setActiveGroupId,
    refreshBookmarks,
    openBookmarkModal: (bm) => {
      setEditingBookmark(bm ?? null);
      setBookmarkModalOpen(true);
    },
    openBookmark: handleOpenBookmark,
    saveBookmark: async (payload, editingId) => {
      if (editingId) {
        await api.updateBookmark(editingId, payload);
        showToast('已更新书签');
      } else {
        await api.createBookmark(payload);
        showToast('已添加书签');
      }
      await refreshBookmarks();
    },
    deleteBookmark: async (id) => {
      await api.deleteBookmark(id);
      await refreshBookmarks();
      showToast('已删除书签');
    },
    batchDeleteBookmarks: async (ids) => {
      if (!ids.length) return;
      const res = await api.batchDeleteBookmarks(ids);
      await refreshBookmarks();
      showToast(`已删除 ${res.deleted} 条书签`);
    },
    batchMoveBookmarks: async (ids, groupId) => {
      if (!ids.length) return;
      const res = await api.batchMoveBookmarks(ids, groupId);
      await refreshBookmarks();
      showToast(`已移动 ${res.moved} 条书签`);
    },
    reorderBookmarks: (ids) => {
      const map = new Map(bookmarks.map((b) => [b.id, b]));
      const reordered = ids.map((id) => map.get(id)).filter((x): x is Bookmark => Boolean(x));
      setBookmarks(reordered);
      void api.reorderBookmarks(ids).catch((e) => {
        showToast((e as Error).message || '保存排序失败', true);
      });
    },
    createGroup: async (name) => {
      const res = await api.createGroup(name);
      await refreshBookmarks();
      showToast(`已新建分组「${res.group.name}」`);
      return res.group;
    },
    updateGroup: async (id, name) => {
      await api.updateGroup(id, name);
      await refreshBookmarks();
      showToast('已重命名分组');
    },
    deleteGroup: async (id) => {
      await api.deleteGroup(id);
      if (activeGroupId === id) setActiveGroupId('all');
      await refreshBookmarks();
      showToast('已删除分组');
    },
    importSunPanel: async (rawJson) => {
      try {
        const res = await api.importSunPanel(rawJson);
        await refreshBookmarks();
        showToast(`成功导入 ${res.imported} 条书签`);
        return true;
      } catch (e) {
        showToast((e as Error).message || '导入失败', true);
        return false;
      }
    },
    importBrowserBookmarks: async (html, groupName) => {
      try {
        const res = await api.importBrowserBookmarks(html, groupName);
        await refreshBookmarks();
        setActiveGroupId(res.group_id);
        showToast(`成功导入 ${res.imported} 条书签到「${res.group_name}」`);
        return true;
      } catch (e) {
        showToast((e as Error).message || '导入失败', true);
        return false;
      }
    },

    clips,
    refreshClips,
    markLocalClipCreated,

    filesData,
    refreshFiles,
    uploadFiles,
    uploadProgress,
    uploadError,
    clearUploadError: () => setUploadError(null),
    openShareModal: (target) => setShareTarget(target),

    bingItems,
    onNextBing: handleNextBing,
    onNextLocalWallpaper: handleNextLocalWallpaper,
    onUploadWallpaper: (f) => void handleUploadWallpaper(f),
    onDeleteLocalWallpaper: (url) => void handleDeleteLocalWallpaper(url),

    weather,
    refreshWeather: async (override, refresh = true) => {
      const merged = { ...settings.weatherConfig, ...(override || {}) };
      await fetchWeather(merged, refresh, true);
    },

    metrics,
    refreshMetrics: () => refreshMetrics(),

    peers,
    selfPeerId,
    wsConnected,
    p2pProgress,
    sendFileP2P,

    searchAcrossPlugins: (q: string): SearchSuggestion[] => {
      const h = hostRef.current || host;
      return collectSearchSuggestions(q, BUILTIN_PLUGINS, plugins, isGuest, h, isAdmin);
    },
    resolveUrl: (bm: Bookmark) => getBookmarkActiveUrl(bm, zone),
    apiFetch,
  };
  hostRef.current = host;

  const renderBootSplash = (state: 'visible' | 'leaving') => {
    const bootTheme = workspaceReady ? resolvedTheme : readLastBootTheme();
    const isLight = bootTheme === 'light';
    return (
      <div
        className="orbit-boot-splash"
        data-state={state}
        aria-label="正在加载 Orbit"
        style={{
          background: isLight
            ? 'radial-gradient(circle at 50% 38%, rgba(99, 102, 241, 0.14), transparent 58%), #eef2ff'
            : 'radial-gradient(circle at 50% 38%, rgba(99, 102, 241, 0.16), transparent 58%), #060b19',
          color: isLight ? '#0f172a' : '#f8fafc',
        }}
      >
        <div className="relative w-[76px] h-[76px] flex items-center justify-center">
          <span
            className="orbit-boot-ring-outer absolute inset-0 rounded-full"
            style={{
              border: '1.5px solid rgba(129, 140, 248, 0.22)',
              borderTopColor: '#818cf8',
            }}
          />
          <span
            className="orbit-boot-ring-inner absolute inset-[9px] rounded-full"
            style={{
              border: '1.5px solid rgba(56, 189, 248, 0.18)',
              borderBottomColor: '#38bdf8',
            }}
          />
          <img
            src="/apple-touch-icon.png"
            alt="Orbit"
            className="w-[38px] h-[38px] rounded-[12px] shadow-lg select-none"
          />
        </div>
        <div className="text-[13px] font-semibold tracking-wider opacity-90">Orbit · 星轨</div>
        <div
          className="w-32 h-[3px] rounded-full overflow-hidden"
          style={{ background: 'rgba(148, 163, 184, 0.2)' }}
        >
          <div
            className="orbit-boot-bar-sweep w-[45%] h-full rounded-full"
            style={{
              background: 'linear-gradient(90deg, transparent, #6366f1, #38bdf8, transparent)',
            }}
          />
        </div>
      </div>
    );
  };

  if (!workspaceReady || !auth || (!isAuthenticated && publicCfg === null)) {
    return renderBootSplash('visible');
  }

  if (!isAuthenticated && !isGuest) {
    return (
      <>
        <AuthScreen
          initialized={auth.initialized}
          initialShareCode={initialShareCode}
          theme={resolvedTheme}
          onToggleTheme={toggleDayNight}
          onAuthenticated={loadWorkspace}
          onToast={showToast}
        />
        <div
          data-glass={resolvedTheme}
          className="orbit-shell fixed top-4 left-1/2 -translate-x-1/2 z-[70] flex flex-col items-center gap-2 pointer-events-none w-full max-w-sm px-4"
        >
          {notifications.map((t) => (
            <div
              key={t.id}
              className="pointer-events-auto glass-strong rounded-full px-4 py-2 text-xs flex items-center gap-2 toast-slide-down shadow-lg"
            >
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ background: t.warn ? 'var(--warn)' : 'var(--ok)' }}
              />
              <span>{t.msg}</span>
            </div>
          ))}
        </div>
        {splashState === 'leaving' && renderBootSplash('leaving')}
      </>
    );
  }

  const presetBg =
    PRESET_WALLPAPERS[settings.wallpaperPreset % PRESET_WALLPAPERS.length]?.bg ||
    PRESET_WALLPAPERS[0].bg;

  let backgroundImage = presetBg;
  if (
    (settings.wallpaperMode === 'custom' || settings.wallpaperMode === 'local') &&
    settings.wallpaperCustom
  ) {
    backgroundImage = `url("${settings.wallpaperCustom}")`;
  } else if (settings.wallpaperMode === 'local' && localWps.length > 0) {
    backgroundImage = `url("${localWps[0].url}")`;
  } else if (settings.wallpaperMode === 'bing' && bingItems.length > 0) {
    const item = bingItems[bingIdx % bingItems.length];
    backgroundImage = `url("${item.url}")`;
  }

  const blurPct = Math.max(0, Math.min(100, settings.glassBlur ?? 0));
  const rCard = Math.max(0, Math.min(36, settings.glassRadius ?? 10));
  const rLg = Math.round(rCard * 0.72);
  const rSm = Math.round(rCard * 0.45);

  const visibleCanvasWidgets = resolvedWidgets.filter((w) => w.visible);

  return (
    <OrbitHostProvider host={host}>
      <div
        className={`orbit-shell relative min-h-[100dvh] w-full flex flex-col select-none ${
          layoutEditing && !isGuest ? 'layout-editing' : ''
        }`}
        data-glass={resolvedTheme}
        data-theme={resolvedTheme}
        style={
          {
            '--glass-blur': `${((blurPct / 100) * 40).toFixed(1)}px`,
            '--glass-alpha': (settings.glassAlpha / 100).toFixed(2),
            '--bg-dim': (settings.bgDim / 100).toFixed(2),
            '--radius-card': `${rCard}px`,
            '--radius-lg': `${rLg}px`,
            '--radius-sm': `${rSm}px`,
          } as React.CSSProperties
        }
      >
        <div className="wallpaper-layer" style={{ backgroundImage }} />
        <div className="wallpaper-dim" />
        {layoutEditing && !isGuest && <div className="canvas-grid-bg" />}

        <TopBar
          snap={snap}
          onToggleSnap={setSnap}
          onToggleZonePanel={() => {
            setAccountOpen(false);
            setActiveDrawer(null);
            setZonePanelOpen((v) => !v);
          }}
          onToggleAccount={() => {
            setZonePanelOpen(false);
            setActiveDrawer(null);
            setAccountOpen((v) => !v);
          }}
        />

        <main
          ref={canvasRef}
          id="freeCanvas"
          className="relative z-20"
          onDoubleClick={(e) => {
            if (!isGuest && e.target === canvasRef.current && window.innerWidth >= 768) {
              setLayoutEditing((v) => !v);
            }
          }}
        >
          {guideV !== null && <div className="snap-guide-v" style={{ left: `${guideV}px` }} />}
          {guideH !== null && <div className="snap-guide-h" style={{ top: `${guideH}px` }} />}

          {visibleCanvasWidgets.map((rw) => {
            const Comp = rw.Component;
            const isElevatedSearch = rw.key === 'search' && searchElevated;
            const label = rw.widget.label || rw.manifest.name;
            const supportsCardless = rw.manifest.style?.supportsCardless !== false;
            const defaultCardless = Boolean(
              rw.record.style?.cardless ?? rw.manifest.style?.defaultCardless,
            );

            return (
              <div
                key={rw.key}
                id={`item-${rw.key}`}
                data-elevated={isElevatedSearch ? 'true' : undefined}
                onPointerDown={(e) => startDragItem(rw.key, e)}
                style={isElevatedSearch ? { zIndex: 45 } : undefined}
                className={`canvas-item ${rw.key === 'clock' ? 'text-center ' : ''}${
                  draggingId === rw.key ? 'is-dragging' : ''
                }`}
              >
                <div className="edit-chrome hidden [.layout-editing_&]:flex absolute -top-7 left-1/2 -translate-x-1/2 glass-strong rounded-full px-2.5 py-0.5 items-center gap-2 text-xs whitespace-nowrap z-30">
                  <span>⋮⋮ {label}</span>
                  {supportsCardless && (
                    <button
                      type="button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleWidgetCardless(rw.key, defaultCardless);
                      }}
                      className="opacity-75 hover:opacity-100 cursor-pointer flex items-center"
                      title={rw.cardless ? '切换为卡片样式' : '切换为无卡片样式'}
                    >
                      {rw.cardless ? (
                        <Square className="w-3 h-3" />
                      ) : (
                        <SquareDashed className="w-3 h-3" />
                      )}
                    </button>
                  )}
                  <button
                    type="button"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      updateSettings({
                        visibleItems: { ...settings.visibleItems, [rw.key]: false },
                      });
                    }}
                    className="opacity-70 hover:opacity-100 cursor-pointer"
                    title="隐藏组件"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>

                {layoutEditing && !isGuest && rw.widget.resizable && (
                  <>
                    <div
                      className="resize-handle resize-handle-e"
                      onPointerDown={(e) => startResizeItem(rw.key, e, 'e')}
                      title="拖动调节宽度"
                    />
                    <div
                      className="resize-handle resize-handle-s"
                      onPointerDown={(e) => startResizeItem(rw.key, e, 's')}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        resetItemHeight(rw.key);
                      }}
                      title="拖动调节高度（双击恢复自适应）"
                    />
                    <div
                      className="resize-handle resize-handle-se"
                      onPointerDown={(e) => startResizeItem(rw.key, e, 'se')}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        resetItemHeight(rw.key);
                      }}
                      title="拖动自由调节宽高（双击恢复自适应高度）"
                    />
                  </>
                )}

                {resizingDim?.id === rw.key && (
                  <div className="resize-dim-badge font-mono">
                    {resizingDim.w} × {resizingDim.h ?? 'auto'}
                  </div>
                )}

                {Comp ? (
                  <Comp
                    widget={rw.widget}
                    manifest={rw.manifest}
                    record={rw.record}
                    layoutKey={rw.key}
                  />
                ) : (
                  <ExternalWidgetHost
                    manifest={rw.manifest}
                    record={rw.record}
                    title={label}
                    cardless={rw.cardless}
                  />
                )}
              </div>
            );
          })}
        </main>

        <FooterBar footer={settings.footer} version={appVersion} />

        {isAuthenticated && auth.user && (
          <>
            <ZoneStatusPopover
              open={zonePanelOpen}
              onClose={() => setZonePanelOpen(false)}
            />

            <AccountPopover
              open={accountOpen}
              user={auth.user}
              version={appVersion}
              onClose={() => setAccountOpen(false)}
              onOpenSettings={(tab) => openSettings(tab)}
              onStartLayoutEdit={startLayoutEdit}
              onLogout={async () => {
                try {
                  await api.logout();
                  setZonePanelOpen(false);
                  setAccountOpen(false);
                  setSettingsModalOpen(false);
                  setActiveDrawer(null);
                  await loadWorkspace();
                } catch (e) {
                  showToast((e as Error).message || '退出登录失败', true);
                }
              }}
            />

            <SettingsModal />
          </>
        )}

        <MobileCapsule
          onBeforeSelect={() => {
            setAccountOpen(false);
            setZonePanelOpen(false);
          }}
        />

        {isAuthenticated && (
          <>
            <SlideDrawerHost />

            <ShareModal
              target={shareTarget}
              onClose={() => setShareTarget(null)}
              onCopy={copyText}
              onToast={showToast}
            />

            {isPluginEnabled('orbit.bookmarks') && (
              <BookmarkModal
                open={bookmarkModalOpen}
                editingBookmark={editingBookmark}
                groups={groups}
                onClose={() => setBookmarkModalOpen(false)}
                onSave={host.saveBookmark}
                onDelete={host.deleteBookmark}
                onCreateGroup={host.createGroup}
                onImportSunPanel={host.importSunPanel}
                onImportBrowserBookmarks={host.importBrowserBookmarks}
                onToast={showToast}
              />
            )}

            {transferEnabled && (
              <DragUploadOverlay
                visible={externalDragVisible}
                detectedZone={auth.detected_zone}
                limits={auth.limits}
              />
            )}
          </>
        )}

        {isGuest && (
          <AuthScreen
            modal
            open={authModalOpen}
            initialized={auth.initialized}
            notice={authNotice}
            theme={resolvedTheme}
            onToggleTheme={toggleDayNight}
            onClose={() => setAuthModalOpen(false)}
            onAuthenticated={loadWorkspace}
            onToast={showToast}
          />
        )}

        <NotificationStack
          items={notifications}
          offsetTop={layoutEditing && !isGuest}
          onDismiss={dismissNotification}
          onCopy={copyText}
          onOpenDrawer={(drawerId) => host.openDrawer(drawerId)}
        />

        {splashState === 'leaving' && renderBootSplash('leaving')}
      </div>
    </OrbitHostProvider>
  );
}
export default App;
