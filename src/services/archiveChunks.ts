/**
 * Archive IPC framing shared by import/export. Native Rust is authoritative
 * for ZIP validation; these guards prevent silent truncation in the WebView
 * transport before an archive is accepted or offered for sharing.
 */
export const ARCHIVE_CHUNK_BYTES = 256 * 1024;
export const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;

export function validateArchiveSize(size: number): void {
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_ARCHIVE_BYTES) {
    throw new Error("Invalid project ZIP size (must be 1 byte to 512 MiB)");
  }
}

export function expectedArchiveChunkLength(size: number, offset: number): number {
  validateArchiveSize(size);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= size) {
    throw new Error("Invalid project ZIP chunk offset");
  }
  return Math.min(ARCHIVE_CHUNK_BYTES, size - offset);
}

export function encodeArchiveChunk(bytes: Uint8Array): string {
  if (bytes.length === 0 || bytes.length > ARCHIVE_CHUNK_BYTES) {
    throw new Error("Invalid project ZIP upload chunk length");
  }
  let binary = "";
  for (let index = 0; index < bytes.length; index++) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

export function decodeArchiveChunk(encoded: string, expectedLength: number): Uint8Array {
  if (!Number.isSafeInteger(expectedLength) || expectedLength < 1 || expectedLength > ARCHIVE_CHUNK_BYTES) {
    throw new Error("Invalid expected project ZIP chunk length");
  }
  // The native command returns standard, padded Base64. Reject malformed or
  // unexpectedly long responses before allocating a large decoded buffer.
  if (typeof encoded !== "string" ||
      encoded.length !== Math.ceil(expectedLength / 3) * 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new Error("Invalid or truncated project ZIP export chunk");
  }
  const binary = atob(encoded);
  if (binary.length !== expectedLength) {
    throw new Error("Project ZIP export chunk length mismatch");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function verifyImportChunkAcknowledgement(actual: number, expected: number): void {
  if (!Number.isSafeInteger(actual) || actual !== expected) {
    throw new Error(`Project ZIP upload acknowledgement mismatch (expected ${expected}, received ${actual})`);
  }
}
