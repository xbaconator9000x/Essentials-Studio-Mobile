import type { SpriteSelection } from "./spriteEditorPixels";

/** RPG Maker XP / Essentials character sheets contain four animation columns
 * and four directional rows (down, left, right, up). This is opt-in: a
 * non-character image must never be silently divided into walking frames. */
export const WALK_FRAME_DIRECTIONS = ["Down", "Left", "Right", "Up"] as const;
export const WALK_FRAME_COUNT = 16;

export interface WalkSpriteFrame extends SpriteSelection {
  index: number;
  direction: (typeof WALK_FRAME_DIRECTIONS)[number];
  phase: number;
}

export function getWalkSpriteFrame(
  imageWidth: number, imageHeight: number, index: number,
): WalkSpriteFrame | null {
  if (!Number.isSafeInteger(imageWidth) || !Number.isSafeInteger(imageHeight)
    || imageWidth <= 0 || imageHeight <= 0
    || imageWidth % 4 !== 0 || imageHeight % 4 !== 0
    || imageWidth * imageHeight > 16_777_216
    || !Number.isSafeInteger(index) || index < 0 || index >= WALK_FRAME_COUNT) return null;

  const width = imageWidth / 4;
  const height = imageHeight / 4;
  const column = index % 4;
  const row = Math.floor(index / 4);
  return {
    index,
    x: column * width,
    y: row * height,
    width,
    height,
    direction: WALK_FRAME_DIRECTIONS[row],
    phase: column + 1,
  };
}

/** Row-major frame navigation wraps across all 16 cells and never escapes
 * the source sheet. All coordinate operations are performed on source pixels. */
export function stepWalkSpriteFrame(index: number, delta: number): number | null {
  if (!Number.isInteger(index) || index < 0 || index >= WALK_FRAME_COUNT
    || !Number.isSafeInteger(delta)) return null;
  // Reduce the delta before addition: a large safe integer added to the
  // current frame can exceed JS's exact integer range and mis-wrap.
  const offset = ((delta % WALK_FRAME_COUNT) + WALK_FRAME_COUNT) % WALK_FRAME_COUNT;
  return (index + offset) % WALK_FRAME_COUNT;
}

/** Resolve an RMXP walking frame by its semantic direction and zero-based
 * animation column. Keeping this mapping central prevents touch controls from
 * accidentally treating a four-column row as a four-direction sequence. */
export function getWalkSpriteFrameByDirection(
  imageWidth: number, imageHeight: number,
  direction: (typeof WALK_FRAME_DIRECTIONS)[number], phase: number,
): WalkSpriteFrame | null {
  const row = WALK_FRAME_DIRECTIONS.indexOf(direction);
  if (row < 0 || !Number.isSafeInteger(phase) || phase < 1 || phase > 4) return null;
  return getWalkSpriteFrame(imageWidth, imageHeight, row * 4 + phase - 1);
}

/** Advance only the animation phase, keeping the selected facing direction.
 * This is appropriate for a mobile walk-cycle preview; the existing
 * stepWalkSpriteFrame continues to navigate all sixteen cells. */
export function stepWalkSpritePhase(index: number, delta: number): number | null {
  if (!Number.isSafeInteger(index) || index < 0 || index >= WALK_FRAME_COUNT
      || !Number.isSafeInteger(delta)) return null;
  const row = Math.floor(index / 4);
  const phase = index % 4;
  const offset = ((delta % 4) + 4) % 4;
  return row * 4 + (phase + offset) % 4;
}
