// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// The agent, end to end in the real app: a chat gets a project folder, a
// scripted model (fake-model.js) asks for tools, the approval cards are
// answered, and the changes are checked and undone. Screenshots go to E2E_DIR.
//   node scripts/agent-e2e/fake-model.js &
//   xvfb-run -a node scripts/agent-e2e/run.js      (REVIEW=1 adds a second opinion)
const { _electron: electron } = require('playwright');
const fs = require('fs');
const path = require('path');
const DIR = process.env.E2E_DIR || require('os').tmpdir() + '/najwa-agent-e2e';
fs.mkdirSync(DIR, { recursive: true });
const APP = path.join(__dirname, '..', '..');
const PROJ = path.join(DIR, 'proj');
const shot = (page, name) => page.screenshot({ path: path.join(DIR, `${name}.png`) });
(async () => {
  fs.rmSync(PROJ, { recursive: true, force: true });
  fs.rmSync(path.join(DIR, 'home'), { recursive: true, force: true });
  fs.mkdirSync(PROJ, { recursive: true });
  fs.writeFileSync(path.join(PROJ, 'hello.js'), "// greeting\nconsole.log('Hello, world');\n");
  fs.writeFileSync(path.join(PROJ, 'AGENTS.md'), 'Keep it simple.\n');
  const home = path.join(DIR, 'home');
  fs.mkdirSync(home, { recursive: true });
  const app = await electron.launch({
    executablePath: path.join(APP, 'node_modules/electron/dist/electron'),
    args: ['--no-sandbox', APP],
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), BALIMDA_DATA_DIR: path.join(DIR, 'data') }
  });
  app.process().stderr.on('data', (d) => { const t = d.toString(); if (/error|Error/.test(t) && !/GPU|gpu|dbus|DBus|Fontconfig|libva|vaInitialize|viz|ALSA/.test(t)) process.stdout.write(`[main] ${t}`); });
  const page = await app.firstWindow();
  page.on('console', (m) => { if (m.type() === 'error') console.log('[renderer]', m.text()); });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.setViewportSize({ width: 1280, height: 860 }).catch(() => {});
  await page.waitForSelector('#input', { timeout: 30000 });
  await page.evaluate(async (arg) => {
    const proj = arg.proj;
    const s = await window.balimda.settings.get();
    s.providers.openaiCompatible = { enabled: true, baseUrl: 'http://127.0.0.1:18080/v1', apiKey: '' };
    s.providers.ollama = { ...s.providers.ollama, enabled: false };
    s.defaultModel = { provider: 'openaiCompatible', model: 'fake-agent' };
    s.agent = { ...(s.agent || {}), dryRun: 'risky', recent: [proj], reviewer: arg.review ? { provider: 'openaiCompatible', model: 'fake-agent' } : null };
    await window.balimda.settings.save(s);
  }, { proj: PROJ, review: !!process.env.REVIEW });
  await page.reload();
  await page.waitForSelector('#input');
  await page.waitForTimeout(1500);
  await shot(page, '01-start');
  // Choose the project folder.
  await page.click('#projectBtn');
  await page.waitForSelector('.project-choice', { timeout: 10000 });
  await shot(page, '02-project-dialog');
  await page.click('.project-choice');
  await page.click('label.check:has-text("Ask first")');
  await page.click('.modal-foot button:has-text("Use this folder")');
  console.log('project button:', await page.textContent('#projectBtn'));
  // Ask the agent.
  await page.fill('#input', 'Change the greeting to say Hello, Najwa AI Plus, then run it.');
  await page.keyboard.press('Enter');
  // 1st question: the edit (a diff).
  await page.waitForSelector('.approval .approval-command.diff', { timeout: 30000 });
  await page.waitForTimeout(300);
  await shot(page, '03-edit-approval');
  console.log('edit card title:', await page.textContent('.approval .approval-title'));
  await page.click('.approval button:has-text("Allow once")');
  // 2nd question: the command, tried in a copy first.
  await page.waitForFunction(() => [...document.querySelectorAll('.approval .approval-title')].some((n) => /Run/.test(n.textContent)), null, { timeout: 30000 });
  await page.waitForTimeout(300);
  await shot(page, '04-command-dryrun');
  console.log('command card:', (await page.textContent('.approval .approval-command')).slice(0, 300));
  console.log('real out.txt before allowing:', fs.existsSync(path.join(PROJ, 'out.txt')));
  await page.click('.approval button:has-text("Allow once")');
  await page.waitForFunction(() => document.body.innerText.includes('Hello, Najwa AI Plus".'), null, { timeout: 30000 });
  await page.waitForTimeout(800);
  await shot(page, '05-done');
  console.log('hello.js:', JSON.stringify(fs.readFileSync(path.join(PROJ, 'hello.js'), 'utf8')));
  console.log('out.txt:', JSON.stringify(fs.existsSync(path.join(PROJ, 'out.txt')) && fs.readFileSync(path.join(PROJ, 'out.txt'), 'utf8')));
  // Steps shown.
  console.log('todo:', await page.textContent('.agent-todo-head').catch(() => 'none'));
  // Undo twice.
  for (let i = 0; i < 2; i++) {
    await page.click('#chatMenuBtn');
    await page.click('#chatMenu [data-action="agent-undo"]');
    await page.waitForSelector('.modal-foot button:has-text("Undo")');
    if (i === 0) await shot(page, '06-undo-confirm');
    await page.click('.modal-foot button:has-text("Undo")');
    await page.waitForTimeout(800);
  }
  console.log('after undo hello.js:', JSON.stringify(fs.readFileSync(path.join(PROJ, 'hello.js'), 'utf8')), 'out.txt exists:', fs.existsSync(path.join(PROJ, 'out.txt')));
  // Settings → Agent.
  await page.evaluate(() => document.querySelector('#settingsBtn, [data-open="settings"], button[title*="Settings"]')?.click());
  await page.waitForTimeout(800);
  const tab = await page.$('.settings-tabs button[data-tab="agent"]');
  if (tab) {
    await tab.click();
    await page.waitForTimeout(400);
    await shot(page, '07-settings-agent');
  } else console.log('no settings tab found');
  const log = await (await fetch('http://127.0.0.1:18080/log')).json();
  console.log('model calls:', log.length, 'tools offered:', log[0] && log[0].tools);
  console.log('system prompt start:', log[0] && log[0].system.slice(0, 120));
  console.log('last tool results:', JSON.stringify(log[log.length - 1].toolResults.slice(-3)).slice(0, 700));
  await app.close();
})().catch((e) => { console.error('E2E FAILED:', e.message); process.exit(1); });
