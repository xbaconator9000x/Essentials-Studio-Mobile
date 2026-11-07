export interface SpriteViewport {
  zoom: number;
  offsetX: number;
  offsetY: number;
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
