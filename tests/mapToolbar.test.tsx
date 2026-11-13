// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MapToolbar } from "../src/components/MapEditor/MapToolbar";

const noTileClipboardActions = {
  canCopyTiles: false,
  canPasteTiles: false,
  onCopyTiles: vi.fn(),
  onPasteTiles: vi.fn(),
  showCollisionOverlay: false,
  setShowCollisionOverlay: vi.fn(),
  showLayers: [true, true, true] as [boolean, boolean, boolean],
  onToggleLayerVisibility: vi.fn(),
};

describe("collapsed XP layer visibility", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("allows hiding other layers while keeping the active layer visible", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })));
    const onToggleLayerVisibility = vi.fn();
    const props = {
      paintTool: "pencil" as const, setPaintTool: vi.fn(),
      tileClipboard: null, selectedLayer: 1, setSelectedLayer: vi.fn(),
      showGrid: true, setShowGrid: vi.fn(), zoom: 1, setZoom: vi.fn(),
      onUndo: vi.fn(), onRedo: vi.fn(),
      ...noTileClipboardActions,
      showLayers: [true, true, false] as [boolean, boolean, boolean],
      onToggleLayerVisibility,
      showEventPins: true, setShowEventPins: vi.fn(),
      paletteVisible: true, onTogglePalette: vi.fn(),
      eventCount: 0, eventListVisible: false, onToggleEventList: vi.fn(),
    };
    const view = render(<MapToolbar {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "View" }));
    const active = screen.getByRole("checkbox", { name: "Show tile layer 2" }) as HTMLInputElement;
    expect(active.disabled).toBe(true);
    expect(active.checked).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "Show tile layer 1" }));
    expect(onToggleLayerVisibility).toHaveBeenCalledWith(0, false);
    fireEvent.click(screen.getByRole("checkbox", { name: "Show tile layer 3" }));
    expect(onToggleLayerVisibility).toHaveBeenCalledWith(2, true);
    view.rerender(<MapToolbar {...props} selectedLayer={2} />);
    expect((screen.getByRole("checkbox", { name: "Show tile layer 3" }) as HTMLInputElement).disabled).toBe(true);
  });
});

describe("mobile map toolbar", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("switches paint tools with the compact native portrait selector", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })));
    const setPaintTool = vi.fn();
    render(
      <MapToolbar
        paintTool="pencil" setPaintTool={setPaintTool}
        tileClipboard={null} selectedLayer={0} setSelectedLayer={vi.fn()}
        showGrid setShowGrid={vi.fn()} zoom={1} setZoom={vi.fn()}
        onUndo={vi.fn()} onRedo={vi.fn()}
        {...noTileClipboardActions}
        showEventPins setShowEventPins={vi.fn()}
        paletteVisible onTogglePalette={vi.fn()}
        eventCount={0} eventListVisible={false} onToggleEventList={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Tools ▸" })).toBeTruthy();
    const selector = screen.getByRole("combobox", { name: "Select active map tool" }) as HTMLSelectElement;
    expect(selector.value).toBe("pencil");
    fireEvent.change(selector, { target: { value: "bucket" } });
    expect(setPaintTool).toHaveBeenCalledWith("bucket");
    fireEvent.change(selector, { target: { value: "pan" } });
    expect(setPaintTool).toHaveBeenCalledWith("pan");
  });

  it("keeps the collision overlay toggle reachable in collapsed tools", () => {
    let onMediaChange: ((event: MediaQueryListEvent) => void) | undefined;
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => {
        onMediaChange = listener;
      }),
      removeEventListener: vi.fn(),
    })));
    const setShowCollisionOverlay = vi.fn();

    render(
      <MapToolbar
        paintTool="pencil"
        setPaintTool={vi.fn()}
        tileClipboard={null}
        selectedLayer={0}
        setSelectedLayer={vi.fn()}
        showGrid
        setShowGrid={vi.fn()}
        zoom={1}
        setZoom={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        {...noTileClipboardActions}
        showCollisionOverlay={false}
        setShowCollisionOverlay={setShowCollisionOverlay}
        showEventPins
        setShowEventPins={vi.fn()}
        paletteVisible
        onTogglePalette={vi.fn()}
        eventCount={0}
        eventListVisible={false}
        onToggleEventList={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Tools ▸" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "View" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Show collision overlay" }));
    expect(setShowCollisionOverlay).toHaveBeenCalledWith(true);
    expect(onMediaChange).toBeDefined();
  });

  it("explains how to paste a copied event using touch", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));

    render(
      <MapToolbar
        paintTool="pencil"
        setPaintTool={vi.fn()}
        tileClipboard={null}
        selectedLayer={0}
        setSelectedLayer={vi.fn()}
        showGrid
        setShowGrid={vi.fn()}
        zoom={1}
        setZoom={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        {...noTileClipboardActions}
        hasClipboardEvent
        showEventPins
        setShowEventPins={vi.fn()}
        paletteVisible
        onTogglePalette={vi.fn()}
        eventCount={1}
        eventListVisible={false}
        onToggleEventList={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Event tools" }));
    expect(screen.getByRole("status").textContent).toContain("long-press a map tile to paste");
  });

  it("keeps layers directly usable in portrait and respects orientation changes", () => {
    let onMediaChange: ((event: MediaQueryListEvent) => void) | undefined;
    const mediaQuery = {
      matches: true,
      addEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => {
        onMediaChange = listener;
      }),
      removeEventListener: vi.fn(),
    };
    const matchMedia = vi.fn(() => mediaQuery);
    vi.stubGlobal("matchMedia", matchMedia);
    const setSelectedLayer = vi.fn();

    render(
      <MapToolbar
        paintTool="pencil"
        setPaintTool={vi.fn()}
        tileClipboard={null}
        selectedLayer={0}
        setSelectedLayer={setSelectedLayer}
        showGrid
        setShowGrid={vi.fn()}
        zoom={1}
        setZoom={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        {...noTileClipboardActions}
        showEventPins
        setShowEventPins={vi.fn()}
        paletteVisible
        onTogglePalette={vi.fn()}
        eventCount={2}
        eventListVisible={false}
        onToggleEventList={vi.fn()}
      />,
    );

    expect(matchMedia).toHaveBeenCalledWith("(max-width: 700px)");
    fireEvent.click(screen.getByRole("button", { name: "Layers" }));
    expect(screen.getByRole("button", { name: "Layer 2" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Layer 2" }));
    expect(setSelectedLayer).toHaveBeenCalledWith(1);
    act(() => onMediaChange?.({ matches: false } as MediaQueryListEvent));
    fireEvent.click(screen.getByRole("button", { name: "Layer 3" }));

    expect(setSelectedLayer).toHaveBeenLastCalledWith(2);
  });

  it("persists an explicit tools choice across remounts and does not override it on rotation", () => {
    let onMediaChange: ((event: MediaQueryListEvent) => void) | undefined;
    const mediaQuery = {
      matches: true,
      addEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => {
        onMediaChange = listener;
      }),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal("matchMedia", vi.fn(() => mediaQuery));
    const toolbar = () => (
      <MapToolbar
        paintTool="pencil"
        setPaintTool={vi.fn()}
        tileClipboard={null}
        selectedLayer={0}
        setSelectedLayer={vi.fn()}
        showGrid
        setShowGrid={vi.fn()}
        zoom={1}
        setZoom={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        {...noTileClipboardActions}
        showEventPins
        setShowEventPins={vi.fn()}
        paletteVisible
        onTogglePalette={vi.fn()}
        eventCount={0}
        eventListVisible={false}
        onToggleEventList={vi.fn()}
      />
    );
    const view = render(toolbar());
    fireEvent.click(screen.getByRole("button", { name: "Tools ▸" }));

    expect(screen.getByRole("button", { name: "Layer 2" })).toBeTruthy();
    expect(window.localStorage.getItem("essentials-studio:map-editor:tools-collapsed")).toBe("false");
    view.unmount();

    const reopened = render(toolbar());
    expect(screen.getByRole("button", { name: "Layer 2" })).toBeTruthy();
    act(() => onMediaChange?.({ matches: true } as MediaQueryListEvent));
    expect(screen.getByRole("button", { name: "Layer 2" })).toBeTruthy();
    reopened.unmount();
  });

  it("exposes a Pan tool alongside paint tools on compact layouts", () => {
    let onMediaChange: ((event: MediaQueryListEvent) => void) | undefined;
    const mediaQuery = {
      matches: true,
      addEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => {
        onMediaChange = listener;
      }),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal("matchMedia", vi.fn(() => mediaQuery));
    const setPaintTool = vi.fn();

    render(
      <MapToolbar
        paintTool="pencil"
        setPaintTool={setPaintTool}
        tileClipboard={null}
        selectedLayer={0}
        setSelectedLayer={vi.fn()}
        showGrid
        setShowGrid={vi.fn()}
        zoom={1}
        setZoom={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        {...noTileClipboardActions}
        showEventPins
        setShowEventPins={vi.fn()}
        paletteVisible
        onTogglePalette={vi.fn()}
        eventCount={0}
        eventListVisible={false}
        onToggleEventList={vi.fn()}
      />,
    );

    act(() => onMediaChange?.({ matches: false } as MediaQueryListEvent));
    fireEvent.click(screen.getByRole("button", { name: "Pan" }));

    expect(setPaintTool).toHaveBeenCalledWith("pan");
  });

  it("keeps paint, layer, grid and selection actions usable while collapsed", () => {
    const setPaintTool = vi.fn();
    const setSelectedLayer = vi.fn();
    const setShowGrid = vi.fn();
    const onCopyTiles = vi.fn();
    const onPasteTiles = vi.fn();
    const mediaQuery = {
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal("matchMedia", vi.fn(() => mediaQuery));

    const toolbar = (selectedLayer: number, canPasteTiles: boolean, tileClipboard: {
      width: number; height: number; layers: number[][];
    } | null) => (
      <MapToolbar
        paintTool="pencil"
        setPaintTool={setPaintTool}
        tileClipboard={tileClipboard}
        selectedLayer={selectedLayer}
        setSelectedLayer={setSelectedLayer}
        showGrid
        setShowGrid={setShowGrid}
        zoom={1}
        setZoom={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        canCopyTiles={selectedLayer !== 3}
        canPasteTiles={canPasteTiles}
        onCopyTiles={onCopyTiles}
        onPasteTiles={onPasteTiles}
        showLayers={[true, true, true]}
        onToggleLayerVisibility={vi.fn()}
        showCollisionOverlay={false}
        setShowCollisionOverlay={vi.fn()}
        showEventPins
        setShowEventPins={vi.fn()}
        paletteVisible
        onTogglePalette={vi.fn()}
        eventCount={0}
        eventListVisible={false}
        onToggleEventList={vi.fn()}
      />
    );
    const view = render(toolbar(0, false, null));

    fireEvent.click(screen.getByRole("button", { name: "More tools" }));
    expect(screen.getByRole("button", { name: "Use pen map tool" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Use erase map tool" }));
    expect(setPaintTool).toHaveBeenCalledWith("eraser");
    fireEvent.click(screen.getByRole("button", { name: "View" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Show map grid" }));
    fireEvent.click(screen.getByRole("button", { name: "Draw" }));
    expect(setShowGrid).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByRole("button", { name: "Layers" }));
    fireEvent.click(screen.getByRole("button", { name: "Events layer" }));
    expect(setSelectedLayer).toHaveBeenCalledWith(3);

    view.rerender(toolbar(3, false, null));
    fireEvent.click(screen.getByRole("button", { name: "Tools ▸" }));
    expect((screen.getByRole("button", { name: "Copy selected tiles" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Paste tiles at cursor" }) as HTMLButtonElement).disabled).toBe(true);

    view.rerender(toolbar(0, false, null));
    fireEvent.click(screen.getByRole("button", { name: "Copy selected tiles" }));
    expect(onCopyTiles).toHaveBeenCalledOnce();
    expect((screen.getByRole("button", { name: "Paste tiles at cursor" }) as HTMLButtonElement).disabled).toBe(true);

    view.rerender(toolbar(0, true, { width: 2, height: 1, layers: [[1, 2], [], []] }));
    fireEvent.click(screen.getByRole("button", { name: "Paste tiles at cursor" }));
    expect(onPasteTiles).toHaveBeenCalledOnce();
    expect(screen.getByRole("status").textContent).toContain("Clipboard 2×1");

    view.unmount();
  });

  it("keeps the pin visibility toggle available and accessible when tools are collapsed", () => {
    const setShowEventPins = vi.fn();
    const mediaQuery = {
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal("matchMedia", vi.fn(() => mediaQuery));

    const toolbar = (showEventPins: boolean) => (
      <MapToolbar
        paintTool="pencil"
        setPaintTool={vi.fn()}
        tileClipboard={null}
        selectedLayer={0}
        setSelectedLayer={vi.fn()}
        showGrid
        setShowGrid={vi.fn()}
        zoom={1}
        setZoom={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        {...noTileClipboardActions}
        showEventPins={showEventPins}
        setShowEventPins={setShowEventPins}
        paletteVisible
        onTogglePalette={vi.fn()}
        eventCount={0}
        eventListVisible={false}
        onToggleEventList={vi.fn()}
      />
    );
    const view = render(toolbar(true));

    expect(screen.getByRole("button", { name: "Use pen map tool" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "View" }));
    const pins = screen.getByRole("checkbox", { name: "Show event pins" });
    expect((pins as HTMLInputElement).checked).toBe(true);
    fireEvent.click(pins);

    expect(setShowEventPins).toHaveBeenCalledWith(false);
    view.rerender(toolbar(false));
    expect((screen.getByRole("checkbox", { name: "Show event pins" }) as HTMLInputElement).checked).toBe(false);
  });

  it("offers a map event browser with its expanded state", () => {
    const onToggleEventList = vi.fn();

    render(
      <MapToolbar
        paintTool="pencil"
        setPaintTool={vi.fn()}
        tileClipboard={null}
        selectedLayer={3}
        setSelectedLayer={vi.fn()}
        showGrid
        setShowGrid={vi.fn()}
        zoom={1}
        setZoom={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        {...noTileClipboardActions}
        showEventPins
        setShowEventPins={vi.fn()}
        paletteVisible
        onTogglePalette={vi.fn()}
        eventCount={4}
        eventListVisible
        onToggleEventList={onToggleEventList}
      />,
    );

    const button = screen.getByRole("button", { name: "Events (4)" });
    expect(button.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(button);
    expect(onToggleEventList).toHaveBeenCalledOnce();
  });
});

describe("portrait map zoom and event actions", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("offers zoom increments, direct slider values, map fit and explicit event placement", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })));
    const setZoom = vi.fn();
    const onFitMap = vi.fn();
    const onToggleEventPlacement = vi.fn();
    render(<MapToolbar
      paintTool="pencil" setPaintTool={vi.fn()}
      tileClipboard={null} selectedLayer={0} setSelectedLayer={vi.fn()}
      showGrid setShowGrid={vi.fn()} zoom={1} setZoom={setZoom}
      onUndo={vi.fn()} onRedo={vi.fn()}
      {...noTileClipboardActions}
      showEventPins setShowEventPins={vi.fn()}
      paletteVisible onTogglePalette={vi.fn()}
      eventCount={0} eventListVisible={false} onToggleEventList={vi.fn()}
      canCreateEvent canPasteEvent hasClipboardEvent
      eventPlacementMode={null} onToggleEventPlacement={onToggleEventPlacement} onFitMap={onFitMap}
    />);
    fireEvent.click(screen.getByRole("button", { name: "View" }));
    fireEvent.click(screen.getByRole("button", { name: "Zoom in map" }));
    expect(setZoom).toHaveBeenCalledWith(1.25);
    fireEvent.click(screen.getByRole("button", { name: "Zoom out map" }));
    expect(setZoom).toHaveBeenCalledWith(0.75);
    fireEvent.change(screen.getByRole("slider", { name: "Map zoom" }), { target: { value: "2.5" } });
    expect(setZoom).toHaveBeenCalledWith(2.5);
    fireEvent.click(screen.getByRole("button", { name: "Fit entire map to viewport" }));
    expect(onFitMap).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Event tools" }));
    fireEvent.click(screen.getByRole("button", { name: "Place new map event" }));
    fireEvent.click(screen.getByRole("button", { name: "Place copied map event" }));
    expect(onToggleEventPlacement).toHaveBeenNthCalledWith(1, "create");
    expect(onToggleEventPlacement).toHaveBeenNthCalledWith(2, "paste");
    expect(screen.getByRole("button", { name: "Events (0)" })).toBeTruthy();
  });
});
