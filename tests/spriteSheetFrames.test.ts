import { describe, expect, it } from "vitest";
import {
  getWalkSpriteFrame,
  stepWalkSpriteFrame,
  WALK_FRAME_COUNT,
  WALK_FRAME_DIRECTIONS,
} from "../src/services/spriteSheetFrames";

describe("opt-in RMXP character sheet frame geometry", () => {
  it("selects exact source-pixel rectangles for 4 columns and Down/Left/Right/Up rows", () => {
    expect(WALK_FRAME_COUNT).toBe(16);
    expect(WALK_FRAME_DIRECTIONS).toEqual(["Down", "Left", "Right", "Up"]);
    expect(getWalkSpriteFrame(128, 192, 0)).toEqual({
      index: 0, x: 0, y: 0, width: 32, height: 48, direction: "Down", phase: 1,
    });
    expect(getWalkSpriteFrame(128, 192, 7)).toEqual({
      index: 7, x: 96, y: 48, width: 32, height: 48, direction: "Left", phase: 4,
    });
    expect(getWalkSpriteFrame(128, 192, 14)).toEqual({
      index: 14, x: 64, y: 144, width: 32, height: 48, direction: "Up", phase: 3,
    });
  });

  it("never rounds frame boundaries or accepts incompatible/non-finite images", () => {
    for (const [width, height] of [
      [129, 192], [128, 193], [0, 4], [4, 0], [-4, 16],
      [Infinity, 16], [4.5, 16], [16384, 16384],
    ]) {
      expect(getWalkSpriteFrame(width, height, 0)).toBeNull();
    }
    for (const index of [-1, 16, 1.5, Infinity, Number.NaN]) {
      expect(getWalkSpriteFrame(128, 192, index)).toBeNull();
    }
  });

  it("wraps navigation without modifying pixels or escaping the sheet", () => {
    expect(stepWalkSpriteFrame(0, -1)).toBe(15);
    expect(stepWalkSpriteFrame(15, 1)).toBe(0);
    expect(stepWalkSpriteFrame(3, 1)).toBe(4);
    expect(stepWalkSpriteFrame(0, 33)).toBe(1);
    // Large deltas must be reduced before adding to the current frame.
    expect(stepWalkSpriteFrame(15, Number.MAX_SAFE_INTEGER)).toBe(14);
    expect(stepWalkSpriteFrame(15, -Number.MAX_SAFE_INTEGER)).toBe(0);
    expect(stepWalkSpriteFrame(15, Number.MAX_SAFE_INTEGER - 1)).toBe(13);
    expect(stepWalkSpriteFrame(0, Number.MAX_SAFE_INTEGER + 1)).toBeNull();
    expect(stepWalkSpriteFrame(0, -(Number.MAX_SAFE_INTEGER + 1))).toBeNull();
    expect(stepWalkSpriteFrame(0, 0.2)).toBeNull();
    expect(stepWalkSpriteFrame(16, 1)).toBeNull();
  });
});
