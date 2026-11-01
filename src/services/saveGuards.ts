/**
 * Save a dirty editor without clearing its dirty flag until the write resolves.
 * Rejections deliberately propagate to ProjectSaveContext.saveAll so a failed
 * map write cannot be mistaken for a successful save before ZIP export.
 */
export async function saveThenMarkClean(
  save: () => Promise<void>,
  markClean: () => void,
  canMarkClean: () => boolean = () => true,
): Promise<void> {
  await save();
  if (!canMarkClean()) {
    throw new Error("Map changed while saving; newer edits remain unsaved. Save again.");
  }
  markClean();
}


/**
 * An asynchronous save or map load may complete after the user paints again
 * or changes projects. Object identity is intentional: an event refresh may
 * replace the current MapRenderData while preserving its tiles.
 */
export function mapStillUnchanged<T>(
  snapshot: { projectPath: string; map: T | null; revision: number },
  current: { projectPath: string | undefined; map: T | null; revision: number },
): boolean {
  return snapshot.projectPath === current.projectPath
    && snapshot.map === current.map
    && snapshot.revision === current.revision;
}
