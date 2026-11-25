import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ResolvedWidget } from '../sdk/types';
import type { FreeLayoutMap, LayoutBox, LayoutItemId, UserSettings } from '../types';

interface UseFreeLayoutArgs {
  canvasRef: React.RefObject<HTMLElement | null>;
  widgets: ResolvedWidget[];
  settings: UserSettings;
  layoutEditing: boolean;
  onPersistLayout: (next: {
    hasCustomLayout: boolean;
    layout: FreeLayoutMap | null;
    visibleItems: Record<LayoutItemId, boolean>;
  }) => void;
  depsKey: string;
}

interface PlacedRect {
  id: string;
  el: HTMLElement;
  left: number;
  top: number;
  w: number;
  h: number;
  minW: number;
  z: number;
}

const EDGE_PAD = 12;
const ITEM_GAP = 14;
const FOOTER_CLEARANCE = 14;
const SNAP_ENTER = 8;
const SNAP_RELEASE = 13;

function measureChromeHeights(): { topBarH: number; footerH: number } {
  const topBarH = document.getElementById('topBar')?.offsetHeight || 52;
  const footerEl = document.querySelector<HTMLElement>('footer[data-orbit-footer="1"]');
  const footerH = footerEl ? footerEl.offsetHeight : 0;
  return { topBarH, footerH };
}

function rectsOverlap(a: PlacedRect, b: PlacedRect, gap: number): boolean {
  return (
    a.left < b.left + b.w + gap &&
    a.left + a.w + gap > b.left &&
    a.top < b.top + b.h + gap &&
    a.top + a.h + gap > b.top
  );
}

/**
 * Resolves any card overlaps caused by narrow viewports, extreme aspect ratios,
 * or async widget height growth (e.g. font load, wrapping text, bookmark count).
 */
function resolveOverlaps(placed: PlacedRect[], canvasW: number): void {
  if (placed.length < 2) return;
  const usableW = Math.max(240, canvasW - EDGE_PAD * 2);

  placed.sort((a, b) => (Math.abs(a.top - b.top) > 16 ? a.top - b.top : a.left - b.left));

  const maxPasses = placed.length * 3;
  for (let pass = 0; pass < maxPasses; pass += 1) {
    let moved = false;

    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        const a = placed[i];
        const b = placed[j];
        if (!rectsOverlap(a, b, ITEM_GAP - 2)) continue;

        const overlapY = Math.min(a.top + a.h, b.top + b.h) - Math.max(a.top, b.top);
        const minH = Math.max(1, Math.min(a.h, b.h));
        const looksSideBySide = overlapY / minH > 0.45;

        // If two cards were side-by-side and can still fit side-by-side by shrinking/shifting horizontally, do that first.
        if (looksSideBySide && a.minW + b.minW + ITEM_GAP <= usableW) {
          const leftCard = a.left <= b.left ? a : b;
          const rightCard = leftCard === a ? b : a;
          const totalNeeded = leftCard.w + rightCard.w + ITEM_GAP;

          if (totalNeeded > usableW) {
            const scale = (usableW - ITEM_GAP) / (leftCard.w + rightCard.w);
            const nextLeftW = Math.max(leftCard.minW, Math.floor(leftCard.w * scale));
            const nextRightW = Math.max(
              rightCard.minW,
              Math.min(rightCard.w, usableW - ITEM_GAP - nextLeftW),
            );
            const finalLeftW = Math.max(
              leftCard.minW,
              Math.min(nextLeftW, usableW - ITEM_GAP - nextRightW),
            );
            if (finalLeftW + nextRightW + ITEM_GAP <= usableW) {
              leftCard.w = finalLeftW;
              rightCard.w = nextRightW;
              leftCard.el.style.width = `${leftCard.w}px`;
              rightCard.el.style.width = `${rightCard.w}px`;
              leftCard.h = leftCard.el.offsetHeight || leftCard.h;
              rightCard.h = rightCard.el.offsetHeight || rightCard.h;
              const startX = Math.max(
                EDGE_PAD,
                Math.round((canvasW - (leftCard.w + rightCard.w + ITEM_GAP)) / 2),
              );
              leftCard.left = startX;
              rightCard.left = startX + leftCard.w + ITEM_GAP;
              moved = true;
              continue;
            }
          } else {
            // Try pushing rightCard to the right of leftCard, shifting leftCard left if needed
            let nextRightLeft = leftCard.left + leftCard.w + ITEM_GAP;
            if (nextRightLeft + rightCard.w <= canvasW - EDGE_PAD) {
              rightCard.left = nextRightLeft;
              moved = true;
              continue;
            }
            const overflow = nextRightLeft + rightCard.w - (canvasW - EDGE_PAD);
            const nextLeftLeft = Math.max(EDGE_PAD, leftCard.left - overflow);
            nextRightLeft = nextLeftLeft + leftCard.w + ITEM_GAP;
            if (nextRightLeft + rightCard.w <= canvasW - EDGE_PAD) {
              leftCard.left = nextLeftLeft;
              rightCard.left = nextRightLeft;
              moved = true;
              continue;
            }
          }
        }

        // Otherwise resolve vertically by pushing the lower card down below the upper card
        const upper = a.top <= b.top ? a : b;
        const lower = upper === a ? b : a;
        const targetTop = Math.round(upper.top + upper.h + ITEM_GAP);
        if (lower.top < targetTop) {
          lower.top = targetTop;
          moved = true;
        }
      }
    }

    if (!moved) break;
  }
}

export type ResizeAxis = 'e' | 's' | 'se';

export interface ResizingDimension {
  id: LayoutItemId;
  w: number;
  h?: number;
}

export function useFreeLayout({
  canvasRef,
  widgets,
  settings,
  layoutEditing,
  onPersistLayout,
  depsKey,
}: UseFreeLayoutArgs) {
  const [snap, setSnap] = useState(true);
  const [guideV, setGuideV] = useState<number | null>(null);
  const [guideH, setGuideH] = useState<number | null>(null);
  const [draggingId, setDraggingId] = useState<LayoutItemId | null>(null);
  const [resizingDim, setResizingDim] = useState<ResizingDimension | null>(null);

  const zCounterRef = useRef(20);
  const localLayoutRef = useRef<FreeLayoutMap | null>(settings.layout);
  const isInteractingRef = useRef(false);
  const lastGuideVRef = useRef<number | null>(null);
  const lastGuideHRef = useRef<number | null>(null);

  useEffect(() => {
    if (isInteractingRef.current) return;
    localLayoutRef.current = settings.layout;
    if (settings.layout) {
      const zVals = Object.values(settings.layout).map((b) => b?.z || 10);
      if (zVals.length > 0) {
        zCounterRef.current = Math.max(zCounterRef.current, ...zVals);
      }
    }
  }, [settings.layout]);

  const visibleWidgets = useMemo(() => widgets.filter((w) => w.visible), [widgets]);
  const widgetMap = useMemo(() => new Map(widgets.map((w) => [w.key, w])), [widgets]);
  const visibleKeys = useMemo(() => visibleWidgets.map((w) => w.key), [visibleWidgets]);

  const getMinW = useCallback(
    (key: string) => widgetMap.get(key)?.widget.minW || 200,
    [widgetMap],
  );

  const getMinH = useCallback((key: string) => {
    switch (key) {
      case 'search':
      case 'hitokoto':
        return 48;
      case 'clock':
        return 64;
      case 'weather':
      case 'monitor':
        return 92;
      case 'bookmarks':
        return 120;
      default:
        return 96;
    }
  }, []);

  const computeDefaultLayout = useCallback((): FreeLayoutMap => {
    const canvas = canvasRef.current;
    const W = Math.max(canvas?.clientWidth || window.innerWidth, 768);
    const { topBarH, footerH } = measureChromeHeights();
    const availH = Math.max(window.innerHeight - topBarH - footerH, 360);
    const contentW = Math.min(980, Math.max(320, W - 64));
    const leftEdge = Math.round((W - contentW) / 2);
    const gap = ITEM_GAP;

    const isVis = (id: string) => visibleWidgets.some((w) => w.key === id);
    const showClock = isVis('clock');
    const showSearch = isVis('search');
    const showW = isVis('weather');
    const showM = isVis('monitor');
    const showHitokoto = isVis('hitokoto');
    const showBookmarks = isVis('bookmarks');

    const weatherMinW = widgetMap.get('weather')?.widget.minW || 260;
    const monitorMinW = widgetMap.get('monitor')?.widget.minW || 300;
    const stacked = contentW < weatherMinW + monitorMinW + gap + 32;

    const weatherW =
      showW && !showM
        ? Math.min(540, contentW)
        : stacked
          ? contentW
          : Math.max(weatherMinW, Math.round(contentW * 0.44 - gap / 2));
    const monitorW =
      !showW && showM
        ? Math.min(620, contentW)
        : stacked
          ? contentW
          : Math.max(monitorMinW, contentW - weatherW - gap);
    const searchW = Math.min(580, contentW);
    const clockW = Math.min(340, contentW);
    const hitokotoW = Math.min(620, contentW);

    const targetWidths: Record<string, number> = {
      clock: clockW,
      search: searchW,
      weather: weatherW,
      monitor: monitorW,
      hitokoto: hitokotoW,
      bookmarks: contentW,
    };

    for (const w of visibleWidgets) {
      const tw = targetWidths[w.key] ?? Math.min(w.widget.defaultW || 420, contentW);
      targetWidths[w.key] = Math.max(w.widget.minW || 220, Math.min(tw, W - EDGE_PAD * 2));
      const el = document.getElementById(`item-${w.key}`);
      if (el) {
        el.style.width = `${targetWidths[w.key]}px`;
        el.style.height = '';
        delete el.dataset.customHeight;
      }
    }

    const measureH = (id: string, fallbackH: number) => {
      if (!isVis(id)) return 0;
      const el = document.getElementById(`item-${id}`);
      const h = el ? el.offsetHeight : 0;
      return h > 0 ? h : fallbackH;
    };

    const clockH = measureH('clock', 96);
    const searchH = measureH('search', 52);
    const weatherH = measureH('weather', 108);
    const monitorH = measureH('monitor', 108);
    const hitokotoH = measureH('hitokoto', 48);
    const bookmarksH = measureH('bookmarks', 160);

    const extraWidgets = visibleWidgets.filter(
      (rw) => !['clock', 'search', 'weather', 'monitor', 'hitokoto', 'bookmarks'].includes(rw.key),
    );
    const extraHeights = extraWidgets.map((rw) => measureH(rw.key, 150));
    const extraBlockH = extraHeights.reduce((acc, h, idx) => acc + h + (idx > 0 ? gap : 0), 0);

    const widgetsBlockH =
      !showW && !showM
        ? 0
        : stacked
          ? (showW ? weatherH : 0) + (showW && showM ? gap : 0) + (showM ? monitorH : 0)
          : Math.max(showW ? weatherH : 0, showM ? monitorH : 0);

    const baseH =
      (showClock ? clockH : 0) +
      (showSearch ? (showClock ? 18 : 0) + searchH : 0) +
      (widgetsBlockH > 0 ? (showClock || showSearch ? 24 : 0) + widgetsBlockH : 0) +
      (showHitokoto ? (showClock || showSearch || widgetsBlockH > 0 ? 14 : 0) + hitokotoH : 0) +
      (showBookmarks
        ? (showClock || showSearch || widgetsBlockH > 0 || showHitokoto ? 16 : 0) + bookmarksH
        : 0) +
      (extraBlockH > 0 ? gap + extraBlockH : 0);

    const extra = Math.max(0, availH - baseH - FOOTER_CLEARANCE - 16);
    const clockTop = !showBookmarks
      ? Math.max(24, Math.min(Math.round(availH * 0.2), Math.round(24 + extra * 0.36)))
      : Math.max(16, Math.min(64, Math.round(16 + extra * 0.22)));

    let cursorY = clockTop;
    const makeBox = (left: number, top: number, w: number, z: number): LayoutBox => ({
      left,
      cxRatio: (left + w / 2) / W,
      canvasW: W,
      top,
      w,
      z,
    });

    const map: FreeLayoutMap = {};

    if (showClock) {
      map.clock = makeBox(Math.round((W - targetWidths.clock) / 2), cursorY, targetWidths.clock, 11);
      cursorY += clockH + 18;
    }

    if (showSearch) {
      map.search = makeBox(Math.round((W - targetWidths.search) / 2), cursorY, targetWidths.search, 15);
      cursorY += searchH + Math.max(20, Math.min(40, Math.round(20 + extra * 0.12)));
    }

    if (showW || showM) {
      const rowTop = cursorY;
      if (showW) {
        const wl = showW && !showM ? Math.round((W - targetWidths.weather) / 2) : leftEdge;
        map.weather = makeBox(wl, rowTop, targetWidths.weather, 12);
      }
      if (showM) {
        const ml =
          !showW && showM
            ? Math.round((W - targetWidths.monitor) / 2)
            : stacked
              ? leftEdge
              : leftEdge + targetWidths.weather + gap;
        const mt = stacked && showW ? rowTop + weatherH + gap : rowTop;
        map.monitor = makeBox(ml, mt, targetWidths.monitor, 12);
      }
      cursorY = rowTop + widgetsBlockH + gap;
    }

    if (showHitokoto) {
      map.hitokoto = makeBox(Math.round((W - targetWidths.hitokoto) / 2), cursorY, targetWidths.hitokoto, 12);
      cursorY += hitokotoH + gap;
    }

    if (showBookmarks) {
      map.bookmarks = makeBox(leftEdge, cursorY, targetWidths.bookmarks, 13);
      cursorY += bookmarksH + gap;
    }

    for (let i = 0; i < extraWidgets.length; i += 1) {
      const rw = extraWidgets[i];
      const w = targetWidths[rw.key];
      const left = Math.round((W - w) / 2);
      map[rw.key] = makeBox(left, cursorY, w, 12);
      cursorY += extraHeights[i] + gap;
    }

    return map;
  }, [canvasRef, visibleWidgets, widgetMap]);

  const applyFreeLayout = useCallback(() => {
    if (isInteractingRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (window.innerWidth < 768) {
      canvas.style.minHeight = '';
      for (const rw of visibleWidgets) {
        const el = document.getElementById(`item-${rw.key}`);
        if (el) {
          el.style.height = '';
          delete el.dataset.customHeight;
        }
      }
      return;
    }

    const W = Math.max(canvas.clientWidth || window.innerWidth, 320);

    let layoutMap = localLayoutRef.current;
    if (!settings.hasCustomLayout || !layoutMap) {
      layoutMap = computeDefaultLayout();
      localLayoutRef.current = layoutMap;
    } else {
      layoutMap = { ...layoutMap };
      localLayoutRef.current = layoutMap;
    }

    let maxExistingBottom = 20;
    for (const rw of visibleWidgets) {
      const existing = layoutMap[rw.key];
      const el = document.getElementById(`item-${rw.key}`);
      if (existing && el) {
        maxExistingBottom = Math.max(maxExistingBottom, existing.top + (el.offsetHeight || 120) + ITEM_GAP);
      }
    }

    const placed: PlacedRect[] = [];

    for (const rw of visibleWidgets) {
      const id = rw.key;
      const el = document.getElementById(`item-${id}`);
      if (!el) continue;

      let box = layoutMap[id];
      if (!box) {
        const w = Math.max(
          rw.widget.minW || 240,
          Math.min(rw.widget.defaultW || 420, Math.max(320, W - 64)),
        );
        const left = Math.round((W - w) / 2);
        box = {
          left,
          cxRatio: (left + w / 2) / W,
          canvasW: W,
          top: maxExistingBottom,
          w,
          z: 14,
        };
        layoutMap[id] = box;
        maxExistingBottom += Math.max(120, el.offsetHeight || 120) + ITEM_GAP;
      }

      const minW = Math.min(rw.widget.minW || 220, W - EDGE_PAD * 2);
      const scaleFactor =
        settings.hasCustomLayout && box.canvasW && W < box.canvasW
          ? Math.max(0.68, W / box.canvasW)
          : 1;
      const targetW = Math.round(box.w * scaleFactor);
      const clampedW = Math.max(minW, Math.min(targetW, W - EDGE_PAD * 2));
      const ratioLeft =
        typeof box.cxRatio === 'number' ? Math.round(box.cxRatio * W - clampedW / 2) : box.left;
      const clampedLeft = Math.max(EDGE_PAD, Math.min(ratioLeft, W - clampedW - EDGE_PAD));
      const clampedTop = Math.max(8, Math.round(box.top));

      // Apply custom height if set, otherwise restore natural auto height
      el.style.width = `${clampedW}px`;
      const minH = getMinH(id);
      if (typeof box.h === 'number' && Number.isFinite(box.h) && box.h > 0) {
        const clampedH = Math.max(minH, Math.min(1200, Math.round(box.h)));
        el.style.height = `${clampedH}px`;
        el.dataset.customHeight = 'true';
      } else {
        el.style.height = '';
        delete el.dataset.customHeight;
      }
      const measuredH = el.offsetHeight || 60;

      placed.push({
        id,
        el,
        left: clampedLeft,
        top: clampedTop,
        w: clampedW,
        h: measuredH,
        minW,
        z: box.z || 10,
      });
    }

    // Prevent any card overlaps across screen aspect ratios & async height changes
    resolveOverlaps(placed, W);

    let contentBottom = 0;
    for (const p of placed) {
      p.el.style.left = `${Math.round(p.left)}px`;
      p.el.style.top = `${Math.round(p.top)}px`;
      p.el.style.width = `${Math.round(p.w)}px`;
      if (!p.el.dataset.elevated) {
        p.el.style.zIndex = String(p.z);
      }
      contentBottom = Math.max(contentBottom, p.top + p.h);
    }

    // Minimal clearance above footer — just enough to guarantee zero overlap
    const nextMinH = contentBottom > 0 ? Math.ceil(contentBottom + FOOTER_CLEARANCE) : 200;
    const nextMinHStr = `${nextMinH}px`;
    if (canvas.style.minHeight !== nextMinHStr) {
      canvas.style.minHeight = nextMinHStr;
    }
  }, [canvasRef, computeDefaultLayout, getMinH, settings.hasCustomLayout, visibleWidgets]);

  useEffect(() => {
    const raf = requestAnimationFrame(applyFreeLayout);
    const timer = window.setTimeout(applyFreeLayout, 140);
    let cancelled = false;
    if (document.fonts?.ready) {
      void document.fonts.ready.then(() => {
        if (!cancelled) requestAnimationFrame(applyFreeLayout);
      });
    }
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [applyFreeLayout, depsKey]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let raf = 0;
    const schedule = () => {
      if (isInteractingRef.current) return;
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(applyFreeLayout);
    };

    window.addEventListener('resize', schedule);
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(schedule);
      ro.observe(canvas);
      // Also observe every visible widget item so async content height changes never cause overlaps
      for (const key of visibleKeys) {
        const el = document.getElementById(`item-${key}`);
        if (el) ro.observe(el);
      }
      const footerEl = document.querySelector<HTMLElement>('footer[data-orbit-footer="1"]');
      if (footerEl) ro.observe(footerEl);
    }
    return () => {
      window.removeEventListener('resize', schedule);
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [applyFreeLayout, canvasRef, visibleKeys]);

  const setGuideVSafe = (v: number | null) => {
    const norm = v === null ? null : Math.round(v);
    if (lastGuideVRef.current !== norm) {
      lastGuideVRef.current = norm;
      setGuideV(norm);
    }
  };

  const setGuideHSafe = (h: number | null) => {
    const norm = h === null ? null : Math.round(h);
    if (lastGuideHRef.current !== norm) {
      lastGuideHRef.current = norm;
      setGuideH(norm);
    }
  };

  const startDragItem = (id: LayoutItemId, e: React.PointerEvent<HTMLDivElement>) => {
    if (!layoutEditing) return;
    const target = e.target as HTMLElement;
    if (target.closest('.resize-handle') || target.closest('.edit-chrome')) return;
    const el = document.getElementById(`item-${id}`);
    const canvas = canvasRef.current;
    if (!el || !canvas) return;

    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    isInteractingRef.current = true;
    setDraggingId(id);

    const W0 = canvas.clientWidth || window.innerWidth;
    // Snapshot current DOM positions of ALL visible items so custom layout starts from exact rendered positions
    const layoutMap: FreeLayoutMap = { ...(localLayoutRef.current || computeDefaultLayout()) };
    for (const k of visibleKeys) {
      const ke = document.getElementById(`item-${k}`);
      if (!ke) continue;
      const kl = parseFloat(ke.style.left) || 0;
      const kt = parseFloat(ke.style.top) || 0;
      const kw = ke.offsetWidth || layoutMap[k]?.w || 320;
      layoutMap[k] = {
        ...(layoutMap[k] || { left: kl, top: kt, w: kw, z: 12 }),
        left: kl,
        top: kt,
        w: kw,
        cxRatio: (kl + kw / 2) / W0,
        canvasW: W0,
      };
    }

    zCounterRef.current += 1;
    layoutMap[id] = { ...layoutMap[id], z: zCounterRef.current };
    el.style.zIndex = String(zCounterRef.current);

    const startX = e.clientX;
    const startY = e.clientY;
    const origLeft = parseFloat(el.style.left) || 0;
    const origTop = parseFloat(el.style.top) || 0;
    const itemW = el.offsetWidth;
    const itemH = el.offsetHeight;

    const peers = visibleKeys
      .filter((k) => k !== id)
      .map((k) => {
        const pe = document.getElementById(`item-${k}`);
        const pl = parseFloat(pe?.style.left || '0') || 0;
        const pt = parseFloat(pe?.style.top || '0') || 0;
        const pw = pe?.offsetWidth || 0;
        const ph = pe?.offsetHeight || 0;
        return {
          left: pl,
          right: pl + pw,
          cx: pl + pw / 2,
          top: pt,
          bottom: pt + ph,
          cy: pt + ph / 2,
        };
      });

    // Track active magnetic lock for hysteresis (prevents edge-threshold chatter)
    let lockedV: { targetLeft: number; guideX: number } | null = null;
    let lockedH: { targetTop: number; guideY: number } | null = null;

    const onMove = (ev: PointerEvent) => {
      const W = canvas.clientWidth || window.innerWidth;
      const rawL = Math.max(EDGE_PAD, Math.min(W - itemW - EDGE_PAD, origLeft + (ev.clientX - startX)));
      const rawT = Math.max(8, origTop + (ev.clientY - startY));

      let nl = rawL;
      let nt = rawT;
      let sv: number | null = null;
      let sh: number | null = null;

      if (snap) {
        // ---- Vertical axis snap (X position) with best-candidate + hysteresis ----
        const vCands: { targetLeft: number; guideX: number; dist: number }[] = [];
        const centerTarget = Math.round(W / 2 - itemW / 2);
        vCands.push({
          targetLeft: centerTarget,
          guideX: Math.round(W / 2),
          dist: Math.abs(rawL - centerTarget),
        });
        for (const p of peers) {
          vCands.push(
            { targetLeft: p.left, guideX: p.left, dist: Math.abs(rawL - p.left) },
            { targetLeft: p.right - itemW, guideX: p.right, dist: Math.abs(rawL + itemW - p.right) },
            { targetLeft: p.cx - itemW / 2, guideX: p.cx, dist: Math.abs(rawL + itemW / 2 - p.cx) },
            { targetLeft: p.right + ITEM_GAP, guideX: p.right + ITEM_GAP, dist: Math.abs(rawL - (p.right + ITEM_GAP)) },
            { targetLeft: p.left - ITEM_GAP - itemW, guideX: p.left - ITEM_GAP, dist: Math.abs(rawL + itemW - (p.left - ITEM_GAP)) },
          );
        }

        if (lockedV && Math.abs(rawL - lockedV.targetLeft) <= SNAP_RELEASE) {
          nl = Math.max(EDGE_PAD, Math.min(W - itemW - EDGE_PAD, Math.round(lockedV.targetLeft)));
          sv = lockedV.guideX;
        } else {
          lockedV = null;
          let bestV: { targetLeft: number; guideX: number; dist: number } | null = null;
          for (const c of vCands) {
            if (c.targetLeft < EDGE_PAD || c.targetLeft > W - itemW - EDGE_PAD) continue;
            if (c.dist <= SNAP_ENTER && (!bestV || c.dist < bestV.dist)) {
              bestV = c;
            }
          }
          if (bestV) {
            lockedV = { targetLeft: bestV.targetLeft, guideX: bestV.guideX };
            nl = Math.round(bestV.targetLeft);
            sv = bestV.guideX;
          } else {
            nl = Math.round(rawL);
          }
        }

        // ---- Horizontal axis snap (Y position) with best-candidate + hysteresis ----
        const hCands: { targetTop: number; guideY: number; dist: number }[] = [];
        for (const p of peers) {
          hCands.push(
            { targetTop: p.top, guideY: p.top, dist: Math.abs(rawT - p.top) },
            { targetTop: p.bottom - itemH, guideY: p.bottom, dist: Math.abs(rawT + itemH - p.bottom) },
            { targetTop: p.bottom + ITEM_GAP, guideY: p.bottom + ITEM_GAP, dist: Math.abs(rawT - (p.bottom + ITEM_GAP)) },
            { targetTop: p.top - ITEM_GAP - itemH, guideY: p.top - ITEM_GAP, dist: Math.abs(rawT + itemH - (p.top - ITEM_GAP)) },
            { targetTop: p.cy - itemH / 2, guideY: p.cy, dist: Math.abs(rawT + itemH / 2 - p.cy) },
          );
        }

        if (lockedH && Math.abs(rawT - lockedH.targetTop) <= SNAP_RELEASE) {
          nt = Math.max(8, Math.round(lockedH.targetTop));
          sh = lockedH.guideY;
        } else {
          lockedH = null;
          let bestH: { targetTop: number; guideY: number; dist: number } | null = null;
          for (const c of hCands) {
            if (c.targetTop < 8) continue;
            if (c.dist <= SNAP_ENTER && (!bestH || c.dist < bestH.dist)) {
              bestH = c;
            }
          }
          if (bestH) {
            lockedH = { targetTop: bestH.targetTop, guideY: bestH.guideY };
            nt = Math.round(bestH.targetTop);
            sh = bestH.guideY;
          } else {
            nt = Math.round(rawT);
          }
        }
      } else {
        nl = Math.round(rawL);
        nt = Math.round(rawT);
      }

      setGuideVSafe(sv);
      setGuideHSafe(sh);
      el.style.left = `${nl}px`;
      el.style.top = `${nt}px`;
      layoutMap[id] = {
        ...layoutMap[id],
        left: nl,
        cxRatio: (nl + itemW / 2) / W,
        canvasW: W,
        top: nt,
      };
    };

    const onUp = () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      setGuideVSafe(null);
      setGuideHSafe(null);
      setDraggingId(null);
      localLayoutRef.current = layoutMap;
      isInteractingRef.current = false;
      onPersistLayout({
        hasCustomLayout: true,
        layout: layoutMap,
        visibleItems: settings.visibleItems,
      });
      requestAnimationFrame(applyFreeLayout);
    };

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  };

  const startResizeItem = (
    id: LayoutItemId,
    e: React.PointerEvent<HTMLDivElement>,
    axis: ResizeAxis = 'e',
  ) => {
    if (!layoutEditing) return;
    const el = document.getElementById(`item-${id}`);
    const canvas = canvasRef.current;
    if (!el || !canvas) return;
    const handle = e.currentTarget;

    e.preventDefault();
    e.stopPropagation();
    handle.setPointerCapture(e.pointerId);
    isInteractingRef.current = true;

    const W0 = canvas.clientWidth || window.innerWidth;
    const layoutMap: FreeLayoutMap = { ...(localLayoutRef.current || computeDefaultLayout()) };
    for (const k of visibleKeys) {
      const ke = document.getElementById(`item-${k}`);
      if (!ke) continue;
      const kl = parseFloat(ke.style.left) || 0;
      const kt = parseFloat(ke.style.top) || 0;
      const kw = ke.offsetWidth || layoutMap[k]?.w || 320;
      layoutMap[k] = {
        ...(layoutMap[k] || { left: kl, top: kt, w: kw, z: 12 }),
        left: kl,
        top: kt,
        w: kw,
        cxRatio: (kl + kw / 2) / W0,
        canvasW: W0,
      };
    }

    const startX = e.clientX;
    const startY = e.clientY;
    const origW = el.offsetWidth;
    const origH = el.offsetHeight;
    const origLeft = parseFloat(el.style.left) || 0;
    const origTop = parseFloat(el.style.top) || 0;
    const maxW = W0 - origLeft - EDGE_PAD;
    const minW = getMinW(id);
    const minH = getMinH(id);
    const maxH = 1200;

    setResizingDim({
      id,
      w: origW,
      h: axis === 'e' ? layoutMap[id]?.h : origH,
    });

    const onResize = (ev: PointerEvent) => {
      const W = canvas.clientWidth || window.innerWidth;
      let nw = origW;
      let nh = layoutMap[id]?.h;

      if (axis === 'e' || axis === 'se') {
        nw = Math.max(minW, Math.min(maxW, origW + (ev.clientX - startX)));
        nw = snap ? Math.round(nw / 8) * 8 : Math.round(nw);
        el.style.width = `${nw}px`;
      }

      if (axis === 's' || axis === 'se') {
        let nextH = Math.max(minH, Math.min(maxH, origH + (ev.clientY - startY)));
        nextH = snap ? Math.round(nextH / 8) * 8 : Math.round(nextH);
        nh = nextH;
        el.style.height = `${nextH}px`;
        el.dataset.customHeight = 'true';
        const neededBottom = Math.ceil(origTop + nextH + FOOTER_CLEARANCE);
        const curMinH = parseFloat(canvas.style.minHeight) || 0;
        if (neededBottom > curMinH) {
          canvas.style.minHeight = `${neededBottom}px`;
        }
      }

      layoutMap[id] = {
        ...layoutMap[id],
        w: nw,
        ...(nh !== undefined ? { h: nh } : {}),
        cxRatio: (origLeft + nw / 2) / W,
        canvasW: W,
      };
      setResizingDim({ id, w: nw, h: nh });
    };

    const onEnd = () => {
      handle.removeEventListener('pointermove', onResize);
      handle.removeEventListener('pointerup', onEnd);
      handle.removeEventListener('pointercancel', onEnd);
      setResizingDim(null);
      localLayoutRef.current = layoutMap;
      isInteractingRef.current = false;
      onPersistLayout({
        hasCustomLayout: true,
        layout: layoutMap,
        visibleItems: settings.visibleItems,
      });
      requestAnimationFrame(applyFreeLayout);
    };

    handle.addEventListener('pointermove', onResize);
    handle.addEventListener('pointerup', onEnd);
    handle.addEventListener('pointercancel', onEnd);
  };

  const resetItemHeight = useCallback(
    (id: LayoutItemId) => {
      const el = document.getElementById(`item-${id}`);
      if (el) {
        el.style.height = '';
        delete el.dataset.customHeight;
      }
      const layoutMap: FreeLayoutMap = { ...(localLayoutRef.current || computeDefaultLayout()) };
      if (layoutMap[id]) {
        const { h: _removed, ...rest } = layoutMap[id];
        void _removed;
        layoutMap[id] = rest;
      }
      localLayoutRef.current = layoutMap;
      onPersistLayout({
        hasCustomLayout: true,
        layout: layoutMap,
        visibleItems: settings.visibleItems,
      });
      requestAnimationFrame(applyFreeLayout);
    },
    [applyFreeLayout, computeDefaultLayout, onPersistLayout, settings.visibleItems],
  );

  return {
    snap,
    setSnap,
    guideV,
    guideH,
    draggingId,
    resizingDim,
    startDragItem,
    startResizeItem,
    resetItemHeight,
    applyFreeLayout,
  };
}
