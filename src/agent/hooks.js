// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// Hooks (Najwa AI Plus): the project's own commands around the agent's tools,
// in .najwa/hooks.json:
//
//   {
//     "before": [{ "tools": ["write_file", "edit_file"], "command": "node scripts/check-path.js" }],
//     "after":  [{ "tools": ["write_file", "edit_file"], "command": "npx prettier --write \"$NAJWA_FILE\"" }]
//   }
//
// A "before" hook that fails (exit code not 0) stops the tool, and its output
// tells the agent why. An "after" hook's output is added to the tool's result
// (lint errors, say). "tools" can be "*". Hooks get NAJWA_TOOL, NAJWA_FILE
// (the file, for file tools), NAJWA_COMMAND (for run_command) and NAJWA_ARGS
// (the tool's arguments as JSON), and run in the project folder.
//
// A project's hooks are its own commands, so they never run on their own: the
// first time (and whenever hooks.json changes) the user is shown them and
// decides. "Always" trusts exactly these hooks (by their fingerprint).

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { runShell } = require('./shell');

const FILE = path.join('.najwa', 'hooks.json');
const TIMEOUT_MS = 60000;

function loadHooks(root) {
  let text;
  try {
    text = fs.readFileSync(path.join(root, FILE), 'utf8');
  } catch {
    return null;
  }
  let cfg;
  try {
    cfg = JSON.parse(text);
  } catch (err) {
    return { error: `.najwa/hooks.json isn't valid JSON: ${err.message}` };
  }
  const clean = (list) => (Array.isArray(list) ? list : [])
    .filter((h) => h && typeof h.command === 'string' && h.command.trim())
    .map((h) => ({ tools: h.tools === '*' ? '*' : (Array.isArray(h.tools) ? h.tools.map(String) : []), command: h.command.trim(), timeout: Math.min(600, Math.max(1, Number(h.timeout_seconds) || TIMEOUT_MS / 1000)) * 1000 }))
    .filter((h) => h.tools === '*' || h.tools.length);
  const hooks = { before: clean(cfg.before), after: clean(cfg.after) };
  if (!hooks.before.length && !hooks.after.length) return null;
  // The fingerprint covers what runs, so any change is asked again.
  const hash = crypto.createHash('sha256').update(JSON.stringify(hooks)).digest('hex').slice(0, 32);
  return { ...hooks, hash };
}

const matches = (h, name) => h.tools === '*' || h.tools.includes(name);

/**
 * @param root     the project folder
 * @param approve  asks the user ({ title, command, description, choices, kind }) -> 'once'|'always'|'deny'
 * @param trusted  fingerprints the user trusts ("always")
 * @param onTrust  (hash) -> remember "always"
 * @param see      the firewall for what goes back to the model
 */
function createHooks({ root, approve, trusted = [], onTrust = () => {}, see = (t) => ({ text: t }) }) {
  const hooks = loadHooks(root);
  let allowed = null;   // null: not asked yet in this reply
  const active = () => hooks && !hooks.error;

  async function trust() {
    if (allowed !== null) return allowed;
    if (trusted.includes(hooks.hash)) return (allowed = true);
    const list = [...hooks.before.map((h) => `before ${h.tools === '*' ? 'every tool' : h.tools.join(', ')}:\n  $ ${h.command}`), ...hooks.after.map((h) => `after ${h.tools === '*' ? 'every tool' : h.tools.join(', ')}:\n  $ ${h.command}`)];
    const choice = await approve({
      title: 'Run this project\'s hooks?',
      command: list.join('\n'),
      description: 'The project asks to run these commands around the agent\'s work (.najwa/hooks.json). Allow them only if you trust this project. If the file changes, you\'re asked again.',
      choices: ['once', 'always', 'deny'],
      kind: 'command'
    });
    if (choice === 'always') onTrust(hooks.hash);
    return (allowed = choice !== 'deny');
  }

  async function runHook(h, name, args, signal) {
    const env = {
      NAJWA_TOOL: name,
      NAJWA_ARGS: JSON.stringify(args || {}).slice(0, 20000),
      ...(typeof args.path === 'string' ? { NAJWA_FILE: args.path } : {}),
      ...(typeof args.command === 'string' ? { NAJWA_COMMAND: args.command } : {})
    };
    return runShell({ command: h.command, cwd: root, timeoutMs: h.timeout, signal, env });
  }

  return {
    get error() {
      return hooks && hooks.error ? hooks.error : null;
    },
    /** Before a tool: null to go on, or the text that stops it. */
    async before(name, args, signal) {
      if (!active()) return null;
      const list = hooks.before.filter((h) => matches(h, name));
      if (!list.length || !(await trust())) return null;
      for (const h of list) {
        const r = await runHook(h, name, args, signal);
        if (r.code !== 0) {
          return `A hook of this project stopped this (${h.command}, exit code ${r.code == null ? 'none: time limit' : r.code}):\n${see(r.output.trim() || '(no output)').text}`;
        }
      }
      return null;
    },
    /** After a tool that worked: text to add to its result, or ''. */
    async after(name, args, signal) {
      if (!active()) return '';
      const list = hooks.after.filter((h) => matches(h, name));
      if (!list.length || !(await trust())) return '';
      const notes = [];
      for (const h of list) {
        const r = await runHook(h, name, args, signal);
        const out = r.output.trim();
        if (r.code !== 0 || out) notes.push(`Hook ${h.command}${r.code !== 0 ? ` (exit code ${r.code == null ? 'none: time limit' : r.code})` : ''}:\n${see(out || '(no output)').text}`);
      }
      return notes.join('\n\n');
    }
  };
}

module.exports = { loadHooks, createHooks, FILE };
