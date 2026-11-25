import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlipHorizontal2,
  ImagePlus,
  Loader2,
  RotateCcw,
  RotateCw,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { CenteredModal } from '../sdk/primitives';

interface AvatarEditorModalProps {
  open: boolean;
  initialFile: File | null;
  onClose: () => void;
  onSave: (file: File) => Promise<void>;
  onToast?: (msg: string, warn?: boolean) => void;
}

const STAGE_SIZE = 260;
const CROP_SIZE = 216;
const OUT_SIZE = 512;
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

function clampOffset(
  ox: number,
  oy: number,
  imgW: number,
  imgH: number,
  zoom: number,
  rotationDeg: number,
): { x: number; y: number } {
  if (!imgW || !imgH) return { x: 0, y: 0 };
  const baseScale = CROP_SIZE / Math.min(imgW, imgH);
  const scaledW = imgW * baseScale * zoom;
  const scaledH = imgH * baseScale * zoom;
  const maxLx = Math.max(0, (scaledW - CROP_SIZE) / 2);
  const maxLy = Math.max(0, (scaledH - CROP_SIZE) / 2);

  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  // Rotate offset into the image's local frame (inverse rotation)
  const lx = ox * cos + oy * sin;
  const ly = -ox * sin + oy * cos;

  const clx = Math.max(-maxLx, Math.min(maxLx, lx));
  const cly = Math.max(-maxLy, Math.min(maxLy, ly));

  // Rotate back to stage frame
  return {
    x: clx * cos - cly * sin,
    y: clx * sin + cly * cos,
  };
}

function drawTransformedImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  canvasSize: number,
  cropDia: number,
  offsetX: number,
  offsetY: number,
  zoom: number,
  rotationDeg: number,
  flipX: boolean,
) {
  const imgW = img.naturalWidth || img.width;
  const imgH = img.naturalHeight || img.height;
  if (!imgW || !imgH) return;

  const baseScale = CROP_SIZE / Math.min(imgW, imgH);
  const ratio = cropDia / CROP_SIZE;

  ctx.save();
  ctx.translate(canvasSize / 2 + offsetX * ratio, canvasSize / 2 + offsetY * ratio);
  ctx.rotate((rotationDeg * Math.PI) / 180);
  ctx.scale((flipX ? -1 : 1) * baseScale * zoom * ratio, baseScale * zoom * ratio);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, -imgW / 2, -imgH / 2, imgW, imgH);
  ctx.restore();
}

export function AvatarEditorModal({
  open,
  initialFile,
  onClose,
  onSave,
  onToast,
}: AvatarEditorModalProps) {
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [flipX, setFlipX] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);

  const stageCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewLgRef = useRef<HTMLCanvasElement>(null);
  const previewSmRef = useRef<HTMLCanvasElement>(null);
  const dragStartRef = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const loadFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith('image/')) {
        onToast?.('请选择图片文件（PNG / JPG / WebP / GIF）', true);
        return;
      }
      if (file.size > 20 * 1024 * 1024) {
        onToast?.('源图片过大，请选择 20 MB 以内的图片', true);
        return;
      }
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
      const url = URL.createObjectURL(file);
      objectUrlRef.current = url;
      setLoadError(null);

      const img = new Image();
      img.onload = () => {
        setImgEl(img);
        setZoom(1);
        setRotation(0);
        setFlipX(false);
        setOffset({ x: 0, y: 0 });
      };
      img.onerror = () => {
        setLoadError('无法解析该图片，请尝试其他图片文件');
        setImgEl(null);
      };
      img.src = url;
    },
    [onToast],
  );

  useEffect(() => {
    if (!open) {
      setImgEl(null);
      setLoadError(null);
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      return;
    }
    if (initialFile) {
      loadFile(initialFile);
    }
  }, [open, initialFile, loadFile]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!saving) onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open, onClose, saving]);

  useEffect(() => {
    if (!open || !imgEl) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    // 1. Main interactive stage
    const stage = stageCanvasRef.current;
    if (stage) {
      stage.width = STAGE_SIZE * dpr;
      stage.height = STAGE_SIZE * dpr;
      const ctx = stage.getContext('2d');
      if (ctx) {
        ctx.save();
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, STAGE_SIZE, STAGE_SIZE);

        // Checkerboard subtle backdrop for transparent PNGs
        const cell = 10;
        for (let y = 0; y < STAGE_SIZE; y += cell) {
          for (let x = 0; x < STAGE_SIZE; x += cell) {
            ctx.fillStyle = ((x / cell + y / cell) & 1) === 0 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.12)';
            ctx.fillRect(x, y, cell, cell);
          }
        }

        drawTransformedImage(ctx, imgEl, STAGE_SIZE, CROP_SIZE, offset.x, offset.y, zoom, rotation, flipX);

        // Circular cutout dim mask
        ctx.save();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.56)';
        ctx.beginPath();
        ctx.rect(0, 0, STAGE_SIZE, STAGE_SIZE);
        ctx.arc(STAGE_SIZE / 2, STAGE_SIZE / 2, CROP_SIZE / 2, 0, Math.PI * 2, true);
        ctx.fill('evenodd');
        ctx.restore();

        // Alignment grid while dragging
        if (dragging) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(STAGE_SIZE / 2, STAGE_SIZE / 2, CROP_SIZE / 2, 0, Math.PI * 2);
          ctx.clip();
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
          ctx.lineWidth = 1;
          const start = (STAGE_SIZE - CROP_SIZE) / 2;
          for (const f of [1 / 3, 2 / 3]) {
            const p = start + CROP_SIZE * f;
            ctx.beginPath();
            ctx.moveTo(p, start);
            ctx.lineTo(p, start + CROP_SIZE);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(start, p);
            ctx.lineTo(start + CROP_SIZE, p);
            ctx.stroke();
          }
          ctx.restore();
        }

        // Crisp circular border ring
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.lineWidth = 1.75;
        ctx.beginPath();
        ctx.arc(STAGE_SIZE / 2, STAGE_SIZE / 2, CROP_SIZE / 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        ctx.restore();
      }
    }

    // 2. Live circular previews (large & small)
    for (const [ref, size] of [
      [previewLgRef, 56],
      [previewSmRef, 32],
    ] as const) {
      const cv = ref.current;
      if (!cv) continue;
      cv.width = size * dpr;
      cv.height = size * dpr;
      const pctx = cv.getContext('2d');
      if (!pctx) continue;
      pctx.save();
      pctx.scale(dpr, dpr);
      pctx.clearRect(0, 0, size, size);
      pctx.beginPath();
      pctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      pctx.clip();
      drawTransformedImage(pctx, imgEl, size, size, offset.x, offset.y, zoom, rotation, flipX);
      pctx.restore();
    }
  }, [open, imgEl, offset, zoom, rotation, flipX, dragging]);

  const updateZoom = (nextZoom: number) => {
    const clampedZ = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number(nextZoom.toFixed(2))));
    setZoom(clampedZ);
    if (imgEl) {
      setOffset((prev) =>
        clampOffset(prev.x, prev.y, imgEl.naturalWidth, imgEl.naturalHeight, clampedZ, rotation),
      );
    }
  };

  const updateRotation = (nextDeg: number) => {
    let normalized = ((nextDeg + 180) % 360 + 360) % 360 - 180;
    if (nextDeg === 180) normalized = 180;
    setRotation(normalized);
    if (imgEl) {
      setOffset((prev) =>
        clampOffset(prev.x, prev.y, imgEl.naturalWidth, imgEl.naturalHeight, zoom, normalized),
      );
    }
  };

  const handleReset = () => {
    setZoom(1);
    setRotation(0);
    setFlipX(false);
    setOffset({ x: 0, y: 0 });
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!imgEl) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    dragStartRef.current = {
      px: e.clientX,
      py: e.clientY,
      ox: offset.x,
      oy: offset.y,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragStartRef.current || !imgEl) return;
    const dx = e.clientX - dragStartRef.current.px;
    const dy = e.clientY - dragStartRef.current.py;
    const next = clampOffset(
      dragStartRef.current.ox + dx,
      dragStartRef.current.oy + dy,
      imgEl.naturalWidth,
      imgEl.naturalHeight,
      zoom,
      rotation,
    );
    setOffset(next);
  };

  const handlePointerUp = () => {
    setDragging(false);
    dragStartRef.current = null;
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    if (!imgEl) return;
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.12 : -0.12;
    updateZoom(zoom + delta);
  };

  const handleExportAndSave = async () => {
    if (!imgEl) return;
    setSaving(true);
    try {
      const out = document.createElement('canvas');
      out.width = OUT_SIZE;
      out.height = OUT_SIZE;
      const ctx = out.getContext('2d');
      if (!ctx) {
        throw new Error('浏览器不支持 Canvas 渲染');
      }
      drawTransformedImage(ctx, imgEl, OUT_SIZE, OUT_SIZE, offset.x, offset.y, zoom, rotation, flipX);

      const toBlob = (type: string, quality?: number) =>
        new Promise<Blob | null>((resolve) => out.toBlob(resolve, type, quality));

      let blob = await toBlob('image/webp', 0.92);
      let fileName = 'avatar.webp';
      if (!blob || blob.type !== 'image/webp') {
        blob = await toBlob('image/png');
        fileName = 'avatar.png';
      }
      if (!blob) {
        throw new Error('头像生成失败');
      }

      const file = new File([blob], fileName, { type: blob.type });
      await onSave(file);
      onClose();
    } catch (e) {
      onToast?.((e as Error).message || '保存头像失败', true);
    } finally {
      setSaving(false);
    }
  };

  const zoomPct = ((zoom - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM)) * 100;
  const rotPct = ((rotation + 180) / 360) * 100;

  return (
    <CenteredModal
      open={open}
      onClose={() => {
        if (!saving) onClose();
      }}
      closeOnBackdrop={!saving}
      zIndexClass="z-[60]"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files?.[0];
        if (f) loadFile(f);
      }}
      panelClassName="w-full max-w-md p-5 space-y-4 text-xs"
    >
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">编辑用户头像</h3>
            <div style={{ color: 'var(--ink-muted)' }}>拖动调整位置，滚轮或滑块缩放与旋转</div>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="p-1 rounded-lg opacity-70 hover:opacity-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-4">
          <div
            className="relative shrink-0 rounded-2xl overflow-hidden select-none touch-none"
            style={{
              width: STAGE_SIZE,
              height: STAGE_SIZE,
              border: '1px solid var(--glass-border)',
              background: 'rgba(0,0,0,0.28)',
            }}
          >
            {imgEl ? (
              <canvas
                ref={stageCanvasRef}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                onWheel={handleWheel}
                style={{ width: STAGE_SIZE, height: STAGE_SIZE }}
                className={dragging ? 'cursor-grabbing block' : 'cursor-grab block'}
              />
            ) : (
              <div
                className="w-full h-full flex flex-col items-center justify-center gap-2 p-4 text-center"
                style={{ color: 'var(--ink-muted)' }}
              >
                <ImagePlus className="w-7 h-7 opacity-60" />
                <span>{loadError || '请选择或拖入头像图片'}</span>
              </div>
            )}
          </div>

          <div className="flex sm:flex-col items-center justify-center gap-3 shrink-0">
            <div className="flex flex-col items-center gap-1">
              <div
                className="rounded-full overflow-hidden ring-2 ring-white/25"
                style={{ width: 56, height: 56, background: 'var(--pill-bg)' }}
              >
                <canvas ref={previewLgRef} style={{ width: 56, height: 56 }} className="block" />
              </div>
              <span style={{ color: 'var(--ink-muted)' }}>资料预览</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <div
                className="rounded-full overflow-hidden ring-1 ring-white/25"
                style={{ width: 32, height: 32, background: 'var(--pill-bg)' }}
              >
                <canvas ref={previewSmRef} style={{ width: 32, height: 32 }} className="block" />
              </div>
              <span style={{ color: 'var(--ink-muted)' }}>顶栏图标</span>
            </div>
          </div>
        </div>

        <div className="space-y-2.5 p-3 rounded-xl" style={{ background: 'var(--pill-bg)' }}>
          <div className="flex items-center gap-2">
            <span className="w-10 shrink-0" style={{ color: 'var(--ink-muted)' }}>
              缩放
            </span>
            <button
              type="button"
              disabled={!imgEl}
              onClick={() => updateZoom(zoom - 0.15)}
              className="p-1 rounded-md orbit-hover cursor-pointer disabled:opacity-40"
              title="缩小"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <input
              type="range"
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={0.02}
              value={zoom}
              disabled={!imgEl}
              onChange={(e) => updateZoom(Number(e.target.value))}
              className="orbit-range flex-1"
              style={{ '--range-pct': `${zoomPct}%` } as React.CSSProperties}
            />
            <button
              type="button"
              disabled={!imgEl}
              onClick={() => updateZoom(zoom + 0.15)}
              className="p-1 rounded-md orbit-hover cursor-pointer disabled:opacity-40"
              title="放大"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <span className="w-11 text-right font-mono shrink-0">{Math.round(zoom * 100)}%</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="w-10 shrink-0" style={{ color: 'var(--ink-muted)' }}>
              旋转
            </span>
            <button
              type="button"
              disabled={!imgEl}
              onClick={() => updateRotation(rotation - 90)}
              className="p-1 rounded-md orbit-hover cursor-pointer disabled:opacity-40"
              title="逆时针 90°"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
            <input
              type="range"
              min={-180}
              max={180}
              step={1}
              value={rotation}
              disabled={!imgEl}
              onChange={(e) => updateRotation(Number(e.target.value))}
              className="orbit-range flex-1"
              style={{ '--range-pct': `${rotPct}%` } as React.CSSProperties}
            />
            <button
              type="button"
              disabled={!imgEl}
              onClick={() => updateRotation(rotation + 90)}
              className="p-1 rounded-md orbit-hover cursor-pointer disabled:opacity-40"
              title="顺时针 90°"
            >
              <RotateCw className="w-3.5 h-3.5" />
            </button>
            <span className="w-11 text-right font-mono shrink-0">{rotation}°</span>
          </div>

          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={!imgEl}
                onClick={() => setFlipX((v) => !v)}
                className="px-2.5 py-1 rounded-lg flex items-center gap-1 cursor-pointer disabled:opacity-40"
                style={{
                  background: flipX ? 'var(--brand-solid)' : 'var(--pill-hover)',
                  color: flipX ? '#fff' : 'var(--ink)',
                }}
              >
                <FlipHorizontal2 className="w-3.5 h-3.5" />
                <span>水平翻转</span>
              </button>
              <button
                type="button"
                disabled={!imgEl}
                onClick={handleReset}
                className="px-2.5 py-1 rounded-lg flex items-center gap-1 cursor-pointer disabled:opacity-40"
                style={{ background: 'var(--pill-hover)' }}
              >
                <Undo2 className="w-3.5 h-3.5" />
                <span>重置</span>
              </button>
            </div>
            <label
              className="px-2.5 py-1 rounded-lg flex items-center gap-1 cursor-pointer"
              style={{ background: 'var(--pill-hover)', color: 'var(--brand)' }}
            >
              <ImagePlus className="w-3.5 h-3.5" />
              <span>更换图片</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) loadFile(f);
                  e.target.value = '';
                }}
              />
            </label>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="h-8 px-3 rounded-lg cursor-pointer"
            style={{ background: 'var(--pill-bg)' }}
          >
            取消
          </button>
          <button
            type="button"
            disabled={!imgEl || saving}
            onClick={() => void handleExportAndSave()}
            className="h-8 px-4 rounded-lg font-medium text-white flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            style={{ background: 'var(--brand-solid)' }}
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <span>{saving ? '上传中...' : '保存头像'}</span>
          </button>
        </div>
    </CenteredModal>
  );
}
