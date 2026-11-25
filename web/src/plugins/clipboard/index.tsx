import { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, Loader2, Pin, Send, Share2, Trash2 } from 'lucide-react';
import { api } from '../../api/client';
import { useOrbitHost } from '../../sdk/host';
import { OrbitSelect, SharedBadge } from '../../sdk/primitives';
import type { HostAPI, OrbitPlugin } from '../../sdk/types';

function ClipboardDrawer() {
  const host = useOrbitHost();
  const [clipText, setClipText] = useState('');
  const [sending, setSending] = useState(false);
  const [uploadingImg, setUploadingImg] = useState(false);
  const [targetPeerId, setTargetPeerId] = useState('');
  const clipImgInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (targetPeerId && !host.peers.some((p) => p.peer_id === targetPeerId)) {
      setTargetPeerId('');
    }
  }, [host.peers, targetPeerId]);

  const submitClip = async () => {
    const val = clipText.trim();
    if (!val) {
      host.toast('请输入要发送的内容', true);
      return;
    }
    setSending(true);
    try {
      const res = await api.createClip(val, undefined, targetPeerId || undefined);
      if (res.clip?.id) host.markLocalClipCreated(res.clip.id);
      await host.refreshClips();
      host.toast(targetPeerId ? '已推送至目标设备' : '已同步');
      setClipText('');
    } catch (e) {
      host.toast((e as Error).message || '发送剪贴板失败', true);
    } finally {
      setSending(false);
    }
  };

  const handleUploadClipImage = async (file: File) => {
    setUploadingImg(true);
    try {
      const res = await api.uploadClipImage(file, targetPeerId || undefined);
      if (res.clip?.id) host.markLocalClipCreated(res.clip.id);
      await host.refreshClips();
      host.toast(targetPeerId ? '图片已推送至目标设备' : '图片已同步');
    } catch (e) {
      host.toast((e as Error).message || '上传图片失败', true);
    } finally {
      setUploadingImg(false);
    }
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

  const peerOptions = [
    { value: '', label: '全部其他设备' },
    ...host.peers.map((p) => ({
      value: p.peer_id,
      label: `${p.device_name} (${p.zone.toUpperCase()})`,
    })),
  ];

  return (
    <div className="flex-1 flex flex-col min-h-0 p-3 gap-2.5 overflow-y-auto text-xs">
      <div
        className="p-2.5 rounded-xl space-y-2 shrink-0"
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
          placeholder="输入文本或 Ctrl+V 粘贴图片..."
          className="w-full bg-transparent text-xs focus:outline-none resize-none"
          style={{ color: 'var(--ink)' }}
        />

        {host.peers.length > 0 && (
          <div className="flex items-center justify-between gap-2 pt-1 border-t" style={{ borderColor: 'var(--glass-border)' }}>
            <span className="shrink-0" style={{ color: 'var(--ink-muted)' }}>
              通知目标
            </span>
            <OrbitSelect
              size="xs"
              value={targetPeerId}
              options={peerOptions}
              onChange={setTargetPeerId}
              className="w-44"
              ariaLabel="选择通知目标设备"
            />
          </div>
        )}

        <div
          className="flex items-center justify-between pt-1.5 border-t"
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
              disabled={uploadingImg}
              onClick={() => clipImgInputRef.current?.click()}
              className="px-2 py-1 rounded-lg flex items-center gap-1 cursor-pointer disabled:opacity-50"
              style={{ background: 'var(--pill-hover)' }}
            >
              {uploadingImg ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <ImageIcon className="w-3.5 h-3.5" />
              )}
              <span>图片</span>
            </button>
            <span
              className="flex items-center gap-1 text-[11px]"
              style={{ color: host.wsConnected ? 'var(--ok)' : 'var(--ink-muted)' }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: host.wsConnected ? 'var(--ok)' : 'var(--ink-subtle)' }}
              />
              {host.wsConnected ? '已连接' : '重连中'}
            </span>
          </div>
          <button
            type="button"
            disabled={sending}
            onClick={() => void submitClip()}
            className="px-2.5 py-1 rounded-lg font-medium text-white flex items-center gap-1 cursor-pointer disabled:opacity-50"
            style={{ background: 'var(--brand-solid)' }}
          >
            {sending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
            <span>发送</span>
          </button>
        </div>
      </div>

      <div className="space-y-1.5">
        {host.clips.map((c) => (
          <div
            key={c.id}
            className="p-2.5 rounded-xl space-y-1.5"
            style={{ background: 'var(--pill-bg)' }}
          >
            <div
              className="flex items-center justify-between gap-2"
              style={{ color: 'var(--ink-muted)' }}
            >
              <span className="truncate flex items-center gap-1.5 text-[11px]">
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
                  onClick={() => void host.copyText(c.content, '已复制')}
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
                      title="取件码"
                    >
                      <Share2 className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await api.toggleClipPin(c.id, !c.pinned);
                          await host.refreshClips();
                        } catch (e) {
                          host.toast((e as Error).message || '置顶操作失败', true);
                        }
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
                        try {
                          await api.deleteClip(c.id);
                          await host.refreshClips();
                          host.toast('已删除');
                        } catch (e) {
                          host.toast((e as Error).message || '删除失败', true);
                        }
                      }}
                      className="p-1 cursor-pointer hover:text-red-400"
                      title="删除"
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
                  className="max-h-36 rounded-lg object-contain"
                  style={{ background: 'var(--code-bg)' }}
                />
                <div className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                  {c.content}
                </div>
              </div>
            ) : c.kind === 'code' ? (
              <pre
                className="font-mono p-2 rounded-lg overflow-x-auto text-[11px]"
                style={{ background: 'var(--code-bg)' }}
              >
                {c.content}
              </pre>
            ) : (
              <div className="break-words whitespace-pre-wrap leading-relaxed">{c.content}</div>
            )}
          </div>
        ))}
        {host.clips.length === 0 && (
          <div className="py-6 text-center" style={{ color: 'var(--ink-muted)' }}>
            暂无记录
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
    name: '跨端剪贴板',
    version: '1.0.0',
    description: '多设备文本与图片同步',
    icon: 'clipboard',
    tier: 'core',
    source: 'official',
    defaultEnabled: true,
    access: {
      minRole: 'user',
      guest: {
        mode: 'login-prompt',
        prompt: '剪贴板需要登录后使用',
      },
      sharing: {
        shareable: true,
        scopeKey: 'clips',
        label: '剪贴板',
        defaultShared: false,
        mode: 'sync',
      },
    },
    style: {
      managed: true,
      supportsCardless: false,
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
        action: () => void host.copyText(c.content, '已复制'),
      }));
  },
};
