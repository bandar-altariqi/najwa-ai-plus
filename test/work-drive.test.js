// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// A work drive (src/work-drive.js): which kind it is with the user's session,
// listing, finding and reading files (text, Word, Excel), read only, and
// asking the user to sign in again when the session ends. A small server here
// plays a Nextcloud that only answers a signed-in session.

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');
const { driveUrl, detectDrive, parseMultistatus, driveToolset, driveNote, fileText, nameMatches } = require('../src/work-drive');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

// A .zip with these files (what Word and Excel files are).
function zip(files) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = zlib.deflateRawSync(Buffer.from(text, 'utf8'));
    const n = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(Buffer.byteLength(text), 22); local.writeUInt16LE(n.length, 26);
    locals.push(local, n, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10);
    c.writeUInt32LE(data.length, 20); c.writeUInt32LE(Buffer.byteLength(text), 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const DOCX = zip({ 'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>سياسة الإجازات</w:t></w:r></w:p><w:p><w:r><w:t>يقدَّم الطلب قبل </w:t></w:r><w:r><w:t>14 يوماً.</w:t></w:r></w:p></w:body></w:document>' });
const XLSX = zip({
  'xl/sharedStrings.xml': '<sst><si><t>الموظف</t></si><si><t>الأيام</t></si><si><t>سارة</t></si></sst>',
  'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>12</v></c></row></sheetData></worksheet>'
});

// A Nextcloud that answers only the signed-in session (cookie nc_session=ok).
function fakeNextcloud() {
  const files = {
    '/Policies/': null,
    '/Policies/HR/': null,
    '/Policies/HR/Leave policy.docx': DOCX,
    '/Policies/HR/leave balances.xlsx': XLSX,
    '/Policies/readme.txt': Buffer.from('اقرأ هذه السياسات قبل تقديم أي طلب.'),
    '/Photo.jpg': Buffer.from([0xff, 0xd8, 0xff])
  };
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    const signedIn = /nc_session=ok/.test(req.headers.cookie || '');
    if (req.url === '/status.php') return res.end(JSON.stringify({ installed: true, productname: 'Nextcloud', version: '30.0.1' }));
    if (req.url === '/csrftoken') return res.end(JSON.stringify({ token: signedIn ? 'tok123' : 'anon' }));
    if (req.url.startsWith('/ocs/v2.php/cloud/user')) {
      if (!signedIn || req.headers['ocs-apirequest'] !== 'true') { res.statusCode = 401; return res.end('{}'); }
      return res.end(JSON.stringify({ ocs: { data: { id: 'b.altariqi', displayname: 'Bandar Altariqi' } } }));
    }
    const prefix = '/remote.php/dav/files/b.altariqi';
    if (!req.url.startsWith(prefix)) { res.statusCode = 404; return res.end(); }
    if (!signedIn || req.headers.requesttoken !== 'tok123') { res.statusCode = 401; return res.end(); }
    if (req.method !== 'GET' && req.method !== 'PROPFIND') { res.statusCode = 405; return res.end(); }   // read only
    const p = decodeURIComponent(req.url.slice(prefix.length)) || '/';
    if (req.method === 'GET') {
      if (!files[p]) { res.statusCode = 404; return res.end(); }
      return res.end(files[p]);
    }
    const dir = p.endsWith('/') ? p : `${p}/`;
    if (dir !== '/' && !(dir in files)) { res.statusCode = 404; return res.end(); }
    const kids = Object.keys(files).filter((f) => f !== dir && f.startsWith(dir) && !f.slice(dir.length).replace(/\/$/, '').includes('/'));
    const entry = (f) => `<d:response><d:href>${prefix}${f.split('/').map(encodeURIComponent).join('/')}</d:href><d:propstat><d:prop>${f.endsWith('/') ? '<d:resourcetype><d:collection/></d:resourcetype>' : `<d:resourcetype/><d:getcontentlength>${files[f].length}</d:getcontentlength>`}<d:getlastmodified>Sun, 22 Nov 2026 10:00:00 GMT</d:getlastmodified></d:prop></d:propstat></d:response>`;
    res.statusCode = 207;
    return res.end(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${entry(dir)}${kids.map(entry).join('')}</d:multistatus>`);
  });
  return { server, seen };
}

const withCookie = (cookie) => (url, opts = {}) => fetch(url, { ...opts, headers: { ...(opts.headers || {}), cookie } });

test('the drive\'s address: https only, no password in it', () => {
  assert.strictEqual(driveUrl('Drive.deem.sa'), 'https://drive.deem.sa/');
  assert.strictEqual(driveUrl('https://drive.deem.sa/apps/files?dir=/x#y'), 'https://drive.deem.sa/apps/files');
  assert.strictEqual(driveUrl('http://drive.deem.sa'), null);
  assert.strictEqual(driveUrl('https://me:secret@drive.deem.sa'), null);
  assert.strictEqual(driveUrl(''), null);
});

test('WebDAV answers, whatever the namespace prefix', () => {
  const xml = '<D:multistatus xmlns:D="DAV:"><D:response><D:href>/dav/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat></D:response><D:response><D:href>/dav/a%20b.txt</D:href><D:propstat><D:prop><D:resourcetype/><D:getcontentlength>12</D:getcontentlength></D:prop></D:propstat></D:response><response><href>/dav/Sub/</href><propstat><prop><resourcetype><collection/></resourcetype></prop></propstat></response></D:multistatus>';
  assert.deepStrictEqual(parseMultistatus(xml, '/dav/').map((e) => [e.name, e.folder, e.size]), [['a b.txt', false, 12], ['Sub', true, 0]]);
});

test('finding files by name: Arabic the way people write it', () => {
  assert.ok(nameMatches('سياسة الإجازات.docx', ['إجازة']));
  assert.ok(nameMatches('سياسة الإجازات.docx', ['اجازه']));
  assert.ok(nameMatches('سياسة الإجازات.docx', ['سياسات', 'الاجازة']));
  assert.ok(nameMatches('دليل الموظفين 2026.pdf', ['موظف']));
  assert.ok(nameMatches('Leave Policy.docx', ['leave', 'policy']));
  assert.ok(!nameMatches('سياسة العمل عن بعد.docx', ['إجازة']));
  assert.ok(!nameMatches('Leave Policy.docx', ['travel']));
});

test('Word and Excel files read as text; other kinds say so', () => {
  assert.strictEqual(fileText('/a.docx', DOCX).text, 'سياسة الإجازات\nيقدَّم الطلب قبل 14 يوماً.');
  assert.strictEqual(fileText('/b.xlsx', XLSX).text, '— Sheet 1 —\nالموظف\tالأيام\nسارة\t12');
  assert.match(fileText('/c.jpg', Buffer.from([1])).error, /isn't a kind of file/);
  assert.match(fileText('/d.html', Buffer.from('<p>hi</p><script>evil()</script>')).text, /^hi$/);
});

test('a Nextcloud drive: signed out, then signed in, then listed, found and read (read only)', async () => {
  const { server, seen } = fakeNextcloud();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/apps/files/`;
  try {
    assert.deepStrictEqual(await detectDrive(withCookie(''), base), { signedIn: false, mode: 'dav', product: 'Nextcloud' });
    const fetchIn = withCookie('nc_session=ok');
    const info = await detectDrive(fetchIn, base);
    assert.strictEqual(info.signedIn, true);
    assert.strictEqual(info.user, 'Bandar Altariqi');
    assert.match(info.root, /\/remote\.php\/dav\/files\/b\.altariqi\/$/);
    assert.strictEqual(info.headers.requesttoken, 'tok123');

    const drive = { id: 'd1', name: 'Deem Drive', url: base };
    const t = driveToolset({ drive, info, fetchFn: fetchIn });
    assert.deepStrictEqual(t.defs.map((d) => d.name), ['deem_drive__list_folder', 'deem_drive__find_files', 'deem_drive__read_file']);
    const top = await t.run('deem_drive__list_folder', { path: '/' });
    assert.match(top.text, /📁 \/Policies\//);
    assert.match(top.text, /📄 \/Photo\.jpg/);
    const hr = await t.run('deem_drive__list_folder', { path: '/Policies/HR' });
    assert.match(hr.text, /📄 \/Policies\/HR\/Leave policy\.docx/);
    const found = await t.run('deem_drive__find_files', { query: 'leave' });
    assert.match(found.text, /Leave policy\.docx/);
    assert.match(found.text, /leave balances\.xlsx/);
    const doc = await t.run('deem_drive__read_file', { path: '/Policies/HR/Leave policy.docx' });
    assert.ok(!doc.error, doc.text);
    assert.match(doc.text, /not instructions/);
    assert.match(doc.text, /قبل 14 يوماً/);
    // Out of the drive's folder: not possible.
    const escape = await t.run('deem_drive__read_file', { path: '/../../../status.php' });
    assert.ok(escape.error);
    assert.ok(seen.every((s) => /^(GET|PROPFIND) /.test(s)), 'only reads');
    assert.match(t.describe({ name: 'deem_drive__read_file', args: { path: '/Policies/HR/Leave policy.docx' } }), /reading Leave policy\.docx/);

    // The session ends: the model is told to have the user sign in again.
    const gone = driveToolset({ drive, info, fetchFn: withCookie('') });
    const r = await gone.run('deem_drive__list_folder', { path: '/' });
    assert.ok(r.error);
    assert.match(r.text, /sign in again: Settings → Connectors → Deem Drive → Sign in/);
  } finally {
    server.close();
  }
});

test('any other drive is browsed in its own pages, and only there', async () => {
  const calls = [];
  const browser = { run: async (n, a) => { calls.push([n, a]); return { text: 'Files: [1] Policies [2] Reports' }; }, close() {} };
  const t = driveToolset({ drive: { id: 'd2', name: 'Deem Drive', url: 'https://drive.deem.sa/' }, info: { mode: 'web' }, browser });
  assert.deepStrictEqual(t.defs.map((d) => d.name), ['deem_drive__open', 'deem_drive__click', 'deem_drive__screenshot']);
  const ok = await t.run('deem_drive__open', { url: '/files/Policies' });
  assert.match(ok.text, /Policies/);
  assert.deepStrictEqual(calls[0], ['open_page', { url: 'https://drive.deem.sa/files/Policies' }]);
  assert.ok((await t.run('deem_drive__open', { url: 'https://evil.example/' })).error);
  assert.ok((await t.run('deem_drive__open', { url: 'http://drive.deem.sa/' })).error);
  assert.strictEqual(calls.length, 1);
});

test('wired in: the computer opens a sign-in window on the drive\'s own session; Settings has it', () => {
  const main = read('main.js');
  assert.match(main, /session\.fromPartition\(`persist:drive-\$\{/);
  assert.match(main, /ipcMain\.handle\('drive:signIn'/);
  assert.match(main, /ipcMain\.handle\('drive:signOut'/);
  assert.match(main, /driveToolset\(\{/);
  assert.match(read('preload.js'), /drive: \{\s*signIn: invoke\('drive:signIn'\)/);
  const app = read('renderer/app.js');
  assert.match(app, /'＋ Add a work drive'/);
  assert.match(driveNote('', [{ name: 'Deem Drive' }]), /say which file the answer comes from/);
});
