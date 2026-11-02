import { useCallback, useEffect, useRef, useState } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import type {
  RpgEvent,
  EventPage,
  EventCommand,
} from "../../types";
import {
  type CommandDef,
} from "../../services/eventCommands";
import { loadEvent, saveEvent, loadSystemData } from "../../services/tauriApi";
import { useUndoable } from "../../hooks/useUndoable";
import { saveEventSnapshot } from "../../services/eventSaveGuards";
import { EventCommandPicker } from "./EventCommandPicker";
import type { PbsIndex } from "../../services/pbsIndex";
import { PageProperties } from "./parts/PageProperties";
import { CommandRow, MultiLineBlock } from "./parts/CommandRow";
import { PARENT_CONT, getBlockEnd, getDefaultParams, toVisualBlocks } from "./parts/commandHelpers";
import "./EventEditor.css";

interface Props {
  projectPath: string;
  mapId: number;
  eventId: number;
  /** Initial event name from EventInfo (shown before full data loads) */
  eventName: string;
  onClose: () => void;
  mapInfos?: Record<number, import("../../types").MapInfo>;
  pbsIndex?: PbsIndex;
}

export function EventEditor({
  projectPath,
  mapId,
  eventId,
  eventName,
  onClose,
  mapInfos,
  pbsIndex,
}: Props) {
  const { value: event, set: setEvent, setWithoutHistory, resetHistory, undo, redo, canUndo, canRedo } = useUndoable<RpgEvent>(null);
  const [activePage, setActivePage] = useState(0);
  const [selectedCommand, setSelectedCommand] = useState(-1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [editingCommand, setEditingCommand] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const revisionRef = useRef(0);
  // A render can lag behind a just-queued React edit. Never save an older
  // event object under the revision of that not-yet-rendered edit.
  const renderRevision = revisionRef.current;
  const [clipboard, setClipboard] = useState<EventCommand[] | null>(null);
  const [switchNames, setSwitchNames] = useState<string[]>([]);
  const [variableNames, setVariableNames] = useState<string[]>([]);

  // Load switch/variable names from System.rxdata
  useEffect(() => {
    let cancelled = false;
    loadSystemData(projectPath).then((sys) => {
      if (!cancelled) {
        setSwitchNames(sys.switches ?? []);
        setVariableNames(sys.variables ?? []);
      }
    }).catch(() => { /* ignore - names just won't show */ });
    return () => { cancelled = true; };
  }, [projectPath]);

  // Load full event data
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await loadEvent(projectPath, mapId, eventId);
        if (!cancelled) {
          setWithoutHistory(data);
          resetHistory();
          setActivePage(0);
          setSelectedCommand(-1);
          revisionRef.current = 0;
          setDirty(false);
          setSaveError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [projectPath, mapId, eventId, setWithoutHistory, resetHistory]);

  const page: EventPage | null =
    event && event.pages[activePage] ? event.pages[activePage] : null;

  // --- Editing functions ---

  const updatePage = useCallback(
    (updater: (page: EventPage) => EventPage) => {
      if (!event) return;
      revisionRef.current += 1;
      setSaveError(null);
      setEvent((prev) => {
        if (!prev) return prev;
        const pages = [...prev.pages];
        pages[activePage] = updater(pages[activePage]);
        return { ...prev, pages };
      });
      setDirty(true);
    },
    [event, activePage]
  );

  const handleInsertCommand = useCallback(
    (def: CommandDef) => {
      if (!page) return;
      const newCmd: EventCommand = {
        code: def.code,
        indent: selectedCommand >= 0 ? page.list[selectedCommand]?.indent ?? 0 : 0,
        parameters: def.defaultParams ?? getDefaultParams(def.code),
      };

      // Insert after the entire block (past any continuations)
      const insertAt = selectedCommand >= 0
        ? getBlockEnd(page.list, selectedCommand) + 1
        : page.list.length - 1;
      updatePage((p) => {
        const list = [...p.list];
        list.splice(insertAt, 0, newCmd);
        return { ...p, list };
      });
      setSelectedCommand(insertAt);
      setShowPicker(false);
    },
    [page, selectedCommand, updatePage]
  );

  const handleDeleteCommand = useCallback(
    (index: number) => {
      if (!page) return;
      const cmd = page.list[index];
      if (cmd.code === 0) return;

      // Delete the entire block (parent + all continuations)
      const blockEnd = getBlockEnd(page.list, index);
      const deleteCount = blockEnd - index + 1;
      updatePage((p) => {
        const list = [...p.list];
        list.splice(index, deleteCount);
        return { ...p, list };
      });
      setSelectedCommand(Math.max(0, index - 1));
    },
    [page, updatePage]
  );

  const handleUpdateCommandParam = useCallback(
    (index: number, paramIndex: number, value: unknown) => {
      updatePage((p) => {
        const list = [...p.list];
        const cmd = { ...list[index], parameters: [...list[index].parameters] };
        cmd.parameters[paramIndex] = value;
        list[index] = cmd;
        return { ...p, list };
      });
    },
    [updatePage]
  );

  // A native save is an acknowledgement of one immutable event revision,
  // not of later page/command edits made while the write is pending.
  const persist = useCallback(async (closeOnSuccess: boolean) => {
    if (savingRef.current || !event) return;
    if (revisionRef.current !== renderRevision) {
      setDirty(true);
      setSaveError("An event edit is still updating. Save again once it appears.");
      return;
    }
    if (!dirty) {
      if (closeOnSuccess) onClose();
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      const current = await saveEventSnapshot(
        event, renderRevision, () => revisionRef.current,
        (snapshot) => saveEvent(projectPath, mapId, snapshot),
      );
      if (current) {
        setDirty(false);
        if (closeOnSuccess) onClose();
      } else {
        setDirty(true);
        setSaveError("Newer event edits remain unsaved. Save again before closing.");
      }
    } catch (err) {
      setDirty(true);
      setSaveError(`Save failed: ${String(err)}`);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [event, dirty, renderRevision, projectPath, mapId, onClose]);

  const handleOk = useCallback(() => { void persist(true); }, [persist]);
  const handleSave = useCallback(() => { void persist(false); }, [persist]);

  // Do not discard/close while the native event write is still pending.
  const handleCancel = useCallback(async () => {
    if (savingRef.current) return;
    if (revisionRef.current !== renderRevision) {
      setDirty(true);
      setSaveError("An event edit is still updating. Try closing again.");
      return;
    }
    const cancelRevision = revisionRef.current;
    if (dirty && !(await confirm("Discard changes to this event?"))) return;
    if (savingRef.current || revisionRef.current !== cancelRevision) return;
    onClose();
  }, [dirty, onClose, renderRevision]);

  // Close on Escape, Delete key
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && savingRef.current) {
        e.preventDefault();
        return;
      }
      if (e.key === "Escape") {
        if (showPicker) {
          setShowPicker(false);
        } else if (editingCommand !== null) {
          setEditingCommand(null);
        } else {
          handleCancel();
        }
      }
      if (e.key === "Delete" && selectedCommand >= 0 && event && !showPicker && editingCommand === null) {
        handleDeleteCommand(selectedCommand);
      }
      if (e.key === "Insert" && !showPicker && editingCommand === null) {
        setShowPicker(true);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
      // Copy command
      if ((e.ctrlKey || e.metaKey) && e.key === "c" && selectedCommand >= 0 && page && editingCommand === null) {
        const cmd = page.list[selectedCommand];
        if (cmd && cmd.code !== 0) {
          setClipboard([{ ...cmd, parameters: [...cmd.parameters] }]);
        }
      }
      // Paste command
      if ((e.ctrlKey || e.metaKey) && e.key === "v" && clipboard && clipboard.length > 0 && page && editingCommand === null) {
        e.preventDefault();
        const insertAt = selectedCommand >= 0 ? selectedCommand + 1 : page.list.length - 1;
        updatePage((p) => {
          const list = [...p.list];
          list.splice(insertAt, 0, ...clipboard.map((c) => ({ ...c, parameters: [...c.parameters] })));
          return { ...p, list };
        });
        setSelectedCommand(insertAt);
      }
      // Duplicate command (Ctrl+D)
      if ((e.ctrlKey || e.metaKey) && e.key === "d" && selectedCommand >= 0 && page && editingCommand === null) {
        e.preventDefault();
        const cmd = page.list[selectedCommand];
        if (cmd && cmd.code !== 0) {
          updatePage((p) => {
            const list = [...p.list];
            list.splice(selectedCommand + 1, 0, { ...cmd, parameters: [...cmd.parameters] });
            return { ...p, list };
          });
          setSelectedCommand(selectedCommand + 1);
        }
      }
      // Undo (Ctrl+Z)
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey && editingCommand === null) {
        e.preventDefault();
        revisionRef.current += 1;
        setSaveError(null);
        undo();
        setDirty(true);
      }
      // Redo (Ctrl+Y or Ctrl+Shift+Z)
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey)) && editingCommand === null) {
        e.preventDefault();
        revisionRef.current += 1;
        setSaveError(null);
        redo();
        setDirty(true);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [handleCancel, showPicker, editingCommand, selectedCommand, event, page, clipboard, handleDeleteCommand, handleSave, updatePage, undo, redo]);

  // Click outside to close (respects dirty guard via handleCancel)
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).classList.contains("event-editor-overlay")) {
        handleCancel();
      }
    },
    [handleCancel]
  );

  return (
    <div className="event-editor-overlay" onClick={handleOverlayClick}>
      <div className="event-editor">
        {/* Header */}
        <div className="event-editor-header">
          <div>
            <h3>
              Event [{String(eventId).padStart(3, "0")}] {event?.name ?? eventName}
              {dirty && <span style={{ color: "#df8e1d", marginLeft: 8 }}>*</span>}
            </h3>
            <span className="event-editor-header-info">
              Map [{String(mapId).padStart(3, "0")}] · Position ({event?.x ?? "?"},{" "}
              {event?.y ?? "?"})
            </span>
          </div>
          <button className="event-editor-close" onClick={handleCancel} disabled={saving}>
            ×
          </button>
        </div>

        {saveError && <div role="alert" style={{ color: "#d20f39", padding: "6px 12px" }}>{saveError}</div>}

        {/* Page tabs */}
        {event && (
          <div className="event-editor-pages">
            {event.pages.map((_p, i) => (
              <button
                key={i}
                className={`event-page-tab ${activePage === i ? "active" : ""}`}
                onClick={() => {
                  setActivePage(i);
                  setSelectedCommand(-1);
                  setEditingCommand(null);
                }}
              >
                Page {i + 1}
              </button>
            ))}
            <button
              className="event-page-tab event-page-tab-add"
              onClick={() => {
                if (!event) return;
                const newPage: EventPage = {
                  condition: { switch1_valid: false, switch2_valid: false, variable_valid: false, self_switch_valid: false, switch1_id: 1, switch2_id: 1, variable_id: 1, variable_value: 0, self_switch_ch: "A" },
                  graphic: { tile_id: 0, character_name: "", character_hue: 0, direction: 2, pattern: 0, opacity: 255, blend_type: 0 },
                  move_type: 0, move_speed: 3, move_frequency: 3,
                  move_route: { repeat: true, skippable: false, list: [{ code: 0, parameters: [] }] },
                  walk_anime: true, step_anime: false, direction_fix: false, through: false, always_on_top: false,
                  trigger: 0,
                  list: [{ code: 0, indent: 0, parameters: [] }],
                };
                setEvent({ ...event, pages: [...event.pages, newPage] });
                setActivePage(event.pages.length);
                setSelectedCommand(-1);
                revisionRef.current += 1;
                setSaveError(null);
                setDirty(true);
              }}
              title="Add a new page"
            >
              +
            </button>
            {event.pages.length > 1 && (
              <button
                className="event-page-tab event-page-tab-remove"
                onClick={() => {
                  if (!event || event.pages.length <= 1) return;
                  const pages = event.pages.filter((_, i) => i !== activePage);
                  setEvent({ ...event, pages });
                  setActivePage(Math.min(activePage, pages.length - 1));
                  setSelectedCommand(-1);
                  revisionRef.current += 1;
                  setSaveError(null);
                  setDirty(true);
                }}
                title="Remove current page"
              >
                −
              </button>
            )}
          </div>
        )}

        {/* Body */}
        <div className="event-editor-body">
          {loading ? (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#8c8fa1" }}>
              Loading event data...
            </div>
          ) : error ? (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#d20f39" }}>
              {error}
            </div>
          ) : page ? (
            <>
              {/* Left: Page properties */}
              <div className="event-page-properties">
                <PageProperties page={page} onUpdatePage={updatePage} projectPath={projectPath} switchNames={switchNames} variableNames={variableNames} />
              </div>

              {/* Right: Command list */}
              <div className="event-command-panel">
                <div className="event-command-panel-header">
                  <span className="event-command-panel-title">
                    Event Commands ({page.list.length})
                  </span>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button
                      className="event-editor-btn"
                      style={{ padding: "3px 10px", fontSize: 11 }}
                      onClick={() => setShowPicker(true)}
                      title="Insert a new command (Ins)"
                    >
                      + Insert
                    </button>
                    <button
                      className="event-editor-btn"
                      style={{ padding: "3px 10px", fontSize: 11 }}
                      onClick={() => {
                        if (selectedCommand >= 0) handleDeleteCommand(selectedCommand);
                      }}
                      disabled={selectedCommand < 0 || page.list[selectedCommand]?.code === 0}
                      title="Delete selected command (Del)"
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <div className="event-command-list">
                  {toVisualBlocks(page.list).map((block) => {
                    if (block.kind === "multi") {
                      return (
                        <MultiLineBlock
                          key={block.rawIndex}
                          block={block}
                          selected={selectedCommand === block.rawIndex}
                          editing={editingCommand === block.rawIndex}
                          onSelect={() => setSelectedCommand(block.rawIndex)}
                          onStartEdit={() => setEditingCommand(block.rawIndex)}
                          onUpdateLines={(lines) => {
                            const contCode = PARENT_CONT[block.cmd.code]!;
                            updatePage((p) => {
                              const list = [...p.list];
                              const newCmds: EventCommand[] = lines.map((text, idx) => ({
                                code: idx === 0 ? block.cmd.code : contCode,
                                indent: block.cmd.indent,
                                parameters: [text],
                              }));
                              list.splice(block.rawIndex, 1 + block.contIndices.length, ...newCmds);
                              return { ...p, list };
                            });
                            setDirty(true);
                          }}
                          onStopEditing={() => setEditingCommand(null)}
                        />
                      );
                    }
                    const { rawIndex: i, cmd } = block;
                    return (
                      <CommandRow
                        key={i}
                        command={cmd}
                        index={i}
                        selected={selectedCommand === i}
                        editing={editingCommand === i}
                        onClick={() => setSelectedCommand(i)}
                        onDoubleClick={() => { if (cmd.code !== 0) setEditingCommand(i); }}
                        onParamChange={(paramIdx, value) => handleUpdateCommandParam(i, paramIdx, value)}
                        onStopEditing={() => setEditingCommand(null)}
                        mapInfos={mapInfos}
                        switchNames={switchNames}
                        variableNames={variableNames}
                        pbsIndex={pbsIndex}
                      />
                    );
                  })}
                </div>
              </div>
            </>
          ) : (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#8c8fa1" }}>
              No pages defined
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="event-editor-footer">
          <span style={{ fontSize: 10, color: "#8c8fa1" }}>
            Dbl-click edit · Del/Ins · Ctrl+Z undo · Ctrl+Y redo · Ctrl+S save
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="event-editor-btn"
              onClick={() => { revisionRef.current += 1; setSaveError(null); undo(); setDirty(true); }}
              disabled={!canUndo}
              title="Undo (Ctrl+Z)"
              style={{ padding: "6px 10px" }}
            >
              ↩
            </button>
            <button
              className="event-editor-btn"
              onClick={() => { revisionRef.current += 1; setSaveError(null); redo(); setDirty(true); }}
              disabled={!canRedo}
              title="Redo (Ctrl+Y)"
              style={{ padding: "6px 10px" }}
            >
              ↪
            </button>
            <button
              className="event-editor-btn event-editor-btn-primary"
              onClick={handleOk}
              disabled={saving}
            >
              {saving ? "Saving..." : "OK"}
            </button>
            <button className="event-editor-btn" onClick={handleCancel} disabled={saving}>
              Cancel
            </button>
          </div>
        </div>
      </div>

      {/* Command Picker Dialog */}
      {showPicker && (
        <EventCommandPicker
          onSelect={handleInsertCommand}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  );
}
