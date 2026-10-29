/**
 * Save a dirty editor without clearing its dirty flag until the write resolves.
 * Rejections deliberately propagate to ProjectSaveContext.saveAll so a failed
 * map write cannot be mistaken for a successful save before ZIP export.
 */
export async function saveThenMarkClean(
  save: () => Promise<void>,
  markClean: () => void,
): Promise<void> {
  await save();
  markClean();
}
