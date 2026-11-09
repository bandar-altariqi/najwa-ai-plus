// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { createCheckpoints } = require('../src/agent/checkpoints');

const tmp = (name) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `najwa-cpsync-${name}-`)));

test('checkpoints travel with the chat: another computer can undo', () => {
  // Computer A: the agent changes two files.
  const rootA = tmp('a');
  fs.writeFileSync(path.join(rootA, 'a.txt'), 'one\n');
  const cpA = createCheckpoints(tmp('a-cps'));
  let c = cpA.begin('chat1', rootA, 'Edit a.txt');
  c.keep(path.join(rootA, 'a.txt'), 'a.txt');
  fs.writeFileSync(path.join(rootA, 'a.txt'), 'two\n');
  c.done();
  c = cpA.begin('chat1', rootA, 'Create b.txt');
  c.keep(path.join(rootA, 'b.txt'), 'b.txt');
  fs.writeFileSync(path.join(rootA, 'b.txt'), 'new\n');
  c.done();
  const packed = cpA.exportFor('chat1');
  assert.ok(packed.length > 0 && packed.length < 256 * 1024);
  assert.strictEqual(createCheckpoints(tmp('none')).exportFor('nothing'), '');

  // Computer B: the same project, somewhere else, no history of its own.
  const rootB = tmp('b');
  fs.writeFileSync(path.join(rootB, 'a.txt'), 'two\n');
  fs.writeFileSync(path.join(rootB, 'b.txt'), 'new\n');
  const cpB = createCheckpoints(tmp('b-cps'));
  assert.strictEqual(cpB.importFrom('chat1', packed, rootB), 2);
  assert.deepStrictEqual(cpB.list('chat1').map((e) => [e.label, e.root]), [['Create b.txt', rootB], ['Edit a.txt', rootB]]);
  cpB.undo('chat1');
  assert.ok(!fs.existsSync(path.join(rootB, 'b.txt')));
  cpB.undo('chat1');
  assert.strictEqual(fs.readFileSync(path.join(rootB, 'a.txt'), 'utf8'), 'one\n');
  // A computer with its own history keeps it.
  assert.strictEqual(cpA.importFrom('chat1', packed, rootA), 0);
});

test('checkpoints from elsewhere can\'t reach outside the project', () => {
  const root = tmp('c');
  const outside = path.join(path.dirname(root), `najwa-cpsync-victim-${process.pid}.txt`);
  fs.writeFileSync(outside, 'keep me\n');
  const evil = zlib.gzipSync(JSON.stringify({ v: 1, entries: [{ id: 'x', at: 1, label: 'bad', files: [{ rel: `../${path.basename(outside)}`, existed: true, data: Buffer.from('owned').toString('base64') }] }] })).toString('base64');
  const cp = createCheckpoints(tmp('c-cps'));
  assert.strictEqual(cp.importFrom('chat', evil, root), 0);
  assert.strictEqual(cp.importFrom('chat', 'not base64 gzip', root), 0);
  cp.undo('chat');
  assert.strictEqual(fs.readFileSync(outside, 'utf8'), 'keep me\n');
  fs.rmSync(outside);
});
