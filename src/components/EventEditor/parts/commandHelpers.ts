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

/** Select an entire balanced conditional or loop when its opening marker is
 * selected. A malformed structure is never modified. Nested structures and
 * Else markers are retained as part of the parent's subtree.
 */
export function getStructuralCommandRange(
  list: EventCommand[], index: number,
): { start: number; end: number } | null {
  const parent = list[index];
  if (!parent || (parent.code !== 111 && parent.code !== 112)) return null;
  // Track the exact opener depth and type. RMXP branch markers have their
  // own indentation; accepting merely matching code numbers can silently
  // transplant an incorrectly nested Else/End/Repeat into another event.
  const stack: { close: number; indent: number; elseSeen: boolean }[] = [
    { close: parent.code === 111 ? 412 : 413, indent: parent.indent, elseSeen: false },
  ];
  for (let i = index + 1; i < list.length; i++) {
    const cmd = list[i];
    const current = stack[stack.length - 1];
    if (cmd.indent < parent.indent) return null;
    if (cmd.code === 111 || cmd.code === 112) {
      if (cmd.indent !== current.indent + 1) return null;
      stack.push({ close: cmd.code === 111 ? 412 : 413, indent: cmd.indent, elseSeen: false });
    } else if (cmd.code === 411) {
      if (current.close !== 412 || current.elseSeen || cmd.indent !== current.indent) return null;
      current.elseSeen = true;
    } else if (cmd.code === 412 || cmd.code === 413) {
      if (current.close !== cmd.code || current.indent !== cmd.indent) return null;
      stack.pop();
      if (!stack.length) return { start: index, end: i };
    } else if (cmd.indent !== current.indent + 1) {
      // Every ordinary command and child-list terminator belongs exactly one
      // level below its current opener. Deeper jumps are malformed RMXP trees.
      return null;
    }
  }
  return null;
}

/** Add an Else arm to an existing complete RMXP conditional, without touching
 * the Then arm or reusing Marshal source indices. Reject nested/malformed
 * selections and existing Else arms rather than producing duplicate markers.
 */
export function addConditionalElseArm(
  list: EventCommand[], index: number,
): { list: EventCommand[]; selectedIndex: number } | null {
  if (list[index]?.code !== 111) return null;
  const range = getStructuralCommandRange(list, index);
  if (!range) return null;
  const depth = list[index].indent;
  let nestedDepth = 0;
  for (let i = index + 1; i < range.end; i++) {
    const code = list[i].code;
    if (code === 111 || code === 112) nestedDepth++;
    else if (code === 412 || code === 413) nestedDepth--;
    else if (code === 411 && nestedDepth === 0) return null;
  }
  const close = range.end;
  const insertion: EventCommand[] = [
    { code: 411, indent: depth, parameters: [] },
    { code: 0, indent: depth + 1, parameters: [] },
  ];
  return {
    list: [...list.slice(0, close), ...insertion, ...list.slice(close)],
    selectedIndex: close,
  };
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

export function getCommandInsertionIndex(list: EventCommand[], selectedIndex: number): number {
  // RMXP uses code 0 inside nested branches as well as at the end of a page.
  // Only the final top-level terminator bounds insertion; the first code 0
  // can occur halfway through a valid conditional/loop script.
  const last = list.length - 1;
  const endIndex = last >= 0 && list[last].code === 0 && list[last].indent === 0
    ? last : -1;
  if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= list.length) {
    return endIndex === -1 ? list.length : endIndex;
  }
  if (list[selectedIndex].code === 0) return selectedIndex;
  // Insert after the entire balanced subtree, never between its opener and
  // child list. A malformed opener remains non-editable until repaired.
  const range = getStructuralCommandRange(list, selectedIndex) ?? getCommandBlockRange(list, selectedIndex);
  const insertionIndex = range ? range.end + 1 : selectedIndex + 1;
  return endIndex !== -1 ? Math.min(insertionIndex, endIndex) : insertionIndex;
}

export type CommandMoveDirection = "up" | "down";

/** Move only complete sibling statements. Structural openers own their balanced
 * subtree; nested child commands cannot be moved across Else/End boundaries.
 * This preserves RMXP branch and loop control flow without rewriting markers.
 */
function getAdjacentCommandRanges(
  list: EventCommand[],
  index: number,
  direction: CommandMoveDirection,
): { selected: { start: number; end: number }; adjacent: { start: number; end: number } } | null {
  const selected = getEditableCommandRange(list, index);
  if (!selected) return null;
  const depth = list[selected.start].indent;
  const structural = list[selected.start].code === 111 || list[selected.start].code === 112;
  if (structural && !getStructuralCommandRange(list, selected.start)) return null;

  if (direction === "down") {
    const start = selected.end + 1;
    if (start >= list.length || list[start].indent !== depth) return null;
    const adjacent = getEditableCommandRange(list, start);
    if (!adjacent || adjacent.start !== start || list[adjacent.start].indent !== depth) return null;
    return { selected, adjacent };
  }

  // Find the preceding statement ending exactly where the selected one starts.
  // A nested child or structural closing marker cannot be treated as a sibling.
  for (let start = selected.start - 1; start >= 0; start--) {
    if (list[start].indent < depth) break;
    if (list[start].indent !== depth) continue;
    const adjacent = getEditableCommandRange(list, start);
    if (adjacent?.start === start && adjacent.end === selected.start - 1) {
      return { selected, adjacent };
    }
  }
  return null;
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
    selectedIndex: selected.start + adjacentCommands.length,
  };
}

export function cloneCommandBlock(list: EventCommand[], index: number): EventCommand[] {
  const range = getEditableCommandRange(list, index);
  if (!range) return [];
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

/** Paste a copied visual block at the destination indentation without sharing
 * mutable parameter objects or stale source Marshal indices with its origin.
 * Preserve relative indentation inside the copied block.
 */
export function prepareCommandBlockPaste(block: EventCommand[], destinationIndent: number): EventCommand[] {
  if (!block.length || !Number.isInteger(destinationIndent) || destinationIndent < 0) return [];
  const baseIndent = block[0].indent;
  if (!Number.isInteger(baseIndent) || baseIndent < 0) return [];
  if (block.some((cmd) => !Number.isInteger(cmd.indent) || cmd.indent < baseIndent)) return [];
  return block.map((cmd) => {
    const copy = { ...cmd, indent: destinationIndent + cmd.indent - baseIndent, parameters: structuredClone(cmd.parameters) };
    delete copy.source_index;
    return copy;
  });
}

/** Cut an entire RMXP visual block, never an isolated continuation or terminator.
 * Returns null without mutating the list for invalid indices.
 */
export function cutCommandBlock(
  list: EventCommand[], index: number,
): { list: EventCommand[]; clipboard: EventCommand[]; selectedIndex: number } | null {
  const range = getEditableCommandRange(list, index);
  if (!range) return null;
  const clipboard = cloneCommandBlock(list, range.start);
  if (!clipboard.length) return null;
  return {
    list: [...list.slice(0, range.start), ...list.slice(range.end + 1)],
    clipboard,
    selectedIndex: Math.max(0, range.start - 1),
  };
}

/** Construct a fresh command for an event page. Command picker definitions are
 * shared across editor instances; never hand their parameter objects directly
 * to a mutable event list. RMXP continuation commands are owned by parents.
 */
export function createEventCommand(
  code: number, indent: number, defaultParams?: unknown[],
): EventCommand | null {
  if (!Number.isInteger(code) || code <= 0 || !Number.isInteger(indent) || indent < 0) return null;
  if ((STRUCTURAL_EVENT_CODES.has(code) && code !== 111 && code !== 112) || code === 401 || code === 408 || code === 655) return null;
  return {
    code,
    indent,
    parameters: structuredClone(defaultParams ?? getDefaultParams(code)),
  };
}

/** Insertion at the final page terminator always uses top-level indentation.
 * Selecting a nested code-zero marker inserts before that marker at its depth.
 */
export function getCommandInsertionIndent(list: EventCommand[], selectedIndex: number): number {
  const index = getCommandInsertionIndex(list, selectedIndex);
  const last = list.length - 1;
  if (index === last && list[last]?.code === 0 && list[last].indent === 0) return 0;
  if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= list.length) return 0;
  return list[selectedIndex].indent;
}

/** RMXP branch/loop markers are structural, not independent visual commands.
 * Reject edits that would leave orphaned Else/End/Repeat or branch bodies.
 * A future tree-aware editor can replace this guard with whole-structure edits.
 */
export const STRUCTURAL_EVENT_CODES = new Set([0, 111, 112, 411, 412, 413]);

export function deleteEditableCommandBlock(
  list: EventCommand[], index: number,
): { list: EventCommand[]; selectedIndex: number } | null {
  const range = getEditableCommandRange(list, index);
  if (!range) return null;
  return {
    list: [...list.slice(0, range.start), ...list.slice(range.end + 1)],
    selectedIndex: Math.max(0, range.start - 1),
  };
}

/** Construct a balanced RMXP conditional or loop at insertion time.
 * The nested code-zero command closes the child list, while 412/413 closes
 * the outer control-flow construct. Orphan markers are never offered alone.
 */
export function createEventCommandInsertion(
  code: number, indent: number, defaultParams?: unknown[],
): EventCommand[] {
  if ([0, 411, 412, 413].includes(code)) return [];
  const parent = createEventCommand(code, indent, defaultParams);
  if (!parent) return [];
  if (code !== 111 && code !== 112) return [parent];
  return [
    parent,
    { code: 0, indent: indent + 1, parameters: [] },
    { code: code === 111 ? 412 : 413, indent, parameters: [] },
  ];
}
