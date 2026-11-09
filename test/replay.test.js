// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRecorder, listRuns, loadRun, scrubRun, replayHtml } = require('../src/agent/replay');
const { createFirewall } = require('../src/agent/firewall');

const KEY = 'sk-proj-0123456789abcdefghijklmnopqrstuv';

test('run replay: recorded, listed, shared with secrets hidden', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'najwa-replay-test-'));
  const rec = createRecorder({ dir, chatId: 'c1', task: 'Fix the test', model: 'deepseek-flash', project: 'shop' });
  rec.info({ kind: 'tool', id: 'a', label: 'Reading a.js', status: 'running' });
  rec.info({ kind: 'tool', id: 'a', label: 'Read a.js', status: 'completed', emoji: '📄' });
  rec.delta('The key is ');
  rec.delta(`${KEY}. `);
  rec.info({ kind: 'approval', title: 'Change a.js', command: `-old\n+new ${KEY}`, askKind: 'edit', description: 'x', runId: 'secret-internal' });
  rec.info({ kind: 'answer', title: 'Change a.js', choice: 'once' });
  rec.info({ kind: 'todo', items: [{ text: 'Fix', status: 'done' }] });
  rec.info({ kind: 'shot', src: 'data:image/png;base64,AAAA' });   // pictures aren't kept
  rec.info({ kind: 'usage', input: 100, output: 20, usd: 0.001 });
  rec.delta('</script><script>alert(1)</script>Done.');
  const run = rec.finish();
  createRecorder({ dir, chatId: 'other', task: 'x' }).finish(new Error('boom'));

  const list = listRuns(dir, 'c1');
  assert.strictEqual(list.length, 1);
  assert.deepStrictEqual({ ...list[0], seconds: 0 }, { id: run.id, task: 'Fix the test', model: 'deepseek-flash', startedAt: run.startedAt, seconds: 0, steps: 1, error: null });
  assert.strictEqual(listRuns(dir, 'other')[0].error, 'boom');
  const loaded = loadRun(dir, run.id);
  assert.deepStrictEqual(loaded.events.map((e) => e.kind), ['tool', 'tool', 'text', 'approval', 'answer', 'todo', 'usage', 'text']);
  assert.strictEqual(loaded.events[2].text, `The key is ${KEY}. `);   // pieces joined
  assert.strictEqual(loaded.events[3].runId, undefined);   // only what a replay needs
  assert.strictEqual(loadRun(dir, '../../etc/passwd'), null);

  const wall = createFirewall({ cloud: true });
  const shared = scrubRun(loaded, (t) => wall.scrub(t).text);
  const html = replayHtml(shared);
  assert.ok(!html.includes(KEY));
  assert.match(html, /«secret-1»/);
  // The data can't end the page's script early.
  assert.ok(!/<\/script><script>alert/.test(html));
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /Najwa AI Plus by Bandar Altariqi/);
});
