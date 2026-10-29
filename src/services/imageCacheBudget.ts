/**
 * Bounded decoded-image LRU. A count-only cache can retain hundreds of
 * 32 MiB source images; decoded RGBA bitmaps can be much larger than the file.
 * This caps an approximate 4 bytes per pixel, independent of ZIP/file size.
 *
 * Eviction removes only our cache reference. Visible canvases/components
 * continue owning any images they are currently drawing.
 */
export class DecodedImageCache<T extends { width: number; height: number }> {
  private readonly entries = new Map<string, { image: T; pixels: number }>();
  private totalPixels = 0;

  constructor(
    private readonly maxEntries: number,
    private readonly maxPixels: number,
  ) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 ||
        !Number.isSafeInteger(maxPixels) || maxPixels < 1) {
      throw new Error("Image cache limits must be positive safe integers");
    }
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry); // most recently used
    return entry.image;
  }

  set(key: string, image: T): void {
    const pixels = image.width * image.height;
    // An oversized image may still be rendered, but must not stay cached.
    // Reject invalid dimensions rather than allowing an unbounded entry.
    if (!Number.isSafeInteger(pixels) || pixels < 1 || pixels > this.maxPixels ||
        !Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) ||
        image.width < 1 || image.height < 1) {
      this.delete(key);
      return;
    }

    this.delete(key);
    while (this.entries.size >= this.maxEntries ||
           this.totalPixels + pixels > this.maxPixels) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.delete(oldest);
    }
    this.entries.set(key, { image, pixels });
    this.totalPixels += pixels;
  }

  delete(key: string): void {
    const existing = this.entries.get(key);
    if (!existing) return;
    this.totalPixels -= existing.pixels;
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
    this.totalPixels = 0;
  }

  get size(): number {
    return this.entries.size;
  }

  get pixelCount(): number {
    return this.totalPixels;
  }
}
