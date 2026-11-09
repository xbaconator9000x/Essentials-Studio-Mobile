export interface SpriteViewport {
  zoom: number;
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
    viewportWidth < 0 ||
    viewportHeight < 0 ||
    maxZoom < 1
  ) {
    return { zoom: 1, offsetX: 0, offsetY: 0 };
  }

  const zoom = Math.max(
    1,
    Math.min(
      Math.floor(maxZoom),
      Math.floor(Math.min(
        (viewportWidth - 32) / imageWidth,
        (viewportHeight - 32) / imageHeight,
      )),
    ),
  );
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
  if (![start.x, start.y, end.x, end.y].every(Number.isFinite)) return [];
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
  if (!Number.isFinite(viewport.zoom) || viewport.zoom <= 0) return null;
  const x = Math.floor((screenX - viewport.offsetX) / viewport.zoom);
  const y = Math.floor((screenY - viewport.offsetY) / viewport.zoom);
  return x >= 0 && y >= 0 && x < imageWidth && y < imageHeight ? { x, y } : null;
}

export function zoomSpriteViewport(
  viewport: SpriteViewport,
  startCenter: { x: number; y: number },
  nextCenter: { x: number; y: number },
  scale: number,
): SpriteViewport {
  const zoom = Math.max(1, Math.min(32, viewport.zoom * scale));
  const worldX = (startCenter.x - viewport.offsetX) / viewport.zoom;
  const worldY = (startCenter.y - viewport.offsetY) / viewport.zoom;
  return {
    zoom,
    offsetX: nextCenter.x - worldX * zoom,
    offsetY: nextCenter.y - worldY * zoom,
  };
}
