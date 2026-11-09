// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// Questions to the user from the app's own tools (a connector wanting to change
// something): shown in the chat as an approval card, like Hermes Agent's, and
// answered with Allow once, Allow for this chat, Always allow (the app then
// stops asking for that connector) or Deny. Unanswered ones are denied after
// 10 minutes, or when the reply is stopped.

'use strict';

const WAIT_MS = 10 * 60 * 1000;

function localApprovals() {
  const pending = new Map();       // id -> done(choice)
  const byChat = new Map();        // chat id -> Set of tools allowed for that chat
  let n = 0;
  return {
    // Tools the user allowed for this chat ("Allow for this chat").
    allowedFor(chatId) {
      if (!chatId) return new Set();
      if (!byChat.has(chatId)) byChat.set(chatId, new Set());
      return byChat.get(chatId);
    },
    // An approve() for src/connectors.js, asking through onInfo. `origin`
    // ({ id, name, computer }) says which device asked, so a chat synced to
    // another device shows where to answer (or answers through the computer).
    asker(onInfo, signal, origin = null) {
      return (a) => new Promise((resolve) => {
        const id = `local:${Date.now().toString(36)}-${++n}`;
        const done = (choice) => {
          if (!pending.has(id)) return;
          pending.delete(id);
          clearTimeout(timer);
          resolve(choice);
        };
        const timer = setTimeout(() => done('deny'), WAIT_MS);
        pending.set(id, done);
        if (signal) signal.addEventListener('abort', () => done('deny'), { once: true });
        onInfo({
          kind: 'approval', runId: id, approvalId: null, connectorId: a.connectorId || null, title: a.title, command: a.command, description: a.description,
          choices: Array.isArray(a.choices) && a.choices.length ? a.choices : ['once', 'session', 'always', 'deny'], origin,
          // The agent's questions (src/agent/tools.js): 'edit' (a diff) or 'command'.
          ...(a.kind ? { askKind: a.kind } : {})
        });
      });
    },
    owns: (payload) => !!payload && typeof payload.runId === 'string' && payload.runId.startsWith('local:'),
    // The user's answer; false if that question isn't waiting any more.
    answer(payload) {
      const done = pending.get(payload.runId);
      if (!done) return false;
      done(['once', 'session', 'always'].includes(payload.choice) ? payload.choice : 'deny');
      return true;
    }
  };
}

module.exports = { localApprovals };
