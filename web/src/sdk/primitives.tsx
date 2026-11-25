import type React from 'react';
import {
  Activity,
  Bookmark,
  Clipboard,
  Clock,
  CloudSun,
  Cpu,
  FolderUp,
  Globe,
  LayoutGrid,
  Palette,
  Plug,
  Quote,
  Search,
  Settings,
  UploadCloud,
  User,
} from 'lucide-react';

export { MotionCard } from './components/MotionCard';
export { WidgetSurface } from './components/WidgetSurface';
export { CenteredModal } from './components/CenteredModal';
export { OrbitSelect, type OrbitSelectOption } from './components/OrbitSelect';
export { BrandIconSvg, isBrandIconValue, resolveDefaultBrandIcon } from './components/BrandIcons';
export { RangeField } from './components/RangeField';
export { IconPicker } from './components/IconPicker';
export {
  AppIcon,
  BUILTIN_ICON_NAMES,
  BookmarkIcon,
  formatBytes,
  formatLimitMB,
  formatSpeed,
  getBookmarkActiveUrl,
  isImageIconValue,
} from './components/Icons';

export function SharedBadge({ label = '管理员共享' }: { label?: string }) {
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-medium shrink-0"
      style={{
        background: 'rgba(99, 102, 241, 0.14)',
        border: '1px solid rgba(99, 102, 241, 0.28)',
        color: 'var(--brand)',
      }}
    >
      {label}
    </span>
  );
}

export function formatUptime(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '0m';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function getPluginIcon(name: string, className = 'w-4 h-4'): React.ReactNode {
  switch (name) {
    case 'clock':
      return <Clock className={className} />;
    case 'search':
      return <Search className={className} />;
    case 'cloud-sun':
      return <CloudSun className={className} />;
    case 'bookmark':
      return <Bookmark className={className} />;
    case 'cpu':
    case 'activity':
      return <Cpu className={className} />;
    case 'clipboard':
      return <Clipboard className={className} />;
    case 'upload-cloud':
    case 'folder-up':
      return <UploadCloud className={className} />;
    case 'palette':
      return <Palette className={className} />;
    case 'layout':
      return <LayoutGrid className={className} />;
    case 'user':
      return <User className={className} />;
    case 'settings':
      return <Settings className={className} />;
    case 'globe':
      return <Globe className={className} />;
    case 'quote':
      return <Quote className={className} />;
    case 'plug':
    default:
      return <Plug className={className} />;
  }
}
