/**
 * Serialize project mutations and ZIP snapshots across every editor entry point.
 *
 * A map tile save and event save both rewrite MapNNN.rxdata. Save All already
 * sequences its own callbacks, but toolbar actions, event dialogs, map
 * navigation, and project archive export can otherwise overlap those writes.
 *
 * Queue by project root so independent projects never block one another.
 * Failures propagate to their caller without poisoning subsequent operations.
 */
const pendingByProject = new Map<string, Promise<void>>();

export const SERIAL_PROJECT_COMMANDS = new Set([
  "save_map",
  "save_event",
  "create_event",
  "delete_event",
  "save_map_properties",
  "create_map",
  "delete_map",
  "rename_map",
  "save_all_scripts",
  "create_script",
  "delete_script",
  "save_database",
  "save_system",
  "save_pbs_file",
  "write_raw_pbs_file",
  "save_private_project_sprite",
  "import_private_project_sprite",
  // Archive creation must snapshot a quiescent project. The subsequent
  // provider write reads an immutable ZIP and does not need the project lock.
  "begin_project_archive_export",
  "export_browser_project_archive",
]);

export function shouldSerializeProjectCommand(
  command: string,
  args?: Record<string, unknown>,
): args is Record<string, unknown> & { projectPath: string } {
  return SERIAL_PROJECT_COMMANDS.has(command) &&
    typeof args?.projectPath === "string" &&
    args.projectPath.length > 0;
}

export function serializeProjectOperation<T>(
  projectPath: string,
  operation: () => Promise<T>,
): Promise<T> {
  const predecessor = pendingByProject.get(projectPath) ?? Promise.resolve();
  const result = predecessor.then(operation);
  const settled = result.then(() => {}, () => {});
  pendingByProject.set(projectPath, settled);
  void settled.then(() => {
    if (pendingByProject.get(projectPath) === settled) {
      pendingByProject.delete(projectPath);
    }
  });
  return result;
}
