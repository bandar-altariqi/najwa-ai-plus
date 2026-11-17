// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// Screenshots of the interface with a sample chat, to look at after a change
// to how it looks: the welcome screen, a chat (light and dark), a phone, the
// settings window, Arabic, and your message with its buttons showing.
//
//   npm run build:web && node scripts/ui-check/shots.js [label]
//
// Pictures go to $UI_CHECK_DIR (default: <tmp>/najwa-ui-check), named
// <label>-<view>.png. Needs Playwright with Chromium.

'use strict';

const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', 'www');
const OUT = process.env.UI_CHECK_DIR || path.join(os.tmpdir(), 'najwa-ui-check');
const LABEL = process.argv[2] || 'shot';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain' };

// Runs in the page: a chat with headings, a list, code, a table and a quote.
function sample() {
  /* global S, renderChat, renderSidebar */
  const now = Date.now();
  const md = 'Start by **measuring**, then fix the biggest cost first.\n\n### 1. Find what is slow\nOpen DevTools → Performance and record a load. Look at:\n\n- **LCP** (largest contentful paint): usually the hero image\n- **Long tasks** over 50 ms that block the main thread\n\n### 2. Quick wins\n```html\n<img src="hero.avif" fetchpriority="high" width="1200" height="600" alt="">\n```\nThen lazy-load images below the fold with `loading="lazy"`.\n\n| Fix | Typical gain |\n|---|---|\n| Hero priority | 0.5–1.5 s |\n| Smaller JS | 1–2 s |\n\n> Measure again after each change, so you know what helped.';
  const model = { provider: 'deepseek', model: 'deepseek-flash' };
  const chat = {
    id: 'demo', title: 'Speed up a slow page', assistantId: S.settings.assistants[0].id, createdAt: now, updatedAt: now,
    messages: [
      { id: 'm1', role: 'user', content: 'My product page takes 6 seconds to load. Where do I start?', createdAt: now - 60000 },
      { id: 'm2', role: 'assistant', model, createdAt: now - 50000, content: md },
      { id: 'm3', role: 'user', content: 'Thanks! Can you check my HTML?', createdAt: now - 20000 },
      { id: 'm4', role: 'assistant', model, createdAt: now - 10000, content: 'Of course: paste it here and I\'ll go through it line by line.' }
    ]
  };
  const day = 86400000;
  S.chats = [chat, { id: 'c2', title: 'Arabic poem about the sea', messages: [], updatedAt: now - day },
    { id: 'c3', title: 'Trip plan: Abha in spring', messages: [], updatedAt: now - 3 * day },
    { id: 'c4', title: 'Fix the failing tests', messages: [], updatedAt: now - 9 * day }];
  S.current = chat;
  renderChat();
  renderSidebar();
}

const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(ROOT)) {
    res.statusCode = 403;
    res.end();
    return;
  }
  fs.readFile(file, (err, body) => {
    if (err) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader('content-type', TYPES[path.extname(file)] || 'application/octet-stream');
    res.end(body);
  });
});

server.listen(0, async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const url = `http://127.0.0.1:${server.address().port}/index.html`;
  const browser = await chromium.launch();
  const errors = [];
  const shot = async (name, context, steps = []) => {
    const ctx = await browser.newContext(context);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${name}: ${e}`));
    await page.goto(url);
    await page.waitForTimeout(1300);
    for (const step of steps) await step(page);
    await page.waitForTimeout(400);
    const file = path.join(OUT, `${LABEL}-${name}.png`);
    await page.screenshot({ path: file });
    await ctx.close();
    return file;
  };
  const wide = { viewport: { width: 1280, height: 820 } };
  const files = [
    await shot('welcome', wide),
    await shot('welcome-dark', { ...wide, colorScheme: 'dark' }),
    await shot('chat', wide, [(p) => p.evaluate(sample)]),
    await shot('chat-dark', { ...wide, colorScheme: 'dark' }, [(p) => p.evaluate(sample)]),
    await shot('phone', { viewport: { width: 390, height: 844 } }, [(p) => p.evaluate(sample)]),
    await shot('settings', wide, [(p) => p.evaluate(() => openSettings('general'))]), // eslint-disable-line no-undef
    await shot('arabic', wide, [(p) => p.evaluate(() => { S.settings.language = 'ar'; applyLanguage(); }), (p) => p.evaluate(sample)]), // eslint-disable-line no-undef
    await shot('hover', wide, [(p) => p.evaluate(sample), (p) => p.hover('.msg.user .content')])
  ];
  await browser.close();
  server.close();
  for (const f of files) console.log(f);
  if (errors.length) {
    console.log('Page errors:', errors);
    process.exit(1);
  }
});
