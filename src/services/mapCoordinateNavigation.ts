/**
 * Parse map coordinates exactly, without parseInt truncation or scientific
 * notation. RPG Maker XP map coordinates are zero-based integer tile indices.
 * This is presentation validation; native map/event writes remain in the
 * project's existing save pipeline.
 */
export function parseMapCoordinate(
  xInput: string,
  yInput: string,
  width: number,
  height: number,
): { x: number; y: number } | null {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
      width < 1 || height < 1) return null;
  const parse = (value: string) => {
    const text = value.trim();
    if (text.length < 1 || text.length > 16 || !/^[0-9]+$/.test(text)) return null;
    const number = Number(text);
    return Number.isSafeInteger(number) ? number : null;
  };
  const x = parse(xInput);
  const y = parse(yInput);
  if (x === null || y === null || x >= width || y >= height) return null;
  return { x, y };
}
