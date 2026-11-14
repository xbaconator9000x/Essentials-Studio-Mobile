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

describe("touch tile navigation", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("jumps directly to a valid native tile ID and rejects padded rows", () => {
    const image = new Image();
    image.width = 256;
    image.height = 65; // two complete rows; third row is partial image padding
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
      strokeRect: vi.fn(), fillRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    const onSelectTile = vi.fn();
    render(<TilesetPalette
      tilesetInfo={{ id: 1, name: "Test", tileset_name: "Test", autotile_names: [], passages: [], priorities: [], terrain_tags: [] }}
      tilesetImage={image} autotileImages={[]} selectedTileId={384} onSelectTile={onSelectTile} onClose={vi.fn()}
    />);
    const tileInput = screen.getByRole("spinbutton", { name: "Jump to tile ID" });
    fireEvent.change(tileInput, { target: { value: "399" } });
    fireEvent.click(screen.getByRole("button", { name: "Select tile ID" }));
    expect(onSelectTile).toHaveBeenCalledWith(399);

    fireEvent.change(tileInput, { target: { value: "400" } });
    expect((screen.getByRole("button", { name: "Select tile ID" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(tileInput, { target: { value: "0" } });
    expect((screen.getByRole("button", { name: "Select tile ID" }) as HTMLButtonElement).disabled).toBe(true);
    expect(onSelectTile).toHaveBeenCalledTimes(1);
  });

  it("navigates exactly 8 tile IDs per row and clamps at real tileset edges", () => {
    const image = new Image();
    image.width = 256;
    image.height = 64;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
      strokeRect: vi.fn(), fillRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    const onSelectTile = vi.fn();
    const props = {
      tilesetInfo: { id: 1, name: "Test", tileset_name: "Test", autotile_names: [], passages: [], priorities: [], terrain_tags: [] },
      tilesetImage: image, autotileImages: [], onSelectTile, onClose: vi.fn(),
    };
    const view = render(<TilesetPalette {...props} selectedTileId={384} />);
    fireEvent.click(screen.getByRole("button", { name: "Tile right" }));
    expect(onSelectTile).toHaveBeenLastCalledWith(385);
    view.rerender(<TilesetPalette {...props} selectedTileId={385} />);
    fireEvent.click(screen.getByRole("button", { name: "Tile down" }));
    expect(onSelectTile).toHaveBeenLastCalledWith(393);
    view.rerender(<TilesetPalette {...props} selectedTileId={391} />);
    fireEvent.click(screen.getByRole("button", { name: "Tile right" }));
    expect(onSelectTile).toHaveBeenLastCalledWith(391);
    view.rerender(<TilesetPalette {...props} selectedTileId={399} />);
    fireEvent.click(screen.getByRole("button", { name: "Tile down" }));
    expect(onSelectTile).toHaveBeenLastCalledWith(399);
  });
});


describe("recent RMXP tile shortcuts", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("retains ordered unique recent regular tiles and autotiles, and resets when the tileset changes", () => {
    const image = new Image();
    image.width = 256;
    image.height = 64;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
      strokeRect: vi.fn(), fillRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    const onSelectTile = vi.fn();
    const tileset = { id: 1, name: "Test", tileset_name: "Test", autotile_names: ["Water"], passages: [], priorities: [], terrain_tags: [] };
    const props = { tilesetInfo: tileset, tilesetImage: image, autotileImages: [], selectedTileId: 384, onSelectTile, onClose: vi.fn() };
    const view = render(<TilesetPalette {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Tile right" }));
    expect(screen.getByRole("button", { name: "Select recent tile 385" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Auto" }));
    fireEvent.click(screen.getByRole("button", { name: "Autotile 1: Water" }));
    fireEvent.click(screen.getByRole("button", { name: "Select recent tile 385" }));
    expect(onSelectTile).toHaveBeenLastCalledWith(385);
    expect(screen.getAllByRole("button", { name: "Select recent tile 385" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Select recent tile 48" })).toBeTruthy();
    view.rerender(<TilesetPalette {...props} tilesetInfo={{ ...tileset, id: 2 }} />);
    expect(screen.queryByRole("button", { name: "Select recent tile 385" })).toBeNull();
  });
});
