import test from 'node:test';
import assert from 'node:assert/strict';
import { replaceMultiLineBlock } from '../src/services/eventMultiLineEdit.ts';

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
