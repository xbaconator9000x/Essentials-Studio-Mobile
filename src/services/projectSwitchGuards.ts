const SWITCH_CONFIRMATION =
  "Save all unsaved changes before switching projects? Cancel keeps the current project open.";

export async function confirmProjectSwitch(options: {
  hasActiveProject: boolean;
  hasUnsavedEdits: () => boolean;
  confirm: (message: string) => Promise<boolean>;
  saveAll: () => Promise<void>;
}): Promise<boolean> {
  const { hasActiveProject, hasUnsavedEdits, confirm, saveAll } = options;
  if (!hasActiveProject || !hasUnsavedEdits()) return true;
  if (!(await confirm(SWITCH_CONFIRMATION))) return false;

  await saveAll();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  if (hasUnsavedEdits()) {
    throw new Error("New or unsaved edits remain after saving. Project switch cancelled.");
  }
  return true;
}
