// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// The computer's browser for models (see src/browser-tools.js): a real
// browser (Electron's own Chromium), hidden, that the model drives with
// tools. Pages run their JavaScript like in any browser.
//
// It's kept apart from you: its own private session (nothing saved to disk,
// none of your logins), no downloads, no pop-up windows, no camera,
// microphone, location or notifications, and the sound off. Each reply gets a
// fresh window that's closed when the reply is done.

'use strict';

const { BrowserWindow, session } = require('electron');
const { scriptedBrowser, loadError } = require('./browser-scripted');

const PARTITION = 'najwa-model-browser'; // no "persist:", so it stays in memory
const LOAD_TIMEOUT_MS = 25000;

let sessionReady = false;
function browserSession() {
  const ses = session.fromPartition(PARTITION);
  if (!sessionReady) {
    sessionReady = true;
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    ses.on('will-download', (e) => e.preventDefault());
    // Look like an ordinary Chrome: some sites turn away "Electron".
    ses.setUserAgent(ses.getUserAgent().replace(/\s(Electron|najwa-ai|Najwa AI|balimda)\/\S+/gi, ''));
  }
  return ses;
}

// An engine for src/browser-scripted.js: a hidden window.
function desktopEngine() {
  let win = null;

  const open = () => {
    if (win && !win.isDestroyed()) return win;
    win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: {
        session: browserSession(),
        offscreen: true, // drawn even though it's never shown, for screenshots
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false
      }
    });
    win.webContents.setAudioMuted(true);
    // A link that opens a new window opens here instead.
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) setImmediate(() => win && !win.isDestroyed() && win.loadURL(url).catch(() => {}));
      return { action: 'deny' };
    });
    // Only web pages: no file://, no app links.
    win.webContents.on('will-navigate', (e, url) => {
      if (!/^https?:/.test(url)) e.preventDefault();
    });
    return win;
  };

  return {
    viewport: '1280×900 computer',
    async load(url, signal) {
      const w = open();
      const stop = () => { if (!w.isDestroyed()) w.webContents.stop(); };
      if (signal) signal.addEventListener('abort', stop, { once: true });
      try {
        await Promise.race([
          w.loadURL(url),
          new Promise((_, reject) => setTimeout(() => reject(new Error('The page took too long to load.')), LOAD_TIMEOUT_MS))
        ]).catch((err) => {
          // A page that loaded but whose extras failed still counts.
          if (/ERR_ABORTED/.test(String(err && err.message)) && w.webContents.getURL()) return;
          throw new Error(loadError(err));
        });
      } finally {
        if (signal) signal.removeEventListener('abort', stop);
      }
    },
    run: (js) => open().webContents.executeJavaScript(js, true),
    async pressEnter() {
      for (const type of ['keyDown', 'char', 'keyUp']) open().webContents.sendInputEvent({ type, keyCode: type === 'char' ? '\r' : 'Enter' });
    },
    async screenshot() {
      const img = await open().webContents.capturePage();
      if (img.isEmpty()) return null;
      const small = img.getSize().width > 1024 ? img.resize({ width: 1024 }) : img;
      return `data:image/jpeg;base64,${small.toJPEG(70).toString('base64')}`;
    },
    close() {
      if (win && !win.isDestroyed()) win.destroy();
      win = null;
    }
  };
}

const desktopBrowser = (opts) => scriptedBrowser(desktopEngine(), opts);

module.exports = { desktopBrowser };
