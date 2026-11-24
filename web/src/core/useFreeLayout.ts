import { useCallback, useEffect, useRef, useState } from 'react';
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
  const zCounterRef = useRef(20);
  const localLayoutRef = useRef<FreeLayoutMap | null>(settings.layout);

  useEffect(() => {
    localLayoutRef.current = settings.layout;
    if (settings.layout) {
      const zVals = Object.values(settings.layout).map((b) => b?.z || 10);
      if (zVals.length > 0) {
        zCounterRef.current = Math.max(zCounterRef.current, ...zVals);
      }
    }
  }, [settings.layout]);

  const widgetMap = new Map(widgets.map((w) => [w.key, w]));
  const visibleWidgets = widgets.filter((w) => w.visible);
  const visibleKeys = visibleWidgets.map((w) => w.key);

  const getMinW = useCallback(
    (key: string) => widgetMap.get(key)?.widget.minW || 240,
    [widgetMap],
  );

  const computeDefaultLayout = useCallback((): FreeLayoutMap => {
    const canvas = canvasRef.current;
    const W = Math.max(canvas?.clientWidth || window.innerWidth, 768);
    const H = Math.max(window.innerHeight - 118, 540);
    const contentW = Math.min(980, Math.max(320, W - 64));
    const leftEdge = Math.round((W - contentW) / 2);
    const gap = 14;
    const stacked = contentW < 680;
    const isVis = (id: string) => visibleWidgets.some((w) => w.key === id);
    const showClock = isVis('clock');
    const showSearch = isVis('search');
    const showW = isVis('weather');
    const showM = isVis('monitor');
    const showHitokoto = isVis('hitokoto');
    const showBookmarks = isVis('bookmarks');

    const weatherW = showW && !showM
      ? Math.min(540, contentW)
      : stacked
        ? contentW
        : Math.round(contentW * 0.44 - gap / 2);
    const monitorW = !showW && showM
      ? Math.min(620, contentW)
      : stacked
        ? contentW
        : contentW - Math.round(contentW * 0.44 - gap / 2) - gap;
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
      targetWidths[w.key] = tw;
      const el = document.getElementById(`item-${w.key}`);
      if (el) {
        el.style.width = `${tw}px`;
      }
    }

    const measureH = (id: string, minH: number) => {
      if (!isVis(id)) return 0;
      const el = document.getElementById(`item-${id}`);
      return Math.max(minH, el ? el.offsetHeight : minH);
    };

    const clockH = measureH('clock', 104);
    const searchH = measureH('search', 52);
    const weatherH = measureH('weather', 108);
    const monitorH = measureH('monitor', 108);
    const hitokotoH = measureH('hitokoto', 60);
    const bookmarksH = measureH('bookmarks', 180);

    const extraWidgets = visibleWidgets.filter(
      (rw) => !['clock', 'search', 'weather', 'monitor', 'hitokoto', 'bookmarks'].includes(rw.key),
    );
    const extraHeights = extraWidgets.map((rw) => measureH(rw.key, 160));
    const extraBlockH = extraHeights.reduce((acc, h, idx) => acc + h + (idx > 0 ? 16 : 0), 0);

    const widgetsBlockH =
      !showW && !showM
        ? 0
        : stacked
          ? (showW ? weatherH : 0) + (showW && showM ? gap : 0) + (showM ? monitorH : 0)
          : Math.max(showW ? weatherH : 0, showM ? monitorH : 0);

    const baseH =
      (showClock ? clockH : 0) +
      (showSearch ? (showClock ? 20 : 0) + searchH : 0) +
      (widgetsBlockH > 0 ? (showClock || showSearch ? 32 : 0) + widgetsBlockH : 0) +
      (showHitokoto ? (showClock || showSearch || widgetsBlockH > 0 ? 14 : 0) + hitokotoH : 0) +
      (showBookmarks ? (showClock || showSearch || widgetsBlockH > 0 || showHitokoto ? 16 : 0) + bookmarksH : 0) +
      (extraBlockH > 0 ? 18 + extraBlockH : 0);

    const extra = Math.max(0, H - baseH - 48);
    const clockTop = !showBookmarks
      ? Math.max(36, Math.min(Math.round(H * 0.24), Math.round(28 + extra * 0.42)))
      : Math.max(20, Math.min(88, Math.round(20 + extra * 0.26)));
    const searchTop = showClock ? clockTop + clockH + 20 : clockTop;
    const widgetsGap = !showBookmarks
      ? Math.max(24, Math.min(44, Math.round(24 + extra * 0.12)))
      : Math.max(26, Math.min(84, Math.round(26 + extra * 0.34)));
    const aboveWidgetsBottom = showSearch ? searchTop + searchH : showClock ? clockTop + clockH : clockTop;
    const widgetsTop = showSearch || showClock ? aboveWidgetsBottom + widgetsGap : clockTop;
    const weatherLeft = showW && !showM ? Math.round((W - weatherW) / 2) : leftEdge;
    const monitorLeft = !showW && showM ? Math.round((W - monitorW) / 2) : stacked ? leftEdge : leftEdge + weatherW + gap;
    const monitorTop = stacked && showW ? widgetsTop + weatherH + gap : widgetsTop;
    const afterWidgetsBottom =
      widgetsBlockH > 0
        ? widgetsTop + widgetsBlockH
        : showSearch
          ? searchTop + searchH
          : showClock
            ? clockTop + clockH
            : clockTop;
    const hitokotoTop =
      widgetsBlockH > 0
        ? afterWidgetsBottom + 14
        : showSearch || showClock
          ? afterWidgetsBottom + 24
          : clockTop;
    const bookmarksTop = showHitokoto
      ? hitokotoTop + hitokotoH + 16
      : widgetsBlockH > 0
        ? widgetsTop + widgetsBlockH + 18
        : showSearch
          ? searchTop + searchH + 36
          : showClock
            ? clockTop + clockH + 36
            : clockTop;

    const makeBox = (left: number, top: number, w: number, z: number): LayoutBox => ({
      left,
      cxRatio: (left + w / 2) / W,
      top,
      w,
      z,
    });

    const map: FreeLayoutMap = {
      clock: makeBox(Math.round((W - clockW) / 2), clockTop, clockW, 11),
      search: makeBox(Math.round((W - searchW) / 2), searchTop, searchW, 15),
      weather: makeBox(weatherLeft, widgetsTop, weatherW, 12),
      monitor: makeBox(monitorLeft, monitorTop, monitorW, 12),
      hitokoto: makeBox(Math.round((W - hitokotoW) / 2), hitokotoTop, hitokotoW, 12),
      bookmarks: makeBox(leftEdge, bookmarksTop, contentW, 13),
    };

    let extraTop = showBookmarks
      ? bookmarksTop + bookmarksH + 18
      : showHitokoto
        ? hitokotoTop + hitokotoH + 18
        : bookmarksTop;
    for (let i = 0; i < extraWidgets.length; i += 1) {
      const rw = extraWidgets[i];
      const w = Math.max(rw.widget.minW || 240, Math.min(rw.widget.defaultW || 420, contentW));
      const left = Math.round((W - w) / 2);
      const h = extraHeights[i];
      map[rw.key] = makeBox(left, extraTop, w, 12);
      extraTop += h + 16;
    }

    return map;
  }, [canvasRef, visibleWidgets]);

  const applyFreeLayout = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (window.innerWidth < 768) {
      canvas.style.minHeight = '';
      return;
    }

    let layoutMap = localLayoutRef.current;
    if (!settings.hasCustomLayout || !layoutMap) {
      layoutMap = computeDefaultLayout();
      localLayoutRef.current = layoutMap;
    } else {
      layoutMap = { ...layoutMap };
      localLayoutRef.current = layoutMap;
    }

    const W = canvas.clientWidth || window.innerWidth;
    let maxBottom = Math.max(window.innerHeight - 118, 540);
    let maxExistingBottom = 24;

    for (const rw of visibleWidgets) {
      const existing = layoutMap[rw.key];
      const el = document.getElementById(`item-${rw.key}`);
      if (existing && el) {
        maxExistingBottom = Math.max(maxExistingBottom, existing.top + (el.offsetHeight || 180) + 16);
      }
    }

    for (const rw of visibleWidgets) {
      const id = rw.key;
      const el = document.getElementById(`item-${id}`);
      if (!el) continue;

      let box = layoutMap[id];
      if (!box) {
        const w = Math.max(rw.widget.minW || 240, Math.min(rw.widget.defaultW || 420, Math.max(320, W - 64)));
        const left = Math.round((W - w) / 2);
        box = {
          left,
          cxRatio: (left + w / 2) / W,
          top: maxExistingBottom,
          w,
          z: 14,
        };
        layoutMap[id] = box;
        maxExistingBottom += Math.max(180, el.offsetHeight || 180) + 16;
      }

      const minW = rw.widget.minW || 240;
      const clampedW = Math.min(box.w, Math.max(minW, W - 24));
      const ratioLeft =
        typeof box.cxRatio === 'number' ? Math.round(box.cxRatio * W - clampedW / 2) : box.left;
      const clampedLeft = Math.max(12, Math.min(ratioLeft, W - clampedW - 12));
      const clampedTop = Math.max(8, box.top);

      el.style.left = `${clampedLeft}px`;
      el.style.top = `${clampedTop}px`;
      el.style.width = `${clampedW}px`;
      if (!el.dataset.elevated) {
        el.style.zIndex = String(box.z || 10);
      }
      box.left = clampedLeft;
      maxBottom = Math.max(maxBottom, clampedTop + el.offsetHeight + 48);
    }

    canvas.style.minHeight = `${maxBottom}px`;
  }, [canvasRef, computeDefaultLayout, settings.hasCustomLayout, visibleWidgets]);

  useEffect(() => {
    const raf = requestAnimationFrame(applyFreeLayout);
    const timer = window.setTimeout(applyFreeLayout, 120);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [applyFreeLayout, depsKey]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let raf = 0;
    const schedule = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(applyFreeLayout);
    };
    window.addEventListener('resize', schedule);
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(schedule);
      ro.observe(canvas);
    }
    return () => {
      window.removeEventListener('resize', schedule);
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [applyFreeLayout, canvasRef]);

  const startDragItem = (id: LayoutItemId, e: React.PointerEvent<HTMLDivElement>) => {
    if (!layoutEditing) return;
    const target = e.target as HTMLElement;
    if (target.closest('.resize-handle') || target.closest('.edit-chrome')) return;
    const el = document.getElementById(`item-${id}`);
    const canvas = canvasRef.current;
    if (!el || !canvas) return;

    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    setDraggingId(id);

    if (!localLayoutRef.current) {
      localLayoutRef.current = computeDefaultLayout();
    }
    const layoutMap = { ...localLayoutRef.current } as FreeLayoutMap;
    zCounterRef.current += 1;
    layoutMap[id] = { ...layoutMap[id], z: zCounterRef.current };
    el.style.zIndex = String(zCounterRef.current);

    const startX = e.clientX;
    const startY = e.clientY;
    const origLeft = parseFloat(el.style.left) || 0;
    const origTop = parseFloat(el.style.top) || 0;
    const itemW = el.offsetWidth;

    const peers = visibleKeys
      .filter((k) => k !== id)
      .map((k) => {
        const pe = document.getElementById(`item-${k}`);
        const pl = parseFloat(pe?.style.left || '0') || 0;
        const pt = parseFloat(pe?.style.top || '0') || 0;
        const pw = pe?.offsetWidth || 0;
        const ph = pe?.offsetHeight || 0;
        return { left: pl, right: pl + pw, cx: pl + pw / 2, top: pt, bottom: pt + ph };
      });

    const canvasRect = canvas.getBoundingClientRect();

    const onMove = (ev: PointerEvent) => {
      const W = canvas.clientWidth || window.innerWidth;
      let nl = Math.max(12, Math.min(W - itemW - 12, origLeft + (ev.clientX - startX)));
      let nt = Math.max(8, origTop + (ev.clientY - startY));
      let sv: number | null = null;
      let sh: number | null = null;

      if (snap) {
        const myCx = nl + itemW / 2;
        if (Math.abs(myCx - W / 2) < 14) {
          nl = Math.round(W / 2 - itemW / 2);
          sv = canvasRect.left + W / 2;
        }
        for (const p of peers) {
          if (sv === null) {
            if (Math.abs(nl - p.left) < 10) {
              nl = p.left;
              sv = canvasRect.left + p.left;
            } else if (Math.abs(nl + itemW - p.right) < 10) {
              nl = p.right - itemW;
              sv = canvasRect.left + p.right;
            } else if (Math.abs(nl + itemW / 2 - p.cx) < 10) {
              nl = p.cx - itemW / 2;
              sv = canvasRect.left + p.cx;
            }
          }
          if (sh === null) {
            if (Math.abs(nt - p.top) < 10) {
              nt = p.top;
              sh = canvasRect.top + p.top;
            } else if (Math.abs(nt - (p.bottom + 14)) < 10) {
              nt = p.bottom + 14;
              sh = canvasRect.top + nt;
            }
          }
        }
        if (sv === null) nl = Math.round(nl / 8) * 8;
        if (sh === null) nt = Math.round(nt / 8) * 8;
      }

      setGuideV(sv);
      setGuideH(sh);
      el.style.left = `${nl}px`;
      el.style.top = `${nt}px`;
      layoutMap[id] = {
        ...layoutMap[id],
        left: nl,
        cxRatio: (nl + itemW / 2) / W,
        top: nt,
      };
    };

    const onUp = () => {
      setDraggingId(null);
      setGuideV(null);
      setGuideH(null);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      localLayoutRef.current = layoutMap;
      onPersistLayout({
        hasCustomLayout: true,
        layout: layoutMap,
        visibleItems: settings.visibleItems,
      });
    };

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  };

  const startResizeItem = (id: LayoutItemId, e: React.PointerEvent<HTMLDivElement>) => {
    if (!layoutEditing) return;
    const el = document.getElementById(`item-${id}`);
    const canvas = canvasRef.current;
    if (!el || !canvas) return;
    const handle = e.currentTarget;

    e.preventDefault();
    e.stopPropagation();
    handle.setPointerCapture(e.pointerId);

    if (!localLayoutRef.current) {
      localLayoutRef.current = computeDefaultLayout();
    }
    const layoutMap = { ...localLayoutRef.current } as FreeLayoutMap;
    const startX = e.clientX;
    const origW = el.offsetWidth;
    const origLeft = parseFloat(el.style.left) || 0;
    const maxW = (canvas.clientWidth || window.innerWidth) - origLeft - 12;
    const minW = getMinW(id);

    const onResize = (ev: PointerEvent) => {
      const W = canvas.clientWidth || window.innerWidth;
      let nw = Math.max(minW, Math.min(maxW, origW + (ev.clientX - startX)));
      if (snap) nw = Math.round(nw / 8) * 8;
      el.style.width = `${nw}px`;
      layoutMap[id] = {
        ...layoutMap[id],
        w: nw,
        cxRatio: (origLeft + nw / 2) / W,
      };
    };

    const onEnd = () => {
      handle.removeEventListener('pointermove', onResize);
      handle.removeEventListener('pointerup', onEnd);
      handle.removeEventListener('pointercancel', onEnd);
      localLayoutRef.current = layoutMap;
      onPersistLayout({
        hasCustomLayout: true,
        layout: layoutMap,
        visibleItems: settings.visibleItems,
      });
    };

    handle.addEventListener('pointermove', onResize);
    handle.addEventListener('pointerup', onEnd);
    handle.addEventListener('pointercancel', onEnd);
  };

  return {
    snap,
    setSnap,
    guideV,
    guideH,
    draggingId,
    startDragItem,
    startResizeItem,
    applyFreeLayout,
  };
}
