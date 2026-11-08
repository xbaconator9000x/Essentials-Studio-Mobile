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

export function getCommandInsertionIndex(list: EventCommand[], selectedIndex: number): number {
  const endIndex = list.findIndex((command) => command.code === 0);
  if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= list.length) {
    return endIndex === -1 ? list.length : endIndex;
  }
  if (list[selectedIndex].code === 0) return selectedIndex;
  const range = getCommandBlockRange(list, selectedIndex);
  const insertionIndex = range ? range.end + 1 : selectedIndex + 1;
  return endIndex !== -1 ? Math.min(insertionIndex, endIndex) : insertionIndex;
}

export type CommandMoveDirection = "up" | "down";

function getAdjacentCommandRanges(
  list: EventCommand[],
  index: number,
  direction: CommandMoveDirection,
): { selected: { start: number; end: number }; adjacent: { start: number; end: number } } | null {
  const selected = getCommandBlockRange(list, index);
  if (!selected || list[selected.start].code === 0) return null;
  const blocks = toVisualBlocks(list);
  const blockIndex = blocks.findIndex((block) => block.rawIndex === selected.start);
  if (blockIndex < 0) return null;
  const adjacentBlock = blocks[blockIndex + (direction === "up" ? -1 : 1)];
  if (!adjacentBlock || adjacentBlock.cmd.code === 0 || adjacentBlock.cmd.indent !== list[selected.start].indent) {
    return null;
  }
  const adjacent = getCommandBlockRange(list, adjacentBlock.rawIndex);
  return adjacent ? { selected, adjacent } : null;
}

export function canMoveCommandBlock(
  list: EventCommand[],
  index: number,
  direction: CommandMoveDirection,
): boolean {
  return getAdjacentCommandRanges(list, index, direction) !== null;
}

export function moveCommandBlock(
  list: EventCommand[],
  index: number,
  direction: CommandMoveDirection,
): { list: EventCommand[]; selectedIndex: number } | null {
  const ranges = getAdjacentCommandRanges(list, index, direction);
  if (!ranges) return null;
  const { selected, adjacent } = ranges;
  const selectedCommands = list.slice(selected.start, selected.end + 1);
  const adjacentCommands = list.slice(adjacent.start, adjacent.end + 1);

  if (direction === "up") {
    return {
      list: [
        ...list.slice(0, adjacent.start),
        ...selectedCommands,
        ...adjacentCommands,
        ...list.slice(selected.end + 1),
      ],
      selectedIndex: adjacent.start,
    };
  }

  return {
    list: [
      ...list.slice(0, selected.start),
      ...adjacentCommands,
      ...selectedCommands,
      ...list.slice(adjacent.end + 1),
    ],
    selectedIndex: adjacent.start,
  };
}

export function cloneCommandBlock(list: EventCommand[], index: number): EventCommand[] {
  const range = getCommandBlockRange(list, index);
  if (!range || list[range.start].code === 0) return [];
  return list.slice(range.start, range.end + 1).map((command) => {
    const copy = { ...command, parameters: structuredClone(command.parameters) };
    delete copy.source_index;
    return copy;
  });
}

/** Get default parameters for a new command */
export function getDefaultParams(code: number): unknown[] {
  switch (code) {
    case 101: return ["", 0, 0, 2];
    case 108: return [""];
    case 111: return [0, 1, 0]; // Conditional: Switch [1] == ON
    case 117: return [1]; // Call Common Event 1
    case 118: return ["label"]; // Label
    case 119: return ["label"]; // Jump to Label
    case 121: return [1, 1, 0]; // Control Switches: [1] = ON
    case 122: return [1, 1, 0, 0, 0]; // Control Variables
    case 123: return ["A", 0]; // Self Switch A = ON
    case 201: return [0, 1, 0, 0, 0]; // Transfer: Map 1 (0,0)
    case 241: return [{ __class: "RPG::AudioFile", name: "", volume: 100, pitch: 100 }];
    case 250: return [{ __class: "RPG::AudioFile", name: "", volume: 80, pitch: 100 }];
    case 355: return [""];
    default: return [];
  }
}

export function getCommandIcon(code: number): string {
  if (code === 0) return "";
  if (code === 108 || code === 408) return "//";
  if (code === 101 || code === 401) return "T";
  if (code === 102) return "?";
  if (code === 111 || code === 411 || code === 412) return "◇";
  if (code === 112 || code === 413) return "↻";
  if (code === 113 || code === 115) return "⏹";
  if (code === 121 || code === 122 || code === 123) return "=";
  if (code >= 201 && code <= 210) return "▶";
  if (code >= 221 && code <= 236) return "◐";
  if (code >= 241 && code <= 251) return "♪";
  if (code === 355 || code === 655) return "{}";
  if (code >= 301 && code <= 340) return "⚔";
  return "•";
}
