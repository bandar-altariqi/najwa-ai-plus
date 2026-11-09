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
const { loadHooks } = require('../src/agent/hooks');
const { createFirewall } = require('../src/agent/firewall');
const { createCheckpoints } = require('../src/agent/checkpoints');
const { backgroundJobs } = require('../src/agent/shell');

const node = JSON.stringify(process.execPath);

function project(files) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'najwa-hooks-test-')));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
}

function tools(root, { answers = [], trusted = [], onTrust = () => {} } = {}) {
  const asked = [];
  const t = agentTools({
    root, chatId: 'h', mode: 'auto', options: { dryRun: 'off', trustedHooks: trusted, onTrustHooks: onTrust }, firewall: createFirewall({ cloud: true }),
    approve: async (a) => {
      asked.push(a);
      return answers.length ? answers.shift() : 'once';
    },
    chatAllowed: new Set(), checkpoints: createCheckpoints(path.join(root, '..', `${path.basename(root)}-cps`)), jobs: backgroundJobs()
  });
  return { t, asked };
}

const HOOKS = {
  // Before: no edits to anything under locked/.
  before: [{ tools: ['write_file', 'edit_file'], command: `${node} -e "if (process.env.NAJWA_FILE.startsWith('locked/')) { console.log('locked/ is read-only'); process.exit(1) }"` }],
  // After: a "linter" that complains about var.
  after: [{ tools: ['write_file'], command: `${node} -e "const t = require('fs').readFileSync(process.env.NAJWA_FILE, 'utf8'); if (/\\bvar\\b/.test(t)) console.log('lint: use let or const, not var')"` }]
};

test('hooks: asked first, stop a tool, add notes', async () => {
  const root = project({ '.najwa/hooks.json': JSON.stringify(HOOKS), 'locked/a.txt': 'x\n' });
  const remembered = [];
  const { t, asked } = tools(root, { answers: ['always'], onTrust: (h) => remembered.push(h) });
  assert.match(t.system, /This project has hooks/);
  const stopped = await t.run('write_file', { path: 'locked/a.txt', content: 'changed\n' });
  assert.ok(stopped.error);
  assert.match(stopped.text, /A hook of this project stopped this[\s\S]*locked\/ is read-only/);
  assert.strictEqual(fs.readFileSync(path.join(root, 'locked/a.txt'), 'utf8'), 'x\n');
  assert.strictEqual(asked.length, 1);
  assert.strictEqual(asked[0].title, 'Run this project\'s hooks?');
  assert.match(asked[0].command, /before write_file, edit_file:\n {2}\$ /);
  assert.deepStrictEqual(remembered, [loadHooks(root).hash]);
  const linted = await t.run('write_file', { path: 'b.js', content: 'var x = 1;\n' });
  assert.ok(!linted.error);
  assert.match(linted.text, /Created b\.js[\s\S]*lint: use let or const, not var/);
  assert.match(linted.label, /🪝/);
  assert.strictEqual(asked.length, 1);   // asked once per reply
  // Trusted: not asked again. Changed: asked again.
  assert.strictEqual(tools(root, { trusted: remembered }).asked.length, 0);
  const again = tools(root, { trusted: remembered });
  await again.t.run('write_file', { path: 'c.js', content: 'let y;\n' });
  assert.strictEqual(again.asked.length, 0);
  fs.writeFileSync(path.join(root, '.najwa/hooks.json'), JSON.stringify({ ...HOOKS, after: [{ tools: '*', command: 'echo changed' }] }));
  const changed = tools(root, { trusted: remembered, answers: ['deny'] });
  const r = await changed.t.run('write_file', { path: 'locked/a.txt', content: 'now\n' });
  assert.strictEqual(changed.asked.length, 1);
  assert.ok(!r.error);   // hooks refused: the tool runs without them
});

test('hooks: none, or a broken file', async () => {
  const none = tools(project({ 'a.txt': '1\n' }));
  assert.doesNotMatch(none.t.system, /This project has hooks/);
  assert.ok(!(await none.t.run('write_file', { path: 'a.txt', content: '2\n' })).error);
  assert.strictEqual(none.asked.length, 0);
  assert.match(loadHooks(project({ '.najwa/hooks.json': '{ nope' })).error, /isn't valid JSON/);
});
