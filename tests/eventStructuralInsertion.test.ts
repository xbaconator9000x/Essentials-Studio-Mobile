import { describe, expect, it } from "vitest";
import { createEventCommand, createEventCommandInsertion, getCommandInsertionIndex, getCommandInsertionIndent } from "../src/components/EventEditor/parts/commandHelpers";

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
  it("preserves source templates and generates independent nested parameters", () => {
    const defaults = [{ name: "shared", nested: [1, 2] }];
    const first = createEventCommandInsertion(111, 0, defaults);
    const second = createEventCommandInsertion(111, 0, defaults);
    (first[0].parameters[0] as { nested: number[] }).nested[0] = 99;
    expect((second[0].parameters[0] as { nested: number[] }).nested[0]).toBe(1);
    expect(defaults[0].nested[0]).toBe(1);
  });
  it("inserts complete structure before the page terminator at top level", () => {
    const list = [{ code: 101, indent: 0, parameters: ["hello"] }, { code: 0, indent: 0, parameters: [] }];
    const index = getCommandInsertionIndex(list, 1);
    const result = [...list.slice(0, index), ...createEventCommandInsertion(111, getCommandInsertionIndent(list, 1)), ...list.slice(index)];
    expect(result.map(({ code, indent }) => [code, indent])).toEqual([[101, 0], [111, 0], [0, 1], [412, 0], [0, 0]]);
  });
});
