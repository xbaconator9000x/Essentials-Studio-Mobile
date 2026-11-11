// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TilesetPalette } from "../src/components/TilesetPalette/TilesetPalette";

describe("mobile tileset palette", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("rejects padded or outside edge tiles and accepts the last full tile", () => {
    const image = new Image();
    image.width = 256;
    image.height = 65;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
      strokeRect: vi.fn(), fillRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    const onSelectTile = vi.fn();
    const view = render(<TilesetPalette
      tilesetInfo={{ id: 1, name: "Test", tileset_name: "Test", autotile_names: [], passages: [], priorities: [], terrain_tags: [] }}
      tilesetImage={image} autotileImages={[]} selectedTileId={384} onSelectTile={onSelectTile} onClose={vi.fn()}
    />);
    const canvas = view.container.querySelector("canvas")!;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 256, bottom: 96, width: 256, height: 96, toJSON: () => ({}),
    });
    fireEvent.click(canvas, { clientX: 255, clientY: 63 });
    expect(onSelectTile).toHaveBeenCalledWith(399);
    fireEvent.click(canvas, { clientX: 255, clientY: 64 });
    fireEvent.click(canvas, { clientX: 256, clientY: 63 });
    fireEvent.click(canvas, { clientX: 1, clientY: -1 });
    expect(onSelectTile).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(canvas, { key: "End" });
    expect(onSelectTile).toHaveBeenLastCalledWith(399);
  });

  it("makes named autotiles accessible buttons and prevents empty slots being selected", () => {
    const onSelectTile = vi.fn();
    render(<TilesetPalette
      tilesetInfo={{ id: 1, name: "Test", tileset_name: "Test", autotile_names: ["Water", ""], passages: [], priorities: [], terrain_tags: [] }}
      tilesetImage={null} autotileImages={[]} selectedTileId={384} onSelectTile={onSelectTile} onClose={vi.fn()}
    />);
    fireEvent.click(screen.getByRole("button", { name: "Auto" }));
    fireEvent.click(screen.getByRole("button", { name: "Autotile 1: Water" }));
    expect(onSelectTile).toHaveBeenCalledWith(48);
    expect((screen.getByRole("button", { name: "Autotile 2: empty" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("provides an accessible close control inside the palette", () => {
    const onClose = vi.fn();
    render(
      <TilesetPalette
        tilesetInfo={null}
        tilesetImage={null}
        autotileImages={[]}
        selectedTileId={384}
        onSelectTile={vi.fn()}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Close tileset palette" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
