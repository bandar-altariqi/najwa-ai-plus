// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// Writes a release's version.json, which the app reads to offer an update
// (src/updates.js): the version, each file's SHA-256 and size, and what's new
// (the commits since the release's previous version.json).
//
//   node scripts/release-manifest.js --version 1.0.57 --dir out [--prev old.json]

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

const sha256 = (file) => new Promise((resolve, reject) => {
  const h = crypto.createHash('sha256');
  fs.createReadStream(file).on('error', reject).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex')));
});

const git = (...args) => {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};

// What's new: commit subjects since the previous release (newest first), or
// the last commit's when there isn't one to compare with.
function notesSince(prevSha) {
  const ok = /^[0-9a-f]{7,40}$/.test(prevSha || '') && git('cat-file', '-e', `${prevSha}^{commit}`) === '' && git('merge-base', '--is-ancestor', prevSha, 'HEAD') === '';
  const out = ok ? git('log', '--no-merges', '--format=%s', `${prevSha}..HEAD`) : git('log', '-1', '--format=%s');
  return out.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 12);
}

async function main() {
  const version = arg('version');
  const dir = arg('dir');
  if (!/^\d+(\.\d+){1,3}$/.test(version || '') || !dir) {
    console.error('Usage: node scripts/release-manifest.js --version 1.0.57 --dir out [--prev old.json]');
    process.exit(2);
  }
  let prev = null;
  try {
    prev = arg('prev') ? JSON.parse(fs.readFileSync(arg('prev'), 'utf8')) : null;
  } catch {
    prev = null;
  }
  const files = {};
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    if (name === 'version.json' || !fs.statSync(full).isFile()) continue;
    files[name] = { sha256: await sha256(full), size: fs.statSync(full).size };
  }
  const sha = git('rev-parse', 'HEAD') || process.env.GITHUB_SHA || '';
  const manifest = { version, sha, date: new Date().toISOString(), notes: notesSince(prev && prev.sha), files };
  fs.writeFileSync(path.join(dir, 'version.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
