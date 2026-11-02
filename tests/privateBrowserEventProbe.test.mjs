import test from 'node:test';
import assert from 'node:assert/strict';
import { findEditableShowText, expectedDialogueEdit } from '../scripts/private-browser-event-probe.mjs';

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
