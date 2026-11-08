import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MapRenderData, TilesetRenderInfo, PaintTool } from "../../types";
import { MapRenderer, type EventMarker, type RenderOptions } from "../../services/mapRenderer";
import { TILE_SIZE } from "../../types";
import {
  paintTile,
  paintRectangle,
  floodFill,
  eraseTile,
  copyTileRegion,
  pasteTileRegion,
  UndoStack,
  type MapAction,
  type TileClipboard,
} from "../../services/mapEditor";
import {
  resolveMapTapTarget,
  TouchGestureMachine,
  clampMapViewport,
  centerMapViewportOnTile,
  rasterizeTileLine,
  type TouchGestureAction,
} from "../../services/mapGestures";
import { loadCharacterImage } from "../../services/imageLoader";
import { replayMapHistory } from "../../services/mapHistory";
import { shouldHandleMapShortcut } from "../../services/mapShortcutGuards";
import {
  readMapEventPinsVisible,
  writeMapEventPinsVisible,
} from "../../services/mapEditorPreferences";
import { MapScrollbars } from "./MapScrollbars";
import { MapToolbar } from "./MapToolbar";
import { MapEventList } from "./MapEventList";
import { MapContextMenu } from "./MapContextMenu";
import "./MapEditor.css";

interface Props {
  mapData: MapRenderData | null;
  tilesetInfo: TilesetRenderInfo | null;
  tilesetImage: HTMLImageElement | null;
  autotileImages: (HTMLImageElement | null)[];
  projectPath?: string;
  selectedTileId: number;
  currentMapId?: number;
  startPosition?: { mapId: number; x: number; y: number };
  hasClipboardEvent?: boolean;
  shortcutsDisabled?: boolean;
  readOnly?: boolean;
  onMapDirty: () => void;
  onOpenEvent?: (eventId: number, eventName: string) => void;
  onCreateEvent?: (x: number, y: number) => void;
  onDeleteEvent?: (eventId: number, eventName: string) => void;
  onSetStartPosition?: (x: number, y: number) => Promise<void>;
  onCopyEvent?: (eventId: number) => Promise<void>;
  onPasteEvent?: (x: number, y: number) => Promise<void>;
  paletteVisible: boolean;
  onTogglePalette: () => void;
  graphicsRevision: number;
}

export function MapEditor({
  mapData,
  tilesetInfo,
  tilesetImage,
  autotileImages,
  projectPath,
  selectedTileId,
  currentMapId,
  startPosition,
  hasClipboardEvent,
  shortcutsDisabled = false,
  readOnly = false,
  onMapDirty,
  onOpenEvent,
  onCreateEvent,
  onDeleteEvent,
  onSetStartPosition,
  onCopyEvent,
  onPasteEvent,
  paletteVisible,
  onTogglePalette,
  graphicsRevision,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<MapRenderer | null>(null);
  const animFrameRef = useRef<number>(0);
  const undoStackRef = useRef(new UndoStack());
  const touchGesturesRef = useRef(new TouchGestureMachine());

  // Viewport state
  const [viewportX, setViewportX] = useState(0);
  const [viewportY, setViewportY] = useState(0);
  const [zoom, setZoom] = useState(1.0);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  // Editor state
  const [showGrid, setShowGrid] = useState(true);
  const [showEventPins, setShowEventPins] = useState(
    () => readMapEventPinsVisible(projectPath, currentMapId),
  );
  const [showEventList, setShowEventList] = useState(false);
  const [showLayers, _setShowLayers] = useState<[boolean, boolean, boolean]>([
    true,
    true,
    true,
  ]);
  const [selectedLayer, setSelectedLayer] = useState(0);
  const [paintTool, setPaintTool] = useState<PaintTool>("pencil");
  const [cursorTile, setCursorTile] = useState<{
    x: number;
    y: number;
  } | null>(null);

  // Painting state
  const isPainting = useRef(false);
  const isTouchPainting = useRef(false);
  const paintChanges = useRef<MapAction["changes"]>([]);
  const mousePaintLastTile = useRef<{ x: number; y: number } | null>(null);
  const rectStart = useRef<{ x: number; y: number } | null>(null);

  // Panning state
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });
  const panViewport = useRef({ x: 0, y: 0 });

  // Selection state (tile select tool)
  const [selectionStart, setSelectionStart] = useState<{ x: number; y: number } | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<{ x: number; y: number } | null>(null);
  const isSelecting = useRef(false);
  const [tileClipboard, setTileClipboard] = useState<TileClipboard | null>(null);

  // Force re-render trigger (the value is unused; setting it re-runs the
  // component so the render-params ref and derived UI refresh).
  const [, setRenderTick] = useState(0);

  // Tile context menu state (right-click on any tile)
  const [contextMenu, setContextMenu] = useState<{
    x: number;           // screen x
    y: number;           // screen y
    tileX: number;       // tile col
    tileY: number;       // tile row
    event: { id: number; name: string } | null;
  } | null>(null);

  // Character sprite cache: graphicName → HTMLImageElement
  const [characterImages, setCharacterImages] = useState<Map<string, HTMLImageElement | null>>(new Map());
  const graphicsRevisionRef = useRef(graphicsRevision);

  // Initialize renderer — canvas is ALWAYS in the DOM now
  useEffect(() => {
    if (!canvasRef.current) return;
    rendererRef.current = new MapRenderer(canvasRef.current);
  }, []);

  // Clear selection when switching away from select tool
  useEffect(() => {
    if (paintTool !== "select") {
      setSelectionStart(null);
      setSelectionEnd(null);
    }
  }, [paintTool]);

  // Update renderer with map data
  useEffect(() => {
    if (!rendererRef.current || !mapData) return;
    rendererRef.current.setMapData(
      mapData.tiles,
      mapData.width,
      mapData.height
    );
    setViewportX(0);
    setViewportY(0);
    undoStackRef.current.clear();
  }, [mapData]);

  // Update renderer with tileset image
  useEffect(() => {
    if (!rendererRef.current) return;
    if (tilesetImage) {
      rendererRef.current.setTilesetImage(tilesetImage);
    }
  }, [tilesetImage]);

  // Update renderer with autotile images
  useEffect(() => {
    if (!rendererRef.current) return;
    autotileImages.forEach((img, i) => {
      rendererRef.current!.setAutotileImage(i, img);
    });
  }, [autotileImages]);

  // Update renderer with tileset priorities
  useEffect(() => {
    if (!rendererRef.current || !tilesetInfo) return;
    rendererRef.current.setPriorities(tilesetInfo.priorities);
  }, [tilesetInfo]);

  // Drop cached character sprites when switching maps/projects so the cache
  // doesn't accumulate every sprite visited this session. (Re-loading the same
  // map keeps currentMapId stable, so its sprites are preserved.)
  useEffect(() => {
    setCharacterImages(new Map());
  }, [currentMapId, projectPath]);

  useEffect(() => {
    setShowEventPins(readMapEventPinsVisible(projectPath, currentMapId));
  }, [currentMapId, projectPath]);

  const updateShowEventPins = useCallback((visible: boolean) => {
    setShowEventPins(visible);
    writeMapEventPinsVisible(projectPath, currentMapId, visible);
  }, [currentMapId, projectPath]);

  // Load character sprite images for events
  useEffect(() => {
    if (!mapData || !projectPath) return;

    // Collect unique character graphic names from events
    const names = new Set<string>();
    for (const evt of mapData.events) {
      if (evt.graphic_name) names.add(evt.graphic_name);
    }

    if (names.size === 0) return;

    // Load each character image (skip already-loaded ones)
    const graphicsChanged = graphicsRevisionRef.current !== graphicsRevision;
    graphicsRevisionRef.current = graphicsRevision;
    const toLoad = [...names].filter((n) => graphicsChanged || !characterImages.has(n));
    if (toLoad.length === 0) return;

    let cancelled = false;
    (async () => {
      const results = await Promise.all(
        toLoad.map(async (name) => {
          const img = await loadCharacterImage(projectPath, name);
          return [name, img] as [string, HTMLImageElement | null];
        })
      );
      if (cancelled) return;
      setCharacterImages((prev) => {
        const next = new Map(prev);
        for (const [name, img] of results) {
          next.set(name, img);
        }
        return next;
      });
    })();

    return () => { cancelled = true; };
  }, [mapData, projectPath, graphicsRevision]);

  // Event markers only depend on the map data and loaded sprite images, not on
  // viewport/zoom — memoize so panning doesn't rebuild this array every frame.
  const events: EventMarker[] = useMemo(
    () =>
      mapData
        ? mapData.events.map((e) => ({
            id: e.id,
            name: e.name,
            x: e.x,
            y: e.y,
            graphicName: e.graphic_name,
            graphicDirection: e.graphic_direction,
            graphicPattern: e.graphic_pattern,
            graphicImage: e.graphic_name ? characterImages.get(e.graphic_name) : null,
          }))
        : [],
    [mapData, characterImages]
  );

  // Mirror the latest render params into a ref every render. The persistent RAF
  // loop below reads from this ref, so pan/zoom/selection changes never tear down
  // and recreate the animation loop (which previously happened on every mousemove).
  const renderStateRef = useRef<{ options: RenderOptions; events: EventMarker[] } | null>(null);
  const startMarker =
    currentMapId !== undefined && startPosition && currentMapId === startPosition.mapId
      ? { x: startPosition.x, y: startPosition.y }
      : undefined;
  const selectionRect = (selectionStart && selectionEnd)
    ? { x1: selectionStart.x, y1: selectionStart.y, x2: selectionEnd.x, y2: selectionEnd.y }
    : null;
  const constrainedViewport = mapData
    ? clampMapViewport(
        viewportX,
        viewportY,
        mapData.width,
        mapData.height,
        canvasSize.width,
        canvasSize.height,
        zoom,
      )
    : { x: viewportX, y: viewportY };
  renderStateRef.current = {
    options: {
      showGrid,
      showEvents: showEventPins,
      showLayer: showLayers,
      activeLayer: selectedLayer,
      zoom,
      viewportX: constrainedViewport.x,
      viewportY: constrainedViewport.y,
      startMarker,
      selectionRect,
    },
    events,
  };

  // Animation loop — started once per map; reads live params from the ref above.
  useEffect(() => {
    if (!rendererRef.current || !mapData) return;
    const animate = (time: number) => {
      const st = renderStateRef.current;
      if (st) rendererRef.current?.render(time, st.options, st.events);
      animFrameRef.current = requestAnimationFrame(animate);
    };
    animFrameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [mapData]);

  // Resize canvas to fill container
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !canvas.parentElement) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setCanvasSize({ width, height });
          canvas.width = width * window.devicePixelRatio;
          canvas.height = height * window.devicePixelRatio;
          canvas.style.width = `${width}px`;
          canvas.style.height = `${height}px`;
        }
      }
    });

    observer.observe(canvas.parentElement);
    return () => observer.disconnect();
  }, []);

  const handleHistory = useCallback((direction: "undo" | "redo"): boolean => {
    if (!mapData || shortcutsDisabled) return false;
    if (!replayMapHistory(mapData, undoStackRef.current, direction, onMapDirty)) return false;
    rendererRef.current?.setMapData(mapData.tiles, mapData.width, mapData.height);
    setRenderTick((t) => t + 1);
    return true;
  }, [mapData, shortcutsDisabled, onMapDirty]);

  // Keyboard shortcuts only apply when the map is the active editor.
  // Never intercept Ctrl/Cmd+Z/C/V inside an event dialogue, PBS field,
  // script textarea or any other text-editing surface.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!mapData || readOnly || e.defaultPrevented || e.altKey ||
          !(e.ctrlKey || e.metaKey) ||
          !shouldHandleMapShortcut(e.target, shortcutsDisabled)) return;

      const key = e.key.toLowerCase();
      if (key === "z" || key === "y") {
        const direction = key === "y" || e.shiftKey ? "redo" : "undo";
        if (handleHistory(direction)) e.preventDefault();
        return;
      }

      if (key === "c" && selectionStart && selectionEnd) {
        e.preventDefault();
        setTileClipboard(copyTileRegion(
          mapData,
          { x1: selectionStart.x, y1: selectionStart.y, x2: selectionEnd.x, y2: selectionEnd.y },
          selectedLayer,
        ));
        return;
      }

      if (key === "v" && tileClipboard) {
        const origin = cursorTile ?? selectionStart;
        if (!origin) return;
        e.preventDefault();
        const changes = pasteTileRegion(mapData, tileClipboard, origin, selectedLayer);
        if (changes.length > 0) {
          undoStackRef.current.push({ type: "paste", changes, timestamp: Date.now() });
          rendererRef.current?.setMapData(mapData.tiles, mapData.width, mapData.height);
          setRenderTick((t) => t + 1);
          onMapDirty();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mapData, selectedLayer, onMapDirty, shortcutsDisabled, readOnly,
      selectionStart, selectionEnd, cursorTile, tileClipboard, handleHistory]);

  // Convert screen position to tile coordinates
  const screenToTile = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas || !rendererRef.current) return null;

      const rect = canvas.getBoundingClientRect();
      const viewport = mapData
        ? clampMapViewport(
            viewportX,
            viewportY,
            mapData.width,
            mapData.height,
            rect.width,
            rect.height,
            zoom,
          )
        : { x: viewportX, y: viewportY };
      return rendererRef.current.screenToTile(
        clientX - rect.left,
        clientY - rect.top,
        viewport.x,
        viewport.y,
        zoom
      );
    },
    [mapData, viewportX, viewportY, zoom]
  );

  const setClampedViewport = useCallback(
    (x: number, y: number, scale = zoom) => {
      if (!mapData) {
        setViewportX(Math.max(0, x));
        setViewportY(Math.max(0, y));
        return;
      }
      const canvas = canvasRef.current;
      const viewport = clampMapViewport(
        x,
        y,
        mapData.width,
        mapData.height,
        canvas?.clientWidth ?? 0,
        canvas?.clientHeight ?? 0,
        scale,
      );
      setViewportX(viewport.x);
      setViewportY(viewport.y);
    },
    [mapData, zoom],
  );

  const handleOpenEventFromList = useCallback((eventId: number, eventName: string) => {
    const event = mapData?.events.find((candidate) => candidate.id === eventId);
    if (event && mapData) {
      const canvas = canvasRef.current;
      const viewport = centerMapViewportOnTile(
        event.x,
        event.y,
        mapData.width,
        mapData.height,
        canvas?.clientWidth ?? canvasSize.width,
        canvas?.clientHeight ?? canvasSize.height,
        zoom,
      );
      setCursorTile({ x: event.x, y: event.y });
      setClampedViewport(viewport.x, viewport.y);
    }
    onOpenEvent?.(eventId, eventName);
  }, [canvasSize.height, canvasSize.width, mapData, onOpenEvent, setClampedViewport, zoom]);

  // Apply a paint operation at a position
  const doPaint = useCallback(
    (x: number, y: number) => {
      if (!mapData || readOnly) return;
      if (selectedLayer < 0 || selectedLayer > 2) return; // Can't paint on Events or All layer

      if (paintTool === "pencil") {
        const changes = paintTile(mapData, x, y, selectedLayer, selectedTileId);
        if (changes.length > 0) {
          paintChanges.current.push(...changes);
          // Mark dirty on mutation, not only on mouseup: Save All can be
          // pending while a drag stroke is still in progress.
          onMapDirty();
          rendererRef.current?.setMapData(
            mapData.tiles,
            mapData.width,
            mapData.height
          );
          setRenderTick((t) => t + 1);
        }
      } else if (paintTool === "eraser") {
        const changes = eraseTile(mapData, x, y, selectedLayer);
        if (changes.length > 0) {
          paintChanges.current.push(...changes);
          // Mark dirty on mutation, not only on mouseup: Save All can be
          // pending while a drag stroke is still in progress.
          onMapDirty();
          rendererRef.current?.setMapData(
            mapData.tiles,
            mapData.width,
            mapData.height
          );
          setRenderTick((t) => t + 1);
        }
      }
    },
    [mapData, paintTool, selectedLayer, selectedTileId, onMapDirty, readOnly]
  );

  const finishTouchStroke = useCallback(() => {
    if (!isTouchPainting.current) return;
    isTouchPainting.current = false;
    if (paintChanges.current.length > 0) {
      undoStackRef.current.push({
        type: paintTool === "eraser" ? "erase" : "paint",
        changes: [...paintChanges.current],
        timestamp: Date.now(),
      });
      paintChanges.current = [];
    }
  }, [paintTool]);

  // Mouse wheel: scroll to pan, Ctrl+scroll (pinch-to-zoom) to zoom
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();

      if (e.ctrlKey || e.metaKey) {
        // Ctrl+scroll or pinch-to-zoom → zoom
        const factor = e.deltaY > 0 ? 0.9 : 1.1;
        setZoom((z) => Math.max(0.25, Math.min(4, z * factor)));
      } else {
        // Regular scroll → pan the viewport (in tile units)
        const tilePixels = TILE_SIZE * zoom;
        const dx = e.deltaX / tilePixels;
        const dy = e.deltaY / tilePixels;
        setClampedViewport(viewportX + dx, viewportY + dy);
      }
    },
    [zoom, setClampedViewport, viewportX, viewportY]
  );

  // Mouse down: start painting or panning
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button === 1) {
        e.preventDefault();
        isPanning.current = true;
        panStart.current = { x: e.clientX, y: e.clientY };
        panViewport.current = { x: viewportX, y: viewportY };
        return;
      }

      if (readOnly) return;

      if (e.button === 0 && mapData) {
        if (paintTool === "pan") {
          e.preventDefault();
          isPanning.current = true;
          panStart.current = { x: e.clientX, y: e.clientY };
          panViewport.current = { x: viewportX, y: viewportY };
          return;
        }

        const pos = screenToTile(e.clientX, e.clientY);
        if (!pos) return;

        // On Events layer, clicking is for event selection, not tile painting
        if (selectedLayer === 3) {
          return;
        }

        if (paintTool === "select") {
          setSelectionStart(pos);
          setSelectionEnd(pos);
          isSelecting.current = true;
          return;
        }

        if (paintTool === "bucket") {
          const changes = floodFill(
            mapData,
            pos.x,
            pos.y,
            selectedLayer,
            selectedTileId
          );
          if (changes.length > 0) {
            undoStackRef.current.push({
              type: "fill",
              changes,
              timestamp: Date.now(),
            });
            rendererRef.current?.setMapData(
              mapData.tiles,
              mapData.width,
              mapData.height
            );
            setRenderTick((t) => t + 1);
            onMapDirty();
          }
          return;
        }

        if (paintTool === "rectangle") {
          rectStart.current = pos;
          isPainting.current = true;
          return;
        }

        isPainting.current = true;
        paintChanges.current = [];
        mousePaintLastTile.current = pos;
        doPaint(pos.x, pos.y);
      }
    },
    [
      mapData,
      viewportX,
      viewportY,
      paintTool,
      selectedLayer,
      selectedTileId,
      screenToTile,
      doPaint,
      onMapDirty,
      readOnly,
    ]
  );

  // Mouse move: continue painting or panning
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isPanning.current) {
        const dx = (e.clientX - panStart.current.x) / (TILE_SIZE * zoom);
        const dy = (e.clientY - panStart.current.y) / (TILE_SIZE * zoom);
        setClampedViewport(panViewport.current.x - dx, panViewport.current.y - dy);
        return;
      }

      const pos = screenToTile(e.clientX, e.clientY);
      if (pos && mapData) {
        if (
          pos.x >= 0 &&
          pos.x < mapData.width &&
          pos.y >= 0 &&
          pos.y < mapData.height
        ) {
          setCursorTile(pos);
        } else {
          setCursorTile(null);
        }

        if (isSelecting.current && paintTool === "select") {
          setSelectionEnd(pos);
        }

        if (
          isPainting.current &&
          (paintTool === "pencil" || paintTool === "eraser")
        ) {
          if (
            pos.x >= 0 &&
            pos.x < mapData.width &&
            pos.y >= 0 &&
            pos.y < mapData.height
          ) {
            const previous = mousePaintLastTile.current;
            const stroke = previous ? rasterizeTileLine(previous, pos) : [pos];
            for (const tile of stroke) doPaint(tile.x, tile.y);
            mousePaintLastTile.current = pos;
          } else {
            mousePaintLastTile.current = null;
            doPaint(pos.x, pos.y);
          }
        }
      }
    },
    [mapData, zoom, screenToTile, paintTool, doPaint, setClampedViewport]
  );

  // Mouse up: finish painting
  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (e.button === 1 || (e.button === 0 && isPanning.current)) {
        isPanning.current = false;
        return;
      }

      if (e.button === 0 && isSelecting.current) {
        isSelecting.current = false;
        return;
      }

      if (e.button === 0 && isPainting.current && mapData) {
        isPainting.current = false;
        mousePaintLastTile.current = null;

        if (paintTool === "rectangle" && rectStart.current) {
          const pos = screenToTile(e.clientX, e.clientY);
          if (pos) {
            const changes = paintRectangle(
              mapData,
              rectStart.current.x,
              rectStart.current.y,
              pos.x,
              pos.y,
              selectedLayer,
              selectedTileId
            );
            if (changes.length > 0) {
              undoStackRef.current.push({
                type: "rectangle",
                changes,
                timestamp: Date.now(),
              });
              rendererRef.current?.setMapData(
                mapData.tiles,
                mapData.width,
                mapData.height
              );
              setRenderTick((t) => t + 1);
              onMapDirty();
            }
          }
          rectStart.current = null;
        } else if (paintChanges.current.length > 0) {
          undoStackRef.current.push({
            type: paintTool === "eraser" ? "erase" : "paint",
            changes: [...paintChanges.current],
            timestamp: Date.now(),
          });
          paintChanges.current = [];
          onMapDirty();
        }
      }
    },
    [
      mapData,
      paintTool,
      selectedLayer,
      selectedTileId,
      screenToTile,
      onMapDirty,
    ]
  );

  const handleTouchTap = useCallback(
    (point: { x: number; y: number }) => {
      if (!mapData || readOnly) return;
      const tile = screenToTile(point.x, point.y);
      if (!tile) return;
      const target = resolveMapTapTarget(
        tile,
        mapData.width,
        mapData.height,
        selectedLayer,
        mapData.events,
      );
      setCursorTile(target.type === "outside" ? null : tile);

      if (target.type === "event") {
        onOpenEvent?.(target.event.id, target.event.name);
        return;
      }
      if (target.type === "empty-event-layer") {
        onCreateEvent?.(tile.x, tile.y);
        return;
      }
      if (target.type !== "map") return;

      if (paintTool === "select") {
        setSelectionStart(tile);
        setSelectionEnd(tile);
        return;
      }

      if (paintTool === "bucket") {
        const changes = floodFill(mapData, tile.x, tile.y, selectedLayer, selectedTileId);
        if (changes.length > 0) {
          undoStackRef.current.push({ type: "fill", changes, timestamp: Date.now() });
          rendererRef.current?.setMapData(mapData.tiles, mapData.width, mapData.height);
          setRenderTick((tick) => tick + 1);
          onMapDirty();
        }
        return;
      }

      if (paintTool === "rectangle") {
        const changes = paintRectangle(
          mapData,
          tile.x,
          tile.y,
          tile.x,
          tile.y,
          selectedLayer,
          selectedTileId,
        );
        if (changes.length > 0) {
          undoStackRef.current.push({ type: "rectangle", changes, timestamp: Date.now() });
          rendererRef.current?.setMapData(mapData.tiles, mapData.width, mapData.height);
          setRenderTick((tick) => tick + 1);
          onMapDirty();
        }
        return;
      }

      paintChanges.current = [];
      doPaint(tile.x, tile.y);
      if (paintChanges.current.length > 0) {
        undoStackRef.current.push({
          type: paintTool === "eraser" ? "erase" : "paint",
          changes: [...paintChanges.current],
          timestamp: Date.now(),
        });
        paintChanges.current = [];
        onMapDirty();
      }
    },
    [
      doPaint,
      mapData,
      onCreateEvent,
      onMapDirty,
      onOpenEvent,
      paintTool,
      screenToTile,
      selectedLayer,
      selectedTileId,
    ],
  );

  const handleTouchGesture = useCallback(
    (action: TouchGestureAction | null) => {
      if (!action) return;
      if (action.type === "tap") {
        handleTouchTap(action.point);
        return;
      }
      if (action.type === "long-press") {
        if (!mapData) return;
        const tile = screenToTile(action.point.x, action.point.y);
        if (!tile) return;
        const target = resolveMapTapTarget(tile, mapData.width, mapData.height, 3, mapData.events);
        if (target.type === "event") onOpenEvent?.(target.event.id, target.event.name);
        return;
      }
      if (action.type === "pan") {
        if (!readOnly && selectedLayer >= 0 && selectedLayer <= 2 &&
            (paintTool === "pencil" || paintTool === "eraser")) {
          const from = screenToTile(action.from.x, action.from.y);
          const to = screenToTile(action.point.x, action.point.y);
          if (from && to) {
            isTouchPainting.current = true;
            for (const tile of rasterizeTileLine(from, to)) {
              doPaint(tile.x, tile.y);
            }
          }
          return;
        }
        setClampedViewport(
          viewportX - action.deltaX / (TILE_SIZE * zoom),
          viewportY - action.deltaY / (TILE_SIZE * zoom),
        );
        return;
      }

      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const oldCenterX = action.center.x - action.deltaX;
      const oldCenterY = action.center.y - action.deltaY;
      const viewport = clampMapViewport(
        viewportX,
        viewportY,
        mapData?.width ?? 0,
        mapData?.height ?? 0,
        rect.width,
        rect.height,
        zoom,
      );
      const worldX = (oldCenterX - rect.left) / (TILE_SIZE * zoom) + viewport.x;
      const worldY = (oldCenterY - rect.top) / (TILE_SIZE * zoom) + viewport.y;
      const nextZoom = Math.max(0.25, Math.min(4, zoom * action.scale));
      setZoom(nextZoom);
      setClampedViewport(
        worldX - (action.center.x - rect.left) / (TILE_SIZE * nextZoom),
        worldY - (action.center.y - rect.top) / (TILE_SIZE * nextZoom),
        nextZoom,
      );
    },
    [doPaint, handleTouchTap, mapData, onOpenEvent, paintTool, readOnly, screenToTile, selectedLayer, viewportX, viewportY, zoom, setClampedViewport],
  );

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType !== "touch") return;
    e.preventDefault();
    e.stopPropagation();
    touchGesturesRef.current.pointerDown(
      e.pointerId,
      { x: e.clientX, y: e.clientY },
      e.timeStamp,
    );
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Pointer capture is unavailable in some WebViews; touch-action still prevents browser panning.
    }
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (e.pointerType !== "touch") return;
      e.preventDefault();
      e.stopPropagation();
      handleTouchGesture(
        touchGesturesRef.current.pointerMove(e.pointerId, { x: e.clientX, y: e.clientY }),
      );
    },
    [handleTouchGesture],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (e.pointerType !== "touch") return;
      e.preventDefault();
      e.stopPropagation();
      handleTouchGesture(
        touchGesturesRef.current.pointerUp(
          e.pointerId,
          { x: e.clientX, y: e.clientY },
          e.timeStamp,
        ),
      );
      finishTouchStroke();
    },
    [finishTouchStroke, handleTouchGesture],
  );

  const handlePointerCancel = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType !== "touch") return;
    e.preventDefault();
    e.stopPropagation();
    finishTouchStroke();
    touchGesturesRef.current.cancel();
  }, [finishTouchStroke]);

  const handleTouchStartFallback = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    if ("PointerEvent" in window) return;
    e.preventDefault();
    e.stopPropagation();
    for (const touch of Array.from(e.changedTouches)) {
      touchGesturesRef.current.pointerDown(
        touch.identifier,
        { x: touch.clientX, y: touch.clientY },
        e.timeStamp,
      );
    }
  }, []);

  const handleTouchMoveFallback = useCallback(
    (e: React.TouchEvent<HTMLCanvasElement>) => {
      if ("PointerEvent" in window) return;
      e.preventDefault();
      e.stopPropagation();
      for (const touch of Array.from(e.changedTouches)) {
        handleTouchGesture(
          touchGesturesRef.current.pointerMove(touch.identifier, {
            x: touch.clientX,
            y: touch.clientY,
          }),
        );
      }
    },
    [handleTouchGesture],
  );

  const handleTouchEndFallback = useCallback(
    (e: React.TouchEvent<HTMLCanvasElement>) => {
      if ("PointerEvent" in window) return;
      e.preventDefault();
      e.stopPropagation();
      for (const touch of Array.from(e.changedTouches)) {
        handleTouchGesture(
          touchGesturesRef.current.pointerUp(
            touch.identifier,
            { x: touch.clientX, y: touch.clientY },
            e.timeStamp,
          ),
        );
        finishTouchStroke();
      }
    },
    [finishTouchStroke, handleTouchGesture],
  );

  const handleTouchCancelFallback = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    if ("PointerEvent" in window) return;
    e.preventDefault();
    e.stopPropagation();
    finishTouchStroke();
    touchGesturesRef.current.cancel();
  }, [finishTouchStroke]);

  // ALWAYS render the full layout — the canvas must exist at mount time
  // for the renderer creation and ResizeObserver effects to work.
  return (
    <div className="map-editor">
      {/* Toolbar — only show controls when a map is loaded */}
      {mapData && (
        <MapToolbar
          paintTool={paintTool}
          setPaintTool={setPaintTool}
          tileClipboard={tileClipboard}
          selectedLayer={selectedLayer}
          setSelectedLayer={setSelectedLayer}
          showGrid={showGrid}
          setShowGrid={setShowGrid}
          showEventPins={showEventPins}
          setShowEventPins={updateShowEventPins}
          paletteVisible={paletteVisible}
          onTogglePalette={onTogglePalette}
          eventCount={mapData.events.length}
          eventListVisible={showEventList}
          onToggleEventList={() => setShowEventList((visible) => !visible)}
          zoom={zoom}
          setZoom={setZoom}
          onUndo={() => { handleHistory("undo"); }}
          onRedo={() => { handleHistory("redo"); }}
          historyDisabled={shortcutsDisabled}
          readOnly={readOnly}
        />
      )}

      {/* Canvas container — ALWAYS rendered */}
      <div className="map-editor-canvas-container">
        <canvas
          ref={canvasRef}
          className="map-editor-canvas"
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onTouchStart={handleTouchStartFallback}
          onTouchMove={handleTouchMoveFallback}
          onTouchEnd={handleTouchEndFallback}
          onTouchCancel={handleTouchCancelFallback}
          onClick={(e) => {
            if (readOnly || !mapData || selectedLayer !== 3) return;
            const pos = screenToTile(e.clientX, e.clientY);
            if (!pos) return;
            const evt = mapData.events.find(
              (candidate) => candidate.x === pos.x && candidate.y === pos.y
            );
            if (evt) onOpenEvent?.(evt.id, evt.name);
          }}
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onDoubleClick={(e) => {
            if (readOnly || !mapData) return;
            const pos = screenToTile(e.clientX, e.clientY);
            if (!pos) return;
            const evt = mapData.events.find(
              (ev) => ev.x === pos.x && ev.y === pos.y
            );
            if (evt) {
              // Double-click existing event → open editor
              if (onOpenEvent) onOpenEvent(evt.id, evt.name);
            } else if (selectedLayer === 3 && onCreateEvent) {
              // Double-click empty tile on Events layer → create new event
              onCreateEvent(pos.x, pos.y);
            }
          }}
          onMouseLeave={() => {
            setCursorTile(null);
            isPanning.current = false;
            if (isPainting.current) {
              isPainting.current = false;
              mousePaintLastTile.current = null;
              if (paintChanges.current.length > 0) {
                undoStackRef.current.push({
                  type: paintTool === "eraser" ? "erase" : "paint",
                  changes: [...paintChanges.current],
                  timestamp: Date.now(),
                });
                paintChanges.current = [];
                onMapDirty();
              }
            }
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            if (readOnly || !mapData) return;
            const pos = screenToTile(e.clientX, e.clientY);
            if (!pos) return;
            if (pos.x < 0 || pos.x >= mapData.width || pos.y < 0 || pos.y >= mapData.height) return;
            const evt = mapData.events.find(ev => ev.x === pos.x && ev.y === pos.y);
            setContextMenu({
              x: e.clientX,
              y: e.clientY,
              tileX: pos.x,
              tileY: pos.y,
              event: evt ? { id: evt.id, name: evt.name } : null,
            });
          }}
        />
        {showEventList && mapData && (
          <MapEventList
            events={mapData.events}
            onOpenEvent={handleOpenEventFromList}
            onClose={() => setShowEventList(false)}
          />
        )}
        {/* Scrollbar overlays */}
        {mapData && (
          <MapScrollbars
            mapWidth={mapData.width}
            mapHeight={mapData.height}
            viewportX={constrainedViewport.x}
            viewportY={constrainedViewport.y}
            zoom={zoom}
            canvasRef={canvasRef}
            onViewportChange={(x, y) => {
              setViewportX(x);
              setViewportY(y);
            }}
          />
        )}
        {/* Empty state overlay — shown ON TOP of the canvas */}
        {!mapData && (
          <div className="map-editor-empty-overlay">
            <p>Select a map from the tree to start editing</p>
          </div>
        )}
      </div>

      {/* Tile context menu */}
      {contextMenu && (
        <MapContextMenu
          contextMenu={contextMenu}
          setContextMenu={setContextMenu}
          hasClipboardEvent={hasClipboardEvent}
          onOpenEvent={onOpenEvent}
          onCopyEvent={onCopyEvent}
          onDeleteEvent={onDeleteEvent}
          onPasteEvent={onPasteEvent}
          onSetStartPosition={onSetStartPosition}
        />
      )}

      {/* Status bar */}
      {mapData && (
        <div className="map-editor-status">
          <span>
            Map [{String(mapData.id).padStart(3, "0")}] {mapData.width}x
            {mapData.height}
          </span>
          {cursorTile && (
            <span>
              ({cursorTile.x}, {cursorTile.y})
            </span>
          )}
          <span>{selectedLayer === -1 ? "All Layers" : selectedLayer === 3 ? `Events (${mapData.events.length})` : `Layer ${selectedLayer + 1}/3`}</span>
          <span>Tile: {selectedTileId}</span>
          <span className="toolbar-right">
            {undoStackRef.current.canUndo() ? "Ctrl+Z: Undo" : ""}
            {undoStackRef.current.canRedo() ? " | Ctrl+Y: Redo" : ""}
          </span>
        </div>
      )}
    </div>
  );
}
