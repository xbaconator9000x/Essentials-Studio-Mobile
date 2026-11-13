import { useCallback, useEffect, useRef, useState } from "react";
import type { TilesetRenderInfo } from "../../types";
import { TILE_SIZE, FIRST_REGULAR_TILE } from "../../types";
import { renderAutotilePattern } from "../../services/autotileData";
import "./TilesetPalette.css";

interface Props {
  tilesetInfo: TilesetRenderInfo | null;
  tilesetImage: HTMLImageElement | null;
  autotileImages: (HTMLImageElement | null)[];
  selectedTileId: number;
  onSelectTile: (tileId: number) => void;
  onClose: () => void;
}

type PaletteTab = "tiles" | "autotiles" | "properties";

const TILESET_COLUMNS = 8;
function regularTileIdAt(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  clientX: number,
  clientY: number,
): number | null {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0 ||
      clientX < rect.left || clientX >= rect.right || clientY < rect.top || clientY >= rect.bottom) return null;
  const x = Math.floor((clientX - rect.left) * canvas.width / rect.width / TILE_SIZE);
  const y = Math.floor((clientY - rect.top) * canvas.height / rect.height / TILE_SIZE);
  const cols = Math.min(TILESET_COLUMNS, Math.floor((image.naturalWidth || image.width) / TILE_SIZE));
  const rows = Math.floor((image.naturalHeight || image.height) / TILE_SIZE);
  if (x < 0 || x >= cols || y < 0 || y >= rows) return null;
  const tileId = FIRST_REGULAR_TILE + y * TILESET_COLUMNS + x;
  return tileId <= 32767 ? tileId : null;
}

/**
 * Tileset palette panel.
 *
 * Displays the tileset image as a clickable grid of 32×32 tiles
 * (8 columns wide, matching RMXP's tileset layout).
 * Also shows autotile previews and tile properties.
 */
export function TilesetPalette({
  tilesetInfo,
  tilesetImage,
  autotileImages,
  selectedTileId,
  onSelectTile,
  onClose,
}: Props) {
  const [activeTab, setActiveTab] = useState<PaletteTab>("tiles");
  const [recentTileIds, setRecentTileIds] = useState<number[]>([]);
  const selectTile = useCallback((id: number) => {
    onSelectTile(id);
    setRecentTileIds(previous => [id, ...previous.filter(tile => tile !== id)].slice(0, 8));
  }, [onSelectTile]);
  useEffect(() => { setRecentTileIds([]); }, [tilesetInfo]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoverTileId, setHoverTileId] = useState<number | null>(null);
  const [tileIdInput, setTileIdInput] = useState(String(selectedTileId));
  const paletteScrollRef = useRef<HTMLDivElement>(null);
  const tileRows = tilesetImage
    ? Math.floor((tilesetImage.naturalHeight || tilesetImage.height) / TILE_SIZE) : 0;
  const tileCols = tilesetImage
    ? Math.min(TILESET_COLUMNS, Math.floor((tilesetImage.naturalWidth || tilesetImage.width) / TILE_SIZE)) : 0;
  const tileIdIsValid = useCallback((id: number) => Number.isSafeInteger(id)
    && id >= FIRST_REGULAR_TILE && id <= 32767
    && tileCols > 0 && tileRows > 0
    && (id - FIRST_REGULAR_TILE) % TILESET_COLUMNS < tileCols
    && Math.floor((id - FIRST_REGULAR_TILE) / TILESET_COLUMNS) < tileRows, [tileCols, tileRows]);
  const inputTileId = /^[0-9]+$/.test(tileIdInput.trim()) ? Number(tileIdInput.trim()) : NaN;
  const canJump = tileIdIsValid(inputTileId);

  useEffect(() => {
    setTileIdInput(String(selectedTileId));
  }, [selectedTileId]);

  useEffect(() => {
    if (activeTab !== "tiles" || !tileIdIsValid(selectedTileId)) return;
    const panel = paletteScrollRef.current;
    if (!panel || panel.clientHeight <= 0) return;
    const tileTop = Math.floor((selectedTileId - FIRST_REGULAR_TILE) / TILESET_COLUMNS) * TILE_SIZE;
    if (tileTop < panel.scrollTop) panel.scrollTop = tileTop;
    else if (tileTop + TILE_SIZE > panel.scrollTop + panel.clientHeight)
      panel.scrollTop = tileTop + TILE_SIZE - panel.clientHeight;
  }, [selectedTileId, activeTab, tileIdIsValid]);

  const navigateTile = (dx: number, dy: number) => {
    if (!tileCols || !tileRows) return;
    const index = tileIdIsValid(selectedTileId) ? selectedTileId - FIRST_REGULAR_TILE : 0;
    const x = Math.max(0, Math.min(tileCols - 1, index % TILESET_COLUMNS + dx));
    const y = Math.max(0, Math.min(tileRows - 1, Math.floor(index / TILESET_COLUMNS) + dy));
    const target = FIRST_REGULAR_TILE + y * TILESET_COLUMNS + x;
    if (tileIdIsValid(target)) selectTile(target);
  };

  // Render the tileset grid onto canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !tilesetImage || activeTab !== "tiles") return;

    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;

    // Canvas is 8 tiles wide (256px), height matches tileset
    const cols = 8;
    const rows = Math.ceil(tilesetImage.height / TILE_SIZE);
    canvas.width = cols * TILE_SIZE;
    canvas.height = rows * TILE_SIZE;

    // Draw the tileset image
    ctx.drawImage(tilesetImage, 0, 0);

    // Draw grid lines
    ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= cols; x++) {
      ctx.beginPath();
      ctx.moveTo(x * TILE_SIZE, 0);
      ctx.lineTo(x * TILE_SIZE, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y <= rows; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * TILE_SIZE);
      ctx.lineTo(canvas.width, y * TILE_SIZE);
      ctx.stroke();
    }

    // Highlight selected tile
    if (selectedTileId >= FIRST_REGULAR_TILE) {
      const idx = selectedTileId - FIRST_REGULAR_TILE;
      const sx = (idx % 8) * TILE_SIZE;
      const sy = Math.floor(idx / 8) * TILE_SIZE;
      ctx.strokeStyle = "#1e66f5";
      ctx.lineWidth = 2;
      ctx.strokeRect(sx + 1, sy + 1, TILE_SIZE - 2, TILE_SIZE - 2);
    }

    // Highlight hovered tile
    if (hoverTileId !== null && hoverTileId >= FIRST_REGULAR_TILE) {
      const idx = hoverTileId - FIRST_REGULAR_TILE;
      const sx = (idx % 8) * TILE_SIZE;
      const sy = Math.floor(idx / 8) * TILE_SIZE;
      ctx.fillStyle = "rgba(137, 180, 250, 0.2)";
      ctx.fillRect(sx, sy, TILE_SIZE, TILE_SIZE);
    }
  }, [tilesetImage, selectedTileId, hoverTileId, activeTab]);

  // Use one bounds-checked hit test for mouse, touch-generated click and hover.
  const handleTilesetClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas || !tilesetImage) return;
      const tileId = regularTileIdAt(canvas, tilesetImage, e.clientX, e.clientY);
      if (tileId !== null) selectTile(tileId);
    },
    [selectTile, tilesetImage],
  );

  const handleTilesetMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      setHoverTileId(canvas && tilesetImage ? regularTileIdAt(canvas, tilesetImage, e.clientX, e.clientY) : null);
    },
    [tilesetImage],
  );

  const handleTilesetKey = useCallback((e: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (!tilesetImage || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
    const cols = Math.min(TILESET_COLUMNS, Math.floor((tilesetImage.naturalWidth || tilesetImage.width) / TILE_SIZE));
    const rows = Math.floor((tilesetImage.naturalHeight || tilesetImage.height) / TILE_SIZE);
    if (cols < 1 || rows < 1) return;
    e.preventDefault();
    const index = selectedTileId - FIRST_REGULAR_TILE;
    let x = index >= 0 ? index % TILESET_COLUMNS : 0;
    let y = index >= 0 ? Math.floor(index / TILESET_COLUMNS) : 0;
    x = Math.max(0, Math.min(cols - 1, x));
    y = Math.max(0, Math.min(rows - 1, y));
    if (e.key === "ArrowLeft") x--;
    if (e.key === "ArrowRight") x++;
    if (e.key === "ArrowUp") y--;
    if (e.key === "ArrowDown") y++;
    if (e.key === "Home") { x = 0; y = 0; }
    if (e.key === "End") { x = cols - 1; y = rows - 1; }
    x = Math.max(0, Math.min(cols - 1, x));
    y = Math.max(0, Math.min(rows - 1, y));
    const tileId = FIRST_REGULAR_TILE + y * TILESET_COLUMNS + x;
    if (tileId <= 32767) selectTile(tileId);
  }, [selectTile, selectedTileId, tilesetImage]);

  // Handle autotile selection
  const handleAutotileClick = useCallback(
    (slot: number) => {
      // Select the "full" autotile pattern (pattern 0 = all same)
      // tileId = (slot + 1) * 48
      const tileId = (slot + 1) * 48;
      selectTile(tileId);
    },
    [onSelectTile]
  );

  if (!tilesetInfo) {
    return (
      <div className="tileset-palette">
        <div className="palette-header">
          <span>Tileset</span>
          <button className="palette-close" onClick={onClose} aria-label="Close tileset palette">×</button>
        </div>
        <div className="palette-empty">No tileset loaded</div>
      </div>
    );
  }

  // Tile info for status display
  const displayTileId = hoverTileId ?? selectedTileId;
  const priority =
    displayTileId < tilesetInfo.priorities.length
      ? tilesetInfo.priorities[displayTileId]
      : 0;
  const passage =
    displayTileId < tilesetInfo.passages.length
      ? tilesetInfo.passages[displayTileId]
      : 0;
  const terrain =
    displayTileId < tilesetInfo.terrain_tags.length
      ? tilesetInfo.terrain_tags[displayTileId]
      : 0;

  return (
    <div className="tileset-palette">
      <div className="palette-header">
        <span>{tilesetInfo.name || "Tileset"}</span>
        <button className="palette-close" onClick={onClose} aria-label="Close tileset palette">×</button>
      </div>

      <div className="palette-recent-tiles" role="group" aria-label="Recently selected tiles">
        <span className="palette-recent-label">Recent</span>
        {recentTileIds.length ? recentTileIds.map(id => (
          <button key={id} type="button" className={selectedTileId === id ? "active" : ""}
            aria-label={`Select recent tile ${id}`} aria-pressed={selectedTileId === id}
            onClick={() => { selectTile(id); setActiveTab(id < FIRST_REGULAR_TILE ? "autotiles" : "tiles"); }}>
            {id}
          </button>
        )) : <span className="palette-recent-label">Select tiles to build shortcuts</span>}
      </div>

      {/* Tab bar */}
      <div className="palette-tabs">
        <button
          className={activeTab === "tiles" ? "active" : ""}
          onClick={() => setActiveTab("tiles")}
        >
          Tiles
        </button>
        <button
          className={activeTab === "autotiles" ? "active" : ""}
          onClick={() => setActiveTab("autotiles")}
        >
          Auto
        </button>
        <button
          className={activeTab === "properties" ? "active" : ""}
          onClick={() => setActiveTab("properties")}
        >
          Props
        </button>
      </div>

      {/* Tiles tab: keyboard and finger-accessible native RMXP tile IDs. */}
      {activeTab === "tiles" && (
        <>
          {tilesetImage && (
            <div className="palette-tile-navigation" role="group" aria-label="Tile selection controls">
              <form onSubmit={event => {
                event.preventDefault();
                if (canJump) selectTile(inputTileId);
              }}>
                <label htmlFor="palette-tile-id">Tile ID</label>
                <input id="palette-tile-id" type="number" inputMode="numeric"
                  min={FIRST_REGULAR_TILE} max={32767} step={1} value={tileIdInput}
                  aria-label="Jump to tile ID" onChange={event => setTileIdInput(event.target.value)} />
                <button type="submit" disabled={!canJump} aria-label="Select tile ID">Go</button>
              </form>
              <div className="palette-tile-nudge" role="group" aria-label="Tile navigation">
                <button type="button" aria-label="Tile left" onClick={() => navigateTile(-1, 0)}>←</button>
                <button type="button" aria-label="Tile up" onClick={() => navigateTile(0, -1)}>↑</button>
                <button type="button" aria-label="Tile down" onClick={() => navigateTile(0, 1)}>↓</button>
                <button type="button" aria-label="Tile right" onClick={() => navigateTile(1, 0)}>→</button>
              </div>
            </div>
          )}
          <div className="palette-scroll" ref={paletteScrollRef}>
          {tilesetImage ? (
            <canvas
              ref={canvasRef}
              className="tileset-canvas"
              tabIndex={0}
              aria-label="Tileset tile picker; use arrow keys to select a tile"
              onKeyDown={handleTilesetKey}
              onClick={handleTilesetClick}
              onMouseMove={handleTilesetMove}
              onMouseLeave={() => setHoverTileId(null)}
            />
          ) : (
            <div className="palette-empty">
              <p>Tileset image: {tilesetInfo.tileset_name}</p>
              <p className="dim">Image not loaded</p>
            </div>
          )}
          </div>
        </>
      )}

      {/* Autotiles tab */}
      {activeTab === "autotiles" && (
        <div className="palette-scroll">
          <div className="autotile-list">
            {tilesetInfo.autotile_names.map((name, idx) => (
              <button
                type="button"
                key={idx}
                disabled={!name}
                aria-label={`Autotile ${idx + 1}: ${name || "empty"}`}
                aria-pressed={selectedTileId >= (idx + 1) * 48 && selectedTileId < (idx + 2) * 48}
                className={`autotile-item ${
                  selectedTileId >= (idx + 1) * 48 &&
                  selectedTileId < (idx + 2) * 48
                    ? "selected"
                    : ""
                }`}
                onClick={() => handleAutotileClick(idx)}
              >
                <div className="autotile-preview">
                  {autotileImages[idx] ? (
                    <AutotilePreview image={autotileImages[idx]!} />
                  ) : (
                    <div className="autotile-empty-preview" />
                  )}
                </div>
                <div className="autotile-info">
                  <span className="autotile-slot">#{idx}</span>
                  <span className="autotile-name">
                    {name || "(empty)"}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Properties tab */}
      {activeTab === "properties" && (
        <div className="palette-scroll">
          <div className="tile-properties">
            <div className="prop-row">
              <span className="prop-label">Tile ID</span>
              <span className="prop-value">{displayTileId}</span>
            </div>
            <div className="prop-row">
              <span className="prop-label">Priority</span>
              <span className="prop-value">{priority}</span>
            </div>
            <div className="prop-row">
              <span className="prop-label">Passage</span>
              <span className="prop-value">
                {passage === 0
                  ? "Passable"
                  : passage === 0xf
                  ? "Impassable"
                  : `Partial (0x${passage.toString(16)})`}
              </span>
            </div>
            <div className="prop-row">
              <span className="prop-label">Terrain</span>
              <span className="prop-value">{terrain}</span>
            </div>
          </div>
        </div>
      )}

      {/* Tile info status */}
      <div className="palette-status">
        <span>ID: {displayTileId}</span>
        <span>P: {priority}</span>
      </div>
    </div>
  );
}

/** Renders a 32×32 preview of autotile pattern 0 (all neighbors match). */
function AutotilePreview({ image }: { image: HTMLImageElement }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;

    canvas.width = 32;
    canvas.height = 32;

    // Composite 4 mini-tiles for pattern 0 using the AUTOTILE_RECTS lookup
    renderAutotilePattern(ctx, image, 0, 0, 0);
  }, [image]);

  return <canvas ref={canvasRef} className="autotile-canvas" />;
}
