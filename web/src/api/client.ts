import type {
  AuthStatus,
  BingWallpaperItem,
  Bookmark,
  BookmarkGroup,
  ClipItem,
  FilesResponse,
  HitokotoQuote,
  PluginManifest,
  PluginStateRecord,
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

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers || {});
  if (init?.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const resp = await fetch(path, {
    credentials: 'include',
    ...init,
    headers,
  });
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
    throw new APIError(resp.status, String(parsed.error || `HTTP ${resp.status}`), parsed);
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
  createClip: (content: string, kind?: string) =>
    req<{ clip: ClipItem }>('/api/clips', {
      method: 'POST',
      body: JSON.stringify({ content, kind }),
    }),
  uploadClipImage: (file: File) => {
    const fd = new FormData();
    fd.append('image', file);
    return req<{ clip: ClipItem }>('/api/clips/image', { method: 'POST', body: fd });
  },
  toggleClipPin: (id: number, pinned: boolean) =>
    req<{ ok: boolean }>(`/api/clips/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ pinned }),
    }),
  deleteClip: (id: number) => req<{ ok: boolean }>(`/api/clips/${id}`, { method: 'DELETE' }),

  listFiles: () => req<FilesResponse>('/api/files'),
  deleteFile: (id: number) => req<{ ok: boolean }>(`/api/files/${id}`, { method: 'DELETE' }),
  uploadFileWithProgress: (
    file: File,
    ttlHours: number,
    onProgress: (prog: { percent: number; loaded: number; total: number; speedBps: number }) => void,
  ): Promise<{ file: StagedFile }> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/files');
      xhr.withCredentials = true;
      const startedAt = performance.now();
      let lastEmit = 0;
      let sampleAt = startedAt;
      let sampleLoaded = 0;
      let speedBps = 0;
      xhr.upload.onprogress = (ev) => {
        if (!ev.lengthComputable) return;
        const now = performance.now();
        if (now - lastEmit < 120 && ev.loaded < ev.total) return;
        const winSec = (now - sampleAt) / 1000;
        if (winSec >= 0.3) {
          speedBps = Math.max(0, (ev.loaded - sampleLoaded) / winSec);
          sampleLoaded = ev.loaded;
          sampleAt = now;
        } else if (speedBps === 0) {
          speedBps = ev.loaded / Math.max(0.05, (now - startedAt) / 1000);
        }
        lastEmit = now;
        onProgress({
          percent: Math.min(100, Math.round((ev.loaded / ev.total) * 100)),
          loaded: ev.loaded,
          total: ev.total,
          speedBps,
        });
      };
      xhr.onload = () => {
        let parsed: Record<string, unknown> = {};
        try {
          parsed = JSON.parse(xhr.responseText || '{}');
        } catch {
          parsed = { error: xhr.responseText };
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(parsed as { file: StagedFile });
        } else {
          reject(new APIError(xhr.status, String(parsed.error || `HTTP ${xhr.status}`), parsed));
        }
      };
      xhr.onerror = () => reject(new APIError(0, '网络传输中断'));
      const fd = new FormData();
      fd.append('ttl_hours', String(ttlHours));
      fd.append('file', file);
      xhr.send(fd);
    });
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
  getWeather: (
    opts:
      | string
      | { city?: string; label?: string; lat?: number; lon?: number; refresh?: boolean },
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
  updatePlugin: (id: string, patch: { enabled?: boolean; config?: Record<string, unknown> }) =>
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
