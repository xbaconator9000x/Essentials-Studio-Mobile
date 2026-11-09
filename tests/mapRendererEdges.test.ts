// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { MapRenderer } from "../src/services/mapRenderer";

describe("map renderer edge tiles", () => {
  it("draws the bottom-right XP tile at fractional viewport edges", () => {
    const draws: unknown[][] = [];
    const context = {
      fillStyle: "",
      globalAlpha: 1,
      imageSmoothingEnabled: false,
      fillRect() {},
      drawImage: (...args: unknown[]) => draws.push(args),
    };
    const canvas = {
      width: 48,
      height: 48,
      getContext: () => context,
    } as unknown as HTMLCanvasElement;
    const renderer = new MapRenderer(canvas);
    renderer.setTilesetImage({ width: 256, height: 256 } as HTMLImageElement);
    renderer.setMapData([
      0, 0, 0, 384,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ], 2, 2);

    renderer.render(0, {
      showGrid: false,
      showEvents: false,
      showLayer: [true, true, true],
      activeLayer: 0,
      zoom: 1,
      viewportX: 0.5,
      viewportY: 0.5,
    }, []);

    expect(draws).toHaveLength(1);
    expect(draws[0].slice(1)).toEqual([0, 0, 32, 32, 16, 16, 32, 32]);
  });
});
