/**
 * PbsEntityEditor — entity-based PBS editor.
 * Replaces the file-based PbsEditor with a sidebar-navigated shell
 * where each section (Pokémon, Moves, Abilities, Items, Types, Trainers,
 * Encounters, World, Settings) loads/saves its own set of PBS files.
 */
import { useState, useEffect, useCallback } from "react";
import { buildPbsIndex } from "../../services/pbsIndex";
import { useProjectSave } from "../../context/ProjectSaveContext";
import { hasPendingPbsWrite } from "../../services/pbsSaveGuards";
import { PbsEntityContext } from "./PbsEntityContext";
import { PokemonPanel } from "./panels/PokemonPanel";
import { MovesPanel } from "./panels/MovesPanel";
import { AbilitiesPanel } from "./panels/AbilitiesPanel";
import { ItemsPanel } from "./panels/ItemsPanel";
import { TypesPanel } from "./panels/TypesPanel";
import { TrainersPanel } from "./panels/TrainersPanel";
import { EncountersPanel } from "./panels/EncountersPanel";
import { WorldPanel } from "./panels/WorldPanel";
import { SettingsPanel } from "./panels/SettingsPanel";
import type { PbsIndex } from "../../services/pbsIndex";
import "./PbsEntityEditor.css";

interface Props {
  projectPath: string;
  mapNames: Map<number, string>;
  onClose: () => void;
}

type SectionId =
  | "pokemon" | "moves" | "abilities" | "items" | "types"
  | "trainers" | "encounters" | "world" | "settings";

interface NavItem {
  id: SectionId;
  label: string;
  icon: string;
  dirtyPrefix: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: "pokemon",    label: "Pokémon",   icon: "🐾", dirtyPrefix: "pbs-pokemon" },
  { id: "moves",      label: "Moves",     icon: "⚡", dirtyPrefix: "pbs-moves" },
  { id: "abilities",  label: "Abilities", icon: "✨", dirtyPrefix: "pbs-abilities" },
  { id: "items",      label: "Items",     icon: "🎒", dirtyPrefix: "pbs-items" },
  { id: "types",      label: "Types",     icon: "🔷", dirtyPrefix: "pbs-types" },
  { id: "trainers",   label: "Trainers",  icon: "👤", dirtyPrefix: "pbs-trainer" },
  { id: "encounters", label: "Encounters",icon: "🌿", dirtyPrefix: "pbs-encounters" },
  { id: "world",      label: "World",     icon: "🗺",  dirtyPrefix: "pbs-world" },
  { id: "settings",   label: "Settings",  icon: "⚙",  dirtyPrefix: "pbs-settings" },
];

export function PbsEntityEditor({ projectPath, mapNames, onClose }: Props) {
  const [activeSection, setActiveSection] = useState<SectionId>("pokemon");
  const [recordsOpen, setRecordsOpen] = useState(false);
  // Shared PBS lists become an on-demand drawer on phones; specialist
  // sections without EntityListPanel retain their native record controls.
  const hasRecordList = (["pokemon", "moves", "abilities", "items", "encounters", "world"] as SectionId[]).includes(activeSection);
  const switchSection = (id: SectionId) => {
    setRecordsOpen(false);
    setActiveSection(id);
  };
  const [pbsIndex, setPbsIndex] = useState<PbsIndex>(new Map());
  const [saving, setSaving] = useState(false);
  const { dirtyIds, saveAll, discardAll } = useProjectSave();

  const hasDirty = Array.from(dirtyIds).some((id) => id.startsWith("pbs-"));

  // Build cross-reference index on mount
  useEffect(() => {
    buildPbsIndex(projectPath).then(setPbsIndex).catch(() => {});
  }, [projectPath]);

  const handleApply = useCallback(async (): Promise<boolean> => {
    if (hasPendingPbsWrite()) return false;
    setSaving(true);
    try {
      await saveAll("pbs-");
      return true;
    } catch {
      // Save failed — the persistent "Unsaved changes" badge signals it and the
      // dialog stays open so edits aren't lost.
      return false;
    } finally {
      setSaving(false);
    }
  }, [saveAll]);

  // Confirm before discarding unsaved edits, then discard and close.
  const requestClose = useCallback(() => {
    // Global Ctrl+S can start a write without toggling this modal's saving flag.
    if (saving || hasPendingPbsWrite()) {
      window.alert("Wait for the PBS save to finish before closing.");
      return;
    }
    if (hasDirty && !window.confirm("You have unsaved PBS changes. Discard them and close?")) return;
    discardAll("pbs-");
    onClose();
  }, [saving, hasDirty, discardAll, onClose]);

  return (
    <PbsEntityContext.Provider value={{ pbsIndex, projectPath, mapNames }}>
      <div className={`pbs-entity-editor${recordsOpen ? " records-open" : ""}`}>
        {/* Header */}
        <div className="pbs-entity-header">
          <span className="pbs-entity-title">PBS Data Editor</span>
          {hasDirty && <span className="pbs-entity-dirty-badge">Unsaved changes</span>}
          <div className="pbs-mobile-workspace-controls" role="group" aria-label="Mobile PBS navigation">
            <select className="pbs-mobile-category-picker" aria-label="PBS category"
              value={activeSection} onChange={(event) => switchSection(event.target.value as SectionId)}>
              {NAV_ITEMS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
            {hasRecordList && (
              <button type="button" className="pbs-mobile-records-toggle"
                aria-label={recordsOpen ? "Close record picker" : "Browse PBS records"}
                aria-expanded={recordsOpen} aria-controls="pbs-mobile-record-list"
                onClick={() => setRecordsOpen(open => !open)}>
                {recordsOpen ? "Close list" : "Records"}
              </button>
            )}
          </div>
          <button className="pbs-entity-close" aria-label="Close PBS editor" onClick={requestClose} disabled={saving}>×</button>
        </div>

        <div className="pbs-entity-body">
          {/* Sidebar navigation */}
          <nav className="pbs-entity-sidebar">
            {NAV_ITEMS.map((item) => {
              const isActive = activeSection === item.id;
              const isDirty = Array.from(dirtyIds).some((id) => id.startsWith(item.dirtyPrefix));
              return (
                <button
                  key={item.id}
                  className={`pbs-entity-nav-item${isActive ? " active" : ""}`}
                  onClick={() => switchSection(item.id)}
                >
                  <span className="pbs-entity-nav-icon">{item.icon}</span>
                  <span className="pbs-entity-nav-label">{item.label}</span>
                  {isDirty && <span className="pbs-entity-nav-dirty" />}
                </button>
              );
            })}
          </nav>

          {/* Section panels — all always mounted, toggled via display:none */}
          <div className="pbs-entity-panels" id="pbs-mobile-record-list"
            onClickCapture={(event) => {
              const target = event.target as HTMLElement;
              if (recordsOpen && target.closest(".pbs-entity-list [role='option']") &&
                  !target.closest("button")) setRecordsOpen(false);
            }}
            onKeyDownCapture={(event) => {
              if (recordsOpen && (event.key === "Enter" || event.key === " ") &&
                  (event.target as HTMLElement).closest(".pbs-entity-list [role='option']")) {
                setRecordsOpen(false);
              }
            }}>
            <div style={{ display: activeSection === "pokemon"    ? "contents" : "none" }}><PokemonPanel /></div>
            <div style={{ display: activeSection === "moves"      ? "contents" : "none" }}><MovesPanel /></div>
            <div style={{ display: activeSection === "abilities"  ? "contents" : "none" }}><AbilitiesPanel /></div>
            <div style={{ display: activeSection === "items"      ? "contents" : "none" }}><ItemsPanel /></div>
            <div style={{ display: activeSection === "types"      ? "contents" : "none" }}><TypesPanel /></div>
            <div style={{ display: activeSection === "trainers"   ? "contents" : "none" }}><TrainersPanel /></div>
            <div style={{ display: activeSection === "encounters" ? "contents" : "none" }}><EncountersPanel /></div>
            <div style={{ display: activeSection === "world"      ? "contents" : "none" }}><WorldPanel /></div>
            <div style={{ display: activeSection === "settings"   ? "contents" : "none" }}><SettingsPanel /></div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="pbs-entity-bottom-bar">
          <button
            className="pbs-btn pbs-btn-primary"
            onClick={async () => { if (await handleApply()) onClose(); }}
            disabled={saving}
          >
            OK
          </button>
          <button
            className="pbs-btn"
            onClick={requestClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            className="pbs-btn pbs-btn-primary"
            onClick={handleApply}
            disabled={!hasDirty || saving}
          >
            {saving ? "Saving..." : "Apply"}
          </button>
        </div>
      </div>
    </PbsEntityContext.Provider>
  );
}
