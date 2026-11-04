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

vi.mock("../src/services/tauriApi", () => editorApi);
vi.mock("../src/services/imageLoader", () => editorApi);

const context = {
  imageSmoothingEnabled: false,
  fillStyle: "",
  setTransform: vi.fn(),
  fillRect: vi.fn(),
  clearRect: vi.fn(),
  drawImage: vi.fn(),
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
});
