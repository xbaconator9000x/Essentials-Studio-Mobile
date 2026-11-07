// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
});

describe("sprite editor integration", () => {
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
});
