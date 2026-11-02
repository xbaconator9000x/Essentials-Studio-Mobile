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

/** A full real project may start on a map without dialogue. Find an existing
 * editable event on another map, bounded by actual MapInfos and map dimensions.
 * The caller must navigate the React map tree to the returned map before editing.
 */
export async function findProjectShowText(project, loadMap, loadEvent, maxMaps = 256) {
  if (!project?.map_infos || typeof project.map_infos !== 'object' ||
      typeof loadMap !== 'function' || typeof loadEvent !== 'function' ||
      !Number.isInteger(maxMaps) || maxMaps < 1) {
    throw new TypeError('Invalid project dialogue probe inputs');
  }
  const ids = Object.keys(project.map_infos).map(Number)
    .filter(id => Number.isInteger(id) && id >= 1 && id <= 999)
    .sort((a, b) => a - b);
  const preferred = Number(project.edit_map_id);
  if (ids.includes(preferred)) {
    ids.splice(ids.indexOf(preferred), 1);
    ids.unshift(preferred);
  }
  for (const mapId of ids.slice(0, maxMaps)) {
    const map = await loadMap(mapId);
    if (!Number.isInteger(map?.width) || map.width < 1 ||
        !Number.isInteger(map?.height) || map.height < 1 || !Array.isArray(map.events)) {
      throw new TypeError('Native map data is invalid during dialogue selection');
    }
    const inBounds = map.events.filter(event => event.x < map.width && event.y < map.height);
    if (inBounds.length === 0) continue;
    const probe = await findEditableShowText(inBounds, eventId => loadEvent(mapId, eventId));
    if (probe) return { mapId, map, ...probe };
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
