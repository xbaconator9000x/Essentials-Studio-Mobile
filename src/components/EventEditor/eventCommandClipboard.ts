import type { EventCommand } from "../../types";
import { prepareCommandBlockPaste } from "./parts/commandHelpers";

/** In-memory, project-scoped event clipboard. EventEditor is unmounted whenever
 * its modal closes, so component state alone cannot support cross-event paste.
 * Never persist RMXP commands to localStorage or leak them into another project.
 */
let clipboard: { projectPath: string; commands: EventCommand[] } | null = null;

export function setEventCommandClipboard(projectPath: string, commands: EventCommand[]): void {
  clipboard = projectPath && commands.length
    ? { projectPath, commands: prepareCommandBlockPaste(commands, commands[0].indent) }
    : null;
}

export function getEventCommandClipboard(projectPath: string): EventCommand[] {
  if (!clipboard || clipboard.projectPath !== projectPath) return [];
  return prepareCommandBlockPaste(clipboard.commands, clipboard.commands[0].indent);
}

export function clearEventCommandClipboard(): void {
  clipboard = null;
}
