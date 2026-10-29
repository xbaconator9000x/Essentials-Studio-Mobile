/** Coalesce simultaneous loads of the same project graphic without retaining
 * settled promises or errors. A failed read must be retryable on the next call.
 * The caller owns decoded-image caching and project-generation invalidation.
 */
export class InFlightImageLoads<T> {
  private readonly pending = new Map<string, Promise<T>>();

  run(key: string, load: () => Promise<T>): Promise<T> {
    const existing = this.pending.get(key);
    if (existing) return existing;

    // Defer invoking the loader until after the promise is registered. This
    // handles synchronous throws and reentrant callers consistently.
    const result = Promise.resolve().then(load).finally(() => {
      if (this.pending.get(key) === result) this.pending.delete(key);
    });
    this.pending.set(key, result);
    return result;
  }
}
