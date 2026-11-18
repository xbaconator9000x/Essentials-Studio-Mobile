import { describe, expect, it } from "vitest";
import type { EventPage } from "../../types";
import { duplicateEventPage, moveEventPage } from "./eventPageOperations";

const page = (name: string) => ({
  condition: { switch1_valid: true, switch1_id: name === "A" ? 1 : 2 },
  graphic: { character_name: name },
  move_route: { repeat: true, list: [{ code: 14, parameters: [3, 4] }] },
  list: [{ code: 101, indent: 0, parameters: [name] }, { code: 0, indent: 0, parameters: [] }],
}) as unknown as EventPage;

describe("RMXP event page priority operations", () => {
  it("duplicates a full page immediately after the original without sharing nested state", () => {
    const original = [page("A"), page("B")];
    const result = duplicateEventPage(original, 0);
    expect(result).toHaveLength(3);
    expect(result[1]).toEqual(original[0]);
    expect(result[1]).not.toBe(original[0]);
    expect(result[1].list).not.toBe(original[0].list);
    expect(result[1].move_route).not.toBe(original[0].move_route);
    result[1].list[0].parameters[0] = "edited";
    expect(original[0].list[0].parameters[0]).toBe("A");
    expect(result[2]).toBe(original[1]);
  });

  it("moves page priority without altering page data or source order", () => {
    const original = [page("A"), page("B"), page("C")];
    const moved = moveEventPage(original, 0, 1);
    expect(moved.map((p) => p.graphic.character_name)).toEqual(["B", "A", "C"]);
    expect(original.map((p) => p.graphic.character_name)).toEqual(["A", "B", "C"]);
    expect(moveEventPage(moved, 1, -1)).toEqual(original);
  });

  it("rejects out-of-range operations without modifying event pages", () => {
    const original = [page("A"), page("B")];
    expect(duplicateEventPage(original, -1)).toBe(original);
    expect(duplicateEventPage(original, 2)).toBe(original);
    expect(moveEventPage(original, 0, -1)).toBe(original);
    expect(moveEventPage(original, 1, 1)).toBe(original);
  });
});
