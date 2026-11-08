import { useCallback, useEffect, useRef, useState } from "react";
import { confirmEditor } from "../../services/editorDialog";
import { clearImageCache, loadCharacterImage } from "../../services/imageLoader";
import { listAssetFiles, savePrivateProjectSprite } from "../../services/tauriApi";
import { useEditorRegistration, useProjectSave } from "../../context/ProjectSaveContext";
import {
  rasterizeSpriteLine,
  spritePixelAt,
  zoomSpriteViewport,
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

export function SpriteEditor({ projectPath, onClose, onSaved }: Props) {
  const { updateDirty } = useProjectSave();
  const [names, setNames] = useState<string[]>([]);
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
  const [traceOpacity, setTraceOpacity] = useState(35);
  const [traceScale, setTraceScale] = useState(100);
  const [traceOffsetX, setTraceOffsetX] = useState(0);
  const [traceOffsetY, setTraceOffsetY] = useState(0);
  const [positionTraceWithTouch, setPositionTraceWithTouch] = useState(false);
  const [imageRevision, setImageRevision] = useState(0);
  const [, setHistoryRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [controlsCollapsed, setControlsCollapsed] = useState(
    () => typeof window.matchMedia === "function" && window.matchMedia("(max-width: 700px)").matches,
  );
  const [paletteVisible, setPaletteVisible] = useState(true);
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
    distance: number;
    center: PointerPoint;
    viewport: { zoom: number; offsetX: number; offsetY: number };
  } | null>(null);
  const traceUrl = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const compactViewport = window.matchMedia("(max-width: 700px)");
    const updateControls = (event: MediaQueryListEvent) => setControlsCollapsed(event.matches);
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
        const bounds = canvasRef.current?.parentElement?.getBoundingClientRect();
        if (bounds?.width && bounds.height) {
          const fit = Math.max(1, Math.min(16, Math.floor(
            Math.min((bounds.width - 32) / source.width, (bounds.height - 32) / source.height),
          )));
          setZoom(fit);
          setOffsetX((bounds.width - source.width * fit) / 2);
          setOffsetY((bounds.height - source.height * fit) / 2);
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

  const fitSprite = useCallback(() => {
    const source = imageCanvasRef.current;
    const canvas = canvasRef.current;
    if (!source || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const fit = Math.max(1, Math.min(16, Math.floor(
      Math.min((rect.width - 32) / source.width, (rect.height - 32) / source.height),
    )));
    setZoom(fit);
    setOffsetX((rect.width - source.width * fit) / 2);
    setOffsetY((rect.height - source.height * fit) / 2);
  }, []);

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
        context.drawImage(source, offsetX, offsetY, source.width * zoom, source.height * zoom);
        if (traceImage) {
          const width = source.width * zoom * traceScale / 100;
          const height = source.height * zoom * traceScale / 100;
          context.globalAlpha = traceOpacity / 100;
          context.drawImage(
            traceImage,
            offsetX + (source.width * zoom - width) / 2 + source.width * zoom * traceOffsetX / 100,
            offsetY + (source.height * zoom - height) / 2 + source.height * zoom * traceOffsetY / 100,
            width,
            height,
          );
          context.globalAlpha = 1;
        }
        if (zoom >= 4) {
          const left = Math.max(0, Math.floor(-offsetX / zoom));
          const top = Math.max(0, Math.floor(-offsetY / zoom));
          const right = Math.min(source.width, Math.ceil((rect.width - offsetX) / zoom));
          const bottom = Math.min(source.height, Math.ceil((rect.height - offsetY) / zoom));
          context.strokeStyle = "rgba(255,255,255,0.2)";
          context.lineWidth = 1;
          context.beginPath();
          for (let x = left; x <= right; x++) {
            const screenX = Math.round(offsetX + x * zoom) + 0.5;
            context.moveTo(screenX, offsetY + top * zoom);
            context.lineTo(screenX, offsetY + bottom * zoom);
          }
          for (let y = top; y <= bottom; y++) {
            const screenY = Math.round(offsetY + y * zoom) + 0.5;
            context.moveTo(offsetX + left * zoom, screenY);
            context.lineTo(offsetX + right * zoom, screenY);
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
    source.getContext("2d")?.putImageData(imageData, 0, 0);
    setDirty(true);
    updateDirty("sprite-editor", true);
    setImageRevision((value) => value + 1);
  }, [updateDirty]);

  const redoSprite = useCallback(() => {
    const imageData = imageDataRef.current;
    const source = imageCanvasRef.current;
    if (!imageData || !source || !historyRef.current.redo(imageData.data)) return;
    source.getContext("2d")?.putImageData(imageData, 0, 0);
    setDirty(true);
    updateDirty("sprite-editor", true);
    setImageRevision((value) => value + 1);
  }, [updateDirty]);

  const cancelStroke = useCallback(() => {
    const imageData = imageDataRef.current;
    const source = imageCanvasRef.current;
    if (!imageData || !source || !historyRef.current.cancel(imageData.data)) return;
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
      setSelectedName(savedName);
      setTargetName(`${savedName}_copy`);
      setSaveMode("original");
      setDirty(false);
      updateDirty("sprite-editor", false);
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
    const point = { x: event.clientX, y: event.clientY };
    pointerPositions.current.set(event.pointerId, point);
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* WebView capture may be unavailable. */ }
    if (event.pointerType === "touch" && pointerPositions.current.size >= 2) {
      const points = [...pointerPositions.current.values()];
      const center = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
      pinchStart.current = {
        distance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y),
        center,
        viewport: { zoom, offsetX, offsetY },
      };
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
      const next = zoomSpriteViewport(
        pinch.viewport,
        { x: pinch.center.x - rect.left, y: pinch.center.y - rect.top },
        { x: center.x - rect.left, y: center.y - rect.top },
        pinch.distance > 0 ? distance / pinch.distance : 1,
      );
      setZoom(next.zoom);
      setOffsetX(next.offsetX);
      setOffsetY(next.offsetY);
      return;
    }
    const pan = activePan.current;
    if (pan?.id === event.pointerId) {
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
    if (!file.type.startsWith("image/")) {
      setError("Trace overlay must be an image");
      return;
    }
    if (file.size > 32 * 1024 * 1024) {
      setError("Trace overlay must be 32 MiB or smaller");
      return;
    }
    if (traceUrl.current) URL.revokeObjectURL(traceUrl.current);
    const url = URL.createObjectURL(file);
    traceUrl.current = url;
    const image = new Image();
    image.onload = () => {
      if (image.width * image.height > 16_777_216) {
        setError("Trace overlay exceeds the 16-megapixel image limit");
        URL.revokeObjectURL(url);
        traceUrl.current = null;
        return;
      }
      setTraceImage(image);
    };
    image.onerror = () => setError("Could not load trace overlay");
    image.src = url;
  };

  useEffect(() => () => {
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
              onClick={() => setControlsCollapsed((collapsed) => !collapsed)}
            >
              {controlsCollapsed ? "Tools ▸" : "Tools ▾"}
            </button>
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
            <label>
              Character
              <select value={selectedName} onChange={(event) => {
                const name = event.target.value;
                setSelectedName(name);
                setTargetName(`${name}_copy`);
                setDirty(false);
                setError(null);
              }} disabled={dirty || loading || saving}>
                {names.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
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
                onClick={() => setPaletteVisible((visible) => !visible)}
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
              <button aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(32, value * 2))}>Zoom +</button>
              <button aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(1, value / 2))}>Zoom −</button>
              <button onClick={fitSprite}>Fit</button>
            </div>
            <label>
              Trace overlay
              <input type="file" accept="image/*" onChange={(event) => handleTraceFile(event.target.files?.[0])} />
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
                {positionTraceWithTouch && <span role="status">Drag the canvas to align the trace.</span>}
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
                <button onClick={() => {
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
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
