import { boundedAsyncMap } from "./boundedAsyncMap.ts";

/**
 * Load RPG Maker XP event character sheets without initiating an unbounded
 * number of decoded bitmap/data-URL transfers on Android.
 *
 * Each missing or broken graphic remains a null marker: a single corrupt
 * character sheet must not prevent unrelated NPCs from appearing on the map.
 * A superseded map/project may finish its in-flight jobs, but must not start
 * additional loads after the caller invalidates its generation.
 */
export async function loadMapEventGraphics<T>(
  names: readonly string[],
  load: (name: string) => Promise<T | null>,
  isCurrent: () => boolean = () => true,
): Promise<Map<string, T | null>> {
  const uniqueNames = [...new Set(names.filter((name) => name.trim().length > 0))];
  const entries = await boundedAsyncMap(uniqueNames, 2, async (name) => {
    if (!isCurrent()) return [name, null] as const;
    try {
      return [name, await load(name)] as const;
    } catch (error) {
      console.warn(`[mapEventGraphics] Cannot load event graphic '${name}':`, error);
      return [name, null] as const;
    }
  });
  return new Map(entries);
}
