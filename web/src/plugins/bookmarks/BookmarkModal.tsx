import { useEffect, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import type { Bookmark, BookmarkGroup } from '../../types';
import { IconPicker } from '../../sdk/primitives';

interface BookmarkModalProps {
  open: boolean;
  editingBookmark: Bookmark | null;
  groups: BookmarkGroup[];
  onClose: () => void;
  onSave: (payload: Partial<Bookmark>, editingId?: number) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onCreateGroup: (name: string) => Promise<BookmarkGroup | null>;
  onImportSunPanel: (rawJson: string) => Promise<void>;
  onImportBrowserBookmarks: (html: string, groupName: string) => Promise<void>;
  onToast?: (msg: string, warn?: boolean) => void;
}

export function BookmarkModal({
  open,
  editingBookmark,
  groups,
  onClose,
  onSave,
  onDelete,
  onCreateGroup,
  onImportSunPanel,
  onImportBrowserBookmarks,
  onToast,
}: BookmarkModalProps) {
  const [tab, setTab] = useState<'manual' | 'browser' | 'sunpanel'>('manual');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [groupId, setGroupId] = useState<number>(0);
  const [lanUrl, setLanUrl] = useState('');
  const [tsUrl, setTsUrl] = useState('');
  const [wanUrl, setWanUrl] = useState('');
  const [icon, setIcon] = useState('globe');
  const [color, setColor] = useState('#6366f1');
  const [newGroupName, setNewGroupName] = useState('');
  const [sunJson, setSunJson] = useState('');
  const [browserHtml, setBrowserHtml] = useState('');
  const [browserGroupName, setBrowserGroupName] = useState('浏览器书签');
  const [saving, setSaving] = useState(false);

  const ownGroups = groups.filter((g) => !g.shared);

  useEffect(() => {
    if (!open) return;
    setTab('manual');
    if (editingBookmark) {
      setTitle(editingBookmark.title);
      setDescription(editingBookmark.description);
      setGroupId(editingBookmark.group_id);
      setLanUrl(editingBookmark.lan_url);
      setTsUrl(editingBookmark.ts_url);
      setWanUrl(editingBookmark.wan_url);
      setIcon(editingBookmark.icon || 'globe');
      setColor(editingBookmark.color || '#6366f1');
    } else {
      setTitle('');
      setDescription('');
      setGroupId(ownGroups[0]?.id || groups[0]?.id || 0);
      setLanUrl('');
      setTsUrl('');
      setWanUrl('');
      setIcon('globe');
      setColor('#6366f1');
    }
  }, [open, editingBookmark, groups]);

  if (!open) return null;

  const handleSave = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await onSave(
        {
          group_id: groupId || ownGroups[0]?.id || groups[0]?.id,
          title: title.trim(),
          description: description.trim(),
          lan_url: lanUrl.trim(),
          ts_url: tsUrl.trim(),
          wan_url: wanUrl.trim(),
          icon: icon.trim() || 'globe',
          color,
        },
        editingBookmark?.id,
      );
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleAddGroup = async () => {
    const g = newGroupName.trim();
    if (!g) return;
    const created = await onCreateGroup(g);
    if (created) {
      setGroupId(created.id);
      setNewGroupName('');
    }
  };

  const fetchTargetUrl = lanUrl.trim() || tsUrl.trim() || wanUrl.trim();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-xs" onClick={onClose} />
      <div className="relative w-full max-w-md max-h-[90vh] overflow-y-auto glass-strong rounded-2xl p-5 space-y-3.5 pop-in text-xs">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold">
              {editingBookmark ? '编辑书签' : '添加书签'}
            </h3>
            {!editingBookmark && (
              <div className="flex rounded-lg p-0.5" style={{ background: 'var(--pill-bg)' }}>
                {(
                  [
                    ['manual', '手动'],
                    ['browser', '浏览器 HTML'],
                    ['sunpanel', 'Sun-Panel'],
                  ] as const
                ).map(([k, lbl]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setTab(k)}
                    className="px-2 py-0.5 rounded-md cursor-pointer"
                    style={{
                      background: tab === k ? 'var(--brand-solid)' : 'transparent',
                      color: tab === k ? '#fff' : 'var(--ink-muted)',
                    }}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button type="button" onClick={onClose} className="cursor-pointer opacity-70 hover:opacity-100">
            <X className="w-4 h-4" />
          </button>
        </div>

        {tab === 'browser' ? (
          <div className="space-y-3">
            <label className="block space-y-1">
              <span style={{ color: 'var(--ink-muted)' }}>统一归类到分组（默认归为一类）</span>
              <input
                type="text"
                value={browserGroupName}
                onChange={(e) => setBrowserGroupName(e.target.value)}
                placeholder="浏览器书签"
                className="w-full h-9 px-3 rounded-xl focus:outline-none"
                style={{
                  background: 'var(--pill-bg)',
                  border: '1px solid var(--glass-border)',
                  color: 'var(--ink)',
                }}
              />
            </label>
            <textarea
              rows={5}
              value={browserHtml}
              onChange={(e) => setBrowserHtml(e.target.value)}
              placeholder="选择 Chrome / Edge / Firefox 导出的书签 HTML 文件，或粘贴内容..."
              className="w-full p-3 rounded-xl font-mono focus:outline-none resize-none"
              style={{
                background: 'var(--pill-bg)',
                border: '1px solid var(--glass-border)',
                color: 'var(--ink)',
              }}
            />
            <div className="flex items-center justify-between gap-2">
              <label className="cursor-pointer hover:underline" style={{ color: 'var(--brand)' }}>
                选择 bookmarks.html 文件
                <input
                  type="file"
                  accept=".html,.htm,text/html"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      void f.text().then(setBrowserHtml);
                    }
                    e.target.value = '';
                  }}
                />
              </label>
              <button
                type="button"
                disabled={!browserHtml.trim()}
                onClick={async () => {
                  await onImportBrowserBookmarks(browserHtml, browserGroupName.trim() || '浏览器书签');
                  setBrowserHtml('');
                  onClose();
                }}
                className="h-8 px-4 rounded-lg font-medium text-white cursor-pointer disabled:opacity-50"
                style={{ background: 'var(--brand-solid)' }}
              >
                导入为一类
              </button>
            </div>
          </div>
        ) : tab === 'sunpanel' ? (
          <div className="space-y-3">
            <textarea
              rows={5}
              value={sunJson}
              onChange={(e) => setSunJson(e.target.value)}
              placeholder="粘贴 Sun-Panel 导出的 JSON..."
              className="w-full p-3 rounded-xl font-mono focus:outline-none resize-none"
              style={{
                background: 'var(--pill-bg)',
                border: '1px solid var(--glass-border)',
                color: 'var(--ink)',
              }}
            />
            <div className="flex items-center justify-between gap-2">
              <label className="cursor-pointer hover:underline" style={{ color: 'var(--brand)' }}>
                选择 .json 文件
                <input
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      void f.text().then(setSunJson);
                    }
                    e.target.value = '';
                  }}
                />
              </label>
              <button
                type="button"
                disabled={!sunJson.trim()}
                onClick={async () => {
                  await onImportSunPanel(sunJson);
                  setSunJson('');
                  onClose();
                }}
                className="h-8 px-4 rounded-lg font-medium text-white cursor-pointer disabled:opacity-50"
                style={{ background: 'var(--brand-solid)' }}
              >
                导入
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2.5">
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                placeholder="名称"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="h-9 px-3 rounded-xl focus:outline-none"
                style={{
                  background: 'var(--pill-bg)',
                  border: '1px solid var(--glass-border)',
                  color: 'var(--ink)',
                }}
              />
              <select
                value={groupId}
                onChange={(e) => setGroupId(Number(e.target.value))}
                className="h-9 px-2.5 rounded-xl focus:outline-none"
                style={{
                  background: 'rgba(var(--glass-rgb), 0.75)',
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

            <div className="flex gap-1.5">
              <input
                type="text"
                placeholder="新建分组名称..."
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                className="flex-1 h-8 px-2.5 rounded-lg focus:outline-none"
                style={{
                  background: 'var(--pill-bg)',
                  border: '1px solid var(--glass-border)',
                  color: 'var(--ink)',
                }}
              />
              <button
                type="button"
                onClick={() => void handleAddGroup()}
                className="px-2.5 rounded-lg cursor-pointer"
                style={{ background: 'var(--pill-hover)' }}
              >
                + 分组
              </button>
            </div>

            <input
              type="text"
              placeholder="内网 URL (http://192.168.1.10:8096)"
              value={lanUrl}
              onChange={(e) => setLanUrl(e.target.value)}
              className="w-full h-9 px-3 rounded-xl font-mono focus:outline-none"
              style={{
                background: 'var(--pill-bg)',
                border: '1px solid var(--glass-border)',
                color: 'var(--ink)',
              }}
            />
            <input
              type="text"
              placeholder="Tailscale URL (可选)"
              value={tsUrl}
              onChange={(e) => setTsUrl(e.target.value)}
              className="w-full h-9 px-3 rounded-xl font-mono focus:outline-none"
              style={{
                background: 'var(--pill-bg)',
                border: '1px solid var(--glass-border)',
                color: 'var(--ink)',
              }}
            />
            <input
              type="text"
              placeholder="外网 URL (留空则仅内网可达)"
              value={wanUrl}
              onChange={(e) => setWanUrl(e.target.value)}
              className="w-full h-9 px-3 rounded-xl font-mono focus:outline-none"
              style={{
                background: 'var(--pill-bg)',
                border: '1px solid var(--glass-border)',
                color: 'var(--ink)',
              }}
            />

            <div className="pt-1 border-t space-y-1.5" style={{ borderColor: 'var(--glass-border)' }}>
              <div style={{ color: 'var(--ink-muted)' }}>图标与配色</div>
              <IconPicker
                icon={icon}
                color={color}
                title={title || 'B'}
                fetchTargetUrl={fetchTargetUrl}
                onChangeIcon={setIcon}
                onChangeColor={setColor}
                onToast={onToast}
              />
            </div>

            <div className="flex items-center justify-between gap-2 pt-2">
              {editingBookmark ? (
                <button
                  type="button"
                  onClick={async () => {
                    await onDelete(editingBookmark.id);
                    onClose();
                  }}
                  className="h-8 px-3 rounded-lg flex items-center gap-1 cursor-pointer"
                  style={{ color: 'var(--danger)', background: 'var(--pill-bg)' }}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>删除</span>
                </button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="h-8 px-3 rounded-lg cursor-pointer"
                  style={{ background: 'var(--pill-bg)' }}
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={saving || !title.trim()}
                  onClick={() => void handleSave()}
                  className="h-8 px-4 rounded-lg font-medium text-white cursor-pointer disabled:opacity-50"
                  style={{ background: 'var(--brand-solid)' }}
                >
                  {saving ? '保存中...' : '保存'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
