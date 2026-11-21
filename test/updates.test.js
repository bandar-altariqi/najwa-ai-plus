// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// Updates: finding a newer version (src/updates.js), the release's
// version.json (scripts/release-manifest.js), downloading and checking it and
// installing it on a computer (src/desktop-updater.js), and the wiring on the
// computer, the phone and in the release workflows.

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { checkForUpdate, newer, fileFor, releaseUrl } = require('../src/updates');
const updater = require('../src/desktop-updater');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'najwa-update-'));

test('versions: newer only when it really is', () => {
  assert.ok(newer('1.0.57', '1.0.9'));
  assert.ok(newer('1.1', '1.0.99'));
  assert.ok(newer('1.0.10', '1.0.9'));
  assert.ok(!newer('1.0.9', '1.0.9'));
  assert.ok(!newer('1.0.8', '1.0.9'));
  assert.ok(!newer('1.0.0', '1.0'));
  assert.ok(!newer('latest', '1.0.0'));
  assert.ok(!newer('2.0.0', ''));
});

test('each device gets its own file', () => {
  assert.strictEqual(fileFor('win32', 'x64', 'setup'), 'Najwa-AI-Plus-Windows-Setup.exe');
  assert.strictEqual(fileFor('win32', 'x64', 'portable'), null);
  assert.strictEqual(fileFor('darwin', 'arm64'), 'Najwa-AI-Plus-macOS-AppleSilicon.dmg');
  assert.strictEqual(fileFor('darwin', 'x64'), 'Najwa-AI-Plus-macOS-Intel.dmg');
  assert.strictEqual(fileFor('linux', 'x64', 'appimage'), 'Najwa-AI-Plus-Linux.AppImage');
  assert.strictEqual(fileFor('linux', 'x64', 'deb'), 'Najwa-AI-Plus-Linux.deb');
  assert.strictEqual(fileFor('android'), 'Najwa-AI-Plus-android.apk');
  assert.strictEqual(fileFor('ios'), null);
  assert.strictEqual(updater.installKind({ PORTABLE_EXECUTABLE_FILE: 'C:\\x.exe' }, 'win32'), 'portable');
  assert.strictEqual(updater.installKind({}, 'win32'), 'setup');
  assert.strictEqual(updater.installKind({ APPIMAGE: '/home/u/N.AppImage' }, 'linux'), 'appimage');
  assert.strictEqual(updater.installKind({}, 'linux'), 'deb');
});

test('the check reads the release\'s version.json', async () => {
  const H = 'a'.repeat(64);
  const manifest = {
    version: '1.0.60',
    notes: ['Let the model add connectors itself', '  Fix   spacing  ', ''],
    files: { 'Najwa-AI-Plus-Windows-Setup.exe': { sha256: H, size: 123 }, 'Najwa-AI-Plus-android.apk': { sha256: 'not-a-hash', size: 5 } }
  };
  const asked = [];
  const getJson = async (url) => { asked.push(url); return manifest; };

  const win = await checkForUpdate({ getJson, current: '1.0.57', platform: 'win32', arch: 'x64', how: 'setup' });
  assert.strictEqual(asked[0], 'https://github.com/bandar-altariqi/najwa-ai-plus/releases/download/desktop-latest/version.json');
  assert.deepStrictEqual(win.file, { name: 'Najwa-AI-Plus-Windows-Setup.exe', url: releaseUrl('desktop', 'Najwa-AI-Plus-Windows-Setup.exe'), sha256: H, size: 123 });
  assert.deepStrictEqual(win.notes, ['Let the model add connectors itself', 'Fix spacing']);
  assert.strictEqual(win.page, 'https://github.com/bandar-altariqi/najwa-ai-plus/releases/tag/desktop-latest');

  assert.deepStrictEqual(await checkForUpdate({ getJson, current: '1.0.60', platform: 'win32', arch: 'x64' }), { available: false, version: '1.0.60', current: '1.0.60' });
  // No file with a real hash: offered, but only the download page.
  const phone = await checkForUpdate({ getJson, current: '1.0.1', platform: 'android' });
  assert.ok(phone.available);
  assert.strictEqual(phone.file, null);
  assert.match(asked[asked.length - 1], /android-latest\/version\.json$/);
  const iphone = await checkForUpdate({ getJson, current: '1.0.1', platform: 'ios' });
  assert.strictEqual(iphone.file, null);
  assert.match(iphone.page, /ios-latest$/);
  await assert.rejects(checkForUpdate({ getJson: async () => ({}), current: '1.0.1', platform: 'linux' }), /no version information/);
});

test('version.json: each file\'s SHA-256 and size, and what\'s new since the last one', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'Najwa-AI-Plus-android.apk'), 'apk bytes');
  fs.writeFileSync(path.join(dir, 'version.json'), '{"old":true}');
  const prev = path.join(tmp(), 'prev.json');
  const twoBack = execFileSync('git', ['rev-parse', 'HEAD~2'], { cwd: ROOT, encoding: 'utf8' }).trim();
  fs.writeFileSync(prev, JSON.stringify({ version: '1.0.1', sha: twoBack }));
  execFileSync('node', ['scripts/release-manifest.js', '--version', '1.0.2', '--dir', dir, '--prev', prev], { cwd: ROOT, stdio: 'pipe' });
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'version.json'), 'utf8'));
  assert.strictEqual(m.version, '1.0.2');
  assert.deepStrictEqual(m.files, { 'Najwa-AI-Plus-android.apk': { sha256: sha(Buffer.from('apk bytes')), size: 9 } });
  const subjects = execFileSync('git', ['log', '--no-merges', '--format=%s', `${twoBack}..HEAD`], { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  assert.deepStrictEqual(m.notes, subjects.slice(0, 12));
  // No previous one (the first release): the last commit.
  fs.rmSync(path.join(dir, 'version.json'));
  execFileSync('node', ['scripts/release-manifest.js', '--version', '1.0.3', '--dir', dir], { cwd: ROOT, stdio: 'pipe' });
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'version.json'), 'utf8')).notes.length, 1);
  assert.throws(() => execFileSync('node', ['scripts/release-manifest.js', '--version', 'latest', '--dir', dir], { cwd: ROOT, stdio: 'pipe' }));
});

// Sent in pieces, like a real download.
const fakeFetch = (buf) => async () => new Response(new ReadableStream({
  start(c) {
    for (let i = 0; i < buf.length; i += 16384) c.enqueue(new Uint8Array(buf.subarray(i, i + 16384)));
    c.close();
  }
}), { status: 200, headers: { 'content-length': String(buf.length) } });

test('the download is kept only when it matches the release', async () => {
  const buf = Buffer.alloc(300000, 7);
  const dir = tmp();
  const seen = [];
  const file = await updater.download({ name: 'Najwa-AI-Plus-Linux.AppImage', url: 'https://x/a', sha256: sha(buf), size: buf.length }, { dir, fetchImpl: fakeFetch(buf), onProgress: (p) => seen.push(p) });
  assert.strictEqual(file, path.join(dir, 'Najwa-AI-Plus-Linux.AppImage'));
  assert.ok(fs.readFileSync(file).equals(buf));
  assert.strictEqual(seen[seen.length - 1], 1);
  assert.ok(seen.length > 2);

  const other = tmp();
  await assert.rejects(updater.download({ name: 'Najwa-AI-Plus-Windows-Setup.exe', url: 'https://x/b', sha256: 'b'.repeat(64) }, { dir: other, fetchImpl: fakeFetch(buf) }), /doesn't match the release/);
  assert.deepStrictEqual(fs.readdirSync(other), []);
  await assert.rejects(updater.download({ name: 'x', url: 'https://x/c', sha256: 'b'.repeat(64) }, { dir: other, fetchImpl: async () => new Response('', { status: 404 }) }), /HTTP 404/);
  // Only its own name, never a path.
  const sneaky = await updater.download({ name: '../../evil.exe', url: 'https://x/d', sha256: sha(buf) }, { dir: other, fetchImpl: fakeFetch(buf) });
  assert.strictEqual(path.dirname(sneaky), other);
});

test('installing: Windows silently, an AppImage in place, macOS by replacing the app, a .deb with the system', async () => {
  const calls = [];
  const spawnImpl = (cmd, args, opts) => { calls.push({ cmd, args, opts }); return { unref() {} }; };
  let quits = 0;
  const opened = [];
  const base = { quit: () => { quits++; }, openPath: async (f) => { opened.push(f); }, spawnImpl };

  assert.deepStrictEqual(await updater.install('C:\\T\\setup.exe', { ...base, platform: 'win32', env: {} }), { restarting: true });
  assert.deepStrictEqual(calls[0].args, ['/S', '--updated', '--force-run']);
  assert.strictEqual(calls[0].opts.detached, true);
  assert.strictEqual(quits, 1);

  const dir = tmp();
  const appimage = path.join(dir, 'Najwa-AI-Plus.AppImage');
  fs.writeFileSync(appimage, 'old');
  const fresh = path.join(tmp(), 'Najwa-AI-Plus-Linux.AppImage');
  fs.writeFileSync(fresh, 'new');
  assert.deepStrictEqual(await updater.install(fresh, { ...base, platform: 'linux', env: { APPIMAGE: appimage } }), { restarting: true });
  assert.strictEqual(fs.readFileSync(appimage, 'utf8'), 'new');
  assert.ok(fs.statSync(appimage).mode & 0o100);
  assert.strictEqual(calls[1].cmd, appimage);
  assert.strictEqual(quits, 2);

  assert.deepStrictEqual(await updater.install('/tmp/x/Najwa-AI-Plus-Linux.deb', { ...base, platform: 'linux', env: {} }), { opened: true });
  assert.strictEqual(opened[0], '/tmp/x/Najwa-AI-Plus-Linux.deb');
  assert.strictEqual(quits, 2);

  // macOS, run from a disk image: the image is opened instead.
  assert.deepStrictEqual(await updater.install('/tmp/n.dmg', { ...base, platform: 'darwin', execPath: '/Volumes/Najwa AI Plus/Najwa AI Plus.app/Contents/MacOS/Najwa AI Plus' }), { opened: true });
  // From a folder it can write: replaced after it quits, then opened.
  const apps = tmp();
  const app = path.join(apps, 'Najwa AI Plus.app');
  fs.mkdirSync(path.join(app, 'Contents', 'MacOS'), { recursive: true });
  assert.deepStrictEqual(await updater.install('/tmp/n.dmg', { ...base, platform: 'darwin', execPath: path.join(app, 'Contents', 'MacOS', 'Najwa AI Plus'), pid: 4242 }), { restarting: true });
  const mac = calls[calls.length - 1];
  assert.strictEqual(mac.cmd, '/bin/bash');
  assert.match(mac.args[1], /while kill -0 4242/);
  assert.match(mac.args[1], /ditto "\$APP" '.*Najwa AI Plus\.app'/);
  assert.match(mac.args[1], /mv '.*\.app\.old' '.*\.app'/);   // puts the old one back if copying fails
  assert.strictEqual(updater.macAppOf('/A/N.app/Contents/MacOS/N'), '/A/N.app');
  // Quotes in a path can't break out of the script.
  assert.match(updater.macScript({ dmg: "/tmp/it's.dmg", target: '/A/N.app', pid: 1 }), /'\/tmp\/it'\\''s\.dmg'/);
});

test('wired in: the computer, the phone, Android and the release workflows', () => {
  const main = read('main.js');
  assert.match(main, /ipcMain\.handle\('updates:check'/);
  assert.match(main, /if \(!app\.isPackaged\) return/);
  assert.match(main, /ipcMain\.handle\('updates:install'/);
  assert.match(read('preload.js'), /updates: \{\s*check: invoke\('updates:check'\),\s*install: invoke\('updates:install'\)/);
  const bridge = read('mobile/src/bridge.js');
  assert.match(bridge, /registerPlugin\('Update'\)/);
  assert.match(bridge, /UpdatePlugin\.install\(\{ url: u\.file\.url, sha256: u\.file\.sha256 \}\)/);
  const app = read('renderer/app.js');
  assert.match(app, /loadModels\(\);\n  Updates\.start\(\);/);
  assert.match(app, /S\.settings\.checkUpdates === false/);
  assert.match(read('src/storage.js'), /checkUpdates: true/);

  assert.match(read('android/app/src/main/AndroidManifest.xml'), /android\.permission\.REQUEST_INSTALL_PACKAGES/);
  assert.match(read('android/app/src/main/java/com/bandaraltariqi/najwa/MainActivity.java'), /registerPlugin\(UpdatePlugin\.class\)/);
  const plugin = read('android/app/src/main/java/com/bandaraltariqi/najwa/UpdatePlugin.java');
  assert.match(plugin, /RELEASES = "https:\/\/github\.com\/bandar-altariqi\/najwa-ai-plus\/releases\/download\/"/);
  assert.match(plugin, /!url\.startsWith\(RELEASES\) \|\| !sha256\.matches/);
  assert.match(plugin, /if \(!"https"\.equals\(next\.getProtocol\(\)\)\)/);
  assert.match(plugin, /if \(!hex\.toString\(\)\.equals\(sha256\)\)/);

  // version.json goes up after the files it describes.
  for (const [wf, file] of [['build.yml', 'out/\\*'], ['android.yml', 'Najwa-AI-Plus-android\\.apk'], ['ios.yml', 'Najwa-AI-Plus-iOS-unsigned\\.ipa']]) {
    const y = read(`.github/workflows/${wf}`);
    const files = y.search(new RegExp(`gh release upload \\S+ ${file} --clobber`));
    const manifest = y.search(/gh release upload \S+ manifest\/version\.json --clobber/);
    assert.ok(files > 0 && manifest > files, wf);
    assert.match(y, /node scripts\/release-manifest\.js --version "[^"]+" --dir manifest --prev prev\/version\.json/);
    assert.match(y, /fetch-depth: 0/);
  }
  // A phone can't update to a test-key build.
  assert.match(read('.github/workflows/android.yml'), /if \[ -n "\$BALIMDA_KEYSTORE_BASE64" \]; then\n\s+mkdir -p prev manifest/);
});
