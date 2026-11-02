import type { EventCommand } from '../types';

/**
 * Change a Show Text/Comment/Script multi-line block without discarding
 * opaque fields on existing RMXP event commands or trailing parameters.
 * Newly inserted continuation lines receive the minimal XP command shape.
 */
export function replaceMultiLineBlock(
  list: EventCommand[],
  rawIndex: number,
  lines: string[],
  continuationCode: number,
): EventCommand[] {
  if (!Array.isArray(list) || !Number.isInteger(rawIndex) || rawIndex < 0 ||
      !Array.isArray(lines) || lines.length === 0 || lines.some(line => typeof line !== 'string') ||
      !Number.isInteger(continuationCode)) {
    throw new TypeError('Invalid multi-line event edit');
  }
  const parent = list[rawIndex];
  if (!parent || parent.code === 0 || !Array.isArray(parent.parameters)) {
    throw new TypeError('Missing multi-line parent command');
  }
  let end = rawIndex + 1;
  // Do not absorb a nested or unrelated same-code command. RMXP command\n  // indentation is part of the original event structure.\n  while (end < list.length && list[end].code === continuationCode &&\n         list[end].indent === parent.indent) end++;
  const previous = list.slice(rawIndex, end);
  const updated: EventCommand[] = lines.map((line, index) => {
    const old = previous[index];
    return {
      ...(old ?? {}),
      code: index === 0 ? parent.code : continuationCode,
      indent: old?.indent ?? parent.indent,
      parameters: [line, ...(old?.parameters?.slice(1) ?? [])],
    };
  });
  return [...list.slice(0, rawIndex), ...updated, ...list.slice(end)];
}
