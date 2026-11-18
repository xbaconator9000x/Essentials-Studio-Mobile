import { useEffect, useRef, useState } from "react";
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
  onStartPainting: () => void;
  onSaveAll: () => void;
  onExportZip: () => void;
}

/**
 * Canvas-first mobile command strip. Save and ZIP always remain one tap away;
 * infrequent map and project-organisation actions expand on demand.
 * Delegates all commands to existing guarded project/map handlers.
 */
export function MobileWorkspaceBar({
  section, projectName, mapName, dirtyCount, busy, editingEnabled,
  paletteVisible, onShowProjects, onToggleEditing, onTogglePalette, onStartPainting,
  onSaveAll, onExportZip,
}: Props) {
  const [expandedSection, setExpandedSection] = useState<MobileWorkspaceSection | null>(null);
  const disclosureRef = useRef<HTMLButtonElement>(null);
  const previousSectionRef = useRef(section);
  const onMap = section === "maps";
  const onProjectList = section === "projects";
  const hasContextTools = onMap || onProjectList;
  const toolsOpen = expandedSection === section;
  // A returned workspace must not inherit a disclosure opened before navigation.
  // Clear the old section synchronously so its tools cannot flash for one render.
  if (previousSectionRef.current !== section) {
    previousSectionRef.current = section;
    if (expandedSection !== null) setExpandedSection(null);
  }
  // Native Save All and export operations must not leave stale editing tools open.
  useEffect(() => {
    if (busy) setExpandedSection(null);
  }, [busy]);
  const closeContextTools = (restoreFocus = false) => {
    setExpandedSection(null);
    if (restoreFocus) disclosureRef.current?.focus();
  };
  const invokeContextAction = (action: () => void) => {
    // Return screen space to the canvas after an explicit contextual command.
    closeContextTools();
    action();
  };
  return (
    <div className="app-mobile-workspace-bar" aria-label="Mobile workspace actions" aria-busy={busy}
      onKeyDown={event => {
        if (event.key === "Escape" && toolsOpen) {
          event.stopPropagation();
          closeContextTools(true);
        }
      }}>
      <div className="app-mobile-workspace-context">
        <div className="app-mobile-workspace-identity">
          <span className="app-mobile-workspace-name" title={onMap ? mapName || projectName : projectName}>
            {onMap ? (mapName || "Select a map") : projectName}
          </span>
          <span role="status" aria-live="off" aria-label={`Toolbar state: ${busy ? "busy" : "idle"}, tools ${toolsOpen ? "open" : "closed"}`}
            style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
            {`Toolbar state: ${busy ? "busy" : "idle"}, tools ${toolsOpen ? "open" : "closed"}`}
          </span>
          <span className={dirtyCount ? "app-mobile-workspace-dirty" : "app-mobile-workspace-clean"}
            role="status" aria-live="polite" aria-atomic="true">
            {dirtyCount ? `${dirtyCount} unsaved` : "Saved"}
          </span>
        </div>
        {hasContextTools && (
          <button ref={disclosureRef} type="button" className="app-mobile-workspace-tools-toggle"
            aria-controls="mobile-workspace-context-tools" aria-expanded={toolsOpen}
            aria-label={toolsOpen ? (onMap ? "Hide map tools" : "Hide project tools")
              : (onMap ? "Show map tools" : "Show project tools")}
            disabled={busy}
            onClick={() => setExpandedSection(current => current === section ? null : section)}>
            {onMap ? "Map tools" : "Organise"} <span aria-hidden="true">{toolsOpen ? "▴" : "▾"}</span>
          </button>
        )}
      </div>
      <div className="app-mobile-workspace-actions" role="group" aria-label="Project save and export">
        <button type="button" className="app-mobile-workspace-primary" aria-label="Save all changes"
          disabled={busy} onClick={onSaveAll}>Save{dirtyCount > 0 ? " •" : ""}</button>
        <button type="button" aria-label="Export project ZIP" disabled={busy}
          onClick={onExportZip}>Export ZIP</button>
      </div>
      {hasContextTools && toolsOpen && (
        <div className="app-mobile-workspace-secondary" id="mobile-workspace-context-tools"
          role="group" aria-label={onMap ? "Map tools" : "Project organisation tools"}>
          {onMap && (
            <button type="button" onClick={() => invokeContextAction(onShowProjects)} disabled={busy}
              aria-label="Choose another map">Choose map</button>
          )}
          <button type="button" className={editingEnabled ? "is-active" : ""}
            aria-pressed={editingEnabled}
            aria-label={onProjectList
              ? (editingEnabled ? "Lock map organisation" : "Enable map organisation")
              : (editingEnabled ? "Switch map to view mode" : "Enable map editing")}
            disabled={busy} onClick={() => invokeContextAction(onToggleEditing)}>
            {onProjectList ? (editingEnabled ? "Editing maps" : "Edit maps")
              : (editingEnabled ? "Editing on" : "View only")}
          </button>
          {onMap && (!editingEnabled || !paletteVisible) && (
            <button type="button" className="app-mobile-workspace-primary"
              aria-label="Start painting tiles" disabled={busy}
              onClick={() => invokeContextAction(onStartPainting)}>Paint tiles</button>
          )}
          {onMap && (
            <button type="button" className={paletteVisible ? "is-active" : ""}
              aria-pressed={paletteVisible} aria-label={paletteVisible ? "Hide tile palette" : "Open tile palette"}
              disabled={busy} onClick={() => invokeContextAction(onTogglePalette)}>Tiles</button>
          )}
        </div>
      )}
    </div>
  );
}
