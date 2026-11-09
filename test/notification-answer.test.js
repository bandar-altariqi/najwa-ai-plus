// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// Allow or Deny tapped on the agent's phone notification: the real function
// from renderer/app.js, with the card answering faked.

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '../renderer/app.js'), 'utf8');
const start = src.indexOf('async function answerFromNotification(');
const fn = src.slice(start, src.indexOf('\n}\n', start) + 3);

function world(approvals) {
  const answered = [];
  const chat = { id: 'c1', messages: [{ id: 'm1', role: 'assistant', approvals }] };
  const ctx = {
    S: { cache: new Map([['c1', chat]]) },
    loadChat: async () => null,
    answerApproval: async (c, msg, a, choice) => { answered.push([a.runId, choice]); a.state = choice; }
  };
  vm.createContext(ctx);
  vm.runInContext(`${fn}; this.answer = answerFromNotification;`, ctx);
  return { answer: ctx.answer, answered };
}

test('notification answers: Allow only where the card allows it, never for a risky one', async () => {
  const w = world([
    { runId: 'local:edit', state: 'pending', askKind: 'edit', choices: ['once', 'session', 'always', 'deny'] },
    { runId: 'local:rm', state: 'pending', askKind: 'command', choices: ['once', 'deny'] },   // risky: no "for this chat"
    { runId: 'local:budget', state: 'pending', askKind: 'budget', choices: ['once', 'deny'] },
    { runId: 'local:done', state: 'once', askKind: 'edit', choices: ['once', 'session', 'deny'] }
  ]);
  await w.answer({ chatId: 'c1', runId: 'local:edit', choice: 'once' });
  await w.answer({ chatId: 'c1', runId: 'local:rm', choice: 'once' });       // a forged Allow is a Deny
  await w.answer({ chatId: 'c1', runId: 'local:budget', choice: 'once' });
  await w.answer({ chatId: 'c1', runId: 'local:done', choice: 'deny' });     // answered already: nothing
  await w.answer({ chatId: 'nope', runId: 'local:edit', choice: 'deny' });
  await w.answer({ chatId: 'c1', runId: 'local:edit', choice: 'deny' });     // answered now: nothing
  assert.deepStrictEqual(w.answered, [['local:edit', 'once'], ['local:rm', 'deny'], ['local:budget', 'deny']]);
});
