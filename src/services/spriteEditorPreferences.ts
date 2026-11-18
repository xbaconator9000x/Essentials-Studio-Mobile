export interface SpriteTraceTransformPreference {
  opacity: number;
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface SpritePreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const DEFAULT_SPRITE_TRACE_TRANSFORM: SpriteTraceTransformPreference = {
  opacity: 35,
  scale: 100,
  offsetX: 0,
  offsetY: 0,
};

export function spriteTracePreferenceKey(projectPath: string, spriteName: string): string | null {
  if (!projectPath || !spriteName) return null;
  return `essentials-studio:sprite-trace:${encodeURIComponent(projectPath)}:${encodeURIComponent(spriteName)}`;
}

function boundedNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

export function readSpriteTraceTransform(
  projectPath: string,
  spriteName: string,
  storage?: SpritePreferenceStorage,
): SpriteTraceTransformPreference {
  const key = spriteTracePreferenceKey(projectPath, spriteName);
  if (!key) return { ...DEFAULT_SPRITE_TRACE_TRANSFORM };
  try {
    const target = storage ?? (typeof localStorage === "undefined" ? undefined : localStorage);
    const value = target?.getItem(key);
    if (!value) return { ...DEFAULT_SPRITE_TRACE_TRANSFORM };
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_SPRITE_TRACE_TRANSFORM };
    const transform = parsed as Record<string, unknown>;
    return {
      opacity: boundedNumber(transform.opacity, 0, 100, DEFAULT_SPRITE_TRACE_TRANSFORM.opacity),
      scale: boundedNumber(transform.scale, 25, 200, DEFAULT_SPRITE_TRACE_TRANSFORM.scale),
      offsetX: boundedNumber(transform.offsetX, -100, 100, DEFAULT_SPRITE_TRACE_TRANSFORM.offsetX),
      offsetY: boundedNumber(transform.offsetY, -100, 100, DEFAULT_SPRITE_TRACE_TRANSFORM.offsetY),
    };
  } catch {
    return { ...DEFAULT_SPRITE_TRACE_TRANSFORM };
  }
}

export function writeSpriteTraceTransform(
  projectPath: string,
  spriteName: string,
  transform: SpriteTraceTransformPreference,
  storage?: SpritePreferenceStorage,
): void {
  const key = spriteTracePreferenceKey(projectPath, spriteName);
  if (!key) return;
  try {
    const target = storage ?? (typeof localStorage === "undefined" ? undefined : localStorage);
    target?.setItem(key, JSON.stringify({
      opacity: boundedNumber(transform.opacity, 0, 100, DEFAULT_SPRITE_TRACE_TRANSFORM.opacity),
      scale: boundedNumber(transform.scale, 25, 200, DEFAULT_SPRITE_TRACE_TRANSFORM.scale),
      offsetX: boundedNumber(transform.offsetX, -100, 100, DEFAULT_SPRITE_TRACE_TRANSFORM.offsetX),
      offsetY: boundedNumber(transform.offsetY, -100, 100, DEFAULT_SPRITE_TRACE_TRANSFORM.offsetY),
    }));
  } catch {
    // Keep the editor usable when browser storage is unavailable or full.
  }
}
