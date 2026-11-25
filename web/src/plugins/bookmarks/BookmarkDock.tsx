import { useEffect, useMemo, useState } from 'react';
import { Check, CheckSquare, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { Bookmark, BookmarkGroup, NetworkZone } from '../../types';
import { AppIcon, WidgetSurface, getBookmarkActiveUrl } from '../../sdk/primitives';

interface BookmarkDockProps {
  groups: BookmarkGroup[];
  bookmarks: Bookmark[];
  activeGroupId: number | 'all';
  onSelectGroup: (id: number | 'all') => void;
  dockStyle: 'card' | 'icon';
  onChangeDockStyle: (style: 'card' | 'icon') => void;
  cardless?: boolean;
  zone: NetworkZone;
  enableTilt: boolean;
  layoutEditing: boolean;
  onOpenBookmark: (bm: Bookmark) => void;
  onAddBookmark: () => void;
  onEditBookmark: (bm: Bookmark) => void;
  onReorderBookmarks: (orderedIds: number[]) => void;
  onBatchDeleteBookmarks: (ids: number[]) => Promise<void>;
}

export function BookmarkDock({
  groups,
  bookmarks,
  activeGroupId,
  onSelectGroup,
  dockStyle,
  onChangeDockStyle,
  cardless = false,
  zone,
  enableTilt,
  layoutEditing,
  onOpenBookmark,
  onAddBookmark,
  onEditBookmark,
  onReorderBookmarks,
  onBatchDeleteBookmarks,
}: BookmarkDockProps) {
  const [dragCardId, setDragCardId] = useState<number | null>(null);
  const [overCardId, setOverCardId] = useState<number | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [confirmBatchDelete, setConfirmBatchDelete] = useState(false);
  const [deletingBatch, setDeletingBatch] = useState(false);

  const visibleList = useMemo(
    () => bookmarks.filter((b) => activeGroupId === 'all' || b.group_id === activeGroupId),
    [bookmarks, activeGroupId],
  );

  const ownBookmarks = useMemo(() => bookmarks.filter((b) => !b.shared), [bookmarks]);
  const ownVisibleList = useMemo(() => visibleList.filter((b) => !b.shared), [visibleList]);

  useEffect(() => {
    if (layoutEditing && selectMode) {
      setSelectMode(false);
      setSelectedIds(new Set());
      setConfirmBatchDelete(false);
    }
  }, [layoutEditing, selectMode]);

  useEffect(() => {
    const validIds = new Set(ownBookmarks.map((b) => b.id));
    setSelectedIds((prev) => {
      let changed = false;
      const next = new Set<number>();
      for (const id of prev) {
        if (validIds.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    if (ownBookmarks.length === 0 && selectMode) {
      setSelectMode(false);
      setConfirmBatchDelete(false);
    }
  }, [ownBookmarks, selectMode]);

  const toggleSelectId = (id: number) => {
    setConfirmBatchDelete(false);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allOwnVisibleSelected =
    ownVisibleList.length > 0 && ownVisibleList.every((b) => selectedIds.has(b.id));

  const toggleSelectAllVisible = () => {
    setConfirmBatchDelete(false);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allOwnVisibleSelected) {
        for (const b of ownVisibleList) next.delete(b.id);
      } else {
        for (const b of ownVisibleList) next.add(b.id);
      }
      return next;
    });
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
    setConfirmBatchDelete(false);
  };

  const handleConfirmBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    setDeletingBatch(true);
    try {
      await onBatchDeleteBookmarks(Array.from(selectedIds));
      setSelectedIds(new Set());
      setConfirmBatchDelete(false);
      setSelectMode(false);
    } finally {
      setDeletingBatch(false);
    }
  };

  const handleDrop = (targetId: number) => {
    if (dragCardId === null || dragCardId === targetId) return;
    const allIds = bookmarks.map((b) => b.id);
    const fromIdx = allIds.indexOf(dragCardId);
    const toIdx = allIds.indexOf(targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    const next = [...allIds];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    setDragCardId(null);
    setOverCardId(null);
    onReorderBookmarks(next);
  };

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div
          className={`${cardless ? 'hero-shadow' : 'glass'} rounded-full p-1 flex items-center gap-0.5 text-xs flex-wrap`}
        >
          <button
            type="button"
            onClick={() => onSelectGroup('all')}
            className="px-3 py-1 rounded-full cursor-pointer transition-colors"
            style={{
              background:
                activeGroupId === 'all'
                  ? cardless
                    ? 'rgba(255,255,255,0.2)'
                    : 'var(--pill-hover)'
                  : 'transparent',
              color:
                activeGroupId === 'all'
                  ? cardless
                    ? 'var(--hero-ink)'
                    : 'var(--ink)'
                  : cardless
                    ? 'var(--hero-ink-muted)'
                    : 'var(--ink-muted)',
              fontWeight: activeGroupId === 'all' ? 500 : 400,
            }}
          >
            全部
          </button>
          {groups.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => onSelectGroup(g.id)}
              className="px-3 py-1 rounded-full cursor-pointer transition-colors"
              style={{
                background:
                  activeGroupId === g.id
                    ? cardless
                      ? 'rgba(255,255,255,0.2)'
                      : 'var(--pill-hover)'
                    : 'transparent',
                color:
                  activeGroupId === g.id
                    ? cardless
                      ? 'var(--hero-ink)'
                      : 'var(--ink)'
                    : cardless
                      ? 'var(--hero-ink-muted)'
                      : 'var(--ink-muted)',
                fontWeight: activeGroupId === g.id ? 500 : 400,
              }}
            >
              {g.name}
            </button>
          ))}
        </div>

        <div className={`flex items-center gap-1.5 text-xs ${cardless ? 'hero-shadow' : ''}`}>
          <div className={`${cardless ? '' : 'glass'} rounded-full p-0.5 flex items-center`}>
            <button
              type="button"
              onClick={() => onChangeDockStyle('card')}
              className="px-2.5 py-1 rounded-full cursor-pointer"
              style={{
                background:
                  dockStyle === 'card'
                    ? cardless
                      ? 'rgba(255,255,255,0.2)'
                      : 'var(--pill-hover)'
                    : 'transparent',
                color: cardless ? 'var(--hero-ink)' : undefined,
              }}
            >
              卡片
            </button>
            <button
              type="button"
              onClick={() => onChangeDockStyle('icon')}
              className="px-2.5 py-1 rounded-full cursor-pointer"
              style={{
                background:
                  dockStyle === 'icon'
                    ? cardless
                      ? 'rgba(255,255,255,0.2)'
                      : 'var(--pill-hover)'
                    : 'transparent',
                color: cardless ? 'var(--hero-ink)' : undefined,
              }}
            >
              图标
            </button>
          </div>
          {ownBookmarks.length > 0 && !layoutEditing && (
            <button
              type="button"
              onClick={() => {
                if (selectMode) exitSelectMode();
                else setSelectMode(true);
              }}
              className={`${cardless ? '' : 'glass'} rounded-full h-8 px-2.5 flex items-center gap-1 hover:border-[var(--glass-border-hover)] cursor-pointer`}
              style={{
                background: selectMode ? 'var(--brand-solid)' : cardless ? 'rgba(255,255,255,0.14)' : undefined,
                color: selectMode ? '#fff' : cardless ? 'var(--hero-ink)' : undefined,
              }}
              title={selectMode ? '退出多选' : '批量管理'}
            >
              <CheckSquare className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{selectMode ? '退出' : '多选'}</span>
            </button>
          )}
          <button
            type="button"
            onClick={onAddBookmark}
            className={`${cardless ? '' : 'glass'} rounded-full h-8 w-8 flex items-center justify-center hover:border-[var(--glass-border-hover)] cursor-pointer`}
            style={cardless ? { background: 'rgba(255,255,255,0.14)', color: 'var(--hero-ink)' } : undefined}
            title="添加书签"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>

      {selectMode && (
        <div className="glass-strong rounded-2xl px-3 py-2 flex items-center justify-between gap-2 flex-wrap text-xs pop-in">
          <div className="flex items-center gap-2">
            <span className="font-medium">
              已选 <span className="font-mono">{selectedIds.size}</span> 项
            </span>
            {ownVisibleList.length > 0 && (
              <button
                type="button"
                onClick={toggleSelectAllVisible}
                className="px-2.5 py-1 rounded-lg cursor-pointer"
                style={{ background: 'var(--pill-bg)' }}
              >
                {allOwnVisibleSelected ? '取消全选当前' : `全选当前 (${ownVisibleList.length})`}
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {selectedIds.size > 0 && !confirmBatchDelete && (
              <button
                type="button"
                onClick={() => setConfirmBatchDelete(true)}
                className="px-3 py-1 rounded-lg flex items-center gap-1 cursor-pointer font-medium"
                style={{ background: 'rgba(248, 113, 113, 0.16)', color: 'var(--danger)' }}
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>批量删除 ({selectedIds.size})</span>
              </button>
            )}
            {selectedIds.size > 0 && confirmBatchDelete && (
              <>
                <button
                  type="button"
                  disabled={deletingBatch}
                  onClick={() => void handleConfirmBatchDelete()}
                  className="px-3 py-1 rounded-lg flex items-center gap-1 text-white font-medium cursor-pointer disabled:opacity-60"
                  style={{ background: 'var(--danger)' }}
                >
                  {deletingBatch ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="w-3.5 h-3.5" />
                  )}
                  <span>确认删除 {selectedIds.size} 条</span>
                </button>
                <button
                  type="button"
                  disabled={deletingBatch}
                  onClick={() => setConfirmBatchDelete(false)}
                  className="px-2.5 py-1 rounded-lg cursor-pointer"
                  style={{ background: 'var(--pill-bg)' }}
                >
                  取消
                </button>
              </>
            )}
            <button
              type="button"
              onClick={exitSelectMode}
              className="p-1 rounded-lg opacity-75 hover:opacity-100 cursor-pointer"
              title="关闭批量模式"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {visibleList.length === 0 ? (
        <div
          className={`${cardless ? 'widget-plain px-2 py-4' : 'glass rounded-2xl px-4 py-6'} flex flex-col sm:flex-row items-center justify-between gap-3 text-xs`}
          style={{ color: cardless ? 'var(--hero-ink-muted)' : 'var(--ink-muted)' }}
        >
          <span>当前分组暂无书签</span>
          <button
            type="button"
            onClick={onAddBookmark}
            className="px-3.5 py-1.5 rounded-xl font-medium text-white flex items-center gap-1.5 cursor-pointer shrink-0"
            style={{ background: 'var(--brand-solid)' }}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>添加书签</span>
          </button>
        </div>
      ) : (
        <div className={dockStyle === 'icon' ? 'bm-grid-icon' : 'bm-grid-card'}>
          {visibleList.map((bm, i) => {
            const url = getBookmarkActiveUrl(bm, zone);
            const blocked = zone === 'wan' && !bm.wan_url;
            const host = url ? url.replace(/^https?:\/\//, '') : '仅内网';
            const isDragging = dragCardId === bm.id;
            const isOver = overCardId === bm.id && dragCardId !== bm.id;
            const isSelected = selectMode && selectedIds.has(bm.id);
            const canDrag = !layoutEditing && !selectMode && !bm.shared;

            const handleCardClick = () => {
              if (layoutEditing) return;
              if (selectMode) {
                if (!bm.shared) toggleSelectId(bm.id);
                return;
              }
              onOpenBookmark(bm);
            };

            if (dockStyle === 'icon') {
              return (
                <WidgetSurface
                  key={bm.id}
                  cardless={cardless}
                  enableTilt={enableTilt && !selectMode}
                  layoutEditing={layoutEditing}
                  draggable={canDrag}
                  onDragStart={(e) => {
                    if (!canDrag) {
                      e.preventDefault();
                      return;
                    }
                    setDragCardId(bm.id);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragEnd={() => {
                    setDragCardId(null);
                    setOverCardId(null);
                  }}
                  onDragOver={(e) => {
                    if (dragCardId !== null) {
                      e.preventDefault();
                      setOverCardId(bm.id);
                    }
                  }}
                  onDragLeave={() => setOverCardId(null)}
                  onDrop={(e) => {
                    if (dragCardId !== null) {
                      e.preventDefault();
                      e.stopPropagation();
                      handleDrop(bm.id);
                    }
                  }}
                  onClick={handleCardClick}
                  style={{
                    animationDelay: `${i * 22}ms`,
                    opacity: isDragging ? 0.4 : selectMode && bm.shared ? 0.45 : blocked ? 0.45 : 1,
                    borderColor: isSelected || isOver ? 'var(--brand)' : undefined,
                    boxShadow: isSelected ? '0 0 0 1px var(--brand)' : undefined,
                  }}
                  cardClassName="card-enter rounded-2xl p-3 flex flex-col items-center gap-2 cursor-pointer text-center group"
                  plainClassName="card-enter rounded-2xl p-2 flex flex-col items-center gap-1.5 cursor-pointer text-center group hover:scale-[1.04] transition-transform"
                >
                  <AppIcon
                    icon={bm.icon}
                    title={bm.title}
                    color={bm.color || '#6366f1'}
                    boxClass="w-10 h-10"
                    iconClass="w-4 h-4"
                    roundedClass="rounded-xl"
                  />
                  <div className="text-xs font-medium truncate w-full">{bm.title}</div>
                  {selectMode ? (
                    !bm.shared && (
                      <span
                        className="absolute top-1.5 left-1.5 w-4 h-4 rounded-full flex items-center justify-center border transition-colors"
                        style={{
                          background: isSelected ? 'var(--brand-solid)' : 'rgba(0,0,0,0.35)',
                          borderColor: isSelected ? 'var(--brand-solid)' : 'rgba(255,255,255,0.45)',
                          color: '#fff',
                        }}
                      >
                        {isSelected && <Check className="w-2.5 h-2.5" />}
                      </span>
                    )
                  ) : bm.shared ? (
                    <span
                      className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded text-[10px]"
                      style={{ background: 'var(--pill-bg)', color: 'var(--brand)' }}
                    >
                      共享
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditBookmark(bm);
                      }}
                      className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 p-1 rounded-md orbit-hover transition-opacity"
                      title="编辑"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                  )}
                </WidgetSurface>
              );
            }

            return (
              <WidgetSurface
                key={bm.id}
                cardless={cardless}
                enableTilt={enableTilt && !selectMode}
                layoutEditing={layoutEditing}
                draggable={canDrag}
                onDragStart={(e) => {
                  if (!canDrag) {
                    e.preventDefault();
                    return;
                  }
                  setDragCardId(bm.id);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragEnd={() => {
                  setDragCardId(null);
                  setOverCardId(null);
                }}
                onDragOver={(e) => {
                  if (dragCardId !== null) {
                    e.preventDefault();
                    setOverCardId(bm.id);
                  }
                }}
                onDragLeave={() => setOverCardId(null)}
                onDrop={(e) => {
                  if (dragCardId !== null) {
                    e.preventDefault();
                    e.stopPropagation();
                    handleDrop(bm.id);
                  }
                }}
                onClick={handleCardClick}
                style={{
                  animationDelay: `${i * 22}ms`,
                  opacity: isDragging ? 0.4 : selectMode && bm.shared ? 0.45 : blocked ? 0.5 : 1,
                  borderColor: isSelected || isOver ? 'var(--brand)' : undefined,
                  boxShadow: isSelected ? '0 0 0 1px var(--brand)' : undefined,
                }}
                cardClassName="card-enter rounded-2xl p-3 flex items-center gap-2.5 cursor-pointer group"
                plainClassName="card-enter rounded-2xl px-2 py-2 flex items-center gap-2.5 cursor-pointer group hover:scale-[1.02] transition-transform"
              >
                {selectMode && !bm.shared && (
                  <span
                    className="w-4 h-4 rounded-full flex items-center justify-center border shrink-0 transition-colors"
                    style={{
                      background: isSelected ? 'var(--brand-solid)' : 'transparent',
                      borderColor: isSelected ? 'var(--brand-solid)' : 'var(--glass-border-hover)',
                      color: '#fff',
                    }}
                  >
                    {isSelected && <Check className="w-2.5 h-2.5" />}
                  </span>
                )}
                <AppIcon
                  icon={bm.icon}
                  title={bm.title}
                  color={bm.color || '#6366f1'}
                  boxClass="w-9 h-9"
                  iconClass="w-4 h-4"
                  roundedClass="rounded-xl"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold truncate flex items-center gap-1.5">
                    <span className="truncate">{bm.title}</span>
                    {bm.shared && (
                      <span
                        className="px-1.5 py-0.5 rounded text-[10px] font-normal shrink-0"
                        style={{ background: 'var(--pill-bg)', color: 'var(--brand)' }}
                      >
                        共享
                      </span>
                    )}
                  </div>
                  <div
                    className="text-xs font-mono truncate mt-0.5"
                    style={{ color: cardless ? 'var(--hero-ink-muted)' : 'var(--ink-muted)' }}
                  >
                    {host}
                  </div>
                </div>
                {!selectMode && !bm.shared && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEditBookmark(bm);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg orbit-hover transition-opacity shrink-0"
                    title="编辑"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                )}
              </WidgetSurface>
            );
          })}
        </div>
      )}
    </div>
  );
}
