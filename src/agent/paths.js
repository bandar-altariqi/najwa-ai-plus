// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// The project folder the agent works in: every path a tool gets is resolved
// inside it, links included, so the agent can't read or change anything else
// on the computer. Plus glob patterns ("src/**/*.js", "*.pem").

'use strict';

const fs = require('fs');
const path = require('path');

// Folders listing and searching skip (they can still be read by name).
const SKIP_DIRS = new Set(['.git', 'node_modules', '.hg', '.svn', 'dist', 'build', 'out', '.next', '.nuxt', '.cache',
  '__pycache__', '.venv', 'venv', '.tox', 'target', '.gradle', '.idea', 'Pods', 'DerivedData', 'coverage', '.turbo']);

const toSlash = (p) => p.split(path.sep).join('/');

function isInside(root, p) {
  const rel = path.relative(root, p);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

class OutsideProject extends Error {}

/**
 * A path the model gave, inside the project folder.
 * @returns { abs, rel }  rel uses forward slashes ('.' for the folder itself)
 */
function resolveIn(root, given) {
  const rootReal = fs.realpathSync(root);
  const asked = typeof given === 'string' && given.trim() ? given.trim() : '.';
  const abs = path.resolve(rootReal, asked);
  if (!isInside(rootReal, abs)) throw new OutsideProject(`${asked} is outside the project folder. Only files inside it can be used.`);
  // Follow links: the real place must be inside too. For a path that doesn't
  // exist yet, its nearest existing folder is checked.
  let real;
  try {
    real = fs.realpathSync(abs);
  } catch {
    let dir = path.dirname(abs);
    while (!fs.existsSync(dir) && dir !== path.dirname(dir)) dir = path.dirname(dir);
    real = path.join(fs.realpathSync(dir), path.relative(dir, abs));
  }
  if (!isInside(rootReal, real)) throw new OutsideProject(`${asked} leads outside the project folder (through a link). Only files inside it can be used.`);
  return { abs: real, rel: toSlash(path.relative(rootReal, real)) || '.' };
}

// A glob as a regular expression. "**" crosses folders, "*" and "?" don't.
// A pattern without "/" matches a name in any folder (like .gitignore).
function globToRegex(glob) {
  let g = String(glob).trim().replace(/\\/g, '/');
  if (g.startsWith('./')) g = g.slice(2);
  const anywhere = !g.includes('/');
  if (g.endsWith('/')) g += '**';
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        const slash = g[i + 2] === '/';
        re += slash ? '(?:.*/)?' : '.*';
        i += slash ? 2 : 1;
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{') {
      const end = g.indexOf('}', i);
      if (end > i) {
        re += `(?:${g.slice(i + 1, end).split(',').map((p) => p.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')).join('|')})`;
        i = end;
      } else re += '\\{';
    } else re += /[.+^$()|[\]\\]/.test(c) ? `\\${c}` : c;
  }
  return new RegExp(`^${anywhere ? '(?:.*/)?' : ''}${re}$`);
}

function matcher(globs) {
  const res = (globs || []).filter((g) => String(g).trim()).map(globToRegex);
  return (rel) => res.some((r) => r.test(rel));
}

/**
 * Files under a folder of the project, skipping SKIP_DIRS and links to folders.
 * Calls visit(rel, abs, stat) for each file; stops after `limit` files.
 */
function walk(root, startAbs, visit, { limit = 20000, skip = SKIP_DIRS } = {}) {
  const rootReal = fs.realpathSync(root);
  let count = 0;
  const stack = [startAbs];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => (a.name < b.name ? 1 : -1));
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!skip.has(e.name)) stack.push(abs);
      } else if (e.isFile()) {
        if (++count > limit) return false;
        if (visit(toSlash(path.relative(rootReal, abs)), abs) === false) return false;
      }
    }
  }
  return true;
}

module.exports = { resolveIn, isInside, globToRegex, matcher, walk, toSlash, SKIP_DIRS, OutsideProject };
