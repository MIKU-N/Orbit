import { useState } from 'react';
import { Loader2, Sparkles, Upload } from 'lucide-react';
import { api } from '../../api/client';
import { AppIcon, BUILTIN_ICON_NAMES, BookmarkIcon, isImageIconValue } from './Icons';

const ICON_COLORS = [
  '#6366f1',
  '#3b82f6',
  '#0ea5e9',
  '#10b981',
  '#f97316',
  '#a855f7',
  '#ec4899',
  '#64748b',
];

interface IconPickerProps {
  icon: string;
  color: string;
  title?: string;
  fetchTargetUrl?: string;
  onChangeIcon: (icon: string) => void;
  onChangeColor?: (color: string) => void;
  onToast?: (msg: string, warn?: boolean) => void;
  compact?: boolean;
}

export function IconPicker({
  icon,
  color,
  title = 'O',
  fetchTargetUrl,
  onChangeIcon,
  onChangeColor,
  onToast,
  compact = false,
}: IconPickerProps) {
  const [fetching, setFetching] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showBuiltins, setShowBuiltins] = useState(false);

  const handleAutoFetch = async () => {
    const target = (fetchTargetUrl || '').trim();
    if (!target) {
      onToast?.('请先填写目标 URL 再自动获取图标', true);
      return;
    }
    setFetching(true);
    try {
      const res = await api.fetchIcon(target);
      onChangeIcon(res.url);
      onToast?.('已自动获取图标');
    } catch (e) {
      onToast?.((e as Error).message || '自动获取图标失败', true);
    } finally {
      setFetching(false);
    }
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const res = await api.uploadIcon(file);
      onChangeIcon(res.url);
      onToast?.('已上传自定义图标');
    } catch (e) {
      onToast?.((e as Error).message || '上传图标失败', true);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-2 text-xs">
      <div className="flex items-center gap-2">
        <AppIcon
          icon={icon}
          title={title}
          color={color}
          boxClass={compact ? 'w-8 h-8' : 'w-9 h-9'}
          roundedClass="rounded-xl"
        />

        <input
          type="text"
          value={icon}
          onChange={(e) => onChangeIcon(e.target.value)}
          placeholder="图标 URL、Emoji 或内置名 (如 server)"
          className="flex-1 h-8 px-2.5 rounded-lg font-mono focus:outline-none min-w-0"
          style={{
            background: 'var(--pill-bg)',
            border: '1px solid var(--glass-border)',
            color: 'var(--ink)',
          }}
        />

        <button
          type="button"
          disabled={fetching || !fetchTargetUrl?.trim()}
          onClick={() => void handleAutoFetch()}
          title={fetchTargetUrl?.trim() ? '从目标 URL 自动抓取 Favicon / Logo' : '需先填写网址'}
          className="h-8 px-2.5 rounded-lg flex items-center gap-1 cursor-pointer shrink-0 disabled:opacity-45"
          style={{ background: 'var(--pill-hover)' }}
        >
          {fetching ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Sparkles className="w-3.5 h-3.5" style={{ color: 'var(--brand)' }} />
          )}
          <span className="hidden sm:inline">自动获取</span>
        </button>

        <label
          title="上传本地图标 (PNG/JPG/SVG/ICO/WebP)"
          className="h-8 px-2.5 rounded-lg flex items-center gap-1 cursor-pointer shrink-0"
          style={{ background: 'var(--pill-hover)' }}
        >
          {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          <span className="hidden sm:inline">上传</span>
          <input
            type="file"
            accept="image/*,.ico,.svg"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleUpload(f);
              e.target.value = '';
            }}
          />
        </label>
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowBuiltins((v) => !v)}
            className="px-2 py-1 rounded-md cursor-pointer"
            style={{ background: 'var(--pill-bg)', color: 'var(--ink-muted)' }}
          >
            {showBuiltins ? '收起内置图标' : '选择内置图标'}
          </button>
          {isImageIconValue(icon) && (
            <button
              type="button"
              onClick={() => onChangeIcon('')}
              className="px-2 py-1 rounded-md cursor-pointer hover:underline"
              style={{ color: 'var(--ink-muted)' }}
            >
              还原默认
            </button>
          )}
        </div>

        {onChangeColor && (
          <div className="flex items-center gap-1.5">
            {ICON_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onChangeColor(c)}
                className={`w-4 h-4 rounded-full cursor-pointer ${
                  color === c ? 'ring-2 ring-white' : ''
                }`}
                style={{ background: c }}
              />
            ))}
          </div>
        )}
      </div>

      {showBuiltins && (
        <div
          className="grid grid-cols-8 gap-1.5 p-2 rounded-xl"
          style={{ background: 'var(--pill-bg)', border: '1px solid var(--glass-border)' }}
        >
          {BUILTIN_ICON_NAMES.map((name) => {
            const selected = icon === name;
            return (
              <button
                key={name}
                type="button"
                title={name}
                onClick={() => {
                  onChangeIcon(name);
                  setShowBuiltins(false);
                }}
                className="h-8 rounded-lg flex items-center justify-center cursor-pointer transition-colors"
                style={{
                  background: selected ? 'var(--brand-solid)' : 'transparent',
                  color: selected ? '#fff' : 'var(--ink)',
                }}
              >
                <BookmarkIcon name={name} className="w-4 h-4" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
