// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseMachines, decide, looks, tailscaleMachines } = require('../src/agent/homelab');
const { agentTools } = require('../src/agent/tools');
const { createFirewall } = require('../src/agent/firewall');
const { createCheckpoints } = require('../src/agent/checkpoints');
const { backgroundJobs } = require('../src/agent/shell');

const MACHINES = 'nas = admin@nas.tailnet.ts.net : look\npi = pi@192.168.1.20\nlab = root@lab : auto   # the big one\nbad = -oProxyCommand=evil : auto\nnas = again@x : auto\n';

test('homelab: machines from the settings text', () => {
  assert.deepStrictEqual(parseMachines(MACHINES), [
    { name: 'nas', host: 'admin@nas.tailnet.ts.net', access: 'look' },
    { name: 'pi', host: 'pi@192.168.1.20', access: 'ask' },     // ask when not said
    { name: 'lab', host: 'root@lab', access: 'auto' }
  ]);   // an ssh option as the host, and a second "nas", are left out
});

test('homelab: each machine\'s permission, risky commands always asked', () => {
  const [nas, pi, lab] = parseMachines(MACHINES);
  assert.ok(looks('docker ps -a && df -h'));
  assert.ok(!looks('docker ps > /tmp/x'));
  assert.deepStrictEqual(decide(nas, 'docker logs web --tail 50', 'auto'), { decision: 'allow' });
  assert.strictEqual(decide(nas, 'docker restart web', 'auto').decision, 'refuse');
  assert.strictEqual(decide(pi, 'docker restart web', 'auto').decision, 'ask');
  assert.deepStrictEqual(decide(lab, 'docker restart web', 'auto'), { decision: 'allow' });
  assert.deepStrictEqual(decide(lab, 'docker compose pull && docker compose up -d', 'auto'), { decision: 'allow' });
  for (const risky of ['docker rm -f web', 'docker volume rm data', 'docker system prune -af', 'docker compose down -v', 'sudo reboot', 'rm -rf /', 'zfs destroy tank/media']) {
    assert.strictEqual(decide(lab, risky, 'auto').decision, 'ask', risky);
  }
  assert.strictEqual(decide(lab, 'docker restart web', 'plan').decision, 'refuse');
  assert.deepStrictEqual(decide(lab, 'systemctl status nginx', 'plan'), { decision: 'allow' });
});

test('homelab: the agent\'s tools, over a pretend ssh', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'najwa-homelab-test-')));
  const ran = [];
  const asked = [];
  const answers = ['deny'];
  const t = agentTools({
    root, chatId: 'l', mode: 'auto', options: { dryRun: 'off', machines: MACHINES, sshRun: async (host, command) => { ran.push(`${host} $ ${command}`); return { code: 0, output: command.includes('env') ? 'TOKEN=ghp_0123456789abcdefghijklmnopqrstuvwxyz01\n' : `ok from ${host}\n` }; } },
    firewall: createFirewall({ cloud: true }), approve: async (a) => { asked.push(a); return answers.length ? answers.shift() : 'once'; },
    chatAllowed: new Set(), checkpoints: createCheckpoints(path.join(root, '..', `${path.basename(root)}-cps`)), jobs: backgroundJobs()
  });
  assert.ok(t.defs.some((d) => d.name === 'run_on_machine'));
  assert.match(t.system, /The user's machines[\s\S]*- nas \(admin@nas\.tailnet\.ts\.net\): look only[\s\S]*- lab \(root@lab\): can change things/);
  assert.match((await t.run('list_machines', {})).text, /pi \(pi@192\.168\.1\.20\)/);
  assert.match((await t.run('run_on_machine', { machine: 'NAS', command: 'df -h' })).text, /Exit code: 0\nok from admin@nas/);
  assert.ok((await t.run('run_on_machine', { machine: 'nas', command: 'docker restart web' })).error);   // look only
  assert.match((await t.run('run_on_machine', { machine: 'lab', command: 'docker restart web' })).text, /ok from root@lab/);   // auto
  const refused = await t.run('run_on_machine', { machine: 'lab', command: 'docker volume rm data' });   // risky: asked, refused
  assert.ok(refused.error);
  assert.strictEqual(asked.length, 1);
  assert.match(asked[0].title, /Run on lab/);
  assert.match(asked[0].description, /deletes containers, images or their data/);
  const env = await t.run('run_on_machine', { machine: 'lab', command: 'env' });
  assert.doesNotMatch(env.text, /ghp_/);   // the firewall hides secrets from cloud models
  assert.ok((await t.run('run_on_machine', { machine: 'mars', command: 'ls' })).error);
  assert.deepStrictEqual(ran, ['admin@nas.tailnet.ts.net $ df -h', 'root@lab $ docker restart web', 'root@lab $ env']);
  // No machines: no tools.
  const none = agentTools({ root, chatId: 'n', options: { dryRun: 'off' }, firewall: createFirewall({ cloud: true }), approve: async () => 'once', chatAllowed: new Set(), checkpoints: createCheckpoints(path.join(root, '..', 'cps2')), jobs: backgroundJobs() });
  assert.ok(!none.defs.some((d) => d.name === 'run_on_machine'));
});

test('homelab: Tailscale machines', () => {
  const status = { Self: { HostName: 'me' }, Peer: { a: { HostName: 'nas', DNSName: 'nas.tail1234.ts.net.', Online: true, OS: 'linux' }, b: { HostName: 'old pi', TailscaleIPs: ['100.64.0.9'], Online: false } } };
  assert.deepStrictEqual(tailscaleMachines(JSON.stringify(status)), [
    { name: 'nas', host: 'nas.tail1234.ts.net', online: true, os: 'linux' },
    { name: 'old-pi', host: '100.64.0.9', online: false, os: '' }
  ]);
});
