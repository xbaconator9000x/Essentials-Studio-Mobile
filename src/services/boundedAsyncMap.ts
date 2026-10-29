/**
 * Bound concurrent async work while preserving the original item order.
 * Android's image data-URL bridge temporarily holds compressed bytes, base64,
 * and decoded pixels; loading every tileset/autotile at once can spike memory
 * even when the decoded-image cache itself has a strict LRU budget.
 */
export async function boundedAsyncMap<T, R>(
  items: readonly T[],
  concurrency: number,
  transform: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new Error("Image load concurrency must be a positive safe integer");
  }
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await transform(items[index], index);
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  ));
  return results;
}
