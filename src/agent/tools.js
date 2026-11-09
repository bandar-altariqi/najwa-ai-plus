// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// The agent's tools, for a chat with a project folder: look around the
// project, read, search, change files, run commands and keep a to-do list.
// Used through src/tool-chat.js like the browser and connectors.
//
// Every change goes through the same steps:
//   1. inside the project folder only (paths.js)
//   2. the privacy firewall: secrets hidden from cloud models, private files
//      refused (firewall.js)
//   3. the mode and rules: allowed, asked or refused (permissions.js)
//   4. a second opinion from another model, when set (reviewer.js)
//   5. commands that change files tried in a copy first (dryrun.js)
//   6. the approval card, when asking: the diff, the dry run's result and the
//      second opinion, answered here or from the phone (local-approvals.js)
//   7. the file as it was kept, so it can be undone (checkpoints.js)

'use strict';

const fs = require('fs');
const path = require('path');
const { resolveIn, walk, matcher, SKIP_DIRS, toSlash } = require('./paths');
const { unifiedDiff } = require('./diff');
const { createPermissions } = require('./permissions');
const { dryRun, dryRunFor } = require('./dryrun');
const { runShell, clip } = require('./shell');
const { reviewNote } = require('./reviewer');
const { agentPrompt } = require('./instructions');

const MAX_READ_LINES = 2000;
const MAX_READ_CHARS = 100000;
const MAX_CARD = 12000;

const DEFS = {
  list_files: {
    description: 'List the files and folders in a folder of the project, as a tree. Installed packages and build output (node_modules, dist, .git…) are shown but not opened.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Folder inside the project; leave out for the whole project' },
        depth: { type: 'integer', description: 'How many levels deep (1–5, default 2)' }
      }
    }
  },
  read_file: {
    description: 'Read a text file of the project. Lines come numbered. For a long file, read part of it with offset (first line, from 1) and limit (number of lines).',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, offset: { type: 'integer' }, limit: { type: 'integer' } },
      required: ['path']
    }
  },
  find_files: {
    description: 'Find files by name with a glob pattern, e.g. "**/*.test.js" or "src/**/config.*". Returns paths.',
    parameters: {
      type: 'object',
      properties: { pattern: { type: 'string' }, path: { type: 'string', description: 'Folder to look in; leave out for the whole project' } },
      required: ['pattern']
    }
  },
  search_files: {
    description: 'Search the text of the project\'s files with a regular expression. Returns file:line: text for each match.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'A regular expression (or plain text)' },
        path: { type: 'string', description: 'Folder or file to search; leave out for the whole project' },
        glob: { type: 'string', description: 'Only files matching this glob, e.g. "*.py"' },
        ignore_case: { type: 'boolean' }
      },
      required: ['pattern']
    }
  },
  write_file: {
    description: 'Create a file, or replace a whole file with new content. For changing part of a file, use edit_file instead.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content']
    }
  },
  edit_file: {
    description: 'Change part of a file: old_text (exactly as in the file, including spaces and indentation, and enough of it to be found only once) is replaced with new_text. Set replace_all to change every place it appears.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        old_text: { type: 'string' },
        new_text: { type: 'string' },
        replace_all: { type: 'boolean' }
      },
      required: ['path', 'old_text', 'new_text']
    }
  },
  run_command: {
    description: 'Run a command in the project folder, in the computer\'s shell, and get its output and exit code. Set background to true for one that keeps running (a dev server, a watcher): you get an id for command_output and stop_command.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        timeout_seconds: { type: 'integer', description: 'Time limit (default 120, at most 600)' },
        background: { type: 'boolean' }
      },
      required: ['command']
    }
  },
  command_output: {
    description: 'Read what a background command has printed so far, and whether it\'s still running.',
    parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
  },
  stop_command: {
    description: 'Stop a background command.',
    parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
  },
  todo_write: {
    description: 'Write the to-do list for this task (the whole list each time), so the user sees the plan and progress. Keep exactly one item in_progress while working.',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: { text: { type: 'string' }, status: { type: 'string', enum: ['pending', 'in_progress', 'done'] } },
            required: ['text', 'status']
          }
        }
      },
      required: ['items']
    }
  }
};

const READ_ONLY = new Set(['list_files', 'read_file', 'find_files', 'search_files', 'command_output', 'todo_write']);

const quote = (s, n = 60) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

function describe(call) {
  const a = call.args || {};
  switch (call.name) {
    case 'list_files': return `Looking in ${a.path && a.path !== '.' ? a.path : 'the project'}`;
    case 'read_file': return `Reading ${quote(a.path, 80)}`;
    case 'find_files': return `Finding ${quote(a.pattern)}`;
    case 'search_files': return `Searching for "${quote(a.pattern, 50)}"`;
    case 'write_file': return `Writing ${quote(a.path, 80)}`;
    case 'edit_file': return `Editing ${quote(a.path, 80)}`;
    case 'run_command': return `Running ${quote(a.command, 70)}`;
    case 'command_output': return `Checking ${a.id}`;
    case 'stop_command': return `Stopping ${a.id}`;
    case 'todo_write': return 'Updating the to-do list';
    default: return `Using ${call.name}`;
  }
}

function emoji(call) {
  return { list_files: '📁', read_file: '📄', find_files: '🔎', search_files: '🔎', write_file: '✏️', edit_file: '✏️', run_command: '🖥️', command_output: '🖥️', stop_command: '🖥️', todo_write: '📋' }[call.name] || '🛠️';
}

const isBinary = (buf) => buf.subarray(0, 8000).includes(0);

/**
 * The agent's toolset for one reply.
 * @param root        the project folder
 * @param chatId      the chat (checkpoints and "for this chat" answers)
 * @param mode        'ask' | 'edits' | 'plan' | 'auto'
 * @param options     { rules, dryRun: 'off'|'risky'|'always' }
 * @param firewall    from firewall.js
 * @param approve     ({ title, command, description, choices }) -> 'once'|'session'|'always'|'deny'
 * @param chatAllowed a Set kept for the chat
 * @param checkpoints from checkpoints.js
 * @param reviewer    from reviewer.js, or null
 * @param task        what the user asked for (for the reviewer)
 * @param jobs        background commands (shell.js backgroundJobs)
 * @param onInfo      events for the chat ({ kind: 'todo', items })
 * @param onAlways    (commandStart) -> save "Always allow" in Settings
 */
function agentTools({ root, chatId, mode = 'ask', options = {}, firewall, approve, chatAllowed = new Set(), checkpoints, reviewer = null, task = '', jobs, onInfo = () => {}, onAlways = () => {} }) {
  if (!root || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error('The project folder isn\'t there any more. Choose it again.');
  const perms = createPermissions({ mode, rules: options.rules || [], chatAllowed });
  const dryRunSetting = options.dryRun || 'risky';
  let hidden = 0;

  const see = (text) => {
    const r = firewall.scrub(text);
    hidden += r.hidden;
    return r;
  };
  const shieldNote = (n) => (n ? ` · 🛡️ ${n} secret${n === 1 ? '' : 's'} hidden` : '');
  const inProject = (p) => {
    const r = resolveIn(root, p);
    firewall.checkPrivate(r.rel);
    return r;
  };

  async function secondOpinion(action, detail, signal) {
    if (!reviewer) return { note: '', force: false };
    const review = await reviewer.review({ task, action, detail }, signal);
    return { note: reviewNote(review, reviewer.label), force: !!review && review.verdict !== 'ok', review };
  }

  // A change to one file: ask (when needed), keep the old file, write.
  async function change({ rel, abs, before, after, signal, label }) {
    const diff = unifiedDiff(before, after, rel);
    if (!diff.text) return { text: `${rel} already has that content: nothing changed.`, label: `${label} (no change)` };
    const counts = `+${diff.added} −${diff.removed}`;
    const rule = perms.forEdit();
    if (rule.decision === 'refuse') return { text: rule.why, error: true, label: `${label} (plan mode)` };
    const opinion = await secondOpinion(`${before == null ? 'create' : 'change'} the file ${rel}`, diff.text, signal);
    if (rule.decision === 'ask' || opinion.force) {
      const choice = await approve({
        title: `${before == null ? 'Create' : 'Change'} ${rel} (${counts})`,
        command: diff.text.slice(0, MAX_CARD),
        description: [opinion.note, '"Allow edits for this chat" lets the agent change files in this chat without asking again.'].filter(Boolean).join('\n'),
        choices: ['once', 'session', 'deny'],
        kind: 'edit'
      });
      if (choice === 'deny') {
        return { text: `The user didn't allow this change to ${rel}. Don't make it another way: ask them what they'd like instead.`, error: true, label: `${label} (not allowed)` };
      }
      perms.remember('edit', null, choice);
    }
    const step = checkpoints.begin(chatId, root, `${before == null ? 'Created' : 'Changed'} ${rel}`);
    step.keep(abs, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, after);
    step.done();
    return { text: `${before == null ? 'Created' : 'Changed'} ${rel} (${counts} lines).`, label: `${before == null ? 'Created' : 'Edited'} ${rel} (${counts})` };
  }

  async function runCommand(args, signal) {
    const command = firewall.restore(String(args.command || '').trim());
    if (!command) return { text: 'No command given.', error: true };
    const shown = String(args.command || '').trim();
    const rule = perms.forCommand(command);
    const label = `Ran ${quote(shown, 70)}`;
    if (rule.decision === 'refuse') return { text: rule.why, error: true, label: `${label} (plan mode)` };
    const timeoutMs = Math.min(600, Math.max(5, Number(args.timeout_seconds) || 120)) * 1000;

    if (args.background) {
      if (rule.decision === 'ask') {
        const opinion = await secondOpinion(`run this command in the background: ${shown}`, '', signal);
        const choice = await approve({ title: 'Run in the background', command: `$ ${shown}`, description: [rule.danger ? `⚠️ This command ${rule.danger}.` : '', opinion.note].filter(Boolean).join('\n'), choices: ['once', 'session', 'always', 'deny'], kind: 'command' });
        if (choice === 'deny') return { text: 'The user didn\'t allow this command.', error: true, label: `${label} (not allowed)` };
        const start = perms.remember('command', command, choice);
        if (start) onAlways(start);
      }
      const job = jobs.start(command, root);
      await new Promise((r) => setTimeout(r, 3000));
      const out = see(clip(job.output, 8000));
      return { text: `Started in the background as ${job.id}${job.done ? ` (it already ended, exit code ${job.code})` : ''}. Output so far:\n${out.text || '(nothing yet)'}`, label: `Started ${quote(shown, 60)} (${job.id})${shieldNote(out.hidden)}` };
    }

    // Tried in a copy first, when it would change files and the user would be
    // asked (or always, with dry run set to "every command").
    const dr = dryRunFor(command, dryRunSetting);
    const wouldAsk = rule.decision === 'ask';
    if (dr.use && (wouldAsk || dryRunSetting === 'always')) {
      const trial = await dryRun({ command, root, timeoutMs, signal });
      if (trial) {
        const files = trial.shown.length;
        const summary = files
          ? `Tried in a copy of the project: ${files} file${files === 1 ? '' : 's'} would change${trial.gitChanges ? ` (and Git's own data)` : ''}.`
          : `Tried in a copy of the project: no files would change${trial.gitChanges ? ` (only Git's own data)` : ''}.`;
        const outputPart = trial.output.trim() ? `\n\nIt printed (exit code ${trial.code == null ? 'none: stopped at the time limit' : trial.code}):\n${trial.output.trim().slice(-3000)}` : '';
        const opinion = await secondOpinion(`run this command: ${shown}`, `${summary}\n${trial.diff}${outputPart}`, signal);
        let choice = 'once';
        if (wouldAsk || opinion.force) {
          choice = await approve({
            title: `Run: ${quote(shown, 80)}`,
            command: `$ ${shown}\n\n${summary}\n${trial.diff}${outputPart}`.slice(0, MAX_CARD),
            description: [rule.danger ? `⚠️ This command ${rule.danger}.` : '', opinion.note, 'Allow puts these changes into your project (you can undo them). The command isn\'t run again.'].filter(Boolean).join('\n'),
            choices: ['once', 'session', 'always', 'deny'],
            kind: 'command'
          });
        }
        if (choice === 'deny') {
          trial.discard();
          return { text: `The user didn't allow this command (it was tried in a copy; nothing changed in the project). What it would have done:\n${summary}`, error: true, label: `${label} (not allowed)` };
        }
        const start = perms.remember('command', command, choice);
        if (start) onAlways(start);
        const step = checkpoints.begin(chatId, root, `Ran ${quote(shown, 80)}`);
        try {
          trial.apply(step);
        } finally {
          step.done();
          trial.discard();
        }
        const out = see(trial.output);
        return {
          text: `Exit code: ${trial.code == null ? 'none (stopped at the time limit)' : trial.code}. ${summary.replace('would change', 'changed')}\n${out.text || '(no output)'}`,
          label: `${label}${trial.code ? ` (exit code ${trial.code})` : ''}${shieldNote(out.hidden)}`
        };
      }
    }

    const opinion = await secondOpinion(`run this command: ${shown}`, dr.why || '', signal);
    if (wouldAsk || opinion.force) {
      const choice = await approve({
        title: 'Run a command',
        command: `$ ${shown}`,
        description: [rule.danger ? `⚠️ This command ${rule.danger}.` : '', dr.why || '', opinion.note].filter(Boolean).join('\n'),
        choices: rule.danger ? ['once', 'deny'] : ['once', 'session', 'always', 'deny'],
        kind: 'command'
      });
      if (choice === 'deny') return { text: 'The user didn\'t allow this command. Don\'t run it another way: ask them what they\'d like instead.', error: true, label: `${label} (not allowed)` };
      const start = perms.remember('command', command, choice);
      if (start) onAlways(start);
    }
    const res = await runShell({ command, cwd: root, timeoutMs, signal });
    const out = see(res.output);
    return {
      text: `Exit code: ${res.code == null ? 'none (stopped at the time limit)' : res.code}\n${out.text || '(no output)'}`,
      label: `${label}${res.timedOut ? ' (time limit)' : res.code ? ` (exit code ${res.code})` : ''}${shieldNote(out.hidden)}`
    };
  }

  const tools = {
    list_files(args) {
      const { abs, rel } = inProject(args.path);
      if (!fs.statSync(abs).isDirectory()) return { text: `${rel} is a file, not a folder.`, error: true };
      const depth = Math.min(5, Math.max(1, Number(args.depth) || 2));
      const lines = [];
      let count = 0;
      const walkDir = (dir, prefix, level) => {
        let entries;
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          return;
        }
        entries.sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1));
        for (const e of entries) {
          if (++count > 500) return;
          const childRel = toSlash(path.relative(root, path.join(dir, e.name)));
          if (e.isDirectory()) {
            const skipped = SKIP_DIRS.has(e.name);
            lines.push(`${prefix}${e.name}/${skipped ? ' (not opened)' : ''}`);
            if (!skipped && level < depth) walkDir(path.join(dir, e.name), `${prefix}  `, level + 1);
          } else {
            const priv = firewall.active && firewall.isPrivate(childRel) ? ' (private)' : '';
            lines.push(`${prefix}${e.name}${priv}`);
          }
        }
      };
      walkDir(abs, '', 1);
      if (count > 500) lines.push('… (more not shown: list a smaller folder)');
      return { text: `${rel === '.' ? 'The project' : rel}:\n${lines.join('\n') || '(empty)'}` };
    },

    read_file(args) {
      const { abs, rel } = inProject(args.path);
      const st = fs.statSync(abs);
      if (st.isDirectory()) return { text: `${rel} is a folder. Use list_files.`, error: true };
      const buf = fs.readFileSync(abs);
      if (isBinary(buf)) return { text: `${rel} isn't a text file (${st.size} bytes).`, error: true };
      const all = buf.toString('utf8').split('\n');
      const from = Math.max(1, Number(args.offset) || 1);
      const count = Math.min(MAX_READ_LINES, Math.max(1, Number(args.limit) || MAX_READ_LINES));
      let out = '';
      let last = from - 1;
      for (let i = from - 1; i < Math.min(all.length, from - 1 + count); i++) {
        const line = `${String(i + 1).padStart(5)}  ${all[i].length > 2000 ? `${all[i].slice(0, 2000)}… (line cut)` : all[i]}\n`;
        if (out.length + line.length > MAX_READ_CHARS) break;
        out += line;
        last = i + 1;
      }
      const more = last < all.length ? `\n(${all.length} lines in all. Read on with offset ${last + 1}.)` : '';
      const seen = see(out);
      return { text: `${rel}:\n${seen.text}${more}`, label: `Read ${rel}${shieldNote(seen.hidden)}` };
    },

    find_files(args) {
      const { abs, rel } = inProject(args.path);
      const match = matcher([String(args.pattern || '*')]);
      const found = [];
      walk(root, abs, (fileRel) => {
        const inside = rel === '.' ? fileRel : fileRel.slice(rel.length + 1);
        if (match(inside) || match(fileRel)) found.push(fileRel);
        return found.length < 300;
      });
      return { text: found.length ? `${found.length >= 300 ? 'First 300 matches' : `${found.length} found`}:\n${found.join('\n')}` : 'No files match.' };
    },

    search_files(args) {
      const { abs, rel } = inProject(args.path);
      let re;
      try {
        re = new RegExp(String(args.pattern || ''), args.ignore_case ? 'i' : '');
      } catch {
        re = new RegExp(String(args.pattern || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), args.ignore_case ? 'i' : '');
      }
      const only = args.glob ? matcher([args.glob]) : null;
      const hits = [];
      let privateSkipped = 0;
      const searchFile = (fileRel, fileAbs) => {
        if (only && !only(fileRel)) return true;
        if (firewall.active && firewall.isPrivate(fileRel)) {
          privateSkipped++;
          return true;
        }
        let buf;
        try {
          if (fs.statSync(fileAbs).size > 2 * 1024 * 1024) return true;
          buf = fs.readFileSync(fileAbs);
        } catch {
          return true;
        }
        if (isBinary(buf)) return true;
        const lines = buf.toString('utf8').split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (re.test(lines[i])) {
            hits.push(`${fileRel}:${i + 1}: ${lines[i].trim().slice(0, 300)}`);
            if (hits.length >= 200) return false;
          }
        }
        return true;
      };
      if (fs.statSync(abs).isFile()) searchFile(rel, abs);
      else walk(root, abs, searchFile);
      const seen = see(hits.join('\n'));
      const note = privateSkipped ? `\n(${privateSkipped} private file${privateSkipped === 1 ? '' : 's'} not searched.)` : '';
      return {
        text: hits.length ? `${hits.length >= 200 ? 'First 200 matches' : `${hits.length} match${hits.length === 1 ? '' : 'es'}`}:\n${seen.text}${note}` : `No matches.${note}`,
        label: `Searched for "${quote(args.pattern, 50)}" (${hits.length}${hits.length >= 200 ? '+' : ''})${shieldNote(seen.hidden)}`
      };
    },

    async write_file(args, signal) {
      const { abs, rel } = inProject(args.path);
      if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) return { text: `${rel} is a folder.`, error: true };
      const before = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
      const after = firewall.restore(String(args.content ?? ''));
      return change({ rel, abs, before, after, signal, label: `Writing ${rel}` });
    },

    async edit_file(args, signal) {
      const { abs, rel } = inProject(args.path);
      if (!fs.existsSync(abs)) return { text: `${rel} doesn't exist. Use write_file to create it.`, error: true };
      const before = fs.readFileSync(abs, 'utf8');
      const oldText = firewall.restore(String(args.old_text ?? ''));
      const newText = firewall.restore(String(args.new_text ?? ''));
      if (!oldText) return { text: 'old_text is empty: give the exact text to replace.', error: true };
      const times = before.split(oldText).length - 1;
      if (!times) {
        // A common slip: the file has Windows line endings.
        if (before.includes('\r\n') && before.split(oldText.replace(/\n/g, '\r\n')).length > 1) {
          return tools.edit_file({ ...args, old_text: String(args.old_text).replace(/\n/g, '\r\n'), new_text: String(args.new_text).replace(/\n/g, '\r\n') }, signal);
        }
        return { text: `old_text wasn't found in ${rel}. Read the file again and copy the text exactly (spaces and indentation too).`, error: true, label: `Editing ${rel} (text not found)` };
      }
      if (times > 1 && !args.replace_all) return { text: `old_text appears ${times} times in ${rel}. Include more of the text around it so it's found once, or set replace_all.`, error: true, label: `Editing ${rel} (found ${times} times)` };
      const after = args.replace_all ? before.split(oldText).join(newText) : before.replace(oldText, () => newText);
      return change({ rel, abs, before, after, signal, label: `Editing ${rel}` });
    },

    run_command: (args, signal) => runCommand(args, signal),

    command_output(args) {
      const job = jobs.get(String(args.id));
      if (!job) return { text: `There's no background command ${args.id}.`, error: true };
      const out = see(clip(job.output, 12000));
      return { text: `${job.id} (${job.command}): ${job.done ? `ended, exit code ${job.code}` : 'still running'}\n${out.text || '(no output yet)'}`, label: `Checked ${job.id}${shieldNote(out.hidden)}` };
    },

    stop_command(args) {
      return jobs.stop(String(args.id)) ? { text: `Stopped ${args.id}.` } : { text: `There's no background command ${args.id}.`, error: true };
    },

    todo_write(args) {
      const items = (Array.isArray(args.items) ? args.items : []).slice(0, 30).map((i) => ({
        text: String((i && i.text) || '').slice(0, 200),
        status: ['pending', 'in_progress', 'done'].includes(i && i.status) ? i.status : 'pending'
      })).filter((i) => i.text);
      onInfo({ kind: 'todo', items });
      const done = items.filter((i) => i.status === 'done').length;
      return { text: 'To-do list updated.', label: `To-do list: ${done} of ${items.length} done` };
    }
  };

  return {
    defs: Object.entries(DEFS).map(([name, d]) => ({ name, ...d })),
    owns: (name) => Object.prototype.hasOwnProperty.call(DEFS, name),
    describe,
    emoji,
    readOnly: (name) => READ_ONLY.has(name),
    async run(name, args, signal) {
      const tool = tools[name];
      if (!tool) return { text: `There's no tool called ${name}.`, error: true };
      try {
        return await tool(args || {}, signal);
      } catch (err) {
        if (signal && signal.aborted) throw err;
        return { text: `That didn't work: ${err.message || err}`, error: true };
      }
    },
    close() {},
    system: agentPrompt({ root, mode: perms.mode, firewall: firewall.active, dryRun: dryRunSetting !== 'off', reviewer: !!reviewer }),
    maxSteps: 150,
    contextBudget: 300000,
    hidden: () => hidden
  };
}

module.exports = { agentTools, DEFS, describe };
