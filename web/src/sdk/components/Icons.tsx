import { useEffect, useState } from 'react';
import {
  Activity,
  BookOpen,
  Bot,
  Box,
  Cloud,
  Code2,
  Compass,
  Cpu,
  Database,
  FileText,
  Film,
  Globe,
  HardDrive,
  Home,
  Lock,
  Mail,
  Music,
  Play,
  Search,
  Server,
  Shield,
  Terminal,
  Wifi,
  Wrench,
} from 'lucide-react';
import type { Bookmark, NetworkZone } from '../../types';
import { BrandIconSvg, isBrandIconValue, resolveDefaultBrandIcon } from './BrandIcons';

export const BUILTIN_ICON_NAMES = [
  'globe',
  'server',
  'harddrive',
  'play',
  'home',
  'code',
  'box',
  'chart',
  'lock',
  'note',
  'shield',
  'wrench',
  'search',
  'terminal',
  'database',
  'cloud',
  'film',
  'music',
  'book',
  'mail',
  'compass',
  'cpu',
  'wifi',
  'bot',
] as const;

export function BookmarkIcon({ name, className = 'w-4 h-4' }: { name: string; className?: string }) {
  switch (name) {
    case 'server':
      return <Server className={className} />;
    case 'harddrive':
      return <HardDrive className={className} />;
    case 'play':
      return <Play className={className} />;
    case 'home':
      return <Home className={className} />;
    case 'box':
      return <Box className={className} />;
    case 'code':
      return <Code2 className={className} />;
    case 'chart':
      return <Activity className={className} />;
    case 'lock':
      return <Lock className={className} />;
    case 'note':
      return <FileText className={className} />;
    case 'shield':
      return <Shield className={className} />;
    case 'wrench':
      return <Wrench className={className} />;
    case 'search':
      return <Search className={className} />;
    case 'terminal':
      return <Terminal className={className} />;
    case 'database':
      return <Database className={className} />;
    case 'cloud':
      return <Cloud className={className} />;
    case 'film':
      return <Film className={className} />;
    case 'music':
      return <Music className={className} />;
    case 'book':
      return <BookOpen className={className} />;
    case 'mail':
      return <Mail className={className} />;
    case 'compass':
      return <Compass className={className} />;
    case 'cpu':
      return <Cpu className={className} />;
    case 'wifi':
      return <Wifi className={className} />;
    case 'bot':
      return <Bot className={className} />;
    default:
      return <Globe className={className} />;
  }
}

export function isImageIconValue(icon?: string): boolean {
  if (!icon) return false;
  const v = icon.trim();
  return (
    v.startsWith('http://') ||
    v.startsWith('https://') ||
    v.startsWith('/') ||
    v.startsWith('data:image/')
  );
}

interface AppIconProps {
  icon?: string;
  title?: string;
  color?: string;
  boxClass?: string;
  iconClass?: string;
  roundedClass?: string;
  engineId?: string;
  targetUrl?: string;
}

export function AppIcon({
  icon,
  title = 'Orbit',
  color = '#6366f1',
  boxClass = 'w-9 h-9',
  iconClass = 'w-4 h-4',
  roundedClass = 'rounded-xl',
  engineId,
  targetUrl,
}: AppIconProps) {
  const [imgErr, setImgErr] = useState(false);
  const val = (icon || '').trim();

  useEffect(() => {
    setImgErr(false);
  }, [val]);

  const effectiveBrand = isBrandIconValue(val)
    ? val
    : !val && (engineId || targetUrl)
      ? resolveDefaultBrandIcon(engineId, targetUrl)
      : null;

  if (effectiveBrand) {
    const isMonochrome = effectiveBrand === 'brand:github' || effectiveBrand === 'brand:local';
    return (
      <div
        className={`card-icon ${boxClass} ${roundedClass} flex items-center justify-center shrink-0`}
        style={{
          color: effectiveBrand === 'brand:local' ? 'var(--brand)' : isMonochrome ? 'var(--ink)' : undefined,
        }}
      >
        <BrandIconSvg brand={effectiveBrand} className="w-[88%] h-[88%]" />
      </div>
    );
  }

  if (isImageIconValue(val) && !imgErr) {
    return (
      <div
        className={`card-icon ${boxClass} ${roundedClass} flex items-center justify-center shrink-0 overflow-hidden shadow-sm`}
        style={{ background: 'var(--pill-bg)' }}
      >
        <img
          src={val}
          alt={title}
          onError={() => setImgErr(true)}
          className="w-[74%] h-[74%] object-contain"
          loading="lazy"
        />
      </div>
    );
  }

  if (val.startsWith('text:')) {
    const ch = val.slice(5).trim() || title[0] || 'O';
    return (
      <div
        className={`card-icon ${boxClass} ${roundedClass} flex items-center justify-center text-white font-semibold shrink-0 shadow-sm`}
        style={{ background: `${color || '#6366f1'}cc` }}
      >
        <span className="leading-none text-sm">{ch.slice(0, 2)}</span>
      </div>
    );
  }

  const isBuiltin = (BUILTIN_ICON_NAMES as readonly string[]).includes(val);
  if (val && !isBuiltin && !isImageIconValue(val)) {
    return (
      <div
        className={`card-icon ${boxClass} ${roundedClass} flex items-center justify-center text-white font-semibold shrink-0 shadow-sm`}
        style={{ background: `${color || '#6366f1'}cc` }}
      >
        <span className="leading-none text-sm">{Array.from(val).slice(0, 2).join('')}</span>
      </div>
    );
  }

  if (isBuiltin) {
    return (
      <div
        className={`card-icon ${boxClass} ${roundedClass} flex items-center justify-center text-white shrink-0 shadow-sm`}
        style={{ background: `${color || '#6366f1'}cc` }}
      >
        <BookmarkIcon name={val} className={iconClass} />
      </div>
    );
  }

  // Fallback monogram badge (e.g., Search engine or broken image fallback)
  return (
    <div
      className={`card-icon ${boxClass} ${roundedClass} flex items-center justify-center text-slate-900 font-bold shrink-0 shadow-sm`}
      style={{ background: color || '#60a5fa' }}
    >
      <span className="text-xs leading-none">{(title[0] || 'O').toUpperCase()}</span>
    </div>
  );
}

export function getBookmarkActiveUrl(bm: Bookmark, zone: NetworkZone): string {
  if (zone === 'lan') return bm.lan_url || bm.ts_url || bm.wan_url;
  if (zone === 'tailscale') return bm.ts_url || bm.lan_url || bm.wan_url;
  return bm.wan_url || '';
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 4) return `${(bytes / 1024 ** 4).toFixed(2)} TB`;
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function formatSpeed(bps: number): string {
  if (bps >= 1024 ** 3) return `${(bps / 1024 ** 3).toFixed(2)} GB/s`;
  if (bps >= 1024 ** 2) return `${(bps / 1024 ** 2).toFixed(1)} MB/s`;
  if (bps >= 1024) return `${Math.round(bps / 1024)} KB/s`;
  return `${Math.round(bps)} B/s`;
}

export function formatLimitMB(mb: number): string {
  if (!Number.isFinite(mb) || mb <= 0) return '不限';
  if (mb >= 1024) {
    const gb = mb / 1024;
    return Number.isInteger(gb) ? `${gb} GB` : `${gb.toFixed(1)} GB`;
  }
  return `${mb} MB`;
}
