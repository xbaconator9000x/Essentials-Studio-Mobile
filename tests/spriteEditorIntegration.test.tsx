// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ProjectSaveProvider, useProjectSave } from "../src/context/ProjectSaveContext";
import { SpriteEditor } from "../src/components/SpriteEditor/SpriteEditor";

const editorApi = vi.hoisted(() => ({
  listAssetFiles: vi.fn(),
  savePrivateProjectSprite: vi.fn(),
  loadCharacterImage: vi.fn(),
  clearImageCache: vi.fn(),
}));
const editorDialogs = vi.hoisted(() => ({
  confirmEditor: vi.fn(async () => true),
}));

const fillRect = vi.fn();
const putImageData = vi.fn();

vi.mock("../src/services/tauriApi", () => editorApi);
vi.mock("../src/services/imageLoader", () => editorApi);
vi.mock("../src/services/editorDialog", () => editorDialogs);

const context = {
  imageSmoothingEnabled: false,
  fillStyle: "",
  setTransform: vi.fn(),
  fillRect,
  clearRect: vi.fn(),
  drawImage: vi.fn(),
  getImageData: vi.fn((_x: number, _y: number, width: number, height: number) => ({
    data: new Uint8ClampedArray(width * height * 4),
    width,
    height,
    colorSpace: "srgb",
  })),
  putImageData,
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
} as unknown as CanvasRenderingContext2D;

function renderEditor(onSaved = vi.fn()) {
  return render(
    <ProjectSaveProvider>
      <RenderedEditor onSaved={onSaved} />
    </ProjectSaveProvider>,
  );
}

function RenderedEditor({ onSaved }: { onSaved: () => void }) {
  const { saveAll } = useProjectSave();
  return (
    <>
      <button onClick={() => void saveAll()}>Save All</button>
      <SpriteEditor projectPath="/synthetic-project" onClose={vi.fn()} onSaved={onSaved} />
    </>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  editorApi.listAssetFiles.mockResolvedValue(["Guide"]);
  editorApi.loadCharacterImage.mockResolvedValue({ width: 4, height: 4 });
  editorApi.savePrivateProjectSprite.mockImplementation(
    async (_path: string, _source: string, target: string, mode: string) =>
      mode === "copy" ? target : _source,
  );
  HTMLCanvasElement.prototype.getContext = vi.fn(() => context);
  HTMLCanvasElement.prototype.toDataURL = vi.fn(() => "data:image/png;base64,cGl4ZWxz");
  HTMLElement.prototype.getBoundingClientRect = vi.fn(() => ({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 200,
    bottom: 200,
    width: 200,
    height: 200,
    toJSON: () => ({}),
  }));
  if (!window.PointerEvent) {
    class TestPointerEvent extends MouseEvent {
      pointerId: number;
      pointerType: string;

      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 0;
        this.pointerType = init.pointerType ?? "";
      }
    }
    window.PointerEvent = TestPointerEvent as typeof PointerEvent;
  }
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("sprite editor integration", () => {
  it("keeps the sprite canvas available with collapsible controls that follow orientation changes", async () => {
    let onMediaChange: ((event: MediaQueryListEvent) => void) | undefined;
    const mediaQuery = {
      matches: true,
      addEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => {
        onMediaChange = listener;
      }),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal("matchMedia", vi.fn(() => mediaQuery));
    const view = renderEditor();
    await screen.findByDisplayValue("Guide");

    expect(view.container.querySelector('[aria-label="Sprite canvas"]')).toBeTruthy();
    expect(screen.queryByRole("searchbox", { name: "Filter project character sprites" })).toBeNull();
    act(() => onMediaChange?.({ matches: false } as MediaQueryListEvent));
    expect(screen.getByRole("searchbox", { name: "Filter project character sprites" })).toBeTruthy();
    act(() => onMediaChange?.({ matches: true } as MediaQueryListEvent));
    expect(screen.queryByRole("searchbox", { name: "Filter project character sprites" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Tools ▸" }));
    fireEvent.click(screen.getByRole("button", { name: "Palette ▾" }));
    expect(screen.queryByRole("group", { name: "Quick colors" })).toBeNull();
    view.unmount();

    const reopened = renderEditor();
    await screen.findByDisplayValue("Guide");
    expect(screen.getByRole("searchbox", { name: "Filter project character sprites" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Quick colors" })).toBeNull();
    expect(reopened.container.querySelector('[aria-label="Sprite canvas"]')).toBeTruthy();
  });

  it("filters project sprites by name while preserving the selected sprite and copy target", async () => {
    editorApi.listAssetFiles.mockResolvedValue(["Guide", "Hero", "Guide_Alt"]);
    const view = renderEditor();
    await screen.findByDisplayValue("Guide");
    const search = screen.getByRole("searchbox", { name: "Filter project character sprites" });

    fireEvent.change(search, { target: { value: "hero" } });
    expect(screen.getByRole("option", { name: "Hero" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Guide (current)" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Guide_Alt" })).toBeNull();
    expect(screen.getByDisplayValue("Guide_copy")).toBeTruthy();

    fireEvent.change(screen.getByRole("combobox", { name: "Select project character sprite" }), {
      target: { value: "Hero" },
    });
    await waitFor(() => expect(editorApi.loadCharacterImage).toHaveBeenLastCalledWith(
      "/synthetic-project",
      "Hero",
    ));
    expect(screen.getByDisplayValue("Hero_copy")).toBeTruthy();
    expect(view.container.querySelector('[aria-label="Sprite canvas"]')).toBeTruthy();
  });

  it("reports when a sprite filter has no matches without replacing the selected asset", async () => {
    editorApi.listAssetFiles.mockResolvedValue(["Guide", "Hero"]);
    renderEditor();
    await screen.findByDisplayValue("Guide");

    fireEvent.change(screen.getByRole("searchbox", { name: "Filter project character sprites" }), {
      target: { value: "missing" },
    });

    expect(screen.getByRole("status").textContent).toContain("No project sprites match");
    expect((screen.getByRole("combobox", { name: "Select project character sprite" }) as HTMLSelectElement).value).toBe("Guide");
    expect(screen.getByRole("option", { name: "Guide (current)" })).toBeTruthy();
  });

  it("explains when the project has no character sprites", async () => {
    editorApi.listAssetFiles.mockResolvedValue([]);
    renderEditor();

    expect((await screen.findByRole("status")).textContent).toBe(
      "No character sprites were found in this project.",
    );
    expect(screen.getByRole("combobox", { name: "Select project character sprite" }).hasAttribute("disabled")).toBe(true);
  });

  it("edits a project character, registers it as dirty, and saves an explicit copy", async () => {
    const onSaved = vi.fn();
    const view = renderEditor(onSaved);
    await screen.findByDisplayValue("Guide");
    await waitFor(() => expect(context.drawImage).toHaveBeenCalled());
    const editorCanvas = view.container.querySelector(".sprite-editor-canvas");
    expect(editorCanvas).toBeTruthy();
    expect(screen.queryByText("Unsaved pixel edits")).toBeNull();

    fireEvent.pointerDown(editorCanvas!, {
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      clientX: 100,
      clientY: 100,
    });
    expect(await screen.findByText("Unsaved pixel edits")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save All" }));

    await waitFor(() => expect(editorApi.savePrivateProjectSprite).toHaveBeenCalledTimes(1));
    expect(editorApi.savePrivateProjectSprite).toHaveBeenCalledWith(
      "/synthetic-project",
      "Guide",
      "Guide_copy",
      "copy",
      "data:image/png;base64,cGl4ZWxz",
    );
    expect(onSaved).toHaveBeenCalledTimes(1);
    await screen.findByDisplayValue("Guide_copy");
    await waitFor(() => expect(editorApi.loadCharacterImage).toHaveBeenLastCalledWith(
      "/synthetic-project",
      "Guide_copy",
    ));
  });

  it("does not paint the first touch when a second touch starts a pinch", async () => {
    const view = renderEditor();
    await screen.findByDisplayValue("Guide");
    await waitFor(() => expect(context.drawImage).toHaveBeenCalled());
    const editorCanvas = view.container.querySelector(".sprite-editor-canvas");
    expect(editorCanvas).toBeTruthy();
    fillRect.mockClear();
    putImageData.mockClear();

    fireEvent.pointerDown(editorCanvas!, {
      pointerId: 1,
      pointerType: "touch",
      button: 0,
      clientX: 100,
      clientY: 100,
    });
    expect(fillRect).not.toHaveBeenCalled();
    expect(putImageData).not.toHaveBeenCalled();
    fireEvent.pointerDown(editorCanvas!, {
      pointerId: 2,
      pointerType: "touch",
      button: 0,
      clientX: 120,
      clientY: 100,
    });

    expect(fillRect).not.toHaveBeenCalled();
    expect(screen.queryByText("Unsaved pixel edits")).toBeNull();
  });

  it("paints a single-finger touch tap on release", async () => {
    const view = renderEditor();
    await screen.findByDisplayValue("Guide");
    await waitFor(() => expect(context.drawImage).toHaveBeenCalled());
    const editorCanvas = view.container.querySelector(".sprite-editor-canvas");
    expect(editorCanvas).toBeTruthy();
    putImageData.mockClear();

    fireEvent.pointerDown(editorCanvas!, {
      pointerId: 1,
      pointerType: "touch",
      button: 0,
      clientX: 100,
      clientY: 100,
    });
    expect(putImageData).not.toHaveBeenCalled();
    fireEvent.pointerUp(editorCanvas!, {
      pointerId: 1,
      pointerType: "touch",
      button: 0,
      clientX: 100,
      clientY: 100,
    });

    expect(putImageData).toHaveBeenCalledTimes(1);
    expect(putImageData.mock.calls[0][0].data[2 * 4 * 4 + 2 * 4 + 3]).toBe(255);
    expect(await screen.findByText("Unsaved pixel edits")).toBeTruthy();
  });

  it("interpolates a fast single-finger touch brush stroke across missed pixels", async () => {
    const view = renderEditor();
    await screen.findByDisplayValue("Guide");
    await waitFor(() => expect(context.drawImage).toHaveBeenCalled());
    const editorCanvas = view.container.querySelector(".sprite-editor-canvas");
    expect(editorCanvas).toBeTruthy();
    putImageData.mockClear();

    fireEvent.pointerDown(editorCanvas!, {
      pointerId: 1,
      pointerType: "touch",
      button: 0,
      clientX: 76,
      clientY: 76,
    });
    fireEvent.pointerMove(editorCanvas!, {
      pointerId: 1,
      pointerType: "touch",
      button: 0,
      clientX: 124,
      clientY: 76,
    });
    expect(putImageData).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(editorCanvas!, {
      pointerId: 1,
      pointerType: "touch",
      button: 0,
      clientX: 124,
      clientY: 76,
    });

    const pixels = putImageData.mock.calls.at(-1)?.[0].data as Uint8ClampedArray;
    expect([0, 1, 2, 3].map((x) => pixels[x * 4 + 3])).toEqual([255, 255, 255, 255]);
    expect(await screen.findByText("Unsaved pixel edits")).toBeTruthy();
    const undoButton = screen.getByRole("button", { name: "Undo" });
    expect(undoButton.disabled).toBe(false);
    fireEvent.click(undoButton);
    const undonePixels = putImageData.mock.calls.at(-1)?.[0].data as Uint8ClampedArray;
    expect([0, 1, 2, 3].map((x) => undonePixels[x * 4 + 3])).toEqual([0, 0, 0, 0]);
  });

  it("confirms and saves an edit to the original character graphic", async () => {
    const view = renderEditor();
    await screen.findByDisplayValue("Guide");
    await waitFor(() => expect(context.drawImage).toHaveBeenCalled());
    const editorCanvas = view.container.querySelector(".sprite-editor-canvas");
    expect(editorCanvas).toBeTruthy();
    fireEvent.pointerDown(editorCanvas!, {
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.click(screen.getByRole("button", { name: "Replace original PNG" }));
    fireEvent.click(screen.getByRole("button", { name: "Save sprite" }));

    await waitFor(() => expect(editorApi.savePrivateProjectSprite).toHaveBeenCalledWith(
      "/synthetic-project",
      "Guide",
      "Guide",
      "original",
      "data:image/png;base64,cGl4ZWxz",
    ));
    expect(screen.getByRole("button", { name: "Replace original PNG" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Save as copy (safe default)" }).getAttribute("aria-pressed")).toBe("false");
    expect(editorDialogs.confirmEditor).toHaveBeenCalledWith(
      "Replace the original Guide.png character graphic?",
    );
  });

  it("keeps save-as-copy as the accessible safe default", async () => {
    renderEditor();
    await screen.findByDisplayValue("Guide");

    expect(screen.getByRole("group", { name: "Save mode" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save as copy (safe default)" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Replace original PNG" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByDisplayValue("Guide_copy")).toBeTruthy();
  });

  it("loads and removes a bounded trace overlay", async () => {
    const traceUrl = {
      createObjectURL: vi.fn(() => "blob:trace"),
      revokeObjectURL: vi.fn(),
    };
    class TestImage {
      width = 4;
      height = 4;
      onload: (() => void) | null = null;
      set src(_value: string) { this.onload?.(); }
    }
    vi.stubGlobal("URL", traceUrl);
    vi.stubGlobal("Image", TestImage as unknown as typeof Image);

    renderEditor();
    await screen.findByDisplayValue("Guide");
    await waitFor(() => expect(context.drawImage).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Trace overlay"), {
      target: { files: [new File(["trace"], "trace.png", { type: "image/png" })] },
    });

    expect(await screen.findByText("Trace opacity: 35%")).toBeTruthy();
    expect(screen.getByText("Trace scale: 100%")).toBeTruthy();
    expect(traceUrl.createObjectURL).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Remove trace" }));
    expect(traceUrl.revokeObjectURL).toHaveBeenCalledWith("blob:trace");
    expect(screen.queryByText("Trace opacity: 35%")).toBeNull();
  });

  it("positions the trace with a touch drag without painting the sprite", async () => {
    const traceUrl = {
      createObjectURL: vi.fn(() => "blob:trace"),
      revokeObjectURL: vi.fn(),
    };
    class TestImage {
      width = 4;
      height = 4;
      onload: (() => void) | null = null;
      set src(_value: string) { this.onload?.(); }
    }
    vi.stubGlobal("URL", traceUrl);
    vi.stubGlobal("Image", TestImage as unknown as typeof Image);

    const view = renderEditor();
    await screen.findByDisplayValue("Guide");
    const editorCanvas = view.container.querySelector(".sprite-editor-canvas");
    expect(editorCanvas).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Trace overlay"), {
      target: { files: [new File(["trace"], "trace.png", { type: "image/png" })] },
    });
    await screen.findByText("Trace opacity: 35%");
    fireEvent.click(screen.getByRole("button", { name: "Position trace with touch" }));

    fireEvent.pointerDown(editorCanvas!, {
      pointerId: 1,
      pointerType: "touch",
      button: 0,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(editorCanvas!, {
      pointerId: 1,
      pointerType: "touch",
      button: 0,
      clientX: 116,
      clientY: 116,
    });
    fireEvent.pointerUp(editorCanvas!, {
      pointerId: 1,
      pointerType: "touch",
      button: 0,
      clientX: 116,
      clientY: 116,
    });

    expect(screen.getByRole("slider", { name: /Trace horizontal alignment/ }).getAttribute("value")).toBe("25");
    expect(screen.getByRole("slider", { name: /Trace vertical alignment/ }).getAttribute("value")).toBe("25");
    expect(screen.queryByText("Unsaved pixel edits")).toBeNull();
  });

  it("keeps pinch zoom available while trace positioning is enabled", async () => {
    const traceUrl = {
      createObjectURL: vi.fn(() => "blob:trace"),
      revokeObjectURL: vi.fn(),
    };
    class TestImage {
      width = 4;
      height = 4;
      onload: (() => void) | null = null;
      set src(_value: string) { this.onload?.(); }
    }
    vi.stubGlobal("URL", traceUrl);
    vi.stubGlobal("Image", TestImage as unknown as typeof Image);

    const view = renderEditor();
    await screen.findByDisplayValue("Guide");
    const editorCanvas = view.container.querySelector(".sprite-editor-canvas");
    expect(editorCanvas).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Trace overlay"), {
      target: { files: [new File(["trace"], "trace.png", { type: "image/png" })] },
    });
    await screen.findByText("Trace opacity: 35%");
    fireEvent.click(screen.getByRole("button", { name: "Position trace with touch" }));
    context.drawImage.mockClear();

    fireEvent.pointerDown(editorCanvas!, { pointerId: 1, pointerType: "touch", clientX: 80, clientY: 100 });
    fireEvent.pointerDown(editorCanvas!, { pointerId: 2, pointerType: "touch", clientX: 120, clientY: 100 });
    fireEvent.pointerMove(editorCanvas!, { pointerId: 2, pointerType: "touch", clientX: 140, clientY: 100 });
    fireEvent.pointerUp(editorCanvas!, { pointerId: 2, pointerType: "touch", clientX: 140, clientY: 100 });

    await waitFor(() => expect(context.drawImage.mock.calls.some((call) => call[3] === 96)).toBe(true));
    expect(screen.getByRole("slider", { name: /Trace horizontal alignment/ }).getAttribute("value")).toBe("0");
    expect(screen.getByRole("slider", { name: /Trace vertical alignment/ }).getAttribute("value")).toBe("0");
    expect(screen.queryByText("Unsaved pixel edits")).toBeNull();
  });

  it("hands a completed pinch to one-finger panning without painting", async () => {
    const view = renderEditor();
    await screen.findByDisplayValue("Guide");
    const editorCanvas = view.container.querySelector(".sprite-editor-canvas");
    expect(editorCanvas).toBeTruthy();
    context.drawImage.mockClear();
    putImageData.mockClear();

    fireEvent.pointerDown(editorCanvas!, { pointerId: 1, pointerType: "touch", clientX: 80, clientY: 100 });
    fireEvent.pointerDown(editorCanvas!, { pointerId: 2, pointerType: "touch", clientX: 120, clientY: 100 });
    fireEvent.pointerMove(editorCanvas!, { pointerId: 2, pointerType: "touch", clientX: 140, clientY: 100 });
    fireEvent.pointerUp(editorCanvas!, { pointerId: 2, pointerType: "touch", clientX: 140, clientY: 100 });
    fireEvent.pointerMove(editorCanvas!, { pointerId: 1, pointerType: "touch", clientX: 90, clientY: 100 });

    await waitFor(() => {
      expect(context.drawImage.mock.calls.some((call) => call[3] === 96 && call[1] === 72)).toBe(true);
    });
    expect(putImageData).not.toHaveBeenCalled();
    expect(screen.queryByText("Unsaved pixel edits")).toBeNull();
  });

  it("zooms around the pointer and centers button zoom without dirtying sprite pixels", async () => {
    const view = renderEditor();
    await screen.findByDisplayValue("Guide");
    await waitFor(() => expect(context.drawImage).toHaveBeenCalled());
    const editorCanvas = view.container.querySelector(".sprite-editor-canvas");
    expect(editorCanvas).toBeTruthy();
    const before = context.drawImage.mock.calls.at(-1)!;
    const widthBefore = Number(before[3]);
    const offsetBefore = Number(before[1]);
    const zoomBefore = widthBefore / 4;
    const anchorX = 82;
    const worldX = (anchorX - offsetBefore) / zoomBefore;

    fireEvent.wheel(editorCanvas!, { clientX: anchorX, clientY: 94, deltaY: -120, deltaMode: 0 });
    await waitFor(() => expect(context.drawImage.mock.calls.at(-1)).not.toBe(before));
    const afterWheel = context.drawImage.mock.calls.at(-1)!;
    const zoomAfter = Number(afterWheel[3]) / 4;
    expect(Number(afterWheel[1]) + worldX * zoomAfter).toBeCloseTo(anchorX, 5);
    expect(screen.queryByText("Unsaved pixel edits")).toBeNull();

    const centerX = 100;
    const beforeButtonZoom = context.drawImage.mock.calls.at(-1)!;
    const currentZoom = Number(beforeButtonZoom[3]) / 4;
    const centerWorldX = (centerX - Number(beforeButtonZoom[1])) / currentZoom;
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    await waitFor(() => expect(context.drawImage.mock.calls.at(-1)).not.toBe(beforeButtonZoom));
    const afterButtonZoom = context.drawImage.mock.calls.at(-1)!;
    const nextZoom = Number(afterButtonZoom[3]) / 4;
    expect(Number(afterButtonZoom[1]) + centerWorldX * nextZoom).toBeCloseTo(centerX, 5);
    expect(screen.queryByText("Unsaved pixel edits")).toBeNull();
  });

  it("ignores stale trace loads and revokes a failed replacement URL", async () => {
    const traceUrl = {
      createObjectURL: vi.fn((file: File) => `blob:${file.name}`),
      revokeObjectURL: vi.fn(),
    };
    const images: TestImage[] = [];
    class TestImage {
      width = 4;
      height = 4;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      private url = "";
      constructor() { images.push(this); }
      set src(value: string) { this.url = value; }
      get src() { return this.url; }
    }
    vi.stubGlobal("URL", traceUrl);
    vi.stubGlobal("Image", TestImage as unknown as typeof Image);

    renderEditor();
    await screen.findByDisplayValue("Guide");
    const traceInput = screen.getByLabelText("Trace overlay");
    fireEvent.change(traceInput, {
      target: { files: [new File(["first"], "first.png", { type: "image/png" })] },
    });
    fireEvent.change(traceInput, {
      target: { files: [new File(["second"], "second.png", { type: "image/png" })] },
    });
    expect(traceUrl.revokeObjectURL).toHaveBeenCalledWith("blob:first.png");

    act(() => images[1].onload?.());
    await waitFor(() => expect(context.drawImage.mock.calls.some((call) => call[0] === images[1])).toBe(true));
    context.drawImage.mockClear();
    act(() => images[0].onload?.());
    expect(context.drawImage).not.toHaveBeenCalled();

    fireEvent.change(traceInput, {
      target: { files: [new File(["broken"], "broken.png", { type: "image/png" })] },
    });
    act(() => images[2].onerror?.());
    expect(traceUrl.revokeObjectURL).toHaveBeenCalledWith("blob:broken.png");
    expect((await screen.findByRole("alert")).textContent).toContain("Could not load trace overlay");
  });
});
