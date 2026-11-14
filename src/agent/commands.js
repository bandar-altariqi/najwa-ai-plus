// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// Slash commands and skills for the agent (Najwa AI Plus).
//
// A command is a saved prompt: "/review src" in a chat with a project folder
// becomes the text of .najwa/commands/review.md, with $ARGUMENTS (or $1, $2…)
// filled in. A skill is know-how the agent loads when it needs it: a folder
// with SKILL.md (a short description at the top, the details below). The
// agent sees each skill's name and description, and reads the rest with
// use_skill. Both are looked for in the project (.najwa/, and .claude/ so
// existing ones work) and in the app's own folder (for every project).

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const MAX_FILE = 60000;
const NAME = /^[a-z0-9][a-z0-9_-]{0,47}$/i;

const BUILT_IN = {
  review: {
    description: 'Review the uncommitted changes: bugs first, then risks, then small improvements',
    text: 'Review the uncommitted changes in this project as a careful code reviewer. Look at them with git_diff (and read the files around them when you need to). List real problems first (bugs, broken edge cases, security), then risks, then small improvements, each with the file and line. Don\'t change any files. $ARGUMENTS'
  },
  init: {
    description: 'Write NAJWA.md: what this project is and how to build, test and run it',
    text: 'Look around this project and write NAJWA.md at its root, for whoever works on it next (people and agents): what the project is, how to install, build, test and run it, how it\'s laid out, and the conventions you notice. Read before you write, keep it short and accurate, and don\'t guess: leave out what you couldn\'t check. If NAJWA.md, AGENTS.md or CLAUDE.md already exists, improve it instead. $ARGUMENTS'
  }
};

const read = (file) => {
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > MAX_FILE) return null;
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
};

// "---\nkey: value\n---\nbody" -> { meta, body }
function frontMatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z_-]+)\s*:\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    let value = kv[2].trim();
    // A YAML block ("description: |" or ">", then indented lines), or a plain
    // value carried on to indented lines: one line of text.
    const block = /^[|>][+-]?$/.test(value);
    if (block) value = '';
    const more = [];
    while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || (block && !lines[i + 1].trim()))) more.push(lines[++i].trim());
    if (more.length) value = [value, ...more].filter(Boolean).join(' ');
    meta[kv[1].toLowerCase()] = value.replace(/^["']|["']$/g, '');
  }
  return { meta, body: text.slice(m[0].length) };
}

const firstLine = (body) => (body.split('\n').map((l) => l.replace(/^#+\s*/, '').trim()).find(Boolean) || '').slice(0, 120);

// Where to look, most specific first: the project's .najwa, its .claude (and
// for skills its .agents), then the app's.
const dirsFor = (root, kind, extra = []) => [path.join(root, '.najwa', kind), path.join(root, '.claude', kind),
  ...(kind === 'skills' ? [path.join(root, '.agents', 'skills')] : []), ...extra.map((d) => path.join(d, kind))];

// Skills installed for other agents on this computer, so they work here too:
// ~/.claude/skills and ~/.agents/skills (where `npx skills add` puts them),
// and the skills inside Claude Code's plugins (the newest version of each).
function sharedSkillDirs(home = os.homedir()) {
  const dirs = [path.join(home, '.claude', 'skills'), path.join(home, '.agents', 'skills')];
  const cache = path.join(home, '.claude', 'plugins', 'cache');
  const subdirs = (d) => {
    try {
      return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return [];
    }
  };
  const newest = (names) => names.slice().sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop();
  for (const market of subdirs(cache)) {
    for (const plugin of subdirs(path.join(cache, market))) {
      const version = newest(subdirs(path.join(cache, market, plugin)));
      if (version) dirs.push(path.join(cache, market, plugin, version, 'skills'));
    }
  }
  return dirs;
}

/** [{ name, description, where }] (built-in ones last, unless replaced). */
function listCommands(root, extra = []) {
  const seen = new Map();
  for (const dir of dirsFor(root, 'commands', extra)) {
    let names = [];
    try {
      names = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
    } catch {
      continue;
    }
    for (const f of names.sort()) {
      const name = f.slice(0, -3);
      if (!NAME.test(name) || seen.has(name.toLowerCase())) continue;
      const text = read(path.join(dir, f));
      if (text == null) continue;
      const { meta, body } = frontMatter(text);
      seen.set(name.toLowerCase(), { name, description: (meta.description || firstLine(body)).slice(0, 160), where: dir, text: body });
    }
  }
  for (const [name, c] of Object.entries(BUILT_IN)) {
    if (!seen.has(name)) seen.set(name, { name, description: c.description, where: 'built in', text: c.text });
  }
  return [...seen.values()];
}

/** "/name args" -> { name, text } with the arguments filled in, or null. */
function expandCommand(root, message, extra = []) {
  const m = /^\/([A-Za-z0-9][\w-]*)(?:[ \t]+([\s\S]*))?$/.exec(String(message || '').trim());
  if (!m) return null;
  const cmd = listCommands(root, extra).find((c) => c.name.toLowerCase() === m[1].toLowerCase());
  if (!cmd) return null;
  const args = (m[2] || '').trim();
  const words = args ? args.split(/\s+/) : [];
  let text = cmd.text.trim();
  const usesArgs = /\$ARGUMENTS|\$[1-9]/.test(text);
  text = text.replace(/\$ARGUMENTS/g, args).replace(/\$([1-9])/g, (_, i) => words[Number(i) - 1] || '');
  if (!usesArgs && args) text = `${text}\n\n${args}`;
  return { name: cmd.name, text: text.trim() };
}

/** [{ name, description, dir, file }] */
function listSkills(root, extra = [], shared) {
  if (!Array.isArray(shared)) shared = sharedSkillDirs();
  const seen = new Map();
  for (const dir of [...dirsFor(root, 'skills', extra), ...shared]) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
    } catch {
      continue;
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, e.name, 'SKILL.md');
      const text = read(file);
      if (text == null) continue;
      const { meta, body } = frontMatter(text);
      const name = (meta.name && NAME.test(meta.name) ? meta.name : e.name);
      if (!NAME.test(name) || seen.has(name.toLowerCase())) continue;
      // (Up to 1024 characters, as other agents allow: it's what tells the agent when to use it.)
      seen.set(name.toLowerCase(), { name, description: (meta.description || firstLine(body)).slice(0, 1024), dir: path.join(dir, e.name), file });
    }
  }
  return [...seen.values()];
}

/** The skill's instructions, and the other files next to it. */
function loadSkill(skills, name, root) {
  const skill = skills.find((s) => s.name.toLowerCase() === String(name || '').toLowerCase());
  if (!skill) return null;
  const { body } = frontMatter(read(skill.file) || '');
  let others = [];
  try {
    others = fs.readdirSync(skill.dir).filter((f) => f !== 'SKILL.md').slice(0, 30);
  } catch {
    // only SKILL.md
  }
  const inside = !path.relative(root, skill.dir).startsWith('..') && !path.isAbsolute(path.relative(root, skill.dir));
  const where = inside ? path.relative(root, skill.dir).split(path.sep).join('/') : null;
  return {
    name: skill.name,
    text: body.trim(),
    files: others.map((f) => (where ? `${where}/${f}` : f)),
    readable: !!where
  };
}

// Skills from a GitHub repository ("owner/repo", or its address): every
// folder in it with a SKILL.md is copied into `dest` (the app's own skills, for
// every project). Uses the computer's git. Returns the skills' names.
const REPO = /^(?:https:\/\/github\.com\/)?([A-Za-z0-9][\w.-]*)\/([\w.-]+?)(?:\.git)?\/?$/;
function findSkillDirs(dir, depth = 0, out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  if (entries.some((e) => e.isFile() && e.name === 'SKILL.md')) {
    out.push(dir);
    return out;
  }
  if (depth >= 5) return out;
  for (const e of entries) {
    if (e.isDirectory() && !e.name.startsWith('.git') && e.name !== 'node_modules') findSkillDirs(path.join(dir, e.name), depth + 1, out);
  }
  return out;
}

function addSkillsFromGitHub(repo, dest, { git = 'git', timeoutMs = 120000, url = null } = {}) {
  const m = REPO.exec(String(repo || '').trim());
  if (!m) return Promise.reject(new Error('Write the repository as owner/name, e.g. GoogleChrome/modern-web-guidance.'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'najwa-skills-'));
  return new Promise((resolve, reject) => {
    execFile(git, ['clone', '--depth', '1', url || `https://github.com/${m[1]}/${m[2]}.git`, tmp], { timeout: timeoutMs, windowsHide: true }, (err) => {
      try {
        if (err) {
          reject(new Error(err.code === 'ENOENT' ? 'Adding skills needs Git on this computer (git-scm.com).' : `Couldn't download ${m[1]}/${m[2]}. Check the name and that it's public.`));
          return;
        }
        const added = [];
        for (const dir of findSkillDirs(tmp)) {
          const { meta } = frontMatter(read(path.join(dir, 'SKILL.md')) || '');
          const name = meta.name && NAME.test(meta.name) ? meta.name : path.basename(dir);
          if (!NAME.test(name)) continue;
          const to = path.join(dest, 'skills', name);
          fs.rmSync(to, { recursive: true, force: true });
          fs.mkdirSync(path.dirname(to), { recursive: true });
          fs.cpSync(dir, to, { recursive: true, filter: (src) => !/(^|[\\/])\.git([\\/]|$)/.test(path.relative(dir, src)) });
          added.push(name);
        }
        if (!added.length) reject(new Error(`${m[1]}/${m[2]} has no skills (no SKILL.md files).`));
        else resolve(added);
      } catch (e) {
        reject(e);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });
  });
}

// A skill the user added to the app: removed.
function removeSkill(dest, name) {
  if (!NAME.test(String(name || ''))) return false;
  const dir = path.join(dest, 'skills', name);
  if (!fs.existsSync(path.join(dir, 'SKILL.md'))) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

module.exports = { listCommands, expandCommand, listSkills, loadSkill, frontMatter, sharedSkillDirs, addSkillsFromGitHub, removeSkill, BUILT_IN };
