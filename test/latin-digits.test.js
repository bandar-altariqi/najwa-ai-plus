// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// Western digits only, everywhere in the app (renderer/i18n.js latinDigits):
// what the user types or dictates, what models write, and the app's own dates
// and numbers, in Arabic and in English. The screen and the message box are
// checked in a real browser by scripts/ui-check/run.js.

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const I18n = require('../renderer/i18n.js');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('Arabic-Indic and Persian digits become 0-9, one character for one', () => {
  assert.strictEqual(I18n.latinDigits('٠١٢٣٤٥٦٧٨٩'), '0123456789');
  assert.strictEqual(I18n.latinDigits('۰۱۲۳۴۵۶۷۸۹'), '0123456789');
  assert.strictEqual(I18n.latinDigits('السعر ١٬٢٥٠٫٧٥ ريال، خصم ١٥٪'), 'السعر 1,250.75 ريال، خصم 15%');
  const s = 'عندي ٣ أسئلة';
  assert.strictEqual(I18n.latinDigits(s).length, s.length);   // the cursor stays where it was
  assert.strictEqual(I18n.latinDigits('no digits here, 42'), 'no digits here, 42');
  assert.strictEqual(I18n.latinDigits(''), '');
  assert.strictEqual(I18n.latinDigits(null), null);
  // A reply arrives in pieces: each converts on its own.
  assert.strictEqual(['١', '٢', '٣'].map(I18n.latinDigits).join(''), '123');
});

test('the app\'s dates and numbers use Western digits in Arabic and in English', () => {
  const when = new Date(Date.UTC(2026, 10, 21, 9, 30));
  try {
    I18n.setLanguage('ar', { doc: null, store: false });
    const ar = when.toLocaleString(I18n.locale(), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
    assert.doesNotMatch(ar, /[٠-٩۰-۹]/, ar);
    assert.match(ar, /2026/);
    assert.strictEqual((1234567).toLocaleString(I18n.locale()), '1,234,567');
    I18n.setLanguage('en', { doc: null, store: false });
    assert.match(I18n.locale(), /-u-nu-latn$/);
    assert.doesNotMatch((1234567).toLocaleString(I18n.locale()), /[٠-٩۰-۹]/);
  } finally {
    I18n.setLanguage('en', { doc: null, store: false });
  }
});

test('wired in: the screen, text boxes, sending, dictation and replies; no bare toLocaleString', () => {
  const i18n = read('renderer/i18n.js');
  assert.match(i18n, /digitsIn\(el\);\n\s+walk\(el\);/);
  assert.match(i18n, /addEventListener\('input', digitsTyped, true\)/);
  assert.match(i18n, /for \(const n of m\.addedNodes\) \{ digitsIn\(n\); walk\(n\); \}/);
  const app = read('renderer/app.js');
  assert.match(app, /const piece = I18n\.latinDigits\(evt\.text\);/);
  assert.match(app, /const text = I18n\.latinDigits\(el\.input\.value\.trim\(\)\);/);
  assert.match(app, /el\.input\.value = I18n\.latinDigits\(V\.dictBase \+ evt\.partial\);/);
  // Every date or number the app formats says which (Western-digit) locale.
  for (const f of ['renderer/app.js', 'mobile/src/bridge.js']) {
    assert.doesNotMatch(read(f), /toLocale(Date|Time)?String\((undefined)?\)/, f);
  }
  // The Arabic translations don't bring any back.
  assert.doesNotMatch(read('renderer/i18n-ar.js'), /[٠-٩۰-۹]/);
});
