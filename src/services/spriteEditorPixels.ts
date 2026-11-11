export type SpriteTool = "brush" | "eraser" | "eyedropper" | "fill" | "select" | "pan";

export interface SpritePixelAction {
  pixels: Uint32Array;
  before: Uint32Array;
  after: Uint32Array;
}

export interface SpriteSelection {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SpriteClipboardImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
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

export function normalizeSpriteSelection(
  start: { x: number; y: number },
  end: { x: number; y: number },
  imageWidth: number,
  imageHeight: number,
): SpriteSelection | null {
  if (!Number.isSafeInteger(imageWidth) || !Number.isSafeInteger(imageHeight)
      || imageWidth <= 0 || imageHeight <= 0
      || ![start.x, start.y, end.x, end.y].every(Number.isInteger)) return null;
  const startX = Math.max(0, Math.min(imageWidth - 1, start.x));
  const startY = Math.max(0, Math.min(imageHeight - 1, start.y));
  const endX = Math.max(0, Math.min(imageWidth - 1, end.x));
  const endY = Math.max(0, Math.min(imageHeight - 1, end.y));
  return {
    x: Math.min(startX, endX),
    y: Math.min(startY, endY),
    width: Math.abs(endX - startX) + 1,
    height: Math.abs(endY - startY) + 1,
  };
}

/** Move the selection rectangle without touching pixels, keeping its full size in bounds.
 * Useful for accurately positioning paste targets on a touch screen. */
export function moveSpriteSelection(
  selection: SpriteSelection, dx: number, dy: number,
  imageWidth: number, imageHeight: number,
): SpriteSelection | null {
  if (!Number.isSafeInteger(dx) || !Number.isSafeInteger(dy)
      || !Number.isSafeInteger(imageWidth) || !Number.isSafeInteger(imageHeight)
      || !isValidSpriteSelection(selection, imageWidth, imageHeight)) return null;
  return {
    ...selection,
    x: Math.max(0, Math.min(imageWidth - selection.width, selection.x + dx)),
    y: Math.max(0, Math.min(imageHeight - selection.height, selection.y + dy)),
  };
}

function isValidSpriteSelection(
  selection: SpriteSelection,
  imageWidth: number,
  imageHeight: number,
): boolean {
  return [selection.x, selection.y, selection.width, selection.height].every(Number.isSafeInteger)
    && selection.x >= 0 && selection.y >= 0 && selection.width > 0 && selection.height > 0
    && selection.x + selection.width <= imageWidth
    && selection.y + selection.height <= imageHeight;
}

export function copySpriteSelection(
  data: Uint8ClampedArray,
  imageWidth: number,
  imageHeight: number,
  selection: SpriteSelection,
): SpriteClipboardImage | null {
  if (!isValidImage(data, imageWidth, imageHeight)
      || !isValidSpriteSelection(selection, imageWidth, imageHeight)
      || selection.width * selection.height > MAX_SPRITE_EDIT_PIXELS) return null;
  const copied = new Uint8ClampedArray(selection.width * selection.height * 4);
  for (let y = 0; y < selection.height; y++) {
    const sourceStart = ((selection.y + y) * imageWidth + selection.x) * 4;
    const targetStart = y * selection.width * 4;
    copied.set(data.subarray(sourceStart, sourceStart + selection.width * 4), targetStart);
  }
  return { width: selection.width, height: selection.height, data: copied };
}

export function clearSpriteSelection(
  data: Uint8ClampedArray,
  imageWidth: number,
  imageHeight: number,
  selection: SpriteSelection,
): SpritePixelAction | null {
  if (!isValidImage(data, imageWidth, imageHeight)
      || !isValidSpriteSelection(selection, imageWidth, imageHeight)
      || selection.width * selection.height > MAX_SPRITE_EDIT_PIXELS) return null;
  const changes = new Map<number, { before: number; after: number }>();
  for (let y = selection.y; y < selection.y + selection.height; y++) {
    for (let x = selection.x; x < selection.x + selection.width; x++) {
      const pixel = y * imageWidth + x;
      const before = readPackedPixel(data, pixel);
      if (before !== 0) changes.set(pixel, { before, after: 0 });
    }
  }
  const action = createAction(changes);
  if (action) applySpritePixelAction(data, action, "after");
  return action;
}

export function pasteSpriteSelection(
  data: Uint8ClampedArray,
  imageWidth: number,
  imageHeight: number,
  clipboard: SpriteClipboardImage,
  destination: { x: number; y: number },
  transparentMode: "replace" | "preserve" = "replace",
): SpritePixelAction | null {
  if (!isValidImage(data, imageWidth, imageHeight)
      || !isValidImage(clipboard.data, clipboard.width, clipboard.height)
      || clipboard.width * clipboard.height > MAX_SPRITE_EDIT_PIXELS
      || !Number.isInteger(destination.x) || !Number.isInteger(destination.y)
      || destination.x < 0 || destination.y < 0
      || destination.x >= imageWidth || destination.y >= imageHeight) return null;
  if (transparentMode !== "replace" && transparentMode !== "preserve") return null;
  const changes = new Map<number, { before: number; after: number }>();
  const width = Math.min(clipboard.width, imageWidth - destination.x);
  const height = Math.min(clipboard.height, imageHeight - destination.y);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const targetPixel = (destination.y + y) * imageWidth + destination.x + x;
      const sourcePixel = y * clipboard.width + x;
      const before = readPackedPixel(data, targetPixel);
      const after = readPackedPixel(clipboard.data, sourcePixel);
      if (transparentMode === "preserve" && (after & 0xff) === 0) continue;
      if (before !== after) changes.set(targetPixel, { before, after });
    }
  }
  const action = createAction(changes);
  if (action) applySpritePixelAction(data, action, "after");
  return action;
}

/** Move the selected pixels and clear their original positions as one atomic undoable edit.
 * Destination must fit within the image; overlap is handled from a source snapshot.
 * Transparent pixels in the selection are moved too (replacement semantics). */
export function moveSpritePixels(
  data: Uint8ClampedArray, width: number, height: number,
  selection: SpriteSelection, dx: number, dy: number,
): SpritePixelAction | null {
  if (!isValidImage(data, width, height) || !isValidSpriteSelection(selection, width, height)
      || !Number.isSafeInteger(dx) || !Number.isSafeInteger(dy)
      || (dx === 0 && dy === 0)
      || selection.width * selection.height > MAX_SPRITE_EDIT_PIXELS
      || selection.x + dx < 0 || selection.y + dy < 0
      || selection.x + selection.width + dx > width
      || selection.y + selection.height + dy > height) return null;
  const snapshot = copySpriteSelection(data, width, height, selection);
  if (!snapshot) return null;
  const changes = new Map<number, { before: number; after: number }>();
  const setAfter = (pixel: number, after: number) => {
    const current = changes.get(pixel);
    changes.set(pixel, { before: current?.before ?? readPackedPixel(data, pixel), after });
  };
  for (let y = 0; y < selection.height; y++) {
    for (let x = 0; x < selection.width; x++) {
      setAfter((selection.y + y) * width + selection.x + x, 0);
    }
  }
  for (let y = 0; y < selection.height; y++) {
    for (let x = 0; x < selection.width; x++) {
      const color = readPackedPixel(snapshot.data, y * selection.width + x);
      setAfter((selection.y + dy + y) * width + selection.x + dx + x, color);
    }
  }
  const action = createAction(changes);
  if (action) applySpritePixelAction(data, action, "after");
  return action;
}

/** Flip the selected rectangle (or the entire sprite) without resampling or
 * altering dimensions. The returned action is a single undoable edit. */
export function flipSpritePixels(
  data: Uint8ClampedArray, width: number, height: number,
  axis: "horizontal" | "vertical" | "rotate180", selection?: SpriteSelection | null,
): SpritePixelAction | null {
  const area = selection ?? { x: 0, y: 0, width, height };
  if (!isValidImage(data, width, height) || !isValidSpriteSelection(area, width, height)
      || area.width * area.height > MAX_SPRITE_EDIT_PIXELS) return null;
  const changes = new Map<number, { before: number; after: number }>();
  for (let y = 0; y < area.height; y++) {
    for (let x = 0; x < area.width; x++) {
      const target = (area.y + y) * width + area.x + x;
      const sourceX = axis !== "vertical" ? area.width - 1 - x : x;
      const sourceY = axis !== "horizontal" ? area.height - 1 - y : y;
      const source = (area.y + sourceY) * width + area.x + sourceX;
      const before = readPackedPixel(data, target);
      const after = readPackedPixel(data, source);
      if (before !== after) changes.set(target, { before, after });
    }
  }
  const action = createAction(changes);
  if (action) applySpritePixelAction(data, action, "after");
  return action;
}

/** Rotate a square sprite region by 90 degrees, preserving exact RGBA bytes.
 * Non-square areas are rejected because rotating them would require resizing
 * the native image or modifying pixels outside the selection. */
export function rotateSquareSpritePixels(
  data: Uint8ClampedArray, width: number, height: number,
  direction: "clockwise" | "counterclockwise", selection?: SpriteSelection | null,
): SpritePixelAction | null {
  const area = selection ?? { x: 0, y: 0, width, height };
  if (!isValidImage(data, width, height) || !isValidSpriteSelection(area, width, height)
      || area.width !== area.height || area.width * area.height > MAX_SPRITE_EDIT_PIXELS) return null;
  const changes = new Map<number, { before: number; after: number }>();
  for (let y = 0; y < area.height; y++) {
    for (let x = 0; x < area.width; x++) {
      const target = (area.y + y) * width + area.x + x;
      const sourceX = direction === "clockwise" ? y : area.width - 1 - y;
      const sourceY = direction === "clockwise" ? area.height - 1 - x : x;
      const source = (area.y + sourceY) * width + area.x + sourceX;
      const before = readPackedPixel(data, target);
      const after = readPackedPixel(data, source);
      if (before !== after) changes.set(target, { before, after });
    }
  }
  const action = createAction(changes);
  if (action) applySpritePixelAction(data, action, "after");
  return action;
}

/** Extract frequent visible RGB colors; ignore fully transparent pixels. */
export function extractSpritePalette(
  data: Uint8ClampedArray, width: number, height: number, limit = 16,
): string[] {
  if (!isValidImage(data, width, height) || width * height > MAX_SPRITE_EDIT_PIXELS
      || !Number.isSafeInteger(limit) || limit < 1 || limit > 64) return [];
  const counts = new Map<number, number>();
  for (let pixel = 0; pixel < width * height; pixel++) {
    const packed = readPackedPixel(data, pixel);
    if ((packed & 0xff) === 0) continue;
    const rgb = packed >>> 8;
    counts.set(rgb, (counts.get(rgb) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, limit).map(([rgb]) => "#" + rgb.toString(16).padStart(6, "0"));
}

/** Exact RGB replacement in the selection or sprite, preserving alpha. */
export function replaceSpriteColor(
  data: Uint8ClampedArray, width: number, height: number,
  from: string, to: string, selection?: SpriteSelection | null,
): SpritePixelAction | null {
  const area = selection ?? { x: 0, y: 0, width, height };
  const source = parseColor(from);
  const target = parseColor(to);
  if (source === null || target === null || source === target
      || !isValidImage(data, width, height) || !isValidSpriteSelection(area, width, height)
      || area.width * area.height > MAX_SPRITE_EDIT_PIXELS) return null;
  const changes = new Map<number, { before: number; after: number }>();
  for (let y = area.y; y < area.y + area.height; y++) {
    for (let x = area.x; x < area.x + area.width; x++) {
      const pixel = y * width + x;
      const before = readPackedPixel(data, pixel);
      const alpha = before & 0xff;
      if (alpha === 0 || (before >>> 8) !== (source >>> 8)) continue;
      const after = ((target & 0xffffff00) | alpha) >>> 0;
      changes.set(pixel, { before, after });
    }
  }
  const action = createAction(changes);
  if (action) applySpritePixelAction(data, action, "after");
  return action;
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
  const queue = new Uint32Array(Math.min(width * height, MAX_SPRITE_EDIT_PIXELS));
  let readIndex = 0;
  let writeIndex = 1;
  queue[0] = start;
  seen[start] = 1;

  while (readIndex < writeIndex) {
    const pixel = queue[readIndex++];
    const px = pixel % width;
    const py = Math.floor(pixel / width);
    const enqueue = (neighbor: number) => {
      if (seen[neighbor] || readPackedPixel(data, neighbor) !== target) return;
      if (writeIndex >= queue.length) throw new Error("Fill region exceeds the one-million-pixel edit limit");
      seen[neighbor] = 1;
      queue[writeIndex++] = neighbor;
    };
    if (px > 0) enqueue(pixel - 1);
    if (px + 1 < width) enqueue(pixel + 1);
    if (py > 0) enqueue(pixel - width);
    if (py + 1 < height) enqueue(pixel + width);
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
    return this.push(action);
  }

  push(action: SpritePixelAction): boolean {
    if (action.pixels.length > MAX_SPRITE_EDIT_PIXELS) return false;
    if (this.pending.size) this.commit();
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
