// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { webGuides, webGuideTool } = require('../src/agent/web-guide');
const { agentTools } = require('../src/agent/tools');
const { listSkills } = require('../src/agent/commands');
const { createFirewall } = require('../src/agent/firewall');
const { createCheckpoints } = require('../src/agent/checkpoints');
const { backgroundJobs } = require('../src/agent/shell');

const APP = path.join(__dirname, '..');
const SKILL = path.join(APP, 'skills', 'modern-web-guidance');

test('Modern Web Guidance comes with Plus, with its license and notice', () => {
  const text = fs.readFileSync(path.join(SKILL, 'SKILL.md'), 'utf8');
  assert.match(text, /^---\nname: modern-web-guidance\ndescription: .{40,300}\n---\n/);
  assert.match(text, /web_guide/);
  assert.doesNotMatch(text, /npx/, 'Plus reads the bundled guides; it doesn\'t run npx');
  assert.match(fs.readFileSync(path.join(SKILL, 'LICENSE'), 'utf8'), /Apache License\s+Version 2\.0/);
  assert.match(fs.readFileSync(path.join(SKILL, 'NOTICE.md'), 'utf8'), /github\.com\/GoogleChrome\/modern-web-guidance[\s\S]*commit `[0-9a-f]{40}`/);
  assert.match(fs.readFileSync(path.join(APP, 'THIRD-PARTY-NOTICES.md'), 'utf8'), /Modern Web Guidance[^\n]*Apache-2\.0/);
  // The desktop app ships it.
  assert.ok(JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8')).build.files.includes('skills/**/*'));
  // Every project sees it: the app's folder is one of the skill folders.
  assert.match(fs.readFileSync(path.join(APP, 'main.js'), 'utf8'), /skillDirs: \[agentDir, __dirname\]/);
  assert.match(fs.readFileSync(path.join(APP, 'bin/najwa-agent.js'), 'utf8'), /skillDirs: \[data, path\.join\(__dirname, '\.\.'\)\]/);
  const skill = listSkills(fs.mkdtempSync(path.join(os.tmpdir(), 'najwa-wg-')), [APP]).find((s) => s.name === 'modern-web-guidance');
  assert.ok(skill && skill.description.length <= 300);
});

test('the guides: search finds the right one, read returns it', () => {
  const g = webGuides(SKILL);
  assert.ok(g.count >= 150, `${g.count} guides`);
  const first = (q) => (g.search(q)[0] || {}).id;
  assert.strictEqual(first('light dismiss dialog'), 'light-dismiss-a-dialog');
  assert.strictEqual(first('responsive data table'), 'responsive-table');
  assert.strictEqual(first('navigation drawer'), 'navigation-drawer');
  assert.strictEqual(first('dark mode'), 'dark-mode');
  assert.strictEqual(first('sanitize html'), 'sanitize-untrusted-html');
  assert.strictEqual(first('translate text'), 'translator');   // "translate" finds "translator"
  assert.strictEqual(first('accordion'), 'accordion');
  assert.ok(g.search('modal').some((r) => r.id === 'dialog'), 'modal also finds dialog');
  assert.ok(g.search('form validation').some((r) => r.id === 'validate-input-after-interaction'));
  assert.deepStrictEqual(g.search('the and of'), []);
  assert.deepStrictEqual(g.search('kubernetes helm chart'), []);
  for (const r of g.search('carousel')) assert.ok(r.id && r.area && r.title);

  const d = g.read('navigation-drawer');
  assert.match(d.text, /^# Navigation Drawer/);
  // Links to other guides say how to read them here, not with npx.
  const dialog = g.read('dialog').text;
  assert.match(dialog, /\(web_guide read "declarative-dialog-popover-control"\)/);
  assert.doesNotMatch(dialog, /npx/);
  assert.strictEqual(g.read('ui-components/navigation-drawer.md').id, 'navigation-drawer');
  assert.strictEqual(g.read('nope'), null);
  // No guides folder: nothing to offer.
  assert.strictEqual(webGuides(fs.mkdtempSync(path.join(os.tmpdir(), 'najwa-wg-'))), null);
});

test('web_guide tool: search, read (one or several), list, mistakes', () => {
  const g = webGuides(SKILL);
  const s = webGuideTool(g, { action: 'search', query: 'light dismiss dialog' });
  assert.match(s.text, /^- light-dismiss-a-dialog \(ui-behaviors\): /);
  assert.match(s.label, /Searched the web guides/);
  const r = webGuideTool(g, { action: 'read', id: 'dialog, accordion, nope' });
  assert.match(r.text, /--- Guide: dialog[\s\S]*--- Guide: accordion[\s\S]*No guide called nope/);
  assert.ok(webGuideTool(g, { action: 'read', id: 'nope' }).error);
  assert.ok(webGuideTool(g, { action: 'read' }).error);
  assert.ok(webGuideTool(g, { action: 'search', query: ' ' }).error);
  assert.match(webGuideTool(g, { action: 'search', query: 'kubernetes helm chart' }).text, /No guide matches/);
  assert.match(webGuideTool(g, { action: 'list' }).text, /^[a-z-]+: /m);
  // The biggest guide still comes back whole (or clearly cut).
  const big = webGuideTool(g, { action: 'read', id: 'accessibility' });
  assert.ok(big.text.length > 1000 && big.text.length < 62000);
});

test('the agent gets web_guide when the skill is there, read-only', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'najwa-wg-')));
  fs.writeFileSync(path.join(root, 'index.html'), '<p>hi</p>\n');
  const make = (dirs) => agentTools({
    root, chatId: 'w', mode: 'ask', options: { dryRun: 'off', skillDirs: dirs }, firewall: createFirewall({ cloud: true }),
    approve: async () => { throw new Error('a read-only tool must not ask'); }, chatAllowed: new Set(),
    checkpoints: createCheckpoints(path.join(root, '..', `${path.basename(root)}-cps`)), jobs: backgroundJobs()
  });
  const t = make([APP]);
  assert.ok(t.defs.some((d) => d.name === 'web_guide'));
  assert.ok(t.readOnly('web_guide'));
  assert.match(t.system, /- modern-web-guidance: Current best practices for web UI work/);
  const found = await t.run('web_guide', { action: 'search', query: 'navigation drawer' });
  assert.match(found.text, /navigation-drawer/);
  const read = await t.run('web_guide', { action: 'read', id: 'navigation-drawer' });
  assert.match(read.text, /# Navigation Drawer/);
  assert.match(t.describe({ name: 'web_guide', args: { action: 'search', query: 'tabs' } }), /Searching the web guides for "tabs"/);
  // use_skill brings the instructions and the notice, not the 11 KB license.
  const used = await t.run('use_skill', { name: 'modern-web-guidance' });
  assert.match(used.text, /web_guide/);
  assert.doesNotMatch(used.text, /TERMS AND CONDITIONS FOR USE/);
  // Without the skill: no tool.
  assert.ok(!make([]).defs.some((d) => d.name === 'web_guide'));
});
