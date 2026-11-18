import { afterEach, describe, expect, it } from "vitest";
import { clearEventCommandClipboard, getEventCommandClipboard, setEventCommandClipboard } from "../src/components/EventEditor/eventCommandClipboard";

afterEach(clearEventCommandClipboard);

describe("project-scoped event clipboard lifecycle", () => {
  const commands = [
    { code: 108, indent: 2, parameters: [{ nested: ["original"] }], source_index: 9 },
    { code: 408, indent: 2, parameters: ["continued"], source_index: 10 },
  ];
  it("survives editor remounts through a shared project clipboard", () => {
    setEventCommandClipboard("/project/a", commands);
    const fromNextEditor = getEventCommandClipboard("/project/a");
    expect(fromNextEditor.map(c => c.code)).toEqual([108, 408]);
    expect(fromNextEditor.every(c => !("source_index" in c))).toBe(true);
    (fromNextEditor[0].parameters[0] as { nested: string[] }).nested[0] = "edited";
    expect((getEventCommandClipboard("/project/a")[0].parameters[0] as { nested: string[] }).nested[0]).toBe("original");
    expect((commands[0].parameters[0] as { nested: string[] }).nested[0]).toBe("original");
  });
  it("never exposes clipboard commands to a different project", () => {
    setEventCommandClipboard("/project/a", commands);
    expect(getEventCommandClipboard("/project/b")).toEqual([]);
    setEventCommandClipboard("/project/b", [{ code: 355, indent: 0, parameters: ["script"] }]);
    expect(getEventCommandClipboard("/project/a")).toEqual([]);
    expect(getEventCommandClipboard("/project/b")[0].code).toBe(355);
  });
  it("clears explicitly and rejects empty commands", () => {
    setEventCommandClipboard("/project/a", commands);
    clearEventCommandClipboard();
    expect(getEventCommandClipboard("/project/a")).toEqual([]);
    setEventCommandClipboard("/project/a", []);
    expect(getEventCommandClipboard("/project/a")).toEqual([]);
  });
});
