import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { confirmEditor } from "../../services/editorDialog";
import { clearImageCache, loadCharacterImage } from "../../services/imageLoader";
import { listAssetFiles, savePrivateProjectSprite } from "../../services/tauriApi";
import { useEditorRegistration, useProjectSave } from "../../context/ProjectSaveContext";
import {
  fitSpriteViewport,
  rasterizeSpriteLine,
  spritePixelAt,
  zoomSpriteTraceTransform,
  zoomSpriteViewport,
  type SpriteTraceTransform,
} from "../../services/spriteEditorGeometry";
import {
  applySpritePixelAction,
  fillSpritePixels,
  paintSpritePixels,
  spriteColorAt,
  SpritePixelHistory,
  type SpritePixelAction,
  type SpriteTool,
} from "../../services/spriteEditorPixels";
import {
  DEFAULT_SPRITE_TRACE_TRANSFORM,
  readSpriteTraceTransform,
  spriteTracePreferenceKey,
  writeSpriteTraceTransform,
} from "../../services/spriteEditorPreferences";
import { resolveSpriteShortcut } from "../../services/spriteEditorShortcuts";
import "./SpriteEditor.css";

interface Props {
  projectPath: string;
  onClose: () => void;
  onSaved: () => void;
}

interface PointerPoint {
  x: number;
  y: number;
}

const TOOL_PANEL_PREFERENCE = "essentials-studio:sprite-editor:tools-collapsed";
const PALETTE_PREFERENCE = "essentials-studio:sprite-editor:palette-visible";

function readPanelPreference(key: string): boolean | null {
  try {
    if (typeof window === "undefined") return null;
    const stored = window.localStorage.getItem(key);
    return stored === "true" ? true : stored === "false" ? false : null;
  } catch {
    return null;
  }
}

function writePanelPreference(key: string, value: boolean) {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, String(value));
  } catch {
    // Keep the editor usable when persistent storage is unavailable.
  }
}

export function SpriteEditor({ projectPath, onClose, onSaved }: Props) {
  const { updateDirty } = useProjectSave();
  const [names, setNames] = useState<string[]>([]);
  const [spriteSearch, setSpriteSearch] = useState("");
  const [selectedName, setSelectedName] = useState("");
  const [targetName, setTargetName] = useState("");
  const [saveMode, setSaveMode] = useState<"original" | "copy">("copy");
  const [tool, setTool] = useState<SpriteTool>("brush");
  const [brushColor, setBrushColor] = useState("#ffffff");
  const [brushSize, setBrushSize] = useState(1);
  const [zoom, setZoom] = useState(4);
  const [offsetX, setOffsetX] = useState(12);
  const [offsetY, setOffsetY] = useState(12);
  const [traceImage, setTraceImage] = useState<HTMLImageElement | null>(null);
  const [traceOpacity, setTraceOpacity] = useState(DEFAULT_SPRITE_TRACE_TRANSFORM.opacity);
  const [traceScale, setTraceScale] = useState(DEFAULT_SPRITE_TRACE_TRANSFORM.scale);
  const [traceOffsetX, setTraceOffsetX] = useState(DEFAULT_SPRITE_TRACE_TRANSFORM.offsetX);
  const [traceOffsetY, setTraceOffsetY] = useState(DEFAULT_SPRITE_TRACE_TRANSFORM.offsetY);
  const [restoredTracePreferenceKey, setRestoredTracePreferenceKey] = useState<string | null>(null);
  const [positionTraceWithTouch, setPositionTraceWithTouch] = useState(false);
  const [imageRevision, setImageRevision] = useState(0);
  const [, setHistoryRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [controlsCollapsed, setControlsCollapsed] = useState(
    () => readPanelPreference(TOOL_PANEL_PREFERENCE) ??
      (typeof window.matchMedia === "function" && window.matchMedia("(max-width: 700px)").matches),
  );
  const [paletteVisible, setPaletteVisible] = useState(
    () => readPanelPreference(PALETTE_PREFERENCE) ?? true,
  );
  const filteredNames = useMemo(() => {
    const query = spriteSearch.trim().toLowerCase();
    return query ? names.filter((name) => name.toLowerCase().includes(query)) : names;
  }, [names, spriteSearch]);
  const tracePreferenceKey = spriteTracePreferenceKey(projectPath, selectedName);
  const keepSelectedOption = selectedName && !filteredNames.includes(selectedName);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageDataRef = useRef<ImageData | null>(null);
  const historyRef = useRef(new SpritePixelHistory());
  const dirtyBeforeStroke = useRef(false);
  const pointerPositions = useRef(new Map<number, PointerPoint>());
  const activePaintPointer = useRef<number | null>(null);
  const pendingTouchPaint = useRef<{ id: number; point: PointerPoint } | null>(null);
  const lastPaintPixel = useRef<PointerPoint | null>(null);
  const activePan = useRef<{ id: number; point: PointerPoint; x: number; y: number } | null>(null);
  const activeTracePan = useRef<{ id: number; point: PointerPoint; x: number; y: number } | null>(null);
  const pinchStart = useRef<{
    mode: "sprite" | "trace";
    distance: number;
    center: PointerPoint;
    viewport: { zoom: number; offsetX: number; offsetY: number };
    trace: SpriteTraceTransform;
  } | null>(null);
  const traceUrl = useRef<string | null>(null);
  const traceLoadId = useRef(0);
  const fitViewportOnResize = useRef(true);
  const spriteEditRevision = useRef(0);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const compactViewport = window.matchMedia("(max-width: 700px)");
    const updateControls = (event: MediaQueryListEvent) => {
      if (readPanelPreference(TOOL_PANEL_PREFERENCE) === null) {
        setControlsCollapsed(event.matches);
      }
    };
    compactViewport.addEventListener("change", updateControls);
    return () => compactViewport.removeEventListener("change", updateControls);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void listAssetFiles(projectPath, "character")
      .then((files) => {
        if (cancelled) return;
        const sorted = files.slice().sort((a, b) => a.localeCompare(b));
        setNames(sorted);
        setSelectedName((current) => current || sorted[0] || "");
        setTargetName((current) => current || (sorted[0] ? `${sorted[0]}_copy` : ""));
      })
      .catch((cause) => setError(`Could not list character graphics: ${cause}`))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [projectPath]);

  useEffect(() => {
    if (!selectedName) return;
    let cancelled = false;
    setLoading(true);
    void loadCharacterImage(projectPath, selectedName)
      .then((image) => {
        if (cancelled) return;
        if (!image) throw new Error("The selected character image could not be loaded");
        if (image.width * image.height > 16_777_216) {
          throw new Error("Sprite image exceeds the 16-megapixel edit limit");
        }
        const source = document.createElement("canvas");
        source.width = image.width;
        source.height = image.height;
        const context = source.getContext("2d");
        if (!context) throw new Error("Sprite canvas is unavailable");
        context.imageSmoothingEnabled = false;
        context.drawImage(image, 0, 0);
        imageCanvasRef.current = source;
        imageDataRef.current = context.getImageData(0, 0, source.width, source.height);
        historyRef.current.clear();
        fitViewportOnResize.current = true;
        const bounds = canvasRef.current?.parentElement?.getBoundingClientRect();
        if (bounds?.width && bounds.height) {
          const viewport = fitSpriteViewport(source.width, source.height, bounds.width, bounds.height);
          setZoom(viewport.zoom);
          setOffsetX(viewport.offsetX);
          setOffsetY(viewport.offsetY);
        }
        setDirty(false);
        setImageRevision((value) => value + 1);
      })
      .catch((cause) => setError(`Could not open ${selectedName}: ${cause}`))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [projectPath, selectedName, updateDirty]);

  useEffect(() => {
    if (!selectedName || !tracePreferenceKey) return;
    const transform = readSpriteTraceTransform(projectPath, selectedName);
    setTraceOpacity(transform.opacity);
    setTraceScale(transform.scale);
    setTraceOffsetX(transform.offsetX);
    setTraceOffsetY(transform.offsetY);
    setRestoredTracePreferenceKey(tracePreferenceKey);
  }, [projectPath, selectedName, tracePreferenceKey]);

  useEffect(() => {
    if (!tracePreferenceKey || restoredTracePreferenceKey !== tracePreferenceKey) return;
    writeSpriteTraceTransform(projectPath, selectedName, {
      opacity: traceOpacity,
      scale: traceScale,
      offsetX: traceOffsetX,
      offsetY: traceOffsetY,
    });
  }, [
    projectPath,
    selectedName,
    tracePreferenceKey,
    restoredTracePreferenceKey,
    traceOpacity,
    traceScale,
    traceOffsetX,
    traceOffsetY,
  ]);

  const fitSprite = useCallback(() => {
    const source = imageCanvasRef.current;
    const canvas = canvasRef.current;
    if (!source || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const viewport = fitSpriteViewport(source.width, source.height, rect.width, rect.height);
    fitViewportOnResize.current = true;
    setZoom(viewport.zoom);
    setOffsetX(viewport.offsetX);
    setOffsetY(viewport.offsetY);
  }, []);

  const zoomViewportAt = useCallback((scale: number, point?: PointerPoint) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const center = point ?? { x: rect.width / 2, y: rect.height / 2 };
    fitViewportOnResize.current = false;
    const next = zoomSpriteViewport(
      { zoom, offsetX, offsetY },
      center,
      center,
      scale,
    );
    setZoom(next.zoom);
    setOffsetX(next.offsetX);
    setOffsetY(next.offsetY);
  }, [offsetX, offsetY, zoom]);

  const handleWheelZoom = useCallback((event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const delta = event.deltaMode === 1
      ? event.deltaY * 16
      : event.deltaMode === 2
        ? event.deltaY * rect.height
        : event.deltaY;
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    zoomViewportAt(Math.exp(-delta * 0.0015), point);
  }, [zoomViewportAt]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = canvas?.parentElement;
    if (!canvas || !container) return;
    const draw = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.imageSmoothingEnabled = false;
      context.fillStyle = "#181825";
      context.fillRect(0, 0, rect.width, rect.height);
      const source = imageCanvasRef.current;
      if (source) {
        const viewport = fitViewportOnResize.current && rect.width > 0 && rect.height > 0
          ? fitSpriteViewport(source.width, source.height, rect.width, rect.height)
          : { zoom, offsetX, offsetY };
        if (fitViewportOnResize.current) {
          if (viewport.zoom !== zoom) setZoom(viewport.zoom);
          if (viewport.offsetX !== offsetX) setOffsetX(viewport.offsetX);
          if (viewport.offsetY !== offsetY) setOffsetY(viewport.offsetY);
        }
        context.drawImage(
          source,
          viewport.offsetX,
          viewport.offsetY,
          source.width * viewport.zoom,
          source.height * viewport.zoom,
        );
        if (traceImage) {
          const width = source.width * viewport.zoom * traceScale / 100;
          const height = source.height * viewport.zoom * traceScale / 100;
          context.globalAlpha = traceOpacity / 100;
          context.drawImage(
            traceImage,
            viewport.offsetX + (source.width * viewport.zoom - width) / 2 + source.width * viewport.zoom * traceOffsetX / 100,
            viewport.offsetY + (source.height * viewport.zoom - height) / 2 + source.height * viewport.zoom * traceOffsetY / 100,
            width,
            height,
          );
          context.globalAlpha = 1;
        }
        if (viewport.zoom >= 4) {
          const left = Math.max(0, Math.floor(-viewport.offsetX / viewport.zoom));
          const top = Math.max(0, Math.floor(-viewport.offsetY / viewport.zoom));
          const right = Math.min(source.width, Math.ceil((rect.width - viewport.offsetX) / viewport.zoom));
          const bottom = Math.min(source.height, Math.ceil((rect.height - viewport.offsetY) / viewport.zoom));
          context.strokeStyle = "rgba(255,255,255,0.2)";
          context.lineWidth = 1;
          context.beginPath();
          for (let x = left; x <= right; x++) {
            const screenX = Math.round(viewport.offsetX + x * viewport.zoom) + 0.5;
            context.moveTo(screenX, viewport.offsetY + top * viewport.zoom);
            context.lineTo(screenX, viewport.offsetY + bottom * viewport.zoom);
          }
          for (let y = top; y <= bottom; y++) {
            const screenY = Math.round(viewport.offsetY + y * viewport.zoom) + 0.5;
            context.moveTo(viewport.offsetX + left * viewport.zoom, screenY);
            context.lineTo(viewport.offsetX + right * viewport.zoom, screenY);
          }
          context.stroke();
        }
      }
    };
    const observer = new ResizeObserver(draw);
    observer.observe(container);
    draw();
    return () => observer.disconnect();
  }, [imageRevision, offsetX, offsetY, zoom, traceImage, traceOpacity, traceScale, traceOffsetX, traceOffsetY]);

  const pixelAtClient = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    const source = imageCanvasRef.current;
    if (!canvas || !source) return null;
    const rect = canvas.getBoundingClientRect();
    return spritePixelAt(
      clientX - rect.left,
      clientY - rect.top,
      { zoom, offsetX, offsetY },
      source.width,
      source.height,
    );
  }, [offsetX, offsetY, zoom]);

  const paintPixel = useCallback((clientX: number, clientY: number, deferRender = false) => {
    const source = imageCanvasRef.current;
    const context = source?.getContext("2d");
    const imageData = imageDataRef.current;
    const pixel = pixelAtClient(clientX, clientY);
    if (!source || !context || !imageData || !pixel) return false;
    if (tool === "eyedropper") {
      const sampled = spriteColorAt(imageData.data, source.width, source.height, pixel.x, pixel.y);
      if (sampled) setBrushColor(sampled);
      return false;
    }

    let action: SpritePixelAction | null = null;
    try {
      if (tool === "fill") {
        historyRef.current.begin();
        action = fillSpritePixels(imageData.data, source.width, source.height, pixel.x, pixel.y, brushColor);
        if (action) {
          if (!historyRef.current.push(action)) {
            applySpritePixelAction(imageData.data, action, "before");
            setError("This fill exceeds the one-million-pixel undo limit");
            return false;
          }
        }
      } else if (tool === "brush" || tool === "eraser") {
        action = paintSpritePixels(
          imageData.data,
          source.width,
          source.height,
          pixel.x,
          pixel.y,
          brushColor,
          brushSize,
          tool === "eraser",
        );
        if (action && !historyRef.current.record(action)) {
          applySpritePixelAction(imageData.data, action, "before");
          setError("This stroke exceeds the one-million-pixel undo limit");
          return false;
        }
      }
    } catch (cause) {
      setError(String(cause));
      return false;
    }
    if (!action) return false;
    spriteEditRevision.current += 1;

    if (!deferRender) {
      context.putImageData(imageData, 0, 0);
      setDirty(true);
      updateDirty("sprite-editor", true);
      setImageRevision((value) => value + 1);
    }
    return true;
  }, [brushColor, brushSize, pixelAtClient, tool, updateDirty]);

  const paintStrokeTo = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    const current = pixelAtClient(clientX, clientY);
    if (!canvas || !current) {
      lastPaintPixel.current = null;
      return;
    }
    const source = imageCanvasRef.current;
    const imageData = imageDataRef.current;
    const context = source?.getContext("2d");
    if (!source || !imageData || !context) return;
    const rect = canvas.getBoundingClientRect();
    const previous = lastPaintPixel.current ?? current;
    let changed = false;
    for (const pixel of rasterizeSpriteLine(previous, current)) {
      changed = paintPixel(
        rect.left + offsetX + (pixel.x + 0.5) * zoom,
        rect.top + offsetY + (pixel.y + 0.5) * zoom,
        true,
      ) || changed;
    }
    if (changed) {
      context.putImageData(imageData, 0, 0);
      setDirty(true);
      updateDirty("sprite-editor", true);
      setImageRevision((value) => value + 1);
    }
    lastPaintPixel.current = current;
  }, [offsetX, offsetY, paintPixel, pixelAtClient, updateDirty, zoom]);

  const undoSprite = useCallback(() => {
    const imageData = imageDataRef.current;
    const source = imageCanvasRef.current;
    if (!imageData || !source || !historyRef.current.undo(imageData.data)) return;
    spriteEditRevision.current += 1;
    source.getContext("2d")?.putImageData(imageData, 0, 0);
    setDirty(true);
    updateDirty("sprite-editor", true);
    setImageRevision((value) => value + 1);
  }, [updateDirty]);

  const redoSprite = useCallback(() => {
    const imageData = imageDataRef.current;
    const source = imageCanvasRef.current;
    if (!imageData || !source || !historyRef.current.redo(imageData.data)) return;
    spriteEditRevision.current += 1;
    source.getContext("2d")?.putImageData(imageData, 0, 0);
    setDirty(true);
    updateDirty("sprite-editor", true);
    setImageRevision((value) => value + 1);
  }, [updateDirty]);

  const cancelStroke = useCallback(() => {
    const imageData = imageDataRef.current;
    const source = imageCanvasRef.current;
    if (!imageData || !source || !historyRef.current.cancel(imageData.data)) return;
    spriteEditRevision.current += 1;
    source.getContext("2d")?.putImageData(imageData, 0, 0);
    setDirty(dirtyBeforeStroke.current);
    updateDirty("sprite-editor", dirtyBeforeStroke.current);
    setImageRevision((value) => value + 1);
  }, [updateDirty]);

  const saveSprite = useCallback(async () => {
    const source = imageCanvasRef.current;
    if (!source || !selectedName) throw new Error("No character sprite is selected");
    if (saveMode === "original" &&
        !(await confirmEditor(`Replace the original ${selectedName}.png character graphic?`))) {
      throw new Error("Original sprite replacement cancelled; edits remain unsaved");
    }
    const savedRevision = spriteEditRevision.current;
    setSaving(true);
    setError(null);
    try {
      const savedName = await savePrivateProjectSprite(
        projectPath,
        selectedName,
        saveMode === "copy" ? targetName.trim() : selectedName,
        saveMode,
        source.toDataURL("image/png"),
      );
      setNames((current) => current.includes(savedName) ? current : [...current, savedName].sort((a, b) => a.localeCompare(b)));
      const hasNewerEdits = spriteEditRevision.current !== savedRevision;
      if (!hasNewerEdits && activePaintPointer.current === null) {
        setSelectedName(savedName);
        setTargetName(`${savedName}_copy`);
        setSaveMode("original");
        setDirty(false);
        updateDirty("sprite-editor", false);
      } else {
        if (saveMode === "copy") setTargetName(`${savedName}_copy`);
        setDirty(hasNewerEdits);
        updateDirty("sprite-editor", hasNewerEdits);
      }
      clearImageCache();
      onSaved();
    } catch (cause) {
      setError(`Sprite save failed: ${cause}`);
      throw cause;
    } finally {
      setSaving(false);
    }
  }, [onSaved, projectPath, saveMode, selectedName, targetName, updateDirty]);

  const cancelSprite = useCallback(() => {
    setDirty(false);
    updateDirty("sprite-editor", false);
    if (selectedName) {
      void loadCharacterImage(projectPath, selectedName).then((image) => {
        if (!image) return;
        const source = document.createElement("canvas");
        source.width = image.width;
        source.height = image.height;
        const context = source.getContext("2d");
        context?.drawImage(image, 0, 0);
        imageCanvasRef.current = source;
        imageDataRef.current = context?.getImageData(0, 0, source.width, source.height) ?? null;
        historyRef.current.clear();
        setImageRevision((value) => value + 1);
      });
    }
  }, [projectPath, selectedName, updateDirty]);

  useEditorRegistration("sprite-editor", saveSprite, cancelSprite, dirty);

  const requestClose = useCallback(async () => {
    if (dirty) {
      const save = await confirmEditor("Save sprite edits before closing?");
      if (save) {
        try {
          await saveSprite();
        } catch {
          return;
        }
      } else {
        cancelSprite();
      }
    }
    onClose();
  }, [cancelSprite, dirty, onClose, saveSprite]);

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    if (loading) return;
    if (event.pointerType !== "touch" && event.button !== 0 && event.button !== 1) return;
    const point = { x: event.clientX, y: event.clientY };
    pointerPositions.current.set(event.pointerId, point);
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* WebView capture may be unavailable. */ }
    if (event.pointerType === "touch" && pointerPositions.current.size >= 2) {
      const points = [...pointerPositions.current.values()];
      const center = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
      pinchStart.current = {
        mode: traceImage && positionTraceWithTouch ? "trace" : "sprite",
        distance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y),
        center,
        viewport: { zoom, offsetX, offsetY },
        trace: { scale: traceScale, offsetX: traceOffsetX, offsetY: traceOffsetY },
      };
      fitViewportOnResize.current = false;
      cancelStroke();
      activePaintPointer.current = null;
      pendingTouchPaint.current = null;
      lastPaintPixel.current = null;
      activePan.current = null;
      activeTracePan.current = null;
      return;
    }
    if (traceImage && positionTraceWithTouch) {
      activeTracePan.current = { id: event.pointerId, point, x: traceOffsetX, y: traceOffsetY };
      return;
    }
    if (tool === "fill" || tool === "eyedropper") {
      paintPixel(event.clientX, event.clientY);
      return;
    }
    if (tool === "pan" || event.button === 1) {
      lastPaintPixel.current = null;
      fitViewportOnResize.current = false;
      activePan.current = { id: event.pointerId, point, x: offsetX, y: offsetY };
    } else {
      dirtyBeforeStroke.current = dirty;
      historyRef.current.begin();
      activePaintPointer.current = event.pointerId;
      if (event.pointerType === "touch") {
        pendingTouchPaint.current = { id: event.pointerId, point };
      } else {
        lastPaintPixel.current = pixelAtClient(event.clientX, event.clientY);
        paintStrokeTo(event.clientX, event.clientY);
      }
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (loading) return;
    const point = { x: event.clientX, y: event.clientY };
    pointerPositions.current.set(event.pointerId, point);
    const points = [...pointerPositions.current.values()];
    const pinch = pinchStart.current;
    if (pinch && points.length >= 2) {
      const center = {
        x: (points[0].x + points[1].x) / 2,
        y: (points[0].y + points[1].y) / 2,
      };
      const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      const rect = event.currentTarget.getBoundingClientRect();
      if (pinch.mode === "trace") {
        const source = imageCanvasRef.current;
        if (!source || pinch.distance <= 0) return;
        const trace = zoomSpriteTraceTransform(
          pinch.trace,
          pinch.viewport,
          source.width,
          source.height,
          { x: pinch.center.x - rect.left, y: pinch.center.y - rect.top },
          { x: center.x - rect.left, y: center.y - rect.top },
          distance / pinch.distance,
        );
        setTraceScale(trace.scale);
        setTraceOffsetX(trace.offsetX);
        setTraceOffsetY(trace.offsetY);
        return;
      }
      const next = zoomSpriteViewport(
        pinch.viewport,
        { x: pinch.center.x - rect.left, y: pinch.center.y - rect.top },
        { x: center.x - rect.left, y: center.y - rect.top },
        pinch.distance > 0 ? distance / pinch.distance : 1,
      );
      fitViewportOnResize.current = false;
      setZoom(next.zoom);
      setOffsetX(next.offsetX);
      setOffsetY(next.offsetY);
      return;
    }
    const pan = activePan.current;
    if (pan?.id === event.pointerId) {
      fitViewportOnResize.current = false;
      setOffsetX(pan.x + point.x - pan.point.x);
      setOffsetY(pan.y + point.y - pan.point.y);
    } else if (activeTracePan.current?.id === event.pointerId) {
      const source = imageCanvasRef.current;
      if (!source) return;
      const tracePan = activeTracePan.current;
      setTraceOffsetX(Math.max(-100, Math.min(100,
        tracePan.x + (point.x - tracePan.point.x) / (source.width * zoom) * 100,
      )));
      setTraceOffsetY(Math.max(-100, Math.min(100,
        tracePan.y + (point.y - tracePan.point.y) / (source.height * zoom) * 100,
      )));
    } else if (pendingTouchPaint.current?.id === event.pointerId) {
      const start = pendingTouchPaint.current.point;
      pendingTouchPaint.current = null;
      lastPaintPixel.current = pixelAtClient(start.x, start.y);
      paintStrokeTo(point.x, point.y);
    } else if (activePaintPointer.current === event.pointerId) {
      paintStrokeTo(event.clientX, event.clientY);
    }
  };

  const handlePointerEnd = (event: React.PointerEvent<HTMLCanvasElement>, commitTap: boolean) => {
    const pinch = pinchStart.current;
    const wasPinching = pinch !== null;
    const pending = pendingTouchPaint.current;
    if (commitTap && pending?.id === event.pointerId) {
      paintPixel(pending.point.x, pending.point.y);
    }
    if (commitTap && activePaintPointer.current === event.pointerId && !pending) {
      paintStrokeTo(event.clientX, event.clientY);
    }
    if (pending?.id === event.pointerId) pendingTouchPaint.current = null;
    pointerPositions.current.delete(event.pointerId);
    if (activePaintPointer.current === event.pointerId) {
      if (commitTap) {
        if (historyRef.current.commit()) setHistoryRevision((value) => value + 1);
      } else {
        cancelStroke();
      }
      activePaintPointer.current = null;
    }
    lastPaintPixel.current = null;
    if (activePan.current?.id === event.pointerId) activePan.current = null;
    if (activeTracePan.current?.id === event.pointerId) activeTracePan.current = null;
    if (wasPinching && pointerPositions.current.size === 1) {
      const [remainingId, remainingPoint] = [...pointerPositions.current.entries()][0];
      if (pinch.mode === "trace") {
        activeTracePan.current = {
          id: remainingId,
          point: remainingPoint,
          x: traceOffsetX,
          y: traceOffsetY,
        };
      } else {
        activePan.current = {
          id: remainingId,
          point: remainingPoint,
          x: offsetX,
          y: offsetY,
        };
      }
    }
    if (pointerPositions.current.size < 2) pinchStart.current = null;
  };
  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => handlePointerEnd(event, true);
  const handlePointerCancel = (event: React.PointerEvent<HTMLCanvasElement>) => handlePointerEnd(event, false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const shortcut = resolveSpriteShortcut(event);
      if (!shortcut) return;
      if (shortcut.type === "undo") {
        event.preventDefault();
        undoSprite();
      } else if (shortcut.type === "redo") {
        event.preventDefault();
        redoSprite();
      } else {
        event.preventDefault();
        setTool(shortcut.tool);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [redoSprite, undoSprite]);

  const handleTraceFile = (file?: File) => {
    if (!file) return;
    if (file.type && !file.type.startsWith("image/")) {
      setError("Trace overlay must be an image");
      return;
    }
    if (file.size > 32 * 1024 * 1024) {
      setError("Trace overlay must be 32 MiB or smaller");
      return;
    }
    const loadId = ++traceLoadId.current;
    if (traceUrl.current) URL.revokeObjectURL(traceUrl.current);
    const url = URL.createObjectURL(file);
    traceUrl.current = url;
    const image = new Image();
    image.onload = () => {
      if (loadId !== traceLoadId.current) return;
      if (image.width * image.height > 16_777_216) {
        setError("Trace overlay exceeds the 16-megapixel image limit");
        URL.revokeObjectURL(url);
        if (traceUrl.current === url) traceUrl.current = null;
        return;
      }
      setTraceImage(image);
      setError(null);
    };
    image.onerror = () => {
      if (loadId !== traceLoadId.current) return;
      setError("Could not load trace overlay");
      URL.revokeObjectURL(url);
      if (traceUrl.current === url) traceUrl.current = null;
    };
    image.src = url;
  };

  useEffect(() => () => {
    traceLoadId.current += 1;
    if (traceUrl.current) URL.revokeObjectURL(traceUrl.current);
  }, []);

  return (
    <div className="sprite-editor-overlay" role="dialog" aria-modal="true" aria-label="Sprite editor">
      <section className="sprite-editor">
        <header className="sprite-editor-header">
          <strong>Character Sprite Editor</strong>
          <div className="sprite-editor-header-actions">
            <button
              aria-expanded={!controlsCollapsed}
              aria-controls="sprite-editor-controls"
              onClick={() => setControlsCollapsed((collapsed) => {
                const next = !collapsed;
                writePanelPreference(TOOL_PANEL_PREFERENCE, next);
                return next;
              })}
            >
              {controlsCollapsed ? "Tools ▸" : "Tools ▾"}
            </button>
            <button aria-label="Fit sprite to view" onClick={fitSprite}>Fit</button>
            <button disabled={!dirty || saving} onClick={() => void saveSprite().catch(() => {})}>
              {saving ? "Saving…" : "Save sprite"}
            </button>
            <button disabled={saving} onClick={() => void requestClose()}>Close</button>
          </div>
        </header>
        <div className="sprite-editor-workspace">
          <aside
            id="sprite-editor-controls"
            className={`sprite-editor-tools${controlsCollapsed ? " is-collapsed" : ""}`}
            hidden={controlsCollapsed}
          >
            <div className="sprite-editor-character-picker">
              <label htmlFor="sprite-character-filter">Character</label>
              <input
                id="sprite-character-filter"
                type="search"
                aria-label="Filter project character sprites"
                placeholder="Filter by sprite name"
                value={spriteSearch}
                onChange={(event) => setSpriteSearch(event.target.value)}
              />
              <select
                aria-label="Select project character sprite"
                value={selectedName}
                onChange={(event) => {
                const name = event.target.value;
                setLoading(true);
                imageCanvasRef.current = null;
                imageDataRef.current = null;
                historyRef.current.clear();
                pointerPositions.current.clear();
                activePaintPointer.current = null;
                pendingTouchPaint.current = null;
                lastPaintPixel.current = null;
                activePan.current = null;
                activeTracePan.current = null;
                pinchStart.current = null;
                setImageRevision((value) => value + 1);
                setSelectedName(name);
                setTargetName(`${name}_copy`);
                setDirty(false);
                setError(null);
                }}
                disabled={!selectedName || dirty || loading || saving}
              >
                {keepSelectedOption && <option value={selectedName}>{selectedName} (current)</option>}
                {filteredNames.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
              {filteredNames.length === 0 && (
                <span role="status">
                  {names.length === 0
                    ? "No character sprites were found in this project."
                    : `No project sprites match “${spriteSearch.trim()}”.`}
                </span>
              )}
            </div>
            <div className="sprite-editor-tool-row" role="group" aria-label="Sprite tools">
              {([
                ["brush", "Brush (B)"],
                ["eraser", "Erase (E)"],
                ["eyedropper", "Pick (I)"],
                ["fill", "Fill (G)"],
                ["pan", "Pan (P)"],
              ] as [SpriteTool, string][]).map(([name, label]) => (
                <button key={name} aria-pressed={tool === name} onClick={() => setTool(name)}>{label}</button>
              ))}
            </div>
            <section className="sprite-editor-palette" aria-label="Sprite color palette">
              <button
                className="sprite-editor-panel-toggle"
                aria-expanded={paletteVisible}
                onClick={() => setPaletteVisible((visible) => {
                  const next = !visible;
                  writePanelPreference(PALETTE_PREFERENCE, next);
                  return next;
                })}
              >
                Palette {paletteVisible ? "▾" : "▸"}
              </button>
              {paletteVisible && (
                <div className="sprite-editor-palette-content">
                  <label>
                    Selected color
                    <input type="color" value={brushColor} onChange={(event) => setBrushColor(event.target.value)} />
                  </label>
                  <div className="sprite-editor-swatches" role="group" aria-label="Quick colors">
                    {["#000000", "#ffffff", "#e64553", "#40a02b", "#1e66f5", "#df8e1d", "#8839ef", "#179299"].map((color) => (
                      <button
                        key={color}
                        type="button"
                        aria-label={`Select ${color}`}
                        aria-pressed={brushColor.toLowerCase() === color}
                        style={{ backgroundColor: color }}
                        onClick={() => setBrushColor(color)}
                      />
                    ))}
                  </div>
                  <label>
                    Brush size: {brushSize}px
                    <input type="range" min="1" max="8" value={brushSize}
                      onChange={(event) => setBrushSize(Number(event.target.value))} />
                  </label>
                </div>
              )}
            </section>
            <div className="sprite-editor-tool-row" role="group" aria-label="Sprite edit history">
              <button disabled={!historyRef.current.canUndo()} onClick={undoSprite}>Undo</button>
              <button disabled={!historyRef.current.canRedo()} onClick={redoSprite}>Redo</button>
            </div>
            <div className="sprite-editor-tool-row">
              <button aria-label="Zoom in" onClick={() => zoomViewportAt(2)}>Zoom +</button>
              <button aria-label="Zoom out" onClick={() => zoomViewportAt(0.5)}>Zoom −</button>
            </div>
            <label>
              Trace overlay
              <input
                type="file"
                accept="image/*"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  handleTraceFile(file);
                }}
              />
            </label>
            {traceImage && (
              <>
                <button
                  type="button"
                  aria-pressed={positionTraceWithTouch}
                  onClick={() => setPositionTraceWithTouch((enabled) => !enabled)}
                >
                  Position trace with touch
                </button>
                {positionTraceWithTouch && (
                  <span role="status">Drag with one finger; pinch to scale and align the trace.</span>
                )}
                <label>
                  Trace opacity: {traceOpacity}%
                  <input type="range" min="0" max="100" value={traceOpacity}
                    onChange={(event) => setTraceOpacity(Number(event.target.value))} />
                </label>
                <label>
                  Trace scale: {traceScale}%
                  <input type="range" min="25" max="200" value={traceScale}
                    onChange={(event) => setTraceScale(Number(event.target.value))} />
                </label>
                <label>
                  Trace horizontal alignment: {traceOffsetX}
                  <input type="range" min="-100" max="100" value={traceOffsetX}
                    onChange={(event) => setTraceOffsetX(Number(event.target.value))} />
                </label>
                <label>
                  Trace vertical alignment: {traceOffsetY}
                  <input type="range" min="-100" max="100" value={traceOffsetY}
                    onChange={(event) => setTraceOffsetY(Number(event.target.value))} />
                </label>
                <button
                  type="button"
                  aria-label="Reset trace alignment"
                  onClick={() => {
                    setTraceOpacity(DEFAULT_SPRITE_TRACE_TRANSFORM.opacity);
                    setTraceScale(DEFAULT_SPRITE_TRACE_TRANSFORM.scale);
                    setTraceOffsetX(DEFAULT_SPRITE_TRACE_TRANSFORM.offsetX);
                    setTraceOffsetY(DEFAULT_SPRITE_TRACE_TRANSFORM.offsetY);
                  }}
                >
                  Reset trace alignment
                </button>
                <button onClick={() => {
                  traceLoadId.current += 1;
                  if (traceUrl.current) URL.revokeObjectURL(traceUrl.current);
                  traceUrl.current = null;
                  setTraceImage(null);
                  setTraceOffsetX(0);
                  setTraceOffsetY(0);
                  }}>
                    Remove trace
                  </button>
              </>
            )}
            <div className="sprite-editor-save-mode" role="group" aria-label="Save mode">
              <span>Save mode</span>
              <button
                type="button"
                aria-pressed={saveMode === "copy"}
                onClick={() => setSaveMode("copy")}
              >
                Save as copy (safe default)
              </button>
              <button
                type="button"
                aria-pressed={saveMode === "original"}
                onClick={() => setSaveMode("original")}
              >
                Replace original PNG
              </button>
            </div>
            {saveMode === "copy" && (
              <label>
                Copy name
                <input value={targetName} onChange={(event) => setTargetName(event.target.value)} maxLength={128} />
              </label>
            )}
            {loading && <span role="status">Loading sprite…</span>}
            {dirty && <span className="sprite-editor-dirty">Unsaved pixel edits</span>}
            {error && <span className="sprite-editor-error" role="alert">{error}</span>}
            <span className="sprite-editor-shortcuts">
              B brush · E erase · I pick · G fill · P pan · Ctrl/Cmd+Z undo · Ctrl/Cmd+Y redo
            </span>
          </aside>
          <div className="sprite-editor-canvas-wrap">
            <canvas
              ref={canvasRef}
              className="sprite-editor-canvas"
              role="application"
              aria-label="Sprite canvas"
              aria-busy={loading}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
              onWheel={handleWheelZoom}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
