// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// A model adding a connector (an MCP server's tools) by itself (Najwa AI Plus).
//
// The user asks for something a tool would do ("search flights with LetsFG");
// the model finds the MCP server and calls add_connector. The app checks the
// proposal, shows it on a card (what will run, where it's from, a warning) and
// adds it only if the user taps Add: never automatically, in any mode. It then
// starts it to check it works, saves it in Settings → Connectors, and its tools
// can be used in the same reply.
//
// What a model can propose is kept narrow, since on Windows a program connector
// is started through the shell: a known package launcher (npx, uvx, bunx,
// pnpx) with plain arguments (a package name, flags), or an https address. No
// environment variables or tokens: keys are added by the user in Settings.
// The model only adds; changing or removing connectors is the user's.

'use strict';

const LAUNCHERS = ['npx', 'uvx', 'bunx', 'pnpx'];
// A package name, a version, a flag or a plain value: nothing a shell reads as
// something else (no spaces, quotes, &, |, ;, $, `, %, ^, <, >, parentheses).
const SAFE_ARG = /^[A-Za-z0-9@][A-Za-z0-9@._/:=+~,-]*$|^--?[A-Za-z0-9][A-Za-z0-9._=-]*$/;
const MAX_ARGS = 12;

const DEF = {
  name: 'add_connector',
  description: 'Add a connector: an MCP server whose tools you can then use. Use it when the user asks for something an MCP server would do (search flights, a service\'s data…) and you know the server: look it up first (its official page or package), and only add one from its real source. The user sees exactly what will run and must approve; it\'s never added without them. For a server that runs as a program on the computer, give command (npx, uvx, bunx or pnpx) and args (e.g. ["-y", "letsfg-mcp"]); for one on the internet, give url (https). If it needs an API key, don\'t ask for it in the chat: after adding, tell the user to add the key in Settings → Connectors. Once added, its tools are available to you right away.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'A short name for it, e.g. "LetsFG"' },
      command: { type: 'string', enum: LAUNCHERS, description: 'For a program: the launcher' },
      args: { type: 'array', items: { type: 'string' }, description: 'For a program: its arguments, e.g. ["-y", "letsfg-mcp"]' },
      url: { type: 'string', description: 'For a server on the internet: its MCP address (https://…)' },
      source: { type: 'string', description: 'Where it comes from: its official page, repository or package link' },
      why: { type: 'string', description: 'One sentence for the user: what it lets you do for them' }
    },
    required: ['name', 'source', 'why']
  }
};

const plain = (s, n) => String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

function httpsUrl(u) {
  try {
    const url = new URL(String(u || '').trim());
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

/**
 * Checks what a model proposes. Returns { connector } (not saved yet),
 * { exists: name } when the same one is already there, or { error }.
 * @param place 'computer' or 'phone' (a phone can only add one by address)
 */
function checkProposal(args, { existing = [], place = 'computer' } = {}) {
  const name = plain(args && args.name, 40);
  if (!name) return { error: 'Give the connector a short name.' };
  const source = httpsUrl(args && args.source);
  if (!source) return { error: 'Give the link to where it comes from (its official page, repository or package, https://…), so the user can check it.' };
  const why = plain(args && args.why, 300);
  const id = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const base = { id, name, enabled: true, autoApprove: false, addedBy: 'assistant', source };

  if (args && args.url) {
    if (args.command) return { error: 'Give either a url or a command, not both.' };
    const url = httpsUrl(args.url);
    if (!url) return { error: 'The address must be a plain https:// link.' };
    const same = existing.find((c) => c && c.kind === 'url' && String(c.url || '').trim() === url);
    if (same) return { exists: same.name };
    return { connector: { ...base, kind: 'url', url }, why };
  }

  if (place === 'phone') return { error: 'This phone can only add a connector that\'s on the internet (an https address). One that runs as a program needs a computer with Najwa AI Plus: tell the user to ask there.' };
  const command = String((args && args.command) || '').trim();
  if (!LAUNCHERS.includes(command)) return { error: `For a program, the command must be one of ${LAUNCHERS.join(', ')}.` };
  const list = Array.isArray(args.args) ? args.args.map((a) => String(a).trim()).filter(Boolean) : [];
  if (!list.length) return { error: 'Give the arguments, e.g. ["-y", "the-package"].' };
  if (list.length > MAX_ARGS) return { error: `At most ${MAX_ARGS} arguments.` };
  const bad = list.find((a) => a.length > 200 || !SAFE_ARG.test(a));
  if (bad !== undefined) return { error: `"${plain(bad, 60)}" can't be used: arguments are plain package names, versions and flags (no spaces or special characters). Keys and settings with them are added by the user in Settings → Connectors.` };
  if (!list.some((a) => !a.startsWith('-'))) return { error: 'The arguments need the package to run.' };
  const same = existing.find((c) => c && c.kind === 'command' && c.command === command && JSON.stringify(c.args || []) === JSON.stringify(list));
  if (same) return { exists: same.name };
  return { connector: { ...base, kind: 'command', command, args: list }, why };
}

// What runs, as the card shows it.
const runsAs = (c) => (c.kind === 'command' ? [c.command, ...c.args].join(' ') : c.url);

/**
 * The add_connector tool for one reply.
 * @param place     'computer' or 'phone'
 * @param existing  () -> the connectors in settings now
 * @param save      (connectors) -> saves the whole list
 * @param test      (connector) -> { ok, tools, server } | { ok: false, error }
 * @param approve   asks the user (src/local-approvals.js asker): 'once' adds it
 * @param onAdded   (connector) -> makes its tools usable in this reply
 */
function connectorInstaller({ place = 'computer', existing, save, test, approve, onAdded }) {
  return {
    defs: [DEF],
    owns: (name) => name === DEF.name,
    emoji: () => '🧩',
    describe: (call) => `Adding the connector ${plain(call.args && call.args.name, 40) || ''}`.trim(),
    async run(name, args) {
      const p = checkProposal(args || {}, { existing: (await existing()) || [], place });
      if (p.error) return { text: p.error, error: true };
      if (p.exists) return { text: `"${p.exists}" is already in Settings → Connectors: use its tools (if it's turned off there, ask the user to turn it on).` };
      const c = p.connector;
      const program = c.kind === 'command';
      const choice = await approve({
        kind: 'install',
        title: `Add the connector "${c.name}"?`,
        command: runsAs(c),
        description: [
          p.why || null,
          `From: ${c.source}`,
          program
            ? 'This downloads and runs a program from the internet on this computer, with your permissions. Add it only if you trust where it comes from.'
            : 'Najwa AI will send it what the model asks it to do. Add it only if you trust it.'
        ].filter(Boolean).join('\n'),
        choices: ['once', 'deny']
      });
      if (choice !== 'once') return { text: 'The user chose not to add it. Don\'t add it again unless they ask.', error: true };
      const t = await test(c);
      if (!t || !t.ok) return { text: `It didn't start, so nothing was added: ${(t && t.error) || 'no answer'}.${program ? ` Tell the user what it needs (for example ${c.command === 'uvx' ? 'uv and Python' : 'Node.js'} on this computer), or try another source.` : ''}`, error: true };
      await save([...((await existing()) || []), c]);
      await onAdded(c);
      const tools = (t.tools || []).slice(0, 30);
      return {
        text: `Added "${c.name}" to Settings → Connectors${tools.length ? `, with ${tools.length} tool${tools.length === 1 ? '' : 's'}: ${tools.join(', ')}` : ''}. Its tools are yours to use now. If it needs a key, the user adds it in Settings → Connectors.`,
        label: `🧩 Added the connector ${c.name}`
      };
    }
  };
}

module.exports = { connectorInstaller, checkProposal, LAUNCHERS, runsAs };
