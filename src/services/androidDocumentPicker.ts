const PICKER_CANCELLED_MESSAGE = "file picker cancelled";

export function isAndroidDocumentPickerCancellation(error: unknown): boolean {
  const message = typeof error === "string"
    ? error
    : error instanceof Error
      ? error.message
      : "";
  return message.trim().toLowerCase() === PICKER_CANCELLED_MESSAGE;
}

export async function pickAndroidDocument(
  pickDocument: () => Promise<string | null>,
  timeoutMs?: number,
): Promise<string | null> {
  try {
    if (timeoutMs === undefined) return await pickDocument();
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      throw new Error("Invalid Android document picker timeout");
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        Promise.resolve().then(pickDocument),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error(
            "Android project picker did not return a document. Import did not start; retry or choose the ZIP file directly."
          )), timeoutMs);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  } catch (error) {
    if (isAndroidDocumentPickerCancellation(error)) return null;
    throw error;
  }
}
