import { useState } from 'react';
import type { FooterConfig, FooterLink } from '../types';
import { BUILTIN_ICON_NAMES, BookmarkIcon, isImageIconValue } from '../sdk/primitives';

interface FooterBarProps {
  footer: FooterConfig;
  version?: string;
}

function FooterLinkIcon({ icon, label }: { icon?: string; label: string }) {
  const [imgErr, setImgErr] = useState(false);
  const val = (icon || '').trim();
  if (!val) return null;

  if (isImageIconValue(val) && !imgErr) {
    return (
      <img
        src={val}
        alt={label}
        onError={() => setImgErr(true)}
        className="w-3.5 h-3.5 rounded-[3px] object-contain shrink-0"
        loading="lazy"
      />
    );
  }
  if ((BUILTIN_ICON_NAMES as readonly string[]).includes(val)) {
    return <BookmarkIcon name={val} className="w-3.5 h-3.5 shrink-0 opacity-85" />;
  }
  if (!isImageIconValue(val)) {
    return <span className="text-xs leading-none shrink-0">{Array.from(val).slice(0, 2).join('')}</span>;
  }
  return null;
}

function splitIntoColumns(links: FooterLink[]): FooterLink[][] {
  if (links.length === 0) return [];
  if (links.length <= 2) return links.map((l) => [l]);
  const colCount = links.length <= 4 ? 2 : 3;
  const cols: FooterLink[][] = Array.from({ length: colCount }, () => []);
  const perCol = Math.ceil(links.length / colCount);
  links.forEach((lk, idx) => {
    const colIdx = Math.min(colCount - 1, Math.floor(idx / perCol));
    cols[colIdx].push(lk);
  });
  return cols.filter((c) => c.length > 0);
}

export function FooterBar({ footer, version }: FooterBarProps) {
  if (!footer?.enabled) return null;

  const validLinks = (footer.links || []).filter((lk) => lk.label?.trim() && lk.url?.trim());
  const hasBrandCol = Boolean(footer.text?.trim()) || footer.showPoweredBy;
  if (!hasBrandCol && validLinks.length === 0) return null;

  const linkColumns = splitIntoColumns(validLinks);

  return (
    <footer
      data-orbit-footer="1"
      className="relative z-10 w-full px-4 sm:px-6 pb-20 md:pb-3 pt-1.5 flex items-center justify-center text-xs pointer-events-none"
    >
      <div
        className={`pointer-events-auto inline-flex flex-wrap items-center justify-center gap-x-6 gap-y-2.5 px-5 py-2.5 transition-colors duration-200 ${
          footer.glassBg
            ? 'glass rounded-2xl'
            : 'border border-transparent bg-transparent shadow-none hero-shadow'
        }`}
        style={{ color: footer.glassBg ? 'var(--ink-muted)' : 'var(--hero-ink-muted)' }}
      >
        {hasBrandCol && (
          <div className="flex flex-col items-center justify-center text-center gap-0.5">
            {footer.text?.trim() && (
              <span
                className="font-medium leading-snug"
                style={{ color: footer.glassBg ? 'var(--ink)' : 'var(--hero-ink)' }}
              >
                {footer.text}
              </span>
            )}
            {footer.showPoweredBy && (
              <a
                href="https://github.com/MIKU-N/Orbit"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] opacity-80 hover:opacity-100 hover:underline leading-snug transition-opacity"
                style={{ color: footer.glassBg ? 'var(--ink-muted)' : 'var(--hero-ink-muted)' }}
              >
                Powered by Orbit{version ? ` v${version}` : ''}
              </a>
            )}
          </div>
        )}

        {hasBrandCol && linkColumns.length > 0 && (
          <span
            className="hidden sm:block w-px h-6 opacity-40"
            style={{ background: footer.glassBg ? 'var(--glass-border-hover)' : 'rgba(255,255,255,0.45)' }}
            aria-hidden="true"
          />
        )}

        {linkColumns.map((col, colIdx) => (
          <div
            key={`col-${colIdx}`}
            className="flex flex-col items-center justify-center gap-1"
          >
            {col.map((lk, idx) => (
              <a
                key={`${lk.label}-${idx}`}
                href={lk.url.trim()}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-1.5 leading-snug hover:underline opacity-90 hover:opacity-100 transition-opacity"
                style={{ color: footer.glassBg ? 'var(--ink)' : 'var(--hero-ink)' }}
              >
                <FooterLinkIcon icon={lk.icon} label={lk.label} />
                <span>{lk.label.trim()}</span>
              </a>
            ))}
          </div>
        ))}
      </div>
    </footer>
  );
}
