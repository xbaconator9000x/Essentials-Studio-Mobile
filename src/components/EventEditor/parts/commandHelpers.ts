import type { EventCommand } from "../../../types";

/** Maps parent command codes to their continuation codes */
export const PARENT_CONT: Record<number, number> = { 101: 401, 108: 408, 355: 655 };

export type VisualBlock =
  | { kind: "single"; rawIndex: number; cmd: EventCommand }
  | { kind: "multi"; rawIndex: number; cmd: EventCommand; contIndices: number[]; contCmds: EventCommand[] };

/** Groups parent commands with their continuations into visual blocks */
export function toVisualBlocks(list: EventCommand[]): VisualBlock[] {
  const blocks: VisualBlock[] = [];
  let i = 0;
  while (i < list.length) {
    const cmd = list[i];
    const contCode = PARENT_CONT[cmd.code];
    if (contCode !== undefined) {
      const contIndices: number[] = [];
      const contCmds: EventCommand[] = [];
      let j = i + 1;
      // RMXP continuations belong only to the parent command's indentation.
      // A same-code command at a different depth must remain an independent entry.
      while (j < list.length && list[j].code === contCode && list[j].indent === cmd.indent) {
        contIndices.push(j);
        contCmds.push(list[j]);
        j++;
      }
      if (contIndices.length > 0 || cmd.code === 101) {
        blocks.push({ kind: "multi", rawIndex: i, cmd, contIndices, contCmds });
        i = j;
        continue;
      }
    }
    blocks.push({ kind: "single", rawIndex: i, cmd });
    i++;
  }
  return blocks;
}

/** Returns the last raw index occupied by the block starting at `index` */
export function getBlockEnd(list: EventCommand[], index: number): number {
  const contCode = PARENT_CONT[list[index]?.code ?? -1];
  if (contCode === undefined) return index;
  let j = index + 1;
  while (j < list.length && list[j].code === contCode && list[j].indent === list[index].indent) j++;
  return j - 1;
}

/** Select an entire balanced conditional or loop when its opening marker is
 * selected. A malformed structure is never modified. Nested structures and
 * Else markers are retained as part of the parent's subtree.
 */
export function getStructuralCommandRange(
  list: EventCommand[], index: number,
): { start: number; end: number } | null {
  const parent = list[index];
  if (!parent || (parent.code !== 111 && parent.code !== 112)) return null;
  const close = parent.code === 111 ? 412 : 413;
  const stack: number[] = [close];
  for (let i = index + 1; i < list.length; i++) {
    const cmd = list[i];
    if (cmd.indent < parent.indent) return null;
    if (cmd.code === 111) stack.push(412);
    else if (cmd.code === 112) stack.push(413);
    else if (cmd.code === 412 || cmd.code === 413) {
      if (stack.at(-1) !== cmd.code) return null;
      stack.pop();
      if (!stack.length) return cmd.indent === parent.indent ? { start: index, end: i } : null;
    }
  }
  return null;
}

export function getEditableCommandRange(
  list: EventCommand[], index: number,
): { start: number; end: number } | null {
  if (!Number.isInteger(index) || index < 0 || index >= list.length) return null;
  const structural = getStructuralCommandRange(list, index);
  if (structural) return structural;
  if (STRUCTURAL_EVENT_CODES.has(list[index].code)) return null;
  return getCommandBlockRange(list, index);
}

export function getCommandBlockRange(
  list: EventCommand[],
  index: number,
): { start: number; end: number } | null {
  if (!Number.isInteger(index) || index < 0 || index >= list.length) return null;
  for (const block of toVisualBlocks(list)) {
    const end = block.kind === "multi" ? block.contIndices.at(-1) ?? block.rawIndex : block.rawIndex;
    if (index >= block.rawIndex && index <= end) {
      return { start: block.rawIndex, end };
    }
  }
  return null;
}

