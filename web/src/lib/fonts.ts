import type { FontConfig } from '../types';

export interface BuiltinFont {
  id: string;
  name: string;
  desc: string;
  sample: string;
  family: string;
  cssUrls: string[];
}

export const BUILTIN_FONTS: BuiltinFont[] = [
  {
    id: 'noto-sans',
    name: '思源黑体',
    desc: '开源现代中文无衬线',
    sample: 'Orbit 星轨 12:45',
    family: "'Noto Sans SC', 'Inter', system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif",
    cssUrls: [
      'https://fonts.loli.net/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+SC:wght@400;500;600;700&display=swap',
    ],
  },
  {
    id: 'ubuntu-mono',
    name: 'Ubuntu Mono',
    desc: '开源极客等宽字体',
    sample: 'Orbit 星轨 12:45',
    family: "'Ubuntu Mono', 'Noto Sans SC', ui-monospace, monospace",
    cssUrls: [
      'https://fonts.loli.net/css2?family=Ubuntu+Mono:wght@400;700&family=Noto+Sans+SC:wght@400;500;700&display=swap',
    ],
  },
  {
    id: 'oppo-sans-4',
    name: 'OPPO Sans 4',
    desc: 'OPPO 现代可变无衬线',
    sample: 'Orbit 星轨 12:45',
    family: "'OPPO Sans 4.0', 'OPPO Sans', system-ui, -apple-system, 'PingFang SC', sans-serif",
    cssUrls: ['https://cdn.jsdelivr.net/npm/@luzixu/oppo-sans@0.1.2/wght.css'],
  },
  {
    id: 'mi-sans',
    name: 'Mi Sans',
    desc: '小米极简几何无衬线',
    sample: 'Orbit 星轨 12:45',
    family: "'MiSans', system-ui, -apple-system, 'PingFang SC', sans-serif",
    cssUrls: [
      'https://cdn.jsdelivr.net/npm/misans@latest/lib/Normal/MiSans-Regular.min.css',
      'https://cdn.jsdelivr.net/npm/misans@latest/lib/Normal/MiSans-Medium.min.css',
      'https://cdn.jsdelivr.net/npm/misans@latest/lib/Normal/MiSans-Bold.min.css',
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

export function applyGlobalFont(config?: FontConfig) {
  const activeId = config?.activeId || 'noto-sans';
  const builtin = BUILTIN_FONTS.find((f) => f.id === activeId);
  const custom = config?.customFonts?.find((f) => f.id === activeId);

  if (custom) {
    syncBuiltinFontLinks(BUILTIN_FONTS[0].cssUrls);
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
      `${faceQuoted}, ${BUILTIN_FONTS[0].family}`,
    );
    return;
  }

  upsertStylesheetLink('orbit-font-custom-css');
  upsertStyleTag('orbit-font-custom-face');
  const chosen = builtin || BUILTIN_FONTS[0];
  syncBuiltinFontLinks(chosen.cssUrls);
  document.documentElement.style.setProperty('--orbit-font', chosen.family);
}
