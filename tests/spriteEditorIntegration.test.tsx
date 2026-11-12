// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ProjectSaveProvider, useProjectSave } from "../src/context/ProjectSaveContext";
import { SpriteEditor } from "../src/components/SpriteEditor/SpriteEditor";

const editorApi = vi.hoisted(() => ({
  listAssetFiles: vi.fn(),
  importPrivateProjectSprite: vi.fn(),
  savePrivateProjectSprite: vi.fn(),
  loadCharacterImage: vi.fn(),
  clearImageCache: vi.fn(),
}));
const spriteExport = vi.hoisted(() => ({ exportSpritePng: vi.fn(async () => "saved") }));
vi.mock("../src/services/spriteExport", () => spriteExport);
const editorDialogs = vi.hoisted(() => ({
  confirmEditor: vi.fn(async () => true),
}));

const fillRect = vi.fn();
const putImageData = vi.fn();
const serializedCanvases: HTMLCanvasElement[] = [];
let resizeObserverCallback: ResizeObserverCallback | null = null;
let spriteViewportBounds = { width: 200, height: 200 };
let spritePixelFixture: Uint8ClampedArray | null = null;

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
    data: spritePixelFixture?.length === width * height * 4
      ? new Uint8ClampedArray(spritePixelFixture)
      : new Uint8ClampedArray(width * height * 4),
    width,
    height,
    colorSpace: "srgb",
  })),
  putImageData,
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  strokeRect: vi.fn(),
  setLineDash: vi.fn(),
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
  resizeObserverCallback = null;
  spriteViewportBounds = { width: 200, height: 200 };
  spritePixelFixture = null;
  editorApi.listAssetFiles.mockResolvedValue(["Guide"]);
  editorApi.loadCharacterImage.mockResolvedValue({ width: 4, height: 4 });
  editorApi.savePrivateProjectSprite.mockImplementation(
    async (_path: string, _source: string, target: string, mode: string) =>
      mode === "copy" ? target : _source,
  );
  editorApi.importPrivateProjectSprite.mockImplementation(
    async (_path: string, target: string) => target,
  );
  HTMLCanvasElement.prototype.getContext = vi.fn(() => context);
  serializedCanvases.length = 0;
  HTMLCanvasElement.prototype.toDataURL = vi.fn(function (this: HTMLCanvasElement) {
    serializedCanvases.push(this);
    return "data:image/png;base64,cGl4ZWxz";
  });
  HTMLElement.prototype.getBoundingClientRect = vi.fn(() => ({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: spriteViewportBounds.width,
    bottom: spriteViewportBounds.height,
    width: spriteViewportBounds.width,
    height: spriteViewportBounds.height,
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
    constructor(callback: ResizeObserverCallback) {
      resizeObserverCallback = callback;
    }

    observe() {}
    disconnect() {}
    unobserve() {}
  };
});

afterEach(() => {
  cleanup();
  serializedCanvases.length = 0;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("sprite editor integration", () => {
  it("reconciles sprite selection and copy target when switching projects", async () => {
    editorApi.listAssetFiles.mockImplementation(async (path: string) =>
      path === "/project-a" ? ["Guide", "Hero"] : ["NewHero"]);
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    const onSaved = vi.fn();
    const editor = (path: string) => (
      <ProjectSaveProvider>
        <SpriteEditor projectPath={path} onClose={vi.fn()} onSaved={onSaved} />
      </ProjectSaveProvider>
    );
    const view = render(editor("/project-a"));
    await screen.findByDisplayValue("Guide");
    await waitFor(() => expect(editorApi.loadCharacterImage).toHaveBeenCalledWith("/project-a", "Guide"));
    view.rerender(editor("/project-b"));
    await screen.findByDisplayValue("NewHero");
    await waitFor(() => expect(editorApi.loadCharacterImage).toHaveBeenCalledWith("/project-b", "NewHero"));
    expect((screen.getByRole("textbox", { name: "Quick sprite copy name" }) as HTMLInputElement).value).toBe("NewHero_copy");
  });

  it("exports the unscaled source PNG without saving or changing the project", async () => {
    renderEditor();
    await screen.findByDisplayValue("Guide");
    const button = screen.getByRole("button", { name: "Export PNG" });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    await waitFor(() => expect(spriteExport.exportSpritePng).toHaveBeenCalledWith(
      "data:image/png;base64,cGl4ZWxz", "Guide_copy",
    ));
    expect(await screen.findByText("PNG saved to selected document")).toBeTruthy();
    expect(editorApi.savePrivateProjectSprite).not.toHaveBeenCalled();
    expect(serializedCanvases.at(-1)?.width).toBe(4);
  });

  it("exposes copy naming and original replacement in the collapsed portrait toolbar", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })));
    renderEditor();
    await screen.findByDisplayValue("Guide");
    const mode = screen.getByRole("combobox", { name: "Quick sprite save mode" });
    const name = screen.getByRole("textbox", { name: "Quick sprite copy name" });
    fireEvent.change(name, { target: { value: "Guide_New" } });
    expect((name as HTMLInputElement).value).toBe("Guide_New");
    fireEvent.change(mode, { target: { value: "original" } });
    expect(screen.queryByRole("textbox", { name: "Quick sprite copy name" })).toBeNull();
  });

  it("extracts real sprite colors and flips pixels as an undoable dirty edit", async () => {
    spritePixelFixture = new Uint8ClampedArray(4 * 4 * 4);
    spritePixelFixture.set([255,0,0,255,0,255,0,128], 0);
    renderEditor();
    await screen.findByDisplayValue("Guide");
    const extract = screen.getByRole("button", { name: "Extract colors" });
    await waitFor(() => expect((extract as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(extract);
    expect(screen.getByRole("button", { name: "Use sprite color #ff0000" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Flip H" }));
    expect(screen.getByText("Unsaved pixel edits")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement).disabled).toBe(false);
  });

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

  it("keeps project sprite selection and import reachable with the portrait tools collapsed", async () => {
    editorApi.listAssetFiles.mockResolvedValue(["Guide", "Hero"]);
    const importUrl = { createObjectURL: vi.fn(() => "blob:quick-import"), revokeObjectURL: vi.fn() };
    class TestImage {
      width = 8;
      height = 6;
      onload: (() => void) | null = null;
      set src(_value: string) { this.onload?.(); }
    }
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    vi.stubGlobal("URL", importUrl);
    vi.stubGlobal("Image", TestImage as unknown as typeof Image);

    renderEditor();
    await screen.findByDisplayValue("Guide");
    const picker = screen.getByRole("combobox", { name: "Quick select project character sprite" });
    expect(picker.closest('[hidden]')).toBeNull();
    fireEvent.change(picker, { target: { value: "Hero" } });
    await waitFor(() => expect(editorApi.loadCharacterImage).toHaveBeenLastCalledWith(
      "/synthetic-project",
      "Hero",
    ));

    const input = screen.getByLabelText("Quick import image as sprite copy") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["sprite"], "Visitor.png")] } });
    expect(await screen.findByText("Imported image: Visitor.png — save as a new copy.")).toBeTruthy();
    expect(input.value).toBe("");
    expect((picker as HTMLSelectElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Save All" }));
    await waitFor(() => expect(editorApi.importPrivateProjectSprite).toHaveBeenCalledWith(
      "/synthetic-project",
      "Visitor",
      "data:image/png;base64,cGl4ZWxz",
    ));
  });

  it("preserves imported pixels when an earlier project sprite load resolves late", async () => {
    let resolveProjectImage!: (image: { width: number; height: number }) => void;
    editorApi.loadCharacterImage.mockImplementationOnce(() =>
      new Promise((resolve) => { resolveProjectImage = resolve; }));
    const importUrl = { createObjectURL: vi.fn(() => "blob:late-load"), revokeObjectURL: vi.fn() };
    class TestImage {
      width = 8;
      height = 6;
      onload: (() => void) | null = null;
      set src(_value: string) { this.onload?.(); }
    }
    vi.stubGlobal("URL", importUrl);
    vi.stubGlobal("Image", TestImage as unknown as typeof Image);

    renderEditor();
    await screen.findByDisplayValue("Guide");
    await waitFor(() => expect(editorApi.loadCharacterImage).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("Quick import image as sprite copy"), {
      target: { files: [new File(["sprite"], "Visitor.png")] },
    });
    await screen.findByText("Unsaved imported sprite");
    await act(async () => { resolveProjectImage({ width: 4, height: 4 }); });
    expect(screen.getByText("Unsaved imported sprite")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save sprite" }).hasAttribute("disabled")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Save sprite" }));
    await waitFor(() => expect(editorApi.importPrivateProjectSprite).toHaveBeenCalledWith(
      "/synthetic-project", "Visitor", "data:image/png;base64,cGl4ZWxz",
    ));
  });

  it("allows renaming an imported sprite copy from the compact toolbar", async () => {
    const importUrl = { createObjectURL: vi.fn(() => "blob:quick-collision"), revokeObjectURL: vi.fn() };
    class TestImage {
      width = 8;
      height = 6;
      onload: (() => void) | null = null;
      set src(_value: string) { this.onload?.(); }
    }
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    vi.stubGlobal("URL", importUrl);
    vi.stubGlobal("Image", TestImage as unknown as typeof Image);

    renderEditor();
    await screen.findByDisplayValue("Guide");
    fireEvent.change(screen.getByLabelText("Quick import image as sprite copy"), {
      target: { files: [new File(["sprite"], "Visitor.png")] },
    });
    await screen.findByText("Unsaved imported sprite");
    const copyName = screen.getByRole("textbox", { name: "Quick imported sprite copy name" });
    fireEvent.change(copyName, { target: { value: "Visitor_safe" } });
    fireEvent.click(screen.getByRole("button", { name: "Save sprite" }));
    await waitFor(() => expect(editorApi.importPrivateProjectSprite).toHaveBeenCalledTimes(1));
    expect(editorApi.importPrivateProjectSprite).toHaveBeenCalledWith(
      "/synthetic-project",
      "Visitor_safe",
      "data:image/png;base64,cGl4ZWxz",
    );
    await waitFor(() => expect(screen.queryByText("Unsaved imported sprite")).toBeNull());
  });

  it("exposes non-destructive trace opacity and scale controls in the collapsed toolbar", async () => {
    const traceUrl = { createObjectURL: vi.fn(() => "blob:trace"), revokeObjectURL: vi.fn() };
    class TestImage {
      width = 4;
      height = 4;
      onload: (() => void) | null = null;
      set src(_value: string) { this.onload?.(); }
    }
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    vi.stubGlobal("URL", traceUrl);
    vi.stubGlobal("Image", TestImage as unknown as typeof Image);

    renderEditor();
    await screen.findByDisplayValue("Guide");
    const traceInput = screen.getByLabelText("Quick import trace overlay") as HTMLInputElement;
    fireEvent.change(traceInput, { target: { files: [new File(["trace"], "reference.png")] } });

    const opacity = await screen.findByRole("slider", { name: "Quick trace opacity" });
    const scale = screen.getByRole("slider", { name: "Quick trace scale" });
    fireEvent.change(opacity, { target: { value: "60" } });
    fireEvent.change(scale, { target: { value: "125" } });

    expect(opacity.getAttribute("value")).toBe("60");
    expect(scale.getAttribute("value")).toBe("125");
    expect(screen.getByRole("button", { name: "Position trace with touch" })).toBeTruthy();
    expect(editorApi.savePrivateProjectSprite).not.toHaveBeenCalled();
    expect(screen.queryByText("Unsaved pixel edits")).toBeNull();
  });

  it("keeps a fit-to-view action available with tools collapsed without dirtying pixels", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    const view = renderEditor();
    await screen.findByDisplayValue("Guide");
    await waitFor(() => expect(context.drawImage.mock.calls.some((call) => call.length === 5)).toBe(true));
    const canvas = view.container.querySelector(".sprite-editor-canvas");
    expect(canvas).toBeTruthy();
    expect(screen.queryByRole("searchbox", { name: "Filter project character sprites" })).toBeNull();

    fireEvent.wheel(canvas!, { clientX: 80, clientY: 94, deltaY: -120, deltaMode: 0 });
    await waitFor(() => expect(context.drawImage.mock.calls.at(-1)?.[3]).not.toBe(64));
    fireEvent.click(screen.getByRole("button", { name: "Fit sprite to view" }));
    await waitFor(() => {
      const call = context.drawImage.mock.calls.at(-1);
      expect(call?.slice(1)).toEqual([68, 68, 64, 64]);
    });
    expect(putImageData).not.toHaveBeenCalled();
    expect(screen.queryByText("Unsaved pixel edits")).toBeNull();
    expect(editorApi.savePrivateProjectSprite).not.toHaveBeenCalled();
  });

  it("keeps touch tools, color, and selection actions available when the tools panel is collapsed", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    const view = renderEditor();
    await screen.findByDisplayValue("Guide");
    const toolbar = screen.getByRole("toolbar", { name: "Quick sprite editing" });
    const erase = screen.getByRole("button", { name: "Erase sprite pixels" });
    expect(erase.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(erase);
    expect(erase.getAttribute("aria-pressed")).toBe("true");

    fireEvent.change(screen.getByLabelText("Quick sprite color"), {
      target: { value: "#e64553" },
    });
    expect((screen.getByLabelText("Quick sprite color") as HTMLInputElement).value).toBe("#e64553");
    fireEvent.change(screen.getByLabelText("Quick brush size"), {
      target: { value: "3" },
    });
    expect((screen.getByLabelText("Quick brush size") as HTMLInputElement).value).toBe("3");
    fireEvent.click(screen.getByRole("button", { name: "Select #40a02b" }));
    expect(screen.getByRole("button", { name: "Select #40a02b" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    await waitFor(() => expect(context.drawImage.mock.calls.at(-1)?.[3]).toBe(128));
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    await waitFor(() => expect(context.drawImage.mock.calls.at(-1)?.[3]).toBe(64));
    expect(screen.queryByText("Unsaved pixel edits")).toBeNull();
    expect(editorApi.savePrivateProjectSprite).not.toHaveBeenCalled();

    const copy = screen.getByRole("button", { name: "Copy", exact: true });
    expect(copy.hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Select sprite pixels" }));
    const canvas = view.container.querySelector(".sprite-editor-canvas")!;
    fireEvent.pointerDown(canvas, {
      pointerId: 1, pointerType: "mouse", button: 0, clientX: 100, clientY: 100,
    });
    fireEvent.pointerUp(canvas, {
      pointerId: 1, pointerType: "mouse", button: 0, clientX: 100, clientY: 100,
    });

    expect(copy.hasAttribute("disabled")).toBe(false);
    fireEvent.click(copy);
    expect(toolbar.textContent).toContain("Paste");
    expect(screen.getByRole("button", { name: "Paste", exact: true }).hasAttribute("disabled")).toBe(false);
  });

  it("positions a loaded trace from the collapsed toolbar without editing sprite pixels", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
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
    fireEvent.click(screen.getByRole("button", { name: "Tools ▸" }));
    fireEvent.change(screen.getByLabelText("Trace overlay"), {
      target: { files: [new File(["trace"], "trace.png", { type: "image/png" })] },
    });
    await screen.findByText("Trace opacity: 35%");
    fireEvent.click(screen.getByRole("button", { name: "Tools ▾" }));

    const position = screen.getByRole("button", { name: "Position trace with touch" });
    expect(position.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(position);
    expect(position.getAttribute("aria-pressed")).toBe("true");

    const canvas = view.container.querySelector(".sprite-editor-canvas")!;
    fireEvent.pointerDown(canvas, {
      pointerId: 1, pointerType: "touch", clientX: 100, clientY: 100,
    });
    fireEvent.pointerMove(canvas, {
      pointerId: 1, pointerType: "touch", clientX: 116, clientY: 116,
    });
    fireEvent.pointerUp(canvas, {
      pointerId: 1, pointerType: "touch", clientX: 116, clientY: 116,
    });

    fireEvent.click(screen.getByRole("button", { name: "Tools ▸" }));
    expect(screen.getByRole("slider", { name: /Trace horizontal alignment/ }).getAttribute("value")).toBe("25");
    expect(screen.getByRole("slider", { name: /Trace vertical alignment/ }).getAttribute("value")).toBe("25");
    expect(putImageData).not.toHaveBeenCalled();
    expect(screen.queryByText("Unsaved pixel edits")).toBeNull();
    expect(editorApi.savePrivateProjectSprite).not.toHaveBeenCalled();
  });

  it("keeps sprite undo and redo reachable when tools are collapsed", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    const view = renderEditor();
    await screen.findByDisplayValue("Guide");
    await waitFor(() => expect(context.drawImage.mock.calls.some((call) => call.length === 5)).toBe(true));
    const canvas = view.container.querySelector(".sprite-editor-canvas");
    expect(canvas).toBeTruthy();

    fireEvent.pointerDown(canvas!, {
      pointerId: 1, pointerType: "touch", button: 0, clientX: 100, clientY: 100,
    });
    fireEvent.pointerUp(canvas!, {
      pointerId: 1, pointerType: "touch", button: 0, clientX: 100, clientY: 100,
    });
    expect(await screen.findByText("Unsaved pixel edits")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tools ▾" }));

    const undo = screen.getByRole("button", { name: "Undo sprite edit" }) as HTMLButtonElement;
    const redo = screen.getByRole("button", { name: "Redo sprite edit" }) as HTMLButtonElement;
    expect(undo.disabled).toBe(false);
    expect(redo.disabled).toBe(true);

    fireEvent.click(undo);
    await waitFor(() => {
      expect(undo.disabled).toBe(true);
      expect(redo.disabled).toBe(false);
    });
    fireEvent.click(redo);
    await waitFor(() => {
      expect(undo.disabled).toBe(false);
      expect(redo.disabled).toBe(true);
    });
  });

  it("keeps the sprite fitted when the canvas resizes in fit mode", async () => {
    const view = renderEditor();
    await screen.findByDisplayValue("Guide");
    await waitFor(() => {
      expect(context.drawImage.mock.calls.some((call) =>
        call.slice(1).join(",") === "68,68,64,64"
      )).toBe(true);
    });

    spriteViewportBounds = { width: 320, height: 240 };
    act(() => resizeObserverCallback?.([], {} as ResizeObserver));

    await waitFor(() => {
      expect(context.drawImage.mock.calls.at(-1)?.slice(1)).toEqual([128, 88, 64, 64]);
    });
    expect(screen.queryByText("Unsaved pixel edits")).toBeNull();
    view.unmount();
  });

  it("preserves a manually zoomed sprite viewport when the canvas resizes", async () => {
    const view = renderEditor();
    await screen.findByDisplayValue("Guide");
    await waitFor(() => expect(context.drawImage.mock.calls.some((call) => call.length === 5)).toBe(true));

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    await waitFor(() => {
      expect(context.drawImage.mock.calls.at(-1)?.slice(1)).toEqual([36, 36, 128, 128]);
    });
    fireEvent.click(screen.getByRole("button", { name: "Pan (P)" }));
    fireEvent.pointerDown(view.container.querySelector(".sprite-editor-canvas")!, {
      pointerId: 1, pointerType: "mouse", clientX: 100, clientY: 100,
    });
    fireEvent.pointerMove(view.container.querySelector(".sprite-editor-canvas")!, {
      pointerId: 1, pointerType: "mouse", clientX: 110, clientY: 120,
    });
    fireEvent.pointerUp(view.container.querySelector(".sprite-editor-canvas")!, {
      pointerId: 1, pointerType: "mouse", clientX: 110, clientY: 120,
    });
    await waitFor(() => {
      expect(context.drawImage.mock.calls.at(-1)?.slice(1)).toEqual([46, 56, 128, 128]);
    });

    spriteViewportBounds = { width: 320, height: 240 };
    act(() => resizeObserverCallback?.([], {} as ResizeObserver));

    await waitFor(() => {
      expect(context.drawImage.mock.calls.at(-1)?.slice(1)).toEqual([46, 56, 128, 128]);
    });
    expect(screen.queryByText("Unsaved pixel edits")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Fit sprite to view" }));
    await waitFor(() => {
      expect(context.drawImage.mock.calls.at(-1)?.slice(1)).toEqual([128, 88, 64, 64]);
    });
    spriteViewportBounds = { width: 400, height: 320 };
    act(() => resizeObserverCallback?.([], {} as ResizeObserver));
    await waitFor(() => {
      expect(context.drawImage.mock.calls.at(-1)?.slice(1)).toEqual([168, 128, 64, 64]);
    });
    view.unmount();
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

  it("does not paint the previously selected sprite while the next image is loading", async () => {
    let finishHero!: (image: { width: number; height: number }) => void;
    editorApi.listAssetFiles.mockResolvedValue(["Guide", "Hero"]);
    editorApi.loadCharacterImage.mockImplementation((_path: string, name: string) =>
      name === "Hero"
        ? new Promise((resolve) => { finishHero = resolve; })
        : Promise.resolve({ width: 4, height: 4 }),
    );
    const view = renderEditor();
    await screen.findByDisplayValue("Guide");
    await waitFor(() => expect(context.drawImage).toHaveBeenCalled());
    const canvas = view.container.querySelector(".sprite-editor-canvas");
    const picker = screen.getByRole("combobox", { name: "Select project character sprite" });
    expect(canvas).toBeTruthy();

    fireEvent.change(picker, { target: { value: "Hero" } });
    await waitFor(() => expect(editorApi.loadCharacterImage).toHaveBeenCalledWith(
      "/synthetic-project",
      "Hero",
    ));
    putImageData.mockClear();
    fireEvent.pointerDown(canvas!, {
      pointerId: 1, pointerType: "mouse", button: 0, clientX: 100, clientY: 100,
    });
    fireEvent.pointerUp(canvas!, {
      pointerId: 1, pointerType: "mouse", button: 0, clientX: 100, clientY: 100,
    });

    expect(putImageData).not.toHaveBeenCalled();
    expect(screen.queryByText("Unsaved pixel edits")).toBeNull();
    await act(async () => { finishHero({ width: 4, height: 4 }); });
    await waitFor(() => expect(context.drawImage).toHaveBeenCalled());
    expect((picker as HTMLSelectElement).value).toBe("Hero");
    expect(screen.queryByText("Unsaved pixel edits")).toBeNull();
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
    fireEvent.pointerUp(editorCanvas!, {
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

  it("ignores right mouse clicks without painting sprite pixels", async () => {
    const view = renderEditor();
    await screen.findByDisplayValue("Guide");
    await waitFor(() => expect(context.drawImage).toHaveBeenCalled());
    const canvas = view.container.querySelector(".sprite-editor-canvas");
    expect(canvas).toBeTruthy();
    fillRect.mockClear();
    putImageData.mockClear();

    fireEvent.pointerDown(canvas!, {
      pointerId: 1, pointerType: "mouse", button: 2, clientX: 100, clientY: 100,
    });
    fireEvent.pointerUp(canvas!, {
      pointerId: 1, pointerType: "mouse", button: 2, clientX: 100, clientY: 100,
    });

    expect(fillRect).not.toHaveBeenCalled();
    expect(putImageData).not.toHaveBeenCalled();
    expect(screen.queryByText("Unsaved pixel edits")).toBeNull();
    expect(editorApi.savePrivateProjectSprite).not.toHaveBeenCalled();
  });

  it("keeps middle-button dragging available for sprite panning", async () => {
    const view = renderEditor();
    await screen.findByDisplayValue("Guide");
    await waitFor(() => {
      expect(context.drawImage.mock.calls.some((call) =>
        call.slice(1).join(",") === "68,68,64,64"
      )).toBe(true);
    });
    const canvas = view.container.querySelector(".sprite-editor-canvas");
    expect(canvas).toBeTruthy();

    fireEvent.pointerDown(canvas!, {
      pointerId: 1, pointerType: "mouse", button: 1, clientX: 100, clientY: 100,
    });
    fireEvent.pointerMove(canvas!, {
      pointerId: 1, pointerType: "mouse", button: 1, clientX: 110, clientY: 120,
    });
    fireEvent.pointerUp(canvas!, {
      pointerId: 1, pointerType: "mouse", button: 1, clientX: 110, clientY: 120,
    });

    await waitFor(() => {
      expect(context.drawImage.mock.calls.at(-1)?.slice(1)).toEqual([78, 88, 64, 64]);
    });
    expect(screen.queryByText("Unsaved pixel edits")).toBeNull();
    expect(putImageData).not.toHaveBeenCalled();
  });

  it("keeps newer edits dirty when a sprite copy save is still in flight", async () => {
    let finishSave!: (name: string) => void;
    editorApi.savePrivateProjectSprite.mockReturnValueOnce(
      new Promise<string>((resolve) => { finishSave = resolve; }),
    );
    const view = renderEditor();
    await screen.findByDisplayValue("Guide");
    await waitFor(() => expect(context.drawImage).toHaveBeenCalled());
    const canvas = view.container.querySelector(".sprite-editor-canvas");
    expect(canvas).toBeTruthy();

    fireEvent.pointerDown(canvas!, {
      pointerId: 1, pointerType: "mouse", button: 0, clientX: 100, clientY: 100,
    });
    fireEvent.pointerUp(canvas!, {
      pointerId: 1, pointerType: "mouse", button: 0, clientX: 100, clientY: 100,
    });
    fireEvent.click(screen.getByRole("button", { name: "Save All" }));
    await waitFor(() => expect(editorApi.savePrivateProjectSprite).toHaveBeenCalledTimes(1));

    fireEvent.pointerDown(canvas!, {
      pointerId: 2, pointerType: "mouse", button: 0, clientX: 120, clientY: 100,
    });
    fireEvent.pointerUp(canvas!, {
      pointerId: 2, pointerType: "mouse", button: 0, clientX: 120, clientY: 100,
    });
    expect(screen.getByText("Unsaved pixel edits")).toBeTruthy();
    await act(async () => { finishSave("Guide_copy"); });

    expect(screen.getByRole("combobox", { name: "Select project character sprite" }).value).toBe("Guide");
    expect(screen.queryByText("Unsaved pixel edits")).toBeTruthy();
    expect(editorApi.loadCharacterImage).not.toHaveBeenCalledWith(
      "/synthetic-project",
      "Guide_copy",
    );

    fireEvent.click(screen.getByRole("button", { name: "Save All" }));
    await waitFor(() => expect(editorApi.savePrivateProjectSprite).toHaveBeenCalledTimes(2));
    expect(editorApi.savePrivateProjectSprite.mock.calls[1][2]).toBe("Guide_copy_copy");
    await waitFor(() => expect(screen.queryByText("Unsaved pixel edits")).toBeNull());
  });

  it("keeps a selection cut dirty when it happens during a sprite save", async () => {
    let finishSave!: (name: string) => void;
    editorApi.savePrivateProjectSprite.mockReturnValueOnce(
      new Promise<string>((resolve) => { finishSave = resolve; }),
    );
    const view = renderEditor();
    await screen.findByDisplayValue("Guide");
    await waitFor(() => expect(context.drawImage).toHaveBeenCalled());
    const canvas = view.container.querySelector(".sprite-editor-canvas")!;
    fireEvent.pointerDown(canvas, {
      pointerId: 1, pointerType: "mouse", button: 0, clientX: 100, clientY: 100,
    });
    fireEvent.pointerUp(canvas, {
      pointerId: 1, pointerType: "mouse", button: 0, clientX: 100, clientY: 100,
    });

    fireEvent.click(screen.getByRole("button", { name: "Save All" }));
    await waitFor(() => expect(editorApi.savePrivateProjectSprite).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Select (S)" }));
    fireEvent.pointerDown(canvas, {
      pointerId: 2, pointerType: "mouse", button: 0, clientX: 100, clientY: 100,
    });
    fireEvent.pointerUp(canvas, {
      pointerId: 2, pointerType: "mouse", button: 0, clientX: 100, clientY: 100,
    });
    fireEvent.keyDown(window, { key: "x", ctrlKey: true });

    await act(async () => { finishSave("Guide_copy"); });

    expect(screen.getByRole("combobox", { name: "Select project character sprite" }).value).toBe("Guide");
    expect(screen.getByText("Unsaved pixel edits")).toBeTruthy();
    expect(editorApi.loadCharacterImage).not.toHaveBeenCalledWith(
      "/synthetic-project",
      "Guide_copy",
    );
  });

  it("keeps a selection paste dirty when it happens during a sprite save", async () => {
    let finishSave!: (name: string) => void;
    editorApi.savePrivateProjectSprite.mockReturnValueOnce(
      new Promise<string>((resolve) => { finishSave = resolve; }),
    );
    const view = renderEditor();
    await screen.findByDisplayValue("Guide");
    await waitFor(() => expect(context.drawImage).toHaveBeenCalled());
    const canvas = view.container.querySelector(".sprite-editor-canvas")!;
    fireEvent.pointerDown(canvas, {
      pointerId: 1, pointerType: "mouse", button: 0, clientX: 100, clientY: 100,
    });
    fireEvent.pointerUp(canvas, {
      pointerId: 1, pointerType: "mouse", button: 0, clientX: 100, clientY: 100,
    });
    fireEvent.click(screen.getByRole("button", { name: "Select (S)" }));
    fireEvent.pointerDown(canvas, {
      pointerId: 2, pointerType: "mouse", button: 0, clientX: 100, clientY: 100,
    });
    fireEvent.pointerUp(canvas, {
      pointerId: 2, pointerType: "mouse", button: 0, clientX: 100, clientY: 100,
    });
    fireEvent.keyDown(window, { key: "c", ctrlKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Brush (B)" }));
    fireEvent.change(screen.getByLabelText("Selected color"), {
      target: { value: "#e64553" },
    });
    fireEvent.pointerDown(canvas, {
      pointerId: 3, pointerType: "mouse", button: 0, clientX: 116, clientY: 100,
    });
    fireEvent.pointerUp(canvas, {
      pointerId: 3, pointerType: "mouse", button: 0, clientX: 116, clientY: 100,
    });

    fireEvent.click(screen.getByRole("button", { name: "Save All" }));
    await waitFor(() => expect(editorApi.savePrivateProjectSprite).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Select (S)" }));
    fireEvent.pointerDown(canvas, {
      pointerId: 4, pointerType: "mouse", button: 0, clientX: 116, clientY: 100,
    });
    fireEvent.pointerUp(canvas, {
      pointerId: 4, pointerType: "mouse", button: 0, clientX: 116, clientY: 100,
    });
    fireEvent.keyDown(window, { key: "v", ctrlKey: true });

    await act(async () => { finishSave("Guide_copy"); });

    expect(screen.getByRole("combobox", { name: "Select project character sprite" }).value).toBe("Guide");
    expect(screen.getByText("Unsaved pixel edits")).toBeTruthy();
    expect(editorApi.loadCharacterImage).not.toHaveBeenCalledWith(
      "/synthetic-project",
      "Guide_copy",
    );
  });

  it("keeps a pending touch tap on the original sprite when a copy save completes", async () => {
    let finishSave!: (name: string) => void;
    editorApi.savePrivateProjectSprite.mockReturnValueOnce(
      new Promise<string>((resolve) => { finishSave = resolve; }),
    );
    const view = renderEditor();
    await screen.findByDisplayValue("Guide");
    await waitFor(() => expect(context.drawImage).toHaveBeenCalled());
    const canvas = view.container.querySelector(".sprite-editor-canvas");
    expect(canvas).toBeTruthy();

    fireEvent.pointerDown(canvas!, {
      pointerId: 1, pointerType: "mouse", button: 0, clientX: 100, clientY: 100,
    });
    fireEvent.pointerUp(canvas!, {
      pointerId: 1, pointerType: "mouse", button: 0, clientX: 100, clientY: 100,
    });
    fireEvent.click(screen.getByRole("button", { name: "Save All" }));
    await waitFor(() => expect(editorApi.savePrivateProjectSprite).toHaveBeenCalledTimes(1));

    fireEvent.pointerDown(canvas!, {
      pointerId: 2, pointerType: "touch", clientX: 120, clientY: 100,
    });
    await act(async () => { finishSave("Guide_copy"); });

    const picker = screen.getByRole("combobox", { name: "Select project character sprite" });
    expect((picker as HTMLSelectElement).value).toBe("Guide");
    expect(editorApi.loadCharacterImage).not.toHaveBeenCalledWith(
      "/synthetic-project",
      "Guide_copy",
    );
    expect(screen.queryByText("Unsaved pixel edits")).toBeNull();

    fireEvent.pointerUp(canvas!, {
      pointerId: 2, pointerType: "touch", clientX: 120, clientY: 100,
    });
    expect(screen.getByText("Unsaved pixel edits")).toBeTruthy();
  });

  it("keeps newer edits dirty when an original sprite replacement is still in flight", async () => {
    let finishSave!: (name: string) => void;
    editorApi.savePrivateProjectSprite.mockReturnValueOnce(
      new Promise<string>((resolve) => { finishSave = resolve; }),
    );
    const view = renderEditor();
    await screen.findByDisplayValue("Guide");
    await waitFor(() => expect(context.drawImage).toHaveBeenCalled());
    const canvas = view.container.querySelector(".sprite-editor-canvas");
    expect(canvas).toBeTruthy();

    fireEvent.pointerDown(canvas!, {
      pointerId: 1, pointerType: "mouse", button: 0, clientX: 100, clientY: 100,
    });
    fireEvent.pointerUp(canvas!, {
      pointerId: 1, pointerType: "mouse", button: 0, clientX: 100, clientY: 100,
    });
    fireEvent.click(screen.getByRole("button", { name: "Replace original PNG" }));
    fireEvent.click(screen.getByRole("button", { name: "Save All" }));
    await waitFor(() => expect(editorApi.savePrivateProjectSprite).toHaveBeenCalledTimes(1));

    fireEvent.pointerDown(canvas!, {
      pointerId: 2, pointerType: "mouse", button: 0, clientX: 120, clientY: 100,
    });
    fireEvent.pointerUp(canvas!, {
      pointerId: 2, pointerType: "mouse", button: 0, clientX: 120, clientY: 100,
    });
    await act(async () => { finishSave("Guide"); });

    expect(screen.getByRole("combobox", { name: "Select project character sprite" }).value).toBe("Guide");
    expect(screen.queryByText("Unsaved pixel edits")).toBeTruthy();
    expect(editorApi.savePrivateProjectSprite).toHaveBeenCalledWith(
      "/synthetic-project", "Guide", "Guide", "original", "data:image/png;base64,cGl4ZWxz",
    );
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

  it("does not apply fill or color-pick on touch down if the gesture becomes a pinch", async () => {
    for (const [toolLabel, expectedFillCalls] of [["Fill (G)", 0], ["Pick (I)", 0]] as const) {
      const view = renderEditor();
      await screen.findByDisplayValue("Guide");
      await waitFor(() => expect(context.drawImage).toHaveBeenCalled());
      const canvas = view.container.querySelector(".sprite-editor-canvas");
      expect(canvas).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: toolLabel }));
      putImageData.mockClear();
      fillRect.mockClear();

      fireEvent.pointerDown(canvas!, {
        pointerId: 1, pointerType: "touch", clientX: 76, clientY: 76,
      });
      fireEvent.pointerDown(canvas!, {
        pointerId: 2, pointerType: "touch", clientX: 92, clientY: 76,
      });

      expect(putImageData).not.toHaveBeenCalled();
      expect(fillRect).toHaveBeenCalledTimes(expectedFillCalls);
      expect(screen.queryByText("Unsaved pixel edits")).toBeNull();
      view.unmount();
    }
  });

  it("applies fill and samples a color only when a single-finger tap completes", async () => {
    const fillView = renderEditor();
    await screen.findByDisplayValue("Guide");
    await waitFor(() => expect(context.drawImage).toHaveBeenCalled());
    const fillCanvas = fillView.container.querySelector(".sprite-editor-canvas");
    expect(fillCanvas).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Fill (G)" }));
    putImageData.mockClear();
    fireEvent.pointerDown(fillCanvas!, {
      pointerId: 1, pointerType: "touch", clientX: 76, clientY: 76,
    });
    expect(putImageData).not.toHaveBeenCalled();
    fireEvent.pointerUp(fillCanvas!, {
      pointerId: 1, pointerType: "touch", clientX: 76, clientY: 76,
    });
    expect(putImageData).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Unsaved pixel edits")).toBeTruthy();
    fillView.unmount();

    const pickerView = renderEditor();
    await screen.findByDisplayValue("Guide");
    await waitFor(() => expect(context.drawImage).toHaveBeenCalled());
    const pickerCanvas = pickerView.container.querySelector(".sprite-editor-canvas");
    expect(pickerCanvas).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pick (I)" }));
    fireEvent.pointerDown(pickerCanvas!, {
      pointerId: 2, pointerType: "touch", clientX: 76, clientY: 76,
    });
    expect((screen.getByLabelText("Selected color") as HTMLInputElement).value).toBe("#ffffff");
    fireEvent.pointerUp(pickerCanvas!, {
      pointerId: 2, pointerType: "touch", clientX: 76, clientY: 76,
    });
    expect((screen.getByLabelText("Selected color") as HTMLInputElement).value).toBe("#000000");
    expect(screen.queryByText("Unsaved pixel edits")).toBeNull();
    expect(editorApi.savePrivateProjectSprite).not.toHaveBeenCalled();
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

  it("marquees, copies, cuts, pastes and undoes selected sprite pixels", async () => {
    spritePixelFixture = new Uint8ClampedArray(4 * 4 * 4);
    spritePixelFixture.set([255, 0, 0, 255], 0);
    spritePixelFixture.set([0, 255, 0, 255], 4);
    spritePixelFixture.set([0, 0, 255, 255], 8);
    const view = renderEditor();
    await screen.findByDisplayValue("Guide");
    const canvas = view.container.querySelector(".sprite-editor-canvas");
    expect(canvas).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Select (S)" }));

    fireEvent.pointerDown(canvas!, {
      pointerId: 1, pointerType: "mouse", button: 0, clientX: 76, clientY: 76,
    });
    fireEvent.pointerMove(canvas!, {
      pointerId: 1, pointerType: "mouse", clientX: 108, clientY: 76,
    });
    fireEvent.pointerUp(canvas!, {
      pointerId: 1, pointerType: "mouse", clientX: 108, clientY: 76,
    });
    expect(screen.getByRole("status", { name: "Selected sprite pixels" }).textContent)
      .toBe("Selected 3 × 1 pixels");

    fireEvent.click(screen.getByRole("button", { name: "Copy selection" }));
    fireEvent.click(screen.getByRole("button", { name: "Cut selection" }));
    expect(screen.getByText("Unsaved pixel edits")).toBeTruthy();
    let pixels = putImageData.mock.calls.at(-1)?.[0].data as Uint8ClampedArray;
    expect([...pixels.slice(0, 12)]).toEqual(new Array(12).fill(0));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    pixels = putImageData.mock.calls.at(-1)?.[0].data as Uint8ClampedArray;
    expect([...pixels.slice(0, 12)]).toEqual([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]);

    fireEvent.pointerDown(canvas!, {
      pointerId: 2, pointerType: "mouse", button: 0, clientX: 76, clientY: 76,
    });
    fireEvent.pointerUp(canvas!, {
      pointerId: 2, pointerType: "mouse", clientX: 76, clientY: 76,
    });
    fireEvent.click(screen.getByRole("button", { name: "Copy selection" }));
    fireEvent.pointerDown(canvas!, {
      pointerId: 3, pointerType: "mouse", button: 0, clientX: 92, clientY: 76,
    });
    fireEvent.pointerUp(canvas!, {
      pointerId: 3, pointerType: "mouse", clientX: 92, clientY: 76,
    });
    fireEvent.click(screen.getByRole("button", { name: "Paste selection" }));
    pixels = putImageData.mock.calls.at(-1)?.[0].data as Uint8ClampedArray;
    expect([...pixels.slice(4, 8)]).toEqual([255, 0, 0, 255]);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    pixels = putImageData.mock.calls.at(-1)?.[0].data as Uint8ClampedArray;
    expect([...pixels.slice(4, 8)]).toEqual([0, 255, 0, 255]);
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    fireEvent.click(screen.getByRole("button", { name: "Save sprite" }));
    await waitFor(() => expect(editorApi.savePrivateProjectSprite).toHaveBeenCalledWith(
      "/synthetic-project",
      "Guide",
      "Guide_copy",
      "copy",
      "data:image/png;base64,cGl4ZWxz",
    ));
  });

  it("uses a touch drag to select pixels without dirtying the sprite", async () => {
    const view = renderEditor();
    await screen.findByDisplayValue("Guide");
    await waitFor(() => expect(context.drawImage).toHaveBeenCalled());
    const canvas = view.container.querySelector(".sprite-editor-canvas");
    expect(canvas).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Select (S)" }));

    fireEvent.pointerDown(canvas!, {
      pointerId: 1, pointerType: "touch", clientX: 76, clientY: 76,
    });
    fireEvent.pointerMove(canvas!, {
      pointerId: 1, pointerType: "touch", clientX: 92, clientY: 92,
    });
    fireEvent.pointerUp(canvas!, {
      pointerId: 1, pointerType: "touch", clientX: 92, clientY: 92,
    });

    expect(screen.getByRole("status", { name: "Selected sprite pixels" }).textContent)
      .toBe("Selected 2 × 2 pixels");
    expect(screen.queryByText("Unsaved pixel edits")).toBeNull();
    expect(editorApi.savePrivateProjectSprite).not.toHaveBeenCalled();
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

  it("keeps edits dirty and reports a copy collision until a safe retry succeeds", async () => {
    const onSaved = vi.fn();
    editorApi.savePrivateProjectSprite.mockRejectedValueOnce(new Error("destination already exists"));
    const view = renderEditor(onSaved);
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
    fireEvent.pointerUp(editorCanvas!, {
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.click(screen.getByRole("button", { name: "Save sprite" }));

    expect((await screen.findByRole("alert")).textContent).toContain("destination already exists");
    expect(screen.getByText("Unsaved pixel edits")).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
    expect(editorApi.savePrivateProjectSprite).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText("Copy name"), { target: { value: "Guide_safe_copy" } });
    fireEvent.click(screen.getByRole("button", { name: "Save sprite" }));
    await waitFor(() => expect(editorApi.savePrivateProjectSprite).toHaveBeenCalledTimes(2));
    expect(editorApi.savePrivateProjectSprite.mock.calls[0][3]).toBe("copy");
    expect(editorApi.savePrivateProjectSprite.mock.calls[1][2]).toBe("Guide_safe_copy");
    await screen.findByDisplayValue("Guide_safe_copy");
    expect(screen.queryByText("Unsaved pixel edits")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(onSaved).toHaveBeenCalledTimes(1);
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

  it("imports a local image into the canvas and saves it only as a project copy", async () => {
    const onSaved = vi.fn();
    const importUrl = {
      createObjectURL: vi.fn(() => "blob:sprite-import"),
      revokeObjectURL: vi.fn(),
    };
    class TestImage {
      width = 8;
      height = 6;
      onload: (() => void) | null = null;
      set src(_value: string) { this.onload?.(); }
    }
    vi.stubGlobal("URL", importUrl);
    vi.stubGlobal("Image", TestImage as unknown as typeof Image);

    renderEditor(onSaved);
    await screen.findByDisplayValue("Guide");
    const input = screen.getByLabelText("Import image as copy") as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(["sprite"], "Field Hero.png")] },
    });

    expect(await screen.findByText("Imported image: Field Hero.png — save as a new copy.")).toBeTruthy();
    expect(screen.getByDisplayValue("Field Hero")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Replace original PNG" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("combobox", { name: "Select project character sprite" }).hasAttribute("disabled")).toBe(true);
    expect(input.value).toBe("");
    expect(importUrl.revokeObjectURL).toHaveBeenCalledWith("blob:sprite-import");

    fireEvent.click(screen.getByRole("button", { name: "Save All" }));
    await waitFor(() => expect(editorApi.importPrivateProjectSprite).toHaveBeenCalledTimes(1));
    expect(editorApi.importPrivateProjectSprite).toHaveBeenCalledWith(
      "/synthetic-project",
      "Field Hero",
      "data:image/png;base64,cGl4ZWxz",
    );
    expect(onSaved).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect((screen.getByRole("combobox", {
        name: "Select project character sprite",
      }) as HTMLSelectElement).value).toBe("Field Hero");
    });
    expect(screen.queryByText("Imported image: Field Hero.png — save as a new copy.")).toBeNull();
  });

  it("imports and saves a sprite when the project has no existing character graphics", async () => {
    editorApi.listAssetFiles.mockResolvedValue([]);
    const importUrl = {
      createObjectURL: vi.fn(() => "blob:new-sprite"),
      revokeObjectURL: vi.fn(),
    };
    class TestImage {
      width = 4;
      height = 4;
      onload: (() => void) | null = null;
      set src(_value: string) { this.onload?.(); }
    }
    vi.stubGlobal("URL", importUrl);
    vi.stubGlobal("Image", TestImage as unknown as typeof Image);

    renderEditor();
    expect((await screen.findByRole("status")).textContent).toBe(
      "No character sprites were found in this project.",
    );
    fireEvent.change(screen.getByLabelText("Import image as copy"), {
      target: { files: [new File(["sprite"], "New.png", { type: "image/png" })] },
    });

    expect(await screen.findByText("Imported image: New.png — save as a new copy.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save All" }));
    await waitFor(() => expect(editorApi.importPrivateProjectSprite).toHaveBeenCalledTimes(1));
    expect(editorApi.importPrivateProjectSprite.mock.calls[0].slice(0, 2)).toEqual([
      "/synthetic-project",
      "New",
    ]);
  });

  it("keeps an imported sprite dirty after a copy collision until a safe name is saved", async () => {
    editorApi.importPrivateProjectSprite.mockRejectedValueOnce(
      new Error("Character graphic already exists: Existing"),
    );
    const importUrl = {
      createObjectURL: vi.fn(() => "blob:collision-sprite"),
      revokeObjectURL: vi.fn(),
    };
    class TestImage {
      width = 8;
      height = 6;
      onload: (() => void) | null = null;
      set src(_value: string) { this.onload?.(); }
    }
    vi.stubGlobal("URL", importUrl);
    vi.stubGlobal("Image", TestImage as unknown as typeof Image);

    renderEditor();
    await screen.findByDisplayValue("Guide");
    fireEvent.change(screen.getByLabelText("Import image as copy"), {
      target: { files: [new File(["sprite"], "Existing.png", { type: "image/png" })] },
    });
    await screen.findByText("Unsaved imported sprite");
    fireEvent.click(screen.getByRole("button", { name: "Save sprite" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Character graphic already exists: Existing",
    );
    expect(screen.getByText("Unsaved imported sprite")).toBeTruthy();
    expect(screen.getByText("Imported image: Existing.png — save as a new copy.")).toBeTruthy();
    expect(editorApi.importPrivateProjectSprite).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText("Copy name"), {
      target: { value: "Existing_safe_copy" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save sprite" }));
    await waitFor(() => expect(editorApi.importPrivateProjectSprite).toHaveBeenCalledTimes(2));
    expect(editorApi.importPrivateProjectSprite.mock.calls.map((call) => call[1])).toEqual([
      "Existing",
      "Existing_safe_copy",
    ]);
    await waitFor(() => {
      expect((screen.getByRole("combobox", {
        name: "Select project character sprite",
      }) as HTMLSelectElement).value).toBe("Existing_safe_copy");
    });
    expect(screen.queryByText("Unsaved imported sprite")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("discards an imported candidate by reopening the selected project sprite", async () => {
    const importUrl = {
      createObjectURL: vi.fn(() => "blob:discarded-sprite"),
      revokeObjectURL: vi.fn(),
    };
    class TestImage {
      width = 8;
      height = 6;
      onload: (() => void) | null = null;
      set src(_value: string) { this.onload?.(); }
    }
    vi.stubGlobal("URL", importUrl);
    vi.stubGlobal("Image", TestImage as unknown as typeof Image);

    renderEditor();
    await screen.findByDisplayValue("Guide");
    fireEvent.change(screen.getByLabelText("Import image as copy"), {
      target: { files: [new File(["sprite"], "Temporary.png", { type: "image/png" })] },
    });
    await screen.findByText("Imported image: Temporary.png — save as a new copy.");
    editorApi.loadCharacterImage.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Discard imported image" }));
    await waitFor(() => expect(editorApi.loadCharacterImage).toHaveBeenCalledWith(
      "/synthetic-project",
      "Guide",
    ));
    expect(screen.queryByText("Imported image: Temporary.png — save as a new copy.")).toBeNull();
    expect(screen.queryByText("Unsaved pixel edits")).toBeNull();
    expect(importUrl.revokeObjectURL).toHaveBeenCalledWith("blob:discarded-sprite");
  });

  it("clears a discarded imported candidate when the project has no character sprites", async () => {
    editorApi.listAssetFiles.mockResolvedValue([]);
    const importUrl = {
      createObjectURL: vi.fn(() => "blob:discarded-only-sprite"),
      revokeObjectURL: vi.fn(),
    };
    class TestImage {
      width = 8;
      height = 6;
      onload: (() => void) | null = null;
      set src(_value: string) { this.onload?.(); }
    }
    vi.stubGlobal("URL", importUrl);
    vi.stubGlobal("Image", TestImage as unknown as typeof Image);

    const view = renderEditor();
    await screen.findByText("No character sprites were found in this project.");
    fireEvent.change(screen.getByLabelText("Import image as copy"), {
      target: { files: [new File(["sprite"], "Temporary.png", { type: "image/png" })] },
    });
    await screen.findByText("Imported image: Temporary.png — save as a new copy.");

    fireEvent.click(screen.getByRole("button", { name: "Discard imported image" }));
    expect(screen.queryByText("Imported image: Temporary.png — save as a new copy.")).toBeNull();
    expect(screen.queryByText("Unsaved pixel edits")).toBeNull();
    expect(screen.getByRole("button", { name: "Save sprite" }).hasAttribute("disabled")).toBe(true);
    expect(view.container.querySelector('[aria-busy="false"]')).toBeTruthy();
    expect(importUrl.revokeObjectURL).toHaveBeenCalledWith("blob:discarded-only-sprite");
  });

  it("rejects non-image sprite imports and images above the pixel limit", async () => {
    const importUrl = {
      createObjectURL: vi.fn(() => "blob:sprite-import"),
      revokeObjectURL: vi.fn(),
    };
    class TestImage {
      width = 4097;
      height = 4096;
      onload: (() => void) | null = null;
      set src(_value: string) { this.onload?.(); }
    }
    vi.stubGlobal("URL", importUrl);
    vi.stubGlobal("Image", TestImage as unknown as typeof Image);

    renderEditor();
    await screen.findByDisplayValue("Guide");
    const input = screen.getByLabelText("Import image as copy");
    fireEvent.change(input, {
      target: { files: [new File(["not-image"], "sprite.txt", { type: "text/plain" })] },
    });
    expect((await screen.findByRole("alert")).textContent).toBe("Imported sprite must be an image");
    expect(importUrl.createObjectURL).not.toHaveBeenCalled();

    fireEvent.change(input, {
      target: { files: [new File(["sprite"], "large.png", { type: "image/png" })] },
    });
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Imported sprite exceeds the 16-megapixel edit limit",
    );
    expect(importUrl.revokeObjectURL).toHaveBeenCalledWith("blob:sprite-import");
    expect(editorApi.savePrivateProjectSprite).not.toHaveBeenCalled();
  });

  it("reports undecodable sprite files and releases their temporary URL", async () => {
    const importUrl = {
      createObjectURL: vi.fn(() => "blob:broken-sprite"),
      revokeObjectURL: vi.fn(),
    };
    class TestImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) { this.onerror?.(); }
    }
    vi.stubGlobal("URL", importUrl);
    vi.stubGlobal("Image", TestImage as unknown as typeof Image);

    renderEditor();
    await screen.findByDisplayValue("Guide");
    fireEvent.change(screen.getByLabelText("Import image as copy"), {
      target: { files: [new File(["broken"], "broken.png")] },
    });

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Could not decode imported sprite image",
    );
    expect(screen.queryByText("Imported image: broken.png — save as a new copy.")).toBeNull();
    expect(screen.queryByText("Unsaved pixel edits")).toBeNull();
    expect(importUrl.revokeObjectURL).toHaveBeenCalledWith("blob:broken-sprite");
  });

  it("restores trace alignment per sprite after switching sprites and reopening the editor", async () => {
    editorApi.listAssetFiles.mockResolvedValue(["Guide", "Hero"]);
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
    const traceInput = screen.getByLabelText("Trace overlay");
    fireEvent.change(traceInput, {
      target: { files: [new File(["trace"], "trace.png", { type: "image/png" })] },
    });
    await screen.findByText("Trace opacity: 35%");
    fireEvent.change(screen.getByLabelText("Trace opacity: 35%"), { target: { value: "60" } });
    fireEvent.change(screen.getByLabelText("Trace scale: 100%"), { target: { value: "125" } });
    fireEvent.change(screen.getByLabelText("Trace horizontal alignment: 0"), { target: { value: "-20" } });
    fireEvent.change(screen.getByLabelText("Trace vertical alignment: 0"), { target: { value: "35" } });
    await waitFor(() => {
      expect(window.localStorage.getItem(
        "essentials-studio:sprite-trace:%2Fsynthetic-project:Guide",
      )).toBe('{"opacity":60,"scale":125,"offsetX":-20,"offsetY":35}');
    });

    const spritePicker = screen.getByRole("combobox", { name: "Select project character sprite" });
    fireEvent.change(spritePicker, { target: { value: "Hero" } });
    await waitFor(() => expect(editorApi.loadCharacterImage).toHaveBeenLastCalledWith(
      "/synthetic-project",
      "Hero",
    ));
    await waitFor(() => expect(screen.getByLabelText("Trace opacity: 35%")).toBeTruthy());

    fireEvent.change(spritePicker, { target: { value: "Guide" } });
    await waitFor(() => expect(editorApi.loadCharacterImage).toHaveBeenLastCalledWith(
      "/synthetic-project",
      "Guide",
    ));
    await waitFor(() => {
      expect(screen.getByLabelText("Trace opacity: 60%")).toBeTruthy();
      expect(screen.getByLabelText("Trace scale: 125%")).toBeTruthy();
      expect(screen.getByLabelText("Trace horizontal alignment: -20")).toBeTruthy();
      expect(screen.getByLabelText("Trace vertical alignment: 35")).toBeTruthy();
    });

    view.unmount();
    renderEditor();
    await screen.findByDisplayValue("Guide");
    expect(screen.queryByLabelText(/^Trace opacity:/)).toBeNull();
    fireEvent.change(screen.getByLabelText("Trace overlay"), {
      target: { files: [new File(["trace"], "trace.png", { type: "image/png" })] },
    });
    await waitFor(() => {
      expect(screen.getByLabelText("Trace opacity: 60%")).toBeTruthy();
      expect(screen.getByLabelText("Trace scale: 125%")).toBeTruthy();
      expect(screen.getByLabelText("Trace horizontal alignment: -20")).toBeTruthy();
      expect(screen.getByLabelText("Trace vertical alignment: 35")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Reset trace alignment" }));
    await waitFor(() => {
      expect(screen.getByLabelText("Trace opacity: 35%")).toBeTruthy();
      expect(screen.getByLabelText("Trace scale: 100%")).toBeTruthy();
      expect(screen.getByLabelText("Trace horizontal alignment: 0")).toBeTruthy();
      expect(screen.getByLabelText("Trace vertical alignment: 0")).toBeTruthy();
    });
  });

  it("accepts a decoded trace image with no MIME type and allows selecting it again", async () => {
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
    const input = screen.getByLabelText("Trace overlay") as HTMLInputElement;
    const file = new File(["trace"], "trace.png");
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText("Trace opacity: 35%")).toBeTruthy();
    expect(input.value).toBe("");

    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(traceUrl.createObjectURL).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Trace opacity: 35%")).toBeTruthy();
  });

  it("rejects an explicit non-image MIME type for a trace overlay", async () => {
    const traceUrl = {
      createObjectURL: vi.fn(() => "blob:trace"),
      revokeObjectURL: vi.fn(),
    };
    vi.stubGlobal("URL", traceUrl);

    renderEditor();
    await screen.findByDisplayValue("Guide");
    fireEvent.change(screen.getByLabelText("Trace overlay"), {
      target: { files: [new File(["not an image"], "trace.txt", { type: "text/plain" })] },
    });

    expect((await screen.findByRole("alert")).textContent).toBe("Trace overlay must be an image");
    expect(traceUrl.createObjectURL).not.toHaveBeenCalled();
  });

  it("saves sprite pixels without serializing the trace-composited display canvas", async () => {
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
    expect(context.drawImage.mock.calls.some((call) => call[0] instanceof TestImage)).toBe(true);

    fireEvent.pointerDown(editorCanvas!, {
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerUp(editorCanvas!, {
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.click(screen.getByRole("button", { name: "Save sprite" }));
    await waitFor(() => expect(editorApi.savePrivateProjectSprite).toHaveBeenCalledTimes(1));

    expect(serializedCanvases).toHaveLength(1);
    expect(serializedCanvases[0]).not.toBe(editorCanvas);
    expect(editorApi.savePrivateProjectSprite).toHaveBeenCalledWith(
      "/synthetic-project",
      "Guide",
      "Guide_copy",
      "copy",
      "data:image/png;base64,cGl4ZWxz",
    );
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

  it("pinches and pans the trace independently while trace positioning is enabled", async () => {
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
    fireEvent.pointerMove(editorCanvas!, { pointerId: 1, pointerType: "touch", clientX: 84, clientY: 104 });
    fireEvent.pointerUp(editorCanvas!, { pointerId: 1, pointerType: "touch", clientX: 84, clientY: 104 });

    await waitFor(() => expect(screen.getByText("Trace scale: 150%")).toBeTruthy());
    expect(context.drawImage.mock.calls.some((call) => call[3] === 64 && call[1] === 68)).toBe(true);
    expect(context.drawImage.mock.calls.some((call) => call[3] === 96)).toBe(true);
    expect(Number(screen.getByRole("slider", { name: /Trace horizontal alignment/ }).getAttribute("value"))).toBeCloseTo(21.875);
    expect(Number(screen.getByRole("slider", { name: /Trace vertical alignment/ }).getAttribute("value"))).toBeCloseTo(6.25);
    expect(putImageData).not.toHaveBeenCalled();
    expect(screen.queryByText("Unsaved pixel edits")).toBeNull();
  });

  it("saves sprite pixels without including the non-destructive trace overlay", async () => {
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
    fireEvent.pointerDown(editorCanvas!, {
      pointerId: 1, pointerType: "touch", button: 0, clientX: 100, clientY: 100,
    });
    fireEvent.pointerUp(editorCanvas!, {
      pointerId: 1, pointerType: "touch", button: 0, clientX: 100, clientY: 100,
    });
    fireEvent.click(screen.getByRole("button", { name: "Save sprite" }));
    await waitFor(() => expect(editorApi.savePrivateProjectSprite).toHaveBeenCalledOnce());

    expect(serializedCanvases).toHaveLength(1);
    expect(serializedCanvases[0]).not.toBe(editorCanvas);
    expect(serializedCanvases[0].width).toBe(4);
    expect(serializedCanvases[0].height).toBe(4);
  });

  it("hands a completed pinch to one-finger panning without painting", async () => {
    const view = renderEditor();
    await screen.findByDisplayValue("Guide");
    await waitFor(() => expect(context.drawImage).toHaveBeenCalled());
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
    await waitFor(() => expect(context.drawImage.mock.calls.some((call) => call.length === 5)).toBe(true));
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

describe("portrait symmetry tools and view-only pixel grid", () => {
  it("mirrors brush pixels into four corners as one undoable sprite edit", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })));
    const view = renderEditor();
    await screen.findByDisplayValue("Guide");
    await waitFor(() => expect(context.drawImage).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("checkbox", { name: "Mirror sprite brush horizontally" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Mirror sprite brush vertically" }));
    const canvas = view.container.querySelector(".sprite-editor-canvas")!;
    fireEvent.pointerDown(canvas, {
      pointerId: 1, pointerType: "mouse", button: 0, clientX: 76, clientY: 76,
    });
    fireEvent.pointerUp(canvas, {
      pointerId: 1, pointerType: "mouse", button: 0, clientX: 76, clientY: 76,
    });
    expect(screen.getByText("Unsaved pixel edits")).toBeTruthy();
    const first = putImageData.mock.calls.at(-1)?.[0] as ImageData;
    expect(first).toBeTruthy();
    expect([0, 3, 12, 15].map(pixel => first.data[pixel * 4 + 3])).toEqual([255, 255, 255, 255]);
    fireEvent.click(screen.getByRole("button", { name: "Undo sprite edit" }));
    const afterUndo = putImageData.mock.calls.at(-1)?.[0] as ImageData;
    expect([0, 3, 12, 15].map(pixel => afterUndo.data[pixel * 4 + 3])).toEqual([0, 0, 0, 0]);
    fireEvent.click(screen.getByRole("button", { name: "Redo sprite edit" }));
    const afterRedo = putImageData.mock.calls.at(-1)?.[0] as ImageData;
    expect([0, 3, 12, 15].map(pixel => afterRedo.data[pixel * 4 + 3])).toEqual([255, 255, 255, 255]);
  });

  it("remembers grid and symmetry preferences without marking sprite pixels dirty", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })));
    const view = renderEditor();
    await screen.findByDisplayValue("Guide");
    fireEvent.click(screen.getByRole("checkbox", { name: "Show sprite pixel grid" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Mirror sprite brush horizontally" }));
    expect(window.localStorage.getItem("essentials-studio:sprite-editor:pixel-grid-visible")).toBe("false");
    expect(window.localStorage.getItem("essentials-studio:sprite-editor:mirror-horizontal")).toBe("true");
    expect(screen.queryByText("Unsaved pixel edits")).toBeNull();
    view.unmount();
    renderEditor();
    await screen.findByDisplayValue("Guide");
    expect((screen.getByRole("checkbox", { name: "Show sprite pixel grid" }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("checkbox", { name: "Mirror sprite brush horizontally" }) as HTMLInputElement).checked).toBe(true);
  });
});

describe("exact sprite zoom controls", () => {
  it("provides precise zoom in portrait mode without changing the sprite or save state", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })));
    const view = renderEditor();
    await screen.findByDisplayValue("Guide");
    await waitFor(() => expect(context.drawImage).toHaveBeenCalled());
    const zoomControl = screen.getByRole("slider", { name: "Exact sprite zoom" }) as HTMLInputElement;
    fireEvent.change(zoomControl, { target: { value: "7" } });
    expect(zoomControl.value).toBe("7");
    await waitFor(() => expect(context.drawImage.mock.calls.at(-1)?.[3]).toBe(28));
    expect(screen.queryByText("Unsaved pixel edits")).toBeNull();
    expect(editorApi.savePrivateProjectSprite).not.toHaveBeenCalled();
    expect(view.container.querySelector('[aria-label="Sprite canvas"]')).toBeTruthy();
  });
});
