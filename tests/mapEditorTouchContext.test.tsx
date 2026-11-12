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
  onCreateEvent = vi.fn(),
  onPasteEvent = vi.fn(async () => {}),
  onSetStartPosition = vi.fn(async () => {}),
  tiles = Array(27).fill(0) as number[],
  onMapDirty = vi.fn(),
  onSelectTile = vi.fn(),
}: {
  events?: { id: number; name: string; x: number; y: number; page_count: number; graphic_name: string; graphic_direction: number; graphic_pattern: number }[];
  hasClipboardEvent?: boolean;
  readOnly?: boolean;
  onCopyEvent?: (id: number) => Promise<void>;
  onDeleteEvent?: (id: number, name: string) => void;
  onOpenEvent?: (id: number, name: string) => void;
  onCreateEvent?: (x: number, y: number) => void;
  onPasteEvent?: (x: number, y: number) => Promise<void>;
  onSetStartPosition?: (x: number, y: number) => Promise<void>;
  tiles?: number[];
  onMapDirty?: () => void;
  onSelectTile?: (tileId: number) => void;
} = {}) {
  return render(
    <MapEditor
      mapData={{ id: 1, width: 3, height: 3, tileset_id: 1, tiles, events }}
      tilesetInfo={{ id: 1, name: "Test", tileset_name: "Test", autotile_names: [], passages: [], priorities: [], terrain_tags: [] }}
      tilesetImage={null}
      autotileImages={[]}
      selectedTileId={1}
      onSelectTile={onSelectTile}
      currentMapId={1}
      hasClipboardEvent={hasClipboardEvent}
      readOnly={readOnly}
      onMapDirty={onMapDirty}
      onOpenEvent={onOpenEvent}
      onCreateEvent={onCreateEvent}
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

function dispatchTouch(
  canvas: Element,
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  timeStamp: number,
  point = { x: 48, y: 48 },
  pointerId = 1,
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    pointerType: { value: "touch" },
    clientX: { value: point.x },
    clientY: { value: point.y },
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
  it("picks the exact topmost tile from All Layers and returns to pencil without dirtying the map", () => {
    const tiles = Array(27).fill(0);
    tiles[4] = 384;
    tiles[13] = 385;
    tiles[22] = 386;
    const onSelectTile = vi.fn();
    const onMapDirty = vi.fn();
    const view = renderMap({ events: [], tiles, onSelectTile, onMapDirty });
    fireEvent.click(screen.getByRole("button", { name: "All layers" }));
    fireEvent.click(screen.getByTitle("pick"));
    const canvas = view.container.querySelector("canvas")!;
    dispatchTouch(canvas, "pointerdown", 100);
    dispatchTouch(canvas, "pointerup", 120);
    expect(onSelectTile).toHaveBeenCalledWith(386);
    expect(screen.getByRole("button", { name: "Layer 3" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTitle("pencil").getAttribute("aria-pressed")).toBe("true");
    expect(onMapDirty).not.toHaveBeenCalled();
  });

  it.each([
    [{ x: 1, y: 1 }, { x: 95, y: 95 }],
    [{ x: 95, y: 95 }, { x: 1, y: 1 }],
  ])("previews a touch rectangle and paints every edge cell once on release", (start, end) => {
    rendererApi.screenToTile.mockImplementation((x: number, y: number) => ({ x: Math.floor(x / 32), y: Math.floor(y / 32) }));
    const tiles = Array(27).fill(0);
    const onMapDirty = vi.fn();
    const view = renderMap({ events: [], tiles, onMapDirty });
    fireEvent.click(screen.getByTitle("rectangle"));
    const canvas = view.container.querySelector("canvas")!;
    dispatchTouch(canvas, "pointerdown", 100, start);
    dispatchTouch(canvas, "pointermove", 120, end);
    expect(tiles).toEqual(Array(27).fill(0));
    expect(onMapDirty).not.toHaveBeenCalled();
    dispatchTouch(canvas, "pointerup", 140, end);
    expect(tiles.slice(0, 9)).toEqual(Array(9).fill(1));
    expect(tiles.slice(9)).toEqual(Array(18).fill(0));
    expect(onMapDirty).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Undo tile edit" }));
    expect(tiles).toEqual(Array(27).fill(0));
    fireEvent.click(screen.getByRole("button", { name: "Redo tile edit" }));
    expect(tiles.slice(0, 9)).toEqual(Array(9).fill(1));
  });

  it("cancels a pending rectangle on pinch and pointer cancellation", () => {
    rendererApi.screenToTile.mockImplementation((x: number, y: number) => ({ x: Math.floor(x / 32), y: Math.floor(y / 32) }));
    const tiles = Array(27).fill(0);
    const onMapDirty = vi.fn();
    const view = renderMap({ events: [], tiles, onMapDirty });
    fireEvent.click(screen.getByTitle("rectangle"));
    const canvas = view.container.querySelector("canvas")!;
    dispatchTouch(canvas, "pointerdown", 100, { x: 1, y: 1 });
    dispatchTouch(canvas, "pointermove", 120, { x: 65, y: 65 });
    dispatchTouch(canvas, "pointerdown", 130, { x: 40, y: 40 }, 2);
    dispatchTouch(canvas, "pointerup", 150, { x: 65, y: 65 });
    dispatchTouch(canvas, "pointerup", 160, { x: 40, y: 40 }, 2);
    dispatchTouch(canvas, "pointerdown", 200, { x: 1, y: 1 });
    dispatchTouch(canvas, "pointermove", 220, { x: 65, y: 65 });
    dispatchTouch(canvas, "pointercancel", 240, { x: 65, y: 65 });
    expect(tiles).toEqual(Array(27).fill(0));
    expect(onMapDirty).not.toHaveBeenCalled();
  });

  it("keeps a hidden tile layer visible when it becomes the active editing layer", () => {
    renderMap({ events: [] });
    const layer2 = screen.getByRole("checkbox", { name: "Show tile layer 2" }) as HTMLInputElement;
    fireEvent.click(layer2);
    expect(layer2.checked).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Layer 2" }));
    expect(layer2.checked).toBe(true);
    expect(layer2.disabled).toBe(true);
  });

  it.each([
    ["forward", { x: 32, y: 32 }, { x: 64, y: 64 }],
    ["reverse", { x: 64, y: 64 }, { x: 32, y: 32 }],
  ])("selects and copies a multi-tile region on a %s touch drag", async (_direction, start, end) => {
    rendererApi.screenToTile.mockImplementation((x: number, y: number) => ({
      x: Math.floor(x / 32),
      y: Math.floor(y / 32),
    }));
    const view = renderMap({ events: [] });
    fireEvent.click(screen.getByTitle("select"));
    const canvas = view.container.querySelector("canvas");
    expect(canvas).toBeTruthy();

    dispatchTouch(canvas!, "pointerdown", 100, start);
    dispatchTouch(canvas!, "pointermove", 120, end);
    dispatchTouch(canvas!, "pointerup", 140, end);

    const copyButton = screen.getByRole("button", { name: "Copy selected tiles" });
    expect((copyButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(copyButton);
    expect(await screen.findByText(/Copied \(2×2\)/)).toBeTruthy();
  });

  it("does not turn event-layer drags into tile selections", () => {
    const view = renderMap({ events: [] });
    fireEvent.click(screen.getByTitle("select"));
    fireEvent.click(screen.getByRole("button", { name: "Events layer" }));
    const canvas = view.container.querySelector("canvas");
    expect(canvas).toBeTruthy();

    dispatchTouch(canvas!, "pointerdown", 100);
    dispatchTouch(canvas!, "pointermove", 120, { x: 80, y: 80 });
    dispatchTouch(canvas!, "pointerup", 140, { x: 80, y: 80 });

    expect((screen.getByRole("button", { name: "Copy selected tiles" }) as HTMLButtonElement).disabled).toBe(true);
  });

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

  it("keeps a long-press event menu inside the phone viewport", async () => {
    const view = renderMap();
    HTMLElement.prototype.getBoundingClientRect = vi.fn(() => ({
      x: 0, y: 0, left: 0, top: 0, right: 400, bottom: 800,
      width: 400, height: 800, toJSON: () => ({}),
    }));
    vi.stubGlobal("innerWidth", 400);
    vi.stubGlobal("innerHeight", 800);
    const canvas = view.container.querySelector("canvas");
    expect(canvas).toBeTruthy();

    dispatchTouch(canvas!, "pointerdown", 100, { x: 380, y: 780 });
    dispatchTouch(canvas!, "pointerup", 600, { x: 380, y: 780 });

    const menu = await screen.findByRole("menu", { name: "Event actions" });
    expect(Number.parseFloat((menu as HTMLElement).style.left)).toBeLessThanOrEqual(192);
    expect(Number.parseFloat((menu as HTMLElement).style.top)).toBeLessThanOrEqual(592);
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

describe("explicit mobile event placement", () => {
  it("creates a real map event at an empty tapped tile and exits placement mode", () => {
    const onCreateEvent = vi.fn();
    const onMapDirty = vi.fn();
    const view = renderMap({ events: [], onCreateEvent, onMapDirty });
    fireEvent.click(screen.getByRole("button", { name: "Place new map event" }));
    expect(screen.getByRole("button", { name: "Events layer" }).getAttribute("aria-pressed")).toBe("true");
    const canvas = view.container.querySelector("canvas")!;
    dispatchTouch(canvas, "pointerdown", 100);
    dispatchTouch(canvas, "pointerup", 150);
    expect(onCreateEvent).toHaveBeenCalledTimes(1);
    expect(onCreateEvent).toHaveBeenCalledWith(1, 1);
    expect(screen.getByRole("button", { name: "Place new map event" })).toBeTruthy();
    // Event creation is owned by the project bridge; do not mark tile painting dirty.
    expect(onMapDirty).not.toHaveBeenCalled();
  });

  it("prevents placing events on occupied tiles until the user selects an empty tile", () => {
    const onCreateEvent = vi.fn();
    const view = renderMap({ onCreateEvent });
    fireEvent.click(screen.getByRole("button", { name: "Place new map event" }));
    fireEvent.click(view.container.querySelector("canvas")!, { clientX: 48, clientY: 48 });
    expect(onCreateEvent).not.toHaveBeenCalled();
    expect(screen.getByText(/This tile already contains an event/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel new event placement" })).toBeTruthy();
    rendererApi.screenToTile.mockReturnValue({ x: 2, y: 0 });
    fireEvent.click(view.container.querySelector("canvas")!, { clientX: 48, clientY: 48 });
    expect(onCreateEvent).toHaveBeenCalledTimes(1);
    expect(onCreateEvent).toHaveBeenCalledWith(2, 0);
  });

  it("routes copied-event placement through project paste and prevents accidental duplicate taps", async () => {
    const pending: { resolve?: () => void } = {};
    const onPasteEvent = vi.fn(() => new Promise<void>(resolve => { pending.resolve = resolve; }));
    const view = renderMap({ events: [], hasClipboardEvent: true, onPasteEvent });
    fireEvent.click(screen.getByRole("button", { name: "Place copied map event" }));
    const canvas = view.container.querySelector("canvas")!;
    fireEvent.click(canvas, { clientX: 48, clientY: 48 });
    await waitFor(() => expect(onPasteEvent).toHaveBeenCalledWith(1, 1));
    fireEvent.click(canvas, { clientX: 48, clientY: 48 });
    expect(onPasteEvent).toHaveBeenCalledTimes(1);
    pending.resolve?.();
    await waitFor(() => expect(screen.getByRole("button", { name: "Place copied map event" })).toBeTruthy());
  });

  it("offers new event on empty-tile long press and makes empty event maps browsable", () => {
    const onCreateEvent = vi.fn();
    const view = renderMap({ events: [], onCreateEvent });
    fireEvent.contextMenu(view.container.querySelector("canvas")!, { clientX: 48, clientY: 48 });
    fireEvent.click(screen.getByRole("menuitem", { name: "New Event" }));
    expect(onCreateEvent).toHaveBeenCalledWith(1, 1);
    fireEvent.click(screen.getByRole("button", { name: "Events (0)" }));
    expect(screen.getByText("No events on this map.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create a new map event" }));
    expect(screen.getByRole("button", { name: "Cancel new event placement" })).toBeTruthy();
    expect(screen.queryByText("No events on this map.")).toBeNull();
  });

  it("cancels the placement flow when switching to a tile layer or toggling it off", () => {
    renderMap({ events: [] });
    fireEvent.click(screen.getByRole("button", { name: "Place new map event" }));
    fireEvent.click(screen.getByRole("button", { name: "Layer 1" }));
    expect(screen.getByRole("button", { name: "Place new map event" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Place new map event" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel new event placement" }));
    expect(screen.getByRole("button", { name: "Place new map event" })).toBeTruthy();
  });

  it("does not allow event placement in read-only map previews", () => {
    renderMap({ readOnly: true });
    expect(screen.queryByRole("button", { name: "Place new map event" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Place copied map event" })).toBeNull();
  });
});

describe("project-scoped event placement", () => {
  it("drops a previous project's in-flight paste UI state after switching projects", async () => {
    const pending: { resolve?: () => void } = {};
    const onPasteEvent = vi.fn(() => new Promise<void>(resolve => { pending.resolve = resolve; }));
    const onMapDirty = vi.fn();
    const onCreateEvent = vi.fn();
    const tilesetInfo = { id: 1, name: "Test", tileset_name: "Test", autotile_names: [], passages: [], priorities: [], terrain_tags: [] };
    const props = {
      tilesetInfo, tilesetImage: null, autotileImages: [], selectedTileId: 1,
      onMapDirty, onCreateEvent, onPasteEvent, hasClipboardEvent: true,
      paletteVisible: true, onTogglePalette: vi.fn(), graphicsRevision: 0,
    };
    const view = render(<MapEditor {...props}
      projectPath="/project-one" currentMapId={1}
      mapData={{ id: 1, width: 3, height: 3, tileset_id: 1, tiles: Array(27).fill(0), events: [] }}
    />);
    fireEvent.click(screen.getByRole("button", { name: "Place copied map event" }));
    fireEvent.click(view.container.querySelector("canvas")!, { clientX: 48, clientY: 48 });
    await waitFor(() => expect(onPasteEvent).toHaveBeenCalledTimes(1));
    expect((screen.getByRole("button", { name: "Cancel copied event placement" }) as HTMLButtonElement).disabled).toBe(true);
    view.rerender(<MapEditor {...props}
      projectPath="/project-two" currentMapId={2}
      mapData={{ id: 2, width: 3, height: 3, tileset_id: 1, tiles: Array(27).fill(0), events: [] }}
    />);
    expect(screen.getByRole("button", { name: "Place copied map event" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Place copied map event" }) as HTMLButtonElement).disabled).toBe(false);
    pending.resolve?.();
    await waitFor(() => expect(screen.getByRole("button", { name: "Place copied map event" })).toBeTruthy());
    expect(onMapDirty).not.toHaveBeenCalled();
  });
});
