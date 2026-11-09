// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// Dry run: a command that would change files runs first in a throwaway copy
// of the project. The approval card then shows exactly what it would change
// (which files, and the diff) and what it printed. "Allow" applies those
// changes to the real project (kept as a checkpoint, so they can be undone);
// "Deny" throws the copy away. The command isn't run again, so what's applied
// is exactly what was shown.
//
// Big folders that are only installed packages (node_modules, .venv…) are
// linked into the copy instead of copied. Commands that reach outside the
// project (git push, ssh, docker, installs, sending data) are never dry-run:
// running them in a copy would still really do them.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { runShell } = require('./shell');
const { unifiedDiff } = require('./diff');
const { dangerOf, isSafe } = require('./permissions');
const { toSlash } = require('./paths');

const LINKED = new Set(['node_modules', '.venv', 'venv', 'env', '.tox', 'Pods', '.gradle', 'target', '.next', '.nuxt', '.cache', '.turbo']);
const MAX_FILES = 30000;
const MAX_BYTES = 600 * 1024 * 1024;
const LOCAL_HARM = new Set(['deletes a lot of files', 'can throw away work', 'changes permissions widely']);

// Whether a command can be dry-run, and whether it's worth it.
function dryRunFor(command, setting) {
  if (setting === 'off' || !setting) return { use: false };
  const danger = dangerOf(command);
  if (danger && !LOCAL_HARM.has(danger)) return { use: false, why: `It ${danger}, so it can't be tried in a copy first.` };
  if (isSafe(command)) return { use: false };
  return { use: setting === 'always' || setting === 'risky' };
}

// Files of a tree (skipping linked folders): rel -> { abs, size }.
function scan(root) {
  const files = new Map();
  let bytes = 0;
  const stack = [''];
  while (stack.length) {
    const relDir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(path.join(root, relDir), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!(relDir === '' && LINKED.has(e.name))) stack.push(rel);
      } else if (e.isFile()) {
        const st = fs.statSync(path.join(root, rel));
        bytes += st.size;
        files.set(rel, { abs: path.join(root, rel), size: st.size, mode: st.mode });
        if (files.size > MAX_FILES || bytes > MAX_BYTES) return null;
      }
    }
  }
  return files;
}

function copyTree(root, files) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'najwa-dryrun-'));
  for (const [rel, f] of files) {
    const to = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(f.abs, to);
    fs.chmodSync(to, f.mode & 0o7777);
  }
  for (const name of LINKED) {
    const from = path.join(root, name);
    if (fs.existsSync(from)) {
      try {
        fs.symlinkSync(from, path.join(tmp, name), process.platform === 'win32' ? 'junction' : 'dir');
      } catch {
        // can't link: the command just won't find it
      }
    }
  }
  return tmp;
}

const isText = (buf) => buf.length < 1024 * 1024 && !buf.subarray(0, 8000).includes(0);

/**
 * Run a command in a copy of the project.
 * @returns null when the project is too big to copy, else
 *   { code, output, timedOut, changes: [{ rel, kind: 'added'|'changed'|'deleted' }], diff, gitChanges, apply(step), discard() }
 */
async function dryRun({ command, root, timeoutMs, signal }) {
  const before = scan(root);
  if (!before) return null;
  const tmp = copyTree(root, before);
  const discard = () => fs.rmSync(tmp, { recursive: true, force: true });
  let res;
  try {
    res = await runShell({ command, cwd: tmp, timeoutMs, signal });
  } catch (err) {
    discard();
    throw err;
  }
  const after = scan(tmp) || new Map();
  const changes = [];
  for (const [rel, f] of after) {
    const old = before.get(rel);
    if (!old) changes.push({ rel, kind: 'added' });
    else if (old.size !== f.size || !fs.readFileSync(old.abs).equals(fs.readFileSync(f.abs))) changes.push({ rel, kind: 'changed' });
  }
  for (const rel of before.keys()) if (!after.has(rel)) changes.push({ rel, kind: 'deleted' });
  changes.sort((a, b) => a.rel.localeCompare(b.rel));

  // The diff of the project's own files (Git's internal files are just counted).
  const shown = changes.filter((c) => !c.rel.startsWith('.git/'));
  const gitChanges = changes.length - shown.length;
  const diffs = [];
  for (const c of shown) {
    const a = c.kind === 'added' ? null : fs.readFileSync(before.get(c.rel).abs);
    const b = c.kind === 'deleted' ? null : fs.readFileSync(path.join(tmp, c.rel));
    if ((a && !isText(a)) || (b && !isText(b))) diffs.push(`${c.kind === 'added' ? 'New' : c.kind === 'deleted' ? 'Deleted' : 'Changed'} file: ${c.rel} (not text)`);
    else diffs.push(unifiedDiff(a && a.toString('utf8'), b && b.toString('utf8'), c.rel, { maxLines: 120 }).text);
  }

  return {
    code: res.code,
    output: res.output,
    timedOut: res.timedOut,
    changes,
    shown,
    gitChanges,
    diff: diffs.filter(Boolean).join('\n'),
    // Put the copy's changes into the real project, keeping each file first
    // (a checkpoint step from checkpoints.js).
    apply(step) {
      for (const c of changes) {
        const abs = path.join(root, c.rel);
        if (step) step.keep(abs, toSlash(c.rel));
        if (c.kind === 'deleted') fs.rmSync(abs, { force: true });
        else {
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.copyFileSync(path.join(tmp, c.rel), abs);
        }
      }
    },
    discard
  };
}

module.exports = { dryRun, dryRunFor, LINKED };
