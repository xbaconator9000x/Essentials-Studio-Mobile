import type { EventPage } from "../types";

export function updateEventCommandParam(
  page: EventPage,
  commandIndex: number,
  paramIndex: number,
  value: unknown,
): EventPage {
  const command = page.list[commandIndex];
  if (
    !command ||
    !Number.isInteger(commandIndex) ||
    commandIndex < 0 ||
    !Number.isInteger(paramIndex) ||
    paramIndex < 0 ||
    paramIndex >= command.parameters.length
  ) {
    throw new TypeError("Invalid event command parameter edit");
  }
  const list = [...page.list];
  const updated = { ...command, parameters: [...command.parameters] };
  updated.parameters[paramIndex] = value;
  list[commandIndex] = updated;
  return { ...page, list };
}
