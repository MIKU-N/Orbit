import { useRef, useState } from 'react';
import { Download, Trash2, Upload } from 'lucide-react';
import { api } from '../../api/client';
import { useOrbitHost } from '../../sdk/host';
import { SharedBadge, formatBytes, formatLimitMB, formatSpeed } from '../../sdk/primitives';
import type { HostAPI, OrbitPlugin } from '../../sdk/types';
import type { StagedFile } from '../../types';

export { ShareModal } from './ShareModal';

function TransferDrawer() {
  const host = useOrbitHost();
  const [selectedPeerId, setSelectedPeerId] = useState('');
  const p2pFileInputRef = useRef<HTMLInputElement>(null);
  const stagingFileInputRef = useRef<HTMLInputElement>(null);

  const { filesData, peers, wsConnected, p2pProgress, uploadError, uploadProgress, detectedZone, limits } = host;

  const effectiveZone = filesData?.detected_zone || detectedZone || 'lan';
  const effectiveLimitMB =
    filesData?.zone_limit_mb ??
    (effectiveZone === 'lan'
      ? limits.lan_mb
      : effectiveZone === 'tailscale'
        ? limits.ts_mb
        : limits.wan_mb);
  const zoneLabel = {
    lan: `局域网 ≤ ${formatLimitMB(effectiveLimitMB)}`,
    tailscale: `TS ≤ ${formatLimitMB(effectiveLimitMB)}`,
    wan: `外网 ≤ ${formatLimitMB(effectiveLimitMB)}`,
  }[effectiveZone];

  return (
    <div className="flex-1 flex flex-col min-h-0 p-4 gap-4 overflow-y-auto">
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium">局域网 P2P</span>
          <span className="font-mono" style={{ color: wsConnected ? 'var(--ok)' : 'var(--ink-muted)' }}>
            {peers.length > 0 ? `${peers.length} 台在线` : '等待其他设备打开页面'}
          </span>
        </div>

        <input
          ref={p2pFileInputRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f && selectedPeerId) {
              void host.sendFileP2P(selectedPeerId, f).catch((err) =>
                host.toast((err as Error).message || 'P2P 直传失败', true),
              );
            }
            e.target.value = '';
          }}
        />

        <div className="space-y-2">
          {peers.map((p) => (
            <div
              key={p.peer_id}
              className="p-2.5 rounded-2xl flex items-center justify-between gap-2 text-xs"
              style={{ background: 'var(--pill-bg)' }}
            >
              <div className="min-w-0">
                <div className="font-medium truncate">{p.device_name}</div>
                <div className="font-mono flex items-center gap-1.5" style={{ color: 'var(--ink-muted)' }}>
                  <span>{p.zone.toUpperCase()}</span>
                  {p.same_lan && <span style={{ color: 'var(--ok)' }}>· 同局域网可直连</span>}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedPeerId(p.peer_id);
                  p2pFileInputRef.current?.click();
                }}
                className="px-3 py-1.5 rounded-xl font-medium text-white shrink-0 cursor-pointer"
                style={{ background: 'var(--brand-solid)' }}
              >
                直传
              </button>
            </div>
          ))}
        </div>

        {p2pProgress && (
          <div className="p-3 rounded-xl space-y-1.5 text-xs" style={{ background: 'var(--pill-bg)' }}>
            <div className="flex justify-between gap-2">
              <span className="truncate">
                {p2pProgress.direction === 'send' ? 'P2P 发送：' : 'P2P 接收：'}
                {p2pProgress.fileName}
              </span>
              <span className="font-mono shrink-0" style={{ color: 'var(--ok)' }}>
                {p2pProgress.speedBps > 0 ? `${formatSpeed(p2pProgress.speedBps)} · ` : ''}
                {p2pProgress.percent}%
              </span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--pill-hover)' }}>
              <div
                className="h-full transition-all"
                style={{ width: `${p2pProgress.percent}%`, background: 'var(--brand-solid)' }}
              />
            </div>
            {p2pProgress.totalBytes > 0 && (
              <div className="font-mono text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                {formatBytes(p2pProgress.transferredBytes)} / {formatBytes(p2pProgress.totalBytes)}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="space-y-2.5 pt-2 border-t" style={{ borderColor: 'var(--glass-border)' }}>
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium">暂存箱</span>
          <span className="font-mono" style={{ color: 'var(--ink-muted)' }}>
            {zoneLabel}
          </span>
        </div>

        <div
          onClick={() => stagingFileInputRef.current?.click()}
          className="p-4 rounded-2xl border border-dashed text-center space-y-1.5 cursor-pointer hover:border-[var(--glass-border-hover)]"
          style={{ borderColor: 'var(--glass-border)', background: 'var(--pill-bg)' }}
        >
          <input
            ref={stagingFileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) void host.uploadFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <Upload className="w-4 h-4 mx-auto opacity-75" />
          <div className="text-xs font-medium">点击或拖入文件上传暂存</div>
          {filesData && (
            <div className="text-xs font-mono" style={{ color: 'var(--ink-muted)' }}>
              已用 {formatBytes(filesData.storage_used)} / {formatBytes(filesData.storage_limit)}
            </div>
          )}
        </div>

        {uploadError && (
          <div
            className="p-3 rounded-xl text-xs flex items-center justify-between gap-2"
            style={{
              background: 'rgba(245, 158, 11, 0.16)',
              border: '1px solid rgba(251, 191, 36, 0.45)',
            }}
          >
            <span>{uploadError}</span>
            <button
              type="button"
              onClick={host.clearUploadError}
              className="px-2 py-0.5 rounded-md shrink-0 cursor-pointer"
              style={{ background: 'var(--pill-bg)' }}
            >
              关闭
            </button>
          </div>
        )}

        {uploadProgress !== null && (
          <div className="p-3 rounded-xl space-y-1.5 text-xs" style={{ background: 'var(--pill-bg)' }}>
            <div className="flex justify-between gap-2">
              <span className="truncate">上传中：{uploadProgress.fileName}</span>
              <span className="font-mono shrink-0" style={{ color: 'var(--ok)' }}>
                {uploadProgress.speedBps > 0 ? `${formatSpeed(uploadProgress.speedBps)} · ` : ''}
                {uploadProgress.percent}%
              </span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--pill-hover)' }}>
              <div
                className="h-full transition-all"
                style={{ width: `${uploadProgress.percent}%`, background: 'var(--brand-solid)' }}
              />
            </div>
            {uploadProgress.total > 0 && (
              <div className="font-mono text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                {formatBytes(uploadProgress.loaded)} / {formatBytes(uploadProgress.total)}
              </div>
            )}
          </div>
        )}

        <div className="space-y-2">
          {(filesData?.files || []).map((f: StagedFile) => (
            <div
              key={f.id}
              className="p-2.5 rounded-2xl flex items-center justify-between gap-2 text-xs"
              style={{ background: 'var(--pill-bg)' }}
            >
              <div className="min-w-0">
                <div className="font-medium truncate flex items-center gap-1.5">
                  <span className="truncate">{f.orig_name}</span>
                  {f.shared && <SharedBadge label="共享" />}
                </div>
                <div className="font-mono" style={{ color: 'var(--ink-muted)' }}>
                  {formatBytes(f.size_bytes)} · {f.zone.toUpperCase()}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <a
                  href={`/api/files/${f.id}/download`}
                  className="p-1.5 rounded-lg cursor-pointer"
                  style={{ background: 'var(--pill-hover)' }}
                  title="下载"
                >
                  <Download className="w-3.5 h-3.5" />
                </a>
                {!f.shared && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        host.openShareModal({ kind: 'file', id: f.id, label: f.orig_name })
                      }
                      className="px-2 py-1 rounded-lg cursor-pointer"
                      style={{ background: 'var(--pill-hover)' }}
                    >
                      取件码
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await api.deleteFile(f.id);
                        await host.refreshFiles();
                        host.toast('已删除暂存文件');
                      }}
                      className="p-1 cursor-pointer hover:text-red-400"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export const transferPlugin: OrbitPlugin = {
  id: 'orbit.transfer',
  manifest: {
    id: 'orbit.transfer',
    name: '文件快传与暂存',
    version: '1.0.0',
    description: '局域网 P2P WebRTC 直传、分网络大小限流暂存与阅后即焚取件码',
    icon: 'upload-cloud',
    tier: 'builtin',
    defaultEnabled: true,
    access: {
      minRole: 'user',
      guest: {
        mode: 'login-prompt',
        prompt: '文件上传与快传需要登录后使用（访客支持输入取件码提取）',
      },
      sharing: {
        shareable: true,
        scopeKey: 'files',
        label: '文件',
        defaultShared: false,
        mode: 'sync',
      },
    },
    contributes: {
      drawers: [
        {
          id: 'files',
          title: '快传',
          icon: 'upload-cloud',
          shortcut: 'f',
          topBar: true,
          mobileDock: true,
          order: 20,
        },
      ],
      searchProvider: {
        enabled: true,
        priority: 30,
      },
      dropHandler: {
        accept: 'files',
        priority: 10,
      },
    },
  },
  drawers: {
    files: TransferDrawer,
  },
  searchProvider: (query: string, host: HostAPI) => {
    const q = query.toLowerCase();
    return (host.filesData?.files || [])
      .filter((f) => f.orig_name.toLowerCase().includes(q))
      .slice(0, 2)
      .map((f) => ({
        id: `file-${f.id}`,
        source: 'orbit.transfer',
        sourceLabel: '文件',
        title: f.orig_name,
        subtitle: formatBytes(f.size_bytes),
        action: () =>
          host.openShareModal({ kind: 'file', id: f.id, label: f.orig_name }),
      }));
  },
  onGlobalFileDrop: async (files, host) => {
    await host.uploadFiles(files);
  },
};
