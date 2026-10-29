/**
 * Testable Android SAF export handoff. The Android document picker supplies
 * a scoped content URI; native Rust streams and byte-verifies the ZIP.
 * Cancellation is not success and must never call the write command.
 */
export async function exportAndroidDocument(
  exportId: string,
  expectedBytes: number,
  filename: string,
  io: {
    pickDestination: (filename: string) => Promise<string | null>;
    writeAndVerify: (exportId: string, documentUri: string) => Promise<number>;
  },
  onProgress?: (percent: number) => void,
): Promise<"saved" | "cancelled"> {
  const documentUri = await io.pickDestination(filename);
  if (documentUri === null) return "cancelled";
  if (!documentUri.startsWith("content://")) {
    throw new Error("Android picker did not return a document content URI");
  }
  onProgress?.(95);
  const verifiedBytes = await io.writeAndVerify(exportId, documentUri);
  if (verifiedBytes !== expectedBytes) {
    throw new Error("Android ZIP export readback size mismatch");
  }
  onProgress?.(100);
  return "saved";
}
