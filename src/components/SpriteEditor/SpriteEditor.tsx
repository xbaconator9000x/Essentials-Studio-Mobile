import { useCallback, useEffect, useRef, useState } from "react";
import { confirmEditor } from "../../services/editorDialog";
import { clearImageCache, loadCharacterImage } from "../../services/imageLoader";
import { listAssetFiles, savePrivateProjectSprite } from "../../services/tauriApi";
import { useEditorRegistration, useProjectSave } from "../../context/ProjectSaveContext";
import { spritePixelAt, zoomSpriteViewport } from "../../services/spriteEditorGeometry";

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
  const [tool, setTool] = useState<"brush" | "pan">("brush");
  const [brushColor, setBrushColor] = useState("#ffffff");
  const [brushSize, setBrushSize] = useState(1);
  const [zoom, setZoom] = useState(4);
  const [offsetX, setOffsetX] = useState(12);
  const [offsetY, setOffsetY] = useState(12);
  const [traceImage, setTraceImage] = useState<HTMLImageElement | null>(null);
  const [traceOpacity, setTraceOpacity] = useState(35);
  const [traceScale, setTraceScale] = useState(100);
  const [imageRevision, setImageRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointerPositions = useRef(new Map<number, PointerPoint>());
  const activePaintPointer = useRef<number | null>(null);
  const activePan = useRef<{ id: number; point: PointerPoint; x: number; y: number } | null>(null);
  const pinchStart = useRef<{
    distance: number;
    center: PointerPoint;
    viewport: { zoom: number; offsetX: number; offsetY: number };
  } | null>(null);
  const traceUrl = useRef<string | null>(null);

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
            offsetX + (source.width * zoom - width) / 2,
            offsetY + (source.height * zoom - height) / 2,
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
  }, [imageRevision, offsetX, offsetY, zoom, traceImage, traceOpacity, traceScale]);

  const paintPixel = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    const source = imageCanvasRef.current;
    const context = source?.getContext("2d");
    if (!canvas || !source || !context) return;
    const rect = canvas.getBoundingClientRect();
    const pixel = spritePixelAt(
      clientX - rect.left,
      clientY - rect.top,
      { zoom, offsetX, offsetY },
      source.width,
      source.height,
    );
    if (!pixel) return;
    context.fillStyle = brushColor;
    context.fillRect(
      pixel.x - Math.floor(brushSize / 2),
      pixel.y - Math.floor(brushSize / 2),
      brushSize,
      brushSize,
    );
    setDirty(true);
    updateDirty("sprite-editor", true);
    setImageRevision((value) => value + 1);
  }, [brushColor, brushSize, offsetX, offsetY, updateDirty, zoom]);

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
        source.getContext("2d")?.drawImage(image, 0, 0);
        imageCanvasRef.current = source;
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
      activePaintPointer.current = null;
      activePan.current = null;
      return;
    }
    if (tool === "pan" || event.button === 1) {
      activePan.current = { id: event.pointerId, point, x: offsetX, y: offsetY };
    } else {
      activePaintPointer.current = event.pointerId;
      paintPixel(event.clientX, event.clientY);
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
    } else if (activePaintPointer.current === event.pointerId) {
      paintPixel(event.clientX, event.clientY);
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    pointerPositions.current.delete(event.pointerId);
    if (activePaintPointer.current === event.pointerId) activePaintPointer.current = null;
    if (activePan.current?.id === event.pointerId) activePan.current = null;
    if (pointerPositions.current.size < 2) pinchStart.current = null;
  };

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
            <button disabled={!dirty || saving} onClick={() => void saveSprite().catch(() => {})}>
              {saving ? "Saving…" : "Save sprite"}
            </button>
            <button disabled={saving} onClick={() => void requestClose()}>Close</button>
          </div>
        </header>
        <div className="sprite-editor-workspace">
          <aside className="sprite-editor-tools">
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
            <div className="sprite-editor-tool-row" aria-label="Sprite tool">
              <button aria-pressed={tool === "brush"} onClick={() => setTool("brush")}>Brush</button>
              <button aria-pressed={tool === "pan"} onClick={() => setTool("pan")}>Pan</button>
            </div>
            <label>
              Brush color
              <input type="color" value={brushColor} onChange={(event) => setBrushColor(event.target.value)} />
            </label>
            <label>
              Brush size: {brushSize}px
              <input type="range" min="1" max="8" value={brushSize}
                onChange={(event) => setBrushSize(Number(event.target.value))} />
            </label>
            <div className="sprite-editor-tool-row">
              <button onClick={() => setZoom((value) => Math.min(32, value * 2))}>Zoom +</button>
              <button onClick={() => setZoom((value) => Math.max(1, value / 2))}>Zoom −</button>
              <button onClick={fitSprite}>Fit</button>
            </div>
            <label>
              Trace overlay
              <input type="file" accept="image/*" onChange={(event) => handleTraceFile(event.target.files?.[0])} />
            </label>
            {traceImage && (
              <>
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
                <button onClick={() => {
                  if (traceUrl.current) URL.revokeObjectURL(traceUrl.current);
                  traceUrl.current = null;
                  setTraceImage(null);
                }}>Remove trace</button>
              </>
            )}
            <label>
              Save mode
              <select value={saveMode} onChange={(event) => setSaveMode(event.target.value as "original" | "copy")}>
                <option value="copy">Save as copy (safe default)</option>
                <option value="original">Replace original PNG</option>
              </select>
            </label>
            {saveMode === "copy" && (
              <label>
                Copy name
                <input value={targetName} onChange={(event) => setTargetName(event.target.value)} maxLength={128} />
              </label>
            )}
            {loading && <span role="status">Loading sprite…</span>}
            {dirty && <span className="sprite-editor-dirty">Unsaved pixel edits</span>}
            {error && <span className="sprite-editor-error" role="alert">{error}</span>}
          </aside>
          <div className="sprite-editor-canvas-wrap">
            <canvas
              ref={canvasRef}
              className="sprite-editor-canvas"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
