import test from 'node:test';
import assert from 'node:assert/strict';
import { replaceMultiLineBlock } from '../src/services/eventMultiLineEdit.ts';
import { toVisualBlocks, getBlockEnd } from '../src/components/EventEditor/parts/commandHelpers.ts';

const commands = () => [
  { code: 111, indent: 0, parameters: [1], unknown: 'before' },
  { code: 101, indent: 1, parameters: ['Old', 'opaque-parent'], __raw: { retain: true } },
  { code: 401, indent: 1, parameters: ['Continuation', 'opaque-child'], __extra: [4, 5] },
  { code: 0, indent: 0, parameters: [], unknown: 'after' },
];

test('editing first line preserves every unrelated field and continuation', () => {
  const original = commands();
  const expected = structuredClone(original);
  expected[1].parameters[0] = 'Edited';
  assert.deepEqual(replaceMultiLineBlock(original, 1, ['Edited', 'Continuation'], 401), expected);
  assert.equal(original[1].parameters[0], 'Old');
});

test('appending a continuation preserves existing command metadata', () => {
  const output = replaceMultiLineBlock(commands(), 1, ['Edited', 'Continuation', 'New'], 401);
  assert.equal(output.length, 5);
  assert.deepEqual(output[2].__extra, [4, 5]);
  assert.deepEqual(output[3], { code: 401, indent: 1, parameters: ['New'] });
  assert.equal(output[4].unknown, 'after');
});

test('removing continuation deletes only that command', () => {
  const output = replaceMultiLineBlock(commands(), 1, ['Edited'], 401);
  assert.equal(output.length, 3);
  assert.deepEqual(output[1].__raw, { retain: true });
  assert.equal(output[2].unknown, 'after');
});

test('invalid edits fail closed', () => {
  assert.throws(() => replaceMultiLineBlock(commands(), 9, ['x'], 401), TypeError);
  assert.throws(() => replaceMultiLineBlock(commands(), 1, [], 401), TypeError);
  assert.throws(() => replaceMultiLineBlock(commands(), 1, ['x', 3], 401), TypeError);
  assert.throws(() => replaceMultiLineBlock(commands(), 3, ['x'], 401), TypeError);
});

test('same-code continuation at a different RMXP indent remains independent', () => {
  const original = [
    { code: 101, indent: 0, parameters: ['First'], opaque: { parent: true } },
    { code: 401, indent: 0, parameters: ['Continuation'], opaque: { sameDepth: true } },
    { code: 401, indent: 1, parameters: ['Nested or malformed continuation'], opaque: { preserve: true } },
    { code: 111, indent: 1, parameters: [1], opaque: { after: true } },
  ];
  const blocks = toVisualBlocks(original);
  assert.equal(blocks[0].kind, 'multi');
  assert.deepEqual(blocks[0].contIndices, [1]);
  assert.equal(blocks[1].kind, 'single');
  assert.equal(blocks[1].rawIndex, 2);
  assert.equal(getBlockEnd(original, 0), 1);
  const edited = replaceMultiLineBlock(original, 0, ['Edited', 'Continuation'], 401);
  assert.deepEqual(edited.slice(2), original.slice(2));
  assert.equal(edited[0].parameters[0], 'Edited');
  assert.deepEqual(edited[0].opaque, original[0].opaque);
  assert.equal(original[0].parameters[0], 'First');
});

test('insert/delete block boundaries respect indentation for text, comment and script', () => {
  for (const [parentCode, continuationCode] of [[101, 401], [108, 408], [355, 655]]) {
    const commands = [
      { code: parentCode, indent: 2, parameters: ['Original'] },
      { code: continuationCode, indent: 2, parameters: ['Same level'], metadata: 'retain' },
      { code: continuationCode, indent: 3, parameters: ['Different level'], metadata: 'untouched' },
      { code: 0, indent: 0, parameters: [] },
    ];
    assert.equal(getBlockEnd(commands, 0), 1);
    const edited = replaceMultiLineBlock(commands, 0, ['Updated'], continuationCode);
    assert.equal(edited.length, 3);
    assert.deepEqual(edited[1], commands[2]);
    assert.deepEqual(edited[2], commands[3]);
  }
});
