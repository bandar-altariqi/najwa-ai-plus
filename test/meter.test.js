// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { agentTools } = require('../src/agent/tools');
const { helperView } = require('../src/agent/helpers');
const { createFirewall } = require('../src/agent/firewall');
const { createCheckpoints } = require('../src/agent/checkpoints');
const { backgroundJobs } = require('../src/agent/shell');

function setup({ local = false } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'najwa-meter-test-')));
  fs.writeFileSync(path.join(root, '.env'), 'API_KEY=sk-proj-0123456789abcdefghijklmnopqrstuv\nDB_PASSWORD=hunter2hunter2\n');
  fs.mkdirSync(path.join(root, 'secrets'));
  fs.writeFileSync(path.join(root, 'secrets', 'prod.txt'), 'top secret\n');
  fs.writeFileSync(path.join(root, 'a.js'), 'console.log(1);\n');
  const events = [];
  const t = agentTools({
    root, chatId: 'm', mode: 'ask', model: 'deepseek-flash', local, options: { dryRun: 'off' },
    firewall: createFirewall({ cloud: !local }), approve: async () => 'once', chatAllowed: new Set(),
    checkpoints: createCheckpoints(path.join(root, '..', `${path.basename(root)}-cps`)), jobs: backgroundJobs(),
    reviewer: { label: 'qwen3:4b', cloud: false, review: async () => ({ verdict: 'ok', summary: 'Fine.', risks: [] }) },
    onInfo: (e) => events.push(e)
  });
  const last = () => [...events].reverse().find((e) => e.kind === 'privacy');
  return { t, last };
}

test('privacy meter: what went where, secrets hidden, private files kept here', async () => {
  const { t, last } = setup();
  await t.run('read_file', { path: '.env' });
  await t.run('read_file', { path: 'a.js' });
  assert.ok((await t.run('read_file', { path: 'secrets/prod.txt' })).error);
  // A helper reads too: counted for the helpers' model.
  await helperView(t, '/x', { label: 'qwen3:4b (helpers)', cloud: false }).run('read_file', { path: 'a.js' });
  // The second opinion sees a change.
  await t.run('write_file', { path: 'b.js', content: 'x\n' });
  const p = last();
  const agent = p.to.find((d) => d.label === 'deepseek-flash');
  assert.strictEqual(agent.cloud, true);
  assert.strictEqual(agent.items, 4);   // .env, a.js, the refusal, the write's result
  assert.ok(agent.bytes > 50);
  assert.deepStrictEqual(p.to.find((d) => d.label === 'qwen3:4b (helpers)'), { label: 'qwen3:4b (helpers)', cloud: false, bytes: p.to.find((d) => d.label === 'qwen3:4b (helpers)').bytes, items: 1 });
  assert.strictEqual(p.to.find((d) => d.label === 'qwen3:4b').cloud, false);   // the reviewer
  assert.strictEqual(p.secrets, 2);
  assert.deepStrictEqual(p.kept, ['secrets/prod.txt']);
});

test('privacy meter: a local model is shown as local, nothing hidden or kept', async () => {
  const { t, last } = setup({ local: true });
  await t.run('read_file', { path: '.env' });
  assert.ok(!(await t.run('read_file', { path: 'secrets/prod.txt' })).error);
  const p = last();
  assert.strictEqual(p.to[0].cloud, false);
  assert.strictEqual(p.secrets, 0);
  assert.deepStrictEqual(p.kept, []);
});
