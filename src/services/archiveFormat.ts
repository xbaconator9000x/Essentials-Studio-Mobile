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
