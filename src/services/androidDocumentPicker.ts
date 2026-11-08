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
): Promise<string | null> {
  try {
    return await pickDocument();
  } catch (error) {
    if (isAndroidDocumentPickerCancellation(error)) return null;
    throw error;
  }
}
