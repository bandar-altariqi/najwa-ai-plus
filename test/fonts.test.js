// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// The bundled Readex Pro font: the file exists, the CSS loads it from the app
// itself (no network), only for Arabic, and the licence is shipped.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const css = read('renderer', 'styles.css');
const FILES = ['ReadexPro-Arabic.woff2'];
const LATIN = ['Inter-Latin.woff2', 'Inter-LatinExt.woff2', 'Inter-Latin-Italic.woff2', 'SourceSerif4-Latin.woff2', 'SourceSerif4-LatinExt.woff2', 'SourceSerif4-Latin-Italic.woff2'];

test('the Readex Pro file is a real WOFF2 font', () => {
  for (const name of [...FILES, ...LATIN]) {
    const buf = fs.readFileSync(path.join(root, 'renderer', 'fonts', name));
    assert.strictEqual(buf.subarray(0, 4).toString('latin1'), 'wOF2', name);
    assert.ok(buf.length > 10000 && buf.length < 200000, `${name} is ${buf.length} bytes`);
  }
});

test('@font-face for Readex Pro: every weight, swap, a relative url, Arabic only', () => {
  const faces = (css.match(/@font-face\s*\{[^}]*\}/g) || []).filter((x) => x.includes('"Readex Pro"'));
  assert.strictEqual(faces.length, 1);
  const f = faces[0];
  assert.match(f, /font-family:\s*"Readex Pro"/);
  assert.match(f, /font-weight:\s*160 700/);
  assert.match(f, /font-display:\s*swap/);
  assert.match(f, /src:\s*url\("fonts\/ReadexPro-Arabic\.woff2"\)\s*format\("woff2"\)/);
  assert.ok(!/https?:|\/\//.test(f.replace(/\/\*[\s\S]*?\*\//g, '')), 'no absolute urls');
  const range = /unicode-range:\s*([^;]+);/.exec(f)[1];
  for (const r of ['U+0600-06FF', 'U+0750-077F', 'U+08A0-08FF'.replace('08A0', '08E3'), 'U+FB50-FDFF']) assert.ok(range.includes(r), r);
  // English letters, digits and punctuation keep the system font.
  for (const token of range.split(',')) assert.ok(parseInt(token.trim().slice(2), 16) >= 0x0600, `${token} is not Latin`);
});

test('Readex Pro is first in the text font stack and code fonts are untouched', () => {
  assert.match(css, /font:\s*15px\/1\.6 "Readex Pro", "Inter", system-ui,/);
  assert.match(css, /--font-read: "Readex Pro", "Source Serif 4",/);
  const mono = css.match(/font-family:\s*ui-monospace[^;]*;/g) || [];
  assert.ok(mono.length >= 4);
  assert.ok(mono.every((m) => !m.includes('Readex')));
});

test('the font ships in the desktop and mobile builds, with its licence', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.build.files.includes('renderer/**/*'));
  const build = read('scripts', 'build-web.mjs');
  for (const f of [...FILES, ...LATIN, 'OFL.txt', 'Inter-OFL.txt', 'SourceSerif4-OFL.txt']) assert.ok(build.includes(`renderer/fonts/${f}`), f);
  assert.match(read('renderer', 'fonts', 'Inter-OFL.txt'), /The Inter Project Authors[\s\S]*SIL Open Font License, Version 1\.1/);
  assert.match(read('renderer', 'fonts', 'SourceSerif4-OFL.txt'), /^Copyright 2014 - 2023 Adobe[\s\S]*SIL Open Font License, Version 1\.1/);
  assert.match(read('THIRD-PARTY-NOTICES.md'), /\[Inter\][^\n]*SIL Open Font License 1\.1/);
  assert.match(read('THIRD-PARTY-NOTICES.md'), /\[Source Serif 4\][^\n]*SIL Open Font License 1\.1[^\n]*Adobe/);
  assert.match(read('renderer', 'fonts', 'OFL.txt'), /Copyright 2018 The Readex Pro Project Authors/);
  assert.match(read('THIRD-PARTY-NOTICES.md'), /Readex Pro.*SIL Open Font License 1\.1.*The Readex Pro Project Authors/);
});

test('the content security policies allow fonts from the app only', () => {
  const html = read('renderer', 'index.html');
  assert.match(html, /default-src 'self'/);
  assert.ok(!/font-src/.test(html) || /font-src 'self'/.test(html));
  const build = read('scripts', 'build-web.mjs');
  assert.match(build, /"default-src 'self'"/);
  assert.ok(!/font-src/.test(build) || /font-src 'self'/.test(build));
});

test('Inter and Source Serif 4: English letters only, from the app itself', () => {
  const faces = (css.match(/@font-face\s*\{[^}]*\}/g) || []).filter((x) => /"(Inter|Source Serif 4)"/.test(x));
  assert.strictEqual(faces.length, 6);
  for (const f of faces) {
    assert.match(f, /src:\s*url\("fonts\/[A-Za-z0-9-]+\.woff2"\)\s*format\("woff2"\)/);
    assert.match(f, /font-display:\s*swap/);
    const range = /unicode-range:\s*([^;]+);/.exec(f)[1];
    // Never Arabic: that stays Readex Pro.
    for (const token of range.split(',')) assert.ok(!/^U\+0[6-8]/.test(token.trim()), token);
  }
});
