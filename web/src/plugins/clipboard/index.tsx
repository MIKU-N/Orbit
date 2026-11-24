import { useRef, useState } from 'react';
import { Image as ImageIcon, Pin, Share2, Trash2 } from 'lucide-react';
import { api } from '../../api/client';
import { useOrbitHost } from '../../sdk/host';
import { SharedBadge } from '../../sdk/primitives';
import type { HostAPI, OrbitPlugin } from '../../sdk/types';

function ClipboardDrawer() {
  const host = useOrbitHost();
  const [clipText, setClipText] = useState('');
  const clipImgInputRef = useRef<HTMLInputElement>(null);

  const submitClip = async () => {
    const val = clipText.trim();
    if (!val) return;
    await api.createClip(val);
    await host.refreshClips();
    host.toast('已同步');
    setClipText('');
  };

  const handleUploadClipImage = async (file: File) => {
    await api.uploadClipImage(file);
    await host.refreshClips();
    host.toast('截图已同步');
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          await handleUploadClipImage(file);
        }
        return;
      }
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 p-4 gap-3 overflow-y-auto">
      <div
        className="p-3 rounded-2xl space-y-2"
        style={{ background: 'var(--pill-bg)', border: '1px solid var(--glass-border)' }}
      >
        <textarea
          rows={2}
          value={clipText}
          onChange={(e) => setClipText(e.target.value)}
          onPaste={handlePaste}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              void submitClip();
            }
          }}
          placeholder="输入或粘贴文本，支持 Ctrl+V 贴图..."
          className="w-full bg-transparent text-xs focus:outline-none resize-none"
          style={{ color: 'var(--ink)' }}
        />
        <div
          className="flex items-center justify-between pt-1.5 border-t text-xs"
          style={{ borderColor: 'var(--glass-border)' }}
        >
          <div className="flex items-center gap-2">
            <input
              ref={clipImgInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleUploadClipImage(f);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => clipImgInputRef.current?.click()}
              className="px-2.5 py-1 rounded-lg flex items-center gap-1 cursor-pointer"
              style={{ background: 'var(--pill-hover)' }}
            >
              <ImageIcon className="w-3.5 h-3.5" />
              <span>图片</span>
            </button>
            <span
              className="flex items-center gap-1"
              style={{ color: host.wsConnected ? 'var(--ok)' : 'var(--ink-muted)' }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: host.wsConnected ? 'var(--ok)' : 'var(--ink-subtle)' }}
              />
              {host.wsConnected ? '实时同步' : '重连中'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => void submitClip()}
            className="px-3 py-1 rounded-lg font-medium text-white cursor-pointer"
            style={{ background: 'var(--brand-solid)' }}
          >
            发送
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {host.clips.map((c) => (
          <div
            key={c.id}
            className="p-3 rounded-2xl space-y-1.5 text-xs"
            style={{ background: 'var(--pill-bg)' }}
          >
            <div
              className="flex items-center justify-between gap-2"
              style={{ color: 'var(--ink-muted)' }}
            >
              <span className="truncate flex items-center gap-1.5">
                <span>
                  {c.device || 'WEB'} ·{' '}
                  {new Date(c.created_at).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
                {c.shared && <SharedBadge label="共享" />}
              </span>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => host.copyText(c.content, '已复制')}
                  className="px-2 py-0.5 rounded-md cursor-pointer"
                  style={{ background: 'var(--pill-hover)', color: 'var(--ink)' }}
                >
                  复制
                </button>
                {!c.shared && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        host.openShareModal({
                          kind: 'clip',
                          id: c.id,
                          label: c.content.slice(0, 32),
                        })
                      }
                      className="p-1 rounded-md cursor-pointer"
                      style={{ background: 'var(--pill-hover)' }}
                      title="生成取件码"
                    >
                      <Share2 className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await api.toggleClipPin(c.id, !c.pinned);
                        await host.refreshClips();
                      }}
                      className="p-1 rounded-md cursor-pointer"
                      style={{
                        background: 'var(--pill-hover)',
                        color: c.pinned ? 'var(--brand)' : 'var(--ink-muted)',
                      }}
                      title="置顶"
                    >
                      <Pin className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await api.deleteClip(c.id);
                        await host.refreshClips();
                      }}
                      className="p-1 cursor-pointer hover:text-red-400"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </>
                )}
              </div>
            </div>

            {c.kind === 'image' && c.image_path ? (
              <div className="space-y-1">
                <img
                  src={c.image_path}
                  alt={c.content}
                  className="max-h-44 rounded-xl object-contain bg-black/25"
                />
                <div style={{ color: 'var(--ink-muted)' }}>{c.content}</div>
              </div>
            ) : c.kind === 'code' ? (
              <pre className="font-mono p-2 rounded-lg bg-black/25 overflow-x-auto">{c.content}</pre>
            ) : (
              <div className="break-words whitespace-pre-wrap">{c.content}</div>
            )}
          </div>
        ))}
        {host.clips.length === 0 && (
          <div className="py-8 text-center text-xs" style={{ color: 'var(--ink-muted)' }}>
            暂无剪贴板记录
          </div>
        )}
      </div>
    </div>
  );
}

export const clipboardPlugin: OrbitPlugin = {
  id: 'orbit.clipboard',
  manifest: {
    id: 'orbit.clipboard',
    name: '云剪贴板',
    version: '1.0.0',
    description: '跨设备文本、代码片段与截图实时双向同步',
    icon: 'clipboard',
    tier: 'builtin',
    defaultEnabled: true,
    access: {
      minRole: 'user',
      guest: {
        mode: 'login-prompt',
        prompt: '云剪贴板同步需要登录后使用',
      },
      sharing: {
        shareable: true,
        scopeKey: 'clips',
        label: '剪贴板',
        defaultShared: false,
        mode: 'sync',
      },
    },
    contributes: {
      drawers: [
        {
          id: 'clipboard',
          title: '剪贴板',
          icon: 'clipboard',
          shortcut: 'c',
          topBar: true,
          mobileDock: true,
          order: 10,
        },
      ],
      searchProvider: {
        enabled: true,
        priority: 20,
      },
    },
  },
  drawers: {
    clipboard: ClipboardDrawer,
  },
  searchProvider: (query: string, host: HostAPI) => {
    const q = query.toLowerCase();
    return host.clips
      .filter((c) => c.content.toLowerCase().includes(q))
      .slice(0, 2)
      .map((c) => ({
        id: `clip-${c.id}`,
        source: 'orbit.clipboard',
        sourceLabel: '剪贴板',
        title: c.content,
        subtitle: '点击复制',
        action: () => host.copyText(c.content, '已复制剪贴板'),
      }));
  },
};
