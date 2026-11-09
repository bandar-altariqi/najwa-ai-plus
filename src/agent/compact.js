// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// Compaction (Najwa AI Plus): a long agent chat's older messages are
// summarised by the model, and the summary goes to the model in their place;
// the newest messages stay word for word. The chat itself keeps everything.
// A summary is kept (per chat, in the app's data folder) and extended as the
// chat grows, so it isn't written again every turn. Within one reply, older
// tool results are shortened separately (compactResults in tool-chat.js).

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const COMPACT_AT = 120000;   // characters of history (about 30k tokens)
const KEEP = 6;              // newest messages kept word for word
const MAX_SUMMARY = 12000;

const SUMMARY_SYSTEM = 'You summarise a conversation between a user and a coding agent, so the agent can carry on without the earlier messages. Write: the goal; decisions and the user\'s wishes; files created or changed (exact paths) and what changed; commands run and results that matter; what is done; what is left or open. Keep names, paths, numbers and error messages exact. Leave out chit-chat. At most 600 words, plain text.';

const textOf = (content) => (typeof content === 'string' ? content : Array.isArray(content) ? content.map((p) => (typeof p === 'string' ? p : (p && p.text) || '')).join('\n') : '');
const sizeOf = (messages) => messages.reduce((n, m) => n + textOf(m.content).length, 0);
const digest = (messages) => crypto.createHash('sha256').update(JSON.stringify(messages.map((m) => [m.role, textOf(m.content)]))).digest('hex').slice(0, 32);
const transcript = (messages) => messages.map((m) => `${m.role === 'user' ? 'User' : 'Agent'}: ${textOf(m.content)}`).join('\n\n');

function summaryStore(dir) {
  const fileOf = (chatId) => path.join(dir, `${String(chatId).replace(/[^\w-]/g, '_').slice(0, 80)}.json`);
  return {
    get(chatId) {
      try {
        return JSON.parse(fs.readFileSync(fileOf(chatId), 'utf8'));
      } catch {
        return null;
      }
    },
    set(chatId, value) {
      try {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(fileOf(chatId), JSON.stringify(value));
      } catch {
        // next time it's written again
      }
    }
  };
}

const withSummary = (summary, count, rest) => [
  { role: 'user', content: `[The earlier part of this conversation (${count} messages), summarised to make room. Ask the user if something you need is missing.]\n\n${summary}` },
  { role: 'assistant', content: 'Understood. I\'ll carry on from there.' },
  ...rest
];

/**
 * The messages for the model: as they are when short; else a summary of the
 * older ones (kept and extended in `store`) and the newest ones.
 * @param summarize  (text) -> summary (the model, with SUMMARY_SYSTEM)
 * @param onStatus   (text) -> shown while it summarises
 */
async function compactMessages({ chatId, messages, summarize, store = null, limit = COMPACT_AT, keep = KEEP, onStatus = () => {} }) {
  if (!chatId || messages.length <= keep + 1 || sizeOf(messages) <= limit) return { messages, compacted: 0 };
  const saved = store && store.get(chatId);
  // A kept summary stays as it is while what came after it is under half the
  // limit: no summary call each turn, and the start of what the model gets
  // doesn't change, so providers' prompt caching keeps working (cached input
  // is far cheaper, so a summary rewritten every turn can cost more than it saves).
  if (saved && saved.count < messages.length && saved.digest === digest(messages.slice(0, saved.count)) && sizeOf(messages.slice(saved.count)) <= limit / 2) {
    return { messages: withSummary(saved.summary, saved.count, messages.slice(saved.count)), compacted: saved.count, usage: null };
  }
  // The kept part starts with a message of the user's.
  let cut = messages.length - keep;
  while (cut > 1 && messages[cut].role !== 'user') cut--;
  if (cut < 2) return { messages, compacted: 0 };
  const older = messages.slice(0, cut);
  let summary = null;
  let sent = 0;
  const ask = (text) => {
    sent = text.length + SUMMARY_SYSTEM.length;
    return summarize(text);
  };
  if (saved && saved.count <= older.length && saved.digest === digest(older.slice(0, saved.count))) {
    if (saved.count === older.length) summary = saved.summary;
    else {
      onStatus('Updating the summary of the earlier conversation…');
      summary = await ask(`Summary so far:\n${saved.summary}\n\nWhat came after:\n${transcript(older.slice(saved.count))}`);
    }
  } else {
    onStatus('Summarising the earlier conversation to make room…');
    summary = await ask(transcript(older));
  }
  summary = String(summary || '').replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim().slice(0, MAX_SUMMARY);
  if (!summary) return { messages, compacted: 0 };
  if (store) store.set(chatId, { count: older.length, digest: digest(older), summary });
  onStatus('');
  // What writing the summary cost, for the task's budget (estimated: about 4
  // characters a token; nothing when the kept summary was reused).
  const usage = sent ? { input: Math.ceil(sent / 4), output: Math.ceil(summary.length / 4) } : null;
  return { messages: withSummary(summary, older.length, messages.slice(cut)), compacted: older.length, usage };
}

module.exports = { compactMessages, summaryStore, SUMMARY_SYSTEM, COMPACT_AT, KEEP };
