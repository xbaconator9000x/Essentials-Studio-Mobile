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

  it("hides event pins without changing the map's event data", () => {
    const fills: unknown[][] = [];
    const context = {
      fillStyle: "",
      globalAlpha: 1,
      imageSmoothingEnabled: false,
      fillRect: (...args: unknown[]) => fills.push(args),
      strokeRect() {},
      fillText() {},
      setLineDash() {},
    };
    const canvas = {
      width: 64,
      height: 64,
      getContext: () => context,
    } as unknown as HTMLCanvasElement;
    const renderer = new MapRenderer(canvas);
    const events = [{
      id: 8,
      name: "NPC",
      x: 1,
      y: 1,
      graphicName: "",
      graphicDirection: 2,
      graphicPattern: 0,
    }];
    const options = {
      showGrid: false,
      showEvents: true,
      showLayer: [false, false, false] as [boolean, boolean, boolean],
      activeLayer: 0,
      zoom: 1,
      viewportX: 0,
      viewportY: 0,
    };

    renderer.render(0, options, events);
    expect(fills).toHaveLength(2);
    options.showEvents = false;
    renderer.render(1, options, events);

    expect(fills).toHaveLength(3);
    expect(events).toEqual([{
      id: 8,
      name: "NPC",
      x: 1,
      y: 1,
      graphicName: "",
      graphicDirection: 2,
      graphicPattern: 0,
    }]);
  });
});
