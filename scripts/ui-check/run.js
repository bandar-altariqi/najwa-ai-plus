// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// The interface in a real browser (Chromium, with Playwright): windows are
// native modal dialogs, the ⋯ menu is a popover menu, settings tabs are tabs,
// toasts show over windows, the message box grows with its text, and on a
// phone a window is a sheet from the bottom. Follows Modern Web Guidance.
//
//   npm run build:web && node scripts/ui-check/run.js
//
// Needs Playwright with Chromium (not a dependency of the app).

const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, '..', '..', 'www');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2' };
const os = require('os');
const SHOTS = process.env.UI_CHECK_DIR || path.join(os.tmpdir(), 'najwa-ui-check');
fs.mkdirSync(SHOTS, { recursive: true });
let failed = 0;
const out = (k, v) => { if (!v) failed++; console.log(`${v ? '✓' : '✗'} ${k}`); };
const srv = http.createServer((req, res) => {
  const f = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  fs.readFile(f, (e, b) => { if (e) { res.statusCode = 404; return res.end(); } res.setHeader('content-type', types[path.extname(f)] || 'application/octet-stream'); res.end(b); });
}).listen(0, async () => {
  const url = `http://127.0.0.1:${srv.address().port}/index.html`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 750 } });
  const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(url); await page.waitForTimeout(1500);

  // --- Settings: a native modal dialog
  await page.click('#settingsBtn'); await page.waitForTimeout(300);
  out('settings opens as a modal <dialog>', await page.evaluate(() => { const d = document.querySelector('#modalRoot > dialog.modal'); return !!d && d.open && d.matches(':modal'); }));
  out('no role/aria-modal on it', await page.evaluate(() => { const d = document.querySelector('dialog.modal'); return !d.hasAttribute('role') && !d.hasAttribute('aria-modal'); }));
  let inside = true;
  for (let i = 0; i < 40; i++) { await page.keyboard.press('Tab'); inside = inside && await page.evaluate(() => document.querySelector('dialog.modal').contains(document.activeElement) || document.activeElement === document.body); }
  out('Tab never reaches the page behind (40 presses: the window, or the browser\'s own toolbar)', inside);
  out('the page behind is inert (press on the New chat button hits the backdrop)', await page.evaluate(() => { const b = document.querySelector('#newChatBtn') || document.querySelector('.new-chat') ; const r = (b || document.querySelector('#settingsBtn')).getBoundingClientRect(); const hit = document.elementFromPoint(r.x + 5, r.y + 5); return hit && hit.tagName === 'DIALOG' || hit === document.documentElement; }));
  // tabs
  const tabs = await page.evaluate(() => { const t = document.querySelector('[role=tablist]'); return t && [...t.children].map((b) => [b.getAttribute('role'), b.getAttribute('aria-selected'), b.tabIndex]); });
  out('settings tabs: role=tab, one selected, one Tab stop', !!tabs && tabs.every(([r]) => r === 'tab') && tabs.filter(([, s]) => s === 'true').length === 1 && tabs.filter(([, , i]) => i === 0).length === 1);
  await page.focus('[role=tab][aria-selected=true]');
  const before = await page.evaluate(() => document.querySelector('[role=tab][aria-selected=true]').id);
  await page.keyboard.press('ArrowDown');
  const after = await page.evaluate(() => ({ sel: document.querySelector('[role=tab][aria-selected=true]').id, focus: document.activeElement.id, panel: document.querySelector('[role=tabpanel]').getAttribute('aria-labelledby') }));
  out(`ArrowDown selects the next tab (${before} → ${after.sel}) and the panel follows`, after.sel !== before && after.focus === after.sel && after.panel === after.sel);
  await page.keyboard.press('End');
  out('End goes to the last tab', await page.evaluate(() => { const l = [...document.querySelector('[role=tablist]').children]; return l[l.length - 1].getAttribute('aria-selected') === 'true'; }));
  // toast above the window, announced
  await page.evaluate(() => toast('Saved'));
  await page.waitForTimeout(250);
  out('a toast shows while the window is open (top layer, after it: see the screenshot)', await page.evaluate(() => document.getElementById('toast').matches(':popover-open')));
  out('…and is announced inside the window (not the inert page)', await page.evaluate(() => { const a = document.querySelector('dialog.modal > .announcer'); return !!a && a.getAttribute('role') === 'status' && a.textContent === 'Saved'; }));
  await page.screenshot({ path: path.join(SHOTS, 'settings-desktop.png') });
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  out('Esc closes it and it is removed', await page.evaluate(() => !document.querySelector('#modalRoot').children.length));
  out('focus goes back to the Settings button', await page.evaluate(() => document.activeElement.id === 'settingsBtn'));
  // backdrop press closes
  await page.click('#settingsBtn'); await page.waitForTimeout(200);
  await page.mouse.click(15, 740); await page.waitForTimeout(200);
  out('a press on the dimmed page closes it', await page.evaluate(() => !document.querySelector('#modalRoot').children.length));
  // stacked windows
  await page.evaluate(() => { openModal({ title: 'One', body: h('p', { text: 'first' }) }); openModal({ title: 'Two', body: h('p', { text: 'second' }) }); });
  await page.keyboard.press('Escape'); await page.waitForTimeout(150);
  out('stacked windows: Esc closes only the top one', await page.evaluate(() => { const c = document.querySelector('#modalRoot').children; return c.length === 1 && c[0].textContent.includes('One') && c[0].matches(':modal'); }));
  await page.keyboard.press('Escape'); await page.waitForTimeout(150);

  // --- the ⋯ menu
  await page.click('#chatMenuBtn'); await page.waitForTimeout(150);
  out('no chat yet: the menu stays shut and a toast explains', await page.evaluate(() => !document.getElementById('chatMenu').matches(':popover-open') && document.getElementById('toast').textContent.includes('Send a message first')));
  await page.evaluate(() => { S.current = { id: 'test', title: 't', pinned: false, messages: [] }; });
  await page.click('#chatMenuBtn'); await page.waitForTimeout(150);
  const m = await page.evaluate(() => { const menu = document.getElementById('chatMenu'); const b = document.getElementById('chatMenuBtn').getBoundingClientRect(); const r = menu.getBoundingClientRect(); return { open: menu.matches(':popover-open'), focus: document.activeElement.dataset.action, expanded: document.getElementById('chatMenuBtn').getAttribute('aria-expanded'), below: r.top >= b.bottom && r.top - b.bottom < 10, rightAligned: Math.abs(r.right - b.right) < 2, role: menu.getAttribute('role') }; });
  out(`menu opens under its button, right edges lined up (${JSON.stringify(m)})`, m.open && m.below && m.rightAligned && m.role === 'menu');
  out('first item focused, aria-expanded=true', m.focus === 'rename' && m.expanded === 'true');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
  out('arrow keys move through the items', await page.evaluate(() => document.activeElement.dataset.action === 'system'));
  await page.keyboard.press('End');
  out('End goes to the last item', await page.evaluate(() => document.activeElement.dataset.action === 'delete'));
  await page.screenshot({ path: path.join(SHOTS, 'menu-desktop.png') });
  await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  out('Esc closes it, focus back on ⋯, aria-expanded=false', await page.evaluate(() => !document.getElementById('chatMenu').matches(':popover-open') && document.activeElement.id === 'chatMenuBtn' && document.getElementById('chatMenuBtn').getAttribute('aria-expanded') === 'false'));
  await page.click('#chatMenuBtn'); await page.waitForTimeout(100);
  await page.mouse.click(600, 400); await page.waitForTimeout(100);
  out('a press outside closes it', await page.evaluate(() => !document.getElementById('chatMenu').matches(':popover-open')));
  // without anchor positioning: placed by script
  await page.evaluate(() => { for (const sh of document.styleSheets) { try { [...sh.cssRules].forEach((r, i) => { if (r.cssText.startsWith('@supports (position-area')) sh.deleteRule(i); }); } catch {} } const real = CSS.supports.bind(CSS); CSS.supports = (p, v) => (p === 'position-area' ? false : real(p, v)); });
  await page.click('#chatMenuBtn'); await page.waitForTimeout(150);
  const f = await page.evaluate(() => { const r = document.getElementById('chatMenu').getBoundingClientRect(); const b = document.getElementById('chatMenuBtn').getBoundingClientRect(); return { below: r.top >= b.bottom && r.top - b.bottom < 10, rightAligned: Math.abs(r.right - b.right) < 2 }; });
  out(`without anchor positioning it's still under its button (${JSON.stringify(f)})`, f.below && f.rightAligned);
  await page.keyboard.press('Escape');

  // --- message box grows
  await page.click('#input');
  const h1 = await page.evaluate(() => document.getElementById('input').getBoundingClientRect().height);
  await page.keyboard.type('one'); for (let i = 0; i < 4; i++) { await page.keyboard.press('Shift+Enter'); await page.keyboard.type('more'); }
  const h2 = await page.evaluate(() => document.getElementById('input').getBoundingClientRect().height);
  for (let i = 0; i < 20; i++) { await page.keyboard.press('Shift+Enter'); await page.keyboard.type('x'); }
  const h3 = await page.evaluate(() => document.getElementById('input').getBoundingClientRect().height);
  out(`the message box grows with its text, up to 240px (${Math.round(h1)} → ${Math.round(h2)} → ${Math.round(h3)}), no inline height`, h2 > h1 + 40 && h3 <= 241 && h3 > h2 && await page.evaluate(() => !document.getElementById('input').style.height));
  out('the chat says aria-busy=false when nothing is streaming', await page.evaluate(() => document.getElementById('messages').getAttribute('aria-busy') === 'false'));

  // --- phone: windows are sheets from the bottom
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { document.getElementById('input').value = ''; });
  await page.evaluate(() => openSettings && openSettings());
  await page.waitForTimeout(300);
  const s = await page.evaluate(() => { const d = document.querySelector('dialog.modal'); const r = d.getBoundingClientRect(); return { bottom: Math.round(r.bottom), width: Math.round(r.width), top: Math.round(r.top) }; });
  out(`phone: a sheet along the bottom, full width (${JSON.stringify(s)})`, s.bottom === 844 && s.width === 390 && s.top > 0);
  await page.screenshot({ path: path.join(SHOTS, 'settings-phone.png') });
  if (errs.length) { failed++; console.log('page errors:', errs); }
  console.log(failed ? `${failed} failed` : `All passed. Screenshots in ${SHOTS}`);
  await browser.close(); srv.close();
  process.exit(failed ? 1 : 0);
});
