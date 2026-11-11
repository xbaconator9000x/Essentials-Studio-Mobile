/**
 * Testable Android SAF export handoff. The Android document picker supplies
 * a scoped content URI; native Rust streams and byte-verifies the ZIP.
 * Cancellation is not success and must never call the write command.
 */
import { pickAndroidDocument } from "./androidDocumentPicker.ts";

export async function exportAndroidDocument(
  exportId: string,
  expectedBytes: number,
  filename: string,
  io: {
    pickDestination: (filename: string) => Promise<string | null>;
    writeAndVerify: (exportId: string, documentUri: string) => Promise<number>;
    discardDestination: (exportId: string, documentUri: string) => Promise<void>;
  },
  onProgress?: (percent: number) => void,
  pickerTimeoutMs = 120_000,
  format = "ZIP",
): Promise<"saved" | "cancelled"> {
  // The Android DocumentsUI save sheet can close without resolving the
  // tauri-plugin-dialog callback. Never leave the editor loading forever.
  // A late callback must never write to a document after this attempt fails.
  if (!Number.isSafeInteger(pickerTimeoutMs) || pickerTimeoutMs <= 0) {
    throw new Error("Invalid Android document picker timeout");
  }
  onProgress?.(20);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let documentUri: string | null;
  let pickerTimedOut = false;
  try {
    documentUri = await Promise.race([
      pickAndroidDocument(() => io.pickDestination(filename)).then(async (uri) => {
        if (pickerTimedOut && uri !== null) {
          await io.discardDestination(exportId, uri).catch((error: unknown) => {
            console.error(`Could not remove late Android ${format} destination:`, error);
          });
          return null;
        }
        return uri;
      }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          pickerTimedOut = true;
          reject(new Error(
            `Android document picker did not return a destination. No ${format} bytes were written by the editor; retry export.`
          ));
        }, pickerTimeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  if (documentUri === null) return "cancelled";
  if (!documentUri.startsWith("content://")) {
    throw new Error("Android picker did not return a document content URI");
  }
  onProgress?.(95);
  const verifiedBytes = await io.writeAndVerify(exportId, documentUri);
  if (verifiedBytes !== expectedBytes) {
    throw new Error(`Android ${format} export readback size mismatch`);
  }
  onProgress?.(100);
  return "saved";
}
