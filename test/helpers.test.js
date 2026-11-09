// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chatWithTools } = require('../src/tool-chat');
const { agentTools } = require('../src/agent/tools');
const { helperRunner } = require('../src/agent/helpers');
const { createFirewall } = require('../src/agent/firewall');
const { createCheckpoints } = require('../src/agent/checkpoints');
const { backgroundJobs } = require('../src/agent/shell');

const sse = (res, events) => {
  res.setHeader('Content-Type', 'text/event-stream');
  for (const e of events) res.write(`data: ${JSON.stringify(e)}\n\n`);
  res.end('data: [DONE]\n\n');
};
const chunk = (delta, finish = null) => ({ choices: [{ index: 0, delta, finish_reason: finish }] });
const call = (index, id, name, args) => chunk({ tool_calls: [{ index, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
const usage = (input, output) => ({ choices: [], usage: { prompt_tokens: input, completion_tokens: output } });

test('helper agents: run side by side, only look, answer the agent, share the budget', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'najwa-helper-test-')));
  fs.writeFileSync(path.join(root, 'a.js'), 'checkToken(req);\n');
  let inFlight = 0;
  let most = 0;
  const helperSaw = [];
  const srv = http.createServer((req, res) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', async () => {
      const body = JSON.parse(data);
      const system = body.messages[0].content;
      const toolMsgs = body.messages.filter((m) => m.role === 'tool');
      assert.deepStrictEqual(body.stream_options, { include_usage: true });
      if (/You are a helper/.test(system)) {
        assert.ok(!body.tools.some((t) => ['write_file', 'run_command', 'ask_helper', 'todo_write'].includes(t.function.name)));
        const task = body.messages[1].content;
        if (!toolMsgs.length) {
          inFlight++;
          most = Math.max(most, inFlight);
          await new Promise((r) => setTimeout(r, 150));
          inFlight--;
          // It tries to write (not offered, refused anyway) and reads.
          return sse(res, [call(0, `w-${task}`, 'write_file', { path: 'x.txt', content: 'no' }), call(1, `r-${task}`, 'read_file', { path: 'a.js' }), usage(100, 10), chunk({}, 'tool_calls')]);
        }
        helperSaw.push(toolMsgs.map((m) => m.content).join('\n'));
        return sse(res, [chunk({ content: `${task}: a.js:1` }), usage(200, 20), chunk({}, 'stop')]);
      }
      if (!toolMsgs.length) {
        return sse(res, [call(0, 'h1', 'ask_helper', { task: 'Where is the token checked?' }), call(1, 'h2', 'ask_helper', { task: 'Where is the user loaded?' }), usage(1000, 50), chunk({}, 'tool_calls')]);
      }
      assert.match(toolMsgs[0].content, /Where is the token checked\?: a\.js:1/);
      assert.match(toolMsgs[1].content, /Where is the user loaded\?: a\.js:1/);
      return sse(res, [chunk({ content: 'Both are in a.js.' }), usage(1500, 30), chunk({}, 'stop')]);
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const cfg = { baseUrl: `http://127.0.0.1:${srv.address().port}` };
  try {
    const infos = [];
    const onInfo = (i) => infos.push(i);
    const tools = agentTools({
      root, chatId: 'h', mode: 'auto', model: 'm',
      options: { dryRun: 'off', prices: 'm = 1 / 1', runHelper: helperRunner({ kind: 'openaiCompatible', cfg, model: 'm', onInfo }) },
      firewall: createFirewall({ cloud: true }), approve: async () => 'once', chatAllowed: new Set(),
      checkpoints: createCheckpoints(path.join(root, '..', `${path.basename(root)}-cps`)), jobs: backgroundJobs(), onInfo
    });
    assert.ok(tools.defs.some((d) => d.name === 'ask_helper'));
    const r = await chatWithTools({ kind: 'openaiCompatible', cfg, tools, onInfo, onDelta: () => {}, req: { model: 'm', system: tools.system, messages: [{ role: 'user', content: 'Find both.' }] } });
    assert.strictEqual(r.text, 'Both are in a.js.');
    assert.strictEqual(most, 2);   // the two helpers worked at the same time
    assert.strictEqual(helperSaw.length, 2);
    for (const saw of helperSaw) {
      assert.match(saw, /A helper can only look: write_file isn't available/);
      assert.match(saw, /checkToken/);
    }
    assert.ok(!fs.existsSync(path.join(root, 'x.txt')));
    // Helper steps show in the chat, marked.
    assert.ok(infos.some((i) => i.kind === 'tool' && /^🤝 Read a\.js/.test(i.label || '')));
    // One budget: 1000+50 + 2×(100+10 + 200+20) + 1500+30
    assert.strictEqual(tools.budget.tokens, 1050 + 2 * 330 + 1530);
  } finally {
    srv.closeAllConnections();
    srv.close();
  }
});

test('mixed crew: which model the helpers use', () => {
  const { chooseHelper } = require('../src/agent/helpers');
  const { isLocalModel } = require('../src/agent/firewall');
  const canUseTools = () => true;
  const cloud = { provider: 'anthropic', cfg: {}, model: 'big' };
  const local = { provider: 'ollama', cfg: { baseUrl: 'http://127.0.0.1:11434' }, model: 'small' };
  const otherCloud = { provider: 'openai', cfg: {}, model: 'other' };
  const pick = (main, helper, localOnly) => chooseHelper({ main, helper, localOnly, isLocal: isLocalModel, canUseTools }).model;
  assert.strictEqual(pick(cloud, local), 'small');        // big plans, small works
  assert.strictEqual(pick(cloud, otherCloud), 'other');   // cloud with cloud: fine
  assert.strictEqual(pick(local, otherCloud), 'small');   // a local project never goes to the cloud through a helper
  assert.strictEqual(pick(cloud, otherCloud, true), 'big');   // (Local only refuses the cloud main model before this)
  assert.strictEqual(pick(cloud, null), 'big');
  assert.strictEqual(chooseHelper({ main: cloud, helper: local, isLocal: isLocalModel, canUseTools: (p) => p !== 'ollama' }).model, 'big');
});
