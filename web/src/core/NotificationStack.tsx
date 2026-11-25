import {
  ArrowDownLeft,
  ArrowUpRight,
  Clipboard,
  Copy,
  Download,
  ExternalLink,
  UploadCloud,
  X,
} from 'lucide-react';
import { formatBytes, formatSpeed } from '../sdk/primitives';

export interface OrbitNotification {
  id: string;
  key?: string;
  kind: 'toast' | 'clipboard' | 'file' | 'progress';
  title?: string;
  msg: string;
  warn?: boolean;
  meta?: string;
  imageUrl?: string;
  copyValue?: string;
  downloadUrl?: string;
  drawerTarget?: string;
  progress?: {
    direction: 'send' | 'receive' | 'upload';
    percent: number;
    speedBps: number;
    transferredBytes: number;
    totalBytes: number;
  };
}

interface NotificationStackProps {
  items: OrbitNotification[];
  offsetTop?: boolean;
  onDismiss: (id: string) => void;
  onCopy: (text: string, label?: string) => Promise<boolean> | void;
  onOpenDrawer: (drawerId: string) => void;
}

export function NotificationStack({
  items,
  offsetTop = false,
  onDismiss,
  onCopy,
  onOpenDrawer,
}: NotificationStackProps) {
  if (items.length === 0) return null;

  return (
    <div
      id="notificationStack"
      className={`fixed ${
        offsetTop ? 'top-16' : 'top-4'
      } left-1/2 -translate-x-1/2 z-[70] flex flex-col items-center gap-2 pointer-events-none w-full max-w-sm px-4 transition-[top] duration-200`}
    >
      {items.map((item) => {
        if (item.kind === 'toast') {
          return (
            <div
              key={item.id}
              className="pointer-events-auto glass-strong rounded-full px-4 py-2 text-xs flex items-center gap-2 toast-slide-down shadow-lg max-w-full"
            >
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ background: item.warn ? 'var(--warn)' : 'var(--ok)' }}
              />
              <span className="truncate">{item.msg}</span>
            </div>
          );
        }

        if (item.kind === 'progress' && item.progress) {
          const p = item.progress;
          const Icon =
            p.direction === 'receive'
              ? ArrowDownLeft
              : p.direction === 'send'
                ? ArrowUpRight
                : UploadCloud;
          return (
            <div
              key={item.id}
              onClick={(e) => {
                e.stopPropagation();
                if (item.drawerTarget) onOpenDrawer(item.drawerTarget);
              }}
              className="pointer-events-auto w-full glass-strong rounded-2xl p-3 space-y-2 text-xs toast-slide-down shadow-xl cursor-pointer hover:border-[var(--glass-border-hover)]"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-7 h-7 rounded-xl flex items-center justify-center shrink-0 text-white"
                    style={{ background: 'var(--brand-solid)' }}
                  >
                    <Icon className="w-3.5 h-3.5" />
                  </span>
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{item.title || '正在传输'}</div>
                    <div className="truncate" style={{ color: 'var(--ink-muted)' }}>
                      {item.msg}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <div className="text-right font-mono">
                    <div className="font-semibold" style={{ color: 'var(--ok)' }}>
                      {p.speedBps > 0 ? formatSpeed(p.speedBps) : `${p.percent}%`}
                    </div>
                    <div className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                      {p.percent}%
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDismiss(item.id);
                    }}
                    className="p-1 rounded-lg opacity-65 hover:opacity-100 cursor-pointer shrink-0"
                    title="收起通知"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--track-bg)' }}>
                <div
                  className="h-full transition-all duration-150"
                  style={{ width: `${p.percent}%`, background: 'var(--brand-solid)' }}
                />
              </div>
              <div
                className="flex items-center justify-between font-mono text-[11px]"
                style={{ color: 'var(--ink-muted)' }}
              >
                <span>
                  {p.totalBytes > 0
                    ? `${formatBytes(p.transferredBytes)} / ${formatBytes(p.totalBytes)}`
                    : '传输中...'}
                </span>
                <span style={{ color: 'var(--brand)' }}>点击查看</span>
              </div>
            </div>
          );
        }

        const isClip = item.kind === 'clipboard';
        return (
          <div
            key={item.id}
            className="pointer-events-auto w-full glass-strong rounded-2xl p-3 space-y-2 text-xs toast-slide-down shadow-xl"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="w-7 h-7 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: 'var(--pill-hover)', color: 'var(--brand)' }}
                >
                  {isClip ? (
                    <Clipboard className="w-3.5 h-3.5" />
                  ) : (
                    <UploadCloud className="w-3.5 h-3.5" />
                  )}
                </span>
                <div className="min-w-0">
                  <div className="font-semibold truncate">
                    {item.title || (isClip ? '收到新剪贴板' : '收到新文件')}
                  </div>
                  {item.meta && (
                    <div
                      className="font-mono text-[11px] truncate"
                      style={{ color: 'var(--ink-muted)' }}
                    >
                      {item.meta}
                    </div>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onDismiss(item.id)}
                className="p-1 rounded-lg opacity-65 hover:opacity-100 cursor-pointer shrink-0"
                title="关闭"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {item.imageUrl ? (
              <div className="flex items-center gap-2.5">
                <img
                  src={item.imageUrl}
                  alt={item.msg}
                  className="w-11 h-11 rounded-lg object-cover shrink-0"
                  style={{ background: 'var(--code-bg)' }}
                />
                <div className="truncate" style={{ color: 'var(--ink-muted)' }}>
                  {item.msg}
                </div>
              </div>
            ) : (
              <div
                className="px-2.5 py-1.5 rounded-xl line-clamp-2 break-words"
                style={{ background: 'var(--code-bg)', color: 'var(--ink)' }}
              >
                {item.msg}
              </div>
            )}

            <div className="flex items-center justify-end gap-1.5">
              {item.copyValue && (
                <button
                  type="button"
                  onClick={async () => {
                    await onCopy(item.copyValue!, '已复制');
                    onDismiss(item.id);
                  }}
                  className="px-2.5 py-1 rounded-lg flex items-center gap-1 cursor-pointer font-medium text-white"
                  style={{ background: 'var(--brand-solid)' }}
                >
                  <Copy className="w-3 h-3" />
                  <span>复制</span>
                </button>
              )}
              {item.downloadUrl && (
                <a
                  href={item.downloadUrl}
                  onClick={() => onDismiss(item.id)}
                  className="px-2.5 py-1 rounded-lg flex items-center gap-1 font-medium text-white"
                  style={{ background: 'var(--brand-solid)' }}
                >
                  <Download className="w-3 h-3" />
                  <span>下载</span>
                </a>
              )}
              {item.drawerTarget && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenDrawer(item.drawerTarget!);
                    onDismiss(item.id);
                  }}
                  className="px-2.5 py-1 rounded-lg flex items-center gap-1 cursor-pointer"
                  style={{ background: 'var(--pill-hover)' }}
                >
                  <ExternalLink className="w-3 h-3" />
                  <span>打开</span>
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
