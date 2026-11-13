import { useCallback, useEffect, useRef, useState } from "react";
import { confirmEditor } from "../../services/editorDialog";
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
import { updateEventCommandParam } from "../../services/eventEditorMutation";
import { useEditorRegistration, useProjectSave } from "../../context/ProjectSaveContext";
import { replaceMultiLineBlock } from "../../services/eventMultiLineEdit";
import { EventCommandPicker } from "./EventCommandPicker";
import type { PbsIndex } from "../../services/pbsIndex";
import { PageProperties } from "./parts/PageProperties";
import { CommandRow, MultiLineBlock } from "./parts/CommandRow";
import {
  PARENT_CONT,
  canMoveCommandBlock,
  cloneCommandBlock,
  getBlockEnd,
  getCommandBlockRange,
  getCommandInsertionIndex,
  getDefaultParams,
  moveCommandBlock,
  toVisualBlocks,
} from "./parts/commandHelpers";
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
  const { saveAll: saveProjectAll, unregister: unregisterSavedEvent } = useProjectSave();
  const [activePage, setActivePage] = useState(0);
  const [selectedCommand, setSelectedCommand] = useState(-1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [editingCommand, setEditingCommand] = useState<number | null>(null);
  const [mobilePanel, setMobilePanel] = useState<"commands" | "properties">("commands");
  const [propertiesCollapsed, setPropertiesCollapsed] = useState(
    () => typeof window !== "undefined" && window.innerWidth <= 700
  );
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingAll, setSavingAll] = useState(false);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const savingAllRef = useRef(false);
  const revisionRef = useRef(0);
  const activeInlineDraftCommitRef = useRef<(() => void) | null>(null);
  const inlineDraftActiveRef = useRef(false);
  const dirtyBeforeInlineDraftRef = useRef(false);
  const pageActionPendingRef = useRef(false);
  const persistRef = useRef<(closeOnSuccess: boolean, propagateErrors?: boolean) => Promise<void>>(
    async () => {},
  );
  const registerActiveInlineDraftCommit = useCallback((commit: (() => void) | null) => {
    activeInlineDraftCommitRef.current = commit;
  }, []);
  const commitActiveInlineDraft = useCallback(async () => {
    const commit = activeInlineDraftCommitRef.current;
    if (!commit) return;
    commit();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }, []);
  const commitDraftBeforeAction = useCallback((action: () => void) => {
    if (pageActionPendingRef.current) return;
    if (!activeInlineDraftCommitRef.current) {
      action();
      return;
    }
    pageActionPendingRef.current = true;
    void commitActiveInlineDraft()
      .then(action)
      .catch((cause) => setSaveError(`Could not commit the active edit: ${String(cause)}`))
      .finally(() => { pageActionPendingRef.current = false; });
  }, [commitActiveInlineDraft]);
  const switchEventPage = useCallback((pageIndex: number) => {
    commitDraftBeforeAction(() => {
      setActivePage(pageIndex);
      setSelectedCommand(-1);
      setEditingCommand(null);
    });
  }, [commitDraftBeforeAction]);
  const startCommandEdit = useCallback((index: number) => {
    commitDraftBeforeAction(() => setEditingCommand(index));
  }, [commitDraftBeforeAction]);
  const openCommandPicker = useCallback(() => {
    commitDraftBeforeAction(() => setShowPicker(true));
  }, [commitDraftBeforeAction]);
  const handleInlineDraftChange = useCallback(() => {
    if (!inlineDraftActiveRef.current) {
      dirtyBeforeInlineDraftRef.current = dirty;
      inlineDraftActiveRef.current = true;
    }
    setDirty(true);
    setSaveNotice(null);
    setSaveError(null);
  }, [dirty]);
  const handleInlineDraftCommit = useCallback(() => {
    inlineDraftActiveRef.current = false;
  }, []);
  const handleInlineDraftCancel = useCallback(() => {
    if (!inlineDraftActiveRef.current) return;
    inlineDraftActiveRef.current = false;
    setDirty(dirtyBeforeInlineDraftRef.current);
  }, []);
  // A render can lag behind a just-queued React edit. Never save an older
  // event object under the revision of that not-yet-rendered edit.
  const renderRevision = revisionRef.current;
  const eventRef = useRef(event);
  eventRef.current = event;
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
          setSaveNotice(null);
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
      setSaveNotice(null);
      setSaveError(null);
      setEvent((prev) => {
        if (!prev) return prev;
        const pages = [...prev.pages];
        pages[activePage] = updater(pages[activePage]);
        return { ...prev, pages };
      });
      setDirty(true);
    },
    [event, activePage, setEvent]
  );

  const copySelectedCommand = useCallback(() => {
    if (!page || selectedCommand < 0) return;
    const block = cloneCommandBlock(page.list, selectedCommand);
    if (block.length > 0) setClipboard(block);
  }, [page, selectedCommand]);

  const pasteCommand = useCallback(() => {
    if (!page || !clipboard?.length) return;
    const insertAt = getCommandInsertionIndex(page.list, selectedCommand);
    updatePage((p) => {
      const list = [...p.list];
      list.splice(insertAt, 0, ...structuredClone(clipboard));
      return { ...p, list };
    });
    setSelectedCommand(insertAt);
  }, [page, selectedCommand, clipboard, updatePage]);

  const duplicateSelectedCommand = useCallback(() => {
    if (!page || selectedCommand < 0) return;
    const block = cloneCommandBlock(page.list, selectedCommand);
    if (block.length === 0) return;
    const range = getCommandBlockRange(page.list, selectedCommand);
    if (!range) return;
    const insertAt = getCommandInsertionIndex(page.list, range.end);
    updatePage((p) => {
      const list = [...p.list];
      list.splice(insertAt, 0, ...block);
      return { ...p, list };
    });
    setSelectedCommand(insertAt);
  }, [page, selectedCommand, updatePage]);

  const moveSelectedCommand = useCallback((direction: "up" | "down") => {
    if (!page || selectedCommand < 0) return;
    const moved = moveCommandBlock(page.list, selectedCommand, direction);
    if (!moved) return;
    updatePage((p) => ({ ...p, list: moved.list }));
    setSelectedCommand(moved.selectedIndex);
  }, [page, selectedCommand, updatePage]);

  const handleInsertCommand = useCallback(
    (def: CommandDef) => {
      if (!page) return;
      const newCmd: EventCommand = {
        code: def.code,
        indent: selectedCommand >= 0 ? page.list[selectedCommand]?.indent ?? 0 : 0,
        parameters: def.defaultParams ?? getDefaultParams(def.code),
      };

      // Insert after the entire block (past any continuations)
      const insertAt = getCommandInsertionIndex(page.list, selectedCommand);
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
      updatePage((p) => updateEventCommandParam(p, index, paramIndex, value));
    },
    [updatePage]
  );

  // A native save is an acknowledgement of one immutable event revision,
  // not of later page/command edits made while the write is pending.
  const persist = useCallback(async (closeOnSuccess: boolean, propagateErrors = false) => {
    if (savingRef.current) {
      console.info("[event-save] rejected: write already in progress", { eventId, mapId });
      if (propagateErrors) throw new Error("Event save already in progress");
      return;
    }
    if (!event) {
      console.info("[event-save] rejected: event data not loaded", { eventId, mapId, dirty });
      if (propagateErrors && dirty) throw new Error("Event data is not loaded");
      return;
    }
    if (revisionRef.current !== renderRevision) {
      console.info("[event-save] rejected: render revision pending", {
        eventId, mapId, revision: revisionRef.current, renderRevision,
      });
      setDirty(true);
      setSaveError("An event edit is still updating. Save again once it appears.");
      if (propagateErrors) throw new Error("Event edit is still updating; save cancelled");
      return;
    }
    if (!dirty) {
      console.info("[event-save] no dirty edits", { eventId, mapId, closeOnSuccess });
      if (closeOnSuccess) {
        console.info("[event-save] requesting close without write", { eventId, mapId });
        onClose();
      }
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    console.info("[event-save] native write started", {
      eventId, mapId, revision: renderRevision, closeOnSuccess,
    });
    try {
      const current = await saveEventSnapshot(
        event, renderRevision, () => revisionRef.current,
        (snapshot) => saveEvent(projectPath, mapId, snapshot),
      );
      if (current) {
        console.info("[event-save] native write completed", { eventId, mapId, revision: renderRevision });
        setDirty(false);
        if (closeOnSuccess) {
          console.info("[event-save] requesting close after write", { eventId, mapId });
          onClose();
        }
      } else {
        console.info("[event-save] write completed but newer edits remain", { eventId, mapId });
        setDirty(true);
        setSaveError("Newer event edits remain unsaved. Save again before closing.");
        if (propagateErrors) throw new Error("Newer event edits remain unsaved");
      }
    } catch (err) {
      console.error("[event-save] native write failed", {
        eventId, mapId, errorType: err instanceof Error ? err.name : typeof err,
      });
      setDirty(true);
      setSaveError(`Save failed: ${String(err)}`);
      if (propagateErrors) throw err;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [event, dirty, renderRevision, projectPath, mapId, eventId, onClose, unregisterSavedEvent]);
  persistRef.current = persist;

  // Include open event dialogs in Save All, project switching and ZIP export.
  // Unlike a button save, a global save must propagate failures to its caller.
  const saveForProject = useCallback(async () => {
    await commitActiveInlineDraft();
    await persistRef.current(false, true);
  }, [commitActiveInlineDraft]);
  const handleSaveAll = useCallback(async () => {
    if (savingAllRef.current) return;
    savingAllRef.current = true;
    setSavingAll(true);
    setSaveNotice(null);
    setSaveError(null);
    try {
      await commitActiveInlineDraft();
      await saveProjectAll();
      setSaveNotice("All registered editor changes were saved.");
    } catch (cause) {
      setSaveError(`Save All failed: ${String(cause)}`);
    } finally {
      savingAllRef.current = false;
      setSavingAll(false);
    }
  }, [commitActiveInlineDraft, saveProjectAll]);
  const discardForProject = useCallback(() => {
    if (!savingRef.current) onClose();
  }, [onClose]);
  useEditorRegistration(`event-${projectPath}-${mapId}-${eventId}`, saveForProject, discardForProject, dirty);

  const handleOk = useCallback(async () => {
    console.info("[event-save] OK activated", { eventId, mapId });
    await commitActiveInlineDraft();
    await persistRef.current(true);
  }, [commitActiveInlineDraft, eventId, mapId]);
  const handleSave = useCallback(async () => {
    await commitActiveInlineDraft();
    await persistRef.current(false);
  }, [commitActiveInlineDraft]);
  const handleAddEventPage = useCallback(() => {
    commitDraftBeforeAction(() => {
      const current = eventRef.current;
      if (!current) return;
      const newPage: EventPage = {
        condition: { switch1_valid: false, switch2_valid: false, variable_valid: false, self_switch_valid: false, switch1_id: 1, switch2_id: 1, variable_id: 1, variable_value: 0, self_switch_ch: "A" },
        graphic: { tile_id: 0, character_name: "", character_hue: 0, direction: 2, pattern: 0, opacity: 255, blend_type: 0 },
        move_type: 0, move_speed: 3, move_frequency: 3,
        move_route: { repeat: true, skippable: false, list: [{ code: 0, parameters: [] }] },
        walk_anime: true, step_anime: false, direction_fix: false, through: false, always_on_top: false,
        trigger: 0,
        list: [{ code: 0, indent: 0, parameters: [] }],
      };
      setEvent((previous) => previous
        ? { ...previous, pages: [...previous.pages, newPage] }
        : previous);
      setActivePage(current.pages.length);
      setSelectedCommand(-1);
      revisionRef.current += 1;
      setSaveNotice(null);
      setSaveError(null);
      setDirty(true);
    });
  }, [commitDraftBeforeAction, setEvent]);
  const handleRemoveEventPage = useCallback(() => {
    commitDraftBeforeAction(() => {
      const current = eventRef.current;
      if (!current || current.pages.length <= 1) return;
      setEvent((previous) => {
        if (!previous || previous.pages.length <= 1) return previous;
        const pages = previous.pages.filter((_, index) => index !== activePage);
        return { ...previous, pages };
      });
      setActivePage(Math.min(activePage, current.pages.length - 2));
      setSelectedCommand(-1);
      revisionRef.current += 1;
      setSaveNotice(null);
      setSaveError(null);
      setDirty(true);
    });
  }, [activePage, commitDraftBeforeAction, setEvent]);

  // Do not discard/close while the native event write is still pending.
  const handleCancel = useCallback(async () => {
    if (savingRef.current) return;
    if (revisionRef.current !== renderRevision) {
      setDirty(true);
      setSaveError("An event edit is still updating. Try closing again.");
      return;
    }
    const cancelRevision = revisionRef.current;
    if ((dirty || inlineDraftActiveRef.current) &&
        !(await confirmEditor("Discard changes to this event?"))) return;
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
        return;
      }
      const target = e.target;
      if (showPicker) {
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void handleSave();
        return;
      }
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.closest("input, textarea, select, [contenteditable='true']") !== null)
      ) return;
      if (e.key === "Delete" && selectedCommand >= 0 && event && !showPicker && editingCommand === null) {
        handleDeleteCommand(selectedCommand);
      }
      if (e.key === "Insert" && !showPicker && editingCommand === null) {
        openCommandPicker();
      }
      // Copy command
      if ((e.ctrlKey || e.metaKey) && e.key === "c" && selectedCommand >= 0 && page && editingCommand === null) {
        copySelectedCommand();
      }
      // Paste command
      if ((e.ctrlKey || e.metaKey) && e.key === "v" && clipboard && clipboard.length > 0 && page && editingCommand === null) {
        e.preventDefault();
        pasteCommand();
      }
      // Duplicate command (Ctrl+D)
      if ((e.ctrlKey || e.metaKey) && e.key === "d" && selectedCommand >= 0 && page && editingCommand === null) {
        e.preventDefault();
        duplicateSelectedCommand();
      }
      // Undo (Ctrl+Z)
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey && editingCommand === null) {
        e.preventDefault();
        revisionRef.current += 1;
        setSaveNotice(null);
        setSaveError(null);
        undo();
        setDirty(true);
      }
      // Redo (Ctrl+Y or Ctrl+Shift+Z)
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey)) && editingCommand === null) {
        e.preventDefault();
        revisionRef.current += 1;
        setSaveNotice(null);
        setSaveError(null);
        redo();
        setDirty(true);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [handleCancel, showPicker, editingCommand, selectedCommand, event, page, clipboard, handleDeleteCommand, handleSave, copySelectedCommand, pasteCommand, duplicateSelectedCommand, openCommandPicker, undo, redo]);

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
        {saveNotice && <div role="status" style={{ color: "#27864a", padding: "6px 12px" }}>{saveNotice}</div>}

        {/* Page tabs */}
        {event && (
          <div className="event-editor-pages">
            {event.pages.map((_p, i) => (
              <button
                key={i}
                className={`event-page-tab ${activePage === i ? "active" : ""}`}
                type="button"
                aria-label={`Event page ${i + 1}`}
                aria-pressed={activePage === i}
                onClick={() => void switchEventPage(i)}
              >
                Page {i + 1}
              </button>
            ))}
            <button
              className="event-page-tab event-page-tab-add"
              type="button"
              onClick={handleAddEventPage}
              aria-label="Add event page"
              title="Add a new page"
            >
              +
            </button>
            {event.pages.length > 1 && (
              <button
                className="event-page-tab event-page-tab-remove"
                type="button"
                onClick={handleRemoveEventPage}
                aria-label="Remove event page"
                title="Remove current page"
              >
                −
              </button>
            )}
          </div>
        )}

        <div className="event-editor-mobile-tabs" role="group" aria-label="Event editing workspace">
          <button type="button" className={mobilePanel === "commands" ? "active" : ""}
            aria-pressed={mobilePanel === "commands"} onClick={() => setMobilePanel("commands")}>Commands</button>
          <button type="button" className={mobilePanel === "properties" ? "active" : ""}
            aria-pressed={mobilePanel === "properties"} onClick={() => {
              setMobilePanel("properties");
              setPropertiesCollapsed(false);
            }}>Page properties</button>
        </div>
        {/* Body */}
        <div className={`event-editor-body event-editor-body--${mobilePanel}`}>
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
              <div className={`event-page-properties${propertiesCollapsed ? " is-collapsed" : ""}`}>
                <button
                  type="button"
                  className="event-page-properties-toggle"
                  aria-expanded={!propertiesCollapsed}
                  aria-controls="event-page-properties-content"
                  onClick={() => setPropertiesCollapsed((collapsed) => !collapsed)}
                >
                  {propertiesCollapsed ? "Show event properties" : "Hide event properties"}
                </button>
                <div id="event-page-properties-content" className="event-page-properties-content" hidden={propertiesCollapsed}>
                  <PageProperties page={page} onUpdatePage={updatePage} projectPath={projectPath} switchNames={switchNames} variableNames={variableNames} />
                </div>
              </div>

              {/* Right: Command list */}
              <div className="event-command-panel">
                <div className="event-command-panel-header">
                  <span className="event-command-panel-title">
                    Event Commands ({page.list.length})
                  </span>
                  <div className="event-command-actions">
                    <button
                      className="event-editor-btn event-command-action"
                      onClick={openCommandPicker}
                      title="Insert a new command (Ins)"
                    >
                      + Insert
                    </button>
                    <button
                      className="event-editor-btn event-command-action"
                      onClick={copySelectedCommand}
                      disabled={selectedCommand < 0 || page.list[selectedCommand]?.code === 0}
                      aria-label="Copy selected command block"
                    >
                      Copy
                    </button>
                    <button
                      className="event-editor-btn event-command-action"
                      onClick={pasteCommand}
                      disabled={!clipboard?.length}
                      aria-label="Paste command block"
                    >
                      Paste
                    </button>
                    <button
                      className="event-editor-btn event-command-action"
                      onClick={duplicateSelectedCommand}
                      disabled={selectedCommand < 0 || page.list[selectedCommand]?.code === 0}
                      aria-label="Duplicate selected command block"
                    >
                      Duplicate
                    </button>
                    <button
                      className="event-editor-btn event-command-action"
                      onClick={() => moveSelectedCommand("up")}
                      disabled={!canMoveCommandBlock(page.list, selectedCommand, "up")}
                      aria-label="Move selected command up"
                    >
                      ↑
                    </button>
                    <button
                      className="event-editor-btn event-command-action"
                      onClick={() => moveSelectedCommand("down")}
                      disabled={!canMoveCommandBlock(page.list, selectedCommand, "down")}
                      aria-label="Move selected command down"
                    >
                      ↓
                    </button>
                    <button
                      className="event-editor-btn event-command-action"
                      onClick={() => startCommandEdit(selectedCommand)}
                      disabled={selectedCommand < 0 || page.list[selectedCommand]?.code === 0}
                      title="Edit selected command"
                    >
                      Edit
                    </button>
                    <button
                      className="event-editor-btn event-command-action"
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
                          onStartEdit={() => startCommandEdit(block.rawIndex)}
                          onUpdateLines={(lines) => {
                            const contCode = PARENT_CONT[block.cmd.code]!;
                            updatePage((p) => {
                              const list = replaceMultiLineBlock(p.list, block.rawIndex, lines, contCode);
                              return { ...p, list };
                            });
                            setDirty(true);
                          }}
                          onStopEditing={() => setEditingCommand(null)}
                          onRegisterDraftCommit={registerActiveInlineDraftCommit}
                          onDraftChange={handleInlineDraftChange}
                          onDraftCommit={handleInlineDraftCommit}
                          onDraftCancel={handleInlineDraftCancel}
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
                        onDoubleClick={() => { if (cmd.code !== 0) startCommandEdit(i); }}
                        onParamChange={(paramIdx, value) => handleUpdateCommandParam(i, paramIdx, value)}
                        onStopEditing={() => setEditingCommand(null)}
                        onRegisterDraftCommit={registerActiveInlineDraftCommit}
                        onDraftChange={handleInlineDraftChange}
                        onDraftCommit={handleInlineDraftCommit}
                        onDraftCancel={handleInlineDraftCancel}
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
          <span className="event-editor-keyboard-hints" style={{ fontSize: 10, color: "#8c8fa1" }}>
            Select + Edit · Del/Ins · Ctrl+Z undo · Ctrl+Y redo · Ctrl+S save
          </span>
          <div className="event-editor-footer-actions">
            <button
              className="event-editor-btn event-editor-btn-primary"
              onClick={handleOk}
              disabled={saving}
            >
              {saving ? "Saving..." : "Save & close"}
            </button>
            <button
              className="event-editor-btn"
              aria-label="Save All from event editor"
              onClick={() => void handleSaveAll()}
              disabled={saving || savingAll}
            >
              {savingAll ? "Saving..." : "Save All"}
            </button>
            <button
              className="event-editor-btn"
              onClick={() => { revisionRef.current += 1; setSaveNotice(null); setSaveError(null); undo(); setDirty(true); }}
              disabled={!canUndo}
              title="Undo (Ctrl+Z)"
              aria-label="Undo event edit"
            >
              ↩
            </button>
            <button
              className="event-editor-btn"
              onClick={() => { revisionRef.current += 1; setSaveNotice(null); setSaveError(null); redo(); setDirty(true); }}
              disabled={!canRedo}
              title="Redo (Ctrl+Y)"
              aria-label="Redo event edit"
            >
              ↪
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
