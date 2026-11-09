// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { linkKey, remoteComputers } = require('../src/remote');
const { startRemoteServer } = require('../src/remote-server');
const { toBase64 } = require('../src/sync');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The computer's side as main.js does it: a running reply registers its
// steering by job; the "steer" request finds it.
async function computer(key) {
  const steering = new Map();
  const got = [];
  const server = await startRemoteServer({
    port: 0,
    host: '127.0.0.1',
    getKey: async () => linkKey(key),
    handlers: {
      hello: async () => ({ app: 'balimda', name: 'Desk' }),
      models: async () => [{ provider: 'ollama', label: 'Ollama', short: 'Ollama', models: ['m'] }],
      chat: async (msg, { emit }) => {
        // A reply working with tools takes messages; it reads them between steps.
        const s = { send: (text, id) => got.push({ text, id }) > 0 };
        steering.set(String(msg.job), s);
        try {
          emit({ t: 'delta', text: 'Working. ' });
          for (let i = 0; i < 100 && !got.length; i++) await sleep(20);
          const said = got.map((g) => g.text).join(' ');
          emit({ t: 'info', info: { kind: 'steer', id: got[0] && got[0].id, status: 'read' } });
          emit({ t: 'delta', text: `You said: ${said}` });
          return { text: `Working. You said: ${said}` };
        } finally {
          steering.delete(String(msg.job));
        }
      },
      steer: async (msg) => {
        const s = steering.get(String(msg.of));
        return !!(s && s.send && s.send(String(msg.text), msg.id));
      }
    }
  });
  return { server, got, addr: { id: 'desk', name: 'Desk', addrs: ['127.0.0.1'], port: server.port, enabled: true } };
}

test('the phone steers a reply running on the computer', async () => {
  const key = toBase64(globalThis.crypto.getRandomValues(new Uint8Array(32)));
  const pc = await computer(key);
  try {
    const phone = remoteComputers({ getKey: async () => key, getComputers: async () => ({ desk: pc.addr }) });
    await phone.listModels();
    const steering = { send: null };
    const infos = [];
    let sent = null;
    const r = await phone.streamChat({}, { model: 'm (Desk)', messages: [{ role: 'user', content: 'fix it' }], steering }, () => {
      if (!sent) sent = steering.send('also update the README', 's1');
    }, undefined, (i) => infos.push(i));
    assert.strictEqual(await sent, true);
    assert.strictEqual(r.text, 'Working. You said: also update the README');
    assert.deepStrictEqual(pc.got, [{ text: 'also update the README', id: 's1' }]);
    assert.deepStrictEqual(infos, [{ kind: 'steer', id: 's1', status: 'read' }]);
    // The reply is over: a late message isn't taken (the phone sends it as the next one).
    assert.strictEqual(await steering.send('too late', 's2'), false);
  } finally {
    await pc.server.close();
  }
});
