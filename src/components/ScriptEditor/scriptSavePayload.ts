import type { ScriptEntry, ScriptData } from "../../types";

/** Save All is a patch: only edited/renamed scripts cross Tauri IPC. */
export async function collectDirtyScriptPayload(
  scripts: readonly ScriptEntry[],
  dirtyIds: ReadonlySet<number>,
  cachedSources: ReadonlyMap<number, string>,
  loadSource: (id: number) => Promise<string>,
): Promise<ScriptData[]> {
  const result: ScriptData[] = [];
  const seen = new Set<number>();
  for (const script of scripts) {
    if (!dirtyIds.has(script.id)) continue;
    if (seen.has(script.id)) {
      throw new Error(`Duplicate script ID ${script.id}; save refused`);
    }
    seen.add(script.id);
    // Only a rename of an unopened script requires a native source read.
    const source = cachedSources.get(script.id) ?? await loadSource(script.id);
    result.push({ id: script.id, title: script.title, source });
  }
  if (seen.size !== dirtyIds.size) {
    throw new Error("Dirty script is missing from the current list; save refused");
  }
  return result;
}
