/**
 * Import into app-private storage, then open only a validated XP project.
 * If the open/preflight fails, release the newly created private directory.
 * Never delete a project already committed as the active editor project.
 */
export async function importAndOpenProject<T>(
  source: T | null,
  io: {
    importArchive: (source: T, onProgress?: (percent: number) => void) => Promise<string>;
    openProject: (path: string) => Promise<void>;
    discardFailedImport: (path: string) => Promise<void>;
    isActiveProject: (path: string) => boolean;
  },
  onProgress?: (percent: number) => void,
): Promise<void> {
  if (source === null) return;
  let importedPath: string | null = null;
  try {
    importedPath = await io.importArchive(source, onProgress);
    await io.openProject(importedPath);
  } catch (error) {
    if (importedPath && !io.isActiveProject(importedPath)) {
      try {
        await io.discardFailedImport(importedPath);
      } catch (cleanupError) {
        throw new Error(
          `Import failed: ${String(error)}; private project cleanup also failed: ${String(cleanupError)}`,
          { cause: error },
        );
      }
    }
    throw error;
  }
}
