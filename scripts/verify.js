// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// Check a change before it's pushed: the checks that fit what changed, then
// one summary (see .claude/skills/verify/SKILL.md).
//
//   npm run verify            what changed since origin/main, and uncommitted work
//   npm run verify -- --all   everything
//
// - always: the tests (npm test) and a look for secrets in the change
// - workflows changed: every workflow file still parses
// - the interface changed (renderer/, src/lease.js, the phone build): the phone
//   build, the interface in a real browser (scripts/ui-check/run.js) and
//   screenshots to look at (scripts/ui-check/shots.js); these need Playwright
//   with Chromium and are skipped, and said so, where it isn't installed.

'use strict';

const { spawnSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const all = process.argv.includes('--all');
const results = [];

const run = (name, cmd, args, opts = {}) => {
  process.stdout.write(`\n▶ ${name}\n`);
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: opts.quiet ? 'pipe' : 'inherit', encoding: 'utf8', shell: process.platform === 'win32' });
  const ok = r.status === 0;
  results.push({ name, state: ok ? 'passed' : 'FAILED', note: ok ? '' : (opts.quiet ? String(r.stdout || r.stderr || '').trim().split('\n').slice(-5).join('\n') : `exit ${r.status}`) });
  return ok;
};
const skip = (name, why) => results.push({ name, state: 'skipped', note: why });

function changedFiles() {
  const git = (...args) => {
    try {
      return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      return '';
    }
  };
  const base = git('merge-base', 'HEAD', 'origin/main').trim();
  const committed = base ? git('diff', '--name-only', `${base}...HEAD`) : '';
  const working = git('status', '--porcelain').split('\n').map((l) => l.slice(3).split(' -> ').pop());
  return [...new Set([...committed.split('\n'), ...working].map((f) => f.trim()).filter(Boolean))];
}

// Key-shaped text in the change (added lines only): never commit secrets.
function secretsInChange() {
  let diff = '';
  try {
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    diff = execFileSync('git', ['diff', base], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return [];
  }
  const KEYS = [/sk-(?:ant-|proj-)?[A-Za-z0-9_-]{24,}/, /\bAKIA[0-9A-Z]{16}\b/, /\bgh[pousr]_[A-Za-z0-9]{30,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\bAIza[0-9A-Za-z_-]{35}\b/, /\bxox[baprs]-[A-Za-z0-9-]{10,}/];
  const hits = [];
  let file = '';
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) file = line.slice(6);
    else if (line.startsWith('+') && !line.startsWith('+++') && !/^test\//.test(file) && KEYS.some((k) => k.test(line))) hits.push(file);
  }
  // New files git doesn't track yet.
  let untracked = [];
  try {
    untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean);
  } catch {
    untracked = [];
  }
  for (const f of untracked.filter((n) => !/^test\//.test(n))) {
    try {
      const buf = fs.readFileSync(path.join(ROOT, f));
      if (buf.length < 5e6 && !buf.subarray(0, 8000).includes(0) && KEYS.some((k) => k.test(buf.toString('utf8')))) hits.push(f);
    } catch {
      // unreadable: not ours to judge
    }
  }
  return [...new Set(hits)];
}

const files = all ? null : changedFiles();
const touches = (re) => all || files.some((f) => re.test(f));
console.log(all ? 'Checking everything.' : `Checking ${files.length} changed file${files.length === 1 ? '' : 's'} since origin/main.`);

// 1. The tests.
run('Tests (npm test)', 'npm', ['test', '--silent']);

// 2. Secrets.
const secrets = all ? [] : secretsInChange();
results.push({ name: 'No secrets in the change', state: secrets.length ? 'FAILED' : 'passed', note: secrets.length ? `key-like text in: ${secrets.join(', ')}` : '' });

// 3. Workflows.
if (touches(/^\.github\/workflows\//)) {
  let yaml = null;
  try {
    yaml = require('js-yaml');
  } catch {
    yaml = null;
  }
  if (!yaml) skip('Workflows parse', 'js-yaml is not installed');
  else {
    const dir = path.join(ROOT, '.github', 'workflows');
    const bad = [];
    for (const f of fs.readdirSync(dir).filter((n) => /\.ya?ml$/.test(n))) {
      try {
        yaml.load(fs.readFileSync(path.join(dir, f), 'utf8'));
      } catch (err) {
        bad.push(`${f}: ${err.message.split('\n')[0]}`);
      }
    }
    results.push({ name: 'Workflows parse', state: bad.length ? 'FAILED' : 'passed', note: bad.join('; ') });
  }
}

// 4. The interface in a real browser.
if (touches(/^(renderer\/|src\/lease\.js|scripts\/build-web\.mjs|scripts\/ui-check\/|mobile\/)/)) {
  let playwright = true;
  try {
    require.resolve('playwright');
  } catch {
    playwright = false;
  }
  if (run('Phone build (npm run build:web)', 'npm', ['run', 'build:web', '--silent'], { quiet: true })) {
    if (!playwright) {
      skip('Interface in a browser (scripts/ui-check/run.js)', 'Playwright is not installed');
      skip('Screenshots (scripts/ui-check/shots.js)', 'Playwright is not installed');
    } else {
      run('Interface in a browser (scripts/ui-check/run.js)', 'node', ['scripts/ui-check/run.js']);
      run('Screenshots (scripts/ui-check/shots.js)', 'node', ['scripts/ui-check/shots.js', 'verify']);
    }
  }
} else {
  skip('Interface in a browser', 'the interface did not change');
}

console.log('\n──────── Summary ────────');
for (const r of results) console.log(`${r.state === 'passed' ? '✓' : r.state === 'skipped' ? '–' : '✗'} ${r.name}${r.state === 'passed' ? '' : `: ${r.state}`}${r.note ? ` (${r.note})` : ''}`);
const failed = results.filter((r) => r.state === 'FAILED').length;
console.log(failed ? `\n${failed} check${failed === 1 ? '' : 's'} failed.` : '\nAll checks that apply passed.');
process.exit(failed ? 1 : 0);
