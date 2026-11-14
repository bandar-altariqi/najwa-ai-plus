// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// The interface uses the web platform's own pieces where Modern Web Guidance
// says to (skills/modern-web-guidance): checked in a real browser by
// scripts/ui-check/run.js; these keep the code from sliding back.

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const app = read('renderer/app.js');
const css = read('renderer/styles.css');
const html = read('renderer/index.html');
const fn = (name) => {
  const at = app.indexOf(`function ${name}(`);
  assert.ok(at >= 0, name);
  return app.slice(at, app.indexOf('\n}\n', at));
};

test('windows are native modal dialogs (dialog guide)', () => {
  const open = fn('openModal');
  assert.match(open, /h\('dialog'/);
  assert.match(open, /showModal\(\)/);
  // The browser does these: no hand-made role, focus trap or Esc handler.
  assert.doesNotMatch(open, /role: 'dialog'|aria-modal|key === 'Tab'|key === 'Escape'/);
  assert.match(open, /addEventListener\('close', finish\)/);
  // Scrolling in or around a window never scrolls the page behind.
  assert.match(css, /\.modal::backdrop \{[^}]*overflow: hidden;[^}]*overscroll-behavior: contain;/);
  assert.match(css, /\.modal:modal \{ overscroll-behavior: contain; \}/);
  assert.match(css, /\.modal\[open\] \{ display: flex; \}/);
  assert.doesNotMatch(css, /\.modal-backdrop/);
});

test('the ⋯ chat menu is a popover menu (menu guide)', () => {
  assert.match(app, /menu\.popover = 'auto'/);
  assert.match(app, /btn\.popoverTargetElement = menu/);
  assert.match(app, /setAttribute\('role', 'menu'\)/);
  assert.match(app, /setAttribute\('role', 'menuitem'\)/);
  assert.match(app, /aria-haspopup', 'menu'/);
  for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End']) assert.ok(app.includes(`e.key === '${key}'`), key);
  assert.match(css, /#chatMenu\[popover\] \{[^}]*position-anchor: --chat-menu;/);
  // Browsers without :popover-open drop a rule that names it, so it's on its own.
  assert.match(css, /\n\.menu\[popover\]:not\(:popover-open\) \{ display: none; \}/);
});

test('settings tabs are tabs (tabs guide)', () => {
  assert.match(app, /role: 'tablist', 'aria-label': 'Settings'/);
  assert.match(app, /role: 'tab', id: `settings-tab-\$\{id\}`/);
  assert.match(app, /class: 'settings-pane', role: 'tabpanel'/);
  assert.match(app, /setAttribute\('aria-selected', String\(on\)\)/);
  assert.match(app, /b\.tabIndex = on \? 0 : -1/);
});

test('screen readers: a streaming reply is read when done; toasts are announced (accessibility guide)', () => {
  assert.match(fn('updateSendButton'), /el\.messages\.setAttribute\('aria-busy', String\(busy\)\)/);
  assert.match(html, /<div id="toast" aria-hidden="true" hidden><\/div>/);
  assert.match(html, /<div id="announcer" class="visually-hidden" role="status"><\/div>/);
  assert.match(fn('toast'), /announce\(msg\)/);
  // Inside an open window the page is inert: the window gets its own region.
  assert.match(fn('announce'), /el\.modalRoot\.lastElementChild/);
  // The toast is a popover, so it shows over windows.
  assert.match(app, /el\.toast\.popover = 'manual'/);
});

test('the message box grows with its text (field-sizing guide)', () => {
  assert.match(css, /#input \{[^}]*field-sizing: content;[^}]*max-height: 240px;/);
  assert.match(fn('autoGrow'), /if \(FIELD_SIZING\) return;/);
});

test('the theme: light and both dark blocks define the same colours', () => {
  const vars = (block) => new Set([...block.matchAll(/--([a-z-]+):/g)].map((m) => m[1]));
  const light = vars(css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {'))));
  const sysDark = css.slice(css.indexOf(':root:not([data-theme="light"]) {'), css.indexOf('}', css.indexOf(':root:not([data-theme="light"]) {')));
  const userDark = css.slice(css.indexOf(':root[data-theme="dark"] {'), css.indexOf('}', css.indexOf(':root[data-theme="dark"] {')));
  const colours = [...light].filter((v) => !/^radius/.test(v));
  assert.ok(colours.length >= 20);
  for (const v of colours) {
    assert.ok(vars(sysDark).has(v), `dark (system) has --${v}`);
    assert.ok(vars(userDark).has(v), `dark (chosen) has --${v}`);
  }
  // Send is a round arrow button, still named "Send" for screen readers.
  assert.match(html, /<button id="sendBtn" class="btn primary" title="Send" aria-label="Send">\s*<svg/);
});
