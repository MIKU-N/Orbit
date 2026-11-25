import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface CenteredModalProps {
  open: boolean;
  onClose?: () => void;
  closeOnBackdrop?: boolean;
  zIndexClass?: string;
  panelClassName?: string;
  panelStyle?: React.CSSProperties;
  onDragOver?: React.DragEventHandler<HTMLDivElement>;
  onDrop?: React.DragEventHandler<HTMLDivElement>;
  children: React.ReactNode;
}

const EXIT_DURATION_MS = 180;

function areAnimationsDisabled(): boolean {
  if (typeof document === 'undefined') return true;
  if (document.documentElement.dataset.orbitAnimations === 'off') return true;
  return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

/**
 * Unified centered modal card container portaled to `.orbit-shell` so all
 * settings & configuration dialogs share identical centering, glass framing,
 * spring enter/exit motion, and interruptible non-blocking teardown.
 */
export function CenteredModal({
  open,
  onClose,
  closeOnBackdrop = true,
  zIndexClass = 'z-50',
  panelClassName = 'w-full max-w-md p-5',
  panelStyle,
  onDragOver,
  onDrop,
  children,
}: CenteredModalProps) {
  const [rendered, setRendered] = useState(open);
  const [phase, setPhase] = useState<'open' | 'closing'>('open');
  const closeTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (closeTimerRef.current !== undefined) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = undefined;
    }

    if (open) {
      setRendered(true);
      setPhase('open');
      return;
    }

    if (!rendered) return;

    if (areAnimationsDisabled()) {
      setRendered(false);
      setPhase('open');
      return;
    }

    setPhase('closing');
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = undefined;
      setRendered(false);
      setPhase('open');
    }, EXIT_DURATION_MS);
  }, [open, rendered]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== undefined) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  if (!rendered) return null;

  const portalTarget =
    (typeof document !== 'undefined' &&
      (document.querySelector('.orbit-shell') || document.body)) ||
    null;

  const node = (
    <div
      className={`orbit-modal-shell fixed inset-0 ${zIndexClass} flex items-center justify-center p-3 sm:p-5 ${
        phase === 'closing' ? 'pointer-events-none' : ''
      }`}
      data-state={phase}
      onClick={(e) => {
        e.stopPropagation();
        if (phase === 'open' && closeOnBackdrop && onClose) {
          onClose();
        }
      }}
    >
      <div className="orbit-modal-backdrop absolute inset-0 bg-black/55 backdrop-blur-xs" />
      <div
        onClick={(e) => e.stopPropagation()}
        onDragOver={onDragOver}
        onDrop={onDrop}
        style={panelStyle}
        className={`orbit-modal-card relative z-10 glass-strong rounded-3xl shadow-2xl ${panelClassName}`}
      >
        {children}
      </div>
    </div>
  );

  return portalTarget ? createPortal(node, portalTarget) : node;
}
