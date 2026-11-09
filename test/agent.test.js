// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { agentTools } = require('../src/agent/tools');
const { createFirewall, isLocalModel } = require('../src/agent/firewall');
const { createCheckpoints } = require('../src/agent/checkpoints');
const { createPermissions, firstWords } = require('../src/agent/permissions');
const { resolveIn, globToRegex } = require('../src/agent/paths');
const { unifiedDiff } = require('../src/agent/diff');
const { parseVerdict } = require('../src/agent/reviewer');
const { backgroundJobs } = require('../src/agent/shell');
const { agentPrompt } = require('../src/agent/instructions');
const { compactResults } = require('../src/tool-chat');

function project(files) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'najwa-agent-test-')));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
}

function setup(files, opts = {}) {
  const root = project(files);
  const asked = [];
  const events = [];
  const answers = opts.answers || [];
  const cps = createCheckpoints(path.join(root, '..', `${path.basename(root)}-cps`));
  const jobs = backgroundJobs();
  const t = agentTools({
    root,
    chatId: 'c1',
    mode: opts.mode || 'ask',
    options: { rules: opts.rules || [], dryRun: opts.dryRun || 'off' },
    firewall: opts.firewall || createFirewall({ cloud: true }),
    approve: async (a) => {
      asked.push(a);
      return answers.length ? answers.shift() : 'once';
    },
    chatAllowed: new Set(),
    checkpoints: cps,
    reviewer: opts.reviewer || null,
    task: 'test task',
    jobs,
    onInfo: (e) => events.push(e),
    onAlways: opts.onAlways || (() => {})
  });
  return { root, t, asked, events, cps, jobs, read: (rel) => fs.readFileSync(path.join(root, rel), 'utf8') };
}

test('agent: paths stay inside the project folder', () => {
  const root = project({ 'a.txt': 'x' });
  assert.strictEqual(resolveIn(root, 'a.txt').rel, 'a.txt');
  assert.strictEqual(resolveIn(root, '').rel, '.');
  assert.throws(() => resolveIn(root, '../outside.txt'), /outside the project/);
  assert.throws(() => resolveIn(root, '/etc/passwd'), /outside the project/);
  fs.symlinkSync(os.tmpdir(), path.join(root, 'link'));
  assert.throws(() => resolveIn(root, 'link/x'), /outside the project/);
  assert.ok(globToRegex('src/**/*.js').test('src/a/b/c.js'));
  assert.ok(globToRegex('*.pem').test('deep/dir/key.pem'));
  assert.ok(!globToRegex('src/*.js').test('src/a/b.js'));
  assert.ok(globToRegex('*.{js,ts}').test('x/y.ts'));
});

test('agent: reads, lists, finds and searches the project', async () => {
  const { t } = setup({ 'src/app.js': 'const a = 1;\nfunction hello() {}\n', 'README.md': '# Hi\n', 'node_modules/x/i.js': 'hello' });
  const list = await t.run('list_files', {});
  assert.match(list.text, /src\//);
  assert.match(list.text, /node_modules\/ \(not opened\)/);
  const read = await t.run('read_file', { path: 'src/app.js' });
  assert.match(read.text, /    2  function hello/);
  const part = await t.run('read_file', { path: 'src/app.js', offset: 2, limit: 1 });
  assert.doesNotMatch(part.text, /const a/);
  const found = await t.run('find_files', { pattern: '**/*.js' });
  assert.match(found.text, /src\/app\.js/);
  assert.doesNotMatch(found.text, /node_modules/);
  const hits = await t.run('search_files', { pattern: 'hello' });
  assert.match(hits.text, /src\/app\.js:2: function hello/);
  assert.doesNotMatch(hits.text, /node_modules/);
  const outside = await t.run('read_file', { path: '../../etc/hosts' });
  assert.ok(outside.error);
});

test('agent: edits ask with a diff, and can be undone', async () => {
  const { t, asked, read, cps, root } = setup({ 'a.txt': 'one\ntwo\nthree\n' });
  const r = await t.run('edit_file', { path: 'a.txt', old_text: 'two', new_text: 'TWO' });
  assert.ok(!r.error, r.text);
  assert.strictEqual(read('a.txt'), 'one\nTWO\nthree\n');
  assert.strictEqual(asked.length, 1);
  assert.match(asked[0].title, /Change a\.txt \(\+1 −1\)/);
  assert.match(asked[0].command, /-two\n\+TWO/);
  assert.match(r.label, /Edited a\.txt/);
  const w = await t.run('write_file', { path: 'new/b.txt', content: 'hi\n' });
  assert.ok(!w.error);
  assert.strictEqual(cps.list('c1').length, 2);
  cps.undo('c1');
  assert.ok(!fs.existsSync(path.join(root, 'new/b.txt')));
  cps.undo('c1');
  assert.strictEqual(read('a.txt'), 'one\ntwo\nthree\n');
});

test('agent: a denied edit changes nothing; text must be found once', async () => {
  const { t, read } = setup({ 'a.txt': 'x\nx\n' }, { answers: ['deny'] });
  const twice = await t.run('edit_file', { path: 'a.txt', old_text: 'x', new_text: 'y' });
  assert.match(twice.text, /appears 2 times/);
  const missing = await t.run('edit_file', { path: 'a.txt', old_text: 'zzz', new_text: 'y' });
  assert.match(missing.text, /wasn't found/);
  const denied = await t.run('edit_file', { path: 'a.txt', old_text: 'x', new_text: 'y', replace_all: true });
  assert.ok(denied.error);
  assert.match(denied.text, /didn't allow/);
  assert.strictEqual(read('a.txt'), 'x\nx\n');
});

test('agent: modes', async () => {
  const plan = setup({ 'a.txt': 'a\n' }, { mode: 'plan' });
  const p = await plan.t.run('write_file', { path: 'a.txt', content: 'b\n' });
  assert.match(p.text, /Plan mode/);
  assert.strictEqual(plan.read('a.txt'), 'a\n');
  const ls = await plan.t.run('run_command', { command: 'ls' });
  assert.match(ls.text, /a\.txt/);
  const edits = setup({ 'a.txt': 'a\n' }, { mode: 'edits' });
  await edits.t.run('write_file', { path: 'a.txt', content: 'b\n' });
  assert.strictEqual(edits.asked.length, 0);
  assert.strictEqual(edits.read('a.txt'), 'b\n');
  // "Allow for this chat" on an edit: no more questions about edits.
  const session = setup({ 'a.txt': 'a\n' }, { answers: ['session'] });
  await session.t.run('write_file', { path: 'a.txt', content: 'b\n' });
  await session.t.run('write_file', { path: 'a.txt', content: 'c\n' });
  assert.strictEqual(session.asked.length, 1);
  assert.strictEqual(session.read('a.txt'), 'c\n');
});

test('agent: commands ask, run, and remember "Always allow"', async () => {
  const saved = [];
  const { t, asked } = setup({ 'a.txt': 'a\n' }, { answers: ['always'], onAlways: (s) => saved.push(s) });
  const r = await t.run('run_command', { command: 'node -e "console.log(6*7)"' });
  assert.match(r.text, /Exit code: 0\n42/);
  assert.strictEqual(asked.length, 1);
  // An inline script is remembered whole: "node -e" alone would allow any script.
  assert.deepStrictEqual(saved, ['node -e "console.log(6*7)"']);
  const fail = await setup({}, { mode: 'auto' }).t.run('run_command', { command: 'node -e "process.exit(3)"' });
  assert.match(fail.text, /Exit code: 3/);
  assert.match(fail.label, /exit code 3/);
  // Harm asks even in auto mode, and can't be "always" allowed.
  const auto = setup({}, { mode: 'auto', answers: ['deny'] });
  const push = await auto.t.run('run_command', { command: 'git push origin main' });
  assert.ok(push.error);
  assert.deepStrictEqual(auto.asked[0].choices, ['once', 'deny']);
  assert.match(auto.asked[0].description, /publishes to a remote repository/);
});

test('agent: background commands', async () => {
  const { t, jobs } = setup({}, { mode: 'auto' });
  const r = await t.run('run_command', { command: 'node -e "console.log(\'up\'); setInterval(() => {}, 1000)"', background: true });
  assert.match(r.text, /Started in the background as bg1/);
  assert.match(r.text, /up/);
  const out = await t.run('command_output', { id: 'bg1' });
  assert.match(out.text, /still running/);
  assert.match((await t.run('stop_command', { id: 'bg1' })).text, /Stopped/);
  jobs.stopAll();
});

test('agent: dry run shows the changes and applies them when allowed', async () => {
  const { t, asked, read, root, cps } = setup({ 'a.txt': 'hello\n', 'b.txt': 'old\n' }, { dryRun: 'risky' });
  const cmd = 'node -e "const fs=require(\'fs\');fs.writeFileSync(\'a.txt\',\'HELLO\\n\');fs.unlinkSync(\'b.txt\');console.log(\'did it\')"';
  const r = await t.run('run_command', { command: cmd });
  assert.ok(!r.error, r.text);
  assert.match(asked[0].command, /2 files would change/);
  assert.match(asked[0].command, /-hello\n\+HELLO/);
  assert.match(asked[0].description, /isn't run again/);
  assert.strictEqual(read('a.txt'), 'HELLO\n');
  assert.ok(!fs.existsSync(path.join(root, 'b.txt')));
  assert.match(r.text, /did it/);
  cps.undo('c1');
  assert.strictEqual(read('a.txt'), 'hello\n');
  assert.strictEqual(read('b.txt'), 'old\n');
  // Denied: the project is untouched.
  const d = setup({ 'a.txt': 'hello\n' }, { dryRun: 'risky', answers: ['deny'] });
  await d.t.run('run_command', { command: 'node -e "require(\'fs\').writeFileSync(\'a.txt\',\'x\')"' });
  assert.strictEqual(d.read('a.txt'), 'hello\n');
});

test('agent: the privacy firewall', async () => {
  const env = 'PORT=3000\nOPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwx123\nDB=postgres://me:pa55word99@db/app\n';
  const { t, read } = setup({ '.env': env, 'certs/server.pem': 'KEY', 'src/a.js': 'x' }, { mode: 'edits' });
  const r = await t.run('read_file', { path: '.env' });
  assert.doesNotMatch(r.text, /sk-proj|pa55word99/);
  assert.match(r.text, /OPENAI_API_KEY=«secret-1»/);
  assert.match(r.label, /🛡️ 2 secrets hidden/);
  // Writing the placeholder keeps the real value.
  await t.run('edit_file', { path: '.env', old_text: 'PORT=3000', new_text: 'PORT=8080' });
  await t.run('write_file', { path: 'copy.env', content: 'KEY=«secret-1»\n' });
  assert.strictEqual(read('copy.env'), 'KEY=sk-proj-abcdefghijklmnopqrstuvwx123\n');
  assert.match(read('.env'), /PORT=8080\nOPENAI_API_KEY=sk-proj-/);
  const priv = await t.run('read_file', { path: 'certs/server.pem' });
  assert.match(priv.text, /private/);
  const cmd = await t.run('run_command', { command: 'cat .env' });
  assert.ok(cmd.error || !/sk-proj/.test(cmd.text));
  // A local model sees everything.
  const local = setup({ '.env': env, 'certs/server.pem': 'KEY' }, { firewall: createFirewall({ cloud: false }) });
  assert.match((await local.t.run('read_file', { path: '.env' })).text, /sk-proj/);
  assert.match((await local.t.run('read_file', { path: 'certs/server.pem' })).text, /KEY/);
  assert.ok(isLocalModel('ollama', { baseUrl: 'http://localhost:11434' }));
  assert.ok(isLocalModel('ollama', { baseUrl: 'http://100.90.1.2:11434' }));
  assert.ok(!isLocalModel('openaiCompatible', { baseUrl: 'https://openrouter.ai/api/v1' }));
  assert.ok(!isLocalModel('anthropic', {}));
});

test('agent: a second opinion can make auto mode ask', async () => {
  const reviews = [];
  const reviewer = {
    label: 'reviewer-model',
    review: async (r) => {
      reviews.push(r);
      return /rm/.test(r.action) ? { verdict: 'concern', summary: 'Deletes a file the user may need.', risks: ['data loss'] } : { verdict: 'ok', summary: 'Fine.', risks: [] };
    }
  };
  const { t, asked } = setup({ 'a.txt': 'a\n' }, { mode: 'auto', reviewer });
  await t.run('write_file', { path: 'a.txt', content: 'b\n' });
  assert.strictEqual(asked.length, 0);
  await t.run('run_command', { command: 'rm a.txt' });
  assert.strictEqual(asked.length, 1);
  assert.match(asked[0].description, /⚠️ Second opinion \(reviewer-model\): Has a concern\. Deletes a file/);
  assert.strictEqual(reviews[0].task, 'test task');
  assert.deepStrictEqual(parseVerdict('Sure! {"verdict":"block","summary":"No.","risks":["x"]}'), { verdict: 'block', summary: 'No.', risks: ['x'] });
  assert.strictEqual(parseVerdict('not json'), null);
  // A thinking model's reasoning comes first, braces and all.
  assert.deepStrictEqual(parseVerdict('<think>It returns {a: 1}; fine.</think>\n\n{"verdict":"ok","summary":"Fine."}'), { verdict: 'ok', summary: 'Fine.', risks: [] });
});

test('agent: to-do list, instructions and long tasks', async () => {
  const { t, events, root } = setup({ 'AGENTS.md': 'Always run npm test.\n' });
  const r = await t.run('todo_write', { items: [{ text: 'Read', status: 'done' }, { text: 'Fix', status: 'in_progress' }, { text: '', status: 'pending' }] });
  assert.match(r.label, /1 of 2 done/);
  assert.deepStrictEqual(events[0], { kind: 'todo', items: [{ text: 'Read', status: 'done' }, { text: 'Fix', status: 'in_progress' }] });
  const prompt = agentPrompt({ root, mode: 'plan', firewall: true, dryRun: true, reviewer: false });
  assert.match(prompt, /Plan mode/);
  assert.match(prompt, /AGENTS\.md[\s\S]*Always run npm test/);
  assert.match(prompt, /«secret-1»/);
  assert.ok(t.maxSteps > 25);
  // Old tool results are shortened once the work gets big; the newest stay.
  const extra = Array.from({ length: 10 }, (_, i) => ({ role: 'tool', content: `${i}`.repeat(5000) }));
  assert.ok(compactResults(extra, 30000) > 0);
  assert.match(extra[0].content, /Older result, shortened/);
  assert.strictEqual(extra[9].content.length, 5000);
});

test('agent: diffs and permissions', () => {
  const d = unifiedDiff('a\nb\nc\n', 'a\nB\nc\nd\n', 'f.txt');
  assert.strictEqual(d.added, 2);
  assert.strictEqual(d.removed, 1);
  assert.match(d.text, /@@ -1,3 \+1,4 @@/);
  assert.strictEqual(unifiedDiff('same', 'same').text, '');
  const p = createPermissions({ mode: 'ask', rules: ['npm test'] });
  assert.strictEqual(p.forCommand('npm test -- --watch=false').decision, 'allow');
  assert.strictEqual(p.forCommand('npm test && rm -rf /').decision, 'ask');
  assert.strictEqual(p.forCommand('git status && git diff').decision, 'allow');
  assert.strictEqual(p.forCommand('cat x > y').decision, 'ask');
  assert.strictEqual(firstWords('python3 -m pytest -x tests'), 'python3 -m pytest');
});
