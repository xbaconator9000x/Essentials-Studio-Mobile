import assert from 'node:assert/strict';
import test from 'node:test';
import {
  serializeProjectOperation,
  shouldSerializeProjectCommand,
} from '../src/services/projectMutationQueue.ts';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test('all map/event/script/PBS mutations and ZIP creation use the same project queue', () => {
  const commands = [
    'save_map', 'save_event', 'create_event', 'delete_event',
    'save_map_properties', 'create_map', 'delete_map', 'rename_map',
    'save_all_scripts', 'create_script', 'delete_script', 'save_database',
    'save_system', 'save_pbs_file', 'write_raw_pbs_file',
    'save_private_project_sprite',
    'import_private_project_sprite',
    'begin_project_archive_export', 'export_browser_project_archive',
  ];
  for (const command of commands) {
    assert.equal(shouldSerializeProjectCommand(command, { projectPath: '/project' }), true, command);
    assert.equal(shouldSerializeProjectCommand(command, { projectPath: '' }), false, command);
  }
  for (const command of ['load_map', 'load_event', 'open_project', 'save_project_archive_to_document']) {
    assert.equal(shouldSerializeProjectCommand(command, { projectPath: '/project' }), false, command);
  }
});

test('direct event writes wait for map writes and ZIP creation waits for both', async () => {
  const first = deferred();
  const order = [];
  const map = serializeProjectOperation('/shared-map', async () => {
    order.push('map:start');
    await first.promise;
    order.push('map:end');
  });
  const event = serializeProjectOperation('/shared-map', async () => {
    order.push('event:start');
    await Promise.resolve();
    order.push('event:end');
  });
  const zip = serializeProjectOperation('/shared-map', async () => {
    order.push('zip:snapshot');
  });
  await Promise.resolve();
  assert.deepEqual(order, ['map:start']);
  first.resolve();
  await Promise.all([map, event, zip]);
  assert.deepEqual(order, ['map:start', 'map:end', 'event:start', 'event:end', 'zip:snapshot']);
});

test('different projects are not globally serialized', async () => {
  const hold = deferred();
  const slow = serializeProjectOperation('/project-a', async () => {
    await hold.promise;
  });
  const fast = serializeProjectOperation('/project-b', async () => 'ready');
  assert.equal(await fast, 'ready');
  hold.resolve();
  await slow;
});

test('a rejected write does not poison later writes or ZIP snapshot', async () => {
  const failed = serializeProjectOperation('/recover', async () => {
    throw new Error('disk full');
  });
  const next = serializeProjectOperation('/recover', async () => 42);
  await assert.rejects(failed, /disk full/);
  assert.equal(await next, 42);
  assert.equal(await serializeProjectOperation('/recover', async () => 'snapshot'), 'snapshot');
});
