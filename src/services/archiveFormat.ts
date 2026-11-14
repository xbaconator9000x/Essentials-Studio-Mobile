export const UNSUPPORTED_RAR_MESSAGE =
  "RAR archives are not supported. Extract the archive locally, then create a ZIP containing the project folder with Game.rxproj. Renaming .rar to .zip will not convert it.";

const RAR_SIGNATURE = [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07];

export function getUnsupportedArchiveMessage(
  fileName: string,
  header: ArrayLike<number> = [],
): string | null {
  const isRar = fileName.toLowerCase().endsWith(".rar") ||
    (header.length >= RAR_SIGNATURE.length &&
      RAR_SIGNATURE.every((byte, index) => header[index] === byte));
  return isRar ? UNSUPPORTED_RAR_MESSAGE : null;
}

/** Fail early for mislabeled files, before allocating an import session.
 * The Rust ZIP parser remains the authoritative archive validator.
 */
export function validateZipSignature(header: ArrayLike<number>): void {
  const localFileHeader = header.length >= 4 &&
    header[0] === 0x50 && header[1] === 0x4b &&
    header[2] === 0x03 && header[3] === 0x04;
  if (!localFileHeader) {
    throw new Error("This file is not a supported project ZIP archive (missing ZIP file header). Export or create a real ZIP; renaming another file will not convert it.");
  }
}
