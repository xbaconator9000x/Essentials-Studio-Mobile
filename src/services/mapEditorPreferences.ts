export interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function mapEventPinsPreferenceKey(projectPath: string | undefined, mapId: number | undefined): string | null {
  if (!projectPath || !Number.isSafeInteger(mapId) || mapId! < 1) return null;
  return `essentials-studio:map-event-pins:${encodeURIComponent(projectPath)}:${mapId}`;
}

export function readMapEventPinsVisible(
  projectPath: string | undefined,
  mapId: number | undefined,
  storage?: PreferenceStorage,
): boolean {
  const key = mapEventPinsPreferenceKey(projectPath, mapId);
  if (!key) return true;
  try {
    const target = storage ?? (typeof localStorage === "undefined" ? undefined : localStorage);
    return target?.getItem(key) !== "false";
  } catch {
    return true;
  }
}

export function writeMapEventPinsVisible(
  projectPath: string | undefined,
  mapId: number | undefined,
  visible: boolean,
  storage?: PreferenceStorage,
): void {
  const key = mapEventPinsPreferenceKey(projectPath, mapId);
  if (!key) return;
  try {
    const target = storage ?? (typeof localStorage === "undefined" ? undefined : localStorage);
    target?.setItem(key, String(visible));
  } catch {
    // Keep the current editor state when browser storage is unavailable or full.
  }
}
