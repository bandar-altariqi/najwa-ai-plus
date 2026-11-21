// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// Asked to install a program or add an MCP server in a chat whose tools can't,
// a model only said no ("I have no terminal… I can't install viajante or run
// an MCP server"). Chats with tools but no project folder now tell the model
// how the user gets these in Najwa AI Plus, so it can say so.

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { capabilitiesNote } = require('../src/connectors');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('the note says where commands and MCP servers come from, on a computer and on a phone', () => {
  const pc = capabilitiesNote('', 'computer');
  assert.match(pc, /don't just say no/);
  assert.match(pc, /project folder \(📁 Project at the top\)/);
  assert.match(pc, /Settings → Connectors → "Add a program on this computer"/);
  assert.match(pc, /Command: npx, Arguments: -y and the package/);
  assert.match(pc, /"Add by address"/);
  const phone = capabilitiesNote('You are helpful.', 'phone');
  assert.match(phone, /^You are helpful\.\n\n/);
  assert.match(phone, /"Add by address"/);
  assert.match(phone, /need a computer with Najwa AI Plus/);
  // The labels it names are the real buttons in Settings → Connectors.
  const app = read('renderer/app.js');
  assert.ok(app.includes("'＋ Add by address'") && app.includes("'＋ Add a program on this computer'"));
});

test('it goes in chats with tools but no project folder, on the computer and the phone', () => {
  assert.match(read('main.js'), /if \(!agentSpec\) system = capabilitiesNote\(system, 'computer', \{ canAdd: !!req\.connectors \}\);/);
  assert.match(read('mobile/src/bridge.js'), /system = capabilitiesNote\(system, 'phone', \{ canAdd/);
});
