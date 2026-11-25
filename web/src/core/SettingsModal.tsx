import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  Check,
  Compass,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  FileUp,
  FolderOpen,
  Info,
  LayoutGrid,
  Loader2,
  Moon,
  Palette,
  Pencil,
  Plug,
  RotateCcw,
  Search,
  Sparkles,
  Sun,
  SunMoon,
  Trash2,
  Type as TypeIcon,
  UserCog,
  UserPlus,
  X,
} from 'lucide-react';
import { api } from '../api/client';
import {
  CDN_PRESETS,
  DEFAULT_RESOURCE_CDN,
  isBlockedUnsafeCdn,
  normalizeCdnUrl,
  resolveCdnBase,
} from '../lib/cdn';
import { BUILTIN_FONTS } from '../lib/fonts';
import { runThemeTransition } from '../lib/themeTransition';
import { PRESET_WALLPAPERS } from '../lib/wallpapers';
import { useOrbitHost } from '../sdk/host';
import {
  AppIcon,
  CenteredModal,
  IconPicker,
  OrbitSelect,
  RangeField,
  getPluginIcon,
} from '../sdk/primitives';
import type {
  CustomFontItem,
  FooterLink,
  ResourceCdnConfig,
  ResourceCdnMode,
  ShareScopes,
  ThemeMode,
  User,
  UserSettings,
} from '../types';
import { AvatarEditorModal } from './AvatarEditorModal';
import { FileManagerPanel } from './FileManagerPanel';
import { PluginCenterPanel } from './PluginCenterPanel';
import { UserAvatar } from './UserAvatar';

interface SearchableSettingItem {
  id: string;
  tab: string;
  sectionId: string;
  title: string;
  desc: string;
  keywords: string;
}

const STATIC_SEARCH_ITEMS: SearchableSettingItem[] = [
  { id: 's-theme', tab: 'appearance', sectionId: 'sec-glass', title: '日夜模式、玻璃质感与全局动画', desc: '夜间、白天、跟随系统、模糊、透明度、圆角、全局动画开关', keywords: '夜间 白天 暗色 浅色 主题 玻璃 模糊 透明 圆角 动画 动效 radius blur animation' },
  { id: 's-font', tab: 'appearance', sectionId: 'sec-font', title: '全局字体', desc: '系统原生字体、内置字体与本地/外链导入', keywords: '字体 font 系统 思源黑体 ubuntu mono oppo sans mi sans woff2 ttf' },
  { id: 's-cdn', tab: 'appearance', sectionId: 'sec-cdn', title: '资源加载与外部 CDN', desc: '默认纯本地加载，可选 jsDelivr / 国内镜像 / 自定义 CDN', keywords: 'cdn 本地 资源 镜像 jsdelivr fastly zstatic jsdmirror 离线 加速' },
  { id: 's-wallpaper', tab: 'appearance', sectionId: 'sec-wallpaper', title: '背景壁纸', desc: '本地预设、本地壁纸库、Bing 每日与外链', keywords: '壁纸 背景 bing 本地 轮换 外链' },
  { id: 's-search-icon', tab: 'search', sectionId: 'sec-search-bar', title: '搜索栏显示', desc: '仅显示搜索引擎图标', keywords: '搜索引擎 仅图标 搜索栏' },
  { id: 's-search-eng', tab: 'search', sectionId: 'sec-search-eng', title: '搜索引擎', desc: '新增/编辑引擎与图标', keywords: '引擎 google bing github bilibili 快捷键 图标' },
  { id: 's-bm-view', tab: 'bookmarks', sectionId: 'sec-bm-view', title: '书签样式与分组', desc: '卡片/图标视图与分组管理', keywords: '书签 分组 卡片 图标 视图' },
  { id: 's-bm-list', tab: 'bookmarks', sectionId: 'sec-bm-list', title: '书签列表', desc: '新增、编辑、移动与批量删除', keywords: '书签 列表 编辑 删除 批量' },
  { id: 's-bm-import', tab: 'bookmarks', sectionId: 'sec-bm-import', title: '导入书签', desc: '浏览器 HTML 与 Sun-Panel JSON', keywords: '导入 浏览器 html sun-panel json' },
  { id: 's-weather-loc', tab: 'weather', sectionId: 'sec-weather-loc', title: '天气地区', desc: '搜索城市/区县、直接定位与经纬度', keywords: '天气 地区 区县 城市 经纬度 定位 彩云 中国天气' },
  { id: 's-weather-fld', tab: 'weather', sectionId: 'sec-weather-fld', title: '天气样式与字段', desc: '经典预报、文案时钟与指标', keywords: '温度 体感 湿度 风速 样式 文案' },
  { id: 's-hitokoto-src', tab: 'hitokoto', sectionId: 'sec-hitokoto-src', title: '一言来源', desc: 'API 与内置文案库', keywords: '一言 hitokoto api 分类' },
  { id: 's-hitokoto-play', tab: 'hitokoto', sectionId: 'sec-hitokoto-play', title: '一言轮播', desc: '轮播间隔、对齐与自定义文案', keywords: '一言 轮播 自定义 文案' },
  { id: 's-mon-live', tab: 'monitor', sectionId: 'sec-mon-live', title: '宿主机实时遥测', desc: 'CPU、负载、内存、速率、节点地址与磁盘挂载点', keywords: '宿主机 遥测 详情 状态 流量 磁盘' },
  { id: 's-mon-hdr', tab: 'monitor', sectionId: 'sec-mon-hdr', title: '节点监控卡片', desc: '标题、挂载点、网速与折线图', keywords: '监控 磁盘 挂载点 网速 ip' },
  { id: 's-mon-met', tab: 'monitor', sectionId: 'sec-mon-met', title: '监控指标', desc: '指标勾选、排序与刷新间隔', keywords: 'cpu 内存 swap 负载 温度 指标' },
  { id: 's-files', tab: 'files', sectionId: 'sec-files', title: '文件管理', desc: '管理快传、壁纸、图标、字体与截图文件', keywords: '文件 管理 上传 预览 重命名 删除 存储 壁纸 图标 字体' },
  { id: 's-layout-vis', tab: 'layout', sectionId: 'sec-layout-vis', title: '组件显示与无卡片模式', desc: '显示开关、无卡片样式与自由排版', keywords: '布局 拖拽 无卡片 透明 时钟 秒数 重置' },
  { id: 's-footer', tab: 'layout', sectionId: 'sec-footer', title: '页脚设置', desc: '页脚文案与带图标的多列链接', keywords: '页脚 底部 footer 链接 图标 胶囊' },
  { id: 's-plugins-builtin', tab: 'plugins', sectionId: 'sec-plugins-builtin', title: '核心组件', desc: '导航、搜索、监控、剪贴板、快传权限与样式', keywords: '核心 组件 插件 权限 样式 启用 禁用' },
  { id: 's-plugins-ext', tab: 'plugins', sectionId: 'sec-plugins-external', title: '轻量组件与扩展', desc: '官方轻量组件与外部 .zip 扩展管理', keywords: '轻量 外部 插件 扩展 zip manifest proxy kv' },
  { id: 's-avatar', tab: 'account', sectionId: 'sec-account-self', title: '头像与密码', desc: '上传裁剪头像与修改密码', keywords: '头像 avatar 密码 安全' },
  { id: 's-token', tab: 'account', sectionId: 'sec-account-token', title: 'API Token', desc: '查看、复制与重置接口令牌', keywords: 'token api 令牌' },
  { id: 's-guest', tab: 'account', sectionId: 'sec-account-guest', title: '游客模式', desc: '允许未登录游客访问公开组件', keywords: '游客 访客 guest' },
  { id: 's-subuser', tab: 'account', sectionId: 'sec-account-users', title: '子账号管理', desc: '创建子账号与数据共享范围', keywords: '子账号 成员 共享 权限' },
  { id: 's-about', tab: 'about', sectionId: 'sec-about', title: '关于 Orbit', desc: '版本信息、项目特性与仓库地址', keywords: '关于 about github 开源 版本 version' },
];

const BASE_EMPTY_SHARES: ShareScopes = {
  bookmarks: false,
  clips: false,
  files: false,
  monitor: false,
  appearance: false,
};

const ROLE_OPTIONS = [
  { value: 'user', label: '子账号' },
  { value: 'admin', label: '管理员' },
];

export function SettingsModal() {
  const host = useOrbitHost();
  const {
    settingsOpen: open,
    settingsInitialTab,
    user,
    canViewMonitor,
    settings,
    bingItems,
    resolvedSettingsTabs,
    resolvedWidgets,
    sharingScopes,
    closeSettings: onClose,
    updateSettings: onUpdateSettings,
    isWidgetCardless,
    toggleWidgetCardless,
    startLayoutEdit: onStartLayoutEdit,
    resetLayout: onResetLayout,
    onNextBing,
    onNextLocalWallpaper,
    onUploadWallpaper,
    onDeleteLocalWallpaper,
    copyText,
    rotateToken: onRotateToken,
    uploadAvatar,
    deleteAvatar,
    toast: onToast,
  } = host;

  const [tab, setTab] = useState<string>(settingsInitialTab || 'appearance');
  const [settingQuery, setSettingQuery] = useState('');
  const [highlightSection, setHighlightSection] = useState<string | null>(null);
  const contentScrollRef = useRef<HTMLDivElement>(null);

  const [customWpUrl, setCustomWpUrl] = useState(settings.wallpaperCustom || '');
  const [customCdnUrl, setCustomCdnUrl] = useState(settings.resourceCdn?.customUrl || '');
  const [uploadingFont, setUploadingFont] = useState(false);
  const [extFontName, setExtFontName] = useState('');
  const [extFontUrl, setExtFontUrl] = useState('');

  const [newLinkLabel, setNewLinkLabel] = useState('');
  const [newLinkUrl, setNewLinkUrl] = useState('');
  const [newLinkIcon, setNewLinkIcon] = useState('');
  const [showNewLinkIconPicker, setShowNewLinkIconPicker] = useState(false);
  const [editingLinkIdx, setEditingLinkIdx] = useState<number | null>(null);
  const [editLinkDraft, setEditLinkDraft] = useState<FooterLink>({ label: '', url: '', icon: '' });

  const [showToken, setShowToken] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [oldPass, setOldPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [newPass2, setNewPass2] = useState('');
  const [changingPass, setChangingPass] = useState(false);
  const [usersList, setUsersList] = useState<User[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [createUsername, setCreateUsername] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [createRole, setCreateRole] = useState<'user' | 'admin'>('user');
  const [createShares, setCreateShares] = useState<ShareScopes>(BASE_EMPTY_SHARES);
  const [creatingUser, setCreatingUser] = useState(false);
  const [avatarDraftFile, setAvatarDraftFile] = useState<File | null>(null);
  const [avatarEditorOpen, setAvatarEditorOpen] = useState(false);
  const [removingAvatar, setRemovingAvatar] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const visiblePluginTabs = useMemo(
    () => resolvedSettingsTabs.filter((st) => !(st.tabId === 'monitor' && !canViewMonitor)),
    [canViewMonitor, resolvedSettingsTabs],
  );

  const TABS = useMemo(() => {
    const items: { id: string; label: string; icon: React.ReactNode }[] = [
      { id: 'appearance', label: '外观字体', icon: <Palette className="w-4 h-4" /> },
      ...visiblePluginTabs.map((st) => ({
        id: st.tabId,
        label: st.label,
        icon: getPluginIcon(st.icon, 'w-4 h-4'),
      })),
      { id: 'files', label: '文件管理', icon: <FolderOpen className="w-4 h-4" /> },
      { id: 'layout', label: '布局页脚', icon: <LayoutGrid className="w-4 h-4" /> },
      { id: 'plugins', label: '组件中心', icon: <Plug className="w-4 h-4" /> },
      { id: 'account', label: '账号权限', icon: <UserCog className="w-4 h-4" /> },
      { id: 'about', label: '关于', icon: <Info className="w-4 h-4" /> },
    ];
    return items;
  }, [visiblePluginTabs]);

  useEffect(() => {
    if (!open) return;
    setTab(settingsInitialTab || 'appearance');
    setSettingQuery('');
    setConfirmRotate(false);
    setCustomWpUrl(settings.wallpaperCustom || '');
    setCustomCdnUrl(settings.resourceCdn?.customUrl || '');
    setEditingLinkIdx(null);
  }, [open, settingsInitialTab, settings.wallpaperCustom, settings.resourceCdn?.customUrl]);

  useEffect(() => {
    if (!TABS.some((t) => t.id === tab)) {
      setTab('appearance');
    }
  }, [TABS, tab]);

  useEffect(() => {
    if (!open || tab !== 'account' || user?.role !== 'admin') return;
    setLoadingUsers(true);
    void api
      .listUsers()
      .then((res) => setUsersList(res.users))
      .catch((e) => onToast((e as Error).message || '加载账号列表失败', true))
      .finally(() => setLoadingUsers(false));
  }, [open, tab, user?.role, onToast]);

  const activeSearchItems = useMemo(() => {
    const tabSet = new Set(TABS.map((t) => t.id));
    const filtered = STATIC_SEARCH_ITEMS.filter((item) => tabSet.has(item.tab));
    const staticTabs = new Set(STATIC_SEARCH_ITEMS.map((i) => i.tab));
    for (const st of visiblePluginTabs) {
      if (!staticTabs.has(st.tabId)) {
        filtered.push({
          id: `ext-tab-${st.tabId}`,
          tab: st.tabId,
          sectionId: '',
          title: st.label,
          desc: st.manifest.description || st.pluginId,
          keywords: [st.label, st.pluginId, ...st.searchKeywords].join(' '),
        });
      }
    }
    return filtered;
  }, [TABS, visiblePluginTabs]);

  const searchHits = useMemo(() => {
    const q = settingQuery.trim().toLowerCase();
    if (!q) return [];
    const tokens = q.split(/\s+/).filter(Boolean);
    return activeSearchItems
      .filter((item) => {
        const hay = `${item.title} ${item.desc} ${item.keywords}`.toLowerCase();
        return tokens.every((tok) => hay.includes(tok));
      })
      .slice(0, 8);
  }, [activeSearchItems, settingQuery]);

  if (!user) return null;

  const fc = settings.footer;
  const fontCfg = settings.fontConfig || { activeId: 'system', customFonts: [] };
  const resourceCdn: ResourceCdnConfig = settings.resourceCdn || DEFAULT_RESOURCE_CDN;
  const activeCdnBase = resolveCdnBase(resourceCdn);
  const localWps = settings.localWallpapers || [];
  const clockEnabled = host.isPluginEnabled('orbit.clock');
  const activeThemeMode: ThemeMode = settings.themeMode || settings.glassTheme || 'dark';

  const inputStyle: React.CSSProperties = {
    background: 'var(--input-bg)',
    border: '1px solid var(--glass-border)',
    color: 'var(--ink)',
  };

  const jumpToSearchResult = (item: SearchableSettingItem) => {
    setTab(item.tab);
    setSettingQuery('');
    if (!item.sectionId) return;
    window.setTimeout(() => {
      const container = contentScrollRef.current;
      const target = container?.querySelector<HTMLElement>(`[data-section="${item.sectionId}"]`);
      if (target) {
        target.scrollIntoView({
          behavior: settings.enableAnimations === false ? 'auto' : 'smooth',
          block: 'start',
        });
        setHighlightSection(item.sectionId);
        window.setTimeout(() => setHighlightSection(null), 1600);
      }
    }, 60);
  };

  const sectionHighlightStyle = (sectionId: string): React.CSSProperties =>
    highlightSection === sectionId
      ? {
          boxShadow: '0 0 0 2px var(--brand)',
          borderRadius: 'var(--radius-lg)',
          padding: '8px',
          transition: 'all 220ms ease',
        }
      : { transition: 'all 220ms ease' };

  const setThemeMode = (mode: ThemeMode, ev?: React.MouseEvent<HTMLElement>) => {
    const patch: Partial<UserSettings> = { themeMode: mode };
    if (mode === 'dark' || mode === 'light') {
      patch.glassTheme = mode;
    }
    const nextResolved: 'dark' | 'light' =
      mode === 'auto'
        ? window.matchMedia?.('(prefers-color-scheme: light)').matches
          ? 'light'
          : 'dark'
        : mode;
    if (nextResolved !== host.resolvedTheme) {
      runThemeTransition(() => onUpdateSettings(patch), ev, nextResolved);
    } else {
      onUpdateSettings(patch);
    }
  };

  const updateFooter = (patch: Partial<UserSettings['footer']>) => {
    onUpdateSettings({ footer: { ...fc, ...patch } });
  };

  const handleAddFooterLink = () => {
    const label = newLinkLabel.trim();
    const url = newLinkUrl.trim();
    if (!label) {
      onToast('请填写链接名称', true);
      return;
    }
    if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
      onToast('请填写有效的 http/https 链接地址', true);
      return;
    }
    updateFooter({
      links: [
        ...fc.links,
        { label, url, icon: newLinkIcon.trim() || undefined },
      ],
    });
    setNewLinkLabel('');
    setNewLinkUrl('');
    setNewLinkIcon('');
    setShowNewLinkIconPicker(false);
    onToast('已添加页脚链接');
  };

  const handleSaveEditFooterLink = (idx: number) => {
    const label = editLinkDraft.label.trim();
    const url = editLinkDraft.url.trim();
    if (!label || (!url.startsWith('http://') && !url.startsWith('https://'))) {
      onToast('请填写有效的链接名称和 http/https 地址', true);
      return;
    }
    const next = fc.links.map((lk, i) =>
      i === idx ? { label, url, icon: editLinkDraft.icon?.trim() || undefined } : lk,
    );
    updateFooter({ links: next });
    setEditingLinkIdx(null);
    onToast('已更新页脚链接');
  };

  const handleApplyCustomWallpaper = () => {
    const url = customWpUrl.trim();
    if (!url) {
      onToast('请输入壁纸图片 URL', true);
      return;
    }
    if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('/')) {
      onToast('请输入有效的图片地址', true);
      return;
    }
    onUpdateSettings({
      wallpaperMode: 'custom',
      wallpaperCustom: url,
      bingAuto: false,
      localWallpaperRotate: false,
    });
    onToast('已应用外链壁纸');
  };

  const handleUploadFont = async (file: File) => {
    setUploadingFont(true);
    try {
      const res = await api.uploadFont(file);
      const id = `cf_${Date.now()}`;
      const family = `OrbitFont_${Date.now()}`;
      const item: CustomFontItem = {
        id,
        name: res.name || file.name,
        url: res.url,
        family,
        kind: 'file',
        format: res.format,
      };
      onUpdateSettings({
        fontConfig: {
          activeId: id,
          customFonts: [...fontCfg.customFonts, item],
        },
      });
      onToast(`已应用字体：${item.name}`);
    } catch (e) {
      onToast((e as Error).message || '字体上传失败', true);
    } finally {
      setUploadingFont(false);
    }
  };

  const handleAddExternalFont = () => {
    const url = extFontUrl.trim();
    if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
      onToast('请输入有效的 http/https 字体链接', true);
      return;
    }
    if (isBlockedUnsafeCdn(url)) {
      onToast('安全拦截：BootCDN 与 Staticfile CDN 存在投毒风险，请更换其他安全源', true);
      return;
    }
    const lower = url.toLowerCase();
    const isFile =
      lower.endsWith('.woff2') ||
      lower.endsWith('.woff') ||
      lower.endsWith('.ttf') ||
      lower.endsWith('.otf');
    const kind: 'css' | 'file' = isFile ? 'file' : 'css';
    const format = lower.endsWith('.woff2')
      ? 'woff2'
      : lower.endsWith('.woff')
        ? 'woff'
        : lower.endsWith('.ttf')
          ? 'truetype'
          : lower.endsWith('.otf')
            ? 'opentype'
            : undefined;

    let guessedName = extFontName.trim();
    if (!guessedName) {
      const m = url.match(/family=([^:&]+)/);
      guessedName = m ? decodeURIComponent(m[1]).replace(/\+/g, ' ') : '外链字体';
    }
    const id = `ef_${Date.now()}`;
    const item: CustomFontItem = {
      id,
      name: guessedName,
      url,
      family: kind === 'css' ? guessedName : `OrbitExt_${Date.now()}`,
      kind,
      format,
    };
    onUpdateSettings({
      fontConfig: {
        activeId: id,
        customFonts: [...fontCfg.customFonts, item],
      },
    });
    setExtFontName('');
    setExtFontUrl('');
    onToast(`已应用外链字体：${item.name}`);
  };

  const handleDeleteCustomFont = async (font: CustomFontItem) => {
    try {
      if (font.url.startsWith('/api/fonts/custom/')) {
        const fileName = font.url.split('/').pop() || '';
        if (fileName) await api.deleteFont(fileName);
      }
      const remaining = fontCfg.customFonts.filter((f) => f.id !== font.id);
      onUpdateSettings({
        fontConfig: {
          activeId: fontCfg.activeId === font.id ? 'system' : fontCfg.activeId,
          customFonts: remaining,
        },
      });
      onToast(`已删除字体 ${font.name}`);
    } catch (e) {
      onToast((e as Error).message || '删除字体失败', true);
    }
  };

  const handleChangePassword = async () => {
    if (!oldPass || newPass.length < 6) {
      onToast('请输入当前密码，且新密码不少于 6 位', true);
      return;
    }
    if (newPass !== newPass2) {
      onToast('两次输入的新密码不一致', true);
      return;
    }
    setChangingPass(true);
    try {
      await api.changePassword(oldPass, newPass);
      setOldPass('');
      setNewPass('');
      setNewPass2('');
      onToast('密码已更新');
    } catch (e) {
      onToast((e as Error).message || '修改密码失败', true);
    } finally {
      setChangingPass(false);
    }
  };

  const handleCreateUser = async () => {
    if (createUsername.trim().length < 2 || createPassword.length < 6) {
      onToast('用户名至少 2 位，密码至少 6 位', true);
      return;
    }
    setCreatingUser(true);
    try {
      const res = await api.createUser(
        createUsername.trim(),
        createPassword,
        createRole,
        createRole === 'admin' ? undefined : createShares,
      );
      setUsersList((prev) => [...prev, res.user]);
      setCreateUsername('');
      setCreatePassword('');
      setCreateShares(BASE_EMPTY_SHARES);
      onToast(`已创建账号 ${res.user.username}`);
    } catch (e) {
      onToast((e as Error).message || '创建账号失败', true);
    } finally {
      setCreatingUser(false);
    }
  };

  const handleToggleUserShare = async (target: User, key: string) => {
    const prev = target.share_scopes || BASE_EMPTY_SHARES;
    const next: ShareScopes = { ...BASE_EMPTY_SHARES, ...prev, [key]: !prev[key] };
    setUsersList((list) =>
      list.map((u) => (u.id === target.id ? { ...u, share_scopes: next } : u)),
    );
    try {
      await api.updateUserShares(target.id, next);
      onToast(`已更新 ${target.username} 共享范围`);
    } catch (e) {
      setUsersList((list) =>
        list.map((u) => (u.id === target.id ? { ...u, share_scopes: prev } : u)),
      );
      onToast((e as Error).message || '更新权限失败', true);
    }
  };

  const handleDeleteUser = async (target: User) => {
    try {
      await api.deleteUser(target.id);
      setUsersList((prev) => prev.filter((u) => u.id !== target.id));
      onToast(`已删除账号 ${target.username}`);
    } catch (e) {
      onToast((e as Error).message || '删除账号失败', true);
    }
  };

  const handleSelectCdnMode = (mode: ResourceCdnMode) => {
    if (mode === 'custom') {
      const candidate = customCdnUrl.trim();
      if (candidate && isBlockedUnsafeCdn(candidate)) {
        onToast('安全拦截：禁止引用 BootCDN 或 Staticfile CDN（已被恶意接管并投毒）', true);
        return;
      }
      onUpdateSettings({
        resourceCdn: {
          mode: 'custom',
          customUrl: normalizeCdnUrl(candidate),
        },
      });
      return;
    }
    onUpdateSettings({
      resourceCdn: {
        ...resourceCdn,
        mode,
      },
    });
    const preset = CDN_PRESETS.find((p) => p.id === mode);
    onToast(mode === 'local' ? '已切换为纯本地加载模式' : `已切换外部资源 CDN：${preset?.name || mode}`);
  };

  const handleApplyCustomCdn = () => {
    const raw = customCdnUrl.trim();
    if (!raw) {
      onToast('请输入 CDN 基址（例如 https://cdn.jsdelivr.net/npm）', true);
      return;
    }
    if (isBlockedUnsafeCdn(raw)) {
      onToast('安全拦截：BootCDN 与 Staticfile CDN 存在投毒风险，禁止使用', true);
      return;
    }
    const normalized = normalizeCdnUrl(raw);
    if (!normalized) {
      onToast('请输入有效的 http:// 或 https:// CDN 地址', true);
      return;
    }
    setCustomCdnUrl(normalized);
    onUpdateSettings({
      resourceCdn: {
        mode: 'custom',
        customUrl: normalized,
      },
    });
    onToast('已应用自定义 CDN 地址');
  };

  const toggleItem = (key: string, currentVisible: boolean) => {
    onUpdateSettings({
      visibleItems: { ...settings.visibleItems, [key]: !currentVisible },
    });
  };

  const activePluginTab = visiblePluginTabs.find((st) => st.tabId === tab);
  const PluginPanelComp = activePluginTab?.Component;

  return (
    <>
      <CenteredModal
        open={open}
        onClose={onClose}
        zIndexClass="z-50"
        panelClassName="w-full max-w-3xl h-[86vh] max-h-[700px] flex flex-col overflow-hidden text-xs"
      >
        <div
          className="relative z-20 px-4 py-3 border-b flex items-center gap-3 shrink-0"
          style={{ borderColor: 'var(--glass-border)' }}
        >
          <div className="shrink-0 hidden sm:flex items-center gap-2 sm:w-32">
            <span className="text-sm font-semibold">设置中心</span>
            <span className="kbd-chip font-mono text-[10px]">v{host.appVersion}</span>
          </div>
          <div className="flex-1 flex justify-center min-w-0">
            <div className="relative w-full max-w-[320px] sm:max-w-[340px]">
              <Search
                className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                style={{ color: 'var(--ink-muted)' }}
              />
              <input
                type="text"
                value={settingQuery}
                onChange={(e) => setSettingQuery(e.target.value)}
                placeholder="搜索设置..."
                className="w-full h-8 pl-8 pr-7 rounded-xl focus:outline-none"
                style={inputStyle}
              />
              {settingQuery && (
                <button
                  type="button"
                  onClick={() => setSettingQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 opacity-70 hover:opacity-100 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}

              {settingQuery.trim() && (
                <div className="absolute left-0 right-0 top-10 glass-strong rounded-2xl p-1.5 z-50 pop-in max-h-64 overflow-y-auto space-y-0.5">
                  {searchHits.length === 0 ? (
                    <div className="px-3 py-2.5 text-center" style={{ color: 'var(--ink-muted)' }}>
                      无匹配设置
                    </div>
                  ) : (
                    searchHits.map((hit) => {
                      const tabMeta = TABS.find((t) => t.id === hit.tab);
                      return (
                        <button
                          key={hit.id}
                          type="button"
                          onClick={() => jumpToSearchResult(hit)}
                          className="w-full px-3 py-2 rounded-xl flex items-center justify-between gap-2 orbit-hover cursor-pointer text-left"
                        >
                          <div className="min-w-0">
                            <div className="font-medium truncate">{hit.title}</div>
                            <div className="truncate" style={{ color: 'var(--ink-muted)' }}>
                              {hit.desc}
                            </div>
                          </div>
                          <span className="kbd-chip shrink-0">{tabMeta?.label}</span>
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="sm:w-32 flex justify-end shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg opacity-70 hover:opacity-100 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 flex flex-col md:flex-row min-h-0">
          <aside
            className="md:w-44 shrink-0 border-b md:border-b-0 md:border-r p-2.5 flex md:flex-col gap-1 overflow-x-auto"
            style={{ borderColor: 'var(--glass-border)' }}
          >
            {TABS.map((t) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className="px-3 py-2 rounded-xl flex items-center gap-2 shrink-0 cursor-pointer transition-colors"
                  style={{
                    background: active ? 'var(--brand-solid)' : 'transparent',
                    color: active ? '#fff' : 'var(--ink-muted)',
                  }}
                >
                  {t.icon}
                  <span className="font-medium">{t.label}</span>
                </button>
              );
            })}
          </aside>

          <div ref={contentScrollRef} className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5">
            {tab === 'appearance' && (
              <>
                <section data-section="sec-glass" style={sectionHighlightStyle('sec-glass')} className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-sm">日夜主题与玻璃质感</span>
                    <button
                      type="button"
                      onClick={() => {
                        onUpdateSettings({
                          glassBlur: 0,
                          glassBlurMode: 'pct',
                          glassAlpha: 40,
                          bgDim: 0,
                          glassRadius: 10,
                        });
                        onToast('已恢复默认外观参数');
                      }}
                      className="px-2.5 py-1 rounded-lg flex items-center gap-1 cursor-pointer orbit-hover"
                      style={{ background: 'var(--pill-bg)', color: 'var(--ink-muted)' }}
                      title="恢复为默认：模糊 0% · 透明 40% · 暗化 0% · 圆角 10px"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>恢复默认</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-3 gap-2.5">
                    {(
                      [
                        {
                          id: 'dark' as const,
                          label: '夜间模式',
                          icon: <Moon className="w-3.5 h-3.5" />,
                          bg: 'linear-gradient(135deg, #0f172a, #1e293b)',
                          cardBg: 'rgba(15, 23, 42, 0.72)',
                          cardBorder: 'rgba(255,255,255,0.16)',
                          bar: '#e2e8f0',
                        },
                        {
                          id: 'light' as const,
                          label: '白天模式',
                          icon: <Sun className="w-3.5 h-3.5" />,
                          bg: 'linear-gradient(135deg, #bae6fd, #e0e7ff)',
                          cardBg: 'rgba(255, 255, 255, 0.82)',
                          cardBorder: 'rgba(15,23,42,0.14)',
                          bar: '#0f172a',
                        },
                        {
                          id: 'auto' as const,
                          label: '跟随系统',
                          icon: <SunMoon className="w-3.5 h-3.5" />,
                          bg: 'linear-gradient(90deg, #0f172a 50%, #dbeafe 50%)',
                          cardBg: 'linear-gradient(90deg, rgba(15,23,42,0.75) 50%, rgba(255,255,255,0.85) 50%)',
                          cardBorder: 'rgba(148,163,184,0.35)',
                          bar: '#6366f1',
                        },
                      ] as const
                    ).map((m) => {
                      const active = activeThemeMode === m.id;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={(e) => setThemeMode(m.id, e)}
                          className="p-2 rounded-xl text-left cursor-pointer transition-all space-y-2"
                          style={{
                            background: active ? 'rgba(99, 102, 241, 0.16)' : 'var(--pill-bg)',
                            border: active
                              ? '1.5px solid var(--brand)'
                              : '1px solid var(--glass-border)',
                          }}
                        >
                          <div
                            className="h-12 rounded-lg p-2 flex items-center justify-center"
                            style={{ background: m.bg }}
                          >
                            <div
                              className="w-full h-full rounded-md px-2 flex flex-col justify-center gap-1"
                              style={{ background: m.cardBg, border: `1px solid ${m.cardBorder}` }}
                            >
                              <div className="h-1.5 w-2/3 rounded-full" style={{ background: m.bar, opacity: 0.78 }} />
                              <div className="h-1 w-1/2 rounded-full" style={{ background: m.bar, opacity: 0.42 }} />
                            </div>
                          </div>
                          <div className="flex items-center justify-between px-0.5">
                            <span className="font-medium inline-flex items-center gap-1">
                              {m.icon}
                              <span>{m.label}</span>
                            </span>
                            {active && <Check className="w-3.5 h-3.5" style={{ color: 'var(--brand)' }} />}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  <div className="grid sm:grid-cols-2 gap-3">
                    <RangeField
                      label="模糊强度"
                      value={settings.glassBlur}
                      min={0}
                      max={100}
                      unit="%"
                      onChange={(glassBlur) =>
                        onUpdateSettings({ glassBlur, glassBlurMode: 'pct' })
                      }
                    />
                    <RangeField
                      label="透明度"
                      value={settings.glassAlpha}
                      min={14}
                      max={82}
                      unit="%"
                      onChange={(glassAlpha) => onUpdateSettings({ glassAlpha })}
                    />
                    <RangeField
                      label="背景暗化"
                      value={settings.bgDim}
                      min={0}
                      max={68}
                      unit="%"
                      onChange={(bgDim) => onUpdateSettings({ bgDim })}
                    />
                    <RangeField
                      label="圆角"
                      value={settings.glassRadius ?? 10}
                      min={0}
                      max={32}
                      unit="px"
                      onChange={(glassRadius) => onUpdateSettings({ glassRadius })}
                    />
                  </div>

                  <div className="grid sm:grid-cols-2 gap-2">
                    <label
                      className="px-3 py-2.5 rounded-xl flex items-center justify-between gap-2 cursor-pointer"
                      style={{ background: 'var(--pill-bg)' }}
                    >
                      <div>
                        <div className="font-medium">全局动画效果</div>
                        <div className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                          关闭后禁用过渡、弹窗与日夜切换动效
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={settings.enableAnimations !== false}
                        onChange={(e) => onUpdateSettings({ enableAnimations: e.target.checked })}
                        className="w-4 h-4 accent-indigo-500 shrink-0"
                      />
                    </label>

                    <label
                      className={`px-3 py-2.5 rounded-xl flex items-center justify-between gap-2 ${
                        settings.enableAnimations === false
                          ? 'opacity-50 cursor-not-allowed'
                          : 'cursor-pointer'
                      }`}
                      style={{ background: 'var(--pill-bg)' }}
                    >
                      <div>
                        <div className="font-medium">3D 追光动效</div>
                        <div className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                          卡片悬停微倾与镜面高光追踪
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        disabled={settings.enableAnimations === false}
                        checked={settings.enableTilt && settings.enableAnimations !== false}
                        onChange={(e) => onUpdateSettings({ enableTilt: e.target.checked })}
                        className="w-4 h-4 accent-indigo-500 shrink-0"
                      />
                    </label>
                  </div>
                </section>

                <section
                  data-section="sec-font"
                  style={{ ...sectionHighlightStyle('sec-font'), borderColor: 'var(--glass-border)' }}
                  className="space-y-3 pt-4 border-t"
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="font-medium text-sm flex items-center gap-1.5">
                      <TypeIcon className="w-4 h-4" style={{ color: 'var(--brand)' }} />
                      <span>全局字体</span>
                      <span className="kbd-chip text-[10px]">
                        {activeCdnBase ? 'CDN 在线加载' : '纯本地模式'}
                      </span>
                    </span>
                    <label
                      className="px-3 py-1 rounded-lg cursor-pointer text-white flex items-center gap-1.5"
                      style={{ background: 'var(--brand-solid)' }}
                    >
                      {uploadingFont ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <FileUp className="w-3.5 h-3.5" />
                      )}
                      <span>导入本地字体</span>
                      <input
                        type="file"
                        accept=".woff2,.woff,.ttf,.otf"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void handleUploadFont(f);
                          e.target.value = '';
                        }}
                      />
                    </label>
                  </div>

                  {!activeCdnBase && (
                    <div
                      className="px-3 py-2 rounded-xl text-[11px]"
                      style={{ background: 'var(--pill-bg)', color: 'var(--ink-muted)' }}
                    >
                      当前默认纯本地加载，不会请求外部字体 CDN；如需加载在线字体包，可在下方「资源加载与外部 CDN」开启镜像或直接导入本地字体文件。
                    </div>
                  )}

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {BUILTIN_FONTS.map((bf) => {
                      const active = fontCfg.activeId === bf.id;
                      return (
                        <button
                          key={bf.id}
                          type="button"
                          onClick={() =>
                            onUpdateSettings({
                              fontConfig: { ...fontCfg, activeId: bf.id },
                            })
                          }
                          className="p-2.5 rounded-xl text-left cursor-pointer transition-all"
                          style={{
                            background: active ? 'var(--brand-solid)' : 'var(--pill-bg)',
                            color: active ? '#fff' : 'var(--ink)',
                            border: '1px solid var(--glass-border)',
                          }}
                        >
                          <div className="font-medium flex items-center justify-between gap-1">
                            <span className="truncate">{bf.name}</span>
                            {active && <Check className="w-3.5 h-3.5 shrink-0" />}
                          </div>
                          <div className="opacity-75 mt-0.5">{bf.desc}</div>
                        </button>
                      );
                    })}
                  </div>

                  {fontCfg.customFonts.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {fontCfg.customFonts.map((cf) => {
                        const active = fontCfg.activeId === cf.id;
                        return (
                          <div
                            key={cf.id}
                            className="px-2.5 py-1 rounded-full flex items-center gap-1.5"
                            style={{
                              background: active ? 'var(--brand-solid)' : 'var(--pill-bg)',
                              color: active ? '#fff' : 'var(--ink)',
                              border: '1px solid var(--glass-border)',
                            }}
                          >
                            <button
                              type="button"
                              onClick={() =>
                                onUpdateSettings({
                                  fontConfig: { ...fontCfg, activeId: cf.id },
                                })
                              }
                              className="cursor-pointer font-medium"
                            >
                              {cf.name}
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDeleteCustomFont(cf)}
                              className="opacity-75 hover:opacity-100 cursor-pointer"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="grid sm:grid-cols-6 gap-2">
                    <input
                      type="text"
                      value={extFontName}
                      onChange={(e) => setExtFontName(e.target.value)}
                      placeholder="名称 (如 LXGW)"
                      className="sm:col-span-2 h-8 px-2.5 rounded-lg focus:outline-none"
                      style={inputStyle}
                    />
                    <input
                      type="text"
                      value={extFontUrl}
                      onChange={(e) => setExtFontUrl(e.target.value)}
                      placeholder="外链 CSS 或字体 URL..."
                      className="sm:col-span-3 h-8 px-2.5 rounded-lg font-mono focus:outline-none"
                      style={inputStyle}
                    />
                    <button
                      type="button"
                      onClick={handleAddExternalFont}
                      className="h-8 px-3 rounded-lg cursor-pointer orbit-hover"
                      style={{ background: 'var(--pill-hover)' }}
                    >
                      添加
                    </button>
                  </div>
                </section>

                <section
                  data-section="sec-cdn"
                  style={{ ...sectionHighlightStyle('sec-cdn'), borderColor: 'var(--glass-border)' }}
                  className="space-y-3 pt-4 border-t"
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="font-medium text-sm">资源加载与外部 CDN</span>
                    <span className="kbd-chip font-mono text-[10px]">
                      {activeCdnBase ? activeCdnBase.replace(/^https?:\/\//, '') : '纯本地 · 零外链'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {CDN_PRESETS.map((preset) => {
                      const active = resourceCdn.mode === preset.id;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => handleSelectCdnMode(preset.id)}
                          className="p-2.5 rounded-xl text-left cursor-pointer transition-all space-y-1"
                          style={{
                            background: active ? 'rgba(99, 102, 241, 0.16)' : 'var(--pill-bg)',
                            border: active
                              ? '1.5px solid var(--brand)'
                              : '1px solid var(--glass-border)',
                          }}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-medium truncate">{preset.name}</span>
                            {active && <Check className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--brand)' }} />}
                          </div>
                          <div className="text-[10px] font-mono" style={{ color: 'var(--brand)' }}>
                            {preset.region}
                          </div>
                          <div className="text-[11px] leading-snug" style={{ color: 'var(--ink-muted)' }}>
                            {preset.desc}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {resourceCdn.mode === 'custom' && (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={customCdnUrl}
                        onChange={(e) => setCustomCdnUrl(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleApplyCustomCdn();
                        }}
                        placeholder="https://cdn.jsdelivr.net/npm 或自定义安全 npm 镜像基址"
                        className="flex-1 h-8 px-3 rounded-xl font-mono focus:outline-none"
                        style={inputStyle}
                      />
                      <button
                        type="button"
                        onClick={handleApplyCustomCdn}
                        className="h-8 px-3.5 rounded-xl text-white font-medium cursor-pointer shrink-0"
                        style={{ background: 'var(--brand-solid)' }}
                      >
                        应用
                      </button>
                    </div>
                  )}

                  <div className="text-[11px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
                    默认全部核心脚本、图标与预设壁纸均本地加载，不依赖任何外部网络。若需在线加载第三方字体或供扩展引用，可选用 jsDelivr、Zstatic、JSDMirror 或自建安全源（已内置安全拦截，禁止引用高危投毒源 BootCDN / Staticfile）。
                  </div>
                </section>

                <section
                  data-section="sec-wallpaper"
                  style={{ ...sectionHighlightStyle('sec-wallpaper'), borderColor: 'var(--glass-border)' }}
                  className="space-y-3 pt-4 border-t"
                >
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <span className="font-medium text-sm">背景壁纸</span>
                    <div className="flex items-center gap-2 flex-wrap">
                      <label
                        className="flex items-center gap-1.5 cursor-pointer px-2.5 py-1 rounded-lg"
                        style={{ background: 'var(--pill-bg)' }}
                      >
                        <input
                          type="checkbox"
                          checked={settings.bingAuto}
                          onChange={(e) =>
                            onUpdateSettings({
                              bingAuto: e.target.checked,
                              localWallpaperRotate: e.target.checked
                                ? false
                                : settings.localWallpaperRotate,
                              wallpaperMode: e.target.checked ? 'bing' : 'preset',
                            })
                          }
                          className="accent-indigo-500"
                        />
                        <span>Bing 每日</span>
                      </label>
                      <button
                        type="button"
                        onClick={onNextBing}
                        className="px-2.5 py-1 rounded-lg cursor-pointer orbit-hover"
                        style={{ background: 'var(--pill-hover)' }}
                      >
                        {bingItems.length > 0 ? '换一张' : '切预设'}
                      </button>
                      <label
                        className="px-2.5 py-1 rounded-lg cursor-pointer text-white"
                        style={{ background: 'var(--brand-solid)' }}
                      >
                        上传壁纸
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          className="hidden"
                          onChange={(e) => {
                            const files = Array.from(e.target.files || []);
                            files.forEach((f) => onUploadWallpaper(f));
                            e.target.value = '';
                          }}
                        />
                      </label>
                    </div>
                  </div>

                  <div className="grid grid-cols-5 gap-2">
                    {PRESET_WALLPAPERS.map((wp, idx) => (
                      <button
                        key={wp.name}
                        type="button"
                        onClick={() =>
                          onUpdateSettings({
                            wallpaperMode: 'preset',
                            bingAuto: false,
                            localWallpaperRotate: false,
                            wallpaperPreset: idx,
                          })
                        }
                        className={`h-11 rounded-xl cursor-pointer transition-all ${
                          settings.wallpaperMode === 'preset' && settings.wallpaperPreset === idx
                            ? 'ring-2 ring-indigo-400 scale-[1.02]'
                            : 'opacity-80 hover:opacity-100'
                        }`}
                        style={{ background: wp.thumb }}
                        title={wp.name}
                      />
                    ))}
                  </div>

                  <div className="p-3 rounded-xl space-y-2.5" style={{ background: 'var(--pill-bg)' }}>
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <span className="font-medium">本地壁纸 ({localWps.length})</span>
                      <div className="flex items-center gap-2 flex-wrap">
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={settings.localWallpaperRotate}
                            disabled={localWps.length < 2}
                            onChange={(e) =>
                              onUpdateSettings({
                                localWallpaperRotate: e.target.checked,
                                bingAuto: e.target.checked ? false : settings.bingAuto,
                                wallpaperMode: e.target.checked ? 'local' : settings.wallpaperMode,
                              })
                            }
                            className="accent-indigo-500"
                          />
                          <span>定时轮换</span>
                        </label>
                        {([5, 15, 30, 60] as const).map((mins) => (
                          <button
                            key={mins}
                            type="button"
                            onClick={() => onUpdateSettings({ localWallpaperIntervalMin: mins })}
                            className="px-2 py-0.5 rounded-md cursor-pointer"
                            style={{
                              background:
                                settings.localWallpaperIntervalMin === mins
                                  ? 'var(--brand-solid)'
                                  : 'var(--pill-hover)',
                              color:
                                settings.localWallpaperIntervalMin === mins
                                  ? '#fff'
                                  : 'var(--ink-muted)',
                            }}
                          >
                            {mins}m
                          </button>
                        ))}
                        {localWps.length > 0 && (
                          <button
                            type="button"
                            onClick={onNextLocalWallpaper}
                            className="px-2.5 py-0.5 rounded-md cursor-pointer orbit-hover"
                            style={{ background: 'var(--pill-hover)' }}
                          >
                            下一张
                          </button>
                        )}
                      </div>
                    </div>

                    {localWps.length === 0 ? (
                      <div className="text-center py-2" style={{ color: 'var(--ink-muted)' }}>
                        上传 ≥ 2 张本地壁纸可开启轮换
                      </div>
                    ) : (
                      <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                        {localWps.map((lw) => {
                          const active =
                            (settings.wallpaperMode === 'local' ||
                              settings.wallpaperMode === 'custom') &&
                            settings.wallpaperCustom === lw.url;
                          return (
                            <div key={lw.id} className="relative group">
                              <button
                                type="button"
                                onClick={() =>
                                  onUpdateSettings({
                                    wallpaperMode: 'local',
                                    wallpaperCustom: lw.url,
                                    bingAuto: false,
                                  })
                                }
                                title={lw.name}
                                className={`w-full h-12 rounded-lg bg-cover bg-center cursor-pointer ${
                                  active ? 'ring-2 ring-indigo-400' : 'opacity-80 hover:opacity-100'
                                }`}
                                style={{ backgroundImage: `url("${lw.url}")` }}
                              />
                              <button
                                type="button"
                                onClick={() => onDeleteLocalWallpaper(lw.url)}
                                className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-black/70 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 cursor-pointer"
                                title="删除"
                              >
                                <X className="w-2.5 h-2.5" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={customWpUrl}
                      onChange={(e) => setCustomWpUrl(e.target.value)}
                      placeholder="外链壁纸图片 URL..."
                      className="flex-1 h-8 px-3 rounded-xl font-mono focus:outline-none"
                      style={inputStyle}
                    />
                    <button
                      type="button"
                      onClick={handleApplyCustomWallpaper}
                      className="h-8 px-3 rounded-xl font-medium cursor-pointer orbit-hover"
                      style={{ background: 'var(--pill-hover)' }}
                    >
                      应用
                    </button>
                  </div>
                </section>
              </>
            )}

            {activePluginTab && PluginPanelComp && (
              <PluginPanelComp
                manifest={activePluginTab.manifest}
                record={activePluginTab.record}
                searchQuery={settingQuery}
                highlightSection={highlightSection}
              />
            )}

            {tab === 'files' && <FileManagerPanel highlightSection={highlightSection} />}

            {tab === 'layout' && (
              <>
                <section data-section="sec-layout-vis" style={sectionHighlightStyle('sec-layout-vis')} className="space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <span className="font-medium text-sm">桌面组件与卡片样式</span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onStartLayoutEdit();
                        }}
                        className="hidden md:flex px-3 py-1 rounded-lg items-center gap-1.5 text-white cursor-pointer"
                        style={{ background: 'var(--brand-solid)' }}
                      >
                        <Compass className="w-3.5 h-3.5" />
                        <span>自由布局</span>
                      </button>
                      <button
                        type="button"
                        onClick={onResetLayout}
                        className="px-3 py-1 rounded-lg flex items-center gap-1 cursor-pointer orbit-hover"
                        style={{ background: 'var(--pill-bg)' }}
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>重置</span>
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {resolvedWidgets.map((rw) => {
                      const blockedMonitor = rw.pluginId === 'orbit.monitor' && !canViewMonitor;
                      const on = rw.visible && !blockedMonitor;
                      const supportsCardless = rw.manifest.style?.supportsCardless !== false;
                      const defaultCardless = Boolean(
                        rw.record.style?.cardless ?? rw.manifest.style?.defaultCardless,
                      );
                      const plain = isWidgetCardless(rw.key, defaultCardless);
                      const label = rw.widget.label || rw.manifest.name;

                      return (
                        <div
                          key={rw.key}
                          className="p-2.5 rounded-xl flex items-center justify-between gap-2"
                          style={{
                            background: 'var(--pill-bg)',
                            border: '1px solid var(--glass-border)',
                            opacity: blockedMonitor ? 0.45 : 1,
                          }}
                        >
                          <button
                            type="button"
                            disabled={blockedMonitor}
                            onClick={() => toggleItem(rw.key, rw.visible)}
                            className="flex items-center gap-2 min-w-0 flex-1 text-left cursor-pointer"
                          >
                            <span
                              className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                              style={{
                                background: on ? 'var(--brand-solid)' : 'var(--track-bg)',
                                color: on ? '#fff' : 'var(--ink-muted)',
                              }}
                            >
                              {on ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                            </span>
                            <div className="min-w-0">
                              <div className="font-medium truncate">{label}</div>
                              <div className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                                {on ? (plain ? '无卡片' : '卡片') : '已隐藏'}
                              </div>
                            </div>
                          </button>

                          {supportsCardless && !blockedMonitor && (
                            <div
                              className="flex rounded-lg p-0.5 shrink-0"
                              style={{ background: 'var(--code-bg)' }}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  if (plain) toggleWidgetCardless(rw.key, defaultCardless);
                                }}
                                className="px-2 py-1 rounded-md flex items-center gap-1 cursor-pointer transition-colors"
                                style={{
                                  background: !plain ? 'var(--brand-solid)' : 'transparent',
                                  color: !plain ? '#fff' : 'var(--ink-muted)',
                                }}
                                title="卡片模式"
                              >
                                <span
                                  className="w-2.5 h-2 rounded-[2px] border"
                                  style={{
                                    borderColor: 'currentColor',
                                    background: 'currentColor',
                                    opacity: 0.35,
                                  }}
                                />
                                <span>卡片</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  if (!plain) toggleWidgetCardless(rw.key, defaultCardless);
                                }}
                                className="px-2 py-1 rounded-md flex items-center gap-1 cursor-pointer transition-colors"
                                style={{
                                  background: plain ? 'var(--brand-solid)' : 'transparent',
                                  color: plain ? '#fff' : 'var(--ink-muted)',
                                }}
                                title="无卡片模式（仅显示主要样式）"
                              >
                                <span
                                  className="w-2.5 h-2 rounded-[2px] border border-dashed"
                                  style={{ borderColor: 'currentColor' }}
                                />
                                <span>无卡片</span>
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {clockEnabled && (
                    <label
                      className="px-3 py-2.5 rounded-xl flex items-center justify-between cursor-pointer"
                      style={{ background: 'var(--pill-bg)' }}
                    >
                      <span>时钟显示秒数</span>
                      <input
                        type="checkbox"
                        checked={settings.showSeconds}
                        onChange={(e) => onUpdateSettings({ showSeconds: e.target.checked })}
                        className="w-4 h-4 accent-indigo-500"
                      />
                    </label>
                  )}
                </section>

                <section
                  data-section="sec-footer"
                  style={{ ...sectionHighlightStyle('sec-footer'), borderColor: 'var(--glass-border)' }}
                  className="space-y-3 pt-4 border-t"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm">页脚</span>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={fc.enabled}
                        onChange={(e) => updateFooter({ enabled: e.target.checked })}
                        className="w-4 h-4 accent-indigo-500"
                      />
                      <span>显示</span>
                    </label>
                  </div>

                  <input
                    type="text"
                    value={fc.text}
                    onChange={(e) => updateFooter({ text: e.target.value })}
                    placeholder="页脚文字 / 备案号..."
                    className="w-full h-8 px-2.5 rounded-lg focus:outline-none"
                    style={inputStyle}
                  />

                  <div className="grid grid-cols-2 gap-2">
                    <label
                      className="px-3 py-2 rounded-xl flex items-center justify-between cursor-pointer"
                      style={{ background: 'var(--pill-bg)' }}
                    >
                      <span>毛玻璃背景</span>
                      <input
                        type="checkbox"
                        checked={fc.glassBg}
                        onChange={(e) => updateFooter({ glassBg: e.target.checked })}
                        className="accent-indigo-500"
                      />
                    </label>
                    <label
                      className="px-3 py-2 rounded-xl flex items-center justify-between cursor-pointer"
                      style={{ background: 'var(--pill-bg)' }}
                    >
                      <span>Powered by Orbit</span>
                      <input
                        type="checkbox"
                        checked={fc.showPoweredBy}
                        onChange={(e) => updateFooter({ showPoweredBy: e.target.checked })}
                        className="accent-indigo-500"
                      />
                    </label>
                  </div>

                  <div className="space-y-2">
                    <div style={{ color: 'var(--ink-muted)' }}>自定义链接</div>
                    {fc.links.map((lk: FooterLink, idx: number) => {
                      const isEditing = editingLinkIdx === idx;
                      return (
                        <div
                          key={`${lk.label}-${idx}`}
                          className="px-3 py-2 rounded-xl space-y-2"
                          style={{ background: 'var(--pill-bg)', border: '1px solid var(--glass-border)' }}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0 flex items-center gap-2">
                              {lk.icon ? (
                                <AppIcon
                                  icon={lk.icon}
                                  title={lk.label}
                                  color="#6366f1"
                                  boxClass="w-5 h-5"
                                  iconClass="w-3 h-3"
                                  roundedClass="rounded"
                                />
                              ) : (
                                <ExternalLink className="w-3.5 h-3.5 shrink-0 opacity-60" />
                              )}
                              <span className="font-medium shrink-0">{lk.label}</span>
                              <span className="font-mono truncate" style={{ color: 'var(--ink-muted)' }}>
                                {lk.url}
                              </span>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() => {
                                  if (isEditing) {
                                    setEditingLinkIdx(null);
                                  } else {
                                    setEditingLinkIdx(idx);
                                    setEditLinkDraft({
                                      label: lk.label,
                                      url: lk.url,
                                      icon: lk.icon || '',
                                    });
                                  }
                                }}
                                className="p-1 rounded orbit-hover cursor-pointer"
                                title="编辑"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  if (editingLinkIdx === idx) setEditingLinkIdx(null);
                                  updateFooter({ links: fc.links.filter((_, i) => i !== idx) });
                                }}
                                className="p-1 rounded orbit-hover cursor-pointer"
                                style={{ color: 'var(--danger)' }}
                                title="删除"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                          {isEditing && (
                            <div
                              className="pt-2 border-t space-y-2"
                              style={{ borderColor: 'var(--glass-border)' }}
                            >
                              <div className="flex gap-2">
                                <input
                                  type="text"
                                  value={editLinkDraft.label}
                                  onChange={(e) =>
                                    setEditLinkDraft((p) => ({ ...p, label: e.target.value }))
                                  }
                                  placeholder="名称"
                                  className="w-28 h-8 px-2.5 rounded-lg focus:outline-none"
                                  style={inputStyle}
                                />
                                <input
                                  type="text"
                                  value={editLinkDraft.url}
                                  onChange={(e) =>
                                    setEditLinkDraft((p) => ({ ...p, url: e.target.value }))
                                  }
                                  placeholder="https://..."
                                  className="flex-1 h-8 px-2.5 rounded-lg font-mono focus:outline-none min-w-0"
                                  style={inputStyle}
                                />
                              </div>
                              <IconPicker
                                compact
                                icon={editLinkDraft.icon || ''}
                                color="#6366f1"
                                title={editLinkDraft.label || 'L'}
                                fetchTargetUrl={editLinkDraft.url}
                                onChangeIcon={(icon) =>
                                  setEditLinkDraft((p) => ({ ...p, icon }))
                                }
                                onToast={onToast}
                              />
                              <div className="flex justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => setEditingLinkIdx(null)}
                                  className="h-7 px-2.5 rounded-lg cursor-pointer"
                                  style={{ background: 'var(--pill-hover)' }}
                                >
                                  取消
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleSaveEditFooterLink(idx)}
                                  className="h-7 px-3 rounded-lg text-white cursor-pointer"
                                  style={{ background: 'var(--brand-solid)' }}
                                >
                                  保存
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    <div
                      className="p-2.5 rounded-xl space-y-2"
                      style={{ background: 'var(--pill-bg)', border: '1px solid var(--glass-border)' }}
                    >
                      <div className="flex gap-2 flex-wrap sm:flex-nowrap">
                        <input
                          type="text"
                          placeholder="链接名称"
                          value={newLinkLabel}
                          onChange={(e) => setNewLinkLabel(e.target.value)}
                          className="w-28 h-8 px-2.5 rounded-lg focus:outline-none"
                          style={inputStyle}
                        />
                        <input
                          type="text"
                          placeholder="https://..."
                          value={newLinkUrl}
                          onChange={(e) => setNewLinkUrl(e.target.value)}
                          className="flex-1 h-8 px-2.5 rounded-lg font-mono focus:outline-none min-w-0"
                          style={inputStyle}
                        />
                        <button
                          type="button"
                          onClick={() => setShowNewLinkIconPicker((v) => !v)}
                          className="h-8 px-2.5 rounded-lg cursor-pointer shrink-0 orbit-hover"
                          style={{
                            background: newLinkIcon ? 'rgba(99, 102, 241, 0.2)' : 'var(--pill-hover)',
                            color: newLinkIcon ? 'var(--brand)' : 'var(--ink)',
                          }}
                        >
                          {newLinkIcon ? '已选图标' : '图标'}
                        </button>
                        <button
                          type="button"
                          onClick={handleAddFooterLink}
                          className="h-8 px-3 rounded-lg text-white font-medium cursor-pointer shrink-0"
                          style={{ background: 'var(--brand-solid)' }}
                        >
                          + 添加
                        </button>
                      </div>

                      {showNewLinkIconPicker && (
                        <div className="pt-1 border-t" style={{ borderColor: 'var(--glass-border)' }}>
                          <IconPicker
                            compact
                            icon={newLinkIcon}
                            color="#6366f1"
                            title={newLinkLabel || 'L'}
                            fetchTargetUrl={newLinkUrl}
                            onChangeIcon={setNewLinkIcon}
                            onToast={onToast}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              </>
            )}

            {tab === 'plugins' && <PluginCenterPanel highlightSection={highlightSection} />}

            {tab === 'account' && (
              <>
                <section data-section="sec-account-self" style={sectionHighlightStyle('sec-account-self')} className="space-y-3">
                  <div
                    className="flex items-center justify-between gap-3 flex-wrap p-3 rounded-xl"
                    style={{ background: 'var(--pill-bg)' }}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <button
                        type="button"
                        onClick={() => avatarInputRef.current?.click()}
                        className="relative group rounded-full w-12 h-12 p-0 border-0 overflow-hidden block cursor-pointer shrink-0"
                        title="更换头像"
                      >
                        <UserAvatar user={user} sizeClass="w-full h-full" textClass="text-base" />
                        <span className="absolute inset-0 rounded-full bg-black/45 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity">
                          <Camera className="w-4 h-4" />
                        </span>
                      </button>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate">{user.username}</div>
                        <div style={{ color: 'var(--ink-muted)' }}>
                          {user.role === 'admin' ? '管理员' : '子账号'}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <input
                        ref={avatarInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) {
                            setAvatarDraftFile(f);
                            setAvatarEditorOpen(true);
                          }
                          e.target.value = '';
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => avatarInputRef.current?.click()}
                        className="px-3 h-8 rounded-lg flex items-center gap-1.5 font-medium text-white cursor-pointer"
                        style={{ background: 'var(--brand-solid)' }}
                      >
                        <Camera className="w-3.5 h-3.5" />
                        <span>{user.avatar ? '更换头像' : '上传头像'}</span>
                      </button>
                      {user.avatar && (
                        <button
                          type="button"
                          disabled={removingAvatar}
                          onClick={async () => {
                            setRemovingAvatar(true);
                            try {
                              await deleteAvatar();
                              setUsersList((prev) =>
                                prev.map((item) =>
                                  item.id === user.id ? { ...item, avatar: '' } : item,
                                ),
                              );
                            } catch (e) {
                              onToast((e as Error).message || '重置头像失败', true);
                            } finally {
                              setRemovingAvatar(false);
                            }
                          }}
                          className="px-2.5 h-8 rounded-lg cursor-pointer disabled:opacity-50 orbit-hover"
                          style={{ background: 'var(--pill-hover)', color: 'var(--ink-muted)' }}
                        >
                          恢复默认
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2 p-3 rounded-xl" style={{ background: 'var(--pill-bg)' }}>
                    <div className="font-medium">修改密码</div>
                    <div className="grid sm:grid-cols-3 gap-2">
                      <input
                        type="password"
                        placeholder="当前密码"
                        value={oldPass}
                        onChange={(e) => setOldPass(e.target.value)}
                        className="h-8 px-2.5 rounded-lg focus:outline-none"
                        style={inputStyle}
                      />
                      <input
                        type="password"
                        placeholder="新密码 (≥6位)"
                        value={newPass}
                        onChange={(e) => setNewPass(e.target.value)}
                        className="h-8 px-2.5 rounded-lg focus:outline-none"
                        style={inputStyle}
                      />
                      <input
                        type="password"
                        placeholder="确认新密码"
                        value={newPass2}
                        onChange={(e) => setNewPass2(e.target.value)}
                        className="h-8 px-2.5 rounded-lg focus:outline-none"
                        style={inputStyle}
                      />
                    </div>
                    <button
                      type="button"
                      disabled={changingPass}
                      onClick={() => void handleChangePassword()}
                      className="px-4 h-8 rounded-lg font-medium text-white cursor-pointer disabled:opacity-50"
                      style={{ background: 'var(--brand-solid)' }}
                    >
                      {changingPass ? '保存中...' : '保存密码'}
                    </button>
                  </div>
                </section>

                <section
                  data-section="sec-account-token"
                  style={{ ...sectionHighlightStyle('sec-account-token'), borderColor: 'var(--glass-border)' }}
                  className="space-y-2 pt-4 border-t"
                >
                  <div className="font-medium text-sm">API Token</div>
                  <div className="flex items-center gap-2 p-2.5 rounded-xl" style={{ background: 'var(--pill-bg)' }}>
                    <code className="flex-1 font-mono truncate">
                      {user.api_token
                        ? showToken
                          ? user.api_token
                          : `${user.api_token.slice(0, 8)}••••••••••••••••••••`
                        : '未生成'}
                    </code>
                    <button
                      type="button"
                      onClick={() => setShowToken((v) => !v)}
                      className="p-1.5 rounded-lg orbit-hover cursor-pointer"
                    >
                      {showToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!user.api_token) {
                          onToast('暂未生成 API Token', true);
                          return;
                        }
                        void copyText(user.api_token, '已复制 API Token');
                      }}
                      className="px-2.5 py-1 rounded-lg flex items-center gap-1 cursor-pointer orbit-hover"
                      style={{ background: 'var(--pill-hover)' }}
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>复制</span>
                    </button>
                    {!confirmRotate ? (
                      <button
                        type="button"
                        onClick={() => setConfirmRotate(true)}
                        className="px-2.5 py-1 rounded-lg cursor-pointer"
                        style={{ color: 'var(--warn)', background: 'rgba(251, 191, 36, 0.12)' }}
                      >
                        重置
                      </button>
                    ) : (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await onRotateToken();
                              setConfirmRotate(false);
                            } catch (e) {
                              onToast((e as Error).message || '重置 Token 失败', true);
                            }
                          }}
                          className="px-2.5 py-1 rounded-lg text-white cursor-pointer"
                          style={{ background: 'var(--danger)' }}
                        >
                          确认
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmRotate(false)}
                          className="px-2 py-1 rounded-lg cursor-pointer"
                          style={{ background: 'var(--pill-hover)' }}
                        >
                          取消
                        </button>
                      </div>
                    )}
                  </div>
                </section>

                {user.role === 'admin' && (
                  <>
                    <section
                      data-section="sec-account-guest"
                      style={{ ...sectionHighlightStyle('sec-account-guest'), borderColor: 'var(--glass-border)' }}
                      className="space-y-2 pt-4 border-t"
                    >
                      <label
                        className="p-3 rounded-xl flex items-center justify-between gap-3 cursor-pointer"
                        style={{ background: 'var(--pill-bg)' }}
                      >
                        <div>
                          <div className="font-medium text-sm">允许游客访问</div>
                          <div style={{ color: 'var(--ink-muted)' }}>
                            未登录访客可查看公开组件
                          </div>
                        </div>
                        <input
                          type="checkbox"
                          checked={settings.allowGuest}
                          onChange={(e) => onUpdateSettings({ allowGuest: e.target.checked })}
                          className="w-4 h-4 accent-indigo-500 shrink-0"
                        />
                      </label>
                    </section>

                    <section
                      data-section="sec-account-users"
                      style={{ ...sectionHighlightStyle('sec-account-users'), borderColor: 'var(--glass-border)' }}
                      className="space-y-3 pt-4 border-t"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-sm flex items-center gap-1.5">
                          <UserPlus className="w-4 h-4" />
                          <span>子账号管理</span>
                        </span>
                        {loadingUsers && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      </div>

                      <div className="space-y-2">
                        {usersList.map((u) => {
                          const sc = u.share_scopes || BASE_EMPTY_SHARES;
                          return (
                            <div
                              key={u.id}
                              className="p-3 rounded-xl space-y-2"
                              style={{ background: 'var(--pill-bg)' }}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  <UserAvatar user={u} sizeClass="w-6 h-6" textClass="text-[11px]" />
                                  <span className="font-medium truncate">{u.username}</span>
                                  <span className="kbd-chip shrink-0">
                                    {u.role === 'admin' ? '管理员' : '子账号'}
                                  </span>
                                </div>
                                {u.id !== user.id ? (
                                  <button
                                    type="button"
                                    onClick={() => void handleDeleteUser(u)}
                                    className="px-2 py-1 rounded-lg orbit-hover cursor-pointer flex items-center gap-1"
                                    style={{ color: 'var(--danger)' }}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    <span>删除</span>
                                  </button>
                                ) : (
                                  <span style={{ color: 'var(--ink-muted)' }}>当前</span>
                                )}
                              </div>

                              {u.role !== 'admin' && (
                                <div
                                  className="flex items-center gap-1.5 flex-wrap pt-1 border-t"
                                  style={{ borderColor: 'var(--glass-border)' }}
                                >
                                  <span style={{ color: 'var(--ink-muted)' }}>共享：</span>
                                  {sharingScopes.map(({ scopeKey, label }) => {
                                    const shortLabel =
                                      label.length > 8
                                        ? label.replace(/^共享(管理员|全局)?/, '').slice(0, 8)
                                        : label;
                                    const on = Boolean(sc[scopeKey]);
                                    return (
                                      <button
                                        key={scopeKey}
                                        type="button"
                                        title={label}
                                        onClick={() => void handleToggleUserShare(u, scopeKey)}
                                        className="px-2 py-0.5 rounded-md cursor-pointer transition-colors"
                                        style={{
                                          background: on ? 'var(--brand-solid)' : 'var(--track-bg)',
                                          color: on ? '#fff' : 'var(--ink-muted)',
                                        }}
                                      >
                                        {on ? `✓ ${shortLabel}` : shortLabel}
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      <div className="p-3 rounded-xl space-y-2.5" style={{ background: 'var(--pill-bg)' }}>
                        <div className="font-medium">新建账号</div>
                        <div className="grid sm:grid-cols-3 gap-2">
                          <input
                            type="text"
                            placeholder="用户名 (≥2位)"
                            value={createUsername}
                            onChange={(e) => setCreateUsername(e.target.value)}
                            className="h-8 px-2.5 rounded-lg focus:outline-none"
                            style={inputStyle}
                          />
                          <input
                            type="password"
                            placeholder="密码 (≥6位)"
                            value={createPassword}
                            onChange={(e) => setCreatePassword(e.target.value)}
                            className="h-8 px-2.5 rounded-lg focus:outline-none"
                            style={inputStyle}
                          />
                          <OrbitSelect
                            size="sm"
                            value={createRole}
                            options={ROLE_OPTIONS}
                            onChange={(v) => setCreateRole(v as 'user' | 'admin')}
                            className="w-full"
                            ariaLabel="账号角色"
                          />
                        </div>

                        {createRole !== 'admin' && (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span style={{ color: 'var(--ink-muted)' }}>共享：</span>
                            {sharingScopes.map(({ scopeKey, label }) => {
                              const shortLabel =
                                label.length > 8
                                  ? label.replace(/^共享(管理员|全局)?/, '').slice(0, 8)
                                  : label;
                              const on = Boolean(createShares[scopeKey]);
                              return (
                                <button
                                  key={scopeKey}
                                  type="button"
                                  title={label}
                                  onClick={() =>
                                    setCreateShares((prev) => ({
                                      ...prev,
                                      [scopeKey]: !prev[scopeKey],
                                    }))
                                  }
                                  className="px-2 py-0.5 rounded-md cursor-pointer transition-colors"
                                  style={{
                                    background: on ? 'var(--brand-solid)' : 'var(--track-bg)',
                                    color: on ? '#fff' : 'var(--ink-muted)',
                                  }}
                                >
                                  {on ? `✓ ${shortLabel}` : shortLabel}
                                </button>
                              );
                            })}
                          </div>
                        )}

                        <button
                          type="button"
                          disabled={creatingUser}
                          onClick={() => void handleCreateUser()}
                          className="px-4 h-8 rounded-lg font-medium text-white cursor-pointer disabled:opacity-50"
                          style={{ background: 'var(--brand-solid)' }}
                        >
                          {creatingUser ? '创建中...' : '创建'}
                        </button>
                      </div>
                    </section>
                  </>
                )}
              </>
            )}

            {tab === 'about' && (
              <section
                data-section="sec-about"
                style={sectionHighlightStyle('sec-about')}
                className="space-y-4"
              >
                <div
                  className="p-4 rounded-2xl flex flex-col sm:flex-row items-center sm:items-start gap-4"
                  style={{ background: 'var(--pill-bg)', border: '1px solid var(--glass-border)' }}
                >
                  <img
                    src="/apple-touch-icon.png"
                    alt="Orbit"
                    className="w-16 h-16 rounded-2xl shrink-0 shadow-md"
                  />
                  <div className="min-w-0 flex-1 text-center sm:text-left space-y-1.5">
                    <div className="flex items-center justify-center sm:justify-start gap-2 flex-wrap">
                      <h3 className="text-base font-semibold">Orbit · 星轨</h3>
                      <span className="kbd-chip font-mono" style={{ color: 'var(--brand)' }}>
                        v{host.appVersion}
                      </span>
                      <span className="kbd-chip font-mono">Apache-2.0</span>
                      <span className="kbd-chip font-mono">Go + SQLite · React</span>
                    </div>
                    <p className="leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
                      轻量化自托管个人桌面与跨端协作工作台，单一二进制运行，低内存占用。
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="font-medium text-sm flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4" style={{ color: 'var(--brand)' }} />
                    <span>核心特性</span>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-2">
                    {[
                      { title: '核心 + 轻量组件', desc: '五大核心模块与可插拔轻量扩展，统一权限与全局样式管理。' },
                      { title: '三网自适应导航', desc: 'LAN / Tailscale / WAN 智能路由切换，支持书签导入。' },
                      { title: '定向剪贴板与快传', desc: '跨端定向推送、WebRTC P2P 直传、阅后即焚与文件管理。' },
                      { title: '自由桌面与日夜模式', desc: '自由拖拽排版、无卡片样式、全局日夜切换与多账号隔离。' },
                    ].map((feat) => (
                      <div
                        key={feat.title}
                        className="p-3 rounded-xl space-y-1"
                        style={{ background: 'var(--pill-bg)', border: '1px solid var(--glass-border)' }}
                      >
                        <div className="font-medium">{feat.title}</div>
                        <div className="leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
                          {feat.desc}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div
                  className="space-y-2.5 pt-4 border-t"
                  style={{ borderColor: 'var(--glass-border)' }}
                >
                  <div className="font-medium text-sm">项目链接</div>
                  <div className="space-y-1.5">
                    <div
                      className="p-3 rounded-xl flex items-center justify-between gap-2 flex-wrap"
                      style={{ background: 'var(--pill-bg)', border: '1px solid var(--glass-border)' }}
                    >
                      <div className="min-w-0">
                        <div className="font-medium">GitHub 仓库</div>
                        <a
                          href="https://github.com/MIKU-N/Orbit"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono hover:underline break-all"
                          style={{ color: 'var(--brand)' }}
                        >
                          https://github.com/MIKU-N/Orbit
                        </a>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => void copyText('https://github.com/MIKU-N/Orbit', '已复制项目地址')}
                          className="px-2.5 h-7 rounded-lg flex items-center gap-1 cursor-pointer orbit-hover"
                          style={{ background: 'var(--pill-hover)' }}
                        >
                          <Copy className="w-3.5 h-3.5" />
                          <span>复制</span>
                        </button>
                        <a
                          href="https://github.com/MIKU-N/Orbit"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2.5 h-7 rounded-lg text-white font-medium flex items-center gap-1"
                          style={{ background: 'var(--brand-solid)' }}
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          <span>访问</span>
                        </a>
                      </div>
                    </div>

                    <div className="grid sm:grid-cols-3 gap-2">
                      {[
                        { label: 'Issues', url: 'https://github.com/MIKU-N/Orbit/issues', sub: '反馈与建议' },
                        { label: 'GHCR', url: 'https://github.com/MIKU-N/Orbit/pkgs/container/orbit', sub: 'Docker 镜像' },
                        { label: 'License', url: 'https://github.com/MIKU-N/Orbit/blob/main/LICENSE', sub: 'Apache-2.0' },
                      ].map((link) => (
                        <a
                          key={link.url}
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-2.5 rounded-xl flex items-center justify-between gap-2 orbit-hover transition-colors"
                          style={{ background: 'var(--pill-bg)', border: '1px solid var(--glass-border)' }}
                        >
                          <div className="min-w-0">
                            <div className="font-medium truncate">{link.label}</div>
                            <div className="truncate" style={{ color: 'var(--ink-muted)' }}>
                              {link.sub}
                            </div>
                          </div>
                          <ExternalLink className="w-3.5 h-3.5 shrink-0 opacity-70" />
                        </a>
                      ))}
                    </div>
                  </div>
                </div>
              </section>
            )}
          </div>
        </div>
      </CenteredModal>

      <AvatarEditorModal
        open={avatarEditorOpen}
        initialFile={avatarDraftFile}
        onClose={() => {
          setAvatarEditorOpen(false);
          setAvatarDraftFile(null);
        }}
        onSave={async (file) => {
          await uploadAvatar(file);
          if (user.role === 'admin') {
            void api
              .listUsers()
              .then((res) => setUsersList(res.users))
              .catch(() => {});
          }
        }}
        onToast={onToast}
      />
    </>
  );
}
