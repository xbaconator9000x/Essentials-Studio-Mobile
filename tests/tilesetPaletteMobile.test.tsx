// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TilesetPalette } from "../src/components/TilesetPalette/TilesetPalette";

describe("mobile tileset palette", () => {
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
