// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// The app draws under the phone's own bars (Capacitor's SystemBars gives their
// size as --safe-area-inset-*). Anything pinned to the bottom of the screen
// must stay above Android's navigation buttons, or it can't be tapped (#91:
// a dialog's Delete button under the three-button navigation bar).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8');
const BOTTOM = 'var(--safe-area-inset-bottom, env(safe-area-inset-bottom))';
const rule = (selector, from = 0) => {
  const at = css.indexOf(`${selector} {`, from);
  assert.ok(at >= 0, `${selector} has a rule`);
  return css.slice(at, css.indexOf('}', at));
};

test('dialogs keep their buttons above the navigation bar, on phones and wider screens', () => {
  // Wide: a native <dialog>, centred, its height clear of every bar.
  const wide = rule('.modal');
  assert.ok(wide.includes(`max(16px, ${BOTTOM})`));
  assert.match(wide, /max-height: min\(88vh, calc\(100dvh - var\(--modal-gap-y\)\)\)/);
  // Phone: a sheet from the bottom, padded by the bar's height.
  const phone = css.indexOf('@media (max-width: 700px)');
  assert.ok(phone >= 0);
  const sheet = rule('.modal, .modal.wide', phone);
  assert.ok(sheet.includes(`padding-bottom: ${BOTTOM}`));
  assert.match(sheet, /margin: auto auto 0/);
});

test('the message box, the chat list and notes stay above it too', () => {
  assert.ok(rule('#composer', css.indexOf('@media (max-width: 700px)')).includes(BOTTOM));
  assert.ok(rule('#toast').includes(`calc(90px + ${BOTTOM})`));
  assert.ok(css.includes(`padding-bottom: ${BOTTOM}`));
});

test('the chat scrolls up and down only: nothing in it can make it wider than the screen', () => {
  // On iPhone the chat could be dragged sideways and sprang back (a reply's
  // long one-line steps were wider than the screen in Safari).
  assert.match(rule('#messages'), /overflow-x: hidden/);
  const step = rule('.agent-step');
  assert.match(step, /min-width: 0/);
  assert.match(step, /max-width: 100%/);
  assert.match(step, /overflow: hidden/);
  // Code blocks and tables keep their own sideways scrolling.
  assert.match(rule('.msg .content pre'), /overflow-x: auto/);
  assert.match(rule('.msg .content table'), /overflow-x: auto/);
});
