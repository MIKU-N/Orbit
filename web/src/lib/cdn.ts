import type { ResourceCdnConfig, ResourceCdnMode } from '../types';

export interface CdnPreset {
  id: ResourceCdnMode;
  name: string;
  region: string;
  desc: string;
  baseUrl: string;
}

export const DEFAULT_RESOURCE_CDN: ResourceCdnConfig = {
  mode: 'local',
  customUrl: '',
};

/**
 * Curated safe static-asset CDN presets.
 * BootCDN and Staticfile CDN are intentionally excluded and actively blocked
 * due to confirmed supply-chain compromise / malicious takeover.
 */
export const CDN_PRESETS: CdnPreset[] = [
  {
    id: 'local',
    name: '本地加载（默认）',
    region: '离线 / 内网',
    desc: '不引用任何外部 CDN，全部资源本地加载',
    baseUrl: '',
  },
  {
    id: 'jsdelivr',
    name: 'jsDelivr',
    region: '全球',
    desc: '官方全球多节点 npm CDN',
    baseUrl: 'https://cdn.jsdelivr.net/npm',
  },
  {
    id: 'fastly',
    name: 'jsDelivr Fastly',
    region: '亚太 / 国内优化',
    desc: 'Fastly 边缘节点，国内连通性更稳定',
    baseUrl: 'https://fastly.jsdelivr.net/npm',
  },
  {
    id: 'zstatic',
    name: 'Zstatic',
    region: '中国大陆',
    desc: '中国大陆静态资源加速镜像（npm）',
    baseUrl: 'https://s4.zstatic.net/npm',
  },
  {
    id: 'jsdmirror',
    name: 'JSDMirror',
    region: '中国大陆',
    desc: '中国大陆 jsDelivr 加速镜像',
    baseUrl: 'https://cdn.jsdmirror.com/npm',
  },
  {
    id: 'custom',
    name: '自定义 CDN',
    region: '自选',
    desc: '填写自定义 npm 资源基址（如自建反代或 unpkg）',
    baseUrl: '',
  },
];

const BLOCKED_CDN_HOSTS = [
  'bootcdn.net',
  'bootcdn.cn',
  'bootcss.com',
  'staticfile.org',
  'staticfile.net',
];

export function isBlockedUnsafeCdn(rawUrl: string): boolean {
  const trimmed = rawUrl.trim().toLowerCase();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    const host = parsed.hostname.toLowerCase();
    return BLOCKED_CDN_HOSTS.some((bad) => host === bad || host.endsWith(`.${bad}`));
  } catch {
    return BLOCKED_CDN_HOSTS.some((bad) => trimmed.includes(bad));
  }
}

export function normalizeCdnUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (!trimmed.startsWith('https://') && !trimmed.startsWith('http://')) {
    return '';
  }
  if (isBlockedUnsafeCdn(trimmed)) {
    return '';
  }
  return trimmed;
}

export function resolveCdnBase(cfg?: ResourceCdnConfig | null): string {
  const mode: ResourceCdnMode = cfg?.mode || 'local';
  if (mode === 'local') return '';
  if (mode === 'custom') {
    return normalizeCdnUrl(cfg?.customUrl || '');
  }
  const preset = CDN_PRESETS.find((p) => p.id === mode);
  return preset ? preset.baseUrl : '';
}
