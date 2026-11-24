export type NetworkZone = 'lan' | 'tailscale' | 'wan';

export type BuiltinLayoutItemId = 'clock' | 'search' | 'weather' | 'monitor' | 'hitokoto' | 'bookmarks';
export type LayoutItemId = string;

export interface LayoutBox {
  left: number;
  cxRatio?: number;
  top: number;
  w: number;
  z: number;
}

export type FreeLayoutMap = Record<string, LayoutBox>;

export interface SearchEngine {
  id: string;
  name: string;
  key: string;
  url: string;
  color: string;
  icon?: string;
}

export interface CustomFontItem {
  id: string;
  name: string;
  url: string;
  family: string;
  kind: 'file' | 'css';
  format?: string;
}

export interface FontConfig {
  activeId: string;
  customFonts: CustomFontItem[];
}

export interface LocalWallpaperItem {
  id: string;
  name: string;
  url: string;
}

export interface WeatherConfig {
  label: string;
  query: string;
  lat?: number;
  lon?: number;
  unit: 'C' | 'F';
  style?: 'standard' | 'banner';
  customText?: string;
  showFeelsLike: boolean;
  showHumidity: boolean;
  showWind: boolean;
  showPrecip: boolean;
  showPressure: boolean;
  showHiLo: boolean;
  forecastDays: 0 | 2 | 3;
  refreshMinutes: 15 | 30 | 60;
}

export interface HitokotoQuote {
  text: string;
  from: string;
  from_who: string;
  source: 'api' | 'builtin' | 'custom';
}

export interface HitokotoConfig {
  mode: 'auto' | 'api' | 'builtin';
  apiUrl: string;
  types: string[];
  autoRotate: boolean;
  intervalSeconds: 10 | 20 | 30 | 60 | 300;
  showAuthor: boolean;
  align: 'left' | 'center';
  customQuotes: string[];
}

export type MonitorMetricKey =
  | 'cpu'
  | 'ram'
  | 'disk'
  | 'swap'
  | 'load'
  | 'uptime'
  | 'temp'
  | 'processes'
  | 'orbit'
  | 'net_total';

export interface MonitorConfig {
  title: string;
  showNetSpeed: boolean;
  showSparkline: boolean;
  showLanIP: boolean;
  diskMount: string;
  columns: 2 | 3 | 4;
  metrics: MonitorMetricKey[];
  refreshSeconds: 2 | 3 | 5 | 10;
}

export interface FooterLink {
  label: string;
  url: string;
}

export interface FooterConfig {
  enabled: boolean;
  text: string;
  align: 'left' | 'center' | 'right';
  links: FooterLink[];
  showPoweredBy: boolean;
  glassBg: boolean;
}

export interface ShareScopes {
  bookmarks: boolean;
  clips: boolean;
  files: boolean;
  monitor: boolean;
  appearance: boolean;
  [key: string]: boolean;
}

export interface UserSettings {
  glassTheme: 'dark' | 'light';
  glassBlur: number;
  glassBlurMode?: 'pct';
  glassAlpha: number;
  glassRadius: number;
  bgDim: number;
  fontConfig: FontConfig;
  wallpaperMode: 'bing' | 'preset' | 'custom' | 'local';
  wallpaperPreset: number;
  wallpaperCustom: string;
  localWallpapers: LocalWallpaperItem[];
  localWallpaperRotate: boolean;
  localWallpaperIntervalMin: 5 | 15 | 30 | 60;
  bingAuto: boolean;
  enableTilt: boolean;
  showSeconds: boolean;
  dockStyle: 'card' | 'icon';
  searchIconOnly: boolean;
  allowGuest: boolean;
  weatherCity: string;
  weatherLabel: string;
  weatherConfig: WeatherConfig;
  hitokotoConfig: HitokotoConfig;
  monitorConfig: MonitorConfig;
  footer: FooterConfig;
  visibleItems: Record<string, boolean>;
  hasCustomLayout: boolean;
  layout: FreeLayoutMap | null;
  engines: SearchEngine[];
  activeEngineId: string;
}

export interface PublicConfig {
  allowGuest: boolean;
  glassTheme?: 'dark' | 'light';
  glassBlur?: number;
  glassBlurMode?: 'pct';
  glassAlpha?: number;
  glassRadius?: number;
  bgDim?: number;
  fontConfig?: FontConfig;
  wallpaperMode?: 'bing' | 'preset' | 'custom' | 'local';
  wallpaperPreset?: number;
  wallpaperCustom?: string;
  localWallpapers?: LocalWallpaperItem[];
  localWallpaperRotate?: boolean;
  localWallpaperIntervalMin?: 5 | 15 | 30 | 60;
  bingAuto?: boolean;
  enableTilt?: boolean;
  showSeconds?: boolean;
  searchIconOnly?: boolean;
  engines?: SearchEngine[];
  activeEngineId?: string;
  weatherConfig?: WeatherConfig;
  weatherCity?: string;
  weatherLabel?: string;
  hitokotoConfig?: HitokotoConfig;
  footer?: FooterConfig;
  plugins?: PluginStateRecord[];
}

export interface User {
  id: number;
  username: string;
  role: string;
  avatar?: string;
  parent_id?: number;
  share_scopes?: ShareScopes;
  api_token?: string;
  created_at: string;
}

export interface AuthStatus {
  initialized: boolean;
  authenticated: boolean;
  user: User | null;
  detected_zone: NetworkZone;
  client_ip: string;
  limits: {
    lan_mb: number;
    ts_mb: number;
    wan_mb: number;
  };
}

export interface BookmarkGroup {
  id: number;
  user_id: number;
  name: string;
  sort_order: number;
  shared?: boolean;
}

export interface Bookmark {
  id: number;
  user_id: number;
  group_id: number;
  title: string;
  description: string;
  lan_url: string;
  ts_url: string;
  wan_url: string;
  icon: string;
  color: string;
  sort_order: number;
  shared?: boolean;
}

export interface ClipItem {
  id: number;
  user_id: number;
  kind: 'text' | 'code' | 'link' | 'image';
  content: string;
  image_path: string;
  device: string;
  pinned: boolean;
  shared?: boolean;
  expires_at: string | null;
  created_at: string;
}

export interface StagedFile {
  id: number;
  user_id: number;
  orig_name: string;
  mime_type: string;
  size_bytes: number;
  zone: NetworkZone;
  uploader: string;
  shared?: boolean;
  expires_at: string;
  created_at: string;
}

export interface FilesResponse {
  files: StagedFile[];
  storage_used: number;
  storage_limit: number;
  detected_zone: NetworkZone;
  zone_limit_bytes: number;
  zone_limit_mb: number;
}

export interface PeerInfo {
  peer_id: string;
  device_name: string;
  zone: NetworkZone;
  same_lan: boolean;
  connected_at: number;
}

export interface DiskInfo {
  mount: string;
  device: string;
  total_bytes: number;
  used_bytes: number;
  percent: number;
}

export interface SystemMetrics {
  cpu_percent: number;
  cpu_history: number[];
  cpu_cores: number;
  cpu_model: string;
  cpu_temp_c: number | null;
  ram_used_bytes: number;
  ram_total_bytes: number;
  ram_percent: number;
  swap_used_bytes: number;
  swap_total_bytes: number;
  swap_percent: number;
  disk_used_bytes: number;
  disk_total_bytes: number;
  disk_percent: number;
  disk_mount: string;
  mounts: DiskInfo[];
  net_up_bps: number;
  net_down_bps: number;
  net_rx_total_bytes: number;
  net_tx_total_bytes: number;
  load1: number;
  load5: number;
  load15: number;
  uptime_seconds: number;
  processes: number;
  os_name: string;
  kernel: string;
  arch: string;
  lan_ip: string;
  tailscale_ip: string;
  orbit_alloc_mb: number;
  orbit_sys_mb: number;
  hostname: string;
}

export interface WeatherLocation {
  name: string;
  display_name: string;
  city: string;
  admin: string;
  country: string;
  lat: number;
  lon: number;
}

export interface WeatherDay {
  date: string;
  label: string;
  cond: string;
  kind: 'clear' | 'cloud' | 'rain' | 'snow' | 'storm';
  temp_min_c: number;
  temp_max_c: number;
  precip_prob: number;
}

export interface WeatherPayload {
  city: string;
  lat: number;
  lon: number;
  temp_c: number;
  feels_like_c: number;
  cond: string;
  kind: 'clear' | 'cloud' | 'rain' | 'snow' | 'storm';
  is_day: boolean;
  humidity: number;
  wind_kmh: number;
  pressure_hpa: number;
  temp_min_c: number;
  temp_max_c: number;
  precip_prob: number;
  daily: WeatherDay[];
  slots: { label: string; temp: string }[];
  updated_at: string;
  fallback: boolean;
}

export interface BingWallpaperItem {
  idx: number;
  title: string;
  url: string;
}

export interface PublicShareMeta {
  code: string;
  kind: 'file' | 'clip';
  clip_kind?: string;
  content?: string;
  file_name?: string;
  mime_type?: string;
  size_bytes?: number;
  burn_after_read: boolean;
  expires_at: string;
  download_url?: string;
}

export interface GuestSpec {
  mode: 'hidden' | 'readonly' | 'full' | 'login-prompt';
  prompt?: string;
}

export interface SharingSpec {
  shareable: boolean;
  scopeKey: string;
  label: string;
  defaultShared: boolean;
  mode: 'readonly' | 'sync';
}

export interface AccessSpec {
  minRole: 'public' | 'user' | 'admin';
  guest: GuestSpec;
  sharing?: SharingSpec;
  permissions?: string[];
}

export interface WidgetContrib {
  id: string;
  layoutKey?: string;
  label: string;
  minW: number;
  defaultW: number;
  resizable: boolean;
  defaultVisible: boolean;
}

export interface DrawerContrib {
  id: string;
  title: string;
  icon: string;
  shortcut?: string;
  topBar: boolean;
  mobileDock: boolean;
  order: number;
}

export interface SettingsContrib {
  tabId: string;
  label: string;
  icon: string;
  searchKeywords?: string[];
}

export interface SearchProviderContrib {
  enabled: boolean;
  priority: number;
}

export interface DropHandlerContrib {
  accept: string;
  priority: number;
}

export interface ContributesSpec {
  widgets?: WidgetContrib[];
  drawers?: DrawerContrib[];
  settings?: SettingsContrib;
  searchProvider?: SearchProviderContrib;
  dropHandler?: DropHandlerContrib;
}

export interface ProxyRule {
  method: string;
  url: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  public?: boolean;
}

export interface ConfigField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'url' | 'number' | 'boolean';
  placeholder?: string;
  secret?: boolean;
  defaultValue?: string;
}

export interface ExternalSpec {
  entry: string;
  renderMode: 'iframe' | 'esm';
  httpProxy?: Record<string, ProxyRule>;
  configFields?: ConfigField[];
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  icon: string;
  tier: 'builtin' | 'external';
  defaultEnabled: boolean;
  access: AccessSpec;
  contributes: ContributesSpec;
  external?: ExternalSpec;
}

export interface PluginStateRecord {
  manifest: PluginManifest;
  enabled: boolean;
  config: Record<string, unknown>;
}
