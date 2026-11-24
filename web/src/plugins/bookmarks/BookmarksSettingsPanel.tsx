import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FolderInput,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useOrbitHost } from '../../sdk/host';
import { AppIcon, IconPicker, getBookmarkActiveUrl } from '../../sdk/primitives';
import type { Bookmark } from '../../types';
import type { SettingsPanelProps } from '../../sdk/types';

interface BookmarkDraft {
  title: string;
  description: string;
  group_id: number;
  lan_url: string;
  ts_url: string;
  wan_url: string;
  icon: string;
  color: string;
}

function emptyDraft(defaultGroupId: number): BookmarkDraft {
  return {
    title: '',
    description: '',
    group_id: defaultGroupId,
    lan_url: '',
    ts_url: '',
    wan_url: '',
    icon: 'globe',
    color: '#6366f1',
  };
}

function draftFromBookmark(bm: Bookmark): BookmarkDraft {
  return {
    title: bm.title,
    description: bm.description || '',
    group_id: bm.group_id,
    lan_url: bm.lan_url || '',
    ts_url: bm.ts_url || '',
    wan_url: bm.wan_url || '',
    icon: bm.icon || 'globe',
    color: bm.color || '#6366f1',
  };
}

export function BookmarksSettingsPanel({ highlightSection }: SettingsPanelProps) {
  const host = useOrbitHost();
  const {
    settings,
    updateSettings,
    bookmarks,
    bookmarkGroups: groups,
    zone,
    createGroup,
    updateGroup,
    deleteGroup,
    saveBookmark,
    deleteBookmark,
    batchDeleteBookmarks,
    batchMoveBookmarks,
    importBrowserBookmarks,
    importSunPanel,
    toast,
  } = host;

  // Group management state
  const [newGroupName, setNewGroupName] = useState('');
  const [editingGroupId, setEditingGroupId] = useState<number | null>(null);
  const [editingGroupName, setEditingGroupName] = useState('');
  const [confirmDeleteGroupId, setConfirmDeleteGroupId] = useState<number | null>(null);

  // Expandable bookmark list & editing state
  const [listExpanded, setListExpanded] = useState(true);
  const [filterGroupId, setFilterGroupId] = useState<number | 'all'>('all');
  const [searchText, setSearchText] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [confirmBatchDelete, setConfirmBatchDelete] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const [moveTargetGroupId, setMoveTargetGroupId] = useState<number>(0);

  // Inline create / edit bookmark state
  const [creatingNew, setCreatingNew] = useState(false);
  const [newDraft, setNewDraft] = useState<BookmarkDraft>(() => emptyDraft(0));
  const [savingNew, setSavingNew] = useState(false);

  const [expandedBookmarkId, setExpandedBookmarkId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<BookmarkDraft | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  // Import state
  const [importTab, setImportTab] = useState<'sunpanel' | 'browser'>('sunpanel');
  const [browserHtml, setBrowserHtml] = useState('');
  const [browserGroupName, setBrowserGroupName] = useState('浏览器书签');
  const [importingBrowser, setImportingBrowser] = useState(false);
  const [sunPanelText, setSunPanelText] = useState('');
  const [importingSunPanel, setImportingSunPanel] = useState(false);

  const ownGroups = useMemo(() => groups.filter((g) => !g.shared), [groups]);
  const groupNameMap = useMemo(() => new Map(groups.map((g) => [g.id, g.name])), [groups]);
  const groupCountMap = useMemo(() => {
    const counts = new Map<number, number>();
    for (const bm of bookmarks) {
      counts.set(bm.group_id, (counts.get(bm.group_id) || 0) + 1);
    }
    return counts;
  }, [bookmarks]);

  useEffect(() => {
    if (ownGroups.length > 0 && (!moveTargetGroupId || !ownGroups.some((g) => g.id === moveTargetGroupId))) {
      setMoveTargetGroupId(ownGroups[0].id);
    }
  }, [ownGroups, moveTargetGroupId]);

  useEffect(() => {
    if (filterGroupId !== 'all' && !groups.some((g) => g.id === filterGroupId)) {
      setFilterGroupId('all');
    }
  }, [filterGroupId, groups]);

  useEffect(() => {
    const ownIdSet = new Set(bookmarks.filter((b) => !b.shared).map((b) => b.id));
    setSelectedIds((prev) => {
      let changed = false;
      const next = new Set<number>();
      for (const id of prev) {
        if (ownIdSet.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
    if (expandedBookmarkId !== null && !bookmarks.some((b) => b.id === expandedBookmarkId)) {
      setExpandedBookmarkId(null);
      setEditDraft(null);
    }
  }, [bookmarks, expandedBookmarkId]);

  const filteredBookmarks = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return bookmarks.filter((bm) => {
      if (filterGroupId !== 'all' && bm.group_id !== filterGroupId) return false;
      if (!q) return true;
      const gName = (groupNameMap.get(bm.group_id) || '').toLowerCase();
      return (
        bm.title.toLowerCase().includes(q) ||
        (bm.description || '').toLowerCase().includes(q) ||
        (bm.lan_url || '').toLowerCase().includes(q) ||
        (bm.ts_url || '').toLowerCase().includes(q) ||
        (bm.wan_url || '').toLowerCase().includes(q) ||
        gName.includes(q)
      );
    });
  }, [bookmarks, filterGroupId, searchText, groupNameMap]);

  const filteredOwnBookmarks = useMemo(
    () => filteredBookmarks.filter((b) => !b.shared),
    [filteredBookmarks],
  );

  const allFilteredOwnSelected =
    filteredOwnBookmarks.length > 0 &&
    filteredOwnBookmarks.every((b) => selectedIds.has(b.id));

  const toggleSelectAllFiltered = () => {
    setConfirmBatchDelete(false);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allFilteredOwnSelected) {
        for (const bm of filteredOwnBookmarks) next.delete(bm.id);
      } else {
        for (const bm of filteredOwnBookmarks) next.add(bm.id);
      }
      return next;
    });
  };

  const toggleSelectBookmark = (id: number) => {
    setConfirmBatchDelete(false);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openExpandBookmark = (bm: Bookmark) => {
    if (expandedBookmarkId === bm.id) {
      setExpandedBookmarkId(null);
      setEditDraft(null);
      return;
    }
    setCreatingNew(false);
    setExpandedBookmarkId(bm.id);
    setEditDraft(bm.shared ? null : draftFromBookmark(bm));
  };

  const handleStartCreate = () => {
    setListExpanded(true);
    setExpandedBookmarkId(null);
    setEditDraft(null);
    const defaultGid =
      filterGroupId !== 'all' && ownGroups.some((g) => g.id === filterGroupId)
        ? filterGroupId
        : ownGroups[0]?.id || 0;
    setNewDraft(emptyDraft(defaultGid));
    setCreatingNew(true);
  };

  const handleCreateBookmark = async () => {
    if (!newDraft.title.trim()) {
      toast('请填写书签名称', true);
      return;
    }
    setSavingNew(true);
    try {
      await saveBookmark({
        group_id: newDraft.group_id || ownGroups[0]?.id || 0,
        title: newDraft.title.trim(),
        description: newDraft.description.trim(),
        lan_url: newDraft.lan_url.trim(),
        ts_url: newDraft.ts_url.trim(),
        wan_url: newDraft.wan_url.trim(),
        icon: newDraft.icon.trim() || 'globe',
        color: newDraft.color || '#6366f1',
      });
      setCreatingNew(false);
    } catch (e) {
      toast((e as Error).message || '添加书签失败', true);
    } finally {
      setSavingNew(false);
    }
  };

  const handleSaveEdit = async (bmId: number) => {
    if (!editDraft || !editDraft.title.trim()) {
      toast('请填写书签名称', true);
      return;
    }
    setSavingEdit(true);
    try {
      await saveBookmark(
        {
          group_id: editDraft.group_id || ownGroups[0]?.id || 0,
          title: editDraft.title.trim(),
          description: editDraft.description.trim(),
          lan_url: editDraft.lan_url.trim(),
          ts_url: editDraft.ts_url.trim(),
          wan_url: editDraft.wan_url.trim(),
          icon: editDraft.icon.trim() || 'globe',
          color: editDraft.color || '#6366f1',
        },
        bmId,
      );
      setExpandedBookmarkId(null);
      setEditDraft(null);
    } catch (e) {
      toast((e as Error).message || '更新书签失败', true);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    setBatchBusy(true);
    try {
      await batchDeleteBookmarks(Array.from(selectedIds));
      setSelectedIds(new Set());
      setConfirmBatchDelete(false);
    } catch (e) {
      toast((e as Error).message || '批量删除失败', true);
    } finally {
      setBatchBusy(false);
    }
  };

  const handleBatchMove = async () => {
    if (selectedIds.size === 0 || !moveTargetGroupId) return;
    setBatchBusy(true);
    try {
      await batchMoveBookmarks(Array.from(selectedIds), moveTargetGroupId);
      setSelectedIds(new Set());
    } catch (e) {
      toast((e as Error).message || '批量移动失败', true);
    } finally {
      setBatchBusy(false);
    }
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

  const inputStyle: React.CSSProperties = {
    background: 'rgba(var(--glass-rgb), 0.5)',
    border: '1px solid var(--glass-border)',
    color: 'var(--ink)',
  };

  const renderDraftForm = (
    draft: BookmarkDraft,
    setDraft: (next: BookmarkDraft) => void,
    saving: boolean,
    submitLabel: string,
    onSubmit: () => void,
    onCancel: () => void,
  ) => {
    const fetchTargetUrl = draft.lan_url.trim() || draft.ts_url.trim() || draft.wan_url.trim();
    return (
      <div
        className="p-3 rounded-xl space-y-2.5"
        style={{ background: 'rgba(var(--glass-rgb), 0.35)', border: '1px solid var(--glass-border)' }}
      >
        <div className="grid sm:grid-cols-2 gap-2">
          <input
            type="text"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="书签名称 *"
            className="h-8 px-2.5 rounded-lg focus:outline-none"
            style={inputStyle}
          />
          <select
            value={draft.group_id}
            onChange={(e) => setDraft({ ...draft, group_id: Number(e.target.value) })}
            className="h-8 px-2.5 rounded-lg focus:outline-none"
            style={{
              background: 'rgba(var(--glass-rgb), 0.78)',
              border: '1px solid var(--glass-border)',
              color: 'var(--ink)',
            }}
          >
            {ownGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>

        <input
          type="text"
          value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          placeholder="简介 / 备注 (可选)"
          className="w-full h-8 px-2.5 rounded-lg focus:outline-none"
          style={inputStyle}
        />

        <div className="grid sm:grid-cols-3 gap-2">
          <input
            type="text"
            value={draft.lan_url}
            onChange={(e) => setDraft({ ...draft, lan_url: e.target.value })}
            placeholder="内网 LAN URL"
            className="h-8 px-2.5 rounded-lg font-mono focus:outline-none"
            style={inputStyle}
          />
          <input
            type="text"
            value={draft.ts_url}
            onChange={(e) => setDraft({ ...draft, ts_url: e.target.value })}
            placeholder="Tailscale URL"
            className="h-8 px-2.5 rounded-lg font-mono focus:outline-none"
            style={inputStyle}
          />
          <input
            type="text"
            value={draft.wan_url}
            onChange={(e) => setDraft({ ...draft, wan_url: e.target.value })}
            placeholder="外网 WAN URL"
            className="h-8 px-2.5 rounded-lg font-mono focus:outline-none"
            style={inputStyle}
          />
        </div>

        <IconPicker
          compact
          icon={draft.icon}
          color={draft.color}
          title={draft.title || 'B'}
          fetchTargetUrl={fetchTargetUrl}
          onChangeIcon={(icon) => setDraft({ ...draft, icon })}
          onChangeColor={(color) => setDraft({ ...draft, color })}
          onToast={toast}
        />

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            disabled={saving}
            onClick={onCancel}
            className="h-7 px-3 rounded-lg cursor-pointer"
            style={{ background: 'var(--pill-bg)' }}
          >
            取消
          </button>
          <button
            type="button"
            disabled={saving || !draft.title.trim()}
            onClick={onSubmit}
            className="h-7 px-3.5 rounded-lg font-medium text-white flex items-center gap-1 cursor-pointer disabled:opacity-50"
            style={{ background: 'var(--brand-solid)' }}
          >
            {saving && <Loader2 className="w-3 h-3 animate-spin" />}
            <span>{saving ? '保存中...' : submitLabel}</span>
          </button>
        </div>
      </div>
    );
  };

  return (
    <>
      <section data-section="sec-bm-view" style={sectionHighlightStyle('sec-bm-view')} className="space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="font-medium text-sm">书签展示风格与分组</span>
          <div className="flex rounded-lg p-0.5" style={{ background: 'var(--pill-bg)' }}>
            <button
              type="button"
              onClick={() => updateSettings({ dockStyle: 'card' })}
              className="px-2.5 py-1 rounded-md cursor-pointer"
              style={{
                background: settings.dockStyle === 'card' ? 'var(--brand-solid)' : 'transparent',
                color: settings.dockStyle === 'card' ? '#fff' : 'var(--ink-muted)',
              }}
            >
              卡片视图
            </button>
            <button
              type="button"
              onClick={() => updateSettings({ dockStyle: 'icon' })}
              className="px-2.5 py-1 rounded-md cursor-pointer"
              style={{
                background: settings.dockStyle === 'icon' ? 'var(--brand-solid)' : 'transparent',
                color: settings.dockStyle === 'icon' ? '#fff' : 'var(--ink-muted)',
              }}
            >
              图标视图
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {groups.map((g) => {
            const count = groupCountMap.get(g.id) || 0;
            const isRenaming = editingGroupId === g.id;
            const isConfirmingDelete = confirmDeleteGroupId === g.id;

            if (isRenaming) {
              return (
                <div
                  key={g.id}
                  className="px-2 py-0.5 rounded-full flex items-center gap-1"
                  style={{ background: 'var(--pill-bg)', border: '1px solid var(--brand)' }}
                >
                  <input
                    type="text"
                    value={editingGroupName}
                    autoFocus
                    onChange={(e) => setEditingGroupName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && editingGroupName.trim()) {
                        void updateGroup(g.id, editingGroupName.trim()).then(() =>
                          setEditingGroupId(null),
                        );
                      } else if (e.key === 'Escape') {
                        setEditingGroupId(null);
                      }
                    }}
                    className="w-24 bg-transparent focus:outline-none text-xs"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      if (!editingGroupName.trim()) return;
                      await updateGroup(g.id, editingGroupName.trim());
                      setEditingGroupId(null);
                    }}
                    className="p-0.5 cursor-pointer"
                    style={{ color: 'var(--ok)' }}
                    title="保存分组名"
                  >
                    <Check className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingGroupId(null)}
                    className="p-0.5 opacity-70 hover:opacity-100 cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              );
            }

            return (
              <div
                key={g.id}
                className="px-2.5 py-1 rounded-full flex items-center gap-1.5"
                style={{ background: 'var(--pill-bg)', border: '1px solid var(--glass-border)' }}
              >
                <span>{g.name}</span>
                <span className="font-mono text-[10px]" style={{ color: 'var(--ink-muted)' }}>
                  {count}
                </span>
                {g.shared ? (
                  <span style={{ color: 'var(--brand)' }}>(共享)</span>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmDeleteGroupId(null);
                        setEditingGroupId(g.id);
                        setEditingGroupName(g.name);
                      }}
                      className="opacity-55 hover:opacity-100 cursor-pointer"
                      title="重命名分组"
                    >
                      <Pencil className="w-2.5 h-2.5" />
                    </button>
                    {ownGroups.length > 1 &&
                      (isConfirmingDelete ? (
                        <button
                          type="button"
                          onClick={async () => {
                            await deleteGroup(g.id);
                            setConfirmDeleteGroupId(null);
                          }}
                          className="px-1.5 py-0.5 rounded-full text-[10px] text-white cursor-pointer"
                          style={{ background: 'var(--danger)' }}
                          title="确认删除分组及其下书签"
                        >
                          确认删
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            if (count > 0) setConfirmDeleteGroupId(g.id);
                            else void deleteGroup(g.id);
                          }}
                          className="opacity-60 hover:opacity-100 hover:text-red-400 cursor-pointer"
                          title="删除分组（该组书签同步删除）"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      ))}
                  </>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newGroupName.trim()) {
                void createGroup(newGroupName.trim()).then(() => setNewGroupName(''));
              }
            }}
            placeholder="新建书签分组名..."
            className="flex-1 h-8 px-2.5 rounded-lg focus:outline-none"
            style={{
              background: 'var(--pill-bg)',
              border: '1px solid var(--glass-border)',
              color: 'var(--ink)',
            }}
          />
          <button
            type="button"
            onClick={async () => {
              if (!newGroupName.trim()) return;
              await createGroup(newGroupName.trim());
              setNewGroupName('');
            }}
            className="px-3 h-8 rounded-lg cursor-pointer"
            style={{ background: 'var(--pill-hover)' }}
          >
            + 新建分组
          </button>
        </div>
      </section>

      <section
        data-section="sec-bm-list"
        style={{ ...sectionHighlightStyle('sec-bm-list'), borderColor: 'var(--glass-border)' }}
        className="space-y-3 pt-4 border-t"
      >
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setListExpanded((v) => !v)}
            className="flex items-center gap-2 cursor-pointer text-left"
          >
            <span className="font-medium text-sm">书签列表与编辑</span>
            <span className="kbd-chip font-mono">{bookmarks.length}</span>
            {listExpanded ? (
              <ChevronUp className="w-4 h-4 opacity-70" />
            ) : (
              <ChevronDown className="w-4 h-4 opacity-70" />
            )}
          </button>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleStartCreate}
              className="px-2.5 h-7 rounded-lg text-white font-medium flex items-center gap-1 cursor-pointer"
              style={{ background: 'var(--brand-solid)' }}
            >
              <Plus className="w-3.5 h-3.5" />
              <span>新增书签</span>
            </button>
            <button
              type="button"
              onClick={() => setListExpanded((v) => !v)}
              className="px-2.5 h-7 rounded-lg cursor-pointer"
              style={{ background: 'var(--pill-bg)', color: 'var(--ink-muted)' }}
            >
              {listExpanded ? '收起列表' : '展开列表'}
            </button>
          </div>
        </div>

        {listExpanded && (
          <div className="space-y-2.5">
            {creatingNew &&
              renderDraftForm(
                newDraft,
                setNewDraft,
                savingNew,
                '添加书签',
                () => void handleCreateBookmark(),
                () => setCreatingNew(false),
              )}

            <div className="grid sm:grid-cols-5 gap-2">
              <select
                value={filterGroupId}
                onChange={(e) => {
                  const val = e.target.value;
                  setFilterGroupId(val === 'all' ? 'all' : Number(val));
                }}
                className="sm:col-span-2 h-8 px-2.5 rounded-lg focus:outline-none"
                style={{
                  background: 'rgba(var(--glass-rgb), 0.78)',
                  border: '1px solid var(--glass-border)',
                  color: 'var(--ink)',
                }}
              >
                <option value="all">全部分组 ({bookmarks.length})</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} ({groupCountMap.get(g.id) || 0})
                  </option>
                ))}
              </select>

              <div className="sm:col-span-3 relative">
                <Search
                  className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                  style={{ color: 'var(--ink-muted)' }}
                />
                <input
                  type="text"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="搜索书签名称、描述或网址..."
                  className="w-full h-8 pl-8 pr-7 rounded-lg focus:outline-none"
                  style={{
                    background: 'var(--pill-bg)',
                    border: '1px solid var(--glass-border)',
                    color: 'var(--ink)',
                  }}
                />
                {searchText && (
                  <button
                    type="button"
                    onClick={() => setSearchText('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 opacity-70 hover:opacity-100 cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>

            {filteredOwnBookmarks.length > 0 && (
              <div
                className="px-3 py-2 rounded-xl flex items-center justify-between gap-2 flex-wrap"
                style={{ background: 'var(--pill-bg)' }}
              >
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allFilteredOwnSelected}
                    onChange={toggleSelectAllFiltered}
                  />
                  <span>
                    全选当前 ({filteredOwnBookmarks.length})
                    {selectedIds.size > 0 && (
                      <span className="ml-1.5 font-medium" style={{ color: 'var(--brand)' }}>
                        · 已选 {selectedIds.size} 项
                      </span>
                    )}
                  </span>
                </label>

                {selectedIds.size > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {ownGroups.length > 1 && (
                      <div className="flex items-center gap-1">
                        <select
                          value={moveTargetGroupId}
                          onChange={(e) => setMoveTargetGroupId(Number(e.target.value))}
                          className="h-7 px-2 rounded-lg focus:outline-none"
                          style={{
                            background: 'rgba(var(--glass-rgb), 0.78)',
                            border: '1px solid var(--glass-border)',
                            color: 'var(--ink)',
                          }}
                        >
                          {ownGroups.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          disabled={batchBusy}
                          onClick={() => void handleBatchMove()}
                          className="h-7 px-2.5 rounded-lg flex items-center gap-1 cursor-pointer disabled:opacity-50"
                          style={{ background: 'var(--pill-hover)' }}
                          title="将选中书签移动到指定分组"
                        >
                          <FolderInput className="w-3.5 h-3.5" />
                          <span>移动</span>
                        </button>
                      </div>
                    )}

                    {!confirmBatchDelete ? (
                      <button
                        type="button"
                        disabled={batchBusy}
                        onClick={() => setConfirmBatchDelete(true)}
                        className="h-7 px-2.5 rounded-lg flex items-center gap-1 font-medium cursor-pointer disabled:opacity-50"
                        style={{ background: 'rgba(248, 113, 113, 0.16)', color: 'var(--danger)' }}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>批量删除 ({selectedIds.size})</span>
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={batchBusy}
                          onClick={() => void handleBatchDelete()}
                          className="h-7 px-2.5 rounded-lg flex items-center gap-1 text-white font-medium cursor-pointer disabled:opacity-50"
                          style={{ background: 'var(--danger)' }}
                        >
                          {batchBusy ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Trash2 className="w-3.5 h-3.5" />
                          )}
                          <span>确认删除 {selectedIds.size} 条</span>
                        </button>
                        <button
                          type="button"
                          disabled={batchBusy}
                          onClick={() => setConfirmBatchDelete(false)}
                          className="h-7 px-2 rounded-lg cursor-pointer"
                          style={{ background: 'var(--pill-hover)' }}
                        >
                          取消
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {filteredBookmarks.length === 0 ? (
              <div
                className="p-5 rounded-xl text-center"
                style={{ background: 'var(--pill-bg)', color: 'var(--ink-muted)' }}
              >
                {bookmarks.length === 0 ? '暂无书签，点击上方「新增书签」或在下方导入' : '没有符合条件的书签'}
              </div>
            ) : (
              <div className="space-y-1.5 max-h-[340px] overflow-y-auto pr-0.5">
                {filteredBookmarks.map((bm) => {
                  const isExpanded = expandedBookmarkId === bm.id;
                  const isSelected = selectedIds.has(bm.id);
                  const activeUrl = getBookmarkActiveUrl(bm, zone) || bm.lan_url || bm.ts_url || bm.wan_url;
                  const groupLabel = groupNameMap.get(bm.group_id) || '默认';

                  return (
                    <div
                      key={bm.id}
                      className="rounded-xl transition-colors"
                      style={{
                        background: isExpanded ? 'var(--pill-hover)' : 'var(--pill-bg)',
                        border: isSelected
                          ? '1px solid var(--brand)'
                          : '1px solid var(--glass-border)',
                      }}
                    >
                      <div className="px-2.5 py-2 flex items-center gap-2">
                        <input
                          type="checkbox"
                          disabled={Boolean(bm.shared)}
                          checked={isSelected}
                          onChange={() => toggleSelectBookmark(bm.id)}
                          title={bm.shared ? '共享书签为只读，无法删除' : '选中'}
                        />

                        <button
                          type="button"
                          onClick={() => openExpandBookmark(bm)}
                          className="flex items-center gap-2.5 min-w-0 flex-1 text-left cursor-pointer"
                        >
                          <AppIcon
                            icon={bm.icon}
                            title={bm.title}
                            color={bm.color || '#6366f1'}
                            boxClass="w-8 h-8"
                            iconClass="w-3.5 h-3.5"
                            roundedClass="rounded-lg"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-medium truncate max-w-[180px]">{bm.title}</span>
                              <span
                                className="px-1.5 py-0.5 rounded text-[10px] shrink-0"
                                style={{ background: 'rgba(255,255,255,0.08)', color: 'var(--ink-muted)' }}
                              >
                                {groupLabel}
                              </span>
                              {bm.shared && (
                                <span
                                  className="px-1.5 py-0.5 rounded text-[10px] shrink-0"
                                  style={{ background: 'rgba(99, 102, 241, 0.16)', color: 'var(--brand)' }}
                                >
                                  共享
                                </span>
                              )}
                              {bm.lan_url && (
                                <span className="px-1 py-0.2 rounded text-[10px] font-mono" style={{ color: 'var(--ok)' }}>
                                  LAN
                                </span>
                              )}
                              {bm.ts_url && (
                                <span className="px-1 py-0.2 rounded text-[10px] font-mono" style={{ color: 'var(--brand)' }}>
                                  TS
                                </span>
                              )}
                              {bm.wan_url && (
                                <span className="px-1 py-0.2 rounded text-[10px] font-mono" style={{ color: 'var(--warn)' }}>
                                  WAN
                                </span>
                              )}
                            </div>
                            <div className="font-mono truncate mt-0.5" style={{ color: 'var(--ink-muted)' }}>
                              {activeUrl ? activeUrl.replace(/^https?:\/\//, '') : '未设置地址'}
                            </div>
                          </div>
                        </button>

                        <div className="flex items-center gap-1 shrink-0">
                          {activeUrl && (
                            <a
                              href={activeUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1.5 rounded-lg hover:bg-white/10 opacity-75 hover:opacity-100"
                              title="在新标签页打开"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          )}
                          <button
                            type="button"
                            onClick={() => openExpandBookmark(bm)}
                            className="p-1.5 rounded-lg hover:bg-white/10 cursor-pointer"
                            style={{ color: isExpanded ? 'var(--brand)' : undefined }}
                            title={bm.shared ? '查看详情' : isExpanded ? '收起编辑' : '展开编辑'}
                          >
                            {isExpanded ? (
                              <ChevronUp className="w-3.5 h-3.5" />
                            ) : (
                              <Pencil className="w-3.5 h-3.5" />
                            )}
                          </button>
                          {!bm.shared &&
                            (confirmDeleteId === bm.id ? (
                              <button
                                type="button"
                                onClick={async () => {
                                  await deleteBookmark(bm.id);
                                  setConfirmDeleteId(null);
                                }}
                                className="px-2 py-1 rounded-lg text-[11px] text-white cursor-pointer"
                                style={{ background: 'var(--danger)' }}
                              >
                                确认删
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(bm.id)}
                                className="p-1.5 rounded-lg hover:bg-white/10 cursor-pointer"
                                style={{ color: 'var(--danger)' }}
                                title="删除书签"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            ))}
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="px-2.5 pb-2.5">
                          {bm.shared ? (
                            <div
                              className="p-2.5 rounded-xl space-y-1 font-mono"
                              style={{ background: 'rgba(var(--glass-rgb), 0.35)', color: 'var(--ink-muted)' }}
                            >
                              {bm.description && <div>备注：{bm.description}</div>}
                              {bm.lan_url && <div className="truncate">LAN: {bm.lan_url}</div>}
                              {bm.ts_url && <div className="truncate">TS: {bm.ts_url}</div>}
                              {bm.wan_url && <div className="truncate">WAN: {bm.wan_url}</div>}
                            </div>
                          ) : (
                            editDraft &&
                            renderDraftForm(
                              editDraft,
                              setEditDraft,
                              savingEdit,
                              '保存修改',
                              () => void handleSaveEdit(bm.id),
                              () => {
                                setExpandedBookmarkId(null);
                                setEditDraft(null);
                              },
                            )
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </section>

      <section
        data-section="sec-bm-import"
        style={{ ...sectionHighlightStyle('sec-bm-import'), borderColor: 'var(--glass-border)' }}
        className="space-y-3 pt-4 border-t"
      >
        <div className="flex items-center justify-between flex-wrap gap-2">
          <span className="font-medium text-sm">批量导入书签</span>
          <div className="flex rounded-lg p-0.5" style={{ background: 'var(--pill-bg)' }}>
            <button
              type="button"
              onClick={() => setImportTab('sunpanel')}
              className="px-2.5 py-1 rounded-md cursor-pointer"
              style={{
                background: importTab === 'sunpanel' ? 'var(--brand-solid)' : 'transparent',
                color: importTab === 'sunpanel' ? '#fff' : 'var(--ink-muted)',
              }}
            >
              Sun-Panel JSON
            </button>
            <button
              type="button"
              onClick={() => setImportTab('browser')}
              className="px-2.5 py-1 rounded-md cursor-pointer"
              style={{
                background: importTab === 'browser' ? 'var(--brand-solid)' : 'transparent',
                color: importTab === 'browser' ? '#fff' : 'var(--ink-muted)',
              }}
            >
              浏览器 HTML
            </button>
          </div>
        </div>

        {importTab === 'sunpanel' ? (
          <div className="space-y-2.5 p-3 rounded-xl" style={{ background: 'var(--pill-bg)' }}>
            <div style={{ color: 'var(--ink-muted)' }}>
              兼容 Sun-Panel 1.x 完整导出 JSON 与旧版数组格式，自动按原分组导入并识别内网 / 外网地址
            </div>
            <textarea
              rows={4}
              value={sunPanelText}
              onChange={(e) => setSunPanelText(e.target.value)}
              placeholder="粘贴 Sun-Panel 导出的 .json 文件内容，或点击下方选择文件..."
              className="w-full p-2.5 rounded-lg font-mono focus:outline-none resize-none"
              style={inputStyle}
            />
            <div className="flex items-center justify-between gap-2">
              <label className="cursor-pointer hover:underline" style={{ color: 'var(--brand)' }}>
                选择 Sun-Panel .json 文件
                <input
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void f.text().then(setSunPanelText);
                    e.target.value = '';
                  }}
                />
              </label>
              <button
                type="button"
                disabled={importingSunPanel || !sunPanelText.trim()}
                onClick={async () => {
                  setImportingSunPanel(true);
                  try {
                    const ok = await importSunPanel(sunPanelText);
                    if (ok) setSunPanelText('');
                  } finally {
                    setImportingSunPanel(false);
                  }
                }}
                className="px-4 h-8 rounded-lg text-white font-medium cursor-pointer disabled:opacity-50"
                style={{ background: 'var(--brand-solid)' }}
              >
                {importingSunPanel ? '导入中...' : '执行 Sun-Panel 导入'}
              </button>
            </div>
          </div>
        ) : (
          <div className="p-3 rounded-xl space-y-2.5" style={{ background: 'var(--pill-bg)' }}>
            <div className="grid sm:grid-cols-3 gap-2 items-center">
              <span style={{ color: 'var(--ink-muted)' }}>导入归类分组名称</span>
              <input
                type="text"
                value={browserGroupName}
                onChange={(e) => setBrowserGroupName(e.target.value)}
                placeholder="浏览器书签"
                className="sm:col-span-2 h-8 px-2.5 rounded-lg focus:outline-none"
                style={inputStyle}
              />
            </div>
            <textarea
              rows={4}
              value={browserHtml}
              onChange={(e) => setBrowserHtml(e.target.value)}
              placeholder="支持 Chrome / Edge / Firefox / Safari 导出的书签 .html 文件内容..."
              className="w-full p-2.5 rounded-lg font-mono focus:outline-none resize-none"
              style={inputStyle}
            />
            <div className="flex items-center justify-between gap-2">
              <label className="cursor-pointer hover:underline" style={{ color: 'var(--brand)' }}>
                选择浏览器书签 .html 文件
                <input
                  type="file"
                  accept=".html,.htm,text/html"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void f.text().then(setBrowserHtml);
                    e.target.value = '';
                  }}
                />
              </label>
              <button
                type="button"
                disabled={importingBrowser || !browserHtml.trim()}
                onClick={async () => {
                  setImportingBrowser(true);
                  try {
                    const ok = await importBrowserBookmarks(
                      browserHtml,
                      browserGroupName.trim() || '浏览器书签',
                    );
                    if (ok) setBrowserHtml('');
                  } finally {
                    setImportingBrowser(false);
                  }
                }}
                className="px-4 h-8 rounded-lg text-white font-medium cursor-pointer disabled:opacity-50"
                style={{ background: 'var(--brand-solid)' }}
              >
                {importingBrowser ? '导入中...' : '一键导入为一类'}
              </button>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
