import { useEffect, useRef, useState } from "react";
import type { PaintTool } from "../../types";
import type { TileClipboard } from "../../services/mapEditor";
import {
  readBooleanPanelPreference,
  writeBooleanPanelPreference,
} from "../../services/panelPreferences";

interface MapToolbarProps {
  paintTool: PaintTool;
  setPaintTool: (tool: PaintTool) => void;
  tileClipboard: TileClipboard | null;
  selectedLayer: number;
  setSelectedLayer: (layer: number) => void;
  showLayers: [boolean, boolean, boolean];
  onToggleLayerVisibility: (layer: number, visible: boolean) => void;
  showGrid: boolean;
  setShowGrid: (show: boolean) => void;
  zoom: number;
  setZoom: (zoom: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  historyDisabled?: boolean;
  readOnly?: boolean;
  canCopyTiles: boolean;
  canPasteTiles: boolean;
  onCopyTiles: () => void;
  canClearTiles: boolean;
  onClearTiles: () => void;
  canTranslateTiles: boolean;
  onTranslateTiles: (dx: number, dy: number, mode: "move" | "copy") => void;
  onSwapSelectedLayers: (targetLayer: number) => void;
  onCopySelectedTilesToLayer?: (targetLayer: number, emptyMode: "preserve" | "replace") => void;
  onPasteTiles: () => void;
  preserveEmptyPaste: boolean;
  onPreserveEmptyPasteChange: (value: boolean) => void;
  hasClipboardEvent?: boolean;
  showEventPins: boolean;
  setShowEventPins: (show: boolean) => void;
  showCollisionOverlay: boolean;
  setShowCollisionOverlay: (show: boolean) => void;
  paletteVisible: boolean;
  onTogglePalette: () => void;
  eventCount: number;
  eventListVisible: boolean;
  onToggleEventList: () => void;
  canCreateEvent?: boolean;
  canPasteEvent?: boolean;
  eventPlacementMode?: "create" | "paste" | null;
  eventPlacementPending?: boolean;
  onToggleEventPlacement?: (mode: "create" | "paste") => void;
  onFitMap?: () => void;
  navigatorVisible?: boolean;
  onToggleNavigator?: () => void;
}

const TOOLS_COLLAPSED_PREFERENCE = "essentials-studio:map-editor:tools-collapsed";
const COMPACT_LAYOUT_QUERY = "(max-width: 700px)";
const PAINT_TOOLS: { tool: PaintTool; label: string }[] = [
  { tool: "pencil", label: "Pen" },
  { tool: "rectangle", label: "Rect" },
  { tool: "bucket", label: "Fill" },
  { tool: "eraser", label: "Erase" },
  { tool: "pick", label: "Pick" },
  { tool: "select", label: "Sel" },
  { tool: "pan", label: "Pan" },
];
const MAP_LAYERS = [
  { layer: 0, label: "L1", name: "Layer 1" },
  { layer: 1, label: "L2", name: "Layer 2" },
  { layer: 2, label: "L3", name: "Layer 3" },
  { layer: 3, label: "Ev", name: "Events layer" },
  { layer: -1, label: "All", name: "All layers" },
];

export function MapToolbar({
  paintTool,
  setPaintTool,
  tileClipboard,
  selectedLayer,
  setSelectedLayer,
  showLayers,
  onToggleLayerVisibility,
  showGrid,
  setShowGrid,
  zoom,
  setZoom,
  onUndo,
  onRedo,
  historyDisabled = false,
  readOnly = false,
  canCopyTiles,
  canPasteTiles,
  onCopyTiles,
  canClearTiles,
  onClearTiles,
  canTranslateTiles,
  onTranslateTiles,
  onSwapSelectedLayers,
  onCopySelectedTilesToLayer,
  onPasteTiles,
  preserveEmptyPaste,
  onPreserveEmptyPasteChange,
  hasClipboardEvent = false,
  showEventPins,
  setShowEventPins,
  showCollisionOverlay,
  setShowCollisionOverlay,
  paletteVisible,
  onTogglePalette,
  eventCount,
  eventListVisible,
  onToggleEventList,
  canCreateEvent = false,
  canPasteEvent = false,
  eventPlacementMode = null,
  eventPlacementPending = false,
  onToggleEventPlacement,
  onFitMap,
  navigatorVisible = false,
  onToggleNavigator,
}: MapToolbarProps) {
  const previousPaintTool = useRef<PaintTool>("pencil");
  useEffect(() => {
    if (paintTool !== "pan") previousPaintTool.current = paintTool;
  }, [paintTool]);
  const togglePan = () => setPaintTool(paintTool === "pan" ? previousPaintTool.current : "pan");
  const [compactPanel, setCompactPanel] = useState<"edit" | "events" | "view">("edit");
  // Event placement is a modal map interaction. Keep its cancel button and
  // instructions visible even when the user selected another mobile panel.
  useEffect(() => {
    if (eventPlacementMode !== null) setCompactPanel("events");
  }, [eventPlacementMode]);
  const [selectionActionsExpanded, setSelectionActionsExpanded] = useState(false);
  const [quickToolsExpanded, setQuickToolsExpanded] = useState(false);
  const [quickLayersExpanded, setQuickLayersExpanded] = useState(false);
  const [toolsCollapsed, setToolsCollapsed] = useState(
    () => readBooleanPanelPreference(TOOLS_COLLAPSED_PREFERENCE) ??
      (typeof window.matchMedia === "function" && window.matchMedia(COMPACT_LAYOUT_QUERY).matches),
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const narrowViewport = window.matchMedia(COMPACT_LAYOUT_QUERY);
    const updateCollapsedState = (event: MediaQueryListEvent) => {
      if (readBooleanPanelPreference(TOOLS_COLLAPSED_PREFERENCE) === null) {
        setToolsCollapsed(event.matches);
      }
    };
    narrowViewport.addEventListener("change", updateCollapsedState);
    return () => narrowViewport.removeEventListener("change", updateCollapsedState);
  }, []);

  return (
    <div className={`map-editor-toolbar${toolsCollapsed ? " map-editor-toolbar--compact" : ""}`}>
      <button
        className="toolbar-btn"
        aria-expanded={!toolsCollapsed}
        onClick={() => setToolsCollapsed((collapsed) => {
          const next = !collapsed;
          writeBooleanPanelPreference(TOOLS_COLLAPSED_PREFERENCE, next);
          return next;
        })}
      >
        {toolsCollapsed ? "Tools ▸" : "Tools ▾"}
      </button>
      {toolsCollapsed && (
        <div className="map-toolbar-compact-tabs" role="group" aria-label="Mobile map workspace">
          {(["edit", "events", "view"] as const).map(panel => (
            <button key={panel} type="button" className={`toolbar-btn ${compactPanel === panel ? "active" : ""}`}
              aria-pressed={compactPanel === panel} onClick={() => setCompactPanel(panel)}>
              {panel === "edit" ? "Draw" : panel === "events" ? "Event tools" : "View"}
            </button>
          ))}
        </div>
      )}
      {!toolsCollapsed && !readOnly && <div className="toolbar-group">
        <span className="toolbar-label">Tool:</span>
        {PAINT_TOOLS.map(({ tool, label }) => (
            <button
              key={tool}
              className={`toolbar-btn ${paintTool === tool ? "active" : ""}`}
              onClick={() => setPaintTool(tool)}
              title={tool}
              aria-pressed={paintTool === tool}
            >
              {label}
            </button>
        ))}
        {paintTool === "select" && tileClipboard && (
          <span style={{ fontSize: 10, color: "#40a02b", marginLeft: 4 }}>
            ✓ Copied ({tileClipboard.width}×{tileClipboard.height})
          </span>
        )}
      </div>}
      {toolsCollapsed && compactPanel === "edit" && !readOnly && (
        <div className="toolbar-group map-toolbar-quick-tools" role="group" aria-label="Quick map tools">
          <label className="map-toolbar-native-tool-select">
            <span>Tool</span>
            <select aria-label="Select active map tool" value={paintTool}
              onChange={event => setPaintTool(event.currentTarget.value as PaintTool)}>
              {PAINT_TOOLS.map(({ tool, label }) => (
                <option key={tool} value={tool}>{label}</option>
              ))}
            </select>
          </label>
          <button type="button" className={`toolbar-btn ${paintTool === "pan" ? "active" : ""}`}
            aria-label={paintTool === "pan" ? "Return to previous drawing tool" : "Temporarily pan map"}
            aria-pressed={paintTool === "pan"} onClick={togglePan}>
            {paintTool === "pan" ? "Resume draw" : "Pan map"}
          </button>
          <button type="button" className="toolbar-btn" aria-expanded={quickToolsExpanded}
            onClick={() => setQuickToolsExpanded(value => !value)}>{quickToolsExpanded ? "Less" : "More tools"}</button>
          {quickToolsExpanded && PAINT_TOOLS.map(({ tool, label }) => (
            <button
              key={tool}
              className={`toolbar-btn ${paintTool === tool ? "active" : ""}`}
              onClick={() => setPaintTool(tool)}
              title={`${label} map tool`}
              aria-label={`Use ${label.toLowerCase()} map tool`}
              aria-pressed={paintTool === tool}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {!toolsCollapsed && <div className="toolbar-separator" />}

      {/* Touch users have no physical Ctrl/Cmd+Z/Y keyboard. Keep map history
          accessible directly and route it through the same dirty-save path. */}
      {(!toolsCollapsed || compactPanel === "edit") && <div className="toolbar-group" aria-label="Map edit history">
        <button className="toolbar-btn" onClick={onUndo} disabled={historyDisabled || readOnly}
          title="Undo tile edit" aria-label="Undo tile edit">Undo</button>
        <button className="toolbar-btn" onClick={onRedo} disabled={historyDisabled || readOnly}
          title="Redo tile edit" aria-label="Redo tile edit">Redo</button>
      </div>}

      {!toolsCollapsed && <div className="toolbar-separator" />}

      {!toolsCollapsed && <div className="toolbar-group" role="group" aria-label="Map layers">
        <span className="toolbar-label">Layer:</span>
        {MAP_LAYERS.map(({ layer, label, name }) => (
          <button
            key={layer}
            className={`toolbar-btn ${selectedLayer === layer ? "active" : ""}`}
            onClick={() => setSelectedLayer(layer)}
            aria-label={name}
            aria-pressed={selectedLayer === layer}
            style={layer === 3 && selectedLayer === 3 ? { borderColor: "#fe640b", color: "#fe640b" } : {}}
          >
            {label}
          </button>
        ))}
      </div>}
      {toolsCollapsed && compactPanel === "edit" && (
        <div className="toolbar-group map-toolbar-quick-layers" role="group" aria-label="Quick map layers">
          <button type="button" className="toolbar-btn" aria-expanded={quickLayersExpanded}
            onClick={() => setQuickLayersExpanded(value => !value)}>{quickLayersExpanded ? "Hide layers" : `Layer: ${MAP_LAYERS.find(item => item.layer === selectedLayer)?.label ?? "All"}`}</button>
          {quickLayersExpanded && MAP_LAYERS.map(({ layer, label, name }) => (
            <button
              key={layer}
              className={`toolbar-btn ${selectedLayer === layer ? "active" : ""}`}
              onClick={() => setSelectedLayer(layer)}
              title={name}
              aria-label={name}
              aria-pressed={selectedLayer === layer}
              style={layer === 3 && selectedLayer === 3 ? { borderColor: "#fe640b", color: "#fe640b" } : {}}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {!toolsCollapsed && (
        <div className="toolbar-group map-layer-visibility" role="group" aria-label="Visible tile layers">
          <span className="toolbar-label">Visible:</span>
          {([0, 1, 2] as const).map((layer) => (
            <label className="toolbar-check" key={layer}>
              <input
                type="checkbox"
                aria-label={`Show tile layer ${layer + 1}`}
                checked={showLayers[layer]}
                disabled={selectedLayer === layer}
                onChange={(event) => onToggleLayerVisibility(layer, event.target.checked)}
              />
              L{layer + 1}
            </label>
          ))}
        </div>
      )}

      {toolsCollapsed && compactPanel === "view" && (
        <div className="toolbar-group map-layer-visibility" role="group" aria-label="Quick visible tile layers">
          {([0, 1, 2] as const).map((layer) => (
            <label className="toolbar-check" key={layer}>
              <input
                type="checkbox"
                aria-label={`Show tile layer ${layer + 1}`}
                checked={showLayers[layer]}
                disabled={selectedLayer === layer}
                onChange={(event) => onToggleLayerVisibility(layer, event.target.checked)}
              />
              L{layer + 1}
            </label>
          ))}
        </div>
      )}

      {toolsCollapsed && compactPanel === "view" && selectedLayer >= 0 && selectedLayer <= 2 && (
        <div className="toolbar-group" role="group" aria-label="Layer visibility presets">
          <button type="button" className="toolbar-btn"
            aria-label="Show all tile layers"
            disabled={showLayers.every(Boolean)}
            onClick={() => ([0, 1, 2] as const).forEach(layer => {
              if (!showLayers[layer]) onToggleLayerVisibility(layer, true);
            })}>Show all</button>
          <button type="button" className="toolbar-btn"
            aria-label={`Show only layer ${selectedLayer + 1}`}
            disabled={showLayers.every((visible, layer) => visible === (layer === selectedLayer))}
            onClick={() => ([0, 1, 2] as const).forEach(layer => {
              const shouldShow = layer === selectedLayer;
              if (showLayers[layer] !== shouldShow) onToggleLayerVisibility(layer, shouldShow);
            })}>Solo L{selectedLayer + 1}</button>
        </div>
      )}

      {toolsCollapsed && compactPanel === "view" && (
        <label className="toolbar-check map-toolbar-quick-grid">
          <input
            type="checkbox"
            aria-label="Show map grid"
            checked={showGrid}
            onChange={(event) => setShowGrid(event.target.checked)}
          />
          Grid
        </label>
      )}

      {!readOnly && (!toolsCollapsed ? paintTool === "select" : compactPanel === "edit") && (
        <div className="toolbar-group map-toolbar-selection-actions" role="group" aria-label="Tile selection actions">
          {toolsCollapsed && <button type="button" className="toolbar-btn" aria-expanded={selectionActionsExpanded}
            onClick={() => setSelectionActionsExpanded(value => !value)}>{selectionActionsExpanded ? "Less selection" : "Selection actions"}</button>}
          {(!toolsCollapsed || selectionActionsExpanded) && <>
          <button
            className="toolbar-btn"
            onClick={onCopyTiles}
            disabled={!canCopyTiles}
            aria-label="Copy selected tiles"
          >
            Copy
          </button>
          <button type="button" className="toolbar-btn"
            onClick={onClearTiles} disabled={!canClearTiles}
            aria-label="Clear selected map tiles">Clear tiles</button>
          <div className="toolbar-group" role="group" aria-label="Move or duplicate selected tiles">
            {([
              [-1, 0, "Left"], [0, -1, "Up"], [0, 1, "Down"], [1, 0, "Right"],
            ] as const).map(([dx, dy, direction]) => (
              <button key={direction} type="button" className="toolbar-btn"
                disabled={!canTranslateTiles}
                aria-label={`Move selected tiles ${direction.toLowerCase()}`}
                onClick={() => onTranslateTiles(dx, dy, "move")}>{direction}</button>
            ))}
            <button type="button" className="toolbar-btn" disabled={!canTranslateTiles}
              aria-label="Duplicate selected tiles right"
              onClick={() => onTranslateTiles(1, 0, "copy")}>Duplicate →</button>
          </div>
          {selectedLayer >= 0 && selectedLayer <= 2 && (
            <div className="toolbar-group" role="group" aria-label="Exchange selected map layers">
              {([0, 1, 2] as const).filter(layer => layer !== selectedLayer).map(layer => (
                <button key={layer} type="button" className="toolbar-btn"
                  disabled={!canTranslateTiles}
                  aria-label={`Swap selected layer ${selectedLayer + 1} with layer ${layer + 1}`}
                  onClick={() => onSwapSelectedLayers(layer)}>Swap L{layer + 1}</button>
              ))}
            </div>
          )}
          {onCopySelectedTilesToLayer && selectedLayer >= 0 && selectedLayer <= 2 && (
            <div className="toolbar-group" role="group" aria-label="Copy selection between map layers">
              {([0, 1, 2] as const).filter(layer => layer !== selectedLayer).map(layer => (
                <button key={layer} type="button" className="toolbar-btn"
                  disabled={!canTranslateTiles}
                  aria-label={`Copy selected tiles to layer ${layer + 1}`}
                  onClick={() => onCopySelectedTilesToLayer(layer, preserveEmptyPaste ? "preserve" : "replace")}>
                  Copy → L{layer + 1}
                </button>
              ))}
            </div>
          )}
          <button
            className="toolbar-btn"
            onClick={onPasteTiles}
            disabled={!canPasteTiles}
            aria-label="Paste tiles at cursor"
          >
            Paste
          </button>
          <label className="toolbar-check">
            <input type="checkbox" aria-label="Preserve existing tiles under empty clipboard cells"
              checked={preserveEmptyPaste}
              onChange={(event) => onPreserveEmptyPasteChange(event.currentTarget.checked)} />
            Keep underlying tiles
          </label>
          {tileClipboard && tileClipboard.width > 0 && (
            <span className="toolbar-label" role="status">
              Clipboard {tileClipboard.width}×{tileClipboard.height}
            </span>
          )}
          </>}
        </div>
      )}

      {!toolsCollapsed && <div className="toolbar-separator" />}

      {!toolsCollapsed && <div className="toolbar-group">
        <label className="toolbar-check">
          <input
            type="checkbox"
            checked={showGrid}
            onChange={(e) => setShowGrid(e.target.checked)}
          />
          Grid
        </label>
      </div>}

      {(!toolsCollapsed || compactPanel === "view") && <label className="toolbar-check toolbar-pin-toggle">
        <input
          type="checkbox"
          aria-label="Show event pins"
          checked={showEventPins}
          onChange={(e) => setShowEventPins(e.target.checked)}
        />
        Pins
      </label>}

      {(!toolsCollapsed || compactPanel === "view") && <label className="toolbar-check toolbar-collision-toggle">
        <input
          type="checkbox"
          aria-label="Show collision overlay"
          title="Green edges are passable; red edges are blocked"
          checked={showCollisionOverlay}
          onChange={(event) => setShowCollisionOverlay(event.target.checked)}
        />
        Collision
      </label>}

      {(!toolsCollapsed || compactPanel === "view") && onToggleNavigator && <button type="button" className={`toolbar-btn ${navigatorVisible ? "active" : ""}`}
        aria-label="Navigate to map coordinates" aria-expanded={navigatorVisible}
        aria-controls="map-coordinate-navigator" onClick={onToggleNavigator}>Go to X,Y</button>}
      {(!toolsCollapsed || compactPanel === "events") && <div className="toolbar-group map-toolbar-event-actions" role="group" aria-label="Map event placement">
        {!readOnly && canCreateEvent && onToggleEventPlacement && (
          <button type="button" className={`toolbar-btn ${eventPlacementMode === "create" ? "active" : ""}`}
            aria-label={eventPlacementMode === "create" ? "Cancel new event placement" : "Place new map event"}
            aria-pressed={eventPlacementMode === "create"}
            disabled={eventPlacementPending}
            onClick={() => onToggleEventPlacement("create")}
          >{eventPlacementMode === "create" ? "Cancel new" : "New event"}</button>
        )}
        {!readOnly && canPasteEvent && hasClipboardEvent && onToggleEventPlacement && (
          <button type="button" className={`toolbar-btn ${eventPlacementMode === "paste" ? "active" : ""}`}
            aria-label={eventPlacementMode === "paste" ? "Cancel copied event placement" : "Place copied map event"}
            aria-pressed={eventPlacementMode === "paste"}
            disabled={eventPlacementPending}
            onClick={() => onToggleEventPlacement("paste")}
          >{eventPlacementMode === "paste" ? "Cancel paste" : "Paste event"}</button>
        )}
      </div>}
      {eventPlacementMode && (!toolsCollapsed || compactPanel === "events") && (
        <span className="toolbar-label map-event-placement-hint" role="status">
          {eventPlacementPending ? "Saving event…" : `Tap an empty map tile to ${eventPlacementMode === "create" ? "create" : "paste"} an event. Tap the active button to cancel.`}
        </span>
      )}
      {(!toolsCollapsed || compactPanel === "events") && (
        <button
          className="toolbar-btn"
          aria-expanded={eventListVisible}
          aria-controls="map-event-list"
          onClick={onToggleEventList}
        >
          Events ({eventCount})
        </button>
      )}
      {(!toolsCollapsed || compactPanel === "events") && hasClipboardEvent && (
        <span className="toolbar-label" role="status">
          Event copied; long-press a map tile to paste
        </span>
      )}
      {(!toolsCollapsed || compactPanel === "events") && <span className="toolbar-label map-touch-hint">
        {paintTool === "rectangle" ? "Drag to preview a rectangle; release to paint. Two fingers cancel and zoom." : "Long-press a map tile for event actions"}
      </span>}

      {(!toolsCollapsed || compactPanel === "edit") && <button
        className="toolbar-btn"
        aria-pressed={paletteVisible}
        onClick={onTogglePalette}
      >
        {paletteVisible ? "Hide palette" : "Show palette"}
      </button>}

      {(!toolsCollapsed || compactPanel === "view") && <div className="toolbar-group toolbar-right">
        <span className="toolbar-label">
          Zoom: {Math.round(zoom * 100)}%
        </span>
        {readOnly && <span className="toolbar-label">Read-only preview</span>}
        <button type="button" className="toolbar-btn toolbar-btn-sm" aria-label="Zoom out map"
          disabled={zoom <= 0.25} onClick={() => setZoom(Math.max(0.25, Math.round((zoom - 0.25) * 100) / 100))}>−</button>
        <input type="range" className="map-zoom-slider" aria-label="Map zoom"
          min="0.25" max="4" step="0.25" value={zoom}
          onChange={event => setZoom(Number(event.target.value))} />
        <button type="button" className="toolbar-btn toolbar-btn-sm" aria-label="Zoom in map"
          disabled={zoom >= 4} onClick={() => setZoom(Math.min(4, Math.round((zoom + 0.25) * 100) / 100))}>+</button>
        <button type="button" className="toolbar-btn toolbar-btn-sm" onClick={() => setZoom(1)}
          title="Reset zoom" aria-label="Reset map zoom">1:1</button>
        {onFitMap && <button type="button" className="toolbar-btn toolbar-btn-sm"
          aria-label="Fit entire map to viewport" onClick={onFitMap}>Fit</button>}
      </div>}
    </div>
  );
}
