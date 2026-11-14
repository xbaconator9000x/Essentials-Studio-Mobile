export function readBooleanPanelPreference(key: string): boolean | null {
  try {
    if (typeof window === "undefined") return null;
    const stored = window.localStorage.getItem(key);
    return stored === "true" ? true : stored === "false" ? false : null;
  } catch {
    return null;
  }
}

export function writeBooleanPanelPreference(key: string, value: boolean): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, String(value));
  } catch {
    // Keep the editor usable when persistent storage is unavailable.
  }
}
