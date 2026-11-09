// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { compactMessages, summaryStore } = require('../src/agent/compact');

const long = (i) => `message ${i} ${'x'.repeat(1000)}`;
const chat = (n) => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: long(i) }));

test('compaction: short chats as they are; long ones summarised, newest kept', async () => {
  const store = summaryStore(fs.mkdtempSync(path.join(os.tmpdir(), 'najwa-compact-')));
  const asked = [];
  const statuses = [];
  const summarize = async (text) => {
    asked.push(text);
    return `<think>hmm</think>Summary #${asked.length}`;
  };
  const short = chat(4);
  assert.strictEqual((await compactMessages({ chatId: 'c', messages: short, summarize, store, limit: 10000 })).messages, short);

  const msgs = chat(20);   // 20 KB > 10 KB
  const r = await compactMessages({ chatId: 'c', messages: msgs, summarize, store, limit: 10000, keep: 6, onStatus: (s) => statuses.push(s) });
  assert.strictEqual(r.compacted, 14);
  assert.strictEqual(r.messages.length, 2 + 6);
  assert.match(r.messages[0].content, /^\[The earlier part of this conversation \(14 messages\), summarised[\s\S]*\n\nSummary #1$/);
  assert.strictEqual(r.messages[1].role, 'assistant');
  assert.strictEqual(r.messages[2].content, long(14));   // the kept part starts with the user
  assert.strictEqual(r.messages[2].role, 'user');
  assert.match(asked[0], /^User: message 0[\s\S]*Agent: message 13/);
  assert.deepStrictEqual(statuses, ['Summarising the earlier conversation to make room…', '']);

  // Next turn, same older part: the kept summary, no new call.
  await compactMessages({ chatId: 'c', messages: msgs, summarize, store, limit: 10000, keep: 6 });
  assert.strictEqual(asked.length, 1);
  // The chat grew: the summary is extended with only what's new.
  const grown = chat(24);
  const g = await compactMessages({ chatId: 'c', messages: grown, summarize, store, limit: 10000, keep: 6 });
  assert.strictEqual(asked.length, 2);
  assert.match(asked[1], /^Summary so far:\nSummary #1\n\nWhat came after:\nUser: message 14[\s\S]*Agent: message 17 x+$/);
  assert.strictEqual(g.compacted, 18);
  // An older part that changed (a message edited): written again from the start.
  const edited = chat(24);
  edited[3] = { role: 'assistant', content: 'changed' };
  await compactMessages({ chatId: 'c', messages: edited, summarize, store, limit: 10000, keep: 6 });
  assert.match(asked[2], /^User: message 0/);
  // No summary (the model failed to write one): the messages as they are.
  const none = await compactMessages({ chatId: 'd', messages: msgs, summarize: async () => '', store, limit: 10000 });
  assert.strictEqual(none.messages, msgs);
});
