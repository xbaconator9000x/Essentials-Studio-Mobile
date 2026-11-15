import { describe, expect, it } from "vitest";
import { addConditionalElseArm, removeEmptyConditionalElseArm, getStructuralCommandRange, createEventCommand, createEventCommandInsertion, getCommandInsertionIndex, getCommandInsertionIndent } from "../src/components/EventEditor/parts/commandHelpers";

describe("RMXP structural command insertion", () => {
  it("creates balanced conditional and loop scaffolds with correctly nested terminators", () => {
    expect(createEventCommandInsertion(111, 0).map(({ code, indent }) => [code, indent])).toEqual([[111, 0], [0, 1], [412, 0]]);
    expect(createEventCommandInsertion(112, 2).map(({ code, indent }) => [code, indent])).toEqual([[112, 2], [0, 3], [413, 2]]);
  });
  it("never creates standalone Else, End, Repeat or code-zero markers", () => {
    for (const code of [0, 411, 412, 413, 401, 408, 655]) {
      expect(createEventCommandInsertion(code, 0)).toEqual([]);
    }
    expect(createEventCommandInsertion(111, -1)).toEqual([]);
    for (const code of [0, 411, 412, 413, 401, 408, 655]) {
      expect(createEventCommand(code, 0)).toBeNull();
    }
    expect(createEventCommand(111, 0)?.code).toBe(111);
  });
  it("keeps structural openers constructible while refusing orphan control markers", () => {
    for (const code of [111, 112]) {
      expect(createEventCommand(code, 1)?.code).toBe(code);
      const scaffold = createEventCommandInsertion(code, 1);
      expect(scaffold).toHaveLength(3);
      expect(scaffold[0].code).toBe(code);
      expect(scaffold[1]).toMatchObject({ code: 0, indent: 2 });
      expect(scaffold[2]).toMatchObject({ code: code === 111 ? 412 : 413, indent: 1 });
    }
    for (const code of [0, 411, 412, 413, 401, 408, 655]) {
      expect(createEventCommand(code, 1)).toBeNull();
    }
  });
  it("adds an Else arm after the Then body and retains a balanced subtree", () => {
    const before = [
      { code: 111, indent: 0, parameters: [0, 1, 0], source_index: 4 },
      { code: 101, indent: 1, parameters: ["then"], source_index: 5 },
      { code: 0, indent: 1, parameters: [], source_index: 6 },
      { code: 412, indent: 0, parameters: [], source_index: 7 },
      { code: 0, indent: 0, parameters: [] },
    ];
    const result = addConditionalElseArm(before, 0);
    expect(result).not.toBeNull();
    expect(result!.list.map(({ code, indent }) => [code, indent])).toEqual([
      [111, 0], [101, 1], [0, 1], [411, 0], [0, 1], [412, 0], [0, 0],
    ]);
    expect(result!.selectedIndex).toBe(3);
    expect(getStructuralCommandRange(result!.list, 0)).toEqual({ start: 0, end: 5 });
    expect(result!.list[1].source_index).toBe(5);
    expect(result!.list[3].source_index).toBeUndefined();
    expect(before).toHaveLength(5);
  });
  it("rejects duplicate Else, nested selection and malformed branches atomically", () => {
    const nested = [
      { code: 111, indent: 0, parameters: [] },
      { code: 111, indent: 1, parameters: [] },
      { code: 0, indent: 2, parameters: [] },
      { code: 411, indent: 1, parameters: [] },
      { code: 0, indent: 2, parameters: [] },
      { code: 412, indent: 1, parameters: [] },
      { code: 0, indent: 1, parameters: [] },
      { code: 412, indent: 0, parameters: [] },
    ];
    const result = addConditionalElseArm(nested, 0);
    expect(result).not.toBeNull();
    expect(getStructuralCommandRange(result!.list, 0)).toEqual({ start: 0, end: 9 });
    expect(addConditionalElseArm(result!.list, 0)).toBeNull();
    expect(addConditionalElseArm(nested, 2)).toBeNull();
    expect(addConditionalElseArm(nested.slice(0, -1), 0)).toBeNull();
    expect(nested).toHaveLength(8);
  });
  it("refuses to add Else when the Then child-list terminator is absent or misplaced", () => {
    const valid = [
      { code: 111, indent: 0, parameters: [] },
      { code: 101, indent: 1, parameters: ["then"] },
      { code: 0, indent: 1, parameters: [] },
      { code: 412, indent: 0, parameters: [] },
      { code: 0, indent: 0, parameters: [] },
    ];
    expect(addConditionalElseArm(valid, 0)).not.toBeNull();
    const missing = valid.filter((_, i) => i !== 2);
    const misplaced = valid.map((cmd, i) => i === 2 ? { ...cmd, code: 108 } : cmd);
    expect(addConditionalElseArm(missing, 0)).toBeNull();
    expect(addConditionalElseArm(misplaced, 0)).toBeNull();
    expect(missing.map((cmd) => cmd.code)).toEqual([111, 101, 412, 0]);
  });
  it("rejects balanced but unterminated nested RMXP branches without mutating source", () => {
    const valid = [
      { code: 111, indent: 0, parameters: [] },
      { code: 112, indent: 1, parameters: [] },
      { code: 101, indent: 2, parameters: ["inside loop"] },
      { code: 0, indent: 2, parameters: [] },
      { code: 413, indent: 1, parameters: [] },
      { code: 0, indent: 1, parameters: [] },
      { code: 411, indent: 0, parameters: [] },
      { code: 101, indent: 1, parameters: ["else"] },
      { code: 0, indent: 1, parameters: [] },
      { code: 412, indent: 0, parameters: [] },
      { code: 0, indent: 0, parameters: [] },
    ];
    expect(getStructuralCommandRange(valid, 0)).toEqual({ start: 0, end: 9 });
    for (const omitted of [3, 5, 8]) {
      const malformed = valid.filter((_, i) => i !== omitted);
      const snapshot = structuredClone(malformed);
      expect(getStructuralCommandRange(malformed, 0)).toBeNull();
      expect(addConditionalElseArm(malformed, 0)).toBeNull();
      expect(malformed).toEqual(snapshot);
    }
    expect(getStructuralCommandRange(valid, 1)).toEqual({ start: 1, end: 4 });
  });
  it("removes only an empty Else arm while preserving Then commands and source indices", () => {
    const original = [
      { code: 111, indent: 0, parameters: [], source_index: 10 },
      { code: 101, indent: 1, parameters: ["then"], source_index: 11 },
      { code: 0, indent: 1, parameters: [], source_index: 12 },
      { code: 412, indent: 0, parameters: [], source_index: 13 },
      { code: 0, indent: 0, parameters: [], source_index: 14 },
    ];
    const added = addConditionalElseArm(original, 0);
    expect(added).not.toBeNull();
    const removed = removeEmptyConditionalElseArm(added!.list, 0);
    expect(removed?.list).toEqual(original);
    expect(removed?.selectedIndex).toBe(0);
    expect(removeEmptyConditionalElseArm(original, 0)).toBeNull();
    const populated = added!.list.map((cmd, i) => i === 4
      ? { code: 101, indent: 1, parameters: ["important"] } : cmd);
    populated.splice(5, 0, { code: 0, indent: 1, parameters: [] });
    const snapshot = structuredClone(populated);
    expect(removeEmptyConditionalElseArm(populated, 0)).toBeNull();
    expect(populated).toEqual(snapshot);
  });
  it("preserves source templates and generates independent nested parameters", () => {
    const defaults = [{ name: "shared", nested: [1, 2] }];
    const first = createEventCommandInsertion(111, 0, defaults);
    const second = createEventCommandInsertion(111, 0, defaults);
    (first[0].parameters[0] as { nested: number[] }).nested[0] = 99;
    expect((second[0].parameters[0] as { nested: number[] }).nested[0]).toBe(1);
    expect(defaults[0].nested[0]).toBe(1);
  });
  it("rejects insertion on malformed control-flow openers and orphan branch markers", () => {
    const malformed = [
      { code: 111, indent: 0, parameters: [] },
      { code: 101, indent: 1, parameters: ["unterminated"] },
      { code: 412, indent: 0, parameters: [] },
      { code: 0, indent: 0, parameters: [] },
    ];
    const snapshot = structuredClone(malformed);
    expect(getCommandInsertionIndex(malformed, 0)).toBe(-1);
    expect(getCommandInsertionIndex(malformed, 2)).toBe(-1);
    expect(malformed).toEqual(snapshot);
    const valid = [
      { code: 111, indent: 0, parameters: [] },
      { code: 0, indent: 1, parameters: [] },
      { code: 411, indent: 0, parameters: [] },
      { code: 0, indent: 1, parameters: [] },
      { code: 412, indent: 0, parameters: [] },
      { code: 0, indent: 0, parameters: [] },
    ];
    expect(getCommandInsertionIndex(valid, 0)).toBe(5);
    expect(getCommandInsertionIndex(valid, 2)).toBe(-1);
    expect(getCommandInsertionIndex(valid, 4)).toBe(-1);
    expect(getCommandInsertionIndex(valid, 3)).toBe(3);
  });
  it("inserts complete structure before the page terminator at top level", () => {
    const list = [{ code: 101, indent: 0, parameters: ["hello"] }, { code: 0, indent: 0, parameters: [] }];
    const index = getCommandInsertionIndex(list, 1);
    const result = [...list.slice(0, index), ...createEventCommandInsertion(111, getCommandInsertionIndent(list, 1)), ...list.slice(index)];
    expect(result.map(({ code, indent }) => [code, indent])).toEqual([[101, 0], [111, 0], [0, 1], [412, 0], [0, 0]]);
  });
});
