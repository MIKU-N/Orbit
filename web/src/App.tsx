import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
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
import { applyGlobalFont } from './lib/fonts';
import { PRESET_WALLPAPERS } from './lib/wallpapers';
import { BUILTIN_PLUGINS, BookmarkModal, MonitorModal, ShareModal } from './plugins';
import { OrbitHostProvider } from './sdk/host';
import { formatBytes, formatSpeed, getBookmarkActiveUrl } from './sdk/primitives';
import {
  collectSearchSuggestions,
  mergePluginRecords,
  resolveDrawers,
  resolveSettingsTabs,
  resolveSharingScopes,
  resolveWidgets,
} from './sdk/registry';
import type { HostAPI, SearchSuggestion } from './sdk/types';
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
  StagedFile,
  SystemMetrics,
  UserSettings,
  WeatherPayload,
} from './types';

const DEFAULT_SETTINGS: UserSettings = {
  glassTheme: 'dark',
  glassBlur: 55,
  glassBlurMode: 'pct',
  glassAlpha: 32,
  glassRadius: 16,
  bgDim: 22,
  fontConfig: {
    activeId: 'noto-sans',
    customFonts: [],
  },
  wallpaperMode: 'bing',
  wallpaperPreset: 0,
  wallpaperCustom: '',
  localWallpapers: [],
  localWallpaperRotate: false,
  localWallpaperIntervalMin: 15,
  bingAuto: true,
  enableTilt: true,
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
  hasCustomLayout: false,
  layout: null,
  engines: [
    { id: 'google', name: 'Google', key: 'g', url: 'https://www.google.com/search?q={q}', color: '#60a5fa', icon: '' },
    { id: 'bing', name: 'Bing', key: 'b', url: 'https://www.bing.com/search?q={q}', color: '#38bdf8', icon: '' },
    { id: 'github', name: 'GitHub', key: 'gh', url: 'https://github.com/search?q={q}', color: '#e2e8f0', icon: '' },
    { id: 'bilibili', name: 'Bilibili', key: 'bl', url: 'https://search.bilibili.com/all?keyword={q}', color: '#f472b6', icon: '' },
    { id: 'local', name: '站内', key: 's', url: '', color: '#a78bfa', icon: '' },
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

  return {
    ...DEFAULT_SETTINGS,
    ...s,
    glassBlur: resolvedBlur,
    glassBlurMode: 'pct',
    glassRadius: typeof s.glassRadius === 'number' ? s.glassRadius : DEFAULT_SETTINGS.glassRadius,
    fontConfig: {
      activeId: s.fontConfig?.activeId || DEFAULT_SETTINGS.fontConfig.activeId,
      customFonts: Array.isArray(s.fontConfig?.customFonts) ? s.fontConfig.customFonts : [],
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
    engines: s.engines?.length
      ? s.engines.map((e) => ({ ...e, icon: e.icon || '' }))
      : DEFAULT_SETTINGS.engines,
  };
}

const MAX_NOTIFICATIONS = 3;

export function App() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [publicCfg, setPublicCfg] = useState<PublicConfig | null>(null);
  const [backendPlugins, setBackendPlugins] = useState<PluginStateRecord[]>([]);
  const [zone, setZone] = useState<NetworkZone>('lan');
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
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
  const [monitorModalOpen, setMonitorModalOpen] = useState(false);
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
      resolveWidgets(BUILTIN_PLUGINS, plugins, isGuest, settings).filter(
        (w) => !(w.pluginId === 'orbit.monitor' && !canViewMonitor),
      ),
    [canViewMonitor, isGuest, plugins, settings],
  );

  const resolvedDrawers = useMemo(
    () => resolveDrawers(BUILTIN_PLUGINS, plugins, isGuest),
    [isGuest, plugins],
  );

  const resolvedSettingsTabs = useMemo(
    () => resolveSettingsTabs(BUILTIN_PLUGINS, plugins, isGuest),
    [isGuest, plugins],
  );

  const sharingScopes = useMemo(() => resolveSharingScopes(plugins), [plugins]);

  useEffect(() => {
    applyGlobalFont(settings.fontConfig);
  }, [settings.fontConfig]);

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
      const id = input.key ? `k:${input.key}` : `n:${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
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
          // Evict oldest completed/non-progress notification first, keeping active progress cards visible
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
    (text: string, label = '已复制') => {
      if (navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(text).catch(() => {});
      }
      showToast(label);
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
    async (wc: UserSettings['weatherConfig'], refresh = false) => {
      try {
        const w = await api.getWeather({
          lat: wc.lat,
          lon: wc.lon,
          label: wc.label,
          city: wc.query,
          refresh,
        });
        setWeather(w);
      } catch {
        // ignore offline weather
      }
    },
    [],
  );

  const refreshPlugins = useCallback(async () => {
    try {
      const res = await api.listPlugins();
      setBackendPlugins(res.plugins || []);
    } catch {
      // ignore
    }
  }, []);

  const loadWorkspace = useCallback(async () => {
    const st = await api.authStatus();
    setAuth(st);
    setZone(st.detected_zone);

    if (!st.authenticated) {
      try {
        const [pub, bingRes] = await Promise.all([
          api.getPublicConfig(),
          api.listBingWallpapers().catch(() => ({ items: [], fallback: true })),
        ]);
        setPublicCfg(pub);
        setBingItems(bingRes.items || []);
        const pubPlugins = pub.plugins || [];
        setBackendPlugins(pubPlugins);
        const mergedPub = mergePluginRecords(BUILTIN_PLUGINS, pubPlugins);
        const weatherOn =
          mergedPub.find((p) => p.manifest.id === 'orbit.weather')?.enabled !== false;

        if (st.initialized && pub.allowGuest) {
          const guestSettings = mergeUserSettings(pub);
          guestSettings.visibleItems = {
            ...guestSettings.visibleItems,
            clock: true,
            search: true,
            weather: true,
            hitokoto: true,
            monitor: false,
            bookmarks: false,
          };
          guestSettings.hasCustomLayout = false;
          guestSettings.layout = null;
          setSettings(guestSettings);
          if (weatherOn) {
            const pw = await api.getPublicWeather().catch(() => null);
            if (pw) setWeather(pw);
          }
        }
      } catch {
        setPublicCfg({ allowGuest: false });
      }
      return;
    }

    setPublicCfg(null);
    setAuthModalOpen(false);
    setAuthNotice(null);

    const userCanMonitor = st.user?.role === 'admin' || Boolean(st.user?.share_scopes?.monitor);

    const [pluginRes, setRes, bingRes] = await Promise.all([
      api.listPlugins().catch(() => ({ plugins: [] as PluginStateRecord[] })),
      api.getSettings(),
      api.listBingWallpapers().catch(() => ({ items: [], fallback: true })),
    ]);

    const mergedRecords = mergePluginRecords(BUILTIN_PLUGINS, pluginRes.plugins || []);
    setBackendPlugins(pluginRes.plugins || []);
    const enabled = (id: string) =>
      mergedRecords.find((r) => r.manifest.id === id)?.enabled !== false;

    const mergedSettings = mergeUserSettings(setRes.settings);
    setSettings(mergedSettings);
    setBingItems(bingRes.items || []);

    const [bmRes, clipRes, fileRes, metricRes] = await Promise.all([
      enabled('orbit.bookmarks')
        ? api.listBookmarks().catch(() => ({ groups: [], bookmarks: [] }))
        : Promise.resolve({ groups: [] as BookmarkGroup[], bookmarks: [] as Bookmark[] }),
      enabled('orbit.clipboard')
        ? api.listClips().catch(() => ({ clips: [] }))
        : Promise.resolve({ clips: [] as ClipItem[] }),
      enabled('orbit.transfer')
        ? api.listFiles().catch(() => null)
        : Promise.resolve(null),
      userCanMonitor && enabled('orbit.monitor')
        ? api
            .getSystemMetrics(mergedSettings.monitorConfig.diskMount)
            .catch(() => ({ metrics: null }))
        : Promise.resolve({ metrics: null }),
    ]);

    setGroups(bmRes.groups);
    setBookmarks(bmRes.bookmarks);
    setClips(clipRes.clips);
    setFilesData(fileRes);
    setMetrics(metricRes.metrics);

    if (enabled('orbit.weather')) {
      await fetchWeather(mergedSettings.weatherConfig);
    }
  }, [fetchWeather]);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  const monitorEnabled = isPluginEnabled('orbit.monitor');
  const monitorRefreshSec = settings.monitorConfig?.refreshSeconds || 3;
  const monitorMount = settings.monitorConfig?.diskMount || '';
  useEffect(() => {
    if (!canViewMonitor || !monitorEnabled) return;
    const fetchMetrics = () => {
      void api
        .getSystemMetrics(monitorMount)
        .then((res) => setMetrics(res.metrics))
        .catch(() => {});
    };
    fetchMetrics();
    const id = window.setInterval(fetchMetrics, Math.max(2, monitorRefreshSec) * 1000);
    return () => window.clearInterval(id);
  }, [canViewMonitor, monitorEnabled, monitorMount, monitorRefreshSec]);

  const weatherEnabled = isPluginEnabled('orbit.weather');
  const weatherRefreshMin = settings.weatherConfig?.refreshMinutes || 30;
  useEffect(() => {
    if ((!isAuthenticated && !isGuest) || !weatherEnabled) return;
    const id = window.setInterval(() => {
      if (isAuthenticated) {
        void fetchWeather(settings.weatherConfig, true);
      } else {
        void api.getPublicWeather().then(setWeather).catch(() => {});
      }
    }, Math.max(5, weatherRefreshMin) * 60 * 1000);
    return () => window.clearInterval(id);
  }, [fetchWeather, isAuthenticated, isGuest, settings.weatherConfig, weatherEnabled, weatherRefreshMin]);

  const { peers, selfPeerId, wsConnected, p2pProgress, sendFileP2P } = useOrbitWS({
    enabled: isAuthenticated,
    onClipsChanged: (ev) => {
      void refreshClips();
      if (ev?.action === 'created' && ev.clip && !localClipIdsRef.current.has(ev.clip.id)) {
        const clip = ev.clip;
        pushNotification(
          {
            kind: 'clipboard',
            title: '收到新剪贴板',
            meta: `${clip.device || '其他设备'} · 实时同步`,
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
      if (ev?.action === 'created' && ev.file && !localFileIdsRef.current.has(ev.file.id)) {
        const f = ev.file;
        pushNotification(
          {
            kind: 'file',
            title: '收到新暂存文件',
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
          title: info.direction === 'receive' ? 'P2P 文件接收完成' : 'P2P 直传完成',
          meta: `${formatBytes(info.sizeBytes)} · 均速 ${formatSpeed(info.speedBps)}`,
          msg: info.fileName,
          drawerTarget: 'files',
        },
        5000,
      );
    },
  });

  useEffect(() => {
    if (p2pProgress) {
      pushNotification(
        {
          key: 'p2p-transfer',
          kind: 'progress',
          title: p2pProgress.direction === 'receive' ? '正在 P2P 接收文件' : '正在 P2P 直传文件',
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
    } else {
      dismissNotificationByKey('p2p-transfer');
    }
  }, [dismissNotificationByKey, p2pProgress, pushNotification]);

  const persistSettings = useCallback(
    (next: UserSettings) => {
      if (!isAuthenticated) return;
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => {
        void api.putSettings(next).catch(() => {});
      }, 450);
    },
    [isAuthenticated],
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
        showToast(`${enabled ? '已启用' : '已禁用'}插件：${label}`);

        if (enabled) {
          if (id === 'orbit.bookmarks') await refreshBookmarks().catch(() => {});
          if (id === 'orbit.clipboard') await refreshClips();
          if (id === 'orbit.transfer') await refreshFiles();
          if (id === 'orbit.monitor') await refreshMetrics();
          if (id === 'orbit.weather') await fetchWeather(settings.weatherConfig, false);
        } else {
          if (id === 'orbit.clipboard' && activeDrawer === 'clipboard') setActiveDrawer(null);
          if (id === 'orbit.transfer' && activeDrawer === 'files') setActiveDrawer(null);
          if (id === 'orbit.bookmarks') setBookmarkModalOpen(false);
          if (id === 'orbit.monitor') setMonitorModalOpen(false);
        }
      } catch (e) {
        showToast((e as Error).message || '更新插件状态失败', true);
      }
    },
    [
      activeDrawer,
      fetchWeather,
      refreshBookmarks,
      refreshClips,
      refreshFiles,
      refreshMetrics,
      settings.weatherConfig,
      showToast,
    ],
  );

  const savePluginConfig = useCallback(
    async (id: string, config: Record<string, unknown>) => {
      try {
        const res = await api.updatePlugin(id, { config });
        setBackendPlugins(res.plugins || []);
        showToast('已保存插件配置');
      } catch (e) {
        showToast((e as Error).message || '保存配置失败', true);
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
    startDragItem,
    startResizeItem,
  } = useFreeLayout({
    canvasRef,
    widgets: resolvedWidgets,
    settings,
    layoutEditing: layoutEditing && isAuthenticated,
    onPersistLayout: handlePersistLayout,
    depsKey: [
      isGuest ? 'guest' : 'auth',
      canViewMonitor ? 'mon' : 'nomon',
      resolvedWidgets.map((w) => `${w.key}:${w.visible}`).join(','),
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
    ].join('-'),
  });

  const transferEnabled = isPluginEnabled('orbit.transfer');

  const uploadFiles = useCallback(
    async (fileList: FileList | File[]) => {
      if (!transferEnabled) {
        showToast('文件快传插件已禁用', true);
        return;
      }
      if (!isAuthenticated) {
        promptGuestLogin('文件上传与快传需要登录后使用');
        return;
      }
      const files = Array.from(fileList);
      if (!files.length) return;
      setActiveDrawer('files');
      setUploadError(null);

      for (const file of files) {
        const initProg = {
          fileName: file.name,
          percent: 0,
          loaded: 0,
          total: file.size,
          speedBps: 0,
        };
        setUploadProgress(initProg);
        pushNotification(
          {
            key: 'http-upload',
            kind: 'progress',
            title: '正在上传到暂存箱',
            msg: file.name,
            drawerTarget: 'files',
            progress: {
              direction: 'upload',
              percent: 0,
              speedBps: 0,
              transferredBytes: 0,
              totalBytes: file.size,
            },
          },
          0,
        );
        try {
          const uploaded = await api.uploadFileWithProgress(file, 24, (prog) => {
            setUploadProgress({ fileName: file.name, ...prog });
            pushNotification(
              {
                key: 'http-upload',
                kind: 'progress',
                title: '正在上传到暂存箱',
                msg: file.name,
                drawerTarget: 'files',
                progress: {
                  direction: 'upload',
                  percent: prog.percent,
                  speedBps: prog.speedBps,
                  transferredBytes: prog.loaded,
                  totalBytes: prog.total,
                },
              },
              0,
            );
          });
          if (uploaded.file?.id) {
            markLocalFileCreated(uploaded.file.id);
          }
          dismissNotificationByKey('http-upload');
          await refreshFiles();
          showToast(`已暂存：${file.name}`);
        } catch (e) {
          dismissNotificationByKey('http-upload');
          if (e instanceof APIError && e.status === 413) {
            const msg = `当前为 ${String(e.data.zone || zone).toUpperCase()} 访问，单文件限 ${String(e.data.limit_mb || auth?.limits.wan_mb || 100)} MB（同局域网设备可用上方 P2P 绕过）`;
            setUploadError(msg);
            showToast('超出当前网络单文件大小限制', true);
          } else {
            showToast((e as Error).message || '上传失败', true);
          }
        } finally {
          setUploadProgress(null);
        }
      }
    },
    [
      auth?.limits.wan_mb,
      dismissNotificationByKey,
      isAuthenticated,
      markLocalFileCreated,
      promptGuestLogin,
      pushNotification,
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
        setMonitorModalOpen(false);
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
    } else {
      const nextPreset = (settings.wallpaperPreset + 1) % PRESET_WALLPAPERS.length;
      updateSettings({ wallpaperMode: 'preset', wallpaperPreset: nextPreset });
    }
  }, [bingItems.length, settings.wallpaperPreset, updateSettings]);

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
        showToast('已加入本地壁纸库并应用');
      } catch (e) {
        showToast((e as Error).message || '上传失败', true);
      }
    },
    [showToast, updateSettings],
  );

  const handleDeleteLocalWallpaper = useCallback(
    async (url: string) => {
      if (url.startsWith('/api/wallpaper/custom/')) {
        const name = url.split('/').pop() || '';
        if (name) {
          await api.deleteCustomWallpaper(name).catch(() => {});
        }
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
      showToast('已移除本地壁纸');
    },
    [showToast, updateSettings],
  );

  const startLayoutEdit = useCallback(() => {
    if (isGuest) return;
    if (window.innerWidth < 768) {
      showToast('请在宽屏桌面视图下拖拽自由布局', true);
      return;
    }
    setLayoutEditing(true);
    showToast('随意拖动组件位置或右边缘缩放宽度');
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
    limits: auth?.limits || { lan_mb: 10240, ts_mb: 2048, wan_mb: 100 },
    publicConfig: publicCfg,

    settings,
    updateSettings,
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
      const res = await api.rotateToken();
      setAuth((prev) =>
        prev && prev.user
          ? { ...prev, user: { ...prev.user, api_token: res.api_token } }
          : prev,
      );
      showToast('已重置 API Token');
    },
    uploadAvatar: async (file) => {
      const res = await api.uploadAvatar(file);
      setAuth((prev) =>
        prev && prev.user
          ? { ...prev, user: { ...prev.user, avatar: res.avatar } }
          : prev,
      );
      showToast('头像已更新');
    },
    deleteAvatar: async () => {
      await api.deleteAvatar();
      setAuth((prev) =>
        prev && prev.user
          ? { ...prev, user: { ...prev.user, avatar: '' } }
          : prev,
      );
      showToast('已恢复默认头像');
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
      showToast(`已批量删除 ${res.deleted} 条书签`);
    },
    batchMoveBookmarks: async (ids, groupId) => {
      if (!ids.length) return;
      const res = await api.batchMoveBookmarks(ids, groupId);
      await refreshBookmarks();
      showToast(`已移动 ${res.moved} 条书签到目标分组`);
    },
    reorderBookmarks: (ids) => {
      const map = new Map(bookmarks.map((b) => [b.id, b]));
      const reordered = ids.map((id) => map.get(id)).filter((x): x is Bookmark => Boolean(x));
      setBookmarks(reordered);
      void api.reorderBookmarks(ids);
    },
    createGroup: async (name) => {
      const res = await api.createGroup(name);
      await refreshBookmarks();
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
        showToast(`成功导入 ${res.imported} 个书签到「${res.group_name}」`);
        return true;
      } catch (e) {
        showToast((e as Error).message || '导入失败', true);
        return false;
      }
    },

    openMonitorModal: () => setMonitorModalOpen(true),

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
      await fetchWeather(merged, refresh);
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
      return collectSearchSuggestions(q, BUILTIN_PLUGINS, plugins, isGuest, h);
    },
    resolveUrl: (bm: Bookmark) => getBookmarkActiveUrl(bm, zone),
    apiFetch,
  };
  hostRef.current = host;

  if (!auth || (!isAuthenticated && publicCfg === null)) {
    return (
      <div className="min-h-screen w-full bg-slate-950 text-white flex items-center justify-center text-xs">
        正在加载 Orbit · 星轨...
      </div>
    );
  }

  if (!isAuthenticated && !isGuest) {
    return (
      <>
        <AuthScreen
          initialized={auth.initialized}
          initialShareCode={initialShareCode}
          onAuthenticated={loadWorkspace}
          onToast={showToast}
        />
        <div
          data-glass="dark"
          className="fixed top-4 left-1/2 -translate-x-1/2 z-[70] flex flex-col items-center gap-2 pointer-events-none w-full max-w-sm px-4"
          style={
            {
              '--glass-strong-rgb': '16, 20, 32',
              '--glass-alpha': '0.45',
              '--glass-blur': '22px',
              '--glass-border': 'rgba(255, 255, 255, 0.18)',
              '--glass-highlight': 'rgba(255, 255, 255, 0.16)',
            } as React.CSSProperties
          }
        >
          {notifications.map((t) => (
            <div
              key={t.id}
              className="pointer-events-auto glass-strong rounded-full px-4 py-2 text-xs flex items-center gap-2 toast-slide-down text-white shadow-lg"
            >
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ background: t.warn ? '#fbbf24' : '#34d399' }}
              />
              <span>{t.msg}</span>
            </div>
          ))}
        </div>
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

  const blurPct = Math.max(0, Math.min(100, settings.glassBlur ?? 55));
  const rCard = Math.max(0, Math.min(36, settings.glassRadius ?? 16));
  const rLg = Math.round(rCard * 0.72);
  const rSm = Math.round(rCard * 0.45);

  const visibleCanvasWidgets = resolvedWidgets.filter((w) => w.visible);

  return (
    <OrbitHostProvider host={host}>
      <div
        className={`orbit-shell relative min-h-[100dvh] w-full flex flex-col select-none ${
          layoutEditing && !isGuest ? 'layout-editing' : ''
        }`}
        data-glass={settings.glassTheme}
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
        {guideV !== null && <div className="snap-guide-v" style={{ left: `${guideV}px` }} />}
        {guideH !== null && <div className="snap-guide-h" style={{ top: `${guideH}px` }} />}

        <TopBar
          snap={snap}
          onToggleSnap={setSnap}
          onToggleZonePanel={() => {
            setAccountOpen(false);
            setZonePanelOpen((v) => !v);
          }}
          onToggleAccount={() => {
            setZonePanelOpen(false);
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
          {visibleCanvasWidgets.map((rw) => {
            const Comp = rw.Component;
            const isElevatedSearch = rw.key === 'search' && searchElevated;
            const label = rw.widget.label || rw.manifest.name;
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
                  <span>
                    ⋮⋮ {label}
                    {rw.key === 'bookmarks' ? '（拖右缘调宽）' : ''}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      updateSettings({
                        visibleItems: { ...settings.visibleItems, [rw.key]: false },
                      })
                    }
                    className="opacity-70 hover:opacity-100 cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>

                {layoutEditing && !isGuest && rw.widget.resizable && (
                  <div
                    className="resize-handle"
                    onPointerDown={(e) => startResizeItem(rw.key, e)}
                    title="拖动调节宽度"
                  />
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
                  />
                )}
              </div>
            );
          })}
        </main>

        <FooterBar footer={settings.footer} />

        {isAuthenticated && auth.user && (
          <>
            <ZoneStatusPopover
              open={zonePanelOpen}
              onClose={() => setZonePanelOpen(false)}
            />

            <AccountPopover
              open={accountOpen}
              user={auth.user}
              onClose={() => setAccountOpen(false)}
              onOpenSettings={(tab) => openSettings(tab)}
              onStartLayoutEdit={startLayoutEdit}
              onLogout={async () => {
                await api.logout();
                setZonePanelOpen(false);
                setAccountOpen(false);
                setSettingsModalOpen(false);
                setActiveDrawer(null);
                await loadWorkspace();
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

            {canViewMonitor && isPluginEnabled('orbit.monitor') && (
              <MonitorModal
                open={monitorModalOpen}
                metrics={metrics}
                onClose={() => setMonitorModalOpen(false)}
                onOpenCustomize={() => openSettings('monitor')}
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

        {isGuest && authModalOpen && (
          <AuthScreen
            modal
            initialized={auth.initialized}
            notice={authNotice}
            onClose={() => setAuthModalOpen(false)}
            onAuthenticated={loadWorkspace}
            onToast={showToast}
          />
        )}

        <NotificationStack
          items={notifications}
          onDismiss={dismissNotification}
          onCopy={copyText}
          onOpenDrawer={(drawerId) => host.openDrawer(drawerId)}
        />
      </div>
    </OrbitHostProvider>
  );
}
export default App;
