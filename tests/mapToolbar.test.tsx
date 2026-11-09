// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MapToolbar } from "../src/components/MapEditor/MapToolbar";

describe("mobile map toolbar", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("reveals layer controls when the viewport changes from portrait to landscape", () => {
    let onMediaChange: ((event: MediaQueryListEvent) => void) | undefined;
    const mediaQuery = {
      matches: true,
      addEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => {
        onMediaChange = listener;
      }),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal("matchMedia", vi.fn(() => mediaQuery));
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
        showEventPins
        setShowEventPins={vi.fn()}
        paletteVisible
        onTogglePalette={vi.fn()}
        eventCount={2}
        eventListVisible={false}
        onToggleEventList={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "L2" })).toBeNull();
    act(() => onMediaChange?.({ matches: false } as MediaQueryListEvent));
    fireEvent.click(screen.getByRole("button", { name: "L2" }));

    expect(setSelectedLayer).toHaveBeenCalledWith(1);
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

    expect(screen.getByRole("button", { name: "L2" })).toBeTruthy();
    expect(window.localStorage.getItem("essentials-studio:map-editor:tools-collapsed")).toBe("false");
    view.unmount();

    const reopened = render(toolbar());
    expect(screen.getByRole("button", { name: "L2" })).toBeTruthy();
    act(() => onMediaChange?.({ matches: true } as MediaQueryListEvent));
    expect(screen.getByRole("button", { name: "L2" })).toBeTruthy();
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

    expect(screen.queryByRole("button", { name: "Pen" })).toBeNull();
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
