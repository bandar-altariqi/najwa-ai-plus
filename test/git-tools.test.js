// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { agentTools } = require('../src/agent/tools');
const { createFirewall } = require('../src/agent/firewall');
const { createCheckpoints } = require('../src/agent/checkpoints');
const { backgroundJobs } = require('../src/agent/shell');
const { safeRef } = require('../src/agent/git');

function repo(files) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'najwa-git-test-')));
  const g = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 'test@example.com');
  g('config', 'user.name', 'Test');
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  g('add', '-A');
  g('commit', '-q', '-m', 'first');
  return { root, g };
}

function tools(root, { mode = 'ask', answers = [] } = {}) {
  const asked = [];
  const t = agentTools({
    root,
    chatId: 'g1',
    mode,
    options: { dryRun: 'off' },
    firewall: createFirewall({ cloud: true }),
    approve: async (a) => {
      asked.push(a);
      return answers.length ? answers.shift() : 'once';
    },
    chatAllowed: new Set(),
    checkpoints: createCheckpoints(path.join(root, '..', `${path.basename(root)}-cps`)),
    jobs: backgroundJobs()
  });
  return { t, asked };
}

test('git tools: status, diff and log only look, in every mode', async () => {
  const { root } = repo({ 'a.js': 'one\n', '.env': 'KEY=sk-live-0123456789abcdef0123456789\n', 'secrets/db.txt': 'old\n' });
  fs.writeFileSync(path.join(root, 'a.js'), 'two\n');
  fs.writeFileSync(path.join(root, '.env'), 'KEY=sk-live-0123456789abcdef0123456789\nMORE=1\n');
  fs.writeFileSync(path.join(root, 'secrets/db.txt'), 'hunter2\n');
  const { t, asked } = tools(root, { mode: 'plan' });
  const st = await t.run('git_status', {});
  assert.match(st.text, /## main/);
  assert.match(st.text, /M a\.js/);
  const diff = await t.run('git_diff', {});
  assert.match(diff.text, /-one\n\+two/);
  assert.match(diff.text, /KEY=«secret-1»\n\+MORE=1/);   // secrets hidden
  assert.doesNotMatch(diff.text, /sk-live|hunter2/);
  assert.match(diff.text, /Left out, private: secrets\/db\.txt/);   // private files left out
  assert.match((await t.run('git_log', {})).text, /Test: first/);
  assert.strictEqual(asked.length, 0);
  assert.ok(t.readOnly('git_diff'));
  // Plan mode doesn't commit.
  const c = await t.run('git_commit', { message: 'x' });
  assert.ok(c.error);
  assert.match(c.text, /Plan mode/);
  // A ref is a name, never an option.
  assert.ok((await t.run('git_diff', { ref: '--output=/tmp/x' })).error);
  assert.ok(safeRef('HEAD~1') && safeRef('origin/main') && !safeRef('-p') && !safeRef('a b'));
});

test('git tools: a commit is asked, shows its files, and can be refused', async () => {
  const { root, g } = repo({ 'a.js': 'one\n' });
  fs.writeFileSync(path.join(root, 'a.js'), 'two\n');
  fs.writeFileSync(path.join(root, 'b.js'), 'new\n');
  const { t, asked } = tools(root, { answers: ['deny', 'once'] });
  const no = await t.run('git_commit', { message: 'Change a' });
  assert.ok(no.error);
  assert.match(g('status', '--short'), /a\.js/);
  const yes = await t.run('git_commit', { message: 'Change a and add b\n\nDetails.', paths: ['a.js'] });
  assert.ok(!yes.error, yes.text);
  assert.strictEqual(asked.length, 2);
  assert.strictEqual(asked[1].title, 'Commit');
  assert.match(asked[1].command, /Change a and add b[\s\S]*Files \(1\):\na\.js/);
  assert.strictEqual(g('log', '-1', '--pretty=%s').trim(), 'Change a and add b');
  assert.match(g('status', '--short'), /\?\? b\.js/);   // only the file given
  assert.match((await tools(root, { mode: 'auto' }).t.run('git_commit', { message: 'Add b' })).label, /Committed [0-9a-f]+ \(1 file\)/);
  assert.match((await t.run('git_commit', { message: 'Again' })).text, /Nothing to commit/);
});

test('git tools: outside a repository', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'najwa-nogit-')));
  const r = await tools(root).t.run('git_status', {});
  assert.ok(r.error);
  assert.match(r.text, /isn't a Git repository/);
});
