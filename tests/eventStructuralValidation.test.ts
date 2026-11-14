import { describe, expect, it } from "vitest";
import { cloneCommandBlock, cutCommandBlock, getStructuralCommandRange, getCommandInsertionIndex, getCommandInsertionIndent, moveCommandBlock } from "../src/components/EventEditor/parts/commandHelpers";

const cmd = (code: number, indent: number) => ({ code, indent, parameters: [] });

describe("RMXP structural subtree validation", () => {
  it("accepts a balanced nested conditional with one Else at the correct depth", () => {
    const list = [cmd(111, 0), cmd(111, 1), cmd(0, 2), cmd(411, 1), cmd(0, 2), cmd(412, 1), cmd(0, 1), cmd(412, 0), cmd(0, 0)];
    expect(getStructuralCommandRange(list, 0)).toEqual({ start: 0, end: 7 });
    expect(cloneCommandBlock(list, 0)).toHaveLength(8);
    expect(cutCommandBlock(list, 0)?.list).toEqual([cmd(0, 0)]);
  });
  it("rejects an Else belonging to another indentation level", () => {
    const list = [cmd(111, 0), cmd(411, 1), cmd(412, 0), cmd(0, 0)];
    expect(getStructuralCommandRange(list, 0)).toBeNull();
    expect(cutCommandBlock(list, 0)).toBeNull();
  });
  it("rejects duplicate Else markers and preserves the source", () => {
    const list = [cmd(111, 0), cmd(411, 0), cmd(411, 0), cmd(412, 0), cmd(0, 0)];
    const original = JSON.stringify(list);
    expect(getStructuralCommandRange(list, 0)).toBeNull();
    expect(moveCommandBlock(list, 0, "down")).toBeNull();
    expect(JSON.stringify(list)).toBe(original);
  });
  it("rejects incorrectly indented Repeat and End markers", () => {
    expect(getStructuralCommandRange([cmd(112, 0), cmd(0, 1), cmd(413, 1)], 0)).toBeNull();
    expect(getStructuralCommandRange([cmd(111, 0), cmd(0, 1), cmd(412, 1)], 0)).toBeNull();
  });
  it("inserts after an entire balanced branch rather than inside its child list", () => {
    const list = [cmd(111, 0), cmd(108, 1), cmd(0, 1), cmd(412, 0), cmd(108, 0), cmd(0, 0)];
    expect(getCommandInsertionIndex(list, 0)).toBe(4);
    expect(getCommandInsertionIndent(list, 0)).toBe(0);
    expect(getCommandInsertionIndex(list, 4)).toBe(5);
  });
  it("inserts after a nested loop while retaining its sibling indentation", () => {
    const list = [cmd(111, 0), cmd(112, 1), cmd(0, 2), cmd(413, 1), cmd(0, 1), cmd(412, 0), cmd(0, 0)];
    expect(getCommandInsertionIndex(list, 1)).toBe(4);
    expect(getCommandInsertionIndent(list, 1)).toBe(1);
  });
  it("rejects an empty child terminator at the opener depth", () => {
    expect(getStructuralCommandRange([cmd(111, 0), cmd(0, 0), cmd(412, 0)], 0)).toBeNull();
  });
  it("rejects skipped indentation in ordinary child commands", () => {
    const list = [cmd(111, 0), cmd(108, 2), cmd(0, 1), cmd(412, 0), cmd(0, 0)];
    expect(getStructuralCommandRange(list, 0)).toBeNull();
    expect(cloneCommandBlock(list, 0)).toEqual([]);
    expect(cutCommandBlock(list, 0)).toBeNull();
    expect(moveCommandBlock(list, 0, "down")).toBeNull();
  });
  it("rejects skipped indentation in nested openers and terminators", () => {
    expect(getStructuralCommandRange([cmd(112, 0), cmd(111, 2), cmd(0, 3), cmd(412, 2), cmd(413, 0)], 0)).toBeNull();
    expect(getStructuralCommandRange([cmd(111, 0), cmd(0, 2), cmd(412, 0)], 0)).toBeNull();
  });
  it("rejects sibling commands masquerading as children", () => {
    expect(getStructuralCommandRange([cmd(111, 0), cmd(108, 0), cmd(412, 0)], 0)).toBeNull();
  });
});
