import { useEffect, useState } from "react";
import type { PaintTool } from "../../types";
import type { TileClipboard } from "../../services/mapEditor";

interface MapToolbarProps {
  paintTool: PaintTool;
  setPaintTool: (tool: PaintTool) => void;
  tileClipboard: TileClipboard | null;
  selectedLayer: number;
  setSelectedLayer: (layer: number) => void;
  showGrid: boolean;
  setShowGrid: (show: boolean) => void;
  zoom: number;
  setZoom: (zoom: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  historyDisabled?: boolean;
  readOnly?: boolean;
  showEventPins: boolean;
  setShowEventPins: (show: boolean) => void;
  paletteVisible: boolean;
  onTogglePalette: () => void;
  eventCount: number;
  eventListVisible: boolean;
  onToggleEventList: () => void;
}

export function MapToolbar({
  paintTool,
  setPaintTool,
  tileClipboard,
  selectedLayer,
  setSelectedLayer,
  showGrid,
  setShowGrid,
  zoom,
  setZoom,
  onUndo,
  onRedo,
  historyDisabled = false,
  readOnly = false,
  showEventPins,
  setShowEventPins,
  paletteVisible,
  onTogglePalette,
  eventCount,
  eventListVisible,
  onToggleEventList,
}: MapToolbarProps) {
  const [toolsCollapsed, setToolsCollapsed] = useState(
    () => typeof window.matchMedia === "function" && window.matchMedia("(max-width: 640px)").matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const narrowViewport = window.matchMedia("(max-width: 640px)");
    const updateCollapsedState = (event: MediaQueryListEvent) => {
      setToolsCollapsed(event.matches);
    };
    narrowViewport.addEventListener("change", updateCollapsedState);
    return () => narrowViewport.removeEventListener("change", updateCollapsedState);
  }, []);

  return (
    <div className="map-editor-toolbar">
      <button
        className="toolbar-btn"
        aria-expanded={!toolsCollapsed}
        onClick={() => setToolsCollapsed((collapsed) => !collapsed)}
      >
        {toolsCollapsed ? "Tools ▸" : "Tools ▾"}
      </button>
      {!toolsCollapsed && !readOnly && <div className="toolbar-group">
        <span className="toolbar-label">Tool:</span>
        {(["pencil", "rectangle", "bucket", "eraser", "select", "pan"] as PaintTool[]).map(
          (tool) => (
            <button
              key={tool}
              className={`toolbar-btn ${paintTool === tool ? "active" : ""}`}
              onClick={() => setPaintTool(tool)}
              title={tool}
            >
              {tool === "pencil"
                ? "Pen"
                : tool === "rectangle"
                ? "Rect"
                : tool === "bucket"
                ? "Fill"
                : tool === "eraser"
                ? "Erase"
                : tool === "pan"
                ? "Pan"
                : "Sel"}
            </button>
          )
        )}
        {paintTool === "select" && tileClipboard && (
          <span style={{ fontSize: 10, color: "#40a02b", marginLeft: 4 }}>
            ✓ Copied ({tileClipboard.width}×{tileClipboard.height})
          </span>
        )}
      </div>}

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

      {!toolsCollapsed && <div className="toolbar-group">
        <span className="toolbar-label">Layer:</span>
        {[0, 1, 2].map((l) => (
          <button
            key={l}
            className={`toolbar-btn ${selectedLayer === l ? "active" : ""}`}
            onClick={() => setSelectedLayer(l)}
          >
            L{l + 1}
          </button>
        ))}
        <button
          className={`toolbar-btn ${selectedLayer === 3 ? "active" : ""}`}
          onClick={() => setSelectedLayer(3)}
          title="Events layer — view and select events"
          style={selectedLayer === 3 ? { borderColor: "#fe640b", color: "#fe640b" } : {}}
        >
          Ev
        </button>
        <button
          className={`toolbar-btn ${selectedLayer === -1 ? "active" : ""}`}
          onClick={() => setSelectedLayer(-1)}
          title="Show all layers at full opacity"
        >
          All
        </button>
      </div>}

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
