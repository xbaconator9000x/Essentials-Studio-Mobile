import { describe, expect, it } from "vitest";
import { cloneCommandBlock, getCommandInsertionIndex, prepareCommandBlockPaste, toVisualBlocks } from "../src/components/EventEditor/parts/commandHelpers";

describe("cross-event RMXP command clipboard", () => {
  const source = [
    { code: 108, indent: 1, parameters: ["original"], source_index: 12 },
    { code: 408, indent: 1, parameters: ["continuation"], source_index: 13 },
    { code: 0, indent: 0, parameters: [] },
  ];
  it("copies complete visual blocks, drops old source indices, and preserves original", () => {
    const before = JSON.stringify(source);
    const clipboard = cloneCommandBlock(source, 1);
    expect(clipboard).toHaveLength(2);
    expect(clipboard.every((c) => !("source_index" in c))).toBe(true);
    const pasted = prepareCommandBlockPaste(clipboard, 3);
    expect(pasted.map((c) => c.indent)).toEqual([3, 3]);
    expect(toVisualBlocks(pasted)).toHaveLength(1);
    pasted[0].parameters[0] = "changed";
    expect(clipboard[0].parameters[0]).toBe("original");
    expect(JSON.stringify(source)).toBe(before);
  });
  it("inserts before terminator without breaking multiline block", () => {
    const target = [
      { code: 101, indent: 0, parameters: ["dialogue"] },
      { code: 401, indent: 0, parameters: ["more dialogue"] },
      { code: 0, indent: 0, parameters: [] },
    ];
    const insertion = getCommandInsertionIndex(target, 1);
    expect(insertion).toBe(2);
    const result = [...target.slice(0, insertion), ...prepareCommandBlockPaste(cloneCommandBlock(source, 0), 0), ...target.slice(insertion)];
    expect(toVisualBlocks(result).map((b) => b.rawIndex)).toEqual([0, 2, 4]);
    expect(result.at(-1)?.code).toBe(0);
  });
  it("rejects invalid indentation and empty clipboard atomically", () => {
    expect(prepareCommandBlockPaste([], 0)).toEqual([]);
    expect(prepareCommandBlockPaste(cloneCommandBlock(source, 0), -1)).toEqual([]);
    expect(prepareCommandBlockPaste([{ code: 108, indent: 2, parameters: [] }, { code: 408, indent: 1, parameters: [] }], 0)).toEqual([]);
  });
});
