import test from 'node:test';
import assert from 'node:assert/strict';
import { findEditableShowText, findProjectShowText, mapTreeAncestors, expectedDialogueEdit } from '../scripts/private-browser-event-probe.mjs';

const fixture = {
  id: 7, name: 'Synthetic', pages: [
    { list: [{ code: 101, indent: 0, parameters: ['Original'] },
      { code: 401, indent: 0, parameters: ['Continuation'] },
      { code: 0, indent: 0, parameters: [] }], condition: { switch1_valid: true } },
  ], unknown_metadata: { preserve: true },
};

test('finds existing multi-line Show Text and does not modify original', async () => {
  const before = structuredClone(fixture);
  const selection = await findEditableShowText([
    { id: 8, x: 1, y: 1 }, { id: 7, x: 3, y: 2 },
  ], async id => id === 7 ? fixture : { pages: [{ list: [{ code: 355, parameters: ['script'] }] }] });
  assert.equal(selection.eventId, 7);
  assert.equal(selection.pageIndex, 0);
  assert.equal(selection.commandIndex, 0);
  assert.equal(selection.hasContinuation, true);
  const edited = expectedDialogueEdit(selection.event, 0, 0, 'React probe');
  assert.equal(edited.pages[0].list[0].parameters[0], 'React probe');
  assert.equal(edited.pages[0].list[1].parameters[0], 'Continuation');
  assert.deepEqual(fixture, before);
  assert.deepEqual(edited.unknown_metadata, fixture.unknown_metadata);
});

test('supports later event pages and single-line text', async () => {
  const selection = await findEditableShowText([{ id: 2, x: 0, y: 0 }], async () => ({
    pages: [{ list: [{ code: 0, parameters: [] }] },
      { list: [{ code: 101, parameters: ['Second page'] }] }],
  }));
  assert.equal(selection.pageIndex, 1);
  assert.equal(selection.hasContinuation, false);
});

test('returns null when no existing dialogue and respects bounded event scan', async () => {
  const seen = [];
  const result = await findEditableShowText([{ id: 1, x: 0, y: 0 }, { id: 2, x: 1, y: 1 }],
    async id => { seen.push(id); return id === 2 ? fixture : { pages: [] }; }, 1);
  assert.equal(result, null);
  assert.deepEqual(seen, [1]);
});

test('rejects unsafe selection and invalid replacement without mutation', async () => {
  await assert.rejects(() => findEditableShowText(null, async () => {}), TypeError);
  assert.throws(() => expectedDialogueEdit(fixture, 0, 0, 'bad\nline'), TypeError);
  assert.throws(() => expectedDialogueEdit(fixture, 0, 2, 'valid'), TypeError);
  assert.equal(fixture.pages[0].list[0].parameters[0], 'Original');
});

test('searches other real maps when initial map has no dialogue, without modifying any map', async () => {
  const project = { edit_map_id: 1, map_infos: { 1: {}, 2: {}, 3: {} } };
  const loaded = [];
  const maps = {
    1: { width: 5, height: 5, events: [{ id: 4, x: 0, y: 0 }] },
    2: { width: 6, height: 6, events: [{ id: 7, x: 3, y: 2 }] },
    3: { width: 5, height: 5, events: [{ id: 8, x: 0, y: 0 }] },
  };
  const before = structuredClone(maps);
  const probe = await findProjectShowText(project,
    async id => { loaded.push(id); return maps[id]; },
    async (mapId, id) => mapId === 2 && id === 7 ? fixture : { pages: [] });
  assert.equal(probe.mapId, 2);
  assert.equal(probe.eventId, 7);
  assert.deepEqual(loaded, [1, 2]);
  assert.deepEqual(maps, before);
});

test('prioritises project start map and ignores out-of-bounds events', async () => {
  const project = { edit_map_id: 3, map_infos: { 1: {}, 2: {}, 3: {} } };
  const calls = [];
  const probe = await findProjectShowText(project,
    async id => { calls.push(id); return { width: 4, height: 4, events: [
      { id: 8, x: 500, y: 1 }, { id: 7, x: 1, y: 2 },
    ] }; },
    async (_, id) => { assert.equal(id, 7); return fixture; });
  assert.equal(probe.mapId, 3);
  assert.deepEqual(calls, [3]);
});

test('returns null within map budget and fails closed on malformed native maps', async () => {
  const project = { edit_map_id: 1, map_infos: { 1: {}, 2: {} } };
  const visited = [];
  const none = await findProjectShowText(project, async id => {
    visited.push(id); return { width: 5, height: 5, events: [] };
  }, async () => { throw Error('must not read events'); }, 1);
  assert.equal(none, null);
  assert.deepEqual(visited, [1]);
  await assert.rejects(() => findProjectShowText(project, async () => ({ events: [] }), async () => {}), TypeError);
  await assert.rejects(() => findProjectShowText(project, async () => ({}), async () => {}, 0), TypeError);
});

test('map-tree navigation expands root-to-parent and rejects missing/cyclic MapInfos', () => {
  const infos = { 1: { parent_id: 0 }, 2: { parent_id: 1 }, 3: { parent_id: 2 } };
  assert.deepEqual(mapTreeAncestors(infos, 3), [1, 2]);
  assert.deepEqual(mapTreeAncestors(infos, 1), []);
  assert.throws(() => mapTreeAncestors({ 1: { parent_id: 2 } }, 1), TypeError);
  assert.throws(() => mapTreeAncestors({ 1: { parent_id: 2 }, 2: { parent_id: 1 } }, 1), TypeError);
  assert.throws(() => mapTreeAncestors(infos, 99), TypeError);
});
