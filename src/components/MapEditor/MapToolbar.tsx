import { useEffect, useState } from "react";
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
}: MapToolbarProps) {
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
    <div className="map-editor-toolbar">
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
      {toolsCollapsed && !readOnly && (
        <div className="toolbar-group map-toolbar-quick-tools" role="group" aria-label="Quick map tools">
          {PAINT_TOOLS.map(({ tool, label }) => (
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

      <div className="toolbar-separator" />

      {/* Touch users have no physical Ctrl/Cmd+Z/Y keyboard. Keep map history
          accessible directly and route it through the same dirty-save path. */}
      <div className="toolbar-group" aria-label="Map edit history">
        <button className="toolbar-btn" onClick={onUndo} disabled={historyDisabled || readOnly}
          title="Undo tile edit" aria-label="Undo tile edit">Undo</button>
        <button className="toolbar-btn" onClick={onRedo} disabled={historyDisabled || readOnly}
          title="Redo tile edit" aria-label="Redo tile edit">Redo</button>
      </div>

      <div className="toolbar-separator" />

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
      {toolsCollapsed && (
        <div className="toolbar-group map-toolbar-quick-layers" role="group" aria-label="Quick map layers">
          {MAP_LAYERS.map(({ layer, label, name }) => (
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

      {toolsCollapsed && (
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

      {!readOnly && (toolsCollapsed || paintTool === "select") && (
        <div className="toolbar-group map-toolbar-selection-actions" role="group" aria-label="Tile selection actions">
          <button
            className="toolbar-btn"
            onClick={onCopyTiles}
            disabled={!canCopyTiles}
            aria-label="Copy selected tiles"
          >
            Copy
          </button>
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
        </div>
      )}

      <div className="toolbar-separator" />

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

      <label className="toolbar-check toolbar-pin-toggle">
        <input
          type="checkbox"
          aria-label="Show event pins"
          checked={showEventPins}
          onChange={(e) => setShowEventPins(e.target.checked)}
        />
        Pins
      </label>

      <label className="toolbar-check toolbar-collision-toggle">
        <input
          type="checkbox"
          aria-label="Show collision overlay"
          title="Green edges are passable; red edges are blocked"
          checked={showCollisionOverlay}
          onChange={(event) => setShowCollisionOverlay(event.target.checked)}
        />
        Collision
      </label>

      {eventCount > 0 && (
        <button
          className="toolbar-btn"
          aria-expanded={eventListVisible}
          aria-controls="map-event-list"
          onClick={onToggleEventList}
        >
          Events ({eventCount})
        </button>
      )}
      {hasClipboardEvent && (
        <span className="toolbar-label" role="status">
          Event copied; long-press a map tile to paste
        </span>
      )}
      <span className="toolbar-label map-touch-hint">
        {paintTool === "rectangle" ? "Drag to preview a rectangle; release to paint. Two fingers cancel and zoom." : "Long-press a map tile for event actions"}
      </span>

      <button
        className="toolbar-btn"
        aria-pressed={paletteVisible}
        onClick={onTogglePalette}
      >
        {paletteVisible ? "Hide palette" : "Show palette"}
      </button>

      <div className="toolbar-group toolbar-right">
        <span className="toolbar-label">
          Zoom: {Math.round(zoom * 100)}%
        </span>
        {readOnly && <span className="toolbar-label">Read-only preview</span>}
        <button
          className="toolbar-btn toolbar-btn-sm"
          onClick={() => setZoom(1)}
          title="Reset zoom"
        >
          1:1
        </button>
      </div>
    </div>
  );
}
