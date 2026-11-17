// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// The verify skill (.claude/skills/verify) and the command it runs
// (npm run verify: scripts/verify.js).

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { listSkills } = require('../src/agent/commands');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('the verify skill is found, with a short description, and says how to check', () => {
  const skill = listSkills(ROOT).find((s) => s.name === 'verify');
  assert.ok(skill, 'the verify skill is listed for this project');
  assert.ok(skill.description.length > 40 && skill.description.length <= 300);
  const text = read('.claude/skills/verify/SKILL.md');
  assert.match(text, /npm run verify/);
  assert.match(text, /never skip, weaken or delete a test/);
  assert.match(text, /three tries/);
  assert.match(text, /skipped[\s\S]*never "passed"/);
});

test('npm run verify runs scripts/verify.js, which picks the checks that fit', () => {
  assert.strictEqual(JSON.parse(read('package.json')).scripts.verify, 'node scripts/verify.js');
  const script = read('scripts/verify.js');
  assert.match(script, /'npm', \['test', '--silent'\]/);
  assert.match(script, /scripts\/ui-check\/run\.js/);
  assert.match(script, /scripts\/ui-check\/shots\.js/);
  assert.match(script, /PRIVATE KEY/);
  assert.match(script, /--all/);
  // Missing Playwright is a skip that's reported, not a pass.
  assert.match(script, /skip\('Interface in a browser \(scripts\/ui-check\/run\.js\)', 'Playwright is not installed'\)/);
  assert.ok(fs.existsSync(path.join(ROOT, 'scripts/ui-check/shots.js')));
});
