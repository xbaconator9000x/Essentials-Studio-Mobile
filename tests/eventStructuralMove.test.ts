import { describe, expect, it } from "vitest";
import { canMoveCommandBlock, moveCommandBlock } from "../src/components/EventEditor/parts/commandHelpers";

const cmd = (code: number, indent = 0) => ({ code, indent, parameters: [] });
describe("balanced RMXP structural movement", () => {
  it("moves a conditional subtree across a sibling and selects its new start", () => {
    const source = [cmd(111), cmd(101, 1), cmd(401, 1), cmd(0, 1), cmd(411), cmd(101, 1), cmd(0, 1), cmd(412), cmd(108), cmd(408), cmd(0)];
    const moved = moveCommandBlock(source, 0, "down");
    expect(moved?.list.map(x => x.code)).toEqual([108,408,111,101,401,0,411,101,0,412,0]);
    expect(moved?.selectedIndex).toBe(2);
    expect(source[0].code).toBe(111);
    expect(moveCommandBlock(moved!.list, 2, "up")?.list).toEqual(source);
  });
  it("moves loop as a single unit and preserves nested child indentation", () => {
    const source = [cmd(108),cmd(112),cmd(111,1),cmd(0,2),cmd(412,1),cmd(0,1),cmd(413),cmd(0)];
    const moved = moveCommandBlock(source, 1, "up");
    expect(moved?.list.map(x => x.code)).toEqual([112,111,0,412,0,413,108,0]);
    expect(moved?.selectedIndex).toBe(0);
  });
  it("rejects movement across structural boundaries and malformed trees", () => {
    const source = [cmd(111),cmd(108,1),cmd(0,1),cmd(411),cmd(108,1),cmd(0,1),cmd(412),cmd(0)];
    expect(canMoveCommandBlock(source, 1, "down")).toBe(false);
    expect(moveCommandBlock(source, 0, "up")).toBeNull();
    expect(moveCommandBlock(source, 0, "down")).toBeNull();
    expect(moveCommandBlock([cmd(111),cmd(108),cmd(0)], 0, "down")).toBeNull();
  });
  it("preserves continuation groups when moving ordinary siblings", () => {
    const source = [cmd(101),cmd(401),cmd(108),cmd(408),cmd(0)];
    const moved = moveCommandBlock(source, 0, "down");
    expect(moved?.list.map(x => x.code)).toEqual([108,408,101,401,0]);
    expect(moved?.selectedIndex).toBe(2);
  });
});
