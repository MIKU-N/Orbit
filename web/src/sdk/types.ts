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
  NetworkZone,
  PeerInfo,
  PluginManifest,
  PluginStateRecord,
  ProxyRule,
  PublicConfig,
  SearchProviderContrib,
  SettingsContrib,
  ShareScopes,
  SharingSpec,
  StagedFile,
  SystemMetrics,
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
  NetworkZone,
  PeerInfo,
  PluginManifest,
  PluginStateRecord,
  ProxyRule,
  PublicConfig,
  SearchProviderContrib,
  SettingsContrib,
  ShareScopes,
  SharingSpec,
  StagedFile,
  SystemMetrics,
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
  authInitialized: boolean;
  authenticated: boolean;
  user: User | null;
  isGuest: boolean;
  isAdmin: boolean;
  canViewMonitor: boolean;
  zone: NetworkZone;
  detectedZone: NetworkZone;
  setZone: (z: NetworkZone) => void;
  cycleZone: () => void;
  limits: { lan_mb: number; ts_mb: number; wan_mb: number };
  publicConfig: PublicConfig | null;

  settings: UserSettings;
  updateSettings: (
    patch: Partial<UserSettings> | ((prev: UserSettings) => UserSettings),
  ) => void;
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

  activeDrawer: string | null;
  openDrawer: (drawerId: string | null) => void;
  settingsOpen: boolean;
  settingsInitialTab: string | null;
  openSettings: (tabId?: string) => void;
  closeSettings: () => void;
  openLogin: () => void;
  promptGuestLogin: (msg: string) => void;
  toast: (msg: string, warn?: boolean) => void;
  copyText: (text: string, label?: string) => void;
  rotateToken: () => Promise<void>;

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
  reorderBookmarks: (ids: number[]) => void;
  createGroup: (name: string) => Promise<BookmarkGroup | null>;
  deleteGroup: (id: number) => Promise<void>;
  importSunPanel: (rawJson: string) => Promise<void>;
  importBrowserBookmarks: (html: string, groupName: string) => Promise<void>;

  openMonitorModal: () => void;

  clips: ClipItem[];
  refreshClips: () => Promise<void>;

  filesData: FilesResponse | null;
  refreshFiles: () => Promise<void>;
  uploadFiles: (files: FileList | File[]) => Promise<void>;
  uploadProgress: number | null;
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
