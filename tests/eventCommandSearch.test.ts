import { describe, expect, it } from "vitest";
import { findEventCommandMatches, nextEventCommandMatch } from "../src/components/EventEditor/eventCommandSearch";

const commands = [
  { code: 101, indent: 0, parameters: ["Hello"] },
  { code: 401, indent: 0, parameters: ["second line SECRET"] },
  { code: 108, indent: 0, parameters: ["Secret comment"] },
  { code: 408, indent: 0, parameters: ["comment continuation"] },
  { code: 101, indent: 0, parameters: ["Goodbye"] },
];

describe("event command search", () => {
  it("matches continuation text but selects only visual block starts", () => {
    expect(findEventCommandMatches(commands, "secret")).toEqual([0, 2]);
    expect(findEventCommandMatches(commands, "continuation")).toEqual([2]);
    expect(findEventCommandMatches(commands, "  ")).toEqual([]);
  });
  it("navigates both directions and wraps without modifying command indices", () => {
    const matches = [0, 2, 4];
    expect(nextEventCommandMatch(matches, 2, 1)).toBe(4);
    expect(nextEventCommandMatch(matches, 4, 1)).toBe(0);
    expect(nextEventCommandMatch(matches, 0, -1)).toBe(4);
    expect(nextEventCommandMatch(matches, 3, -1)).toBe(2);
    expect(nextEventCommandMatch(matches, -1, 1)).toBe(0);
    expect(nextEventCommandMatch([], 0, 1)).toBe(-1);
  });
  it("matches case-insensitively without mutating the original RMXP commands", () => {
    const before = JSON.stringify(commands);
    expect(findEventCommandMatches(commands, "SeCrEt")).toEqual([0, 2]);
    expect(findEventCommandMatches(commands, "does-not-exist")).toEqual([]);
    expect(JSON.stringify(commands)).toBe(before);
  });
  it("handles an empty page and negative selections safely", () => {
    expect(findEventCommandMatches([], "hello")).toEqual([]);
    expect(nextEventCommandMatch([2, 8], -1, -1)).toBe(8);
    expect(nextEventCommandMatch([2, 8], 5, 1)).toBe(8);
  });
});
