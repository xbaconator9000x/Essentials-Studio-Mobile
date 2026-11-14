import type { EventInfo } from "../types";

/** Planning only: never write RMXP event data until the project command accepts
 * a confirmed map coordinate. Guard against duplicate taps and invalid tiles. */
export type MapEventPlacementMode = "create" | "paste";

export function resolveMapEventPlacement(
  mode: MapEventPlacementMode,
  x: number,
  y: number,
  width: number,
  height: number,
  events: readonly Pick<EventInfo, "x" | "y">[],
): "outside" | "occupied" | MapEventPlacementMode {
  if ((mode !== "create" && mode !== "paste") ||
      ![x, y, width, height].every(Number.isSafeInteger) ||
      width <= 0 || height <= 0 ||
      x < 0 || y < 0 || x >= width || y >= height) return "outside";
  return events.some(event => event.x === x && event.y === y) ? "occupied" : mode;
}
