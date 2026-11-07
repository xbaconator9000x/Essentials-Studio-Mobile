// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MapToolbar } from "../src/components/MapEditor/MapToolbar";

describe("mobile map toolbar", () => {
  afterEach(() => {
    cleanup();
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
      />,
    );

    expect(screen.queryByRole("button", { name: "L2" })).toBeNull();
    act(() => onMediaChange?.({ matches: false } as MediaQueryListEvent));
    fireEvent.click(screen.getByRole("button", { name: "L2" }));

    expect(setSelectedLayer).toHaveBeenCalledWith(1);
  });
});
