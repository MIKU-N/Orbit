import type { FooterConfig } from '../types';

interface FooterBarProps {
  footer: FooterConfig;
}

export function FooterBar({ footer }: FooterBarProps) {
  if (!footer?.enabled) return null;

  const hasContent =
    Boolean(footer.text?.trim()) ||
    (footer.links && footer.links.length > 0) ||
    footer.showPoweredBy;
  if (!hasContent) return null;

  const justifyCls =
    footer.align === 'left'
      ? 'justify-start'
      : footer.align === 'right'
        ? 'justify-end'
        : 'justify-center';

  return (
    <footer
      className={`relative z-10 w-full px-4 sm:px-6 pb-20 md:pb-4 pt-2 flex ${justifyCls} text-xs pointer-events-none`}
    >
      <div
        className={`pointer-events-auto inline-flex items-center flex-wrap gap-x-3 gap-y-1 px-4 py-1.5 rounded-full border transition-colors duration-200 ${
          footer.glassBg ? 'glass' : 'border-transparent bg-transparent shadow-none'
        }`}
        style={{ color: 'var(--ink-muted)' }}
      >
        {footer.text?.trim() && <span>{footer.text}</span>}

        {footer.links?.map((lk, idx) => {
          const href = lk.url?.trim();
          const label = lk.label?.trim();
          if (!label || !href) return null;
          return (
            <a
              key={`${label}-${idx}`}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline transition-opacity hover:opacity-100 opacity-85"
              style={{ color: 'var(--ink)' }}
            >
              {label}
            </a>
          );
        })}

        {footer.showPoweredBy && (
          <span style={{ color: 'var(--ink-subtle)' }}>Powered by Orbit</span>
        )}
      </div>
    </footer>
  );
}
