import test from "node:test";
import assert from "node:assert/strict";
import { resolveMapEventPlacement } from "../src/services/mapEventPlacement.ts";

test("event insertion is allowed only on an empty native RMXP map tile", () => {
  const events = [{ x: 2, y: 1 }, { x: 0, y: 0 }];
  const snapshot = JSON.stringify(events);
  assert.equal(resolveMapEventPlacement("create", 1, 1, 3, 2, events), "create");
  assert.equal(resolveMapEventPlacement("paste", 1, 1, 3, 2, events), "paste");
  assert.equal(resolveMapEventPlacement("create", 2, 1, 3, 2, events), "occupied");
  assert.equal(resolveMapEventPlacement("paste", 0, 0, 3, 2, events), "occupied");
  assert.equal(JSON.stringify(events), snapshot);
});

test("map event placement rejects off-map, fractional and unsafe coordinates", () => {
  const events = [];
  for (const [x, y, width, height] of [
    [-1, 0, 3, 3], [0, -1, 3, 3], [3, 0, 3, 3], [0, 3, 3, 3],
    [0.5, 0, 3, 3], [0, Number.NaN, 3, 3], [0, 0, 0, 3],
    [0, 0, Number.MAX_SAFE_INTEGER + 1, 3],
  ]) assert.equal(resolveMapEventPlacement("create", x, y, width, height, events), "outside");
  assert.equal(resolveMapEventPlacement("paste", 0, 0, 3, 3, events), "paste");
});
