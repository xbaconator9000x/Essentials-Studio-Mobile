export interface GesturePoint {
  x: number;
  y: number;
}

export type TouchGestureAction =
  | { type: "tap"; point: GesturePoint }
  | { type: "long-press"; point: GesturePoint }
  | { type: "pan"; deltaX: number; deltaY: number }
  | {
      type: "pinch";
      scale: number;
      center: GesturePoint;
      deltaX: number;
      deltaY: number;
    };

interface PointerPosition extends GesturePoint {
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  startedAt: number;
}

export interface MapTapEvent {
  x: number;
  y: number;
  id: number;
  name: string;
}

export type MapTapTarget =
  | { type: "outside" }
  | { type: "map" }
  | { type: "event"; event: MapTapEvent }
  | { type: "empty-event-layer" };

export function resolveMapTapTarget(
  point: GesturePoint,
  width: number,
  height: number,
  selectedLayer: number,
  events: MapTapEvent[],
): MapTapTarget {
  if (
    !Number.isInteger(point.x) ||
    !Number.isInteger(point.y) ||
    point.x < 0 ||
    point.y < 0 ||
    point.x >= width ||
    point.y >= height
  ) {
    return { type: "outside" };
  }

  if (selectedLayer !== 3) return { type: "map" };
  const event = events.find((candidate) => candidate.x === point.x && candidate.y === point.y);
  return event ? { type: "event", event } : { type: "empty-event-layer" };
}

export class TouchGestureMachine {
  private readonly pointers = new Map<number, PointerPosition>();
  private mode: "idle" | "pending" | "pan" | "pinch" | "suppressed" = "idle";
  private previousPinchDistance = 0;
  private previousPinchCenter: GesturePoint = { x: 0, y: 0 };
  private readonly movementThreshold: number;
  private readonly longPressDuration: number;

  constructor(movementThreshold = 8, longPressDuration = 500) {
    this.movementThreshold = movementThreshold;
    this.longPressDuration = longPressDuration;
  }

  pointerDown(pointerId: number, point: GesturePoint, timestamp: number): void {
    this.pointers.set(pointerId, {
      ...point,
      startX: point.x,
      startY: point.y,
      lastX: point.x,
      lastY: point.y,
      startedAt: timestamp,
    });

    if (this.pointers.size === 1) {
      this.mode = "pending";
    } else if (this.pointers.size === 2) {
      const [first, second] = [...this.pointers.values()];
      this.previousPinchDistance = this.distance(first, second);
      this.previousPinchCenter = this.center(first, second);
      this.mode = "pinch";
    } else {
      this.mode = "suppressed";
    }
  }

  pointerMove(pointerId: number, point: GesturePoint): TouchGestureAction | null {
    const pointer = this.pointers.get(pointerId);
    if (!pointer) return null;

    pointer.x = point.x;
    pointer.y = point.y;

    if (this.mode === "pending") {
      if (this.distance(pointer, { x: pointer.startX, y: pointer.startY }) < this.movementThreshold) {
        return null;
      }
      this.mode = "pan";
      pointer.lastX = point.x;
      pointer.lastY = point.y;
      return {
        type: "pan",
        deltaX: point.x - pointer.startX,
        deltaY: point.y - pointer.startY,
      };
    }

    if (this.mode === "pan") {
      const deltaX = point.x - pointer.lastX;
      const deltaY = point.y - pointer.lastY;
      pointer.lastX = point.x;
      pointer.lastY = point.y;
      return { type: "pan", deltaX, deltaY };
    }

    if (this.mode !== "pinch" || this.pointers.size !== 2) return null;

    const [first, second] = [...this.pointers.values()];
    const distance = this.distance(first, second);
    const center = this.center(first, second);
    const scale = this.previousPinchDistance > 0 ? distance / this.previousPinchDistance : 1;
    const action: TouchGestureAction = {
      type: "pinch",
      scale,
      center,
      deltaX: center.x - this.previousPinchCenter.x,
      deltaY: center.y - this.previousPinchCenter.y,
    };
    this.previousPinchDistance = distance;
    this.previousPinchCenter = center;
    pointer.lastX = point.x;
    pointer.lastY = point.y;
    return action;
  }

  pointerUp(pointerId: number, point: GesturePoint, timestamp: number): TouchGestureAction | null {
    const pointer = this.pointers.get(pointerId);
    if (!pointer) return null;
    pointer.x = point.x;
    pointer.y = point.y;

    let action: TouchGestureAction | null = null;
    if (
      this.mode === "pending" &&
      this.pointers.size === 1 &&
      this.distance(pointer, { x: pointer.startX, y: pointer.startY }) < this.movementThreshold
    ) {
      action = {
        type: timestamp - pointer.startedAt >= this.longPressDuration ? "long-press" : "tap",
        point,
      };
    }

    this.pointers.delete(pointerId);
    if (this.pointers.size === 0) {
      this.mode = "idle";
    } else {
      this.mode = "suppressed";
    }
    return action;
  }

  cancel(): void {
    this.pointers.clear();
    this.mode = "idle";
  }

  private distance(first: GesturePoint, second: GesturePoint): number {
    return Math.hypot(first.x - second.x, first.y - second.y);
  }

  private center(first: GesturePoint, second: GesturePoint): GesturePoint {
    return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
  }
}
