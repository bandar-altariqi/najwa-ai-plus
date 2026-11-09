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
const { execFile } = require('node:child_process');

const CLI = path.join(__dirname, '..', 'bin', 'najwa-agent.js');
const sse = (res, events) => {
  res.setHeader('Content-Type', 'text/event-stream');
  for (const e of events) res.write(`data: ${JSON.stringify(e)}\n\n`);
  res.end('data: [DONE]\n\n');
};
const chunk = (delta, finish = null) => ({ choices: [{ index: 0, delta, finish_reason: finish }] });
const call = (index, id, name, args) => chunk({ tool_calls: [{ index, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });

function run(args, env = {}) {
  return new Promise((resolve) => {
    const child = execFile(process.execPath, [CLI, ...args], { env: { ...process.env, ...env }, timeout: 30000 }, (err, stdout, stderr) => {
      resolve({ code: err ? err.code : 0, stdout, stderr });
    });
    child.stdin.end();
  });
}

test('najwa-agent: works from a script; --yes never allows the risky questions', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'najwa-cli-test-')));
  fs.mkdirSync(path.join(root, 'build'));
  fs.writeFileSync(path.join(root, 'build', 'keep.txt'), 'x\n');
  const seen = [];
  const srv = http.createServer((req, res) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      const body = JSON.parse(data);
      seen.push(body);
      const results = body.messages.filter((m) => m.role === 'tool');
      if (!results.length) {
        return sse(res, [chunk({ content: 'Working. ' }), call(0, 'a', 'write_file', { path: 'notes.txt', content: 'hi\n' }), call(1, 'b', 'run_command', { command: 'git push origin main' }), chunk({}, 'tool_calls')]);
      }
      sse(res, [chunk({ content: `Done: ${results.map((r) => r.content.split('\n')[0]).join(' | ')}` }), chunk({}, 'stop')]);
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/v1`;
  try {
    const r = await run(['--dir', root, '--mode', 'auto', '--url', url, '--model', 'fake', '--yes', '--json', 'tidy up'], { NAJWA_API_KEY: 'k' });
    assert.strictEqual(r.code, 0, r.stderr);
    const events = r.stdout.trim().split('\n').map((l) => JSON.parse(l));
    const text = events.filter((e) => e.type === 'text').map((e) => e.text).join('');
    assert.match(text, /Working\. [\s\S]*Done: Created notes\.txt.* \| The user didn't allow this command/);
    assert.strictEqual(fs.readFileSync(path.join(root, 'notes.txt'), 'utf8'), 'hi\n');   // auto mode: written
    // git push: asked, and refused without a person (it never ran)
    const q = events.find((e) => e.type === 'question');
    assert.match(q.command, /git push origin main/);
    assert.deepStrictEqual(events.filter((e) => e.type === 'answer').map((e) => e.answer), ['deny']);
    assert.strictEqual(events[events.length - 1].type, 'done');
    assert.match(seen[0].messages[0].content, /working as an agent in Najwa AI Plus/);
    assert.strictEqual(seen[0].model, 'fake');
    // Wrong options.
    assert.strictEqual((await run(['--mode', 'yolo', '--model', 'x', 'hi'])).code, 2);
    assert.strictEqual((await run(['--url', url, 'hi'], { NAJWA_MODEL: '' })).code, 2);
  } finally {
    srv.closeAllConnections();
    srv.close();
  }
});
