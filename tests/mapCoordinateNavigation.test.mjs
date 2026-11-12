import test from "node:test";
import assert from "node:assert/strict";
import { parseMapCoordinate } from "../src/services/mapCoordinateNavigation.ts";

test("coordinate navigation targets exact zero-based XP tiles", () => {
  assert.deepEqual(parseMapCoordinate("0", "0", 160, 128), { x: 0, y: 0 });
  assert.deepEqual(parseMapCoordinate("00159", "127", 160, 128), { x: 159, y: 127 });
  assert.deepEqual(parseMapCoordinate(" 14 ", "  7 ", 160, 128), { x: 14, y: 7 });
});
test("invalid and off-map text cannot be truncated into a valid event target", () => {
  for (const [x, y] of [
    ["", "0"], ["-1", "0"], ["1.5", "0"], ["1e1", "0"],
    ["1foo", "0"], ["+1", "0"], ["0x10", "0"], ["NaN", "0"],
    ["2", "3"], ["3", "2"], ["999999999999999999999", "1"],
  ]) assert.equal(parseMapCoordinate(x, y, 3, 3), null);
});
test("map dimensions must be positive safe integers", () => {
  assert.equal(parseMapCoordinate("0", "0", 0, 1), null);
  assert.equal(parseMapCoordinate("0", "0", 1.2, 2), null);
  assert.equal(parseMapCoordinate("0", "0", Number.MAX_SAFE_INTEGER + 1, 2), null);
});
