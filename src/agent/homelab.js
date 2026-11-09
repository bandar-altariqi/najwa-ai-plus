// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// Homelab agent (Najwa AI Plus): the agent works on the user's own machines
// over SSH (Tailscale names work), each with its own permission:
//
//   look  only commands that look (docker ps, df, systemctl status, logs…)
//   ask   every other command is asked first
//   auto  commands run, but risky ones (deleting containers or volumes,
//         rm -rf /, reboots, sudo…) are still asked, every time
//
// Machines are set in Settings → Agent, one a line:  name = user@host : look
// ssh runs with BatchMode (keys only, never a password prompt) and a short
// connect timeout. What comes back goes through the privacy firewall.

'use strict';

const { execFile } = require('child_process');
const { isSafe, dangerOf } = require('./permissions');

const ACCESS = ['look', 'ask', 'auto'];
const MAX_OUT = 30000;

/** "name = user@host : access" lines -> [{ name, host, access }] */
function parseMachines(text) {
  const out = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.replace(/#.*/, '').trim();
    const m = /^([A-Za-z0-9][\w.-]{0,40})\s*=\s*([^\s:]+(?:@[^\s:]+)?)\s*(?::\s*(look|ask|auto))?\s*$/i.exec(line);
    if (!m || out.some((x) => x.name.toLowerCase() === m[1].toLowerCase())) continue;
    // A host is a name or an address (user@ allowed), never an ssh option.
    if (!/^(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9.-]+$|^(?:[A-Za-z0-9._-]+@)?\[?[0-9a-fA-F:]+\]?$/.test(m[2]) || m[2].startsWith('-')) continue;
    out.push({ name: m[1], host: m[2], access: (m[3] || 'ask').toLowerCase() });
  }
  return out;
}

// Looking on a server: the project rules plus the usual admin ones.
const LOOK = [
  /^docker\s+(?:ps|images|logs|inspect|stats\s+--no-stream|version|info|compose\s+(?:ps|logs|config|ls))\b/,
  /^podman\s+(?:ps|images|logs|inspect)\b/,
  /^(?:systemctl\s+(?:status|is-active|is-enabled|list-units|list-timers)|journalctl)\b/,
  /^(?:uptime|free|df|du|ps|top\s+-bn1|uname|hostname|whoami|id|ip\s+(?:a|addr|route|r)\b|ss\s+-|netstat|lsblk|lscpu|nproc|sensors|zpool\s+(?:status|list)|zfs\s+list|tailscale\s+(?:status|ip))\b/,
  /^(?:cat|head|tail|ls|wc|grep|find)\s+(?!.*(?:-delete|-exec|>))/
];
const parts = (command) => String(command || '').split(/&&|\|\||;|\n/).map((p) => p.trim()).filter(Boolean);
const looks = (command) => {
  const ps = parts(command);
  return ps.length > 0 && !/[>`]|\$\(/.test(command) && ps.every((p) => LOOK.some((re) => re.test(p)) || isSafe(p));
};

// On a server, docker and ssh are the point; these are the risky ones.
const SERVER_DANGER = [
  [/\bdocker\s+(?:rm|rmi|kill|system\s+prune|volume\s+(?:rm|prune)|network\s+rm|compose\s+down\b[^|;&]*(?:-v|--volumes))\b/, 'deletes containers, images or their data'],
  [/\bdocker\s+compose\s+down\b/, 'stops and removes a set of containers'],
  [/\b(?:zpool|zfs)\s+(?:destroy|rollback)\b/, 'can delete data on a disk pool']
];
function serverDanger(command) {
  for (const [re, why] of SERVER_DANGER) if (re.test(command)) return why;
  // A command that only looks (systemctl status, journalctl…) isn't risky.
  if (looks(command)) return null;
  const base = dangerOf(command);
  // Reaching other machines and changing containers is what this is for.
  return base && !/connects to another computer|changes containers or servers/.test(base) ? base : null;
}

/** 'allow' | 'ask' | 'refuse' for a command on a machine, with why. */
function decide(machine, command, mode) {
  const danger = serverDanger(command);
  if (looks(command) && !danger) return { decision: 'allow' };
  if (mode === 'plan' || machine.access === 'look') {
    return { decision: 'refuse', why: mode === 'plan' ? 'Plan mode: only commands that look can run on machines.' : `${machine.name} is set to "look" (Settings → Agent → Machines): only commands that look can run there.` };
  }
  if (danger) return { decision: 'ask', danger };
  return { decision: machine.access === 'auto' ? 'allow' : 'ask' };
}

function ssh(host, command, timeoutMs, signal) {
  return new Promise((resolve) => {
    const args = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=accept-new', '-T', host, '--', command];
    execFile('ssh', args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, signal }, (err, stdout, stderr) => {
      const out = `${stdout || ''}${stderr ? `${stdout ? '\n' : ''}${stderr}` : ''}`;
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : null) : 0, output: out.length > MAX_OUT ? `${out.slice(0, MAX_OUT / 5)}\n… (${out.length - MAX_OUT} characters left out) …\n${out.slice(-(MAX_OUT * 4) / 5)}` : out, error: err && typeof err.code !== 'number' ? String(err.message) : '' });
    });
  });
}

const HOMELAB_DEFS = {
  list_machines: {
    description: 'List the user\'s machines (servers, a NAS, a Raspberry Pi…) you can run commands on, and what each allows.',
    parameters: { type: 'object', properties: {} }
  },
  run_on_machine: {
    description: 'Run a shell command on one of the user\'s machines over SSH, and get its output and exit code. Commands that only look (docker ps, df, systemctl status, journalctl…) always run; others depend on the machine\'s permission and may be asked. Run one task across several machines by calling this for each.',
    parameters: {
      type: 'object',
      properties: { machine: { type: 'string' }, command: { type: 'string' }, timeout_seconds: { type: 'integer', description: 'Time limit (default 60, at most 600)' } },
      required: ['machine', 'command']
    }
  }
};

/**
 * @param machines   from parseMachines
 * @param mode       the chat's mode
 * @param approve    asks the user
 * @param see        the firewall
 * @param run        (host, command, timeoutMs, signal) -> { code, output } (ssh; replaceable for tests)
 */
function homelabTools({ machines, mode, approve, see = (t) => ({ text: t, hidden: 0 }), run = ssh, secondOpinion = async () => ({ note: '', force: false }) }) {
  const find = (name) => machines.find((m) => m.name.toLowerCase() === String(name || '').toLowerCase());
  return {
    list_machines() {
      return { text: machines.map((m) => `${m.name} (${m.host}): ${m.access === 'look' ? 'look only' : m.access === 'auto' ? 'runs commands; risky ones asked' : 'every command that changes something is asked'}`).join('\n'), label: `Machines (${machines.length})` };
    },
    async run_on_machine(args, signal) {
      const m = find(args.machine);
      if (!m) return { text: `There's no machine called ${args.machine}. Machines: ${machines.map((x) => x.name).join(', ')}.`, error: true };
      const command = String(args.command || '').trim();
      if (!command) return { text: 'No command given.', error: true };
      const label = `On ${m.name}: ${command.length > 60 ? `${command.slice(0, 59)}…` : command}`;
      const rule = decide(m, command, mode);
      if (rule.decision === 'refuse') return { text: rule.why, error: true, label: `${label} (not allowed)` };
      const opinion = rule.decision === 'allow' && !rule.danger && looks(command) ? { note: '', force: false } : await secondOpinion(`run this command on the machine ${m.name} (${m.host}): ${command}`, '', signal);
      if (rule.decision === 'ask' || opinion.force) {
        const choice = await approve({
          title: `Run on ${m.name}`,
          command: `${m.host} $ ${command}`,
          description: [rule.danger ? `⚠️ This command ${rule.danger}.` : '', opinion.note].filter(Boolean).join('\n'),
          choices: ['once', 'deny'],
          kind: 'command'
        });
        if (choice === 'deny') return { text: 'The user didn\'t allow this command. Don\'t run it another way: ask them what they\'d like instead.', error: true, label: `${label} (not allowed)` };
      }
      const timeoutMs = Math.min(600, Math.max(1, Number(args.timeout_seconds) || 60)) * 1000;
      const r = await run(m.host, command, timeoutMs, signal);
      if (r.error && r.code == null) {
        const why = /ENOENT/.test(r.error) ? 'SSH isn\'t installed on this computer (it\'s needed to reach machines).' : r.error;
        return { text: `Couldn't run it on ${m.name}: ${why}`, error: true, label: `${label} (didn't work)` };
      }
      if (r.code === 255 && /Permission denied|Could not resolve|Connection (?:refused|timed out)|No route/i.test(r.output)) {
        return { text: `Couldn't reach ${m.name} (${m.host}) over SSH:\n${r.output.trim()}\nSSH needs a key for this machine (no passwords), and the machine must be on.`, error: true, label: `${label} (unreachable)` };
      }
      const out = see(r.output);
      return { text: `Exit code: ${r.code == null ? 'none (stopped at the time limit)' : r.code}\n${out.text || '(no output)'}`, label: `${label}${r.code ? ` (exit code ${r.code})` : ''}` };
    }
  };
}

/** Tailscale's machines (tailscale status --json): [{ name, host, online }] */
function tailscaleMachines(statusJson) {
  const s = typeof statusJson === 'string' ? JSON.parse(statusJson) : statusJson;
  return Object.values((s && s.Peer) || {}).map((p) => ({
    name: String(p.HostName || '').replace(/[^\w.-]/g, '-').slice(0, 40) || 'machine',
    host: String(p.DNSName || (p.TailscaleIPs || [])[0] || '').replace(/\.$/, ''),
    online: !!p.Online,
    os: p.OS || ''
  })).filter((m) => m.host);
}

module.exports = { parseMachines, homelabTools, HOMELAB_DEFS, decide, looks, serverDanger, tailscaleMachines, ACCESS };
