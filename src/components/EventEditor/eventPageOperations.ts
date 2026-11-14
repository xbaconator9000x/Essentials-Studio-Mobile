import type { EventPage } from "../../types";

/** RMXP event pages are ordered by priority: the last matching page wins.
 * Reordering must preserve each page's full command list, conditions and routes.
 */
export function duplicateEventPage(pages: EventPage[], index: number): EventPage[] {
  if (!Number.isInteger(index) || index < 0 || index >= pages.length) return pages;
  const result = [...pages];
  result.splice(index + 1, 0, structuredClone(pages[index]));
  return result;
}

export function moveEventPage(
  pages: EventPage[], index: number, direction: -1 | 1,
): EventPage[] {
  const destination = index + direction;
  if (!Number.isInteger(index) || index < 0 || destination < 0 || destination >= pages.length) return pages;
  const result = [...pages];
  [result[index], result[destination]] = [result[destination], result[index]];
  return result;
}
