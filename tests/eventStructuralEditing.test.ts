import { describe, expect, it } from "vitest";
import { cloneCommandBlock, cutCommandBlock, deleteEditableCommandBlock, getEditableCommandRange, getStructuralCommandRange, prepareCommandBlockPaste } from "../src/components/EventEditor/parts/commandHelpers";

const c = (code: number, indent: number, text = "") => ({ code, indent, parameters: text ? [text] : [] });
const nested = [
  c(111, 0), c(101, 1), c(401, 1, "dialogue"),
  c(112, 1), c(108, 2, "loop"), c(0, 2), c(413, 1),
  c(0, 1), c(411, 0), c(101, 1), c(401, 1, "else"),
  c(0, 1), c(412, 0), c(101, 0), c(401, 0, "after"), c(0, 0),
];
describe("balanced RMXP structural edits", () => {
  it("selects entire nested conditional including Else and nested loop", () => {
    expect(getStructuralCommandRange(nested, 0)).toEqual({ start: 0, end: 12 });
    expect(getStructuralCommandRange(nested, 3)).toEqual({ start: 3, end: 6 });
    expect(getEditableCommandRange(nested, 2)).toEqual({ start: 1, end: 2 });
    expect(getEditableCommandRange(nested, 8)).toBeNull();
  });
  it("copies and cuts a balanced tree without mutating source or losing trailing commands", () => {
    const original = JSON.stringify(nested);
    const clipboard = cloneCommandBlock(nested, 0);
    expect(clipboard).toHaveLength(13);
    const pasted = prepareCommandBlockPaste(clipboard, 2);
    expect(pasted[0].indent).toBe(2);
    expect(pasted.at(-1)?.indent).toBe(2);
    expect(getStructuralCommandRange(pasted, 0)).toEqual({ start: 0, end: 12 });
    const cut = cutCommandBlock(nested, 0);
    expect(cut?.list.map((cmd) => cmd.code)).toEqual([101, 401, 0]);
    expect(JSON.stringify(nested)).toBe(original);
  });
  it("deletes whole loop and preserves surrounding conditional", () => {
    const result = deleteEditableCommandBlock(nested, 3);
    expect(result?.list.some((cmd) => cmd.code === 413)).toBe(false);
    expect(result?.list.some((cmd) => cmd.code === 412)).toBe(true);
    expect(getStructuralCommandRange(result!.list, 0)).not.toBeNull();
  });
  it("rejects mismatched or incomplete structures without deleting data", () => {
    const invalid = [c(111, 0), c(112, 1), c(412, 0), c(0, 0)];
    expect(getStructuralCommandRange(invalid, 0)).toBeNull();
    expect(cloneCommandBlock(invalid, 0)).toEqual([]);
    expect(cutCommandBlock(invalid, 0)).toBeNull();
    expect(deleteEditableCommandBlock(invalid, 0)).toBeNull();
  });
});
