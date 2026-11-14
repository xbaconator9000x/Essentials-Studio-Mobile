import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProjectInfo, MapRenderData, TilesetRenderInfo, MapProperties, RpgEvent, EventInfo } from "./types";
import { FIRST_REGULAR_TILE } from "./types";
import { open } from "@tauri-apps/plugin-dialog";
import { confirmEditor } from "./services/editorDialog";
import {
  openProject,
  getBrowserProjectRoot,
  loadMap,
  loadTileset,
  saveMap,
  createMap,
  deleteMap,
  renameMap,
  createEvent,
  deleteEvent,
  listTilesetNames,
  loadSystemData,
  saveSystemData,
  loadEvent,
  pasteClipboardEvent,
  launchGame,
} from "./services/tauriApi";
import { loadAllTilesetImages, clearImageCache } from "./services/imageLoader";
import {
  importProjectZip,
  importProjectZipFromAndroidDocument,
  exportProjectZip,
  exportBrowserProjectZip,
  discardFailedProjectImport,
  type AndroidDocumentImportProgress,
} from "./services/archiveApi";
import { importAndOpenProject } from "./services/importOpenGuards";
import { pickAndroidDocument } from "./services/androidDocumentPicker";
import { saveThenMarkClean, mapStillUnchanged } from "./services/saveGuards";
import { saveBeforeMapNavigation } from "./services/mapNavigationSave";
import { prepareProjectBeforeOpen, prepareMapSelection, preserveUnsavedMapTiles, assertRequiredXpGraphics, ProjectOpenCoordinator } from "./services/projectOpenGuards";
import { confirmProjectSwitch as confirmProjectSwitchWithSave } from "./services/projectSwitchGuards";
import {
  getLastMapId,
  getLastProjectPath,
  getRecentProjectPaths,
  rememberLastMapId,
  rememberRecentProjectPath,
} from "./services/recentProject";
import { installEditorBackHandler } from "./services/editorBackNavigation";
import { MobileRecentProjects } from "./components/MobileRecentProjects";
import { MobileWorkspaceBar } from "./components/MobileWorkspaceBar";
import { MobileOperationFeedback } from "./components/MobileOperationFeedback";
import { MapTreePanel } from "./components/MapTree/MapTreePanel";
import { MapEditor } from "./components/MapEditor/MapEditor";
import { TilesetPalette } from "./components/TilesetPalette/TilesetPalette";
import { EventEditor } from "./components/EventEditor/EventEditor";
import { MapPropertiesDialog } from "./components/MapProperties/MapPropertiesDialog";
import { CreateMapDialog } from "./components/MapProperties/CreateMapDialog";
import { ScriptEditor } from "./components/ScriptEditor/ScriptEditor";
import { DatabaseEditor } from "./components/DatabaseEditor/DatabaseEditor";
import { PbsEntityEditor } from "./components/PbsEntityEditor/PbsEntityEditor";
import { SpriteEditor } from "./components/SpriteEditor/SpriteEditor";
import { buildPbsIndex, type PbsIndex } from "./services/pbsIndex";
import { supportsDirectProjectFolderOpen } from "./services/projectOpenMode";
import {
  readBooleanPanelPreference,
  writeBooleanPanelPreference,
} from "./services/panelPreferences";
import {
  ProjectSaveProvider,
  useProjectSave,
  useEditorRegistration,
} from "./context/ProjectSaveContext";
import "./App.css";

// Android's SAF save picker can expose a ZIP as generic octet-stream.
const PROJECT_ARCHIVE_ACCEPT =
  ".zip,.rar,application/zip,application/vnd.rar,application/x-rar-compressed,application/octet-stream";
const TILESET_PALETTE_PREFERENCE = "essentials-studio:map-editor:tileset-palette-visible";
// A phone in landscape is often 750–900 CSS px. Keep the same mobile
// navigation rather than silently swapping to the three-column desktop UI.
const MOBILE_LAYOUT_QUERY = "(max-width: 900px)";

/** Try to open a native folder picker via Tauri dialog plugin. */
async function showFolderPicker(): Promise<string | null> {
  const browserRoot = await getBrowserProjectRoot();
  if (browserRoot) return browserRoot;
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select Pokémon Essentials Project Folder",
    });
    return selected as string | null;
  } catch (err) {
    console.warn("Tauri dialog not available, falling back to prompt:", err);
    return window.prompt("Enter the path to your RMXP project folder:");
  }
}

/**
 * Inner component rendered inside ProjectSaveProvider so it can call
 * useProjectSave() and useEditorRegistration().
 */
function AppContent() {
  const { saveAll, dirtyCount, hasUnsavedEdits, updateDirty } = useProjectSave();
  const canOpenProjectFolder = supportsDirectProjectFolderOpen(navigator.userAgent);
  const isAndroid = !canOpenProjectFolder;
  const isBrowserDev = !("__TAURI_INTERNALS__" in window) && Boolean(import.meta.env.VITE_BROWSER_BACKEND_URL);
  const [mobileLayout, setMobileLayout] = useState(
    () => typeof window.matchMedia === "function" && window.matchMedia(MOBILE_LAYOUT_QUERY).matches,
  );
  const [mobileSection, setMobileSection] = useState<"projects" | "maps" | "sprites" | "settings">("projects");
  const [mobileEditEnabled, setMobileEditEnabled] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const phoneViewport = window.matchMedia(MOBILE_LAYOUT_QUERY);
    const updateLayout = (event: MediaQueryListEvent) => setMobileLayout(event.matches);
    phoneViewport.addEventListener("change", updateLayout);
    return () => phoneViewport.removeEventListener("change", updateLayout);
  }, []);

  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [lastProjectPath, setLastProjectPath] = useState(getLastProjectPath);
  const [recentProjectPaths, setRecentProjectPaths] = useState(getRecentProjectPaths);
  // A new Map on every App render invalidates project-scoped PBS loaders and
  // can reload Encounters/World panels while the user has unsaved edits.
  const pbsMapNames = useMemo(
    () => new Map<number, string>(
      Object.entries(project?.map_infos ?? {}).map(([id, info]) => [Number(id), info.name])
    ),
    [project?.map_infos]
  );
  const [pbsIndex, setPbsIndex] = useState<PbsIndex>(new Map());
  const [currentMapId, setCurrentMapId] = useState<number | null>(null);
  const [mapData, setMapData] = useState<MapRenderData | null>(null);
  const [tilesetInfo, setTilesetInfo] = useState<TilesetRenderInfo | null>(null);
  const [tilesetImage, setTilesetImage] = useState<HTMLImageElement | null>(null);
  const [autotileImages, setAutotileImages] = useState<(HTMLImageElement | null)[]>(
    [null, null, null, null, null, null, null]
  );
  const [selectedTileId, setSelectedTileId] = useState(FIRST_REGULAR_TILE);
  const [mapIsDirty, setMapIsDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    console.info(`[save-all] toolbar state saving=${saving}`);
  }, [saving]);
  // Synchronous lease: fast repeated taps cannot start competing saves or exports.
  const editorOperationRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  // Event editor state
  const [editingEvent, setEditingEvent] = useState<{
    eventId: number;
    eventName: string;
  } | null>(null);

  // Map properties dialog state
  const [propsMapId, setPropsMapId] = useState<number | null>(null);

  // Create map dialog state
  const [createMapParentId, setCreateMapParentId] = useState<number | null>(null);

  // Tileset names cache (loaded once when project opens)
  const [tilesetNames, setTilesetNames] = useState<Array<[number, string]>>([]);

  // Starting position (loaded from System.rxdata)
  const [startPosition, setStartPosition] = useState<{ mapId: number; x: number; y: number } | null>(null);

  // Clipboard for event copy/paste
  const [clipboardEvent, setClipboardEvent] = useState<RpgEvent | null>(null);

  // Modal editor windows
  const [showDatabase, setShowDatabase] = useState(false);
  const [showScripts, setShowScripts] = useState(false);
  const [showPbs, setShowPbs] = useState(false);
  const [showSprites, setShowSprites] = useState(false);
  const [showTilesetPalette, setShowTilesetPalette] = useState(
    () => readBooleanPanelPreference(TILESET_PALETTE_PREFERENCE) ??
      (typeof window.matchMedia !== "function" || !window.matchMedia(MOBILE_LAYOUT_QUERY).matches),
  );
  const [graphicsRevision, setGraphicsRevision] = useState(0);
  const mobileBackState = useRef({
    projectOpen: Boolean(project),
    mobileLayout,
    mobileSection,
    showTilesetPalette,
    editingEvent,
    showDatabase,
    showScripts,
    showPbs,
    showSprites,
    propsMapId,
    createMapParentId,
    dirtyCount,
  });
  mobileBackState.current = {
    projectOpen: Boolean(project),
    mobileLayout,
    mobileSection,
    showTilesetPalette,
    editingEvent,
    showDatabase,
    showScripts,
    showPbs,
    showSprites,
    propsMapId,
    createMapParentId,
    dirtyCount,
  };

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const narrowViewport = window.matchMedia(MOBILE_LAYOUT_QUERY);
    const updatePaletteVisibility = (event: MediaQueryListEvent) => {
      if (readBooleanPanelPreference(TILESET_PALETTE_PREFERENCE) === null) {
        setShowTilesetPalette(!event.matches);
      }
    };
    narrowViewport.addEventListener("change", updatePaletteVisibility);
    return () => narrowViewport.removeEventListener("change", updatePaletteVisibility);
  }, []);

  const activeProjectPath = project?.path;
  const lastMobileProjectPathRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeProjectPath || !mobileLayout) return;
    if (lastMobileProjectPathRef.current === activeProjectPath) return;
    lastMobileProjectPathRef.current = activeProjectPath;
    // A different project is a new editing scope. Back navigation between
    // screens must retain dirty work, but opening another root must re-arm
    // read-only preview and close a palette scoped to the previous project.
    setMobileEditEnabled(false);
    setMobileSection("projects");
    setShowTilesetPalette(false);
  }, [activeProjectPath, mobileLayout]);

  useEffect(() => {
    if (!activeProjectPath || !mobileLayout) return;
    const sentinel = { essentialsStudioBack: true };
    const hasBackLayer = () => {
      const state = mobileBackState.current;
      return Boolean(
        state.editingEvent || state.showDatabase || state.showScripts || state.showPbs ||
        state.showSprites || state.propsMapId !== null || state.createMapParentId !== null ||
        (state.mobileSection === "maps" && state.showTilesetPalette) ||
        state.mobileSection !== "projects"
      );
    };
    const handleBack = () => {
      if (!hasBackLayer()) return;
      window.history.pushState(sentinel, "", window.location.href);
      window.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }));
    };
    window.history.pushState(sentinel, "", window.location.href);
    window.addEventListener("popstate", handleBack);
    return () => window.removeEventListener("popstate", handleBack);
  }, [activeProjectPath, mobileLayout]);

  useEffect(() => {
    if (!activeProjectPath || mobileLayout || !editingEvent) return;
    return installEditorBackHandler(window);
  }, [activeProjectPath, editingEvent, mobileLayout]);

  useEffect(() => {
    const handleMobileEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const state = mobileBackState.current;
      if (!state.mobileLayout || !state.projectOpen || state.editingEvent) return;

      const hasOverlay = Boolean(
        state.showDatabase || state.showScripts || state.showPbs || state.showSprites ||
        state.propsMapId !== null || state.createMapParentId !== null
      );
      if (hasOverlay) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const close = () => {
          if (state.propsMapId !== null) setPropsMapId(null);
          else if (state.createMapParentId !== null) setCreateMapParentId(null);
          else if (state.showSprites) setShowSprites(false);
          else if (state.showPbs) setShowPbs(false);
          else if (state.showScripts) setShowScripts(false);
          else if (state.showDatabase) setShowDatabase(false);
        };
        if (state.dirtyCount > 0) {
          void confirmEditor("Discard unsaved changes and close this editor?").then(discard => {
            if (discard) close();
          });
        } else {
          close();
        }
        return;
      }

      if (state.mobileSection === "maps" && state.showTilesetPalette) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setShowTilesetPalette(false);
        return;
      }
      if (state.mobileSection !== "projects") {
        event.preventDefault();
        event.stopImmediatePropagation();
        // Sections are views of the same mounted project. Moving to the map
        // list must never suggest discarding edits or clear Save All state.
        // Only actually opening a *different project* runs the save guard.
        setMobileSection("projects");
      }
    };
    window.addEventListener("keydown", handleMobileEscape);
    return () => window.removeEventListener("keydown", handleMobileEscape);
  }, []);

  // Refs let callbacks always read the latest values without stale closures.
  const mapDataRef = useRef<MapRenderData | null>(null);
  const mapIsDirtyRef = useRef(false);
  // Increment for every paint operation, even while the map is already dirty.
  // A pending Save All must not clear edits made after its disk snapshot.
  const mapEditRevisionRef = useRef(0);
  const currentMapIdRef = useRef<number | null>(null);
  const projectRef = useRef<ProjectInfo | null>(null);
  const projectOpenCoordinator = useRef(new ProjectOpenCoordinator());
  const mapSelectionCoordinator = useRef(new ProjectOpenCoordinator());
  const [archiveProgress, setArchiveProgress] = useState<number | null>(null);
  const [archiveProgressDetail, setArchiveProgressDetail] = useState<string | null>(null);
  const [archiveOutcome, setArchiveOutcome] = useState<string | null>(null);

  useEffect(() => { mapDataRef.current = mapData; }, [mapData]);
  useEffect(() => { projectRef.current = project; }, [project]);

  /** Update map dirty flag in both state (for renders) and ref (for callbacks). */
  const updateMapDirty = useCallback((val: boolean) => {
    if (val) mapEditRevisionRef.current += 1;
    mapIsDirtyRef.current = val;
    setMapIsDirty(val);
    // Publish synchronously: a fast tap on Export immediately after painting
    // must not race the registration effect and export stale map data.
    if (currentMapIdRef.current !== null) {
      updateDirty(`map-${currentMapIdRef.current}`, val);
    }
  }, [updateDirty]);

  // ── Map save/cancel for ProjectSaveContext registration ────────────────────

  const saveMapTiles = useCallback(async () => {
    const md = mapDataRef.current;
    const proj = projectRef.current;
    if (!proj || !md) return;
    // The map editor mutates the tile array in place. Snapshot it before the
    // asynchronous native write, and keep newer paints dirty until saved again.
    const tilesSnapshot = md.tiles.slice();
    const savedRevision = mapEditRevisionRef.current;
    setLoading(true);
    try {
      console.info("[save-all] map callback entered", md.id);
      await saveThenMarkClean(
        async () => {
          console.info("[save-all] invoking native map save", md.id);
          await saveMap(proj.path, md.id, tilesSnapshot, md.width, md.height);
          console.info("[save-all] native map save completed", md.id);
        },
        () => updateMapDirty(false),
        () => mapStillUnchanged(
          { projectPath: proj.path, map: md, revision: savedRevision },
          { projectPath: projectRef.current?.path, map: mapDataRef.current, revision: mapEditRevisionRef.current },
        ),
      );
    } catch (err) {
      setError(`Save failed: ${err}`);
      // ProjectSaveContext aggregates rejected saves. Never report a successful
      // Save All or allow ZIP export when the map is still dirty on disk.
      throw err;
    } finally {
      setLoading(false);
    }
  }, [updateMapDirty]);

  const cancelMapTiles = useCallback(() => {
    updateMapDirty(false);
  }, [updateMapDirty]);

  // Register the current map with the global save context.
  // ID changes when the map changes, which auto-unregisters the old map.
  useEditorRegistration(
    currentMapId != null ? `map-${currentMapId}` : "map-none",
    saveMapTiles,
    cancelMapTiles,
    mapIsDirty
  );

  // Shared guard for toolbar saves, project switching and map navigation.
  // Every Save All entry point must freeze in-memory edits, not just ZIP export.
  const saveAllWithLock = useCallback(async (): Promise<void> => {
    if (editorOperationRef.current) {
      console.warn("[save-all] rejected: project operation already running");
      throw new Error("Another project save or export is already running");
    }
    console.info("[save-all] operation lock acquired");
    editorOperationRef.current = true;
    setSaving(true);
    try {
      await saveAll();
      console.info("[save-all] operation completed");
    } finally {
      editorOperationRef.current = false;
      setSaving(false);
    }
  }, [saveAll]);

  // ── Project loading ────────────────────────────────────────────────────────

  // A project switch must never silently unmount dirty event, map or PBS editors.
  // Cancel keeps the current project active; save failures also abort the switch.
  const confirmProjectSwitch = useCallback(() => confirmProjectSwitchWithSave({
    hasActiveProject: Boolean(projectRef.current),
    hasUnsavedEdits,
    confirm: confirmEditor,
    saveAll: saveAllWithLock,
  }), [saveAllWithLock, hasUnsavedEdits]);

  const handleOpenProject = useCallback(async (path: string, skipSwitchGuard = false) => {
    if (!skipSwitchGuard && !(await confirmProjectSwitch())) return;
    // Cancel in-flight map loads before preparing another project.
    mapSelectionCoordinator.current.begin();
    const lease = projectOpenCoordinator.current.begin();
    try {
      setLoading(true);
      setError(null);
      // Validate the candidate's initial XP map and tileset before clearing
      // the current project. A corrupt ZIP must not replace a working editor.
      const { project: proj, initialMap, initialTileset } = await prepareProjectBeforeOpen(
        path,
        { openProject, loadMap, loadTileset },
        getLastMapId(path),
      );
      lease.assertCurrent();

      // Load the first map's actual graphics BEFORE making the imported project
      // active. A broken Android asset path must reject the import instead of
      // silently presenting an empty map and treating the ZIP as accepted.
      // Clearing only the image cache does not modify the existing project.
      clearImageCache();
      const initialImages = initialMap && initialTileset
        ? await loadAllTilesetImages(proj.path, initialTileset.tileset_name, initialTileset.autotile_names)
        : null;
      if (initialMap && initialTileset) {
        assertRequiredXpGraphics(initialTileset, initialImages);
      }
      lease.assertCurrent();

      // Commit the project and its first render as one logical operation.
      // Edits can arrive while a large ZIP/project loads. Never unmount an
      // active dirty editor even if it was clean when the picker opened.
      if (projectRef.current && hasUnsavedEdits()) {
        throw new Error("The current project was edited while another project loaded. Switch cancelled; save those edits first.");
      }
      projectRef.current = proj;
      setProject(proj);
      rememberRecentProjectPath(proj.path);
      setLastProjectPath(proj.path);
      setRecentProjectPaths(getRecentProjectPaths());
      setMapData(initialMap);
      mapDataRef.current = initialMap;
      setTilesetInfo(initialTileset);
      setTilesetImage(initialImages?.tileset ?? null);
      setAutotileImages(initialImages?.autotiles ?? [null, null, null, null, null, null, null]);
      setCurrentMapId(initialMap?.id ?? null);
      currentMapIdRef.current = initialMap?.id ?? null;
      if (initialMap) rememberLastMapId(proj.path, initialMap.id);
      updateMapDirty(false);
      // Close project-bound editors so stale event IDs cannot write to the new project.
      setEditingEvent(null);
      setPropsMapId(null);
      setCreateMapParentId(null);
      setClipboardEvent(null);
      setShowDatabase(false);
      setShowScripts(false);
      setShowPbs(false);
      setPbsIndex(new Map());
      setTilesetNames([]);
      setStartPosition(null);
      buildPbsIndex(proj.path)
        .then(index => { if (lease.isCurrent()) setPbsIndex(index); })
        .catch(err => { if (lease.isCurrent()) console.warn("PBS index unavailable:", err); });

      try {
        const names = await listTilesetNames(proj.path);
        if (lease.isCurrent()) setTilesetNames(names);
      } catch (err) {
        console.warn("Failed to load tileset names:", err);
      }

      try {
        const sys = await loadSystemData(proj.path);
        if (lease.isCurrent()) setStartPosition({ mapId: sys.start_map_id, x: sys.start_x, y: sys.start_y });
      } catch (err) {
        console.warn("Failed to load system start position:", err);
      }

      // Initial map, tileset and graphics were already loaded and validated
      // before project activation; do not reload them or swallow errors.
    } finally {
      // An older project open must not clear the loading indicator of a newer one.
      if (lease.isCurrent()) setLoading(false);
    }
  }, [updateMapDirty, confirmProjectSwitch, hasUnsavedEdits]);

  const handleReopenLastProject = useCallback(async () => {
    if (!lastProjectPath) return;
    try {
      await handleOpenProject(lastProjectPath);
    } catch (err) {
      setError(`Could not reopen last project: ${err}`);
    }
  }, [handleOpenProject, lastProjectPath]);

  const handleBrowseProject = useCallback(async () => {
    if (!canOpenProjectFolder) {
      setArchiveOutcome("On Android, import an Essentials project ZIP instead of opening a folder.");
      return;
    }
    try {
      const selected = await showFolderPicker();
      if (selected) await handleOpenProject(selected);
    } catch (err) {
      setError(`Could not open project: ${err}`);
    }
  }, [canOpenProjectFolder, handleOpenProject]);

  // ── Archive import into private app storage ─────────────────────────────────
  const handleImportSource = useCallback(async <T,>(
    source: T | null,
    importArchive: (source: T, onProgress?: (percent: number) => void) => Promise<string>,
  ) => {
    if (source === null || editorOperationRef.current) return;
    // A project import must own the same exclusive lease as Save All/export.
    // Otherwise two picker callbacks can extract concurrently, or a ZIP export
    // can snapshot the previous project while the imported project is opening.
    // Claim the lease before awaiting the unsaved-edits confirmation so another
    // toolbar action cannot start while the confirmation is visible.
    editorOperationRef.current = true;
    setLoading(true);
    setArchiveProgress(0);
    setArchiveProgressDetail(null);
    setArchiveOutcome(null);
    setError(null);
    try {
      // The project-switch confirmation may save dirty editors. Release only
      // the synchronous lease for that save, then reclaim it immediately.
      // No other UI operation can run during the awaited confirmation because
      // the loading shield remains active.
      editorOperationRef.current = false;
      const confirmed = await confirmProjectSwitch();
      if (!confirmed) return;
      if (editorOperationRef.current) {
        throw new Error("Another save or export started while confirming the import");
      }
      editorOperationRef.current = true;
      await importAndOpenProject(source, {
        importArchive,
        openProject: (path) => handleOpenProject(path, true),
        discardFailedImport: discardFailedProjectImport,
        isActiveProject: (path) => projectRef.current?.path === path,
      }, setArchiveProgress);
    } catch (err) {
      setError(`Project ZIP import failed: ${String(err)}`);
    } finally {
      editorOperationRef.current = false;
      setLoading(false);
      setArchiveProgress(null);
      setArchiveProgressDetail(null);
    }
  }, [confirmProjectSwitch, handleOpenProject]);

  const handleImportProjectZip = useCallback(
    (file: File) => handleImportSource(file, importProjectZip),
    [handleImportSource],
  );

  const handlePickAndroidProjectZip = useCallback(async () => {
    try {
      const selected = await pickAndroidDocument(() => open({
        multiple: false,
        // Android DocumentsUI providers disagree on ZIP MIME types
        // (application/zip vs application/x-zip-compressed). A restrictive
        // filter can display an archive but leave its row unselectable.
        // Select via the native provider, then let the bounded Rust ZIP
        // validator reject anything that is not a safe project archive.
        // This does not grant filesystem access or bypass the SAF picker.
      }), 120_000);
      if (selected === null) {
        setArchiveOutcome("Project ZIP import cancelled. No project was imported.");
        return;
      }
      console.info("[android-import] document picker returned a selection");
      setArchiveOutcome(null);
      if (typeof selected !== "string") {
        throw new Error("Android document picker returned an unsupported selection");
      }
      const importArchive = (
        uri: string,
        onProgress?: (percent: number) => void,
      ) => {
        setArchiveProgressDetail("Waiting for Android to open the selected project ZIP...");
        return importProjectZipFromAndroidDocument(uri, onProgress, (progress: AndroidDocumentImportProgress) => {
          if (progress.stage === "reading") {
            const megabytes = (progress.bytesRead / (1024 * 1024)).toFixed(1);
            setArchiveProgressDetail(`Read ${megabytes} MiB from Android ZIP...`);
          } else if (progress.stage === "validating") {
            setArchiveProgressDetail("Validating ZIP and creating the private project copy...");
          } else {
            setArchiveProgressDetail("ZIP imported; opening project...");
          }
        });
      };
      await handleImportSource(selected, importArchive);
    } catch (err) {
      setError(`Project ZIP import failed: ${String(err)}`);
    }
  }, [handleImportSource]);

  const handleSaveAll = useCallback(async () => {
    if (editorOperationRef.current) {
      console.warn("[save-all] toolbar tap ignored: project operation already running");
      return;
    }
    const hadUnsavedEdits = hasUnsavedEdits();
    setError(null);
    setArchiveOutcome(null);
    try {
      await saveAllWithLock();
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      setArchiveOutcome(hasUnsavedEdits()
        ? "Save completed, but unsaved editor changes remain."
        : hadUnsavedEdits
          ? "All registered editor changes were saved to the working project. The imported source ZIP is unchanged; export a new ZIP to share your edits."
          : "No unsaved editor changes were registered; nothing to save. Events saved with Save & close are already in the working project.");
    } catch (err) {
      setError(`Save all failed: ${String(err)}`);
    }
  }, [saveAllWithLock, hasUnsavedEdits]);

  const handleExportProjectZip = useCallback(async () => {
    const active = projectRef.current;
    if (!active || editorOperationRef.current) return;
    editorOperationRef.current = true;
    setArchiveOutcome(null);
    setLoading(true);
    setSaving(true);
    setArchiveProgress(0);
    setError(null);
    try {
      if (hasUnsavedEdits()) {
        setArchiveOutcome("Saving pending map, event, script and PBS edits before export...");
        await saveAll();
        // Dirty editor registration is effect-driven. Do not export until it
        // has settled, and fail closed if any edit arrived during the save.
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        if (hasUnsavedEdits()) {
          throw new Error("Unsaved edits remain after Save All. Export cancelled to avoid losing changes.");
        }
      }
      if (projectRef.current?.path !== active.path) {
        throw new Error("Active project changed during export preparation.");
      }
      if (isBrowserDev) {
        const receipt = await exportBrowserProjectZip(active.path);
        setArchiveProgress(100);
        setArchiveOutcome(`ZIP saved to local file: ${receipt.path} (${receipt.size} bytes). This is not an Android SAF write.`);
        return;
      }
      const outcome = await exportProjectZip(active.path, active.name, (percent) => {
        setArchiveProgress(percent);
        if (percent === 20) {
          setArchiveOutcome("Waiting for Android to return the selected export destination...");
        } else if (percent === 95) {
          setArchiveOutcome("Writing and byte-verifying the selected Android document...");
        }
      });
      setArchiveOutcome(outcome === "saved"
        ? "ZIP saved to the selected Android document and byte-verified."
        : outcome === "cancelled"
          ? "ZIP export cancelled. No destination document was written."
          : "ZIP share/download requested. Verify the file in the destination app.");
    } catch (err) {
      setArchiveOutcome(null);
      setError(`Project ZIP export failed: ${String(err)}`);
    } finally {
      setLoading(false);
      setSaving(false);
      editorOperationRef.current = false;
      setArchiveProgress(null);
    }
  }, [saveAll, hasUnsavedEdits, isBrowserDev]);

  // ── Map selection with unsaved-changes guard ───────────────────────────────

  /**
   * Load a map. Pass skipGuard=true to bypass the unsaved-changes prompt
   * (used when reloading the current map after property changes, or on initial
   * project open when dirty state has already been cleared).
   */
  const handleSelectMap = useCallback(async (mapId: number, skipGuard = false, openMobileEditor = false) => {
    const path = projectRef.current?.path;
    if (!path) return;
    const lease = mapSelectionCoordinator.current.begin();
    const isCurrent = () => lease.isCurrent() && projectRef.current?.path === path;

    // Do not mutate the previous map or clear its dirty state until the
    // replacement map, tileset and Android graphics have all loaded.
    if (!skipGuard && currentMapIdRef.current !== null && mapId !== currentMapIdRef.current) {
      try {
        const proceed = await saveBeforeMapNavigation(
          hasUnsavedEdits,
          () => confirmEditor("Save unsaved map, event, script and PBS changes before switching maps? Cancel keeps the current map open."),
          saveAllWithLock,
          isCurrent,
        );
        if (!proceed) return;
      } catch (err) {
        if (isCurrent()) setError(`Save before navigation failed: ${String(err)}`);
        return;
      }
    }

    // A destination map may take time to load its graphics. Do not discard
    // tile edits painted on the source map during that asynchronous read.
    const sourceMap = mapDataRef.current;
    const sourceRevision = mapEditRevisionRef.current;
    try {
      setLoading(true);
      setError(null);
      const prepared = await prepareMapSelection(path, mapId, {
        loadMap,
        loadTileset,
        loadImages: loadAllTilesetImages,
      });
      if (!isCurrent()) return;
      if (mapId !== currentMapIdRef.current && !mapStillUnchanged(
        { projectPath: path, map: sourceMap, revision: sourceRevision },
        { projectPath: projectRef.current?.path, map: mapDataRef.current, revision: mapEditRevisionRef.current },
      )) {
        setError("Map changed while opening another map. Newer edits remain on the current map; retry navigation.");
        return;
      }

      // Event/PBS edits can arrive while the destination graphics are loading.
      // Never unmount a newly dirty editor just because the map tiles stayed clean.
      if (mapId !== currentMapIdRef.current && hasUnsavedEdits()) {
        setError("Unsaved edits appeared while loading the destination map. Navigation cancelled.");
        return;
      }

      // Reloading the same map after event editing must preserve unsaved tile
      // painting, while using the newly loaded event list and graphics.
      const preserveDirty = mapId === currentMapIdRef.current && mapIsDirtyRef.current;
      const nextMap = preserveUnsavedMapTiles(
        prepared.map, mapDataRef.current, preserveDirty,
      );
      // All reads and compatibility checks succeeded. Commit atomically from
      // the user's perspective; stale async requests cannot publish state.
      setMapData(nextMap);
      mapDataRef.current = nextMap;
      setTilesetInfo(prepared.tileset);
      setTilesetImage(prepared.images.tileset);
      setAutotileImages(prepared.images.autotiles);
      const changedMap = mapId !== currentMapIdRef.current;
      setCurrentMapId(mapId);
      currentMapIdRef.current = mapId;
      rememberLastMapId(path, mapId);
      // Only navigate away from the map tree after the destination has loaded
      // and all unsaved-edit guards have accepted the transition.
      if (openMobileEditor && isCurrent()) setMobileSection("maps");
      // Re-selecting/reloading the same map must not silently unmount an open
      // event editor with unsaved dialogue or command edits.
      if (changedMap) setEditingEvent(null);
      mapIsDirtyRef.current = preserveDirty;
      setMapIsDirty(preserveDirty);
    } catch (err) {
      if (isCurrent()) setError(`Could not open map ${mapId}: ${String(err)}`);
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [saveAllWithLock, hasUnsavedEdits]);

  const handleMapDirty = useCallback(() => {
    updateMapDirty(true);
  }, [updateMapDirty]);

  // Open event editor on double-click
  const handleOpenEvent = useCallback((eventId: number, eventName: string) => {
    setEditingEvent({ eventId, eventName });
  }, []);

  // ── Map management handlers ────────────────────────────────────────────────

  const handleCreateMap = useCallback((parentId: number) => {
    setCreateMapParentId(parentId);
  }, []);

  const handleConfirmCreateMap = useCallback(
    async (name: string, parentId: number, width: number, height: number, tilesetId: number) => {
      const proj = projectRef.current;
      if (!proj) return;
      try {
        setCreateMapParentId(null);
        setLoading(true);
        setError(null);
        const [newId, updatedInfos] = await createMap(
          proj.path, name, parentId, width, height, tilesetId
        );
        setProject({ ...proj, map_infos: updatedInfos });
        projectRef.current = { ...proj, map_infos: updatedInfos };
        // Guard runs here: if map tiles are dirty the user will be prompted.
        await handleSelectMap(newId);
      } catch (err) {
        setError(`Create failed: ${err}`);
      } finally {
        setLoading(false);
      }
    },
    [handleSelectMap]
  );

  const handleDeleteMap = useCallback(
    async (mapId: number, mapName: string) => {
      const proj = projectRef.current;
      if (!proj) return;
      if (!(await confirmEditor(`Delete map [${String(mapId).padStart(3, "0")}] "${mapName}"?\n\nThis cannot be undone.`))) {
        return;
      }
      try {
        setLoading(true);
        setError(null);
        const updatedInfos = await deleteMap(proj.path, mapId);
        setProject({ ...proj, map_infos: updatedInfos });
        projectRef.current = { ...proj, map_infos: updatedInfos };
        if (currentMapIdRef.current === mapId) {
          setCurrentMapId(null);
          currentMapIdRef.current = null;
          setMapData(null);
          mapDataRef.current = null;
        }
      } catch (err) {
        setError(`Delete failed: ${err}`);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const handleRenameMap = useCallback(async (mapId: number, currentName: string) => {
    const proj = projectRef.current;
    if (!proj) return;
    const newName = prompt("Rename map:", currentName);
    if (!newName || newName === currentName) return;
    try {
      setLoading(true);
      setError(null);
      await renameMap(proj.path, mapId, newName);
      const updatedInfos = { ...proj.map_infos };
      if (updatedInfos[mapId]) {
        updatedInfos[mapId] = { ...updatedInfos[mapId], name: newName };
      }
      setProject({ ...proj, map_infos: updatedInfos });
      projectRef.current = { ...proj, map_infos: updatedInfos };
    } catch (err) {
      setError(`Rename failed: ${err}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleMapProperties = useCallback((mapId: number) => {
    setPropsMapId(mapId);
  }, []);

  const handleMapPropertiesSaved = useCallback(async (props: MapProperties) => {
    const proj = projectRef.current;
    if (!proj) return;
    setPropsMapId(null);

    const updatedInfos = { ...proj.map_infos };
    if (updatedInfos[props.id]) {
      updatedInfos[props.id] = { ...updatedInfos[props.id], name: props.name };
    }
    setProject({ ...proj, map_infos: updatedInfos });
    projectRef.current = { ...proj, map_infos: updatedInfos };

    if (currentMapIdRef.current === props.id) {
      // Reload the same map — skip the guard (we're not switching maps).
      await handleSelectMap(props.id, true);
    }
  }, [handleSelectMap]);

  // Close the event editor and reload the current map so any saved changes to the
  // event (graphic, name, position) are reflected on the canvas immediately.
  const handleCloseEventEditor = useCallback(async () => {
    console.info("[event-save] close callback received");
    setEditingEvent(null);
    const mapId = currentMapIdRef.current;
    if (mapId !== null) {
      console.info("[event-save] refreshing map after event close", { mapId });
      await handleSelectMap(mapId, true);
      console.info("[event-save] map refresh after event close completed", { mapId });
    }
  }, [handleSelectMap]);

  // ── Event management handlers ──────────────────────────────────────────────

  const handleCreateEvent = useCallback(async (x: number, y: number) => {
    const proj = projectRef.current;
    const md = mapDataRef.current;
    const mapId = currentMapIdRef.current;
    if (!proj || !mapId || !md) return;
    try {
      setError(null);
      const [newEvent, updatedEvents] = await createEvent(proj.path, mapId, x, y);
      // An Android map switch can complete while the native write is pending.
      // Persist to the original map, but never publish its events on another map.
      const liveMap = mapDataRef.current;
      if (projectRef.current?.path !== proj.path || currentMapIdRef.current !== mapId ||
          !liveMap || liveMap.id !== mapId) return;
      setMapData({ ...liveMap, events: updatedEvents });
      mapDataRef.current = { ...liveMap, events: updatedEvents };
      setEditingEvent({ eventId: newEvent.id, eventName: newEvent.name });
    } catch (err) {
      setError(`Create event failed: ${err}`);
    }
  }, []);

  const handleDeleteEvent = useCallback(async (eventId: number, eventName: string) => {
    const proj = projectRef.current;
    const md = mapDataRef.current;
    const mapId = currentMapIdRef.current;
    if (!proj || !mapId || !md) return;
    if (!(await confirmEditor(`Delete event "${eventName}" (ID: ${eventId})?\n\nThis cannot be undone.`))) return;
    if (projectRef.current?.path !== proj.path || currentMapIdRef.current !== mapId) return;
    try {
      setError(null);
      const updatedEvents = await deleteEvent(proj.path, mapId, eventId);
      const liveMap = mapDataRef.current;
      if (projectRef.current?.path !== proj.path || currentMapIdRef.current !== mapId ||
          !liveMap || liveMap.id !== mapId) return;
      setMapData({ ...liveMap, events: updatedEvents });
      mapDataRef.current = { ...liveMap, events: updatedEvents };
    } catch (err) {
      setError(`Delete event failed: ${err}`);
    }
  }, []);

  // Set starting position: load System, patch, save, update local state
  const handleSetStartPosition = useCallback(async (x: number, y: number) => {
    const proj = projectRef.current;
    const mapId = currentMapIdRef.current;
    if (!proj || mapId === null) return;
    try {
      const sys = await loadSystemData(proj.path);
      await saveSystemData(proj.path, { ...sys, start_map_id: mapId, start_x: x, start_y: y });
      setStartPosition({ mapId, x, y });
    } catch (err) {
      setError(`Set starting point failed: ${err}`);
    }
  }, []);

  // Copy event: load full data and store in clipboard
  const handleCopyEvent = useCallback(async (eventId: number) => {
    const proj = projectRef.current;
    const mapId = currentMapIdRef.current;
    if (!proj || mapId === null) return;
    try {
      const evt = await loadEvent(proj.path, mapId, eventId);
      setClipboardEvent({
        ...evt,
        pages: evt.pages.map((page) => ({
          ...page,
          source_index: undefined,
          list: page.list.map((command) => ({ ...command, source_index: undefined })),
        })),
      });
    } catch (err) {
      setError(`Copy event failed: ${err}`);
    }
  }, []);

  // Paste event: create at target tile, overwrite with clipboard data
  const handlePasteEvent = useCallback(async (tileX: number, tileY: number) => {
    const proj = projectRef.current;
    const md = mapDataRef.current;
    const mapId = currentMapIdRef.current;
    if (!proj || !md || mapId === null || !clipboardEvent) return;
    try {
      setError(null);
      const [pasted, updatedEvents] = await pasteClipboardEvent(
        proj.path, mapId, tileX, tileY, clipboardEvent,
      );
      // Build updated EventInfo from clipboard data
      const firstPage = clipboardEvent.pages[0];
      const pastedInfo: EventInfo = {
        id: pasted.id,
        name: clipboardEvent.name,
        x: tileX,
        y: tileY,
        page_count: clipboardEvent.pages.length,
        graphic_name: firstPage?.graphic.character_name ?? "",
        graphic_direction: firstPage?.graphic.direction ?? 2,
        graphic_pattern: firstPage?.graphic.pattern ?? 0,
      };
      const liveMap = mapDataRef.current;
      if (projectRef.current?.path !== proj.path || currentMapIdRef.current !== mapId ||
          !liveMap || liveMap.id !== mapId) return;
      const finalEvents = updatedEvents.map(e => e.id === pasted.id ? pastedInfo : e);
      setMapData({ ...liveMap, events: finalEvents });
      mapDataRef.current = { ...liveMap, events: finalEvents };
    } catch (err) {
      setError(`Paste event failed: ${err}`);
    }
  }, [clipboardEvent]);

  const handleLaunchGame = useCallback(async () => {
    const proj = projectRef.current;
    if (!proj) return;
    try {
      await launchGame(proj.path);
    } catch (err) {
      setError(`Launch failed: ${err}`);
    }
  }, []);

  // Native write serialization cannot prevent in-memory edits while a ZIP
  // snapshot is assembled. Pause keyboard mutations during project operations.
  useEffect(() => {
    if (!loading && !saving) return;
    const blockEditorKeys = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener("keydown", blockEditorKeys, true);
    return () => window.removeEventListener("keydown", blockEditorKeys, true);
  }, [loading, saving]);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────

  // Ctrl+S saves ALL dirty editors (map tiles + database + scripts).
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Modal editors own Ctrl/Cmd+S and text shortcuts. Dispatching global
      // Save All as well can race the event's direct save of MapNNN.rxdata.
      if (e.defaultPrevented || e.altKey || editingEvent || showDatabase ||
          showScripts || showPbs || propsMapId !== null || createMapParentId !== null) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void handleSaveAll();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        void handleBrowseProject();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSaveAll, handleBrowseProject, editingEvent, showDatabase, showScripts,
      showPbs, propsMapId, createMapParentId]);

  // ── Welcome screen ─────────────────────────────────────────────────────────

  if (!project) {
    return (
      <div className="app">
        <div className="app-titlebar">
          <span className="app-title">Essentials Studio</span>
          <div className="app-titlebar-right">
            {loading && <span className="app-loading">Loading...</span>}
          </div>
        </div>
        <div className="app-welcome">
          <div className="app-welcome-content">
            <h1>Essentials Studio</h1>
            <p>A modern editor for Pokémon Essentials projects</p>
            {canOpenProjectFolder && (
              <button
                className="app-welcome-btn"
                onClick={handleBrowseProject}
                disabled={loading}
              >
                {loading ? "Opening..." : "Open Project Folder"}
              </button>
            )}
            {lastProjectPath && (
              <button className="app-welcome-btn" onClick={() => void handleReopenLastProject()} disabled={loading}>
                Reopen Last Project
              </button>
            )}
            {/* The native Android dialog can return without resolving its
                callback (emulator 41304956412). Use the bounded File.slice
                importer first; retain the scoped native picker as fallback. */}
            {isBrowserDev ? (
              <p role="status">Browser ZIP import runs when launching the editor. Restart with <code>npm run dev:web -- /absolute/path/project.zip</code> to create a new safe working copy.</p>
            ) : (
            <label className="app-welcome-btn app-archive-picker">
              Import Essentials Project ZIP
              <input type="file" accept={PROJECT_ARCHIVE_ACCEPT} className="app-archive-picker-input"
                aria-label="Choose Essentials Project ZIP" disabled={loading}
                onChange={event => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void handleImportProjectZip(file);
                }} />
            </label>
            )}
            {isAndroid && (
              <p role="note">On Android, open projects from a ZIP archive. The source ZIP remains unchanged.</p>
            )}
            {isAndroid && (
              <button className="app-welcome-btn" aria-label="Use native Android document picker"
                onClick={() => void handlePickAndroidProjectZip()} disabled={loading}>
                Import ZIP via Android document picker
              </button>
            )}
            {archiveProgress !== null && <p>Importing project: {archiveProgress}%</p>}
            {archiveOutcome && <p role="status" aria-live="polite">{archiveOutcome}</p>}
            <p className="app-welcome-hint">
              Select a folder containing a Game.rxproj file
              <br />
              <span style={{ opacity: 0.6 }}>Shortcut: Cmd+O</span>
            </p>
          </div>
          {error && (
            <div className="app-error">
              <span>{error}</span>
              <button onClick={() => setError(null)}>x</button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Main UI ────────────────────────────────────────────────────────────────

  return (
    <div className="app" aria-busy={loading || saving}>
      {/* Title bar — * reflects all dirty editors via dirtyCount */}
      <div className="app-titlebar">
        <span className="app-title">
          Essentials Studio — {project.name}{dirtyCount > 0 ? " *" : ""}
        </span>
        {mobileLayout && <span className="app-preview-badge">PREVIEW</span>}
        <div className="app-titlebar-right">
          <button className="app-titlebar-btn" disabled={loading || saving}
            onClick={() => void handleSaveAll()}>
            {saving ? "Saving..." : "Save All"}
          </button>
          <button className="app-titlebar-btn" onClick={() => setShowDatabase(true)} disabled={loading || saving}>
            Database
          </button>
          <button className="app-titlebar-btn" onClick={() => setShowScripts(true)} disabled={loading || saving}>
            Scripts
          </button>
          <button className="app-titlebar-btn" onClick={() => setShowPbs(true)} disabled={loading || saving}>
            PBS Data
          </button>
          <button className="app-titlebar-btn" onClick={() => setShowSprites(true)} disabled={loading || saving}>
            Sprites
          </button>
          <button
            className="app-titlebar-btn app-titlebar-btn--play"
            onClick={handleLaunchGame} disabled={loading || saving}
          >
            ▶ Play
          </button>
          <button className="app-titlebar-btn" onClick={() => void handleExportProjectZip()} disabled={loading || saving}>
            {dirtyCount > 0 ? "Save & Export ZIP..." : "Export ZIP..."}
          </button>
          {isBrowserDev ? (
            <button className="app-titlebar-btn" onClick={() => setArchiveOutcome("To import another ZIP in browser mode, restart with: npm run dev:web -- /absolute/path/project.zip. The current working copy remains on disk.")}>
              Import ZIP (restart)...
            </button>
          ) : (
          <label className="app-titlebar-btn app-archive-picker">
            Import ZIP...
            <input type="file" accept={PROJECT_ARCHIVE_ACCEPT} className="app-archive-picker-input"
              aria-label="Choose Essentials Project ZIP" disabled={loading || saving}
              onChange={event => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void handleImportProjectZip(file);
              }} />
          </label>
          )}
          {isAndroid && (
            <button className="app-titlebar-btn" aria-label="Use native Android document picker"
              onClick={() => void handlePickAndroidProjectZip()} disabled={loading || saving}>
              Import ZIP (native)
            </button>
          )}
          {archiveProgress !== null && (
            <span className="app-loading">
              {archiveProgressDetail ?? `${archiveProgress}%`}
            </span>
          )}
          {canOpenProjectFolder && (
            <button className="app-titlebar-btn" onClick={handleBrowseProject} disabled={loading || saving}>
              Open...
            </button>
          )}
          {loading && <span className="app-loading">Loading...</span>}
        </div>
      </div>

      {mobileLayout ? (
        <MobileOperationFeedback
          progress={archiveProgress === null ? null
            : archiveProgressDetail ??
              (archiveProgress === 0 ? "Preparing project ZIP — please wait..." : `Project ZIP operation: ${archiveProgress}%`)}
          outcome={archiveOutcome}
          error={error}
          onDismissOutcome={() => setArchiveOutcome(null)}
          onDismissError={() => setError(null)}
        />
      ) : (
        <>
          {archiveProgress !== null && (
            <div className="app-operation-status" role="status" aria-live="polite">
              {archiveProgressDetail ??
                (archiveProgress === 0 ? "Preparing project ZIP — please wait..." : `Project ZIP operation: ${archiveProgress}%`)}
            </div>
          )}
          {archiveOutcome && <div className="app-operation-status" role="status" aria-live="polite">{archiveOutcome}</div>}
          {error && <div className="app-operation-status app-operation-error" role="alert">{error}</div>}
        </>
      )}

      {mobileLayout && (
        <MobileWorkspaceBar
          section={mobileSection}
          projectName={project.name}
          mapName={currentMapId !== null
            ? (project.map_infos[currentMapId]?.name ?? `Map ${String(currentMapId).padStart(3, "0")}`)
            : null}
          dirtyCount={dirtyCount}
          busy={loading || saving}
          editingEnabled={mobileEditEnabled}
          paletteVisible={showTilesetPalette}
          onShowProjects={() => setMobileSection("projects")}
          onToggleEditing={() => setMobileEditEnabled((enabled) => !enabled)}
          onTogglePalette={() => setShowTilesetPalette((visible) => {
            const next = !visible;
            writeBooleanPanelPreference(TILESET_PALETTE_PREFERENCE, next);
            return next;
          })}
          onSaveAll={() => void handleSaveAll()}
          onExportZip={() => void handleExportProjectZip()}
        />
      )}

      {/* Desktop keeps the three-panel layout; Android uses project/map screens. */}
      <div className={`app-body${mobileLayout ? ` app-body--mobile app-body--mobile-${mobileSection}` : ""}`}>
        <section className="app-mobile-project-summary">
          <div>
            <h1>{project.name}</h1>
            <p>{Object.keys(project.map_infos).length} maps available</p>
          </div>
          <p>Select a map to open the editor. Your source ZIP remains unchanged.</p>
          <label className="app-mobile-import-btn">
            Import disposable ZIP
            <input type="file" accept={PROJECT_ARCHIVE_ACCEPT}
              aria-label="Import disposable project ZIP" disabled={loading || saving}
              onChange={event => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void handleImportProjectZip(file);
              }} />
          </label>
          <MobileRecentProjects
            paths={recentProjectPaths}
            currentPath={project.path}
            disabled={loading || saving}
            onSelect={(path) => {
              void handleOpenProject(path).catch((cause) => {
                setError(`Could not switch project: ${String(cause)}`);
              });
            }}
          />
        </section>
        {/* Left: Map tree */}
        <MapTreePanel
          mapInfos={project.map_infos}
          currentMapId={currentMapId}
          onSelectMap={(id) => {
            void handleSelectMap(id, false, mobileLayout);
          }}
          onCreateMap={handleCreateMap}
          onDeleteMap={handleDeleteMap}
          onRenameMap={handleRenameMap}
          onMapProperties={handleMapProperties}
          readOnly={mobileLayout && !mobileEditEnabled}
        />

        {/* Center: Map editor */}
        <MapEditor
          key={project.path}
          mapData={mapData}
          tilesetInfo={tilesetInfo}
          tilesetImage={tilesetImage}
          autotileImages={autotileImages}
          projectPath={project.path}
          selectedTileId={selectedTileId}
          onSelectTile={setSelectedTileId}
          currentMapId={currentMapId ?? undefined}
          startPosition={startPosition ?? undefined}
          hasClipboardEvent={clipboardEvent !== null}
          readOnly={mobileLayout && !mobileEditEnabled}
          paletteVisible={showTilesetPalette}
          onTogglePalette={() => setShowTilesetPalette((visible) => {
            const next = !visible;
            writeBooleanPanelPreference(TILESET_PALETTE_PREFERENCE, next);
            return next;
          })}
          graphicsRevision={graphicsRevision}
          shortcutsDisabled={Boolean(mobileLayout && !mobileEditEnabled || editingEvent || showDatabase || showScripts || showPbs || propsMapId !== null || createMapParentId !== null || loading || saving)}
          onMapDirty={handleMapDirty}
          onOpenEvent={mobileLayout && !mobileEditEnabled ? undefined : handleOpenEvent}
          onCreateEvent={mobileLayout && !mobileEditEnabled ? undefined : handleCreateEvent}
          onDeleteEvent={handleDeleteEvent}
          onSetStartPosition={handleSetStartPosition}
          onCopyEvent={handleCopyEvent}
          onPasteEvent={handlePasteEvent}
        />

        {/* Right: Tileset palette */}
        {showTilesetPalette && (
          <TilesetPalette
            key={`${project.path}:${currentMapId ?? "none"}`}
            tilesetInfo={tilesetInfo}
            tilesetImage={tilesetImage}
            autotileImages={autotileImages}
            selectedTileId={selectedTileId}
            onSelectTile={setSelectedTileId}
            onClose={() => {
              writeBooleanPanelPreference(TILESET_PALETTE_PREFERENCE, false);
              setShowTilesetPalette(false);
            }}
          />
        )}

        <section className="app-mobile-settings">
          <h1>Project &amp; export</h1>
          <p>Current project: <strong>{project.name}</strong></p>
          <div className="app-mobile-tools-section" role="group" aria-label="Project data editors">
            <h2>Project editors</h2>
            <p>Edit Pokémon data, Ruby scripts and PBS records from the same project workspace.</p>
            <div className="app-mobile-tools-grid">
              <button type="button" disabled={loading || saving}
                onClick={() => setShowDatabase(true)}>Database</button>
              <button type="button" disabled={loading || saving}
                onClick={() => setShowScripts(true)}>Ruby Scripts</button>
              <button type="button" disabled={loading || saving}
                onClick={() => setShowPbs(true)}>PBS Data</button>
              <button type="button" disabled={loading || saving}
                onClick={() => { setMobileSection("sprites"); setShowSprites(true); }}>Sprite Editor</button>
            </div>
          </div>
          <details className="app-mobile-safety-note">
            <summary>Safety: keep your original project ZIP</summary>
            <p>This is an experimental Android build. Work on a disposable copy until you have verified Save All and ZIP export on your device.</p>
          </details>
          {canOpenProjectFolder && (
            <button onClick={handleBrowseProject} disabled={loading || saving}>Open project folder</button>
          )}
          <label className="app-mobile-import-btn">
            Import disposable ZIP
            <input type="file" accept={PROJECT_ARCHIVE_ACCEPT}
              aria-label="Import disposable project ZIP from Settings" disabled={loading || saving}
              onChange={event => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void handleImportProjectZip(file);
              }} />
          </label>
          <button disabled={loading || saving} onClick={() => void handleSaveAll()}>
            Save All
          </button>
          <button disabled={loading || saving} onClick={() => void handleExportProjectZip()}>
            Export ZIP
          </button>
        </section>
        {mobileLayout && mobileSection === "sprites" && (
          <section className="app-mobile-sprite-preview">
            <h1>Sprite tools</h1>
            <p>Browse and edit project sprites using touch controls. Saving a sprite writes to the disposable working project, not the imported source ZIP.</p>
            <div className="app-mobile-safety-note" role="alert">
              Keep the original ZIP and open the editor only on a disposable project copy.
            </div>
            <button onClick={() => setShowSprites(true)}>Open Sprite Editor</button>
          </section>
        )}
      </div>

      {mobileLayout && !showSprites && (
        <nav className="app-mobile-nav" aria-label="Main navigation">
          {([
            ["projects", "Projects"],
            ["maps", "Maps"],
            ["sprites", "Sprites"],
            ["settings", "Settings"],
          ] as const).map(([section, label]) => (
            <button key={section} aria-current={mobileSection === section ? "page" : undefined}
              onClick={() => {
                setMobileSection(section);
                if (section === "sprites") setShowSprites(false);
              }}>
              {label}
            </button>
          ))}
        </nav>
      )}

      {/* Database editor modal */}
      {showDatabase && (
        <div className="editor-modal-overlay">
          <div className="editor-modal">
            <DatabaseEditor projectPath={project.path} onClose={() => setShowDatabase(false)} />
          </div>
        </div>
      )}

      {/* PBS Data editor modal */}
      {showPbs && (
        <div className="editor-modal-overlay">
          <div className="editor-modal">
            <PbsEntityEditor
              projectPath={project.path}
              mapNames={pbsMapNames}
              onClose={() => setShowPbs(false)}
            />
          </div>
        </div>
      )}

      {/* Script editor modal */}
      {showScripts && (
        <div className="editor-modal-overlay">
          <div className="editor-modal">
            <ScriptEditor projectPath={project.path} onClose={() => setShowScripts(false)} />
          </div>
        </div>
      )}

      {showSprites && (
        <SpriteEditor
          key={project.path}
          projectPath={project.path}
          onClose={() => {
            setShowSprites(false);
            if (mobileLayout) setMobileSection("sprites");
          }}
          onSaved={() => setGraphicsRevision((revision) => revision + 1)}
        />
      )}

      {/* Event editor modal */}
      {editingEvent && currentMapId && (
        <EventEditor
          projectPath={project.path}
          mapId={currentMapId}
          eventId={editingEvent.eventId}
          eventName={editingEvent.eventName}
          onClose={handleCloseEventEditor}
          mapInfos={project.map_infos}
          pbsIndex={pbsIndex}
        />
      )}

      {/* Map properties dialog */}
      {propsMapId !== null && (
        <MapPropertiesDialog
          projectPath={project.path}
          mapId={propsMapId}
          tilesetNames={tilesetNames}
          onClose={() => setPropsMapId(null)}
          onSaved={handleMapPropertiesSaved}
        />
      )}

      {/* Create map dialog */}
      {createMapParentId !== null && (
        <CreateMapDialog
          mapInfos={project.map_infos}
          tilesetNames={tilesetNames}
          defaultParentId={createMapParentId}
          onConfirm={handleConfirmCreateMap}
          onClose={() => setCreateMapParentId(null)}
        />
      )}

      {/* Block touch painting and modal editor input while Save All or ZIP
          export snapshots the project. Native Android pickers run separately. */}
      {(loading || saving) && (
        <div className="app-operation-shield" role="status" aria-live="polite">
          {saving ? "Saving project — editing paused" : "Loading project — editing paused"}
        </div>
      )}

      {/* The mobile alert already appears in the compact receipt strip.
          Do not duplicate a long native error at the bottom of the canvas. */}
      {!mobileLayout && error && (
        <div className="app-error">
          <span>{error}</span>
          <button onClick={() => setError(null)}>x</button>
        </div>
      )}
    </div>
  );
}

function App() {
  return (
    <ProjectSaveProvider>
      <AppContent />
    </ProjectSaveProvider>
  );
}

export default App;
