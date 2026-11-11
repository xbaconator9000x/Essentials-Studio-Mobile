// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MapEditor } from "../src/components/MapEditor/MapEditor";

const rendererApi = vi.hoisted(() => ({
  screenToTile: vi.fn(() => ({ x: 1, y: 1 })),
}));

vi.mock("../src/services/mapRenderer", () => ({
  MapRenderer: class {
    setMapData() {}
    setTilesetImage() {}
    setAutotileImage() {}
    setPriorities() {}
    setPassages() {}
    render() {}
    screenToTile = rendererApi.screenToTile;
  },
}));

function renderMap({
  events = [{ id: 4, name: "Guide", x: 1, y: 1, page_count: 2, graphic_name: "", graphic_direction: 2, graphic_pattern: 0 }],
  hasClipboardEvent = false,
  readOnly = false,
  onCopyEvent = vi.fn(async () => {}),
  onDeleteEvent = vi.fn(),
  onOpenEvent = vi.fn(),
  onPasteEvent = vi.fn(async () => {}),
  onSetStartPosition = vi.fn(async () => {}),
}: {
  events?: { id: number; name: string; x: number; y: number; page_count: number; graphic_name: string; graphic_direction: number; graphic_pattern: number }[];
  hasClipboardEvent?: boolean;
  readOnly?: boolean;
  onCopyEvent?: (id: number) => Promise<void>;
  onDeleteEvent?: (id: number, name: string) => void;
  onOpenEvent?: (id: number, name: string) => void;
  onPasteEvent?: (x: number, y: number) => Promise<void>;
  onSetStartPosition?: (x: number, y: number) => Promise<void>;
} = {}) {
  return render(
    <MapEditor
      mapData={{ id: 1, width: 3, height: 3, tileset_id: 1, tiles: Array(27).fill(0), events }}
      tilesetInfo={{ id: 1, name: "Test", tileset_name: "Test", autotile_names: [], passages: [], priorities: [], terrain_tags: [] }}
      tilesetImage={null}
      autotileImages={[]}
      selectedTileId={1}
      currentMapId={1}
      hasClipboardEvent={hasClipboardEvent}
      readOnly={readOnly}
      onMapDirty={vi.fn()}
      onOpenEvent={onOpenEvent}
      onDeleteEvent={onDeleteEvent}
      onCopyEvent={onCopyEvent}
      onPasteEvent={onPasteEvent}
      onSetStartPosition={onSetStartPosition}
      paletteVisible
      onTogglePalette={vi.fn()}
      graphicsRevision={0}
    />,
  );
}

function dispatchTouch(canvas: Element, type: "pointerdown" | "pointerup", timeStamp: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: 1 },
    pointerType: { value: "touch" },
    clientX: { value: 48 },
    clientY: { value: 48 },
    timeStamp: { value: timeStamp },
  });
  fireEvent(canvas, event);
}

beforeEach(() => {
  rendererApi.screenToTile.mockReturnValue({ x: 1, y: 1 });
  globalThis.ResizeObserver = class {
    constructor(callback: ResizeObserverCallback) { void callback; }
    observe() {}
    disconnect() {}
    unobserve() {}
  };
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  HTMLElement.prototype.getBoundingClientRect = vi.fn(() => ({
    x: 0, y: 0, left: 0, top: 0, right: 320, bottom: 240,
    width: 320, height: 240, toJSON: () => ({}),
  }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("touch map context actions", () => {
  it("opens existing event actions on long press and routes copy without changing tap behavior", async () => {
    const onCopyEvent = vi.fn(async () => {});
    const onOpenEvent = vi.fn();
    const view = renderMap({ onCopyEvent, onOpenEvent });
    const canvas = view.container.querySelector("canvas");
    expect(canvas).toBeTruthy();

    dispatchTouch(canvas!, "pointerdown", 100);
    dispatchTouch(canvas!, "pointerup", 600);

    expect(await screen.findByRole("menu", { name: "Event actions" })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy Event" }));
    await waitFor(() => expect(onCopyEvent).toHaveBeenCalledWith(4));
    expect(onOpenEvent).not.toHaveBeenCalled();
  });

  it("offers clipboard paste and starting-point actions on a long-pressed empty tile", async () => {
    rendererApi.screenToTile.mockReturnValue({ x: 2, y: 0 });
    const onPasteEvent = vi.fn(async () => {});
    const onSetStartPosition = vi.fn(async () => {});
    renderMap({
      events: [],
      hasClipboardEvent: true,
      onPasteEvent,
      onSetStartPosition,
    });
    const canvas = document.querySelector(".map-editor-canvas");
    expect(canvas).toBeTruthy();

    dispatchTouch(canvas!, "pointerdown", 100);
    dispatchTouch(canvas!, "pointerup", 600);

    expect(await screen.findByRole("menu", { name: "Map tile actions" })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: "Paste Event" }));
    await waitFor(() => expect(onPasteEvent).toHaveBeenCalledWith(2, 0));
    expect(onSetStartPosition).not.toHaveBeenCalled();
  });

  it("keeps a short touch tap on the Events layer opening the event directly", async () => {
    const onOpenEvent = vi.fn();
    const view = renderMap({ onOpenEvent });
    fireEvent.click(screen.getByRole("button", { name: "Events layer" }));
    const canvas = view.container.querySelector("canvas");
    expect(canvas).toBeTruthy();

    dispatchTouch(canvas!, "pointerdown", 100);
    dispatchTouch(canvas!, "pointerup", 200);

    expect(onOpenEvent).toHaveBeenCalledWith(4, "Guide");
    expect(screen.queryByRole("menu", { name: "Event actions" })).toBeNull();
  });

  it("does not expose mutation context actions in read-only preview", async () => {
    const view = renderMap({ readOnly: true });
    const canvas = view.container.querySelector("canvas");
    expect(canvas).toBeTruthy();

    dispatchTouch(canvas!, "pointerdown", 100);
    dispatchTouch(canvas!, "pointerup", 600);

    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("makes event copying directly available from the map's event browser", async () => {
    const onCopyEvent = vi.fn(async () => {});
    renderMap({ onCopyEvent });
    fireEvent.click(screen.getByRole("button", { name: "Events (1)" }));

    fireEvent.click(await screen.findByRole("button", { name: "Copy event 004 Guide" }));

    await waitFor(() => expect(onCopyEvent).toHaveBeenCalledWith(4));
  });
});
