import { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import type { Bookmark, BookmarkGroup, NetworkZone } from '../../types';
import { AppIcon, MotionCard, getBookmarkActiveUrl } from '../../sdk/primitives';

interface BookmarkDockProps {
  groups: BookmarkGroup[];
  bookmarks: Bookmark[];
  activeGroupId: number | 'all';
  onSelectGroup: (id: number | 'all') => void;
  dockStyle: 'card' | 'icon';
  onChangeDockStyle: (style: 'card' | 'icon') => void;
  zone: NetworkZone;
  enableTilt: boolean;
  layoutEditing: boolean;
  onOpenBookmark: (bm: Bookmark) => void;
  onAddBookmark: () => void;
  onEditBookmark: (bm: Bookmark) => void;
  onReorderBookmarks: (orderedIds: number[]) => void;
}

export function BookmarkDock({
  groups,
  bookmarks,
  activeGroupId,
  onSelectGroup,
  dockStyle,
  onChangeDockStyle,
  zone,
  enableTilt,
  layoutEditing,
  onOpenBookmark,
  onAddBookmark,
  onEditBookmark,
  onReorderBookmarks,
}: BookmarkDockProps) {
  const [dragCardId, setDragCardId] = useState<number | null>(null);
  const [overCardId, setOverCardId] = useState<number | null>(null);

  const visibleList = bookmarks.filter(
    (b) => activeGroupId === 'all' || b.group_id === activeGroupId,
  );

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
        <div className="glass rounded-full p-1 flex items-center gap-0.5 text-xs flex-wrap">
          <button
            type="button"
            onClick={() => onSelectGroup('all')}
            className="px-3 py-1 rounded-full cursor-pointer transition-colors"
            style={{
              background: activeGroupId === 'all' ? 'var(--pill-hover)' : 'transparent',
              color: activeGroupId === 'all' ? 'var(--ink)' : 'var(--ink-muted)',
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
                background: activeGroupId === g.id ? 'var(--pill-hover)' : 'transparent',
                color: activeGroupId === g.id ? 'var(--ink)' : 'var(--ink-muted)',
                fontWeight: activeGroupId === g.id ? 500 : 400,
              }}
            >
              {g.name}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5 text-xs">
          <div className="glass rounded-full p-0.5 flex items-center">
            <button
              type="button"
              onClick={() => onChangeDockStyle('card')}
              className="px-2.5 py-1 rounded-full cursor-pointer"
              style={{ background: dockStyle === 'card' ? 'var(--pill-hover)' : 'transparent' }}
            >
              卡片
            </button>
            <button
              type="button"
              onClick={() => onChangeDockStyle('icon')}
              className="px-2.5 py-1 rounded-full cursor-pointer"
              style={{ background: dockStyle === 'icon' ? 'var(--pill-hover)' : 'transparent' }}
            >
              图标
            </button>
          </div>
          <button
            type="button"
            onClick={onAddBookmark}
            className="glass rounded-full h-8 w-8 flex items-center justify-center hover:border-[var(--glass-border-hover)] cursor-pointer"
            title="添加书签 / 导入"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className={dockStyle === 'icon' ? 'bm-grid-icon' : 'bm-grid-card'}>
        {visibleList.map((bm, i) => {
          const url = getBookmarkActiveUrl(bm, zone);
          const blocked = zone === 'wan' && !bm.wan_url;
          const host = url ? url.replace(/^https?:\/\//, '') : '仅内网';
          const isDragging = dragCardId === bm.id;
          const isOver = overCardId === bm.id && dragCardId !== bm.id;

          if (dockStyle === 'icon') {
            return (
              <MotionCard
                key={bm.id}
                enableTilt={enableTilt}
                disabled={layoutEditing}
                draggable={!layoutEditing && !bm.shared}
                onDragStart={(e) => {
                  if (layoutEditing || bm.shared) {
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
                onClick={() => {
                  if (!layoutEditing) onOpenBookmark(bm);
                }}
                style={{
                  animationDelay: `${i * 22}ms`,
                  opacity: isDragging ? 0.4 : blocked ? 0.45 : 1,
                  borderColor: isOver ? 'var(--brand)' : undefined,
                }}
                className="card-enter rounded-2xl p-3 flex flex-col items-center gap-2 cursor-pointer text-center group"
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
                {bm.shared ? (
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
                    className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 p-1 rounded-md hover:bg-white/15 transition-opacity"
                    title="编辑"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                )}
              </MotionCard>
            );
          }

          return (
            <MotionCard
              key={bm.id}
              enableTilt={enableTilt}
              disabled={layoutEditing}
              draggable={!layoutEditing && !bm.shared}
              onDragStart={(e) => {
                if (layoutEditing || bm.shared) {
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
              onClick={() => {
                if (!layoutEditing) onOpenBookmark(bm);
              }}
              style={{
                animationDelay: `${i * 22}ms`,
                opacity: isDragging ? 0.4 : blocked ? 0.5 : 1,
                borderColor: isOver ? 'var(--brand)' : undefined,
              }}
              className="card-enter rounded-2xl p-3 flex items-center gap-2.5 cursor-pointer group"
            >
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
                <div className="text-xs font-mono truncate mt-0.5" style={{ color: 'var(--ink-muted)' }}>
                  {host}
                </div>
              </div>
              {!bm.shared && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEditBookmark(bm);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-white/15 transition-opacity shrink-0"
                  title="编辑"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              )}
            </MotionCard>
          );
        })}
      </div>
    </div>
  );
}
