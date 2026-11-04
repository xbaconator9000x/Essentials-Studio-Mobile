// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MapToolbar } from "../src/components/MapEditor/MapToolbar";

describe("map toolbar responsive controls", () => {
  let matches = true;
  let listeners: Set<(event: MediaQueryListEvent) => void>;

  beforeEach(() => {
    matches = true;
    listeners = new Set();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
      matches,
      media: "(max-width: 640px)",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: (_type, listener) => {
        listeners.add(listener as (event: MediaQueryListEvent) => void);
      },
      removeEventListener: (_type, listener) => {
        listeners.delete(listener as (event: MediaQueryListEvent) => void);
      },
      dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, "matchMedia");
  });

  it("reveals layer controls when a narrow viewport rotates to landscape", () => {
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
        showEventPins
        setShowEventPins={vi.fn()}
        paletteVisible
        onTogglePalette={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "L2" })).toBeNull();
    expect(screen.getByRole("button", { name: "Tools ▸" })).toBeTruthy();

    act(() => {
      matches = false;
      listeners.forEach((listener) => listener({ matches } as MediaQueryListEvent));
    });

    expect(screen.getByRole("button", { name: "L2" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tools ▾" })).toBeTruthy();
  });
});
