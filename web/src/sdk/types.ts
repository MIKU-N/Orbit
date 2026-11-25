import type React from 'react';
import type { apiFetch } from '../api/client';
import type { TransferProgress } from '../lib/webrtc';
import type {
  AccessSpec,
  BingWallpaperItem,
  Bookmark,
  BookmarkGroup,
  BuiltinLayoutItemId,
  ClipItem,
  ConfigField,
  ContributesSpec,
  DrawerContrib,
  DropHandlerContrib,
  ExternalSpec,
  FilesResponse,
  FreeLayoutMap,
  GuestSpec,
  LayoutBox,
  LayoutItemId,
  ManagedAsset,
  NetworkZone,
  PeerInfo,
  PluginManifest,
  PluginStateRecord,
  PluginStyleOverride,
  PluginStyleSpec,
  PluginVisibilityOverride,
  ProxyRule,
  PublicConfig,
  ResourceCdnConfig,
  ResourceCdnMode,
  SearchProviderContrib,
  SettingsContrib,
  ShareScopes,
  SharingSpec,
  StagedFile,
  SystemMetrics,
  ThemeMode,
  User,
  UserSettings,
  WeatherPayload,
  WidgetContrib,
} from '../types';

export type {
  AccessSpec,
  BingWallpaperItem,
  Bookmark,
  BookmarkGroup,
  BuiltinLayoutItemId,
  ClipItem,
  ConfigField,
  ContributesSpec,
  DrawerContrib,
  DropHandlerContrib,
  ExternalSpec,
  FilesResponse,
  FreeLayoutMap,
  GuestSpec,
  LayoutBox,
  LayoutItemId,
  ManagedAsset,
  NetworkZone,
  PeerInfo,
  PluginManifest,
  PluginStateRecord,
  PluginStyleOverride,
  PluginStyleSpec,
  PluginVisibilityOverride,
  ProxyRule,
  PublicConfig,
  ResourceCdnConfig,
  ResourceCdnMode,
  SearchProviderContrib,
  SettingsContrib,
  ShareScopes,
  SharingSpec,
  StagedFile,
  SystemMetrics,
  ThemeMode,
  TransferProgress,
  User,
  UserSettings,
  WeatherPayload,
  WidgetContrib,
};

export interface SearchSuggestion {
  id: string;
  source: string;
  sourceLabel: string;
  title: string;
  subtitle?: string;
  url?: string;
  icon?: string;
  color?: string;
  action: () => void;
}

export interface WidgetProps {
  widget: WidgetContrib;
  manifest: PluginManifest;
  record: PluginStateRecord;
  layoutKey: string;
}

export interface DrawerProps {
  drawer: DrawerContrib;
  manifest: PluginManifest;
  record: PluginStateRecord;
  onClose: () => void;
}

export interface SettingsPanelProps {
  manifest: PluginManifest;
  record: PluginStateRecord;
  searchQuery?: string;
  highlightSection?: string | null;
}

export interface OrbitPlugin {
  id: string;
  manifest: PluginManifest;
  widgets?: Record<string, React.ComponentType<WidgetProps>>;
  drawers?: Record<string, React.ComponentType<DrawerProps>>;
  settingsPanel?: React.ComponentType<SettingsPanelProps>;
  searchProvider?: (query: string, host: HostAPI) => SearchSuggestion[];
  onGlobalFileDrop?: (files: FileList | File[], host: HostAPI) => Promise<void> | void;
}

export interface ResolvedWidget {
  key: string;
  pluginId: string;
  widget: WidgetContrib;
  manifest: PluginManifest;
  record: PluginStateRecord;
  visible: boolean;
  cardless: boolean;
  guestReadonly: boolean;
  Component?: React.ComponentType<WidgetProps>;
}

export interface ResolvedDrawer {
  pluginId: string;
  drawer: DrawerContrib;
  manifest: PluginManifest;
  record: PluginStateRecord;
  guestLocked: boolean;
  guestPrompt?: string;
  Component?: React.ComponentType<DrawerProps>;
}

export interface ResolvedSettingsTab {
  tabId: string;
  pluginId: string;
  label: string;
  icon: string;
  searchKeywords: string[];
  manifest: PluginManifest;
  record: PluginStateRecord;
  Component?: React.ComponentType<SettingsPanelProps>;
}

export interface SharingScopeDescriptor {
  pluginId: string;
  scopeKey: string;
  label: string;
  mode: 'readonly' | 'sync';
}

export interface HostAPI {
  appVersion: string;
  authInitialized: boolean;
  authenticated: boolean;
  user: User | null;
  isGuest: boolean;
  isAdmin: boolean;
  canViewMonitor: boolean;
  zone: NetworkZone;
  detectedZone: NetworkZone;
  clientIp: string;
  setZone: (z: NetworkZone) => void;
  cycleZone: () => void;
  limits: { lan_mb: number; ts_mb: number; wan_mb: number };
  publicConfig: PublicConfig | null;

  settings: UserSettings;
  cdnBase: string;
  resolvedTheme: 'dark' | 'light';
  toggleDayNight: (ev?: React.MouseEvent<HTMLElement>) => void;
  updateSettings: (
    patch: Partial<UserSettings> | ((prev: UserSettings) => UserSettings),
  ) => void;
  isWidgetCardless: (key: string, defaultCardless?: boolean) => boolean;
  toggleWidgetCardless: (key: string, defaultCardless?: boolean) => void;
  layoutEditing: boolean;
  setLayoutEditing: (v: boolean) => void;
  startLayoutEdit: () => void;
  resetLayout: () => void;

  plugins: PluginStateRecord[];
  resolvedWidgets: ResolvedWidget[];
  resolvedDrawers: ResolvedDrawer[];
  resolvedSettingsTabs: ResolvedSettingsTab[];
  sharingScopes: SharingScopeDescriptor[];
  isPluginEnabled: (id: string) => boolean;
  refreshPlugins: () => Promise<void>;
  togglePlugin: (id: string, enabled: boolean) => Promise<void>;
  savePluginConfig: (id: string, config: Record<string, unknown>) => Promise<void>;
  updatePluginPolicy: (
    id: string,
    patch: { visibility?: PluginVisibilityOverride; style?: PluginStyleOverride },
  ) => Promise<void>;

  activeDrawer: string | null;
  openDrawer: (drawerId: string | null) => void;
  settingsOpen: boolean;
  settingsInitialTab: string | null;
  openSettings: (tabId?: string) => void;
  closeSettings: () => void;
  openLogin: () => void;
  promptGuestLogin: (msg: string) => void;
  toast: (msg: string, warn?: boolean) => void;
  copyText: (text: string, label?: string) => Promise<boolean>;
  rotateToken: () => Promise<void>;
  uploadAvatar: (file: File) => Promise<void>;
  deleteAvatar: () => Promise<void>;

  searchInputRef: React.RefObject<HTMLInputElement | null>;
  searchElevated: boolean;
  setSearchElevated: (v: boolean) => void;

  bookmarks: Bookmark[];
  bookmarkGroups: BookmarkGroup[];
  activeGroupId: number | 'all';
  setActiveGroupId: (id: number | 'all') => void;
  refreshBookmarks: () => Promise<void>;
  openBookmarkModal: (bm?: Bookmark | null) => void;
  openBookmark: (bm: Bookmark) => void;
  saveBookmark: (payload: Partial<Bookmark>, editingId?: number) => Promise<void>;
  deleteBookmark: (id: number) => Promise<void>;
  batchDeleteBookmarks: (ids: number[]) => Promise<void>;
  batchMoveBookmarks: (ids: number[], groupId: number) => Promise<void>;
  reorderBookmarks: (ids: number[]) => void;
  createGroup: (name: string) => Promise<BookmarkGroup | null>;
  updateGroup: (id: number, name: string) => Promise<void>;
  deleteGroup: (id: number) => Promise<void>;
  importSunPanel: (rawJson: string) => Promise<boolean>;
  importBrowserBookmarks: (html: string, groupName: string) => Promise<boolean>;

  clips: ClipItem[];
  refreshClips: () => Promise<void>;
  markLocalClipCreated: (id: number) => void;

  filesData: FilesResponse | null;
  refreshFiles: () => Promise<void>;
  uploadFiles: (
    files: FileList | File[],
    opts?: { ttlHours?: number; permanent?: boolean; targetPeerId?: string; openPopover?: boolean },
  ) => Promise<void>;
  uploadProgress: { fileName: string; percent: number; loaded: number; total: number; speedBps: number } | null;
  uploadError: string | null;
  clearUploadError: () => void;
  openShareModal: (target: { kind: 'file' | 'clip'; id: number; label: string }) => void;

  bingItems: BingWallpaperItem[];
  onNextBing: () => void;
  onNextLocalWallpaper: () => void;
  onUploadWallpaper: (file: File) => void;
  onDeleteLocalWallpaper: (url: string) => void;

  weather: WeatherPayload | null;
  refreshWeather: (
    override?: Partial<UserSettings['weatherConfig']>,
    refresh?: boolean,
  ) => Promise<void>;

  metrics: SystemMetrics | null;
  refreshMetrics: () => Promise<void>;

  peers: PeerInfo[];
  selfPeerId: string;
  wsConnected: boolean;
  p2pProgress: TransferProgress | null;
  sendFileP2P: (peerId: string, file: File) => Promise<void>;

  searchAcrossPlugins: (query: string) => SearchSuggestion[];
  resolveUrl: (bm: Bookmark) => string;
  apiFetch: typeof apiFetch;
}
