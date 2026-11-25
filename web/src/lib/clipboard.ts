/**
 * Universal clipboard writer that works reliably in both HTTPS/localhost
 * secure contexts and plain HTTP LAN/Tailscale origins.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  if (typeof navigator !== 'undefined' && window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to legacy execCommand copy
    }
  }

  try {
    const activeEl = document.activeElement as HTMLElement | null;
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '0';
    ta.style.width = '2em';
    ta.style.height = '2em';
    ta.style.padding = '0';
    ta.style.border = 'none';
    ta.style.outline = 'none';
    ta.style.boxShadow = 'none';
    ta.style.background = 'transparent';
    ta.style.opacity = '0';
    ta.style.fontSize = '16px';
    ta.style.zIndex = '-1';

    document.body.appendChild(ta);
    ta.focus({ preventScroll: true });
    ta.select();
    ta.setSelectionRange(0, text.length);

    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    if (activeEl && typeof activeEl.focus === 'function') {
      try {
        activeEl.focus({ preventScroll: true });
      } catch {
        // ignore focus restore failure
      }
    }
    return ok;
  } catch {
    return false;
  }
}
