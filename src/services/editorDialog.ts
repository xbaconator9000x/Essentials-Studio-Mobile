/**
 * Shared confirmation boundary for the Android/Desktop Tauri editor and
 * browser-first development. The native dialog plugin requires Tauri IPC;
 * calling it in a normal browser rejects and can strand dirty event/map UI.
 * Never interpret an unavailable dialog as consent to discard user edits.
 */
export interface ConfirmationRuntime {
  isNative?: () => boolean;
  nativeConfirm?: (message: string) => Promise<boolean>;
  browserConfirm?: (message: string) => boolean;
}

export async function confirmEditor(
  message: string,
  runtime: ConfirmationRuntime = {},
): Promise<boolean> {
  const native = runtime.isNative?.() ?? (
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
  );
  if (native) {
    const confirm = runtime.nativeConfirm ?? (await import("@tauri-apps/plugin-dialog")).confirm;
    return confirm(message);
  }
  const browserConfirm = runtime.browserConfirm ?? (
    typeof window !== "undefined" ? window.confirm.bind(window) : null
  );
  if (!browserConfirm) {
    throw new Error("Confirmation is unavailable; changes were not discarded");
  }
  return browserConfirm(message);
}
