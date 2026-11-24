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
  Info,
  LayoutGrid,
  Loader2,
  Palette,
  Plug,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  Type as TypeIcon,
  UserCog,
  UserPlus,
  X,
} from 'lucide-react';
import { api } from '../api/client';
import { BUILTIN_FONTS } from '../lib/fonts';
import { PRESET_WALLPAPERS } from '../lib/wallpapers';
import { useOrbitHost } from '../sdk/host';
import { RangeField, getPluginIcon } from '../sdk/primitives';
import type { CustomFontItem, FooterLink, ShareScopes, User, UserSettings } from '../types';
import { AvatarEditorModal } from './AvatarEditorModal';
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
  { id: 's-glass', tab: 'appearance', sectionId: 'sec-glass', title: '毛玻璃主题与滑块', desc: '暗色/浅色、模糊、透明度、暗化、3D追光', keywords: '玻璃 模糊 透明 暗化 主题 追光 滑块 px blur alpha' },
  { id: 's-radius', tab: 'appearance', sectionId: 'sec-glass', title: '全局圆角大小', desc: '设置卡片/弹窗圆角 px，点击数值可直接编辑', keywords: '圆角 radius px 卡片 方圆' },
  { id: 's-font', tab: 'appearance', sectionId: 'sec-font', title: '全局字体', desc: '内置思源黑体、Ubuntu Mono、OPPO Sans 4、Mi Sans 及自定义导入', keywords: '字体 font 思源黑体 ubuntu mono oppo sans 4 mi sans woff2 ttf 外链 导入' },
  { id: 's-wallpaper', tab: 'appearance', sectionId: 'sec-wallpaper', title: '壁纸与本地轮换', desc: 'Bing每日壁纸、预设渐变、本地壁纸库与定时轮换', keywords: '壁纸 背景 bing 本地 轮换 间隔 外链' },
  { id: 's-search-icon', tab: 'search', sectionId: 'sec-search-bar', title: '仅显示搜索引擎图标', desc: '隐藏搜索引擎名称文字与下拉箭头', keywords: '搜索引擎 仅图标 极简 搜索栏' },
  { id: 's-search-eng', tab: 'search', sectionId: 'sec-search-eng', title: '搜索引擎与图标自定义', desc: '新增/编辑引擎、自动抓取图标、上传图标', keywords: '引擎 google bing github 快捷键 抓取 图标' },
  { id: 's-bm-view', tab: 'bookmarks', sectionId: 'sec-bm-view', title: '书签视图与分组', desc: '卡片/图标视图、新建分组、重命名与删除分组', keywords: '书签 分组 卡片 图标 视图 重命名' },
  { id: 's-bm-list', tab: 'bookmarks', sectionId: 'sec-bm-list', title: '书签列表、编辑与批量删除', desc: '展开查看书签、搜索筛选、新增/编辑、移动分组与批量删除', keywords: '书签 列表 编辑 修改 删除 批量 多选 移动' },
  { id: 's-bm-import', tab: 'bookmarks', sectionId: 'sec-bm-import', title: '导入浏览器书签 / Sun-Panel', desc: '导入浏览器 HTML 书签与 Sun-Panel JSON 配置', keywords: '导入 浏览器 html chrome edge firefox sun-panel json 书签' },
  { id: 's-weather-loc', tab: 'weather', sectionId: 'sec-weather-loc', title: '天气地区选择（支持到区）', desc: '按区/县搜索或自定义显示地名与经纬度', keywords: '天气 地区 区县 城市 经纬度 刷新' },
  { id: 's-weather-fld', tab: 'weather', sectionId: 'sec-weather-fld', title: '天气样式、自定义文案与字段', desc: '经典预报/文案时钟样式、自定义文案、°C/°F、体感、湿度、风速', keywords: '温度 体感 湿度 风速 降水 气压 预报 样式 自定义 文案 时钟' },
  { id: 's-hitokoto-src', tab: 'hitokoto', sectionId: 'sec-hitokoto-src', title: '一言来源与 API 设置', desc: '在线一言 API、分类筛选、自定义接口与内置精选文案', keywords: '一言 hitokoto 语录 文案 api 分类 内置' },
  { id: 's-hitokoto-play', tab: 'hitokoto', sectionId: 'sec-hitokoto-play', title: '一言轮播与自定义文案', desc: '自动轮播间隔、对齐方式、作者显示与自定义补充语录', keywords: '一言 轮播 刷新 间隔 自定义 文案 语录' },
  { id: 's-mon-hdr', tab: 'monitor', sectionId: 'sec-mon-hdr', title: '系统监控卡片与磁盘挂载点', desc: '自定义标题、实时网速、折线图、内网IP、挂载点', keywords: '监控 系统 磁盘 挂载点 网速 ip 折线图 标题' },
  { id: 's-mon-met', tab: 'monitor', sectionId: 'sec-mon-met', title: '监控指标勾选与排序', desc: 'CPU、内存、存储、Swap、负载、时长、温度、进程、Orbit、总流量', keywords: 'cpu 内存 swap 负载 温度 进程 流量 指标 排序 刷新间隔' },
  { id: 's-layout-vis', tab: 'layout', sectionId: 'sec-layout-vis', title: '桌面组件显示与自由排版', desc: '开关各插件桌面卡片、自由拖拽、秒数', keywords: '布局 拖拽 时钟 秒数 重置 组件 显示 插件' },
  { id: 's-footer', tab: 'layout', sectionId: 'sec-footer', title: '自定义页脚', desc: '页脚文字、对齐方式、毛玻璃胶囊背景、链接列表', keywords: '页脚 底部 footer 版权 链接 胶囊 对齐' },
  { id: 's-plugins-builtin', tab: 'plugins', sectionId: 'sec-plugins-builtin', title: '插件中心 · 官方标准插件', desc: '启用或禁用时钟、搜索、天气、书签、监控、剪贴板、快传插件', keywords: '插件 内置 官方 启用 禁用 启停 模块' },
  { id: 's-plugins-ext', tab: 'plugins', sectionId: 'sec-plugins-external', title: '外部轻量扩展插件与 .zip 安装', desc: '上传 .zip、安装示例扩展、配置直连代理与重载', keywords: '外部 插件 扩展 zip manifest proxy kv iframe esm 安装 卸载' },
  { id: 's-avatar', tab: 'account', sectionId: 'sec-account-self', title: '用户头像上传与裁剪编辑', desc: '上传自定义头像，支持拖动、缩放、旋转与翻转裁剪', keywords: '头像 avatar 上传 裁剪 编辑 图片 个人资料' },
  { id: 's-pass', tab: 'account', sectionId: 'sec-account-self', title: '修改密码与 API Token', desc: '密码修改、Token 复制与重置', keywords: '密码 token 账号 安全' },
  { id: 's-guest', tab: 'account', sectionId: 'sec-account-guest', title: '游客访问模式', desc: '允许未登录游客查看公开基础插件', keywords: '游客 访客 未登录 guest 访问权限' },
  { id: 's-subuser', tab: 'account', sectionId: 'sec-account-users', title: '子账号与数据共享管理', desc: '创建子账号、按插件权限声明共享数据', keywords: '子账号 成员 共享 权限 隔离 管理员' },
  { id: 's-about', tab: 'about', sectionId: 'sec-about', title: '关于 Orbit · 星轨', desc: '项目简介、核心特性、开源协议与 GitHub 仓库地址', keywords: '关于 about 项目 介绍 地址 github 仓库 开源 协议 版本 license' },
];

const BASE_EMPTY_SHARES: ShareScopes = {
  bookmarks: false,
  clips: false,
  files: false,
  monitor: false,
  appearance: false,
};

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
  const [uploadingFont, setUploadingFont] = useState(false);
  const [extFontName, setExtFontName] = useState('');
  const [extFontUrl, setExtFontUrl] = useState('');

  const [newLinkLabel, setNewLinkLabel] = useState('');
  const [newLinkUrl, setNewLinkUrl] = useState('');

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
    () =>
      resolvedSettingsTabs.filter((st) => !(st.tabId === 'monitor' && !canViewMonitor)),
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
      { id: 'layout', label: '布局页脚', icon: <LayoutGrid className="w-4 h-4" /> },
      { id: 'plugins', label: '插件中心', icon: <Plug className="w-4 h-4" /> },
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
  }, [open, settingsInitialTab, settings.wallpaperCustom]);

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
      .catch(() => {})
      .finally(() => setLoadingUsers(false));
  }, [open, tab, user?.role]);

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

  if (!open || !user) return null;

  const fc = settings.footer;
  const fontCfg = settings.fontConfig || { activeId: 'noto-sans', customFonts: [] };
  const localWps = settings.localWallpapers || [];
  const clockEnabled = host.isPluginEnabled('orbit.clock');

  const jumpToSearchResult = (item: SearchableSettingItem) => {
    setTab(item.tab);
    setSettingQuery('');
    if (!item.sectionId) return;
    window.setTimeout(() => {
      const container = contentScrollRef.current;
      const target = container?.querySelector<HTMLElement>(`[data-section="${item.sectionId}"]`);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

  const updateFooter = (patch: Partial<UserSettings['footer']>) => {
    onUpdateSettings({ footer: { ...fc, ...patch } });
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
      onToast(`已导入并应用字体：${item.name}`);
    } catch (e) {
      onToast((e as Error).message || '字体上传失败', true);
    } finally {
      setUploadingFont(false);
    }
  };

  const handleAddExternalFont = () => {
    const url = extFontUrl.trim();
    if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
      onToast('请输入有效的外链字体 URL（http/https）', true);
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
    onToast(`已导入并应用外链字体：${item.name}`);
  };

  const handleDeleteCustomFont = async (font: CustomFontItem) => {
    if (font.url.startsWith('/api/fonts/custom/')) {
      const fileName = font.url.split('/').pop() || '';
      if (fileName) {
        await api.deleteFont(fileName).catch(() => {});
      }
    }
    const remaining = fontCfg.customFonts.filter((f) => f.id !== font.id);
    onUpdateSettings({
      fontConfig: {
        activeId: fontCfg.activeId === font.id ? 'noto-sans' : fontCfg.activeId,
        customFonts: remaining,
      },
    });
    onToast(`已删除字体 ${font.name}`);
  };

  const handleChangePassword = async () => {
    if (!oldPass || newPass.length < 6) {
      onToast('请输入原密码，且新密码不少于 6 位', true);
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
      onToast((e as Error).message || '创建失败', true);
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
      onToast(`已更新 ${target.username} 的共享权限`);
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
      onToast((e as Error).message || '删除失败', true);
    }
  };

  const toggleItem = (key: string, currentVisible: boolean) => {
    onUpdateSettings({
      visibleItems: { ...settings.visibleItems, [key]: !currentVisible },
    });
  };

  const activePluginTab = visiblePluginTabs.find((st) => st.tabId === tab);
  const PluginPanelComp = activePluginTab?.Component;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-xs" onClick={onClose} />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-3xl h-[86vh] max-h-[700px] glass-strong rounded-3xl flex flex-col overflow-hidden pop-in text-xs"
      >
        <div
          className="relative z-20 px-4 py-3 border-b flex items-center gap-3 shrink-0"
          style={{ borderColor: 'var(--glass-border)' }}
        >
          <span className="text-sm font-semibold shrink-0 hidden sm:inline sm:w-24">设置中心</span>
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
                placeholder="搜索设置项..."
                className="w-full h-8 pl-8 pr-7 rounded-xl focus:outline-none"
                style={{
                  background: 'var(--pill-bg)',
                  border: '1px solid var(--glass-border)',
                  color: 'var(--ink)',
                }}
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
                      没有匹配的设置项
                    </div>
                  ) : (
                    searchHits.map((hit) => {
                      const tabMeta = TABS.find((t) => t.id === hit.tab);
                      return (
                        <button
                          key={hit.id}
                          type="button"
                          onClick={() => jumpToSearchResult(hit)}
                          className="w-full px-3 py-2 rounded-xl flex items-center justify-between gap-2 hover:bg-white/10 cursor-pointer text-left"
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
          <div className="sm:w-24 flex justify-end shrink-0">
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
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm">毛玻璃与圆角（点击数值可直接编辑 px/%）</span>
                    <div className="flex rounded-xl p-0.5" style={{ background: 'var(--pill-bg)' }}>
                      <button
                        type="button"
                        onClick={() => onUpdateSettings({ glassTheme: 'dark' })}
                        className="px-3 py-1 rounded-lg cursor-pointer"
                        style={{
                          background: settings.glassTheme === 'dark' ? 'var(--brand-solid)' : 'transparent',
                          color: settings.glassTheme === 'dark' ? '#fff' : 'var(--ink-muted)',
                        }}
                      >
                        暗色玻璃
                      </button>
                      <button
                        type="button"
                        onClick={() => onUpdateSettings({ glassTheme: 'light' })}
                        className="px-3 py-1 rounded-lg cursor-pointer"
                        style={{
                          background: settings.glassTheme === 'light' ? 'var(--brand-solid)' : 'transparent',
                          color: settings.glassTheme === 'light' ? '#fff' : 'var(--ink-muted)',
                        }}
                      >
                        浅色玻璃
                      </button>
                    </div>
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
                      label="卡片透明度"
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
                      label="全局圆角"
                      value={settings.glassRadius ?? 16}
                      min={0}
                      max={32}
                      unit="px"
                      onChange={(glassRadius) => onUpdateSettings({ glassRadius })}
                    />
                  </div>

                  <label
                    className="px-3 py-2.5 rounded-xl flex items-center justify-between cursor-pointer"
                    style={{ background: 'var(--pill-bg)' }}
                  >
                    <div>
                      <div className="font-medium">3D 追光动效</div>
                      <div style={{ color: 'var(--ink-muted)' }}>鼠标悬停卡片时启用高光追光与微倾</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.enableTilt}
                      onChange={(e) => onUpdateSettings({ enableTilt: e.target.checked })}
                      className="w-4 h-4 accent-indigo-500"
                    />
                  </label>
                </section>

                <section
                  data-section="sec-font"
                  style={{ ...sectionHighlightStyle('sec-font'), borderColor: 'var(--glass-border)' }}
                  className="space-y-3 pt-4 border-t"
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="font-medium text-sm flex items-center gap-1.5">
                      <TypeIcon className="w-4 h-4" style={{ color: 'var(--brand)' }} />
                      <span>全局字体（内置 4 款精选字体 + 自定义导入）</span>
                    </span>
                    <label
                      className="px-3 py-1 rounded-lg cursor-pointer text-white flex items-center gap-1.5"
                      style={{ background: 'var(--brand-solid)' }}
                    >
                      {uploadingFont ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileUp className="w-3.5 h-3.5" />}
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

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
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
                              {cf.name} ({cf.kind === 'css' ? '外链' : '本地'})
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
                      placeholder="外链字体名 (如 LXGW)"
                      className="sm:col-span-2 h-8 px-2.5 rounded-lg focus:outline-none"
                      style={{
                        background: 'var(--pill-bg)',
                        border: '1px solid var(--glass-border)',
                        color: 'var(--ink)',
                      }}
                    />
                    <input
                      type="text"
                      value={extFontUrl}
                      onChange={(e) => setExtFontUrl(e.target.value)}
                      placeholder="外链 CSS 或 .woff2/.ttf 链接..."
                      className="sm:col-span-3 h-8 px-2.5 rounded-lg font-mono focus:outline-none"
                      style={{
                        background: 'var(--pill-bg)',
                        border: '1px solid var(--glass-border)',
                        color: 'var(--ink)',
                      }}
                    />
                    <button
                      type="button"
                      onClick={handleAddExternalFont}
                      className="h-8 px-3 rounded-lg cursor-pointer"
                      style={{ background: 'var(--pill-hover)' }}
                    >
                      添加外链
                    </button>
                  </div>
                </section>

                <section
                  data-section="sec-wallpaper"
                  style={{ ...sectionHighlightStyle('sec-wallpaper'), borderColor: 'var(--glass-border)' }}
                  className="space-y-3 pt-4 border-t"
                >
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <span className="font-medium text-sm">背景壁纸与本地轮换</span>
                    <div className="flex items-center gap-2 flex-wrap">
                      <label className="flex items-center gap-1.5 cursor-pointer px-2.5 py-1 rounded-lg" style={{ background: 'var(--pill-bg)' }}>
                        <input
                          type="checkbox"
                          checked={settings.bingAuto}
                          onChange={(e) =>
                            onUpdateSettings({
                              bingAuto: e.target.checked,
                              localWallpaperRotate: e.target.checked ? false : settings.localWallpaperRotate,
                              wallpaperMode: e.target.checked ? 'bing' : 'preset',
                            })
                          }
                          className="accent-indigo-500"
                        />
                        <span>Bing 每日壁纸</span>
                      </label>
                      <button
                        type="button"
                        onClick={onNextBing}
                        className="px-2.5 py-1 rounded-lg cursor-pointer"
                        style={{ background: 'var(--pill-hover)' }}
                      >
                        {bingItems.length > 0 ? '换一张 Bing' : '切换预设'}
                      </button>
                      <label
                        className="px-2.5 py-1 rounded-lg cursor-pointer text-white"
                        style={{ background: 'var(--brand-solid)' }}
                      >
                        上传本地壁纸
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
                            ? 'ring-2 ring-white scale-[1.02]'
                            : 'opacity-80 hover:opacity-100'
                        }`}
                        style={{ background: wp.thumb }}
                        title={wp.name}
                      />
                    ))}
                  </div>

                  <div className="p-3 rounded-xl space-y-2.5" style={{ background: 'var(--pill-bg)' }}>
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <span className="font-medium">本地壁纸库 ({localWps.length})</span>
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
                          <span>本地定时轮换</span>
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
                              color: settings.localWallpaperIntervalMin === mins ? '#fff' : 'var(--ink-muted)',
                            }}
                          >
                            {mins}m
                          </button>
                        ))}
                        {localWps.length > 0 && (
                          <button
                            type="button"
                            onClick={onNextLocalWallpaper}
                            className="px-2.5 py-0.5 rounded-md cursor-pointer"
                            style={{ background: 'var(--pill-hover)' }}
                          >
                            下一张本地
                          </button>
                        )}
                      </div>
                    </div>

                    {localWps.length === 0 ? (
                      <div className="text-center py-2" style={{ color: 'var(--ink-muted)' }}>
                        上传 2 张及以上本地壁纸后即可开启本地壁纸自动轮换
                      </div>
                    ) : (
                      <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                        {localWps.map((lw) => {
                          const active =
                            (settings.wallpaperMode === 'local' || settings.wallpaperMode === 'custom') &&
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
                                  active ? 'ring-2 ring-white' : 'opacity-80 hover:opacity-100'
                                }`}
                                style={{ backgroundImage: `url("${lw.url}")` }}
                              />
                              <button
                                type="button"
                                onClick={() => onDeleteLocalWallpaper(lw.url)}
                                className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-black/70 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 cursor-pointer"
                                title="删除本地壁纸"
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
                      placeholder="或输入外链壁纸图片 URL..."
                      className="flex-1 h-8 px-3 rounded-xl font-mono focus:outline-none"
                      style={{
                        background: 'var(--pill-bg)',
                        border: '1px solid var(--glass-border)',
                        color: 'var(--ink)',
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (!customWpUrl.trim()) return;
                        onUpdateSettings({
                          wallpaperMode: 'custom',
                          wallpaperCustom: customWpUrl.trim(),
                          bingAuto: false,
                          localWallpaperRotate: false,
                        });
                        onToast('已应用外链壁纸');
                      }}
                      className="h-8 px-3 rounded-xl font-medium cursor-pointer"
                      style={{ background: 'var(--pill-hover)' }}
                    >
                      应用 URL
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

            {tab === 'layout' && (
              <>
                <section data-section="sec-layout-vis" style={sectionHighlightStyle('sec-layout-vis')} className="space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <span className="font-medium text-sm">组件显示与排版</span>
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
                        <span>自由拖拽布局</span>
                      </button>
                      <button
                        type="button"
                        onClick={onResetLayout}
                        className="px-3 py-1 rounded-lg flex items-center gap-1 cursor-pointer"
                        style={{ background: 'var(--pill-bg)' }}
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>重置位置</span>
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
                    {resolvedWidgets.map((rw) => {
                      const blockedMonitor = rw.pluginId === 'orbit.monitor' && !canViewMonitor;
                      const on = rw.visible && !blockedMonitor;
                      return (
                        <button
                          key={rw.key}
                          type="button"
                          disabled={blockedMonitor}
                          onClick={() => toggleItem(rw.key, rw.visible)}
                          className="py-2 px-2 rounded-xl font-medium cursor-pointer transition-colors disabled:opacity-40 truncate"
                          style={{
                            background: on ? 'var(--brand-solid)' : 'var(--pill-bg)',
                            color: on ? '#fff' : 'var(--ink-muted)',
                          }}
                          title={rw.widget.label || rw.manifest.name}
                        >
                          {rw.widget.label || rw.manifest.name}
                        </button>
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
                    <span className="font-medium text-sm">自定义页脚</span>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={fc.enabled}
                        onChange={(e) => updateFooter({ enabled: e.target.checked })}
                        className="w-4 h-4 accent-indigo-500"
                      />
                      <span>显示页脚</span>
                    </label>
                  </div>

                  <div className="grid sm:grid-cols-3 gap-2">
                    <input
                      type="text"
                      value={fc.text}
                      onChange={(e) => updateFooter({ text: e.target.value })}
                      placeholder="页脚版权文字 / 备案号..."
                      className="sm:col-span-2 h-8 px-2.5 rounded-lg focus:outline-none"
                      style={{
                        background: 'var(--pill-bg)',
                        border: '1px solid var(--glass-border)',
                        color: 'var(--ink)',
                      }}
                    />
                    <div className="flex rounded-lg p-0.5" style={{ background: 'var(--pill-bg)' }}>
                      {(
                        [
                          ['left', '左'],
                          ['center', '中'],
                          ['right', '右'],
                        ] as const
                      ).map(([al, lbl]) => (
                        <button
                          key={al}
                          type="button"
                          onClick={() => updateFooter({ align: al })}
                          className="flex-1 rounded-md cursor-pointer"
                          style={{
                            background: fc.align === al ? 'var(--brand-solid)' : 'transparent',
                            color: fc.align === al ? '#fff' : 'var(--ink-muted)',
                          }}
                        >
                          {lbl}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <label
                      className="px-3 py-2 rounded-xl flex items-center justify-between cursor-pointer"
                      style={{ background: 'var(--pill-bg)' }}
                    >
                      <span>毛玻璃胶囊背景</span>
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
                      <span>显示 Powered by Orbit</span>
                      <input
                        type="checkbox"
                        checked={fc.showPoweredBy}
                        onChange={(e) => updateFooter({ showPoweredBy: e.target.checked })}
                        className="accent-indigo-500"
                      />
                    </label>
                  </div>

                  <div className="space-y-2">
                    <div style={{ color: 'var(--ink-muted)' }}>页脚自定义链接</div>
                    {fc.links.map((lk: FooterLink, idx: number) => (
                      <div
                        key={`${lk.label}-${idx}`}
                        className="px-3 py-1.5 rounded-xl flex items-center justify-between gap-2"
                        style={{ background: 'var(--pill-bg)' }}
                      >
                        <div className="min-w-0 flex items-center gap-2">
                          <ExternalLink className="w-3 h-3 shrink-0 opacity-60" />
                          <span className="font-medium shrink-0">{lk.label}</span>
                          <span className="font-mono truncate" style={{ color: 'var(--ink-muted)' }}>
                            {lk.url}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            updateFooter({ links: fc.links.filter((_, i) => i !== idx) })
                          }
                          className="p-1 cursor-pointer"
                          style={{ color: 'var(--danger)' }}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="链接名称"
                        value={newLinkLabel}
                        onChange={(e) => setNewLinkLabel(e.target.value)}
                        className="w-28 h-8 px-2.5 rounded-lg focus:outline-none"
                        style={{
                          background: 'var(--pill-bg)',
                          border: '1px solid var(--glass-border)',
                          color: 'var(--ink)',
                        }}
                      />
                      <input
                        type="text"
                        placeholder="https://..."
                        value={newLinkUrl}
                        onChange={(e) => setNewLinkUrl(e.target.value)}
                        className="flex-1 h-8 px-2.5 rounded-lg font-mono focus:outline-none min-w-0"
                        style={{
                          background: 'var(--pill-bg)',
                          border: '1px solid var(--glass-border)',
                          color: 'var(--ink)',
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (!newLinkLabel.trim() || !newLinkUrl.trim()) return;
                          updateFooter({
                            links: [
                              ...fc.links,
                              { label: newLinkLabel.trim(), url: newLinkUrl.trim() },
                            ],
                          });
                          setNewLinkLabel('');
                          setNewLinkUrl('');
                        }}
                        className="h-8 px-3 rounded-lg cursor-pointer shrink-0"
                        style={{ background: 'var(--pill-hover)' }}
                      >
                        + 添加
                      </button>
                    </div>
                  </div>
                </section>
              </>
            )}

            {tab === 'plugins' && <PluginCenterPanel highlightSection={highlightSection} />}

            {tab === 'account' && (
              <>
                <section data-section="sec-account-self" style={sectionHighlightStyle('sec-account-self')} className="space-y-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap p-3 rounded-xl" style={{ background: 'var(--pill-bg)' }}>
                    <div className="flex items-center gap-3 min-w-0">
                      <button
                        type="button"
                        onClick={() => avatarInputRef.current?.click()}
                        className="relative group rounded-full cursor-pointer shrink-0"
                        title="点击上传并编辑头像"
                      >
                        <UserAvatar user={user} sizeClass="w-12 h-12" textClass="text-base" />
                        <span className="absolute inset-0 rounded-full bg-black/45 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity">
                          <Camera className="w-4 h-4" />
                        </span>
                      </button>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate">{user.username}</div>
                        <div className="font-mono" style={{ color: 'var(--ink-muted)' }}>
                          {user.role === 'admin' ? '管理员 (Admin)' : '子账号 (Sub-account)'} · JWT 会话
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
                          className="px-2.5 h-8 rounded-lg cursor-pointer disabled:opacity-50"
                          style={{ background: 'var(--pill-hover)', color: 'var(--ink-muted)' }}
                        >
                          恢复默认
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2 p-3 rounded-xl" style={{ background: 'var(--pill-bg)' }}>
                    <div className="font-medium">修改登录密码</div>
                    <div className="grid sm:grid-cols-3 gap-2">
                      <input
                        type="password"
                        placeholder="当前密码"
                        value={oldPass}
                        onChange={(e) => setOldPass(e.target.value)}
                        className="h-8 px-2.5 rounded-lg focus:outline-none"
                        style={{
                          background: 'rgba(var(--glass-rgb), 0.5)',
                          border: '1px solid var(--glass-border)',
                          color: 'var(--ink)',
                        }}
                      />
                      <input
                        type="password"
                        placeholder="新密码 (≥6位)"
                        value={newPass}
                        onChange={(e) => setNewPass(e.target.value)}
                        className="h-8 px-2.5 rounded-lg focus:outline-none"
                        style={{
                          background: 'rgba(var(--glass-rgb), 0.5)',
                          border: '1px solid var(--glass-border)',
                          color: 'var(--ink)',
                        }}
                      />
                      <input
                        type="password"
                        placeholder="确认新密码"
                        value={newPass2}
                        onChange={(e) => setNewPass2(e.target.value)}
                        className="h-8 px-2.5 rounded-lg focus:outline-none"
                        style={{
                          background: 'rgba(var(--glass-rgb), 0.5)',
                          border: '1px solid var(--glass-border)',
                          color: 'var(--ink)',
                        }}
                      />
                    </div>
                    <button
                      type="button"
                      disabled={changingPass}
                      onClick={() => void handleChangePassword()}
                      className="px-4 h-8 rounded-lg font-medium text-white cursor-pointer disabled:opacity-50"
                      style={{ background: 'var(--brand-solid)' }}
                    >
                      {changingPass ? '提交中...' : '保存新密码'}
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
                      className="p-1.5 rounded-lg hover:bg-white/10 cursor-pointer"
                    >
                      {showToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => user.api_token && copyText(user.api_token, '已复制 API Token')}
                      className="px-2.5 py-1 rounded-lg flex items-center gap-1 cursor-pointer"
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
                            await onRotateToken();
                            setConfirmRotate(false);
                          }}
                          className="px-2.5 py-1 rounded-lg text-white cursor-pointer"
                          style={{ background: 'var(--danger)' }}
                        >
                          确认重置
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
                          <div className="font-medium text-sm">允许游客直接访问首页</div>
                          <div style={{ color: 'var(--ink-muted)' }}>
                            开启后未登录访客可直接查看基础天气、搜索与登录入口；私有书签、监控、剪贴板与上传隐藏并提示需要登录
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
                          <span>子账号与信息共享管理</span>
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
                                    className="px-2 py-1 rounded-lg hover:bg-white/10 cursor-pointer flex items-center gap-1"
                                    style={{ color: 'var(--danger)' }}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    <span>删除</span>
                                  </button>
                                ) : (
                                  <span style={{ color: 'var(--ink-muted)' }}>当前账号</span>
                                )}
                              </div>

                              {u.role !== 'admin' && (
                                <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t" style={{ borderColor: 'var(--glass-border)' }}>
                                  <span style={{ color: 'var(--ink-muted)' }}>共享给此子账号：</span>
                                  {sharingScopes.map(({ scopeKey, label }) => {
                                    const shortLabel = label.length > 8 ? label.replace(/^共享(管理员|全局)?/, '').slice(0, 8) : label;
                                    const on = Boolean(sc[scopeKey]);
                                    return (
                                      <button
                                        key={scopeKey}
                                        type="button"
                                        title={label}
                                        onClick={() => void handleToggleUserShare(u, scopeKey)}
                                        className="px-2 py-0.5 rounded-md cursor-pointer transition-colors"
                                        style={{
                                          background: on ? 'var(--brand-solid)' : 'rgba(255,255,255,0.06)',
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
                        <div className="font-medium">新建子账号（默认不共享任何信息）</div>
                        <div className="grid sm:grid-cols-3 gap-2">
                          <input
                            type="text"
                            placeholder="用户名 (≥2位)"
                            value={createUsername}
                            onChange={(e) => setCreateUsername(e.target.value)}
                            className="h-8 px-2.5 rounded-lg focus:outline-none"
                            style={{
                              background: 'rgba(var(--glass-rgb), 0.5)',
                              border: '1px solid var(--glass-border)',
                              color: 'var(--ink)',
                            }}
                          />
                          <input
                            type="password"
                            placeholder="密码 (≥6位)"
                            value={createPassword}
                            onChange={(e) => setCreatePassword(e.target.value)}
                            className="h-8 px-2.5 rounded-lg focus:outline-none"
                            style={{
                              background: 'rgba(var(--glass-rgb), 0.5)',
                              border: '1px solid var(--glass-border)',
                              color: 'var(--ink)',
                            }}
                          />
                          <select
                            value={createRole}
                            onChange={(e) => setCreateRole(e.target.value as 'user' | 'admin')}
                            className="h-8 px-2.5 rounded-lg focus:outline-none"
                            style={{
                              background: 'rgba(var(--glass-rgb), 0.78)',
                              border: '1px solid var(--glass-border)',
                              color: 'var(--ink)',
                            }}
                          >
                            <option value="user">子账号（默认隔离）</option>
                            <option value="admin">管理员</option>
                          </select>
                        </div>

                        {createRole !== 'admin' && (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span style={{ color: 'var(--ink-muted)' }}>可选共享信息：</span>
                            {sharingScopes.map(({ scopeKey, label }) => {
                              const shortLabel = label.length > 8 ? label.replace(/^共享(管理员|全局)?/, '').slice(0, 8) : label;
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
                                    background: on ? 'var(--brand-solid)' : 'rgba(255,255,255,0.06)',
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
                          {creatingUser ? '创建中...' : '创建子账号'}
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
                    alt="Orbit · 星轨 Logo"
                    className="w-16 h-16 rounded-2xl shrink-0 shadow-md"
                  />
                  <div className="min-w-0 flex-1 text-center sm:text-left space-y-1.5">
                    <div className="flex items-center justify-center sm:justify-start gap-2 flex-wrap">
                      <h3 className="text-base font-semibold">Orbit · 星轨</h3>
                      <span className="kbd-chip font-mono">Apache-2.0</span>
                      <span className="kbd-chip font-mono">Go + SQLite · React</span>
                    </div>
                    <div className="font-medium" style={{ color: 'var(--brand)' }}>
                      极轻量自托管个人轨道与桌面工作台
                    </div>
                    <p className="leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
                      Orbit 是一款面向个人服务器、NAS 与家庭实验室的自托管轻量主页与跨端协作工作台。后端采用
                      Go 与纯 Go SQLite 驱动，前端内嵌于单一静态二进制文件中，无需外部数据库依赖，日常运行内存仅约
                      10–25 MB。
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
                      {
                        title: '微内核与双层插件架构',
                        desc: '内置 8 个可独立启停的官方插件，并支持上传外部 .zip 沙箱扩展微件与内网代理。',
                      },
                      {
                        title: '三网自适应路由书签',
                        desc: '同时配置 LAN / Tailscale / WAN 三套地址自动路由，支持浏览器 HTML 与 Sun-Panel 导入。',
                      },
                      {
                        title: '实时跨端云剪贴板',
                        desc: '基于 WebSocket 多端毫秒级同步文本与截图，支持 API Token 终端一键推送。',
                      },
                      {
                        title: 'P2P 快传与暂存箱',
                        desc: '同局域网浏览器支持 WebRTC P2P 直传，外网自动限额暂存并提供 6 位阅后即焚取件码。',
                      },
                      {
                        title: '节点监控与实时天气',
                        desc: '宿主机 CPU / 内存 / 磁盘 / 温度 / 网速遥测，以及精确到区县的多日天气预报。',
                      },
                      {
                        title: '自由毛玻璃桌面与多账号',
                        desc: '桌面组件自由拖拽排版、全局圆角字体壁纸定制、访客模式与子账号细粒度数据共享。',
                      },
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
                  <div className="font-medium text-sm">项目地址与相关链接</div>
                  <div className="space-y-1.5">
                    <div
                      className="p-3 rounded-xl flex items-center justify-between gap-2 flex-wrap"
                      style={{ background: 'var(--pill-bg)', border: '1px solid var(--glass-border)' }}
                    >
                      <div className="min-w-0">
                        <div className="font-medium">GitHub 项目仓库</div>
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
                          onClick={() => copyText('https://github.com/MIKU-N/Orbit', '已复制项目地址')}
                          className="px-2.5 h-7 rounded-lg flex items-center gap-1 cursor-pointer"
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
                          <span>访问仓库</span>
                        </a>
                      </div>
                    </div>

                    <div className="grid sm:grid-cols-3 gap-2">
                      {[
                        {
                          label: '问题反馈 (Issues)',
                          url: 'https://github.com/MIKU-N/Orbit/issues',
                          sub: '提交 Bug 或功能建议',
                        },
                        {
                          label: 'Docker 镜像 (GHCR)',
                          url: 'https://github.com/MIKU-N/Orbit/pkgs/container/orbit',
                          sub: 'amd64 / arm64 多架构镜像',
                        },
                        {
                          label: '开源协议 (License)',
                          url: 'https://github.com/MIKU-N/Orbit/blob/main/LICENSE',
                          sub: 'Apache License 2.0',
                        },
                      ].map((link) => (
                        <a
                          key={link.url}
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-2.5 rounded-xl flex items-center justify-between gap-2 hover:bg-white/10 transition-colors"
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
      </div>

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
    </div>
  );
}
