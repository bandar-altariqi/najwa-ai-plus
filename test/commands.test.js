// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { listCommands, expandCommand, listSkills, loadSkill, sharedSkillDirs, addSkillsFromGitHub, removeSkill } = require('../src/agent/commands');
const { execFileSync } = require('node:child_process');
const { agentTools } = require('../src/agent/tools');
const { createFirewall } = require('../src/agent/firewall');
const { createCheckpoints } = require('../src/agent/checkpoints');
const { backgroundJobs } = require('../src/agent/shell');

function dir(files) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'najwa-cmd-test-')));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
}

test('slash commands: the project\'s, .claude\'s, the app\'s and the built-in ones', () => {
  const app = dir({ 'commands/standup.md': '# What did I change today?\nSummarise today\'s commits.\n' });
  const root = dir({
    '.najwa/commands/fix.md': '---\ndescription: Fix an issue\n---\nFix issue #$1 ($ARGUMENTS). Run the tests after.\n',
    '.claude/commands/fix.md': 'Shadowed by .najwa\n',
    '.claude/commands/explain.md': 'Explain this project simply.\n',
    '.najwa/commands/review.md': 'Our own review: check the tests first.\n',
    '.najwa/commands/Bad Name.md': 'not a command\n'
  });
  const list = listCommands(root, [app]);
  const names = list.map((c) => c.name);
  assert.deepStrictEqual(names.sort(), ['explain', 'fix', 'init', 'review', 'standup']);
  assert.strictEqual(list.find((c) => c.name === 'fix').description, 'Fix an issue');
  assert.strictEqual(list.find((c) => c.name === 'standup').description, 'What did I change today?');
  assert.strictEqual(expandCommand(root, '/fix 42 the login', [app]).text, 'Fix issue #42 (42 the login). Run the tests after.');
  assert.strictEqual(expandCommand(root, '/explain the parser', [app]).text, 'Explain this project simply.\n\nthe parser');   // no $ARGUMENTS: added at the end
  assert.match(expandCommand(root, '/review', [app]).text, /^Our own review/);   // the project's replaces the built-in one
  assert.match(expandCommand(root, '/INIT').text, /NAJWA\.md/);
  assert.strictEqual(expandCommand(root, '/nothing here'), null);
  assert.strictEqual(expandCommand(root, 'not /fix'), null);
});

test('skills: listed with their descriptions, loaded when used', async () => {
  const app = dir({ 'skills/release/SKILL.md': '---\nname: release\ndescription: How we release\n---\nBump, tag, push.\n', 'skills/release/checklist.md': '- changelog\n' });
  const root = dir({
    '.najwa/skills/sql/SKILL.md': '---\ndescription: Writing SQL migrations for this project\n---\nAlways add a down migration.\n',
    '.najwa/skills/sql/example.sql': 'select 1;\n',
    'a.txt': 'x\n'
  });
  const skills = listSkills(root, [app], []);
  assert.deepStrictEqual(skills.map((s) => [s.name, s.description]), [['sql', 'Writing SQL migrations for this project'], ['release', 'How we release']]);
  const sql = loadSkill(skills, 'sql', root);
  assert.strictEqual(sql.text, 'Always add a down migration.');
  assert.deepStrictEqual(sql.files, ['.najwa/skills/sql/example.sql']);
  const make = (r, dirs) => agentTools({
    root: r, chatId: 's', mode: 'ask', options: { dryRun: 'off', skillDirs: dirs, sharedSkillDirs: [] }, firewall: createFirewall({ cloud: true }),
    approve: async () => 'once', chatAllowed: new Set(), checkpoints: createCheckpoints(path.join(r, '..', `${path.basename(r)}-cps`)), jobs: backgroundJobs()
  });
  const t = make(root, [app]);
  assert.ok(t.defs.some((d) => d.name === 'use_skill'));
  assert.match(t.system, /Skills you can load[\s\S]*- sql: Writing SQL migrations[\s\S]*- release: How we release/);
  const used = await t.run('use_skill', { name: 'release' });
  assert.match(used.text, /Bump, tag, push\.[\s\S]*--- checklist\.md ---\n- changelog/);   // outside the project: its files come along
  assert.match((await t.run('use_skill', { name: 'sql' })).text, /read them with read_file[\s\S]*example\.sql/);
  assert.ok((await t.run('use_skill', { name: 'nope' })).error);
  // No skills: no use_skill tool.
  const none = make(dir({ 'a.txt': 'x\n' }), []);
  assert.ok(!none.defs.some((d) => d.name === 'use_skill'));
  assert.doesNotMatch(none.system, /Skills you can load/);
});

test('skills: other agents\' (Claude Code\'s plugins, ~/.claude, ~/.agents, a project\'s .agents) work too', () => {
  const home = dir({
    '.claude/skills/notes/SKILL.md': '---\nname: notes\ndescription: Meeting notes\n---\nx\n',
    '.agents/skills/deploy/SKILL.md': '---\ndescription: Deploying\n---\nx\n',
    '.claude/plugins/cache/googlechrome/modern-web-guidance/1.0.0/skills/old-web/SKILL.md': '---\nname: old-web\ndescription: old\n---\nx\n',
    '.claude/plugins/cache/googlechrome/modern-web-guidance/1.10.0/skills/modern-web-guidance/SKILL.md': '---\nname: modern-web-guidance\ndescription: Web best practices\n---\nRun the search first.\n'
  });
  const shared = sharedSkillDirs(home);
  // The newest version of each plugin only (1.10.0 after 1.0.0, not before 1.9).
  assert.ok(shared.some((d) => d.endsWith(path.join('1.10.0', 'skills'))));
  assert.ok(!shared.some((d) => d.endsWith(path.join('1.0.0', 'skills'))));
  const root = dir({ '.agents/skills/lint/SKILL.md': '---\ndescription: Our lint rules\n---\nx\n', '.najwa/skills/notes/SKILL.md': '---\ndescription: Project notes\n---\nx\n' });
  const names = listSkills(root, [], shared).map((s) => `${s.name}: ${s.description}`);
  // The project's first (its "notes" wins over ~/.claude's), then ~/.agents, then Claude Code's plugins.
  assert.deepStrictEqual(names, ['notes: Project notes', 'lint: Our lint rules', 'deploy: Deploying', 'modern-web-guidance: Web best practices']);
});

test('skills: added from a repository, and removed', async () => {
  const src = dir({
    'README.md': 'skills\n',
    'skills/web/SKILL.md': '---\nname: web-guide\ndescription: Web\n---\nx\n',
    'skills/web/guides/a.md': 'guide\n',
    'skills/ext/SKILL.md': '---\ndescription: Extensions\n---\nx\n'
  });
  const git = (...args) => execFileSync('git', args, { cwd: src, stdio: 'ignore' });
  git('init', '-q');
  git('add', '-A');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'skills');
  const app = dir({});
  const added = await addSkillsFromGitHub('owner/skills', app, { url: src });
  assert.deepStrictEqual(added.sort(), ['ext', 'web-guide']);
  assert.ok(fs.existsSync(path.join(app, 'skills/web-guide/guides/a.md')));
  assert.ok(!fs.existsSync(path.join(app, 'skills/web-guide/.git')));
  assert.deepStrictEqual(listSkills(dir({}), [app], []).map((s) => s.name), ['ext', 'web-guide']);
  await assert.rejects(addSkillsFromGitHub('not a repo', app), /owner\/name/);
  await assert.rejects(addSkillsFromGitHub('owner/empty', app, { url: dir({}) }), /Couldn't download|no skills/);
  assert.ok(removeSkill(app, 'ext'));
  assert.ok(!removeSkill(app, '../escape'));
  assert.deepStrictEqual(listSkills(dir({}), [app], []).map((s) => s.name), ['web-guide']);
});

test('skills: descriptions written as YAML blocks (description: | or >)', () => {
  const root = dir({
    '.najwa/skills/web/SKILL.md': '---\nname: web\ndescription: |\n  Search tool for web best practices.\n  Trigger for: dialogs, forms.\n\n  DO NOT trigger for: backend.\nversion: 2\n---\nBody.\n',
    '.najwa/skills/ext/SKILL.md': '---\nname: ext\ndescription: >-\n  Chrome extensions,\n  Manifest V3.\n---\nBody.\n',
    '.najwa/skills/plain/SKILL.md': '---\nname: plain\ndescription: One line\n  carried on\n---\nBody.\n'
  });
  const by = Object.fromEntries(listSkills(root, [], []).map((s) => [s.name, s.description]));
  assert.strictEqual(by.web, 'Search tool for web best practices. Trigger for: dialogs, forms. DO NOT trigger for: backend.');
  assert.strictEqual(by.ext, 'Chrome extensions, Manifest V3.');
  assert.strictEqual(by.plain, 'One line carried on');
});
