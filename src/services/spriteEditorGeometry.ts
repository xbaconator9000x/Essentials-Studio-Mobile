/** Minimum interactive scale for oversized RMXP sheets on narrow phones. */
export const MIN_SPRITE_ZOOM = 1 / 4096;

export interface SpriteViewport {
  zoom: number;
  offsetX: number;
  offsetY: number;
}

export interface SpriteTraceTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export function fitSpriteViewport(
  imageWidth: number,
  imageHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  maxZoom = 16,
): SpriteViewport {
  if (
    ![imageWidth, imageHeight, viewportWidth, viewportHeight, maxZoom].every(Number.isFinite) ||
    imageWidth <= 0 ||
    imageHeight <= 0 ||
    viewportWidth <= 0 ||
    viewportHeight <= 0 ||
    maxZoom < 1
  ) {
    return { zoom: 1, offsetX: 0, offsetY: 0 };
  }

  // Large RMXP character sheets must remain fully visible on portrait phones.
  // Preserve integer pixel scaling when the image fits; use fractional scaling
  // only when a 1× image would be cropped by the available canvas.
  const availableWidth = Math.max(1, viewportWidth - Math.min(32, viewportWidth * 0.1));
  const availableHeight = Math.max(1, viewportHeight - Math.min(32, viewportHeight * 0.1));
  const fitScale = Math.min(availableWidth / imageWidth, availableHeight / imageHeight);
  const zoom = fitScale < 1
    ? Math.min(1, fitScale)
    : Math.max(1, Math.min(Math.floor(maxZoom), Math.floor(fitScale)));
  return {
    zoom,
    offsetX: (viewportWidth - imageWidth * zoom) / 2,
    offsetY: (viewportHeight - imageHeight * zoom) / 2,
  };
}

export function rasterizeSpriteLine(
  start: { x: number; y: number },
  end: { x: number; y: number },
): { x: number; y: number }[] {
  // A corrupt or stale touch coordinate must never allocate a million-point stroke.
  // 32K pixels exceeds even unusually large RMXP sprite sheets while keeping
  // interpolation bounded on memory-constrained Android devices.
  if (![start.x, start.y, end.x, end.y].every(Number.isSafeInteger) ||
      Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y)) > 32_768) return [];
  let x = Math.floor(start.x);
  let y = Math.floor(start.y);
  const endX = Math.floor(end.x);
  const endY = Math.floor(end.y);
  const dx = Math.abs(endX - x);
  const sx = x < endX ? 1 : -1;
  const dy = -Math.abs(endY - y);
  const sy = y < endY ? 1 : -1;
  let error = dx + dy;
  const pixels: { x: number; y: number }[] = [];

  while (true) {
    pixels.push({ x, y });
    if (x === endX && y === endY) return pixels;
    const doubledError = 2 * error;
    if (doubledError >= dy) {
      error += dy;
      x += sx;
    }
    if (doubledError <= dx) {
      error += dx;
      y += sy;
    }
  }
}

export function spritePixelAt(
  screenX: number,
  screenY: number,
  viewport: SpriteViewport,
  imageWidth: number,
  imageHeight: number,
): { x: number; y: number } | null {
  if (
    ![screenX, screenY, viewport.zoom, viewport.offsetX, viewport.offsetY].every(Number.isFinite) ||
    viewport.zoom <= 0 ||
    !Number.isSafeInteger(imageWidth) || !Number.isSafeInteger(imageHeight) ||
    imageWidth <= 0 || imageHeight <= 0
  ) return null;
  const x = Math.floor((screenX - viewport.offsetX) / viewport.zoom);
  const y = Math.floor((screenY - viewport.offsetY) / viewport.zoom);
  // Extremely small fitted zooms or corrupted offsets can overflow the
  // screen-to-image transform; never forward invalid pixel indices to a brush.
  return Number.isSafeInteger(x) && Number.isSafeInteger(y) &&
    x >= 0 && y >= 0 && x < imageWidth && y < imageHeight ? { x, y } : null;
}

/** Set a precise zoom level while retaining the pixel beneath the chosen anchor. */
export function setSpriteViewportZoom(
  viewport: SpriteViewport,
  targetZoom: number,
  anchor: { x: number; y: number },
): SpriteViewport {
  if (![viewport.zoom, viewport.offsetX, viewport.offsetY, targetZoom, anchor.x, anchor.y]
    .every(Number.isFinite) || viewport.zoom <= 0 || targetZoom <= 0) return viewport;
  // Preserve fractional fit zoom when a large sheet is being inspected on a phone.
  const zoom = Math.max(MIN_SPRITE_ZOOM, Math.min(32, targetZoom));
  return {
    zoom,
    offsetX: anchor.x - (anchor.x - viewport.offsetX) * zoom / viewport.zoom,
    offsetY: anchor.y - (anchor.y - viewport.offsetY) * zoom / viewport.zoom,
  };
}

export function zoomSpriteViewport(
  viewport: SpriteViewport,
  startCenter: { x: number; y: number },
  nextCenter: { x: number; y: number },
  scale: number,
): SpriteViewport {
  if (![viewport.zoom, viewport.offsetX, viewport.offsetY, startCenter.x, startCenter.y, nextCenter.x, nextCenter.y, scale].every(Number.isFinite) || viewport.zoom <= 0 || scale <= 0) return viewport;
  // Pinch gestures must not snap an oversized sheet back to 1× on first touch.
  const zoom = Math.max(MIN_SPRITE_ZOOM, Math.min(32, viewport.zoom * scale));
  const worldX = (startCenter.x - viewport.offsetX) / viewport.zoom;
  const worldY = (startCenter.y - viewport.offsetY) / viewport.zoom;
  return {
    zoom,
    offsetX: nextCenter.x - worldX * zoom,
    offsetY: nextCenter.y - worldY * zoom,
  };
}

export function zoomSpriteTraceTransform(
  transform: SpriteTraceTransform,
  viewport: SpriteViewport,
  imageWidth: number,
  imageHeight: number,
  startCenter: { x: number; y: number },
  nextCenter: { x: number; y: number },
  scale: number,
): SpriteTraceTransform {
  if (
    ![viewport.zoom, viewport.offsetX, viewport.offsetY, imageWidth, imageHeight,
      startCenter.x, startCenter.y, nextCenter.x, nextCenter.y, scale,
      transform.scale, transform.offsetX, transform.offsetY].every(Number.isFinite) ||
    viewport.zoom <= 0 ||
    imageWidth <= 0 ||
    imageHeight <= 0 ||
    scale <= 0 ||
    transform.scale <= 0
  ) {
    return transform;
  }

  const nextScale = Math.max(25, Math.min(200, transform.scale * scale));
  const effectiveScale = nextScale / transform.scale;
  const spriteWidth = imageWidth * viewport.zoom;
  const spriteHeight = imageHeight * viewport.zoom;
  const traceWidth = spriteWidth * transform.scale / 100;
  const traceHeight = spriteHeight * transform.scale / 100;
  const traceLeft = viewport.offsetX + (spriteWidth - traceWidth) / 2 +
    spriteWidth * transform.offsetX / 100;
  const traceTop = viewport.offsetY + (spriteHeight - traceHeight) / 2 +
    spriteHeight * transform.offsetY / 100;
  const nextLeft = nextCenter.x + (traceLeft - startCenter.x) * effectiveScale;
  const nextTop = nextCenter.y + (traceTop - startCenter.y) * effectiveScale;
  const nextTraceWidth = spriteWidth * nextScale / 100;
  const nextTraceHeight = spriteHeight * nextScale / 100;

  return {
    scale: nextScale,
    offsetX: Math.max(-100, Math.min(100,
      (nextLeft - viewport.offsetX - (spriteWidth - nextTraceWidth) / 2) / spriteWidth * 100,
    )),
    offsetY: Math.max(-100, Math.min(100,
      (nextTop - viewport.offsetY - (spriteHeight - nextTraceHeight) / 2) / spriteHeight * 100,
    )),
  };
}
