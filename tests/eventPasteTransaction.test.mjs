import assert from 'node:assert/strict';
import test from 'node:test';
import { pasteEventInProjectQueue } from '../src/services/eventPasteTransaction.ts';
import { serializeProjectOperation } from '../src/services/projectMutationQueue.ts';

function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}

const source = { id: 7, x: 2, y: 3, pages: [{ commands: ['dialogue'] }] };

test('map write, clipboard paste and ZIP snapshot are one ordered project stream', async () => {
  const hold = deferred();
  const order = [];
  const map = serializeProjectOperation('/paste-project', async () => {
    order.push('map:start');
    await hold.promise;
    order.push('map:end');
  });
  const paste = pasteEventInProjectQueue('/paste-project', source, 9, 10, {
    create: async () => {
      order.push('create');
      return [{ id: 44, x: 9, y: 10 }, [{ id: 44 }]];
    },
    save: async event => {
      order.push('save');
      assert.equal(event.id, 44);
      assert.equal(event.x, 9);
      assert.equal(event.y, 10);
      assert.deepEqual(event.pages, source.pages);
    },
    rollback: async () => { throw new Error('rollback should not run'); },
  });
  const zip = serializeProjectOperation('/paste-project', async () => {
    order.push('zip');
  });
  await Promise.resolve();
  assert.deepEqual(order, ['map:start']);
  hold.resolve();
  const [, [pasted, infos]] = await Promise.all([map, paste, zip]).then(
    ([mapResult, pasteResult]) => [mapResult, pasteResult],
  );
  assert.deepEqual(order, ['map:start', 'map:end', 'create', 'save', 'zip']);
  assert.equal(pasted.id, 44);
  assert.equal(infos[0].id, 44);
  assert.equal(source.id, 7, 'clipboard source must not be mutated');
});

test('failed event write removes placeholder and later project operations can continue', async () => {
  const order = [];
  const paste = pasteEventInProjectQueue('/rollback-project', source, 1, 1, {
    create: async () => { order.push('create'); return [{ id: 45, x: 1, y: 1 }, []]; },
    save: async () => { order.push('save'); throw new Error('disk full'); },
    rollback: async id => { order.push('rollback:' + id); },
  });
  await assert.rejects(paste, /disk full/);
  assert.deepEqual(order, ['create', 'save', 'rollback:45']);
  const result = await serializeProjectOperation('/rollback-project', async () => 'next-save');
  assert.equal(result, 'next-save');
});

test('rollback failure is explicit and cannot be reported as successful paste', async () => {
  await assert.rejects(
    pasteEventInProjectQueue('/rollback-failure', source, 1, 1, {
      create: async () => [{ id: 46, x: 1, y: 1 }, []],
      save: async () => { throw new Error('write failed'); },
      rollback: async () => { throw new Error('cleanup failed'); },
    }),
    /rollback also failed/,
  );
});

test('missing project root fails closed before any native writes', async () => {
  let called = false;
  await assert.rejects(
    pasteEventInProjectQueue('', source, 1, 1, {
      create: async () => { called = true; return [{ id: 1, x: 1, y: 1 }, []]; },
      save: async () => {},
      rollback: async () => {},
    }),
    /active project/,
  );
  assert.equal(called, false);
});
