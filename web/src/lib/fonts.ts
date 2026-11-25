import type { FontConfig, ResourceCdnConfig } from '../types';
import { resolveCdnBase } from './cdn';

export interface BuiltinFont {
  id: string;
  name: string;
  desc: string;
  sample: string;
  family: string;
  /** Relative npm package CSS paths loaded only when an external CDN is explicitly enabled. */
  npmCssPaths: string[];
}

export const SYSTEM_FALLBACK_FAMILY =
  "system-ui, -apple-system, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC', 'Segoe UI', sans-serif";

export const BUILTIN_FONTS: BuiltinFont[] = [
  {
    id: 'system',
    name: '系统原生',
    desc: '100% 本地零网络加载',
    sample: 'Orbit 星轨 12:45',
    family: SYSTEM_FALLBACK_FAMILY,
    npmCssPaths: [],
  },
  {
    id: 'noto-sans',
    name: '思源黑体',
    desc: '现代中文无衬线（可选 CDN）',
    sample: 'Orbit 星轨 12:45',
    family: `'Noto Sans SC', 'Inter', ${SYSTEM_FALLBACK_FAMILY}`,
    npmCssPaths: [
      '@fontsource/inter@5.2.5/400.css',
      '@fontsource/inter@5.2.5/500.css',
      '@fontsource/inter@5.2.5/600.css',
      '@fontsource/noto-sans-sc@5.2.5/400.css',
      '@fontsource/noto-sans-sc@5.2.5/500.css',
      '@fontsource/noto-sans-sc@5.2.5/700.css',
    ],
  },
  {
    id: 'ubuntu-mono',
    name: 'Ubuntu Mono',
    desc: '开源极客等宽字体',
    sample: 'Orbit 星轨 12:45',
    family: `'Ubuntu Mono', 'Noto Sans SC', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`,
    npmCssPaths: [
      '@fontsource/ubuntu-mono@5.2.5/400.css',
      '@fontsource/ubuntu-mono@5.2.5/700.css',
    ],
  },
  {
    id: 'oppo-sans-4',
    name: 'OPPO Sans 4',
    desc: 'OPPO 现代可变无衬线',
    sample: 'Orbit 星轨 12:45',
    family: `'OPPO Sans 4.0', 'OPPO Sans', ${SYSTEM_FALLBACK_FAMILY}`,
    npmCssPaths: ['@luzixu/oppo-sans@0.1.2/wght.css'],
  },
  {
    id: 'mi-sans',
    name: 'Mi Sans',
    desc: '小米极简几何无衬线',
    sample: 'Orbit 星轨 12:45',
    family: `'MiSans', ${SYSTEM_FALLBACK_FAMILY}`,
    npmCssPaths: [
      'misans@4.0.0/lib/Normal/MiSans-Regular.min.css',
      'misans@4.0.0/lib/Normal/MiSans-Medium.min.css',
      'misans@4.0.0/lib/Normal/MiSans-Bold.min.css',
    ],
  },
];

function syncBuiltinFontLinks(urls: string[]) {
  const existing = Array.from(
    document.querySelectorAll<HTMLLinkElement>('link[data-orbit-builtin-font="1"]'),
  );
  const existingHrefs = new Set(existing.map((el) => el.getAttribute('data-href') || ''));
  const targetSet = new Set(urls);

  for (const el of existing) {
    const href = el.getAttribute('data-href') || '';
    if (!targetSet.has(href)) {
      el.remove();
    }
  }

  for (const href of urls) {
    if (!href || existingHrefs.has(href)) continue;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.crossOrigin = 'anonymous';
    link.setAttribute('data-orbit-builtin-font', '1');
    link.setAttribute('data-href', href);
    document.head.appendChild(link);
  }
}

function upsertStylesheetLink(id: string, href?: string) {
  const existing = document.getElementById(id) as HTMLLinkElement | null;
  if (!href) {
    existing?.remove();
    return;
  }
  if (existing) {
    if (existing.href !== href) existing.href = href;
    return;
  }
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

function upsertStyleTag(id: string, cssText?: string) {
  const existing = document.getElementById(id) as HTMLStyleElement | null;
  if (!cssText) {
    existing?.remove();
    return;
  }
  if (existing) {
    existing.textContent = cssText;
    return;
  }
  const style = document.createElement('style');
  style.id = id;
  style.textContent = cssText;
  document.head.appendChild(style);
}

function buildFontUrls(paths: string[], cdnBase: string): string[] {
  if (!cdnBase || paths.length === 0) return [];
  return paths.map((p) => `${cdnBase}/${p.replace(/^\/+/, '')}`);
}

export function applyGlobalFont(config?: FontConfig, cdnConfig?: ResourceCdnConfig) {
  const activeId = config?.activeId || 'system';
  const cdnBase = resolveCdnBase(cdnConfig);
  const builtin = BUILTIN_FONTS.find((f) => f.id === activeId);
  const custom = config?.customFonts?.find((f) => f.id === activeId);

  if (custom) {
    // Never inject external builtin font CDNs when a local/custom font is selected
    syncBuiltinFontLinks([]);
    if (custom.kind === 'css') {
      upsertStylesheetLink('orbit-font-custom-css', custom.url);
      upsertStyleTag('orbit-font-custom-face');
    } else {
      upsertStylesheetLink('orbit-font-custom-css');
      const fmtClause = custom.format ? ` format('${custom.format}')` : '';
      const faceName = custom.family.replace(/'/g, '');
      upsertStyleTag(
        'orbit-font-custom-face',
        `@font-face { font-family: '${faceName}'; src: url('${custom.url}')${fmtClause}; font-display: swap; }`,
      );
    }
    const faceQuoted = `'${custom.family.replace(/'/g, '')}'`;
    document.documentElement.style.setProperty(
      '--orbit-font',
      `${faceQuoted}, ${SYSTEM_FALLBACK_FAMILY}`,
    );
    return;
  }

  upsertStylesheetLink('orbit-font-custom-css');
  upsertStyleTag('orbit-font-custom-face');
  const chosen = builtin || BUILTIN_FONTS[0];
  syncBuiltinFontLinks(buildFontUrls(chosen.npmCssPaths, cdnBase));
  document.documentElement.style.setProperty('--orbit-font', chosen.family);
}
