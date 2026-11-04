const LAST_PROJECT_KEY = "essentials-studio:last-project";

type ProjectPathStorage = Pick<Storage, "getItem" | "setItem">;

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
