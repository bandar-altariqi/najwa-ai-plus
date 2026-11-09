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

test('mixed crew: a worker on the crew\'s model does the change, under the same questions and budget', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'najwa-worker-test-')));
  fs.writeFileSync(path.join(root, 'greet.js'), "exports.hi = () => 'hi';\n");
  const models = [];
  const srv = http.createServer((req, res) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      const body = JSON.parse(data);
      models.push(body.model);
      const results = body.messages.filter((m) => m.role === 'tool');
      if (/You are a worker/.test(body.messages[0].content)) {
        assert.strictEqual(body.model, 'small');
        const names = body.tools.map((t) => t.function.name);
        assert.ok(names.includes('edit_file') && names.includes('run_command'));
        assert.ok(!names.includes('delegate_work') && !names.includes('ask_helper') && !names.includes('todo_write'));
        if (!results.length) return sse(res, [call(0, 'w1', 'edit_file', { path: 'greet.js', old_text: "'hi'", new_text: "'hello'" }), usage(300, 20), chunk({}, 'tool_calls')]);
        return sse(res, [chunk({ content: `Changed greet.js. ${results[0].content.split('\n')[0]}` }), usage(400, 15), chunk({}, 'stop')]);
      }
      assert.strictEqual(body.model, 'big');
      if (!results.length) return sse(res, [call(0, 'd1', 'delegate_work', { job: "In greet.js make hi() return 'hello'." }), usage(1000, 40), chunk({}, 'tool_calls')]);
      return sse(res, [chunk({ content: `Done: ${results[0].content}` }), usage(1200, 20), chunk({}, 'stop')]);
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const cfg = { baseUrl: `http://127.0.0.1:${srv.address().port}` };
  try {
    const asked = [];
    const infos = [];
    const make = (mode) => agentTools({
      root, chatId: 'w', mode, model: 'big',
      options: { dryRun: 'off', runHelper: helperRunner({ kind: 'openaiCompatible', cfg, model: 'small', onInfo: (i) => infos.push(i) }) },
      firewall: createFirewall({ cloud: true }), approve: async (a) => { asked.push(a); return 'once'; }, chatAllowed: new Set(),
      checkpoints: createCheckpoints(path.join(root, '..', `${path.basename(root)}-cps`)), jobs: backgroundJobs(), onInfo: (i) => infos.push(i)
    });
    const tools = make('ask');
    assert.ok(tools.defs.some((d) => d.name === 'delegate_work'));
    const r = await chatWithTools({ kind: 'openaiCompatible', cfg, tools, onDelta: () => {}, onInfo: (i) => infos.push(i), req: { model: 'big', system: tools.system, messages: [{ role: 'user', content: 'Say hello.' }] } });
    assert.match(r.text, /^Done: Changed greet\.js\. Changed greet\.js/);
    assert.strictEqual(fs.readFileSync(path.join(root, 'greet.js'), 'utf8'), "exports.hi = () => 'hello';\n");
    // Ask first: the worker's edit was asked, like the agent's would be.
    assert.strictEqual(asked.length, 1);
    assert.match(asked[0].title, /greet\.js/);
    assert.deepStrictEqual(models, ['big', 'small', 'small', 'big']);
    assert.ok(infos.some((i) => i.kind === 'tool' && /^👷 /.test(i.label || '')));
    assert.strictEqual(tools.budget.tokens, 1040 + 320 + 415 + 1220);
    // The change can be undone like any other.
    assert.strictEqual(tools.budget.tokens > 0, true);
    // Plan only: nothing to hand on.
    const plan = await make('plan').run('delegate_work', { job: 'x' });
    assert.ok(plan.error);
    assert.match(plan.text, /Plan mode/);
  } finally {
    srv.closeAllConnections();
    srv.close();
  }
});
