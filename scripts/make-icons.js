// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// Draws the Najwa AI Plus icon and writes the desktop icon, the website logos, and
// the Android and iOS launcher icons and splash screens.
//
// The mark: a white N, you, over a chat bubble, Najwa answering, with a
// sparkle for AI, and the word PLUS under it. Plus is deep violet and gold
// where Najwa AI is navy and rose, so the two apps look apart side by side.
// build/icon.svg is the same artwork as a vector, for print and the web.
//
//   node scripts/make-icons.js      (needs the dev dependency @resvg/resvg-js)

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { Resvg } = require('@resvg/resvg-js');

const root = path.resolve(__dirname, '..');
const NAVY_TOP = '#3f3178';     // violet (Najwa AI: navy #2d4372 → #1c2b4d)
const NAVY_BOTTOM = '#241a4d';
const NAVY_FLAT = '#31265f';   // Android's adaptive icon background (one colour)
const GOLD = '#f2b45c';        // the bubble and PLUS (Najwa AI: rose #e3968d)

// The mark in a 512×512 design space.
// PLUS is drawn in round strokes like the N (cap height 44), so no font is needed.
const PLUS_LETTERS = [
  ['M0 44V0H16a13 13 0 0 1 0 26H0', 29],
  ['M0 0V44H26', 26],
  ['M0 0V29a14 14 0 0 0 28 0V0', 28],
  ['M27 7C24 2 19 0 14 0C7 0 1 4 1 11C1 25 28 19 28 33C28 40 22 44 14 44C8 44 3 42 0 37', 28]
];
const plusWord = (color) => {
  const gap = 17;
  let x = 256 - (PLUS_LETTERS.reduce((n, [, w]) => n + w, 0) + gap * (PLUS_LETTERS.length - 1)) / 2;
  const letters = PLUS_LETTERS.map(([d, w]) => {
    const p = `<path transform="translate(${x} 0)" d="${d}"/>`;
    x += w + gap;
    return p;
  }).join('');
  return `<g transform="translate(0 362)" fill="none" stroke="${color}" stroke-width="13" stroke-linecap="round" stroke-linejoin="round">${letters}</g>`;
};

const mark = ({ n = '#ffffff', bubble = GOLD, spark = '#ffffff', word = GOLD } = {}) => `
  <g transform="translate(256 214) scale(0.8) translate(-256 -256)"><g transform="translate(-6 -10)">
    <path fill="${bubble}" d="M226 130H346A62 62 0 0 1 408 192V290A62 62 0 0 1 346 352H344L374 402L302 352H226A62 62 0 0 1 164 290V192A62 62 0 0 1 226 130Z"/>
    <path fill="none" stroke="${n}" stroke-width="42" stroke-linecap="round" stroke-linejoin="round" d="M150 362V160L318 362V160"/>
    <path fill="${spark}" d="M366 150q5 22 27 27q-22 5-27 27q-5-22-27-27q22-5 27-27z"/>
  </g></g>${plusWord(word)}`;
const MARK_DARK = mark();

const gradient = `<linearGradient id="navy" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="${NAVY_TOP}"/><stop offset="1" stop-color="${NAVY_BOTTOM}"/></linearGradient>`;

/**
 * Render an image.
 * @param {number} w, h        output size in pixels
 * @param {object} o
 *   o.iconSize   pixel size of the 512-unit design space (centred)
 *   o.background 'rounded' | 'circle' | 'fill' | 'none'
 *   o.opaque     no alpha channel (the App Store rejects icons that have one)
 */
function render(w, h, o) {
  const k = o.iconSize / 512;
  const x = (w - o.iconSize) / 2;
  const y = (h - o.iconSize) / 2;
  const bg = {
    fill: `<rect width="${w}" height="${h}" fill="url(#navy)"/>`,
    rounded: `<rect x="${x + 16 * k}" y="${y + 16 * k}" width="${480 * k}" height="${480 * k}" rx="${110 * k}" fill="url(#navy)"/>`,
    circle: `<circle cx="${w / 2}" cy="${h / 2}" r="${250 * k}" fill="url(#navy)"/>`,
    none: ''
  }[o.background];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>${gradient}</defs>${bg}
  <svg x="${x}" y="${y}" width="${o.iconSize}" height="${o.iconSize}" viewBox="0 0 512 512">${MARK_DARK}</svg></svg>`;
  const img = new Resvg(svg).render();
  return o.opaque ? encodePng(w, h, img.pixels, { opaque: true }) : img.asPng();
}

// ---- minimal PNG encoder / size reader --------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
}

// RGBA, or RGB with `opaque` (the App Store rejects app icons that have an
// alpha channel).
function encodePng(w, h, px, { opaque = false } = {}) {
  const ch = opaque ? 3 : 4;
  const raw = Buffer.alloc(h * (w * ch + 1));
  for (let y = 0; y < h; y++) {
    if (!opaque) {
      px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
      continue;
    }
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      const i = (y * w + x) * 4;
      raw[o] = px[i];
      raw[o + 1] = px[i + 1];
      raw[o + 2] = px[i + 2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = opaque ? 2 : 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function pngSize(file) {
  const b = fs.readFileSync(file);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

function write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  console.log('wrote', path.relative(root, file));
}

// ---- outputs ---------------------------------------------------------------

write(path.join(root, 'build/icon.png'), render(512, 512, { iconSize: 512, background: 'rounded' }));
write(path.join(root, 'build/icon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>${gradient}</defs>
  <rect x="16" y="16" width="480" height="480" rx="110" fill="url(#navy)"/>${MARK_DARK}
</svg>
`);

// Website: the logo for Google's sign-in screen (square, 120×120, full
// background so it looks right when Google rounds it) and the page icon.
write(path.join(root, 'site/logo-120.png'), render(120, 120, { iconSize: 120, background: 'fill' }));
write(path.join(root, 'site/icon.png'), render(192, 192, { iconSize: 192, background: 'rounded' }));

const res = path.join(root, 'android/app/src/main/res');
if (fs.existsSync(res)) {
  const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [d, k] of Object.entries(densities)) {
    const legacy = Math.round(48 * k);
    write(`${res}/mipmap-${d}/ic_launcher.png`, render(legacy, legacy, { iconSize: legacy, background: 'rounded' }));
    write(`${res}/mipmap-${d}/ic_launcher_round.png`, render(legacy, legacy, { iconSize: legacy, background: 'circle' }));
    // Adaptive icon foreground: 108dp canvas, artwork inside the 66dp safe zone.
    const fg = Math.round(108 * k);
    write(`${res}/mipmap-${d}/ic_launcher_foreground.png`, render(fg, fg, { iconSize: Math.round(94 * k), background: 'none' }));
  }
  // Splash screens: navy with the mark in the middle.
  for (const dir of fs.readdirSync(res)) {
    const file = path.join(res, dir, 'splash.png');
    if (!fs.existsSync(file)) continue;
    const [w, h] = pngSize(file);
    write(file, render(w, h, { iconSize: Math.round(Math.min(w, h) * 0.45), background: 'fill' }));
  }
  write(`${res}/values/ic_launcher_background.xml`,
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${NAVY_FLAT}</color>\n</resources>\n`);
}

// iOS: one 1024×1024 app icon (iOS rounds the corners itself, so the
// background fills the square) and the launch screen images.
const ios = path.join(root, 'ios/App/App/Assets.xcassets');
if (fs.existsSync(ios)) {
  write(`${ios}/AppIcon.appiconset/AppIcon-512@2x.png`, render(1024, 1024, { iconSize: 1024, background: 'fill', opaque: true }));
  for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
    const file = `${ios}/Splash.imageset/${name}`;
    if (fs.existsSync(file)) write(file, render(2732, 2732, { iconSize: 900, background: 'fill', opaque: true }));
  }
}
