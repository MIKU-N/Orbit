import type React from 'react';

export type ThemeTransitionOrigin =
  | React.MouseEvent<HTMLElement>
  | MouseEvent
  | HTMLElement
  | { clientX: number; clientY: number }
  | null
  | undefined;

const BASE_WAVE_SIZE = 160;

let fadeTimer: number | undefined;
let activeStageEl: HTMLDivElement | null = null;
let waveTimer: number | undefined;

function isAnimationsDisabled(): boolean {
  if (typeof document === 'undefined') return true;
  if (document.documentElement.dataset.orbitAnimations === 'off') return true;
  return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

/**
 * Immediately clears any in-flight theme wave overlay and transition timer.
 */
export function interruptThemeTransition(): void {
  if (fadeTimer !== undefined) {
    window.clearTimeout(fadeTimer);
    fadeTimer = undefined;
  }
  if (waveTimer !== undefined) {
    window.clearTimeout(waveTimer);
    waveTimer = undefined;
  }
  if (activeStageEl) {
    activeStageEl.remove();
    activeStageEl = null;
  }
  if (typeof document !== 'undefined') {
    document.documentElement.classList.remove('orbit-theme-fade');
  }
}

function resolveOrigin(origin?: ThemeTransitionOrigin): { x: number; y: number } {
  if (origin) {
    if ('clientX' in origin && 'clientY' in origin) {
      const cx = origin.clientX;
      const cy = origin.clientY;
      if (cx > 0 || cy > 0) {
        return { x: cx, y: cy };
      }
      if (
        'currentTarget' in origin &&
        origin.currentTarget &&
        'getBoundingClientRect' in origin.currentTarget
      ) {
        const rect = (origin.currentTarget as HTMLElement).getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }
    } else if ('getBoundingClientRect' in origin) {
      const rect = origin.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
  }
  return { x: window.innerWidth - 96, y: 36 };
}

/**
 * Transitions between Day and Night themes directly on the live DOM without freezing
 * the viewport. Uses GPU-lightweight fixed 160px radial wave scaling (prevents high-DPR
 * Android WebView tile-memory flicker) paired with synchronized CSS background-color /
 * color / border-color crossfading.
 */
export function runThemeTransition(
  apply: () => void,
  origin?: ThemeTransitionOrigin,
  nextTheme?: 'dark' | 'light',
): void {
  if (isAnimationsDisabled()) {
    interruptThemeTransition();
    apply();
    return;
  }

  if (waveTimer !== undefined) {
    window.clearTimeout(waveTimer);
    waveTimer = undefined;
  }
  if (activeStageEl) {
    activeStageEl.remove();
    activeStageEl = null;
  }
  if (fadeTimer !== undefined) {
    window.clearTimeout(fadeTimer);
    fadeTimer = undefined;
  }

  const root = document.documentElement;
  root.classList.add('orbit-theme-fade');

  // Apply the new theme immediately on live interactive DOM elements
  apply();

  // Scale a small fixed 160x160 GPU texture inside a viewport-clipped non-blocking stage
  const { x, y } = resolveOrigin(origin);
  const maxRadius = Math.ceil(
    Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y)),
  );
  const targetScale = Math.max(2, (maxRadius * 2) / BASE_WAVE_SIZE);

  const stage = document.createElement('div');
  stage.className = 'orbit-theme-wave-stage';
  stage.setAttribute('aria-hidden', 'true');

  const wave = document.createElement('div');
  wave.className = 'orbit-theme-wave';
  wave.dataset.theme = nextTheme || 'dark';
  wave.style.left = `${Math.round(x)}px`;
  wave.style.top = `${Math.round(y)}px`;
  wave.style.setProperty('--wave-scale', targetScale.toFixed(2));

  stage.appendChild(wave);
  document.body.appendChild(stage);
  activeStageEl = stage;

  waveTimer = window.setTimeout(() => {
    if (activeStageEl === stage) {
      activeStageEl = null;
    }
    stage.remove();
    waveTimer = undefined;
  }, 680);

  fadeTimer = window.setTimeout(() => {
    fadeTimer = undefined;
    root.classList.remove('orbit-theme-fade');
  }, 540);
}
