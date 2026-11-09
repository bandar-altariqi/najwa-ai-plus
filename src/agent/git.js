// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// Git tools for the agent (Najwa AI Plus): status, diff and log only look, so
// they work in every mode; commit asks like a command does (and the card shows
// exactly what goes in). git runs with its arguments as a list, never through
// a shell, so nothing the model writes becomes a command. Files the privacy
// firewall keeps from cloud models are left out of diffs, and secrets in what
// comes back are hidden like everywhere else. Pushing stays a run_command,
// which always asks (it reaches outside the project).

'use strict';

const { execFile } = require('child_process');

const MAX_OUT = 60000;

const GIT_DEFS = {
  git_status: {
    description: 'Show the project\'s Git status: the branch, and which files are changed, staged or new.',
    parameters: { type: 'object', properties: {} }
  },
  git_diff: {
    description: 'Show what changed, as a diff: the uncommitted changes (staged: true for only what is staged), or against another commit or branch (ref).',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Only this file or folder' },
        staged: { type: 'boolean' },
        ref: { type: 'string', description: 'A commit, branch or tag to compare with, e.g. HEAD~1 or main' }
      }
    }
  },
  git_log: {
    description: 'Show recent commits (newest first), optionally for one file or folder.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, count: { type: 'integer', description: 'How many (default 10, at most 50)' } }
    }
  },
  git_commit: {
    description: 'Commit changes with a message. Commits the files given in paths, or every change when paths is left out. The user approves the commit (they see the message and the files). It never pushes.',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'The commit message: a short first line, then details if useful' },
        paths: { type: 'array', items: { type: 'string' }, description: 'Files to commit; leave out to commit every change' }
      },
      required: ['message']
    }
  }
};

const GIT_READ_ONLY = new Set(['git_status', 'git_diff', 'git_log']);

// A ref from the model: a name or a commit, not an option.
const safeRef = (ref) => /^[A-Za-z0-9._/~^@{}-]+$/.test(ref) && !ref.startsWith('-');

function git(root, args, signal) {
  return new Promise((resolve) => {
    execFile('git', ['-c', 'core.quotepath=off', '-c', 'color.ui=false', ...args], { cwd: root, maxBuffer: 8 * 1024 * 1024, timeout: 60000, signal, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat' } }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: String(stdout || ''), err: String(stderr || '') || (err && !stderr ? String(err.message) : '') });
    });
  });
}

const clip = (t) => (t.length > MAX_OUT ? `${t.slice(0, MAX_OUT)}\n… (${t.length - MAX_OUT} more characters left out)` : t);

/**
 * @param root        the project folder
 * @param inProject   path -> { abs, rel } (throws outside the project or for a private file)
 * @param isPrivate   rel -> true for files cloud models mustn't read
 * @param see         text -> { text, hidden } (the firewall)
 * @param askCommit   ({ message, files, stat }) -> true to commit
 */
function gitTools({ root, inProject, isPrivate = () => false, see, askCommit }) {
  const notRepo = (r) => /not a git repository/i.test(r.err);
  const failed = (r) => ({ text: notRepo(r) ? 'This project folder isn\'t a Git repository.' : `git didn't work: ${r.err.trim() || `exit code ${r.code}`}`, error: true });
  // The changed files, private ones left out.
  async function changedFiles(args, signal) {
    const r = await git(root, ['diff', '--name-only', '-z', ...args], signal);
    if (r.code) return { error: r };
    const all = r.out.split('\0').filter(Boolean);
    return { files: all.filter((f) => !isPrivate(f)), left: all.filter((f) => isPrivate(f)) };
  }

  return {
    async git_status(_args, signal) {
      const r = await git(root, ['status', '--short', '--branch'], signal);
      if (r.code) return failed(r);
      const out = see(r.out.trim() || '(nothing)');
      return { text: out.text || 'Nothing changed.', label: 'Git status' };
    },

    async git_diff(args, signal) {
      const base = [];
      if (args.staged) base.push('--cached');
      if (args.ref) {
        if (!safeRef(String(args.ref))) return { text: `"${args.ref}" isn't a commit or branch name.`, error: true };
        base.push(String(args.ref));
      }
      const scope = args.path ? [inProject(args.path).rel || '.'] : [];
      const list = await changedFiles([...base, '--', ...scope], signal);
      if (list.error) return failed(list.error);
      if (!list.files.length) return { text: list.left.length ? `Only private files changed (${list.left.length}); their contents stay on this computer.` : 'No changes.', label: 'Git diff (no changes)' };
      const r = await git(root, ['diff', '--no-ext-diff', ...base, '--', ...list.files], signal);
      if (r.code) return failed(r);
      const out = see(clip(r.out));
      const note = list.left.length ? `\n(Left out, private: ${list.left.join(', ')})` : '';
      return { text: `${out.text}${note}`, label: `Git diff (${list.files.length} file${list.files.length === 1 ? '' : 's'})` };
    },

    async git_log(args, signal) {
      const n = Math.min(50, Math.max(1, Number(args.count) || 10));
      const scope = args.path ? ['--', inProject(args.path).rel || '.'] : [];
      const r = await git(root, ['log', `-${n}`, '--date=short', '--pretty=format:%h %ad %an: %s', ...scope], signal);
      if (r.code) return /does not have any commits/i.test(r.err) ? { text: 'No commits yet.' } : failed(r);
      return { text: see(r.out.trim() || 'No commits.').text, label: `Git log (${n})` };
    },

    async git_commit(args, signal) {
      const message = String(args.message || '').trim();
      if (!message) return { text: 'A commit needs a message.', error: true };
      const paths = Array.isArray(args.paths) && args.paths.length ? args.paths.map((p) => inProject(p).rel) : null;
      const st = await git(root, ['status', '--porcelain', '-z', ...(paths ? ['--', ...paths] : [])], signal);
      if (st.code) return failed(st);
      const files = st.out.split('\0').filter(Boolean).map((l) => l.slice(3)).filter(Boolean);
      if (!files.length) return { text: 'Nothing to commit.', label: 'Git commit (nothing to commit)' };
      const priv = files.filter((f) => isPrivate(f));
      if (priv.length) return { text: `These are private files, so the agent doesn't commit them: ${priv.join(', ')}. Commit the other files by name (paths), or ask the user to commit them.`, error: true };
      const stat = await git(root, ['diff', '--stat', 'HEAD', '--', ...(paths || [])], signal);
      if (!(await askCommit({ message, files, stat: stat.code ? '' : stat.out.trim() }, signal))) {
        return { text: 'The user didn\'t allow this commit. Don\'t commit another way: ask them what they\'d like instead.', error: true, label: 'Git commit (not allowed)' };
      }
      const add = await git(root, ['add', '-A', '--', ...(paths || ['.'])], signal);
      if (add.code) return failed(add);
      const r = await git(root, ['commit', '-m', message, ...(paths ? ['--', ...paths] : [])], signal);
      if (r.code) return failed(r);
      const head = await git(root, ['log', '-1', '--pretty=format:%h'], signal);
      return { text: `Committed ${head.out.trim()}: ${message.split('\n')[0]}\n${see(r.out.trim()).text}`, label: `Committed ${head.out.trim()} (${files.length} file${files.length === 1 ? '' : 's'})` };
    }
  };
}

module.exports = { gitTools, GIT_DEFS, GIT_READ_ONLY, safeRef };
