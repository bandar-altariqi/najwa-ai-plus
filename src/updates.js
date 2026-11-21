// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// Updates (Najwa AI Plus): is there a newer version, and which file is this
// device's. Each release (desktop-latest, android-latest, ios-latest) carries a
// version.json made by scripts/release-manifest.js:
//   { version: "1.0.57", sha, date, notes: ["…"], files: { name: { sha256, size } } }
// The app reads it, offers the update, downloads the file, checks its SHA-256
// and installs it (src/desktop-updater.js on computers, UpdatePlugin.java on
// Android). The iPhone app can't install one itself: it opens the download page.

'use strict';

const REPO = 'bandar-altariqi/najwa-ai-plus';
const PAGE = `https://github.com/${REPO}/releases`;
const CHANNELS = { desktop: 'desktop-latest', android: 'android-latest', ios: 'ios-latest' };

const releaseUrl = (channel, file) => `https://github.com/${REPO}/releases/download/${CHANNELS[channel]}/${encodeURIComponent(file)}`;
const pageUrl = (channel) => `${PAGE}/tag/${CHANNELS[channel]}`;

// "1.0.57" > "1.0.9"; anything that isn't a version is never newer.
function newer(a, b) {
  const parse = (v) => (/^\d+(\.\d+){0,3}$/.test(String(v || '').trim()) ? String(v).trim().split('.').map(Number) : null);
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return false;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d > 0;
  }
  return false;
}

/**
 * This device's file in a release.
 * @param platform  'win32' | 'darwin' | 'linux' | 'android' | 'ios'
 * @param how       on Linux: 'appimage' or 'deb'; on Windows: 'portable' for
 *                  the portable .exe (which can't update itself)
 */
function fileFor(platform, arch, how) {
  if (platform === 'win32') return how === 'portable' ? null : 'Najwa-AI-Plus-Windows-Setup.exe';
  if (platform === 'darwin') return arch === 'arm64' ? 'Najwa-AI-Plus-macOS-AppleSilicon.dmg' : 'Najwa-AI-Plus-macOS-Intel.dmg';
  if (platform === 'linux') return how === 'deb' ? 'Najwa-AI-Plus-Linux.deb' : 'Najwa-AI-Plus-Linux.AppImage';
  if (platform === 'android') return 'Najwa-AI-Plus-android.apk';
  return null;
}

const channelOf = (platform) => (platform === 'android' ? 'android' : platform === 'ios' ? 'ios' : 'desktop');

/**
 * Is there a newer version for this device?
 * @param getJson  (url) -> the parsed version.json (throws when it can't)
 * @returns { available: false, version } or
 *          { available: true, version, notes, file: { name, url, sha256, size } | null, page }
 *          (file is null when this device can't install it by itself)
 */
async function checkForUpdate({ getJson, current, platform, arch, how }) {
  const channel = channelOf(platform);
  const m = await getJson(releaseUrl(channel, 'version.json'));
  const version = m && typeof m.version === 'string' ? m.version.trim() : '';
  if (!version) throw new Error('The release has no version information yet.');
  if (!newer(version, current)) return { available: false, version, current };
  const name = fileFor(platform, arch, how);
  const info = name && m.files && m.files[name];
  const ok = info && /^[0-9a-f]{64}$/i.test(String(info.sha256 || ''));
  const notes = (Array.isArray(m.notes) ? m.notes : []).map((n) => String(n).replace(/\s+/g, ' ').trim().slice(0, 200)).filter(Boolean).slice(0, 12);
  return {
    available: true,
    version,
    current,
    notes,
    page: pageUrl(channel),
    file: ok ? { name, url: releaseUrl(channel, name), sha256: info.sha256.toLowerCase(), size: Number(info.size) || 0 } : null
  };
}

module.exports = { checkForUpdate, newer, fileFor, releaseUrl, pageUrl, REPO, CHANNELS };
