import test from "node:test";
import assert from "node:assert/strict";
import { resolveMapTapTarget, TouchGestureMachine } from "../src/services/mapGestures.ts";

test("tap stays a tap below the movement threshold; dragging pans without tapping", () => {
  const gestures = new TouchGestureMachine();
  gestures.pointerDown(1, { x: 20, y: 20 }, 0);
  assert.equal(gestures.pointerMove(1, { x: 25, y: 24 }), null);
  assert.deepEqual(gestures.pointerUp(1, { x: 25, y: 24 }, 100), {
    type: "tap",
    point: { x: 25, y: 24 },
  });

  gestures.pointerDown(2, { x: 20, y: 20 }, 200);
  assert.deepEqual(gestures.pointerMove(2, { x: 35, y: 20 }), {
    type: "pan",
    deltaX: 15,
    deltaY: 0,
  });
  assert.equal(gestures.pointerUp(2, { x: 35, y: 20 }, 300), null);
});

test("long press is distinguished from a tap without treating movement as an inspect", () => {
  const gestures = new TouchGestureMachine();
  gestures.pointerDown(1, { x: 10, y: 10 }, 0);
  assert.deepEqual(gestures.pointerUp(1, { x: 10, y: 10 }, 500), {
    type: "long-press",
    point: { x: 10, y: 10 },
  });

  gestures.pointerDown(1, { x: 10, y: 10 }, 600);
  gestures.pointerMove(1, { x: 30, y: 10 });
  assert.equal(gestures.pointerUp(1, { x: 30, y: 10 }, 1200), null);
});

test("touch cancel discards the pending tap; rapid taps reset independently", () => {
  const gestures = new TouchGestureMachine();
  gestures.pointerDown(1, { x: 1, y: 1 }, 0);
  gestures.cancel();
  assert.equal(gestures.pointerUp(1, { x: 1, y: 1 }, 10), null);

  gestures.pointerDown(1, { x: 2, y: 2 }, 20);
  assert.equal(gestures.pointerUp(1, { x: 2, y: 2 }, 30)?.type, "tap");
  gestures.pointerDown(1, { x: 3, y: 3 }, 40);
  assert.equal(gestures.pointerUp(1, { x: 3, y: 3 }, 50)?.type, "tap");
});

test("two-finger movement pinches and suppresses a trailing single-finger tap", () => {
  const gestures = new TouchGestureMachine();
  gestures.pointerDown(1, { x: 10, y: 10 }, 0);
  gestures.pointerDown(2, { x: 30, y: 10 }, 1);
  assert.deepEqual(gestures.pointerMove(2, { x: 40, y: 10 }), {
    type: "pinch",
    scale: 1.5,
    center: { x: 25, y: 10 },
    deltaX: 5,
    deltaY: 0,
  });
  assert.equal(gestures.pointerUp(2, { x: 40, y: 10 }, 20), null);
  assert.equal(gestures.pointerUp(1, { x: 10, y: 10 }, 30), null);
});

test("event-layer taps inspect an event, create on empty cells, and reject out-of-bounds cells", () => {
  const events = [{ id: 7, name: "Door", x: 2, y: 1 }];
  assert.deepEqual(resolveMapTapTarget({ x: 2, y: 1 }, 4, 3, 3, events), {
    type: "event",
    event: events[0],
  });
  assert.deepEqual(resolveMapTapTarget({ x: 0, y: 0 }, 4, 3, 3, events), {
    type: "empty-event-layer",
  });
  assert.deepEqual(resolveMapTapTarget({ x: 4, y: 0 }, 4, 3, 0, events), {
    type: "outside",
  });
  assert.deepEqual(resolveMapTapTarget({ x: 1.5, y: 0 }, 4, 3, 0, events), {
    type: "outside",
  });
});
