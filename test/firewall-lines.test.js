// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// The privacy firewall on what the tools really return: read_file numbers its
// lines and search_files puts "path:line:" first. Secrets after those are
// still hidden (they once weren't, unless they looked like a known key).

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { agentTools } = require('../src/agent/tools');
const { createFirewall } = require('../src/agent/firewall');
const { createCheckpoints } = require('../src/agent/checkpoints');
const { backgroundJobs } = require('../src/agent/shell');

test('firewall: secrets hidden in numbered and searched lines', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'najwa-fwlines-')));
  fs.writeFileSync(path.join(root, '.env'), 'DB_PASSWORD=hunter2hunter2\nexport SECRET_TOKEN=abcd1234efgh\nPORT=3000\n');
  fs.writeFileSync(path.join(root, 'c.yml'), 'db:\n  password: Xk92mPq7Lw\n');
  const t = agentTools({
    root, chatId: 'f', options: { dryRun: 'off' }, firewall: createFirewall({ cloud: true }), approve: async () => 'once',
    chatAllowed: new Set(), checkpoints: createCheckpoints(path.join(root, '..', `${path.basename(root)}-cps`)), jobs: backgroundJobs()
  });
  const env = (await t.run('read_file', { path: '.env' })).text;
  const yml = (await t.run('read_file', { path: 'c.yml' })).text;
  const found = (await t.run('search_files', { pattern: 'hunter2|abcd1234|Xk92' })).text;
  for (const text of [env, yml, found]) assert.doesNotMatch(text, /hunter2hunter2|abcd1234efgh|Xk92mPq7Lw/);
  assert.match(env, /1 {2}DB_PASSWORD=«secret-1»\n.*2 {2}export SECRET_TOKEN=«secret-2»\n.*3 {2}PORT=3000/);
  assert.match(yml, /password: «secret-3»/);
  // And it can still keep them: an edit with the placeholder writes the real value.
  await t.run('edit_file', { path: '.env', old_text: 'PORT=3000', new_text: 'PORT=4000' });
  assert.strictEqual(fs.readFileSync(path.join(root, '.env'), 'utf8'), 'DB_PASSWORD=hunter2hunter2\nexport SECRET_TOKEN=abcd1234efgh\nPORT=4000\n');
});
