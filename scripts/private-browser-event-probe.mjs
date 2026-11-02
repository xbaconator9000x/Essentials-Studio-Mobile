/** Select an existing RMXP Show Text command without fabricating game events.
 * Pure selection/expected-state helpers shared by private and synthetic UI tests.
 */
export async function findEditableShowText(eventInfos, loadEvent, maxEvents = 256) {
  if (!Array.isArray(eventInfos) || typeof loadEvent !== 'function' ||
      !Number.isInteger(maxEvents) || maxEvents < 1) {
    throw new TypeError('Invalid event probe inputs');
  }
  const candidates = eventInfos.filter(info => Number.isInteger(info?.id) && info.id > 0 &&
    Number.isInteger(info.x) && info.x >= 0 && Number.isInteger(info.y) && info.y >= 0)
    .sort((a, b) => (a.x + a.y) - (b.x + b.y) || a.id - b.id);
  for (const info of candidates.slice(0, maxEvents)) {
    const event = await loadEvent(info.id);
    if (!Array.isArray(event?.pages)) continue;
    for (let pageIndex = 0; pageIndex < event.pages.length; pageIndex++) {
      const list = event.pages[pageIndex]?.list;
      if (!Array.isArray(list)) continue;
      const commandIndex = list.findIndex(command => command?.code === 101 &&
        typeof command.parameters?.[0] === 'string');
      if (commandIndex >= 0) {
        return {
          eventId: info.id, x: info.x, y: info.y, pageIndex, commandIndex,
          hasContinuation: list[commandIndex + 1]?.code === 401,
          event,
        };
      }
    }
  }
  return null;
}

export function expectedDialogueEdit(event, pageIndex, commandIndex, replacement) {
  if (typeof replacement !== 'string' || !replacement || replacement.includes('\n')) {
    throw new TypeError('Replacement must be one nonempty dialogue line');
  }
  const copy = structuredClone(event);
  const command = copy?.pages?.[pageIndex]?.list?.[commandIndex];
  if (command?.code !== 101 || typeof command.parameters?.[0] !== 'string') {
    throw new TypeError('Selected command is not an editable Show Text line');
  }
  command.parameters[0] = replacement;
  return copy;
}
