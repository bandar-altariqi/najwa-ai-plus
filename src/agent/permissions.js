// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// What the agent may do without asking, per chat (the mode next to the
// project folder):
//
//   ask    asks before every change to a file and every command (the default)
//   edits  changes files on its own, asks before commands
//   plan   reads only: looks around and writes a plan, changes nothing
//   auto   does everything on its own, except commands that could do harm
//
// Reading is always allowed (the privacy firewall still applies). Commands
// you said "Always allow" to (by their first words, e.g. "npm test") and
// harmless read-only ones (git status, ls…) don't ask in any mode but plan.
// Commands that could do harm, or reach outside the project, ask in every
// mode, auto included.

'use strict';

const MODES = ['ask', 'edits', 'plan', 'auto'];

// Read-only commands that never need asking (first word, or first two).
const SAFE = [
  /^(?:ls|dir|pwd|cat|head|tail|wc|tree|file|stat|du|df|which|where|whoami|echo|date|uname|env|printenv|type)\b(?![^|;&]*(?:>|\|\s*(?:sh|bash|zsh)\b))/,
  /^git\s+(?:status|diff|log|show|branch|remote\s+-v|rev-parse|ls-files|blame|describe|tag\s*$|stash\s+list)\b(?![^|;&]*>)/,
  /^(?:rg|grep|find)\b(?![^|;&]*(?:-delete|-exec|>))/,
  /^(?:node|npm|npx|python3?|pip3?|go|cargo|rustc|java|dotnet|ruby|php|deno|bun)\s+(?:-v|--version|version)\s*$/,
  /^npm\s+(?:ls|list|outdated|view|why)\b/
];

// Could do harm or reach outside the project: always asked, in every mode.
const DANGER = [
  [/\brm\s+(?:-[a-zA-Z]*[rf][a-zA-Z]*\s+)+(?:\/|~|\$HOME|\*|\.\.?\/?\s*$)/, 'deletes a lot of files'],
  [/\b(?:sudo|doas|su)\b/, 'runs as administrator'],
  [/\b(?:mkfs|fdisk|diskpart|format\s+[a-z]:|dd\s+if=)/i, 'can wipe a disk'],
  [/\b(?:shutdown|reboot|halt|poweroff)\b/, 'turns the computer off'],
  [/:\(\)\s*\{\s*:\|:&\s*\};:/, 'a fork bomb'],
  [/\b(?:curl|wget|iwr|Invoke-WebRequest)\b[^|]*\|\s*(?:sh|bash|zsh|python3?|node|iex)\b/i, 'runs a script from the internet'],
  [/\bgit\s+push\b/, 'publishes to a remote repository'],
  [/\bgit\s+(?:reset\s+--hard|clean\s+-[a-zA-Z]*f|checkout\s+--\s|filter-branch|rebase)\b/, 'can throw away work'],
  [/\b(?:npm|pnpm|yarn)\s+publish\b|\btwine\s+upload\b|\bcargo\s+publish\b|\bgem\s+push\b/, 'publishes a package'],
  [/\b(?:ssh|scp|sftp|rsync)\b/, 'connects to another computer'],
  [/\b(?:docker|podman|kubectl|helm|terraform|pulumi|ansible-playbook)\b/, 'changes containers or servers'],
  [/\bchmod\s+(?:-R\s+)?[0-7]*7[0-7]*\b|\bchown\s+-R\b/, 'changes permissions widely'],
  [/\b(?:crontab|systemctl|launchctl|schtasks|reg\s+(?:add|delete)|setx)\b/i, 'changes system settings'],
  [/(?:^|[;&|]\s*)(?:>|>>)\s*\/(?:etc|usr|bin|boot|System)\b|>\s*~\//, 'writes outside the project'],
  [/\b(?:npm|pnpm|yarn)\s+(?:i|install|add)\s+(?:-g|--global)\b|\bpip3?\s+install\b(?![^|;&]*(?:-r\s|--requirement|-e\s+\.|\.\s*$))/, 'installs software on the computer'],
  [/\bcurl\b[^|;&]*\s-(?:X\s*(?:POST|PUT|DELETE|PATCH)|d\b|F\b)|\bwget\b[^|;&]*--post/i, 'sends data to a website']
];

// How an "Always allow" is remembered: the program and what it does
// ("npm test", "python3 -m pytest", "npm run build"), not its other arguments.
const RUNNERS = new Set(['run', 'exec', 'x', 'dlx', '-m', '-c', 'make', 'manage.py']);
function firstWords(cmd) {
  const words = String(cmd).trim().split(/\s+/).filter(Boolean);
  const out = [];
  let plain = 0;
  for (const w of words) {
    out.push(w);
    if (w.startsWith('-') && !RUNNERS.has(w)) continue;
    if (RUNNERS.has(w)) continue;
    if (++plain >= 2) break;
  }
  return out.join(' ');
}

function dangerOf(command) {
  const c = String(command || '');
  for (const [re, why] of DANGER) if (re.test(c)) return why;
  return null;
}

// Every part of a chained command must be safe on its own.
const parts = (command) => String(command || '').split(/&&|\|\||;|\n/).map((p) => p.trim()).filter(Boolean);
const isSafe = (command) => parts(command).length > 0 && parts(command).every((p) => SAFE.some((re) => re.test(p)));

/**
 * The rules for one reply.
 * @param mode        one of MODES
 * @param rules       commands always allowed (by their start, e.g. "npm test")
 * @param chatAllowed a Set kept for the chat: 'edits' and command starts allowed "for this chat"
 */
function createPermissions({ mode = 'ask', rules = [], chatAllowed = new Set() } = {}) {
  const m = MODES.includes(mode) ? mode : 'ask';
  const ruled = (command) => parts(command).every((p) => rules.concat([...chatAllowed].filter((r) => r !== 'edits'))
    .some((r) => r && (p === r || p.startsWith(`${r} `))));
  return {
    mode: m,
    // 'allow' | 'ask' | 'refuse', with why for refusals and forced questions.
    forEdit() {
      if (m === 'plan') return { decision: 'refuse', why: 'Plan mode: the agent reads and plans, but doesn\'t change files. Switch the mode to let it.' };
      if (m === 'edits' || m === 'auto' || chatAllowed.has('edits')) return { decision: 'allow' };
      return { decision: 'ask' };
    },
    forCommand(command) {
      const danger = dangerOf(command);
      if (m === 'plan') {
        if (!danger && isSafe(command)) return { decision: 'allow' };
        return { decision: 'refuse', why: 'Plan mode: only commands that just look (like git status or ls) can run. Switch the mode to let it run others.' };
      }
      if (danger) return { decision: 'ask', danger };
      if (isSafe(command) || ruled(command)) return { decision: 'allow' };
      if (m === 'auto') return { decision: 'allow' };
      return { decision: 'ask' };
    },
    // An answer of "for this chat" or "always": what to remember.
    remember(kind, command, choice) {
      if (choice !== 'session' && choice !== 'always') return null;
      if (kind === 'edit') {
        chatAllowed.add('edits');
        return null;
      }
      const start = firstWords(command);
      if (!start || dangerOf(command)) return null;
      if (choice === 'session') chatAllowed.add(start);
      return choice === 'always' ? start : null;   // the caller saves it in Settings
    }
  };
}

module.exports = { createPermissions, dangerOf, isSafe, firstWords, MODES };
