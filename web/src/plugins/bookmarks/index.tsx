import { api } from '../../api/client';
import { useOrbitHost } from '../../sdk/host';
import { getBookmarkActiveUrl } from '../../sdk/primitives';
import type { HostAPI, OrbitPlugin } from '../../sdk/types';
import { BookmarkDock } from './BookmarkDock';
import { BookmarksSettingsPanel } from './BookmarksSettingsPanel';

export { BookmarkModal } from './BookmarkModal';

function BookmarksPluginWidget() {
  const host = useOrbitHost();
  return (
    <BookmarkDock
      groups={host.bookmarkGroups}
      bookmarks={host.bookmarks}
      activeGroupId={host.activeGroupId}
      onSelectGroup={host.setActiveGroupId}
      dockStyle={host.settings.dockStyle}
      onChangeDockStyle={(dockStyle) => host.updateSettings({ dockStyle })}
      zone={host.zone}
      enableTilt={host.settings.enableTilt}
      layoutEditing={host.layoutEditing}
      onOpenBookmark={host.openBookmark}
      onAddBookmark={() => host.openBookmarkModal(null)}
      onEditBookmark={(bm) => host.openBookmarkModal(bm)}
      onReorderBookmarks={host.reorderBookmarks}
    />
  );
}

export const bookmarksPlugin: OrbitPlugin = {
  id: 'orbit.bookmarks',
  manifest: {
    id: 'orbit.bookmarks',
    name: '三网智能书签',
    version: '1.0.0',
    description: '支持 LAN / Tailscale / 外网自动路由与浏览器书签一键导入',
    icon: 'bookmark',
    tier: 'builtin',
    defaultEnabled: true,
    access: {
      minRole: 'user',
      guest: { mode: 'hidden' },
      sharing: {
        shareable: true,
        scopeKey: 'bookmarks',
        label: '书签',
        defaultShared: false,
        mode: 'readonly',
      },
    },
    contributes: {
      widgets: [
        {
          id: 'main',
          layoutKey: 'bookmarks',
          label: '书签',
          minW: 300,
          defaultW: 980,
          resizable: true,
          defaultVisible: true,
        },
      ],
      settings: {
        tabId: 'bookmarks',
        label: '书签管理',
        icon: 'bookmark',
        searchKeywords: ['书签', '分组', '浏览器', 'html', 'sun-panel', '导入'],
      },
      searchProvider: {
        enabled: true,
        priority: 10,
      },
    },
  },
  widgets: {
    main: BookmarksPluginWidget,
  },
  settingsPanel: BookmarksSettingsPanel,
  searchProvider: (query: string, host: HostAPI) => {
    const q = query.toLowerCase();
    return host.bookmarks
      .filter(
        (b) =>
          b.title.toLowerCase().includes(q) ||
          b.description.toLowerCase().includes(q) ||
          b.lan_url.toLowerCase().includes(q) ||
          b.wan_url.toLowerCase().includes(q),
      )
      .slice(0, 4)
      .map((b) => {
        const url = getBookmarkActiveUrl(b, host.zone);
        return {
          id: `bm-${b.id}`,
          source: 'orbit.bookmarks',
          sourceLabel: '书签',
          title: b.title,
          subtitle: (url || '仅内网').replace(/^https?:\/\//, ''),
          icon: b.icon,
          color: b.color,
          action: () => host.openBookmark(b),
        };
      });
  },
};

export async function createBookmarkGroup(host: HostAPI, name: string) {
  const res = await api.createGroup(name);
  await host.refreshBookmarks();
  return res.group;
}
