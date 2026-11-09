// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// Running the agent's commands: in the project folder, in the computer's own
// shell, with a time limit, and stopped (with everything they started) when
// the reply is stopped. Long-running ones (a dev server) can run in the
// background and be read or stopped later.

'use strict';

const { spawn, spawnSync } = require('child_process');

const MAX_OUTPUT = 30000;

// Output for the model: the start and the end, when it's long.
function clip(text, max = MAX_OUTPUT) {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.2);
  return `${text.slice(0, head)}\n… (${text.length - max} characters left out) …\n${text.slice(text.length - (max - head))}`;
}

function killTree(child) {
  if (!child || child.exitCode != null || child.killed) return;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    else process.kill(-child.pid, 'SIGKILL');
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      // gone already
    }
  }
}

function start(command, cwd, env) {
  return spawn(command, {
    cwd,
    shell: true,
    env: { ...process.env, ...env, CI: process.env.CI || '1', GIT_TERMINAL_PROMPT: '0', NAJWA_AGENT: '1' },
    detached: process.platform !== 'win32',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

/**
 * Run a command to the end.
 * @returns { code, output, timedOut }
 */
function runShell({ command, cwd, timeoutMs = 120000, signal, env = {} }) {
  return new Promise((resolve, reject) => {
    let output = '';
    let timedOut = false;
    const child = start(command, cwd, env);
    const add = (d) => {
      output += d.toString('utf8');
      if (output.length > MAX_OUTPUT * 4) output = output.slice(-MAX_OUTPUT * 2);
    };
    child.stdout.on('data', add);
    child.stderr.on('data', add);
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);
    const onAbort = () => killTree(child);
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve({ code: timedOut ? null : code, output: clip(output), timedOut });
    });
  });
}

// Commands left running in the background (per app run), by id.
function backgroundJobs() {
  const jobs = new Map();
  let n = 0;
  return {
    start(command, cwd) {
      const id = `bg${++n}`;
      const child = start(command, cwd, {});
      const job = { id, command, child, output: '', done: false, code: null };
      const add = (d) => {
        job.output += d.toString('utf8');
        if (job.output.length > MAX_OUTPUT * 4) job.output = job.output.slice(-MAX_OUTPUT * 2);
      };
      child.stdout.on('data', add);
      child.stderr.on('data', add);
      child.on('close', (code) => {
        job.done = true;
        job.code = code;
      });
      child.on('error', (err) => {
        job.done = true;
        job.output += `\n${err.message}`;
      });
      jobs.set(id, job);
      return job;
    },
    get: (id) => jobs.get(id),
    stop(id) {
      const job = jobs.get(id);
      if (job) killTree(job.child);
      return !!job;
    },
    stopAll() {
      for (const job of jobs.values()) killTree(job.child);
    }
  };
}

module.exports = { runShell, backgroundJobs, clip, killTree };
