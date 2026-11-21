// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// Updating Najwa AI Plus on a computer, after the user says yes (see
// src/updates.js for the check). The new installer is downloaded, its SHA-256
// is checked against the release's version.json, and then:
//   Windows   the installer runs silently and starts the app again
//   macOS     the new app replaces this one (where it can be written), then
//             opens; otherwise the disk image is opened to drag it over
//   Linux     an AppImage replaces itself and starts again; a .deb is opened
//             with the system's software installer
// A portable Windows app, or a file that doesn't match, isn't installed.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// How this copy was installed, for picking its file (src/updates.js fileFor).
function installKind(env = process.env, platform = process.platform) {
  if (platform === 'win32') return env.PORTABLE_EXECUTABLE_FILE ? 'portable' : 'setup';
  if (platform === 'linux') return env.APPIMAGE ? 'appimage' : 'deb';
  return '';
}

/**
 * Downloads `file` ({ url, sha256, size }) into `dir`, calling onProgress(0..1).
 * Throws when it doesn't match the SHA-256 (the file is then removed).
 */
async function download(file, { dir, fetchImpl, onProgress = () => {}, signal }) {
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, path.basename(file.name));
  const part = `${dest}.part`;
  const res = await fetchImpl(file.url, { signal });
  if (!res.ok) throw new Error(`The download failed (HTTP ${res.status}).`);
  const total = Number(res.headers.get('content-length')) || file.size || 0;
  const hash = crypto.createHash('sha256');
  const out = fs.createWriteStream(part);
  let got = 0;
  let last = 0;
  try {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      got += value.length;
      if (!out.write(value)) await new Promise((r) => out.once('drain', r));
      if (total && (got - last > total / 200 || got === total)) {
        last = got;
        onProgress(Math.min(1, got / total));
      }
    }
    await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
  } catch (err) {
    out.destroy();
    fs.rmSync(part, { force: true });
    throw err;
  }
  if (hash.digest('hex') !== String(file.sha256).toLowerCase()) {
    fs.rmSync(part, { force: true });
    throw new Error('The downloaded file doesn\'t match the release, so it wasn\'t installed. Try again later.');
  }
  fs.renameSync(part, dest);
  onProgress(1);
  return dest;
}

const writable = (dir) => {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
};

// The .app this is running from (…/Najwa AI Plus.app/Contents/MacOS/Najwa AI Plus).
const macAppOf = (execPath) => path.resolve(execPath, '..', '..', '..');

// A shell script that waits for this app to quit, puts the new app in its
// place (putting the old one back if that fails) and opens it.
function macScript({ dmg, target, pid }) {
  const q = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
  return [
    'set -u',
    `while kill -0 ${Number(pid)} 2>/dev/null; do sleep 0.5; done`,
    'MNT=$(mktemp -d)',
    `hdiutil attach -nobrowse -noautoopen -mountpoint "$MNT" ${q(dmg)} >/dev/null || { open ${q(dmg)}; exit 1; }`,
    'APP=$(ls -d "$MNT"/*.app | head -n 1)',
    `rm -rf ${q(`${target}.old`)}`,
    `if mv ${q(target)} ${q(`${target}.old`)} && ditto "$APP" ${q(target)}; then rm -rf ${q(`${target}.old`)}; else rm -rf ${q(target)}; mv ${q(`${target}.old`)} ${q(target)}; fi`,
    'hdiutil detach "$MNT" -quiet || true',
    `xattr -dr com.apple.quarantine ${q(target)} 2>/dev/null || true`,
    `open ${q(target)}`
  ].join('\n');
}

/**
 * Installs a downloaded file. Returns { restarting: true } when the app is
 * about to quit for it, or { opened: true } when the system's installer (or
 * the disk image) was opened for the user to finish.
 * @param quit      quits the app (app.quit)
 * @param openPath  opens a file with the system (shell.openPath)
 */
async function install(filePath, { platform = process.platform, env = process.env, execPath = process.execPath, pid = process.pid, quit, openPath, spawnImpl = spawn }) {
  const detached = (cmd, args) => spawnImpl(cmd, args, { detached: true, stdio: 'ignore' }).unref();
  if (platform === 'win32') {
    // NSIS (electron-builder): /S silently, --updated keeps the install
    // folder, --force-run starts the app when it's done.
    detached(filePath, ['/S', '--updated', '--force-run']);
    quit();
    return { restarting: true };
  }
  if (platform === 'darwin') {
    const target = macAppOf(execPath);
    // Run from the disk image, or from a folder this user can't write to
    // (or a quarantined copy macOS moved): the user drags it over.
    if (!target.endsWith('.app') || /AppTranslocation|^\/Volumes\//.test(target) || !writable(path.dirname(target)) || !writable(target)) {
      await openPath(filePath);
      return { opened: true };
    }
    detached('/bin/bash', ['-c', macScript({ dmg: filePath, target, pid })]);
    quit();
    return { restarting: true };
  }
  if (platform === 'linux' && env.APPIMAGE && /\.AppImage$/.test(filePath)) {
    const target = env.APPIMAGE;
    if (!writable(path.dirname(target))) {
      await openPath(path.dirname(filePath));
      return { opened: true };
    }
    const next = `${target}.new`;
    fs.copyFileSync(filePath, next);
    fs.chmodSync(next, 0o755);
    fs.renameSync(next, target);   // the running copy keeps its old file
    detached(target, []);
    quit();
    return { restarting: true };
  }
  // A .deb: the system's software installer asks for the password.
  await openPath(filePath);
  return { opened: true };
}

module.exports = { download, install, installKind, macScript, macAppOf };
