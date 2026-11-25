import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Clock,
  Copy,
  Download,
  Eye,
  File as FileIcon,
  FileImage,
  FileText,
  FolderOpen,
  HardDrive,
  Loader2,
  Pencil,
  RefreshCw,
  Search,
  Share2,
  Trash2,
  Type as TypeIcon,
  Upload,
  X,
} from 'lucide-react';
import { api } from '../api/client';
import { useOrbitHost } from '../sdk/host';
import { CenteredModal, OrbitSelect, formatBytes } from '../sdk/primitives';
import type { AssetsResponse, ManagedAsset, StagedFile } from '../types';

type FileCategoryFilter = 'all' | 'staged' | 'wallpapers' | 'icons' | 'fonts' | 'clips';
type FileSortMode = 'newest' | 'largest' | 'name';

interface UnifiedFileItem {
  key: string;
  kind: 'staged' | 'asset';
  category: 'staged' | 'wallpapers' | 'icons' | 'fonts' | 'clips';
  name: string;
  size: number;
  timeIso: string;
  mime: string;
  url: string;
  previewUrl?: string;
  isImage: boolean;
  isText: boolean;
  removable: boolean;
  shared?: boolean;
  staged?: StagedFile;
  asset?: ManagedAsset;
}

const CATEGORY_TABS: { id: FileCategoryFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'staged', label: '快传' },
  { id: 'wallpapers', label: '壁纸' },
  { id: 'icons', label: '图标' },
  { id: 'fonts', label: '字体' },
  { id: 'clips', label: '剪贴板图' },
];

const CATEGORY_LABELS: Record<UnifiedFileItem['category'], string> = {
  staged: '快传',
  wallpapers: '壁纸',
  icons: '图标',
  fonts: '字体',
  clips: '剪贴板',
};

const UPLOAD_TTL_OPTIONS = [
  { value: '24', label: '保留 24 小时' },
  { value: '168', label: '保留 7 天' },
  { value: '720', label: '保留 30 天' },
  { value: 'permanent', label: '永久保留' },
];

const EDIT_TTL_OPTIONS = [
  { value: 'keep', label: '有效期不变' },
  { value: '24', label: '重置为 24 小时' },
  { value: '168', label: '重置为 7 天' },
  { value: '720', label: '重置为 30 天' },
  { value: 'permanent', label: '设为永久' },
];

const SORT_OPTIONS = [
  { value: 'newest', label: '最新上传' },
  { value: 'largest', label: '体积最大' },
  { value: 'name', label: '按名称' },
];

function isPermanentExpiry(iso?: string): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  return !Number.isNaN(d.getTime()) && d.getUTCFullYear() >= 9000;
}

function formatExpiry(iso?: string): string {
  if (!iso) return '';
  if (isPermanentExpiry(iso)) return '永久';
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return '即将清理';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m 后过期`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h 后过期`;
  return `${Math.floor(hrs / 24)}d 后过期`;
}

function formatShortTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mm}-${dd} ${hh}:${mi}`;
}

function isImageMimeOrName(mime: string, name: string): boolean {
  if (mime.startsWith('image/')) return true;
  return /\.(png|jpe?g|webp|gif|svg|ico|bmp|avif)$/i.test(name);
}

function isTextMimeOrName(mime: string, name: string): boolean {
  if (mime.startsWith('text/') || mime === 'application/json') return true;
  return /\.(txt|md|json|yaml|yml|toml|ini|conf|log|csv|xml|html|css|js|ts|sh|go|py)$/i.test(name);
}

export function FileManagerPanel({ highlightSection }: { highlightSection?: string | null }) {
  const host = useOrbitHost();
  const transferEnabled = host.isPluginEnabled('orbit.transfer');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [assetsData, setAssetsData] = useState<AssetsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [category, setCategory] = useState<FileCategoryFilter>('all');
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<FileSortMode>('newest');
  const [uploadTtl, setUploadTtl] = useState<string>('168');
  const [uploading, setUploading] = useState(false);

  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [confirmBatchDelete, setConfirmBatchDelete] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editTtl, setEditTtl] = useState<string>('keep');
  const [savingEdit, setSavingEdit] = useState(false);

  const [previewItem, setPreviewItem] = useState<UnifiedFileItem | null>(null);
  const [cachedPreviewItem, setCachedPreviewItem] = useState<UnifiedFileItem | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    if (previewItem) setCachedPreviewItem(previewItem);
  }, [previewItem]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [assetsRes] = await Promise.all([
        api.listAssets('all'),
        transferEnabled ? host.refreshFiles() : Promise.resolve(),
      ]);
      setAssetsData(assetsRes);
    } catch (e) {
      host.toast((e as Error).message || '加载文件列表失败', true);
    } finally {
      setLoading(false);
    }
  }, [host, transferEnabled]);

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allItems = useMemo<UnifiedFileItem[]>(() => {
    const out: UnifiedFileItem[] = [];
    if (transferEnabled && host.filesData?.files) {
      for (const f of host.filesData.files) {
        const isImg = isImageMimeOrName(f.mime_type || '', f.orig_name);
        const isTxt = !isImg && isTextMimeOrName(f.mime_type || '', f.orig_name);
        out.push({
          key: `staged:${f.id}`,
          kind: 'staged',
          category: 'staged',
          name: f.orig_name,
          size: f.size_bytes,
          timeIso: f.created_at,
          mime: f.mime_type || 'application/octet-stream',
          url: `/api/files/${f.id}/download`,
          previewUrl: `/api/files/${f.id}/download?inline=1`,
          isImage: isImg,
          isText: isTxt,
          removable: !f.shared,
          shared: f.shared,
          staged: f,
        });
      }
    }
    if (assetsData?.assets) {
      for (const a of assetsData.assets) {
        const isImg = isImageMimeOrName(a.mime_hint || '', a.name);
        out.push({
          key: `asset:${a.category}:${a.name}`,
          kind: 'asset',
          category: a.category,
          name: a.name,
          size: a.size_bytes,
          timeIso: a.mod_time,
          mime: a.mime_hint || 'application/octet-stream',
          url: a.url,
          previewUrl: a.url,
          isImage: isImg,
          isText: false,
          removable: a.owned || host.isAdmin,
          asset: a,
        });
      }
    }
    return out;
  }, [assetsData, host.filesData?.files, host.isAdmin, transferEnabled]);

  const counts = useMemo(() => {
    const map: Record<FileCategoryFilter, number> = {
      all: allItems.length,
      staged: 0,
      wallpapers: 0,
      icons: 0,
      fonts: 0,
      clips: 0,
    };
    for (const item of allItems) {
      map[item.category] += 1;
    }
    return map;
  }, [allItems]);

  const totalUsedBytes = useMemo(() => {
    const stagedBytes = transferEnabled ? host.filesData?.storage_used || 0 : 0;
    const t = assetsData?.totals;
    const assetBytes = t ? t.wallpapers + t.icons + t.fonts + t.clips : 0;
    return stagedBytes + assetBytes;
  }, [assetsData?.totals, host.filesData?.storage_used, transferEnabled]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = allItems.filter((item) => {
      if (category !== 'all' && item.category !== category) return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        CATEGORY_LABELS[item.category].includes(q) ||
        item.mime.toLowerCase().includes(q)
      );
    });
    list.sort((a, b) => {
      if (sortBy === 'largest') return b.size - a.size;
      if (sortBy === 'name') return a.name.localeCompare(b.name, 'zh-CN');
      return new Date(b.timeIso).getTime() - new Date(a.timeIso).getTime();
    });
    return list;
  }, [allItems, category, query, sortBy]);

  const removableFiltered = useMemo(
    () => filteredItems.filter((i) => i.removable),
    [filteredItems],
  );

  useEffect(() => {
    const valid = new Set(allItems.filter((i) => i.removable).map((i) => i.key));
    setSelectedKeys((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const k of prev) {
        if (valid.has(k)) next.add(k);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [allItems]);

  const allSelected =
    removableFiltered.length > 0 && removableFiltered.every((i) => selectedKeys.has(i.key));

  const toggleSelectAll = () => {
    setConfirmBatchDelete(false);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        for (const item of removableFiltered) next.delete(item.key);
      } else {
        for (const item of removableFiltered) next.add(item.key);
      }
      return next;
    });
  };

  const toggleSelectOne = (key: string) => {
    setConfirmBatchDelete(false);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const cleanupDeletedAssetRefs = (deletedAssets: { category: string; url: string }[]) => {
    if (!deletedAssets.length) return;
    const wpUrls = new Set(
      deletedAssets.filter((a) => a.category === 'wallpapers').map((a) => a.url),
    );
    const fontUrls = new Set(deletedAssets.filter((a) => a.category === 'fonts').map((a) => a.url));
    if (wpUrls.size === 0 && fontUrls.size === 0) return;

    host.updateSettings((prev) => {
      let next = prev;
      if (wpUrls.size > 0) {
        const remaining = (prev.localWallpapers || []).filter((lw) => !wpUrls.has(lw.url));
        const customGone = wpUrls.has(prev.wallpaperCustom);
        next = {
          ...next,
          localWallpapers: remaining,
          wallpaperCustom: customGone ? remaining[0]?.url || '' : prev.wallpaperCustom,
          localWallpaperRotate: remaining.length < 2 ? false : prev.localWallpaperRotate,
          wallpaperMode:
            customGone && prev.wallpaperMode === 'local' && remaining.length === 0
              ? prev.bingAuto
                ? 'bing'
                : 'preset'
              : prev.wallpaperMode,
        };
      }
      if (fontUrls.size > 0) {
        const fc = prev.fontConfig || { activeId: 'noto-sans', customFonts: [] };
        const removedIds = new Set(
          fc.customFonts.filter((cf) => fontUrls.has(cf.url)).map((cf) => cf.id),
        );
        const remainingFonts = fc.customFonts.filter((cf) => !fontUrls.has(cf.url));
        next = {
          ...next,
          fontConfig: {
            activeId: removedIds.has(fc.activeId) ? 'noto-sans' : fc.activeId,
            customFonts: remainingFonts,
          },
        };
      }
      return next;
    });
  };

  const handleUpload = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (!files.length) return;
    setUploading(true);
    try {
      const permanent = uploadTtl === 'permanent';
      const ttlHours = permanent ? 0 : Number(uploadTtl) || 168;
      await host.uploadFiles(files, { ttlHours, permanent, openPopover: false });
      await loadAll();
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteOne = async (item: UnifiedFileItem) => {
    setBusyKey(item.key);
    try {
      if (item.kind === 'staged' && item.staged) {
        await api.deleteFile(item.staged.id);
        await host.refreshFiles();
      } else if (item.kind === 'asset' && item.asset) {
        await api.deleteAsset(item.asset.category, item.asset.name);
        cleanupDeletedAssetRefs([{ category: item.asset.category, url: item.asset.url }]);
        const refreshed = await api.listAssets('all');
        setAssetsData(refreshed);
        if (item.asset.category === 'clips') {
          await host.refreshClips();
        }
      }
      if (previewItem?.key === item.key) setPreviewItem(null);
      host.toast(`已删除 ${item.name}`);
    } catch (e) {
      host.toast((e as Error).message || '删除文件失败', true);
    } finally {
      setBusyKey(null);
    }
  };

  const handleBatchDelete = async () => {
    if (selectedKeys.size === 0) return;
    const chosen = allItems.filter((i) => selectedKeys.has(i.key) && i.removable);
    const stagedIds = chosen.filter((i) => i.kind === 'staged' && i.staged).map((i) => i.staged!.id);
    const assetItems = chosen
      .filter((i) => i.kind === 'asset' && i.asset)
      .map((i) => ({ category: i.asset!.category, name: i.asset!.name, url: i.asset!.url }));

    setBatchBusy(true);
    try {
      let deletedCount = 0;
      if (stagedIds.length > 0) {
        const res = await api.batchDeleteFiles(stagedIds);
        deletedCount += res.deleted;
      }
      if (assetItems.length > 0) {
        const res = await api.batchDeleteAssets(
          assetItems.map((a) => ({ category: a.category, name: a.name })),
        );
        deletedCount += res.deleted;
        cleanupDeletedAssetRefs(assetItems.map((a) => ({ category: a.category, url: a.url })));
      }
      setSelectedKeys(new Set());
      setConfirmBatchDelete(false);
      await loadAll();
      if (assetItems.some((a) => a.category === 'clips')) {
        await host.refreshClips();
      }
      host.toast(`已删除 ${deletedCount} 个文件`);
    } catch (e) {
      host.toast((e as Error).message || '批量删除失败', true);
    } finally {
      setBatchBusy(false);
    }
  };

  const startEditStaged = (f: StagedFile) => {
    if (editingId === f.id) {
      setEditingId(null);
      return;
    }
    setEditingId(f.id);
    setEditName(f.orig_name);
    setEditTtl('keep');
  };

  const handleSaveStagedEdit = async (id: number) => {
    const trimmed = editName.trim();
    if (!trimmed) {
      host.toast('文件名不能为空', true);
      return;
    }
    const patch: { orig_name?: string; ttl_hours?: number; permanent?: boolean } = {
      orig_name: trimmed,
    };
    if (editTtl === 'permanent') {
      patch.permanent = true;
    } else if (editTtl !== 'keep') {
      patch.ttl_hours = Number(editTtl);
    }
    setSavingEdit(true);
    try {
      await api.updateFile(id, patch);
      setEditingId(null);
      await host.refreshFiles();
      host.toast('文件信息已更新');
    } catch (e) {
      host.toast((e as Error).message || '保存文件信息失败', true);
    } finally {
      setSavingEdit(false);
    }
  };

  const openPreview = async (item: UnifiedFileItem) => {
    setPreviewItem(item);
    setPreviewText(null);
    if (item.isText && item.previewUrl) {
      setPreviewLoading(true);
      try {
        const resp = await fetch(item.previewUrl, { credentials: 'include' });
        if (!resp.ok) throw new Error(`加载失败 (HTTP ${resp.status})`);
        const raw = await resp.text();
        setPreviewText(raw.slice(0, 24000));
      } catch (e) {
        setPreviewText(null);
        host.toast((e as Error).message || '读取预览失败', true);
      } finally {
        setPreviewLoading(false);
      }
    }
  };

  const renderItemIcon = (item: UnifiedFileItem) => {
    if (item.isImage && item.previewUrl) {
      return (
        <img
          src={item.previewUrl}
          alt={item.name}
          loading="lazy"
          className="w-9 h-9 rounded-lg object-cover shrink-0"
          style={{ background: 'var(--code-bg)' }}
        />
      );
    }
    const Icon =
      item.category === 'fonts'
        ? TypeIcon
        : item.category === 'wallpapers' || item.category === 'icons' || item.category === 'clips'
          ? FileImage
          : item.isText
            ? FileText
            : FileIcon;
    return (
      <span
        className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: 'var(--code-bg)', color: 'var(--brand)' }}
      >
        <Icon className="w-4 h-4" />
      </span>
    );
  };

  return (
    <div
      data-section="sec-files"
      className="space-y-3.5"
      style={
        highlightSection === 'sec-files'
          ? { boxShadow: '0 0 0 2px var(--brand)', borderRadius: 'var(--radius-lg)', padding: '8px' }
          : undefined
      }
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <FolderOpen className="w-4 h-4" style={{ color: 'var(--brand)' }} />
          <span className="font-medium text-sm">文件管理</span>
          <span className="kbd-chip font-mono">
            <HardDrive className="w-3 h-3 inline mr-1 opacity-75" />
            {allItems.length} 项 · {formatBytes(totalUsedBytes)}
          </span>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {transferEnabled && (
            <>
              <OrbitSelect
                size="xs"
                value={uploadTtl}
                options={UPLOAD_TTL_OPTIONS}
                onChange={setUploadTtl}
                className="w-28"
                ariaLabel="上传保留时长"
              />
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) void handleUpload(e.target.files);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                className="h-7 px-2.5 rounded-lg text-white font-medium flex items-center gap-1 cursor-pointer disabled:opacity-50"
                style={{ background: 'var(--brand-solid)' }}
              >
                {uploading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Upload className="w-3.5 h-3.5" />
                )}
                <span>上传文件</span>
              </button>
            </>
          )}
          <button
            type="button"
            disabled={loading}
            onClick={() => void loadAll()}
            className="h-7 w-7 rounded-lg flex items-center justify-center cursor-pointer orbit-hover"
            style={{ background: 'var(--pill-bg)' }}
            title="刷新列表"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        {CATEGORY_TABS.map((t) => {
          const active = category === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setCategory(t.id);
                setConfirmBatchDelete(false);
              }}
              className="px-2.5 py-1 rounded-lg flex items-center gap-1 cursor-pointer transition-colors"
              style={{
                background: active ? 'var(--brand-solid)' : 'var(--pill-bg)',
                color: active ? '#fff' : 'var(--ink-muted)',
              }}
            >
              <span>{t.label}</span>
              <span className="font-mono text-[10px] opacity-80">{counts[t.id]}</span>
            </button>
          );
        })}
      </div>

      <div className="grid sm:grid-cols-4 gap-2">
        <div className="sm:col-span-3 relative">
          <Search
            className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: 'var(--ink-muted)' }}
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索文件名或类型..."
            className="w-full h-8 pl-8 pr-7 rounded-lg focus:outline-none"
            style={{
              background: 'var(--input-bg)',
              border: '1px solid var(--glass-border)',
              color: 'var(--ink)',
            }}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 opacity-65 hover:opacity-100 cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        <OrbitSelect
          size="sm"
          value={sortBy}
          options={SORT_OPTIONS}
          onChange={(v) => setSortBy(v as FileSortMode)}
          className="w-full"
          ariaLabel="排序方式"
        />
      </div>

      {removableFiltered.length > 0 && (
        <div
          className="px-3 py-1.5 rounded-xl flex items-center justify-between gap-2 flex-wrap"
          style={{ background: 'var(--pill-bg)' }}
        >
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
            <span>
              全选 ({removableFiltered.length})
              {selectedKeys.size > 0 && (
                <span className="ml-1.5 font-medium" style={{ color: 'var(--brand)' }}>
                  · 已选 {selectedKeys.size}
                </span>
              )}
            </span>
          </label>
          {selectedKeys.size > 0 && (
            <div className="flex items-center gap-1.5">
              {!confirmBatchDelete ? (
                <button
                  type="button"
                  disabled={batchBusy}
                  onClick={() => setConfirmBatchDelete(true)}
                  className="h-7 px-2.5 rounded-lg flex items-center gap-1 font-medium cursor-pointer"
                  style={{ background: 'rgba(248, 113, 113, 0.16)', color: 'var(--danger)' }}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>批量删除 ({selectedKeys.size})</span>
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={batchBusy}
                    onClick={() => void handleBatchDelete()}
                    className="h-7 px-2.5 rounded-lg text-white font-medium flex items-center gap-1 cursor-pointer disabled:opacity-50"
                    style={{ background: 'var(--danger)' }}
                  >
                    {batchBusy && <Loader2 className="w-3 h-3 animate-spin" />}
                    <span>确认删除</span>
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

      {loading && allItems.length === 0 ? (
        <div
          className="p-8 rounded-xl text-center flex items-center justify-center gap-2"
          style={{ background: 'var(--pill-bg)', color: 'var(--ink-muted)' }}
        >
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>加载中...</span>
        </div>
      ) : filteredItems.length === 0 ? (
        <div
          className="p-8 rounded-xl text-center"
          style={{ background: 'var(--pill-bg)', color: 'var(--ink-muted)' }}
        >
          {allItems.length === 0 ? '暂无上传文件' : '没有匹配的文件'}
        </div>
      ) : (
        <div className="space-y-1.5 max-h-[380px] overflow-y-auto pr-0.5">
          {filteredItems.map((item) => {
            const isSelected = selectedKeys.has(item.key);
            const isBusy = busyKey === item.key;
            const isEditing = item.kind === 'staged' && item.staged && editingId === item.staged.id;

            return (
              <div
                key={item.key}
                className="rounded-xl p-2.5 space-y-2 transition-colors"
                style={{
                  background: isSelected ? 'var(--pill-hover)' : 'var(--pill-bg)',
                  border: isSelected
                    ? '1px solid var(--brand)'
                    : '1px solid var(--glass-border)',
                }}
              >
                <div className="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    disabled={!item.removable}
                    checked={isSelected}
                    onChange={() => toggleSelectOne(item.key)}
                    title={item.removable ? '选中' : '只读文件'}
                  />

                  <button
                    type="button"
                    onClick={() => {
                      if (item.isImage || item.isText) void openPreview(item);
                    }}
                    className={`${item.isImage || item.isText ? 'cursor-pointer' : 'cursor-default'} shrink-0`}
                    title={item.isImage || item.isText ? '点击预览' : undefined}
                  >
                    {renderItemIcon(item)}
                  </button>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-medium truncate max-w-[220px]" title={item.name}>
                        {item.name}
                      </span>
                      <span className="kbd-chip">{CATEGORY_LABELS[item.category]}</span>
                      {item.shared && (
                        <span
                          className="px-1.5 py-0.5 rounded text-[10px]"
                          style={{ background: 'rgba(99, 102, 241, 0.16)', color: 'var(--brand)' }}
                        >
                          共享
                        </span>
                      )}
                    </div>
                    <div
                      className="flex items-center gap-2 font-mono text-[11px] mt-0.5 flex-wrap"
                      style={{ color: 'var(--ink-muted)' }}
                    >
                      <span>{formatBytes(item.size)}</span>
                      <span>·</span>
                      <span>{formatShortTime(item.timeIso)}</span>
                      {item.staged && (
                        <>
                          <span>·</span>
                          <span className="inline-flex items-center gap-0.5">
                            <Clock className="w-3 h-3 opacity-70" />
                            {formatExpiry(item.staged.expires_at)}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {(item.isImage || item.isText) && (
                      <button
                        type="button"
                        onClick={() => void openPreview(item)}
                        className="p-1.5 rounded-lg orbit-hover cursor-pointer"
                        title="预览"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                    )}

                    {item.kind === 'staged' && item.staged && item.removable && (
                      <button
                        type="button"
                        onClick={() => startEditStaged(item.staged!)}
                        className="p-1.5 rounded-lg orbit-hover cursor-pointer"
                        style={{ color: isEditing ? 'var(--brand)' : undefined }}
                        title="重命名 / 修改有效期"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    )}

                    {item.kind === 'staged' && item.staged ? (
                      <button
                        type="button"
                        onClick={() =>
                          host.openShareModal({
                            kind: 'file',
                            id: item.staged!.id,
                            label: item.name,
                          })
                        }
                        className="p-1.5 rounded-lg orbit-hover cursor-pointer"
                        title="生成取件码"
                      >
                        <Share2 className="w-3.5 h-3.5" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          void host.copyText(
                            new URL(item.url, window.location.origin).toString(),
                            '已复制文件地址',
                          )
                        }
                        className="p-1.5 rounded-lg orbit-hover cursor-pointer"
                        title="复制地址"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    )}

                    <a
                      href={item.url}
                      download={item.name}
                      className="p-1.5 rounded-lg orbit-hover"
                      title="下载"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </a>

                    {item.removable && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleDeleteOne(item)}
                        className="p-1.5 rounded-lg orbit-hover cursor-pointer disabled:opacity-45"
                        style={{ color: 'var(--danger)' }}
                        title="删除"
                      >
                        {isBusy ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                      </button>
                    )}
                  </div>
                </div>

                {isEditing && item.staged && (
                  <div
                    className="pt-2 border-t grid sm:grid-cols-5 gap-2 items-center"
                    style={{ borderColor: 'var(--glass-border)' }}
                  >
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="新文件名"
                      className="sm:col-span-2 h-8 px-2.5 rounded-lg focus:outline-none"
                      style={{
                        background: 'var(--input-bg)',
                        border: '1px solid var(--glass-border)',
                        color: 'var(--ink)',
                      }}
                    />
                    <OrbitSelect
                      size="sm"
                      value={editTtl}
                      options={EDIT_TTL_OPTIONS}
                      onChange={setEditTtl}
                      className="sm:col-span-2 w-full"
                      ariaLabel="修改有效期"
                    />
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        disabled={savingEdit}
                        onClick={() => void handleSaveStagedEdit(item.staged!.id)}
                        className="h-8 px-2.5 rounded-lg text-white flex items-center gap-1 cursor-pointer disabled:opacity-50"
                        style={{ background: 'var(--brand-solid)' }}
                      >
                        {savingEdit ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Check className="w-3.5 h-3.5" />
                        )}
                        <span>保存</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="h-8 px-2 rounded-lg cursor-pointer"
                        style={{ background: 'var(--pill-hover)' }}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <CenteredModal
        open={Boolean(previewItem)}
        onClose={() => setPreviewItem(null)}
        zIndexClass="z-[70]"
        panelClassName="w-full max-w-2xl max-h-[85vh] p-4 flex flex-col gap-3 text-xs"
      >
        {(previewItem || cachedPreviewItem) && (() => {
          const activePreview = (previewItem || cachedPreviewItem)!;
          return (
            <>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-sm truncate">{activePreview.name}</div>
                  <div className="font-mono text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                    {CATEGORY_LABELS[activePreview.category]} · {formatBytes(activePreview.size)}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <a
                    href={activePreview.url}
                    download={activePreview.name}
                    className="h-7 px-2.5 rounded-lg text-white flex items-center gap-1"
                    style={{ background: 'var(--brand-solid)' }}
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>下载</span>
                  </a>
                  <button
                    type="button"
                    onClick={() => setPreviewItem(null)}
                    className="p-1.5 rounded-lg orbit-hover cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div
                className="flex-1 min-h-0 overflow-auto rounded-xl p-3 flex items-center justify-center"
                style={{ background: 'var(--code-bg)' }}
              >
                {activePreview.isImage && activePreview.previewUrl ? (
                  <img
                    src={activePreview.previewUrl}
                    alt={activePreview.name}
                    className="max-w-full max-h-[62vh] object-contain rounded-lg"
                  />
                ) : previewLoading ? (
                  <div className="py-10 flex items-center gap-2" style={{ color: 'var(--ink-muted)' }}>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>正在读取内容...</span>
                  </div>
                ) : previewText !== null ? (
                  <pre className="w-full font-mono text-[11px] whitespace-pre-wrap break-all self-start">
                    {previewText}
                  </pre>
                ) : (
                  <div className="py-10" style={{ color: 'var(--ink-muted)' }}>
                    无法预览该文件，请直接下载查看
                  </div>
                )}
              </div>
            </>
          );
        })()}
      </CenteredModal>
    </div>
  );
}
