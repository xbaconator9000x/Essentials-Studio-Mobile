/** Compare picker paths without changing the native path used to open a project. */
export function projectPathIdentity(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized || path;
}

const LAST_PROJECT_KEY = "essentials-studio:last-project";
const RECENT_PROJECTS_KEY = "essentials-studio:recent-projects";
const RECENT_MAP_SELECTIONS_KEY = "essentials-studio:recent-map-selections";
const MAX_RECENT_PROJECTS = 8;
const MAX_RECENT_MAP_SELECTIONS = 8;

type ProjectPathStorage = Pick<Storage, "getItem" | "setItem">;
type RecentMapSelection = { projectPath: string; mapId: number };

function browserStorage(): ProjectPathStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function validProjectPath(path: string | null): path is string {
  return Boolean(path && path.trim() === path && !path.includes("\0") && path.length <= 4096);
}

export function getLastProjectPath(storage: ProjectPathStorage | null = browserStorage()): string | null {
  if (!storage) return null;
  try {
    const path = storage.getItem(LAST_PROJECT_KEY);
    return validProjectPath(path) ? path : null;
  } catch {
    return null;
  }
}

export function rememberLastProjectPath(
  path: string,
  storage: ProjectPathStorage | null = browserStorage(),
): void {
  if (!storage || !validProjectPath(path)) return;
  try {
    storage.setItem(LAST_PROJECT_KEY, path);
  } catch {
    // Project opening must work even when browser storage is unavailable.
  }
}

export function getRecentProjectPaths(
  storage: ProjectPathStorage | null = browserStorage(),
): string[] {
  if (!storage) return [];
  try {
    const stored = storage.getItem(RECENT_PROJECTS_KEY);
    if (!stored) return [];
    const paths: unknown = JSON.parse(stored);
    if (!Array.isArray(paths)) return [];
    const seen = new Set<string>();
    return paths.filter((path): path is string => {
      if (typeof path !== "string" || !validProjectPath(path)) return false;
      const identity = projectPathIdentity(path);
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    }).slice(0, MAX_RECENT_PROJECTS);
  } catch {
    return [];
  }
}

export function rememberRecentProjectPath(
  path: string,
  storage: ProjectPathStorage | null = browserStorage(),
): void {
  if (!storage || !validProjectPath(path)) return;
  try {
    const recent = getRecentProjectPaths(storage).filter((entry) => projectPathIdentity(entry) !== projectPathIdentity(path));
    storage.setItem(RECENT_PROJECTS_KEY, JSON.stringify([path, ...recent].slice(0, MAX_RECENT_PROJECTS)));
  } catch {
    // Project opening must work even when browser storage is unavailable.
  }
  rememberLastProjectPath(path, storage);
}

function readRecentMapSelections(storage: ProjectPathStorage): RecentMapSelection[] {
  try {
    const stored = storage.getItem(RECENT_MAP_SELECTIONS_KEY);
    if (!stored) return [];
    const entries: unknown = JSON.parse(stored);
    if (!Array.isArray(entries)) return [];
    const valid = entries.filter((entry): entry is RecentMapSelection =>
      typeof entry === "object" &&
      entry !== null &&
      "projectPath" in entry &&
      typeof entry.projectPath === "string" &&
      validProjectPath(entry.projectPath) &&
      "mapId" in entry &&
      Number.isSafeInteger(entry.mapId) &&
      entry.mapId > 0
    );
    const seen = new Set<string>();
    return valid.filter((entry) => {
      const identity = projectPathIdentity(entry.projectPath);
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    }).slice(0, MAX_RECENT_MAP_SELECTIONS);
  } catch {
    return [];
  }
}

export function getLastMapId(
  projectPath: string,
  storage: ProjectPathStorage | null = browserStorage(),
): number | null {
  if (!storage || !validProjectPath(projectPath)) return null;
  return readRecentMapSelections(storage).find((entry) => projectPathIdentity(entry.projectPath) === projectPathIdentity(projectPath))?.mapId ?? null;
}

export function rememberLastMapId(
  projectPath: string,
  mapId: number,
  storage: ProjectPathStorage | null = browserStorage(),
): void {
  if (!storage || !validProjectPath(projectPath) || !Number.isSafeInteger(mapId) || mapId <= 0) return;
  try {
    const recent = readRecentMapSelections(storage)
      .filter((entry) => projectPathIdentity(entry.projectPath) !== projectPathIdentity(projectPath));
    storage.setItem(RECENT_MAP_SELECTIONS_KEY, JSON.stringify([
      { projectPath, mapId },
      ...recent,
    ].slice(0, MAX_RECENT_MAP_SELECTIONS)));
  } catch {
    // Map selection persistence must not block opening or editing a project.
  }
}
