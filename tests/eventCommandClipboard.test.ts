import { describe, expect, it } from "vitest";
import { cloneCommandBlock, cutCommandBlock, createEventCommand, getCommandInsertionIndent, getCommandInsertionIndex, prepareCommandBlockPaste, toVisualBlocks } from "../src/components/EventEditor/parts/commandHelpers";

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
  it("cuts an entire multiline command and preserves its terminator", () => {
    const before = JSON.stringify(source);
    const cut = cutCommandBlock(source, 1);
    expect(cut).not.toBeNull();
    expect(cut?.clipboard.map((c) => c.code)).toEqual([108, 408]);
    expect(cut?.list.map((c) => c.code)).toEqual([0]);
    expect(cut?.selectedIndex).toBe(0);
    expect(JSON.stringify(source)).toBe(before);
    expect(cut?.clipboard.every((c) => !("source_index" in c))).toBe(true);
  });
  it("refuses to cut event terminators and out-of-range selections", () => {
    expect(cutCommandBlock(source, 2)).toBeNull();
    expect(cutCommandBlock(source, -1)).toBeNull();
    expect(cutCommandBlock(source, 99)).toBeNull();
  });
  it("does not confuse nested RMXP code-zero branch endings with the page terminator", () => {
    const commands = [
      { code: 111, indent: 0, parameters: [0, 1, 0] },
      { code: 101, indent: 1, parameters: ["inside branch"] },
      { code: 401, indent: 1, parameters: ["continued"] },
      { code: 0, indent: 1, parameters: [] },
      { code: 412, indent: 0, parameters: [] },
      { code: 108, indent: 0, parameters: ["after branch"] },
      { code: 0, indent: 0, parameters: [] },
    ];
    const original = JSON.stringify(commands);
    expect(getCommandInsertionIndex(commands, -1)).toBe(6);
    expect(getCommandInsertionIndex(commands, 2)).toBe(3);
    expect(getCommandInsertionIndex(commands, 3)).toBe(3);
    expect(getCommandInsertionIndex(commands, 5)).toBe(6);
    const pasted = prepareCommandBlockPaste(cloneCommandBlock(commands, 5), 0);
    const atEnd = getCommandInsertionIndex(commands, -1);
    const combined = [...commands.slice(0, atEnd), ...pasted, ...commands.slice(atEnd)];
    expect(combined.map((c) => c.code)).toEqual([111, 101, 401, 0, 412, 108, 108, 0]);
    expect(JSON.stringify(commands)).toBe(original);
  });
  it("supports event lists without an explicit final top-level terminator", () => {
    const commands = [
      { code: 111, indent: 0, parameters: [] },
      { code: 0, indent: 1, parameters: [] },
      { code: 412, indent: 0, parameters: [] },
    ];
    expect(getCommandInsertionIndex(commands, -1)).toBe(3);
    expect(getCommandInsertionIndex(commands, 2)).toBe(3);
  });
  it("does not share mutable command picker defaults across inserted commands", () => {
    const defaults = [{ __class: "RPG::AudioFile", name: "battle", volume: 90, pitch: 100 }];
    const first = createEventCommand(241, 0, defaults);
    const second = createEventCommand(241, 0, defaults);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    (first!.parameters[0] as { name: string }).name = "edited";
    expect((second!.parameters[0] as { name: string }).name).toBe("battle");
    expect(defaults[0].name).toBe("battle");
    expect(first).not.toHaveProperty("source_index");
  });
  it("rejects orphan continuations and invalid commands", () => {
    for (const code of [0, 401, 408, 655, -1]) expect(createEventCommand(code, 0)).toBeNull();
    expect(createEventCommand(108, -1)).toBeNull();
    expect(createEventCommand(108, 0)?.parameters).toEqual([""]);
  });
  it("uses top-level indentation at the final page terminator", () => {
    const list = [
      { code: 111, indent: 0, parameters: [] },
      { code: 101, indent: 1, parameters: ["nested"] },
      { code: 401, indent: 1, parameters: ["continued"] },
      { code: 0, indent: 1, parameters: [] },
      { code: 412, indent: 0, parameters: [] },
      { code: 0, indent: 0, parameters: [] },
    ];
    expect(getCommandInsertionIndent(list, -1)).toBe(0);
    expect(getCommandInsertionIndent(list, 5)).toBe(0);
    expect(getCommandInsertionIndent(list, 2)).toBe(1);
    expect(getCommandInsertionIndent(list, 3)).toBe(1);
  });
});
