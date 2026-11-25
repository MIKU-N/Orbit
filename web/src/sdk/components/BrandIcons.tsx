import type React from 'react';

export type BrandIconKey = 'brand:google' | 'brand:bing' | 'brand:github' | 'brand:bilibili' | 'brand:local';

export function resolveDefaultBrandIcon(engineId?: string, url?: string): BrandIconKey | null {
  const id = (engineId || '').toLowerCase();
  const u = (url || '').toLowerCase();
  if (id === 'google' || u.includes('google.com')) return 'brand:google';
  if (id === 'bing' || u.includes('bing.com')) return 'brand:bing';
  if (id === 'github' || u.includes('github.com')) return 'brand:github';
  if (id === 'bilibili' || u.includes('bilibili.com')) return 'brand:bilibili';
  if (id === 'local') return 'brand:local';
  return null;
}

export function isBrandIconValue(icon?: string): icon is BrandIconKey {
  return (
    icon === 'brand:google' ||
    icon === 'brand:bing' ||
    icon === 'brand:github' ||
    icon === 'brand:bilibili' ||
    icon === 'brand:local'
  );
}

export function BrandIconSvg({
  brand,
  className = 'w-4 h-4',
}: {
  brand: BrandIconKey;
  className?: string;
}): React.ReactNode {
  switch (brand) {
    case 'brand:google':
      return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="#4285F4"
            d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47a5.53 5.53 0 0 1-2.4 3.63v3.02h3.88c2.27-2.09 3.54-5.17 3.54-8.89Z"
          />
          <path
            fill="#34A853"
            d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.02c-1.07.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.12A12 12 0 0 0 12 24Z"
          />
          <path
            fill="#FBBC05"
            d="M5.28 14.27A7.2 7.2 0 0 1 4.9 12c0-.79.14-1.56.38-2.27V6.61H1.29A12 12 0 0 0 0 12c0 1.94.46 3.77 1.29 5.39l3.99-3.12Z"
          />
          <path
            fill="#EA4335"
            d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.29 6.61l3.99 3.12C6.23 6.86 8.88 4.75 12 4.75Z"
          />
        </svg>
      );

    case 'brand:bing':
      return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
          <defs>
            <linearGradient id="orbitBingGrad" x1="20%" y1="5%" x2="85%" y2="95%">
              <stop offset="0%" stopColor="#38BDF8" />
              <stop offset="55%" stopColor="#0EA5E9" />
              <stop offset="100%" stopColor="#0284C7" />
            </linearGradient>
          </defs>
          <path
            fill="url(#orbitBingGrad)"
            d="M5.2 2.4L9.4 3.9V16.2L15.1 12.9L12.6 11.7L11.1 7.9L19.1 10.7V15.3L9.4 21.6L5.2 19.2V2.4Z"
          />
          <path
            fill="#7DD3FC"
            opacity="0.85"
            d="M11.1 7.9L19.1 10.7L15.1 12.9L12.6 11.7L11.1 7.9Z"
          />
        </svg>
      );

    case 'brand:github':
      return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55 0-.27-.01-1.17-.02-2.12-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.68 0-1.25.45-2.28 1.18-3.08-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.16 1.18a10.96 10.96 0 0 1 5.76 0c2.19-1.49 3.16-1.18 3.16-1.18.62 1.58.23 2.75.11 3.04.74.8 1.18 1.83 1.18 3.08 0 4.41-2.69 5.39-5.26 5.67.41.36.78 1.06.78 2.14 0 1.54-.01 2.79-.01 3.17 0 .31.21.67.8.55A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z"
          />
        </svg>
      );

    case 'brand:bilibili':
      return (
        <svg className={className} viewBox="0 0 24 24" fill="#FB7299" aria-hidden="true">
          <path d="M7.17 3.12a.9.9 0 0 1 1.27.08l1.82 2.05h3.48l1.82-2.05a.9.9 0 1 1 1.35 1.19L15.96 5.5h2.29A3.75 3.75 0 0 1 22 9.25v7.5a3.75 3.75 0 0 1-3.75 3.75H5.75A3.75 3.75 0 0 1 2 16.75v-7.5A3.75 3.75 0 0 1 5.75 5.5h2.29L7.09 4.39a.9.9 0 0 1 .08-1.27ZM5.75 7.3A1.95 1.95 0 0 0 3.8 9.25v7.5c0 1.08.87 1.95 1.95 1.95h12.5c1.08 0 1.95-.87 1.95-1.95v-7.5a1.95 1.95 0 0 0-1.95-1.95H5.75ZM8.5 10.6a1.1 1.1 0 0 1 1.1 1.1v1.7a1.1 1.1 0 1 1-2.2 0v-1.7a1.1 1.1 0 0 1 1.1-1.1Zm7 0a1.1 1.1 0 0 1 1.1 1.1v1.7a1.1 1.1 0 1 1-2.2 0v-1.7a1.1 1.1 0 0 1 1.1-1.1Z" />
        </svg>
      );

    case 'brand:local':
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <ellipse
            cx="12"
            cy="12"
            rx="9.5"
            ry="4.2"
            transform="rotate(-28 12 12)"
            stroke="currentColor"
            strokeWidth="1.7"
            opacity="0.85"
          />
          <circle cx="12" cy="12" r="3.6" fill="currentColor" />
          <circle cx="18.2" cy="7.4" r="1.4" fill="currentColor" />
        </svg>
      );
  }
}
