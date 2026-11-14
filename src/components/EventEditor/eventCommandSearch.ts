import type { EventCommand, MapInfo } from "../../types";
import { getCommandDef, summarizeCommand } from "../../services/eventCommands";
import { getBlockEnd, toVisualBlocks } from "./parts/commandHelpers";

export function findEventCommandMatches(
  list: EventCommand[], query: string,
  mapInfos?: Record<number, MapInfo>,
  switchNames?: string[], variableNames?: string[],
): number[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  return toVisualBlocks(list).filter((block) => {
    const cmd = block.cmd;
    const summary = summarizeCommand(cmd.code, cmd.parameters, mapInfos, switchNames, variableNames);
    const parameters = block.kind === "multi"
      ? list.slice(block.rawIndex, getBlockEnd(list, block.rawIndex) + 1)
        .flatMap((item) => item.parameters.map(String)).join(" ")
      : cmd.parameters.map(String).join(" ");
    return [getCommandDef(cmd.code).name, summary, parameters, String(cmd.code)]
      .some((part) => part.toLocaleLowerCase().includes(needle));
  }).map((block) => block.rawIndex);
}

export function nextEventCommandMatch(matches: number[], selected: number, direction: -1 | 1): number {
  if (!matches.length) return -1;
  return direction === 1
    ? matches.find((index) => index > selected) ?? matches[0]
    : [...matches].reverse().find((index) => index < selected) ?? matches[matches.length - 1];
}
