import type {
  AssetsResponse,
  AuthStatus,
  BingWallpaperItem,
  Bookmark,
  BookmarkGroup,
  ClipItem,
  FilesResponse,
  HitokotoQuote,
  PluginManifest,
  PluginStateRecord,
  PluginStyleOverride,
  PluginVisibilityOverride,
  PublicConfig,
  PublicShareMeta,
  ShareScopes,
  StagedFile,
  SystemMetrics,
  User,
  UserSettings,
  WeatherLocation,
  WeatherPayload,
} from '../types';

export class APIError extends Error {
  status: number;
  data: Record<string, unknown>;
  constructor(status: number, message: string, data: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

let activeClientPeerId = '';

export function setClientPeerId(peerId: string) {
  activeClientPeerId = peerId || '';
}

function friendlyErrorMessage(status: number, raw?: string): string {
  const s = (raw || '').trim();
  const map: Record<string, string> = {
    unauthorized: '登录状态已过期，请重新登录',
    'admin only': '仅管理员可执行此操作',
    'invalid json': '请求数据格式有误',
    'invalid username or password': '用户名或密码错误',
    'username already exists': '用户名已存在',
    'plugin disabled': '该组件已被禁用',
    'database error': '服务端数据库异常',
    'file not found': '文件不存在或已被删除',
    'clip not found': '剪贴板记录不存在',
    'bookmark not found': '书签不存在',
    'group not found': '分组不存在',
  };
  const lower = s.toLowerCase();
  if (map[lower]) return map[lower];
  if (s) return s;
  if (status === 401) return '登录状态已过期，请重新登录';
  if (status === 403) return '权限不足，无法执行此操作';
  if (status === 404) return '请求的资源不存在';
  if (status === 413) return '上传文件超出大小限制';
  if (status >= 500) return `服务器错误 (${status})`;
  return `请求失败 (HTTP ${status})`;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers || {});
  if (init?.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (activeClientPeerId && !headers.has('X-Orbit-Peer-Id')) {
    headers.set('X-Orbit-Peer-Id', activeClientPeerId);
  }
  let resp: Response;
  try {
    resp = await fetch(path, {
      credentials: 'include',
      ...init,
      headers,
    });
  } catch {
    throw new APIError(0, '无法连接服务器，请检查网络');
  }
  const text = await resp.text();
  let parsed: Record<string, unknown> = {};
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { error: text };
    }
  }
  if (!resp.ok) {
    throw new APIError(
      resp.status,
      friendlyErrorMessage(resp.status, typeof parsed.error === 'string' ? parsed.error : ''),
      parsed,
    );
  }
  return parsed as T;
}

export const api = {
  getPublicConfig: () => req<PublicConfig>('/api/public/config'),
  getPublicWeather: () => req<WeatherPayload>('/api/public/weather'),
  authStatus: () => req<AuthStatus>('/api/auth/status'),
  setup: (username: string, password: string) =>
    req<{ user: User }>('/api/auth/setup', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  login: (username: string, password: string) =>
    req<{ user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  logout: () => req<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  uploadAvatar: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return req<{ avatar: string }>('/api/auth/avatar', { method: 'POST', body: fd });
  },
  deleteAvatar: () => req<{ ok: boolean; avatar: string }>('/api/auth/avatar', { method: 'DELETE' }),
  changePassword: (oldPassword: string, newPassword: string) =>
    req<{ ok: boolean }>('/api/auth/password', {
      method: 'POST',
      body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
    }),
  rotateToken: () => req<{ api_token: string }>('/api/auth/token/rotate', { method: 'POST' }),
  listUsers: () => req<{ users: User[] }>('/api/auth/users'),
  createUser: (
    username: string,
    password: string,
    role: 'user' | 'admin' = 'user',
    share_scopes?: ShareScopes,
  ) =>
    req<{ user: User }>('/api/auth/users', {
      method: 'POST',
      body: JSON.stringify({ username, password, role, share_scopes }),
    }),
  updateUserShares: (id: number, share_scopes: ShareScopes) =>
    req<{ share_scopes: ShareScopes }>(`/api/auth/users/${id}/shares`, {
      method: 'PATCH',
      body: JSON.stringify({ share_scopes }),
    }),
  deleteUser: (id: number) => req<{ ok: boolean }>(`/api/auth/users/${id}`, { method: 'DELETE' }),

  listBookmarks: () => req<{ groups: BookmarkGroup[]; bookmarks: Bookmark[] }>('/api/bookmarks'),
  createGroup: (name: string) =>
    req<{ group: BookmarkGroup }>('/api/groups', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  updateGroup: (id: number, name: string) =>
    req<{ ok: boolean; id: number; name: string }>(`/api/groups/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ name }),
    }),
  deleteGroup: (id: number) => req<{ ok: boolean }>(`/api/groups/${id}`, { method: 'DELETE' }),
  createBookmark: (payload: Partial<Bookmark>) =>
    req<{ bookmark: Bookmark }>('/api/bookmarks', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateBookmark: (id: number, payload: Partial<Bookmark>) =>
    req<{ ok: boolean }>(`/api/bookmarks/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteBookmark: (id: number) =>
    req<{ ok: boolean }>(`/api/bookmarks/${id}`, { method: 'DELETE' }),
  batchDeleteBookmarks: (ids: number[]) =>
    req<{ ok: boolean; deleted: number }>('/api/bookmarks/batch-delete', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),
  batchMoveBookmarks: (ids: number[], group_id: number) =>
    req<{ ok: boolean; moved: number }>('/api/bookmarks/batch-move', {
      method: 'POST',
      body: JSON.stringify({ ids, group_id }),
    }),
  reorderBookmarks: (ids: number[]) =>
    req<{ ok: boolean }>('/api/bookmarks/reorder', {
      method: 'PUT',
      body: JSON.stringify({ ids }),
    }),
  importSunPanel: (rawJson: string) =>
    req<{ imported: number }>('/api/bookmarks/import/sunpanel', {
      method: 'POST',
      body: rawJson,
    }),
  importBrowserBookmarks: (html: string, groupName = '浏览器书签') =>
    req<{ imported: number; group_name: string; group_id: number }>('/api/bookmarks/import/browser', {
      method: 'POST',
      body: JSON.stringify({ html, group_name: groupName }),
    }),

  uploadFont: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return req<{ url: string; name: string; format: string }>('/api/fonts/upload', {
      method: 'POST',
      body: fd,
    });
  },
  deleteFont: (name: string) =>
    req<{ ok: boolean }>(`/api/fonts/custom/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  deleteCustomWallpaper: (name: string) =>
    req<{ ok: boolean }>(`/api/wallpaper/custom/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    }),

  uploadIcon: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return req<{ url: string }>('/api/icons/upload', { method: 'POST', body: fd });
  },
  fetchIcon: (url: string) =>
    req<{ url: string; source: string }>('/api/icons/fetch', {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),

  listClips: () => req<{ clips: ClipItem[] }>('/api/clips'),
  createClip: (content: string, kind?: string, targetPeerId?: string) =>
    req<{ clip: ClipItem }>('/api/clips', {
      method: 'POST',
      body: JSON.stringify({
        content,
        kind,
        target_peer_id: targetPeerId || undefined,
      }),
    }),
  uploadClipImage: (file: File, targetPeerId?: string) => {
    const fd = new FormData();
    fd.append('image', file);
    if (targetPeerId) fd.append('target_peer_id', targetPeerId);
    return req<{ clip: ClipItem }>('/api/clips/image', { method: 'POST', body: fd });
  },
  toggleClipPin: (id: number, pinned: boolean) =>
    req<{ ok: boolean }>(`/api/clips/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ pinned }),
    }),
  deleteClip: (id: number) => req<{ ok: boolean }>(`/api/clips/${id}`, { method: 'DELETE' }),

  listFiles: () => req<FilesResponse>('/api/files'),
  updateFile: (
    id: number,
    patch: { orig_name?: string; ttl_hours?: number; permanent?: boolean },
  ) =>
    req<{ ok: boolean; orig_name: string; expires_at: string }>(`/api/files/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteFile: (id: number) => req<{ ok: boolean }>(`/api/files/${id}`, { method: 'DELETE' }),
  batchDeleteFiles: (ids: number[]) =>
    req<{ ok: boolean; deleted: number }>('/api/files/batch-delete', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),
  listAssets: (category = 'all') =>
    req<AssetsResponse>(`/api/assets?category=${encodeURIComponent(category)}`),
  deleteAsset: (category: string, name: string) =>
    req<{ ok: boolean }>(`/api/assets/${encodeURIComponent(category)}/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    }),
  batchDeleteAssets: (items: { category: string; name: string }[]) =>
    req<{ ok: boolean; deleted: number }>('/api/assets/batch-delete', {
      method: 'POST',
      body: JSON.stringify({ items }),
    }),
  uploadFileWithProgress: async (
    file: File,
    ttlHours: number,
    onProgress: (prog: { percent: number; loaded: number; total: number; speedBps: number }) => void,
    opts?: { permanent?: boolean; targetPeerId?: string },
  ): Promise<{ file: StagedFile }> => {
    const CHUNKED_THRESHOLD = 4 * 1024 * 1024; // >= 4 MB uses parallel raw binary chunk upload
    const PARALLEL_WORKERS = 4;

    // Small files: direct single-request upload
    if (file.size < CHUNKED_THRESHOLD) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        let settled = false;
        xhr.open('POST', '/api/files');
        xhr.withCredentials = true;
        if (activeClientPeerId) {
          xhr.setRequestHeader('X-Orbit-Peer-Id', activeClientPeerId);
        }
        if (opts?.targetPeerId) {
          xhr.setRequestHeader('X-Orbit-Target-Peer-Id', opts.targetPeerId);
        }
        const startedAt = performance.now();
        let lastEmit = 0;
        let sampleAt = startedAt;
        let sampleLoaded = 0;
        let speedBps = 0;
        xhr.upload.onprogress = (ev) => {
          if (settled || !ev.lengthComputable) return;
          const now = performance.now();
          if (now - lastEmit < 100 && ev.loaded < ev.total) return;
          const winSec = (now - sampleAt) / 1000;
          if (winSec >= 0.25) {
            speedBps = Math.max(0, (ev.loaded - sampleLoaded) / winSec);
            sampleLoaded = ev.loaded;
            sampleAt = now;
          } else if (speedBps === 0) {
            speedBps = ev.loaded / Math.max(0.02, (now - startedAt) / 1000);
          }
          lastEmit = now;
          onProgress({
            percent: Math.min(99, Math.round((ev.loaded / ev.total) * 100)),
            loaded: ev.loaded,
            total: ev.total,
            speedBps,
          });
        };
        xhr.onload = () => {
          settled = true;
          let parsed: Record<string, unknown> = {};
          try {
            parsed = JSON.parse(xhr.responseText || '{}');
          } catch {
            parsed = { error: xhr.responseText };
          }
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(parsed as { file: StagedFile });
          } else {
            reject(
              new APIError(
                xhr.status,
                friendlyErrorMessage(xhr.status, typeof parsed.error === 'string' ? parsed.error : ''),
                parsed,
              ),
            );
          }
        };
        xhr.onerror = () => {
          settled = true;
          reject(new APIError(0, '网络传输中断，请重试'));
        };
        const fd = new FormData();
        fd.append('ttl_hours', String(opts?.permanent ? 0 : ttlHours));
        if (opts?.permanent) fd.append('permanent', '1');
        if (opts?.targetPeerId) fd.append('target_peer_id', opts.targetPeerId);
        if (activeClientPeerId) fd.append('sender_peer_id', activeClientPeerId);
        fd.append('file', file);
        xhr.send(fd);
      });
    }

    // Large files (>= 4 MB): 4-way parallel raw binary chunk upload (bypasses multipart 4KB scan
    // and saturates high-bandwidth Wi-Fi 6 / 2.5GbE LAN links)
    const init = await req<{ upload_id: string; chunk_size: number }>('/api/files/upload/init', {
      method: 'POST',
      body: JSON.stringify({
        file_name: file.name,
        size: file.size,
        mime_type: file.type || 'application/octet-stream',
        ttl_hours: opts?.permanent ? 0 : ttlHours,
        permanent: Boolean(opts?.permanent),
        target_peer_id: opts?.targetPeerId || undefined,
        sender_peer_id: activeClientPeerId || undefined,
      }),
    });

    const uploadId = init.upload_id;
    const chunkSize = Math.max(1024 * 1024, init.chunk_size || 8 * 1024 * 1024);
    const totalChunks = Math.ceil(file.size / chunkSize);
    const chunkLoaded = new Array<number>(totalChunks).fill(0);

    const startedAt = performance.now();
    let lastEmit = 0;
    let sampleAt = startedAt;
    let sampleLoaded = 0;
    let speedBps = 0;
    let aborted = false;
    const activeXhrs = new Set<XMLHttpRequest>();

    const emitAggregate = (force = false) => {
      if (aborted) return;
      const now = performance.now();
      if (!force && now - lastEmit < 100) return;
      let loaded = 0;
      for (let i = 0; i < totalChunks; i += 1) {
        loaded += chunkLoaded[i];
      }
      if (loaded > file.size) loaded = file.size;
      const winSec = (now - sampleAt) / 1000;
      if (winSec >= 0.25) {
        speedBps = Math.max(0, (loaded - sampleLoaded) / winSec);
        sampleLoaded = loaded;
        sampleAt = now;
      } else if (speedBps === 0) {
        speedBps = loaded / Math.max(0.02, (now - startedAt) / 1000);
      }
      lastEmit = now;
      onProgress({
        percent: Math.min(99, Math.round((loaded / file.size) * 100)),
        loaded,
        total: file.size,
        speedBps,
      });
    };

    const uploadOneChunk = (idx: number): Promise<void> => {
      const offset = idx * chunkSize;
      const end = Math.min(file.size, offset + chunkSize);
      const slice = file.slice(offset, end);
      const expectedLen = end - offset;

      const attempt = (retriesLeft: number): Promise<void> =>
        new Promise((resolve, reject) => {
          if (aborted) {
            reject(new Error('upload aborted'));
            return;
          }
          const xhr = new XMLHttpRequest();
          activeXhrs.add(xhr);
          xhr.open('PUT', `/api/files/upload/${encodeURIComponent(uploadId)}/chunk?offset=${offset}`);
          xhr.withCredentials = true;
          xhr.setRequestHeader('Content-Type', 'application/octet-stream');
          xhr.upload.onprogress = (ev) => {
            if (aborted) return;
            chunkLoaded[idx] = Math.min(expectedLen, ev.loaded);
            emitAggregate(false);
          };
          xhr.onload = () => {
            activeXhrs.delete(xhr);
            if (xhr.status >= 200 && xhr.status < 300) {
              chunkLoaded[idx] = expectedLen;
              emitAggregate(false);
              resolve();
              return;
            }
            if (retriesLeft > 0 && xhr.status >= 500) {
              chunkLoaded[idx] = 0;
              void attempt(retriesLeft - 1).then(resolve, reject);
              return;
            }
            let parsed: Record<string, unknown> = {};
            try {
              parsed = JSON.parse(xhr.responseText || '{}');
            } catch {
              parsed = { error: xhr.responseText };
            }
            reject(
              new APIError(
                xhr.status,
                friendlyErrorMessage(xhr.status, typeof parsed.error === 'string' ? parsed.error : ''),
                parsed,
              ),
            );
          };
          xhr.onerror = () => {
            activeXhrs.delete(xhr);
            if (retriesLeft > 0 && !aborted) {
              chunkLoaded[idx] = 0;
              void attempt(retriesLeft - 1).then(resolve, reject);
              return;
            }
            reject(new APIError(0, '网络传输中断，请重试'));
          };
          xhr.onabort = () => {
            activeXhrs.delete(xhr);
            reject(new Error('upload aborted'));
          };
          xhr.send(slice);
        });

      return attempt(2);
    };

    try {
      let nextIdx = 0;
      const workerCount = Math.min(PARALLEL_WORKERS, totalChunks);
      const workers = Array.from({ length: workerCount }, async () => {
        while (!aborted) {
          const idx = nextIdx;
          nextIdx += 1;
          if (idx >= totalChunks) break;
          await uploadOneChunk(idx);
        }
      });
      await Promise.all(workers);
      aborted = true; // stop any residual progress callbacks before finalize
      return await req<{ file: StagedFile }>(
        `/api/files/upload/${encodeURIComponent(uploadId)}/complete`,
        { method: 'POST' },
      );
    } catch (err) {
      aborted = true;
      activeXhrs.forEach((x) => {
        try {
          x.abort();
        } catch {
          // ignore
        }
      });
      activeXhrs.clear();
      void req(`/api/files/upload/${encodeURIComponent(uploadId)}`, { method: 'DELETE' }).catch(
        () => {},
      );
      throw err;
    }
  },

  createShare: (kind: 'file' | 'clip', targetId: number, ttlMinutes: number, burnAfterRead: boolean) =>
    req<{ code: string; url: string; burn_after_read: boolean; expires_at: string }>('/api/shares', {
      method: 'POST',
      body: JSON.stringify({
        kind,
        target_id: targetId,
        ttl_minutes: ttlMinutes,
        burn_after_read: burnAfterRead,
      }),
    }),
  getPublicShare: (code: string) =>
    req<PublicShareMeta>(`/api/public/share/${encodeURIComponent(code)}`),

  getSettings: () => req<{ settings: UserSettings }>('/api/settings'),
  putSettings: (settings: UserSettings) =>
    req<{ settings: UserSettings }>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ settings }),
    }),

  listBingWallpapers: (refresh = false) =>
    req<{ items: BingWallpaperItem[]; fallback: boolean }>(
      `/api/wallpaper/bing${refresh ? '?refresh=1' : ''}`,
    ),
  uploadCustomWallpaper: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return req<{ url: string }>('/api/wallpaper/upload', { method: 'POST', body: fd });
  },

  getSystemMetrics: (mount?: string) =>
    req<{ metrics: SystemMetrics }>(
      mount ? `/api/system/metrics?mount=${encodeURIComponent(mount)}` : '/api/system/metrics',
    ),
  searchWeatherLocations: (q: string) =>
    req<{ results: WeatherLocation[] }>(`/api/weather/search?q=${encodeURIComponent(q)}`),
  locateWeather: (coords?: { lat: number; lon: number }) => {
    const params = new URLSearchParams();
    if (coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lon)) {
      params.set('lat', String(coords.lat));
      params.set('lon', String(coords.lon));
    }
    const qs = params.toString();
    return req<{ location: WeatherLocation; method: 'gps' | 'ip' }>(
      `/api/weather/locate${qs ? `?${qs}` : ''}`,
    );
  },
  getWeather: (
    opts:
      | string
      | {
          city?: string;
          label?: string;
          stationId?: string;
          lat?: number;
          lon?: number;
          provider?: string;
          caiyunToken?: string;
          refresh?: boolean;
        },
  ) => {
    if (typeof opts === 'string') {
      return req<WeatherPayload>(`/api/weather?city=${encodeURIComponent(opts)}`);
    }
    const params = new URLSearchParams();
    if (opts.lat !== undefined && opts.lon !== undefined) {
      params.set('lat', String(opts.lat));
      params.set('lon', String(opts.lon));
    }
    if (opts.city) params.set('city', opts.city);
    if (opts.label) params.set('label', opts.label);
    if (opts.stationId) params.set('station_id', opts.stationId);
    if (opts.provider) params.set('provider', opts.provider);
    if (opts.caiyunToken) params.set('token', opts.caiyunToken);
    if (opts.refresh) params.set('refresh', '1');
    return req<WeatherPayload>(`/api/weather?${params.toString()}`);
  },
  getHitokoto: (opts?: { mode?: 'auto' | 'api' | 'builtin'; types?: string[]; apiUrl?: string; exclude?: string }) => {
    const params = new URLSearchParams();
    if (opts?.mode) params.set('mode', opts.mode);
    if (opts?.types?.length) params.set('types', opts.types.join(','));
    if (opts?.apiUrl?.trim()) params.set('api_url', opts.apiUrl.trim());
    if (opts?.exclude) params.set('exclude', opts.exclude);
    const qs = params.toString();
    return req<HitokotoQuote>(`/api/hitokoto${qs ? `?${qs}` : ''}`);
  },
  listBuiltinHitokoto: () => req<{ quotes: HitokotoQuote[] }>('/api/hitokoto/builtin'),

  listPlugins: () => req<{ plugins: PluginStateRecord[] }>('/api/plugins'),
  updatePlugin: (
    id: string,
    patch: {
      enabled?: boolean;
      config?: Record<string, unknown>;
      visibility?: PluginVisibilityOverride;
      style?: PluginStyleOverride;
    },
  ) =>
    req<{ ok: boolean; plugins: PluginStateRecord[] }>(`/api/plugins/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  installExternalPlugin: (manifest: PluginManifest, files: Record<string, string>) =>
    req<{ manifest: PluginManifest }>('/api/plugins/external/install', {
      method: 'POST',
      body: JSON.stringify({ manifest, files }),
    }),
  installExternalPluginZip: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return req<{ manifest: PluginManifest }>('/api/plugins/external/install', {
      method: 'POST',
      body: fd,
    });
  },
  reloadExternalPlugins: () =>
    req<{ plugins: PluginStateRecord[] }>('/api/plugins/external/reload', {
      method: 'POST',
    }),
  deleteExternalPlugin: (id: string) =>
    req<{ ok: boolean }>(`/api/plugins/external/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  getPluginKV: (id: string, key?: string) =>
    key
      ? req<{ key: string; found: boolean; value: unknown }>(
          `/api/p/${encodeURIComponent(id)}/kv/${encodeURIComponent(key)}`,
        )
      : req<{ items: { key: string; value: unknown }[] }>(
          `/api/p/${encodeURIComponent(id)}/kv/`,
        ),
  setPluginKV: (id: string, key: string, value: unknown) =>
    req<{ ok: boolean }>(`/api/p/${encodeURIComponent(id)}/kv/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    }),
  deletePluginKV: (id: string, key: string) =>
    req<{ ok: boolean }>(`/api/p/${encodeURIComponent(id)}/kv/${encodeURIComponent(key)}`, {
      method: 'DELETE',
    }),

  callPluginProxy: (
    id: string,
    route: string,
    init?: RequestInit & { query?: Record<string, string> },
  ) => {
    const qs = init?.query ? `?${new URLSearchParams(init.query).toString()}` : '';
    return req<unknown>(
      `/api/p/${encodeURIComponent(id)}/proxy/${encodeURIComponent(route)}${qs}`,
      init,
    );
  },
};

export const apiFetch = req;
