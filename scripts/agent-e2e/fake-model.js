// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// A fake OpenAI-compatible model that drives the agent through a fixed script.
const http = require('http');
const SCRIPT = [
  { name: 'todo_write', args: { items: [{ text: 'Look at the project', status: 'in_progress' }, { text: 'Change the greeting', status: 'pending' }, { text: 'Run it', status: 'pending' }] } },
  { name: 'list_files', args: {} },
  { name: 'read_file', args: { path: 'hello.js' } },
  { name: 'edit_file', args: { path: 'hello.js', old_text: "console.log('Hello, world');", new_text: "console.log('Hello, Najwa AI Plus');" } },
  { name: 'run_command', args: { command: 'node hello.js > out.txt' } },
  { name: 'todo_write', args: { items: [{ text: 'Look at the project', status: 'done' }, { text: 'Change the greeting', status: 'done' }, { text: 'Run it', status: 'done' }] } }
];
const log = [];
http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    if (req.url.endsWith('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'fake-agent' }] }));
    }
    if (req.url.endsWith('/log')) { res.writeHead(200); return res.end(JSON.stringify(log)); }
    const j = JSON.parse(body || '{}');
    const toolMsgs = (j.messages || []).filter((m) => m.role === 'tool');
    log.push({ tools: (j.tools || []).length, toolResults: toolMsgs.map((m) => String(m.content).slice(0, 300)), system: (j.messages[0] && j.messages[0].role === 'system') ? j.messages[0].content.slice(0, 200) : '' });
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    const sys = (j.messages[0] && j.messages[0].content) || '';
    if (/You review actions/.test(sys)) {
      const asked = j.messages[1].content;
      const v = /run this command/.test(asked) ? { verdict: 'concern', summary: 'Writes out.txt, which the user did not ask for.', risks: ['adds an extra file'] } : { verdict: 'ok', summary: 'Matches the request: only the greeting changes.', risks: [] };
      send({ choices: [{ delta: { content: JSON.stringify(v) } }] });
      send({ choices: [{ delta: {}, finish_reason: 'stop' }] });
      return res.end('data: [DONE]\n\n');
    }
    const step = SCRIPT[toolMsgs.length];
    if (step && (j.tools || []).length) {
      send({ choices: [{ delta: { tool_calls: [{ index: 0, id: `call_${toolMsgs.length}`, function: { name: step.name, arguments: JSON.stringify(step.args) } }] } }] });
      send({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
    } else {
      send({ choices: [{ delta: { content: 'Done. I changed the greeting in hello.js and ran it: it now says "Hello, Najwa AI Plus".' } }] });
      send({ choices: [{ delta: {}, finish_reason: 'stop' }] });
    }
    res.end('data: [DONE]\n\n');
  });
}).listen(18080, '127.0.0.1', () => console.log('fake model on 18080'));
