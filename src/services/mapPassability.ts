export interface PassageLayerTile {
  tileId: number;
  passage: number;
  priority: number;
}

const ALL_DIRECTIONS_BLOCKED = 0x0f;

export function effectiveBlockedPassageMask(
  layersTopToBottom: readonly PassageLayerTile[],
): number {
  let blockedDirections = ALL_DIRECTIONS_BLOCKED;
  let hasBlockingLayer = false;

  for (const tile of layersTopToBottom) {
    if (!Number.isSafeInteger(tile.tileId) || tile.tileId <= 0 ||
        !Number.isFinite(tile.priority) || tile.priority > 0) {
      continue;
    }

    hasBlockingLayer = true;
    blockedDirections &= Number.isFinite(tile.passage)
      ? Math.trunc(tile.passage) & ALL_DIRECTIONS_BLOCKED
      : 0;
    if (blockedDirections === 0) return 0;
  }

  return hasBlockingLayer ? blockedDirections : ALL_DIRECTIONS_BLOCKED;
}
