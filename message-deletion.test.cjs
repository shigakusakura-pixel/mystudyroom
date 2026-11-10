const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const moduleUrl = 'data:text/javascript,' + encodeURIComponent(fs.readFileSync(path.join(__dirname, 'message-deletion.js'), 'utf8'));
const load = () => import(moduleUrl);
const failure = code => Object.assign(new Error(code), { code });

function setup(overrides = {}) {
  const calls = [];
  const operations = {
    requirePdfAuth: async () => { calls.push('auth'); },
    deletePdf: async () => { calls.push('pdf'); },
    getPdfMetadata: async () => { calls.push('verify'); throw failure('storage/object-not-found'); },
    deleteMessage: async id => { calls.push('message:' + id); },
    ...overrides
  };
  return { operations, calls };
}
const message = { id: 'message-1', pdfUrl: 'fixture-pdf' };

test('removes the message only after confirming attachment absence', async () => {
  const { deleteMessageWithPdf } = await load();
  const { operations, calls } = setup();
  assert.deepEqual(await deleteMessageWithPdf(message, operations), { pdfDeleted: true });
  assert.deepEqual(calls, ['auth', 'pdf', 'verify', 'message:message-1']);
});

test('keeps the message on authentication failure', async () => {
  const { deleteMessageWithPdf } = await load();
  const { operations, calls } = setup({ requirePdfAuth: async () => { throw failure('storage/unauthenticated'); } });
  await assert.rejects(deleteMessageWithPdf(message, operations), { code: 'storage/unauthenticated', stage: 'pdf', pdfDeleted: false });
  assert.deepEqual(calls, []);
});

for (const code of ['storage/unauthorized', 'storage/retry-limit-exceeded', 'storage/unknown']) {
  test('keeps the message when PDF deletion fails: ' + code, async () => {
    const { deleteMessageWithPdf } = await load();
    const { operations, calls } = setup({ deletePdf: async () => { throw failure(code); } });
    await assert.rejects(deleteMessageWithPdf(message, operations), { code, stage: 'pdf', pdfDeleted: false });
    assert.deepEqual(calls, ['auth']);
  });
}

test('keeps the message when the PDF is still found', async () => {
  const { deleteMessageWithPdf } = await load();
  const { operations, calls } = setup({ getPdfMetadata: async () => { calls.push('verify'); return { name: 'still-present.pdf' }; } });
  await assert.rejects(deleteMessageWithPdf(message, operations), { code: 'storage/delete-unconfirmed', stage: 'verification' });
  assert.deepEqual(calls, ['auth', 'pdf', 'verify']);
});

test('does not mistake verification permission errors for absence', async () => {
  const { deleteMessageWithPdf } = await load();
  const { operations, calls } = setup({ getPdfMetadata: async () => { throw failure('storage/unauthorized'); } });
  await assert.rejects(deleteMessageWithPdf(message, operations), { code: 'storage/unauthorized', stage: 'verification' });
  assert.deepEqual(calls, ['auth', 'pdf']);
});

test('retries safely when an earlier attempt already removed the PDF', async () => {
  const { deleteMessageWithPdf } = await load();
  const { operations, calls } = setup({ deletePdf: async () => { calls.push('pdf'); throw failure('storage/object-not-found'); } });
  await deleteMessageWithPdf(message, operations);
  assert.deepEqual(calls, ['auth', 'pdf', 'verify', 'message:message-1']);
});

test('reports partial completion and permits a retry after message deletion fails', async () => {
  const { deleteMessageWithPdf } = await load();
  const { operations, calls } = setup({ deleteMessage: async () => { throw failure('permission-denied'); } });
  await assert.rejects(deleteMessageWithPdf(message, operations), { code: 'permission-denied', stage: 'message', pdfDeleted: true });
  assert.deepEqual(calls, ['auth', 'pdf', 'verify']);
  operations.deletePdf = async () => { throw failure('storage/object-not-found'); };
  operations.deleteMessage = async id => { calls.push('retry:' + id); };
  await deleteMessageWithPdf(message, operations);
  assert.equal(calls.at(-1), 'retry:message-1');
});

test('deletes a text-only message without accessing Storage', async () => {
  const { deleteMessageWithPdf } = await load();
  const { operations, calls } = setup();
  assert.deepEqual(await deleteMessageWithPdf({ id: 'text-only' }, operations), { pdfDeleted: false });
  assert.deepEqual(calls, ['message:text-only']);
});
