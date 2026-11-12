import "./MobileWorkspaceBar.css";

export type MobileWorkspaceSection = "projects" | "maps" | "sprites" | "settings";

interface Props {
  section: MobileWorkspaceSection;
  projectName: string;
  mapName?: string | null;
  dirtyCount: number;
  busy: boolean;
  editingEnabled: boolean;
  paletteVisible: boolean;
  onShowProjects: () => void;
  onToggleEditing: () => void;
  onTogglePalette: () => void;
  onSaveAll: () => void;
  onExportZip: () => void;
}

/**
 * Small-screen command strip for the existing desktop-backed editor.
 * Its buttons delegate to the same Save All, ZIP snapshot and project handlers
 * as desktop, avoiding a second persistence path on Android.
 */
export function MobileWorkspaceBar({
  section, projectName, mapName, dirtyCount, busy, editingEnabled,
  paletteVisible, onShowProjects, onToggleEditing, onTogglePalette,
  onSaveAll, onExportZip,
}: Props) {
  const onMap = section === "maps";
  const onMapList = section === "projects";
  return (
    <div className="app-mobile-workspace-bar" aria-label="Mobile workspace actions">
      <div className="app-mobile-workspace-context">
        <span className="app-mobile-workspace-name" title={onMap ? mapName || projectName : projectName}>
          {onMap ? (mapName || "Select a map") : projectName}
        </span>
        <span className={dirtyCount ? "app-mobile-workspace-dirty" : "app-mobile-workspace-clean"} role="status">
          {dirtyCount ? `${dirtyCount} unsaved` : "Saved"}
        </span>
      </div>
      <div className="app-mobile-workspace-actions" role="group" aria-label="Project and map actions">
        {onMap && (
          <button type="button" onClick={onShowProjects} disabled={busy}
            aria-label="Choose another map">Maps</button>
        )}
        {(onMap || onMapList) && (
          <button type="button" className={editingEnabled ? "is-active" : ""}
            aria-pressed={editingEnabled}
            aria-label={onMapList
              ? (editingEnabled ? "Lock map organisation" : "Enable map organisation")
              : (editingEnabled ? "Switch map to view mode" : "Enable map editing")}
            disabled={busy} onClick={onToggleEditing}>
            {onMapList
              ? (editingEnabled ? "Editing maps" : "Edit maps")
              : (editingEnabled ? "Editing on" : "View only")}
          </button>
        )}
        {onMap && (
          <button type="button" className={paletteVisible ? "is-active" : ""}
            aria-pressed={paletteVisible} aria-label={paletteVisible ? "Hide tile palette" : "Open tile palette"}
            disabled={busy} onClick={onTogglePalette}>Tiles</button>
        )}
        <button type="button" className="app-mobile-workspace-primary"
          aria-label="Save all changes" disabled={busy} onClick={onSaveAll}>
          Save{dirtyCount > 0 ? " •" : ""}
        </button>
        <button type="button" aria-label="Export project ZIP" disabled={busy}
          onClick={onExportZip}>Export</button>
      </div>
    </div>
  );
}
