// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// Connectors (Settings → Connectors): services the model can use through
// their MCP tools, like GitHub. Tools a connector marks as read-only run by
// themselves; anything else waits for the user's answer (Allow once, Allow
// for this chat, Always allow, Deny) in the chat, like Hermes Agent's
// approvals, unless the user turned on "Allow everything without asking"
// for that connector (autoApprove).
//
// A connector in settings:
//   { id, name, kind: 'github' | 'url' | 'command', enabled, autoApprove,
//     url, token,                 // on the internet (the token is sent as "Bearer …")
//     command, args, env }        // a program on this computer (desktop only)
// Tokens stay on the device (encrypted on computers) and aren't synced.

'use strict';

const { mcpClient } = require('./mcp-client');

const GITHUB_URL = 'https://api.githubcopilot.com/mcp/';
const CACHE_MS = 5 * 60 * 1000;
const MAX_RESULT = 20000;

const slug = (s) => String(s || 'tool').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 20) || 'tool';
const humanize = (s) => {
  const t = String(s || '').replace(/[_-]+/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const firstSentence = (s) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  const m = /^(.{20,300}?[.!?])(\s|$)/.exec(t);
  return (m ? m[1] : t).slice(0, 300);
};

const emojiOf = (c) => (c.kind === 'github' ? '🐙' : c.kind === 'command' ? '🧩' : '🔌');
const urlOf = (c) => (c.kind === 'github' ? GITHUB_URL : String(c.url || '').trim());

// What a call is about, for the step shown in the chat: a file, an issue…
function hintOf(args) {
  const a = args || {};
  const v = a.path || a.title || a.query || a.q || (a.issue_number && `#${a.issue_number}`) || (a.pullNumber && `#${a.pullNumber}`)
    || (a.pull_number && `#${a.pull_number}`) || (a.owner && a.repo && `${a.owner}/${a.repo}`) || a.repo || a.name || '';
  const t = String(v).replace(/\s+/g, ' ').trim();
  return t ? ` ${t.length > 48 ? `${t.slice(0, 47)}…` : t}` : '';
}

// A tool's result, as the model reads it.
function resultOf(r) {
  const parts = [];
  let image = null;
  for (const c of (r && r.content) || []) {
    if (c.type === 'text') parts.push(c.text);
    else if (c.type === 'image' && c.data && !image) image = `data:${c.mimeType || 'image/png'};base64,${c.data}`;
    else if (c.type === 'resource' && c.resource) parts.push(c.resource.text || `(${c.resource.uri})`);
    else if (c.type === 'resource_link') parts.push(`${c.name || c.uri}: ${c.uri}`);
  }
  if (!parts.length && r && r.structuredContent) parts.push(JSON.stringify(r.structuredContent));
  let text = parts.join('\n\n') || '(no result)';
  if (text.length > MAX_RESULT) text = `${text.slice(0, MAX_RESULT)}\n… (cut short)`;
  return { text, ...(image ? { image } : {}), ...(r && r.isError ? { error: true } : {}) };
}

/**
 * Keeps connections to connectors between replies.
 * @param transportFor (connector) -> an MCP transport (src/mcp-client.js)
 */
function connectorHub({ transportFor, version }) {
  const open = new Map(); // connector id -> { key, client, tools, at }

  const keyOf = (c) => JSON.stringify([c.kind, urlOf(c), c.token || '', c.command || '', c.args || [], c.env || {}]);

  const clientOf = (c) => {
    const key = keyOf(c);
    let entry = open.get(c.id);
    if (entry && entry.key !== key) {
      entry.client.close();
      entry = null;
    }
    if (!entry) {
      entry = { key, client: mcpClient(transportFor(c), { version }), tools: null, at: 0 };
      open.set(c.id, entry);
    }
    return entry;
  };

  const toolsOf = async (c, signal) => {
    const entry = clientOf(c);
    if (!entry.tools || Date.now() - entry.at > CACHE_MS) {
      entry.tools = await entry.client.listTools(signal);
      entry.at = Date.now();
    }
    return entry.tools;
  };

  return {
    /** Connects and lists the tools: { ok, server, tools } or { ok: false, error }. */
    async test(c) {
      try {
        const entry = clientOf(c);
        entry.tools = null;
        const tools = await toolsOf(c);
        const server = entry.client.server();
        return { ok: true, server: server ? `${server.name || ''} ${server.version || ''}`.trim() : '', tools: tools.map((t) => t.name) };
      } catch (err) {
        open.delete(c.id);
        return { ok: false, error: err.message || String(err) };
      }
    },

    /**
     * The enabled connectors' tools for one reply, for src/tool-chat.js.
     * @param approve  ({ connectorId, title, command, description }) -> 'once' | 'session' | 'always' | 'deny'
     * @param allowed  a Set of tools the user allowed for this chat (filled in here)
     */
    async toolset(connectors, { approve, allowed = new Set(), signal } = {}) {
      const byName = new Map();
      const defs = [];
      const problems = [];
      const names = [];
      const trusted = []; // connectors allowed to do anything without asking
      for (const c of connectors.filter((x) => x && x.enabled !== false)) {
        let tools;
        try {
          tools = await toolsOf(c, signal);
        } catch (err) {
          problems.push(`${c.name} couldn't be reached (${err.message || err}).`);
          continue;
        }
        names.push(c.name);
        if (c.autoApprove) trusted.push(c.name);
        const { client } = clientOf(c);
        const prefix = slug(c.name);
        for (const t of tools) {
          const name = `${prefix}__${t.name}`.slice(0, 64);
          if (byName.has(name)) continue;
          byName.set(name, { c, t, client, readOnly: !!(t.annotations && t.annotations.readOnlyHint) });
          const schema = t.inputSchema && t.inputSchema.type === 'object' ? t.inputSchema : { type: 'object', properties: {} };
          defs.push({ name, description: `[${c.name}] ${t.description || t.title || humanize(t.name)}`.slice(0, 1024), parameters: schema });
        }
      }

      return {
        defs,
        connected: names,
        trusted,
        problems,
        owns: (name) => byName.has(name),
        emoji: (call) => (byName.has(call.name) ? emojiOf(byName.get(call.name).c) : '🔌'),
        describe(call) {
          const e = byName.get(call.name);
          if (!e) return `Using ${call.name}`;
          return `${e.c.name}: ${e.t.title || humanize(e.t.name)}${hintOf(call.args)}`;
        },
        async run(name, args, sig) {
          const e = byName.get(name);
          if (!e) return { text: `There's no tool called ${name}.`, error: true };
          const key = `${e.c.id}/${e.t.name}`;
          const all = `${e.c.id}/*`;
          if (!e.readOnly && !e.c.autoApprove && !allowed.has(key) && !allowed.has(all)) {
            const choice = await approve({
              connectorId: e.c.id,
              title: `${e.c.name}: ${e.t.title || humanize(e.t.name)}`,
              command: `${e.c.name} → ${e.t.name}\n${JSON.stringify(args || {}, null, 2)}`.slice(0, 2000),
              description: firstSentence(e.t.description) || `${e.c.name} wants to ${humanize(e.t.name).toLowerCase()}.`
            });
            if (choice === 'deny' || !choice) {
              return { text: 'The user said no to this. Don\'t do it unless they ask for it again.', error: true };
            }
            if (choice === 'session') allowed.add(key);
            // (also saved in the connector's settings by the app)
            if (choice === 'always') allowed.add(all);
          }
          return resultOf(await e.client.callTool(e.t.name, args, sig));
        }
      };
    },

    close() {
      for (const e of open.values()) e.client.close();
      open.clear();
    }
  };
}

// Added to the system prompt when connectors are on.
function connectorsNote(system, set) {
  const lines = [];
  if (set.connected.length) {
    lines.push(`You're connected to: ${set.connected.join(', ')}. Use their tools for the user's work there.`);
    const asks = set.connected.filter((n) => !(set.trusted || []).includes(n));
    if (asks.length) lines.push(`With ${asks.join(', ')}, reading is free; anything that changes something (a commit, a pull request, an issue, a comment…) waits for the user's approval, so say what you're about to do first.`);
    if ((set.trusted || []).length) lines.push(`The user has allowed everything with ${set.trusted.join(', ')} without asking: carry out the whole job without stopping to ask for permission, and say what you changed at the end.`);
  }
  if (set.problems.length) lines.push(set.problems.join(' '));
  if (!lines.length) return system;
  return system ? `${system}\n\n${lines.join('\n')}` : lines.join('\n');
}

// Added in chats with tools but no project folder: what to tell a user who asks
// for something these tools can't do (run commands, install a program, add an
// MCP server), instead of only saying no. `place`: 'computer' or 'phone'.
function capabilitiesNote(system, place) {
  const note = place === 'phone'
    ? 'If the user asks for something your tools in this chat can\'t do (run commands or code, install software, add tools or an MCP server), don\'t just say no: tell them how to get it in Najwa AI Plus. An MCP server on the internet: Settings → Connectors → "Add by address" (its URL), then you can use its tools here. One that runs as a program (for example "npx -y some-mcp"), and running commands or code, need a computer with Najwa AI Plus: add it there under Settings → Connectors → "Add a program on this computer", or give the chat a project folder (📁 Project at the top); this phone can then choose the computer\'s folder with 📁 Project.'
    : 'If the user asks for something your tools in this chat can\'t do (run commands or code, install software, add tools or an MCP server), don\'t just say no: tell them how to get it in Najwa AI Plus. To work in files and run commands, they give this chat a project folder (📁 Project at the top). To add an MCP server\'s tools: Settings → Connectors → "Add a program on this computer" for one started with a command (Command: npx, Arguments: -y and the package, one per line), or "Add by address" for one on the internet (its URL). Its tools then work in chats.';
  return system ? `${system}\n\n${note}` : note;
}

module.exports = { connectorHub, connectorsNote, capabilitiesNote, resultOf, GITHUB_URL, urlOf };
