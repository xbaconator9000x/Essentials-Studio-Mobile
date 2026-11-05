export type SpriteTool = "brush" | "eraser" | "eyedropper" | "fill" | "pan";

export interface SpritePixelAction {
  pixels: Uint32Array;
  before: Uint32Array;
  after: Uint32Array;
}

const MAX_SPRITE_EDIT_PIXELS = 1_000_000;

function isValidImage(data: Uint8ClampedArray, width: number, height: number): boolean {
  return Number.isSafeInteger(width) && Number.isSafeInteger(height)
    && width > 0 && height > 0 && width * height <= 16_777_216
    && data.length === width * height * 4;
}

function readPackedPixel(data: Uint8ClampedArray, pixel: number): number {
  const offset = pixel * 4;
  return ((data[offset] << 24) | (data[offset + 1] << 16)
    | (data[offset + 2] << 8) | data[offset + 3]) >>> 0;
}

function writePackedPixel(data: Uint8ClampedArray, pixel: number, color: number): void {
  const offset = pixel * 4;
  data[offset] = (color >>> 24) & 0xff;
  data[offset + 1] = (color >>> 16) & 0xff;
  data[offset + 2] = (color >>> 8) & 0xff;
  data[offset + 3] = color & 0xff;
}

function parseColor(color: string): number | null {
  if (!/^#[\da-f]{6}$/i.test(color)) return null;
  return (Number.parseInt(color.slice(1), 16) * 0x100 + 0xff) >>> 0;
}

function createAction(
  changes: Map<number, { before: number; after: number }>,
): SpritePixelAction | null {
  if (!changes.size) return null;
  const pixels = new Uint32Array(changes.size);
  const before = new Uint32Array(changes.size);
  const after = new Uint32Array(changes.size);
  let index = 0;
  for (const [pixel, change] of changes) {
    if (change.before === change.after) continue;
    pixels[index] = pixel;
    before[index] = change.before;
    after[index] = change.after;
    index++;
  }
  if (!index) return null;
  return {
    pixels: pixels.slice(0, index),
    before: before.slice(0, index),
    after: after.slice(0, index),
  };
}

export function spriteColorAt(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
): string | null {
  if (!isValidImage(data, width, height)
      || !Number.isInteger(x) || !Number.isInteger(y)
      || x < 0 || y < 0 || x >= width || y >= height) return null;
  const color = readPackedPixel(data, y * width + x);
  return `#${(color >>> 8).toString(16).padStart(6, "0")}`;
}

export function paintSpritePixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  color: string,
  size = 1,
  erase = false,
): SpritePixelAction | null {
  const packedColor = erase ? 0 : parseColor(color);
  if (!isValidImage(data, width, height) || packedColor === null
      || !Number.isInteger(x) || !Number.isInteger(y)
      || !Number.isInteger(size) || size < 1 || size > 32
      || x < 0 || y < 0 || x >= width || y >= height) return null;

  const changes = new Map<number, { before: number; after: number }>();
  const left = x - Math.floor(size / 2);
  const top = y - Math.floor(size / 2);
  for (let py = Math.max(0, top); py < Math.min(height, top + size); py++) {
    for (let px = Math.max(0, left); px < Math.min(width, left + size); px++) {
      const pixel = py * width + px;
      const before = readPackedPixel(data, pixel);
      if (before === packedColor) continue;
      changes.set(pixel, { before, after: packedColor });
    }
  }
  const action = createAction(changes);
  if (action) applySpritePixelAction(data, action, "after");
  return action;
}

export function fillSpritePixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  color: string,
): SpritePixelAction | null {
  if (!isValidImage(data, width, height)
      || !Number.isInteger(x) || !Number.isInteger(y)
      || x < 0 || y < 0 || x >= width || y >= height) return null;
  const replacement = parseColor(color);
  if (replacement === null) return null;

  const start = y * width + x;
  const target = readPackedPixel(data, start);
  if (target === replacement) return null;

  const seen = new Uint8Array(width * height);
  const queue = new Int32Array(Math.min(width * height, MAX_SPRITE_EDIT_PIXELS) + 1);
  let readIndex = 0;
  let writeIndex = 1;
  queue[0] = start;
  seen[start] = 1;

  while (readIndex < writeIndex) {
    const pixel = queue[readIndex++];
    const px = pixel % width;
    const py = Math.floor(pixel / width);
    const neighbors = [
      px > 0 ? pixel - 1 : -1,
      px + 1 < width ? pixel + 1 : -1,
      py > 0 ? pixel - width : -1,
      py + 1 < height ? pixel + width : -1,
    ];
    for (const neighbor of neighbors) {
      if (neighbor < 0 || seen[neighbor] || readPackedPixel(data, neighbor) !== target) continue;
      if (writeIndex >= queue.length) {
        throw new Error("Fill region exceeds the one-million-pixel edit limit");
      }
      seen[neighbor] = 1;
      queue[writeIndex++] = neighbor;
    }
  }

  const pixels = queue.slice(0, writeIndex);
  const before = new Uint32Array(writeIndex).fill(target);
  const after = new Uint32Array(writeIndex).fill(replacement);
  const action = { pixels, before, after };
  applySpritePixelAction(data, action, "after");
  return action;
}

export function applySpritePixelAction(
  data: Uint8ClampedArray,
  action: SpritePixelAction,
  side: "before" | "after",
): void {
  if (action.pixels.length !== action.before.length
      || action.pixels.length !== action.after.length
      || data.length % 4 !== 0) return;
  const values = action[side];
  const pixelCount = data.length / 4;
  for (let index = 0; index < action.pixels.length; index++) {
    const pixel = action.pixels[index];
    if (pixel < pixelCount) writePackedPixel(data, pixel, values[index]);
  }
}

export class SpritePixelHistory {
  private past: SpritePixelAction[] = [];
  private future: SpritePixelAction[] = [];
  private pending = new Map<number, { before: number; after: number }>();
  private pastPixels = 0;
  private futurePixels = 0;

  begin(): void {
    if (this.pending.size === 0) this.pending.clear();
  }

  record(action: SpritePixelAction): boolean {
    let additionalPixels = 0;
    for (const pixel of action.pixels) {
      if (!this.pending.has(pixel)) additionalPixels++;
    }
    if (this.pending.size + additionalPixels > MAX_SPRITE_EDIT_PIXELS) return false;

    for (let index = 0; index < action.pixels.length; index++) {
      const pixel = action.pixels[index];
      const existing = this.pending.get(pixel);
      this.pending.set(pixel, {
        before: existing?.before ?? action.before[index],
        after: action.after[index],
      });
    }
    return true;
  }

  commit(): boolean {
    const action = createAction(this.pending);
    this.pending.clear();
    if (!action) return false;
    this.future = [];
    this.futurePixels = 0;
    this.past.push(action);
    this.pastPixels += action.pixels.length;
    while (this.past.length > 50 || this.pastPixels > MAX_SPRITE_EDIT_PIXELS) {
      this.pastPixels -= this.past.shift()!.pixels.length;
    }
    return true;
  }

  cancel(data: Uint8ClampedArray): boolean {
    if (!this.pending.size) return false;
    const action = createAction(this.pending);
    this.pending.clear();
    if (!action) return false;
    applySpritePixelAction(data, action, "before");
    return true;
  }

  undo(data: Uint8ClampedArray): boolean {
    const action = this.past.pop();
    if (!action) return false;
    this.pastPixels -= action.pixels.length;
    applySpritePixelAction(data, action, "before");
    this.future.push(action);
    this.futurePixels += action.pixels.length;
    return true;
  }

  redo(data: Uint8ClampedArray): boolean {
    const action = this.future.pop();
    if (!action) return false;
    this.futurePixels -= action.pixels.length;
    applySpritePixelAction(data, action, "after");
    this.past.push(action);
    this.pastPixels += action.pixels.length;
    return true;
  }

  clear(): void {
    this.past = [];
    this.future = [];
    this.pending.clear();
    this.pastPixels = 0;
    this.futurePixels = 0;
  }

  canUndo(): boolean {
    return this.past.length > 0;
  }

  canRedo(): boolean {
    return this.future.length > 0;
  }
}
