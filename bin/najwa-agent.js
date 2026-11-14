#!/usr/bin/env node
// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// najwa-agent: Najwa AI Plus's agent without the window, for a terminal or a
// script. The same tools, permissions, privacy firewall, undo checkpoints,
// budget guard, slash commands, skills, hooks and helpers as the app.
//
//   najwa-agent [options] "what to do"
//
// In a terminal, the agent's questions are asked there. Without one (a
// script, CI), every question is answered "no", unless --yes allows the
// ordinary ones; risky commands, a project's hooks and the budget question
// are never allowed without a person.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { parseArgs } = require('util');

const HELP = `najwa-agent: Najwa AI Plus's agent in a project folder, from the terminal.

  najwa-agent [options] "what to do"        (or the task on standard input)

Options:
  --dir <folder>        the project folder (default: this folder)
  --mode <mode>         ask | edits | plan | auto (default: ask)
  --provider <name>     openaiCompatible | openai | anthropic | ollama (default: openaiCompatible)
  --model <name>        the model (or NAJWA_MODEL)
  --url <url>           the server (or NAJWA_URL), e.g. https://api.deepseek.com
  --key-env <VAR>       the environment variable that holds the API key (default: NAJWA_API_KEY)
  --reviewer <model>    a second opinion on each change and command, from the same server
  --dry-run <when>      risky | always | off (default: risky)
  --budget-usd <n>      stop and ask at this cost (needs --prices)
  --budget-tokens <n>   stop and ask at this many tokens
  --prices <text>       "model = in / out" dollars per million tokens (or NAJWA_PRICES)
  --no-firewall         let a cloud model see secrets (not recommended)
  --yes                 without a terminal, allow the ordinary questions (never the risky ones)
  --json                print every event as a JSON line (for scripts)
  --quiet               print only the answer
  -h, --help

Exit code 0 when the agent finished, 1 on an error, 2 for wrong options.`;

function fail(msg, code = 2) {
  process.stderr.write(`najwa-agent: ${msg}\n`);
  process.exit(code);
}

async function main() {
  let opts;
  try {
    opts = parseArgs({
      allowPositionals: true,
      options: {
        dir: { type: 'string' }, mode: { type: 'string' }, provider: { type: 'string' }, model: { type: 'string' }, url: { type: 'string' },
        'key-env': { type: 'string' }, reviewer: { type: 'string' }, 'dry-run': { type: 'string' }, 'budget-usd': { type: 'string' },
        'budget-tokens': { type: 'string' }, prices: { type: 'string' }, 'no-firewall': { type: 'boolean' }, yes: { type: 'boolean' },
        json: { type: 'boolean' }, quiet: { type: 'boolean' }, help: { type: 'boolean', short: 'h' }
      }
    });
  } catch (err) {
    fail(`${err.message}\n\n${HELP}`);
  }
  const o = opts.values;
  if (o.help) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  let task = opts.positionals.join(' ').trim();
  if (!task && !process.stdin.isTTY) task = fs.readFileSync(0, 'utf8').trim();
  if (!task) fail(`say what to do.\n\n${HELP}`);

  const { chatWithTools, TOOL_KINDS } = require('../src/tool-chat');
  const { PROVIDERS } = require('../src/providers');
  const { agentTools } = require('../src/agent/tools');
  const { createFirewall, isLocalModel } = require('../src/agent/firewall');
  const { createCheckpoints } = require('../src/agent/checkpoints');
  const { createReviewer } = require('../src/agent/reviewer');
  const { backgroundJobs } = require('../src/agent/shell');
  const { expandCommand } = require('../src/agent/commands');
  const { helperRunner } = require('../src/agent/helpers');
  const { MODES } = require('../src/agent/permissions');

  const provider = o.provider || 'openaiCompatible';
  if (!TOOL_KINDS[provider]) fail(`--provider must be one of ${Object.keys(TOOL_KINDS).join(', ')}.`);
  const mode = o.mode || 'ask';
  if (!MODES.includes(mode)) fail(`--mode must be one of ${MODES.join(', ')}.`);
  const model = o.model || process.env.NAJWA_MODEL;
  if (!model) fail('say which model (--model or NAJWA_MODEL).');
  const root = path.resolve(o.dir || process.cwd());
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) fail(`${root} isn't a folder.`);
  const key = process.env[o['key-env'] || 'NAJWA_API_KEY'] || '';
  const defaults = { ollama: 'http://127.0.0.1:11434', openaiCompatible: 'http://127.0.0.1:1234/v1', openai: 'https://api.openai.com/v1' };
  const cfg = { baseUrl: o.url || process.env.NAJWA_URL || defaults[provider] || '', apiKey: key };
  const local = isLocalModel(provider, cfg);

  const json = !!o.json;
  const quiet = !!o.quiet;
  const say = (text) => {
    if (!json && !quiet) process.stderr.write(text);
  };
  const emit = (evt) => {
    if (json) process.stdout.write(`${JSON.stringify(evt)}\n`);
  };
  const terminal = process.stdin.isTTY && process.stderr.isTTY && !json;

  // Questions: asked in the terminal, or answered by the rules above.
  async function approve(card) {
    emit({ type: 'question', ...card });
    const risky = card.kind === 'budget' || /hooks/.test(card.title || '') || (card.kind === 'command' && !(card.choices || []).includes('session'));
    if (!terminal) {
      const answer = o.yes && !risky ? 'once' : 'deny';
      say(`\n? ${card.title}: ${String(card.command || '').split('\n')[0].slice(0, 120)}\n  → ${answer === 'once' ? 'allowed (--yes)' : risky ? 'refused (needs a person)' : 'refused (no terminal; --yes allows it)'}\n`);
      emit({ type: 'answer', answer });
      return answer;
    }
    const choices = card.choices && card.choices.length ? card.choices : ['once', 'deny'];
    const keys = { once: 'y', session: 's', always: 'a', deny: 'n' };
    const names = { once: card.kind === 'budget' ? 'keep going' : 'yes, once', session: 'for this run', always: 'always', deny: card.kind === 'budget' ? 'stop' : 'no' };
    process.stderr.write(`\n┌ ${card.title}\n${String(card.command || '').split('\n').map((l) => `│ ${l}`).join('\n')}\n${card.description ? `${card.description.split('\n').map((l) => `│ ${l}`).join('\n')}\n` : ''}└ ${choices.map((c) => `[${keys[c]}] ${names[c]}`).join('  ')} `);
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    try {
      for (;;) {
        const a = (await new Promise((r) => rl.question('', r))).trim().toLowerCase();
        const choice = choices.find((c) => keys[c] === a[0]);
        if (choice) return choice;
        process.stderr.write(`  ${choices.map((c) => keys[c]).join('/')}? `);
      }
    } finally {
      rl.close();
    }
  }

  const data = path.join(os.homedir(), '.najwa-agent');
  const steps = new Map();
  const onInfo = (i) => {
    emit({ type: 'info', ...i });
    if (i.kind === 'tool' && i.status === 'completed') {
      const label = i.label || steps.get(i.id) || '';
      say(`  ${steps.has(i.id) ? '·' : '·'} ${label}\n`);
    } else if (i.kind === 'tool' && i.label) steps.set(i.id, i.label);
    else if (i.kind === 'todo') say(`  📋 ${i.items.map((t) => `${t.status === 'done' ? '✓' : t.status === 'in_progress' ? '▸' : '○'} ${t.text}`).join('  ')}\n`);
  };
  const firewall = createFirewall({ enabled: !o['no-firewall'], cloud: !local });
  const reviewer = o.reviewer ? createReviewer({
    label: o.reviewer,
    scrub: (t) => firewall.scrub(t).text,
    chat: (r, sig) => {
      let text = '';
      return PROVIDERS[provider].impl.streamChat(cfg, { model: o.reviewer, ...r }, (p) => { text += p; }, sig, () => {}).then(() => text);
    }
  }) : null;
  const tools = agentTools({
    root,
    chatId: `cli-${Date.now().toString(36)}`,
    mode,
    model,
    local,
    options: {
      rules: [],
      dryRun: o['dry-run'] || 'risky',
      prices: o.prices || process.env.NAJWA_PRICES || '',
      budgetUsd: Number(o['budget-usd']) || 0,
      budgetTokens: Number(o['budget-tokens']) || 0,
      skillDirs: [data, path.join(__dirname, '..')],
      runHelper: helperRunner({ kind: TOOL_KINDS[provider], cfg, model, onInfo })
    },
    firewall,
    approve,
    checkpoints: createCheckpoints(path.join(data, 'checkpoints')),
    reviewer,
    task,
    jobs: backgroundJobs(),
    onInfo
  });
  const cmd = expandCommand(root, task, [data]);
  if (cmd) say(`/${cmd.name}\n`);

  const controller = new AbortController();
  process.on('SIGINT', () => {
    if (controller.signal.aborted) process.exit(130);
    say('\nStopping… (Ctrl+C again to quit now)\n');
    controller.abort();
  });

  say(`Najwa AI Plus agent · ${model} · ${mode} · ${root}\n`);
  let thinking = false;
  const out = (piece) => {
    emit({ type: 'text', text: piece });
    if (json) return;
    // Thinking goes to stderr (dimmed), the answer to stdout.
    let rest = piece;
    while (rest) {
      if (thinking) {
        const end = rest.indexOf('</think>');
        const part = end < 0 ? rest : rest.slice(0, end);
        if (!quiet) process.stderr.write(`\x1b[2m${part}\x1b[0m`);
        if (end < 0) return;
        thinking = false;
        rest = rest.slice(end + 8);
      } else {
        const start = rest.indexOf('<think>');
        process.stdout.write(start < 0 ? rest : rest.slice(0, start));
        if (start < 0) return;
        thinking = true;
        rest = rest.slice(start + 7);
      }
    }
  };
  try {
    const res = await chatWithTools({
      kind: TOOL_KINDS[provider],
      cfg,
      req: { model, system: tools.system, messages: [{ role: 'user', content: cmd ? cmd.text : task }], maxTokens: 16000 },
      onDelta: out,
      onInfo,
      signal: controller.signal,
      tools
    });
    if (res.fallback) fail(`${model} can't use tools, so it can't work as an agent.`, 1);
    if (!json) process.stdout.write('\n');
    const b = tools.budget;
    if (b.tokens) say(`\n💰 ${b.summary()}\n`);
    emit({ type: 'done', tokens: b.tokens, usd: b.usd });
    return 0;
  } catch (err) {
    if (controller.signal.aborted) {
      say('\nStopped.\n');
      return 130;
    }
    emit({ type: 'error', message: String(err.message || err) });
    process.stderr.write(`\nnajwa-agent: ${err.message || err}\n`);
    return 1;
  } finally {
    tools.close();
  }
}

main().then((code) => process.exit(code || 0), (err) => fail(err.stack || String(err), 1));
