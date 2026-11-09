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
const path = require('path');

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
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_-]+)\s*:\s*(.*)$/.exec(line);
    if (kv) meta[kv[1].toLowerCase()] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return { meta, body: text.slice(m[0].length) };
}

const firstLine = (body) => (body.split('\n').map((l) => l.replace(/^#+\s*/, '').trim()).find(Boolean) || '').slice(0, 120);

// Where to look, most specific first: the project's .najwa, its .claude, then the app's.
const dirsFor = (root, kind, extra = []) => [path.join(root, '.najwa', kind), path.join(root, '.claude', kind), ...extra.map((d) => path.join(d, kind))];

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
function listSkills(root, extra = []) {
  const seen = new Map();
  for (const dir of dirsFor(root, 'skills', extra)) {
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
      seen.set(name.toLowerCase(), { name, description: (meta.description || firstLine(body)).slice(0, 300), dir: path.join(dir, e.name), file });
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

module.exports = { listCommands, expandCommand, listSkills, loadSkill, frontMatter, BUILT_IN };
