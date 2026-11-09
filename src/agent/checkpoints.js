// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// Checkpoints: before the agent changes a file, the file as it was is kept,
// per chat, so "Undo" can put it back, one change at a time (newest first).
// Changes the agent applies from a dry run are kept the same way. Kept on this
// computer, in the app's data folder; the newest 40 changes per chat.
//
// Najwa AI Plus: the newest changes also travel with the chat (exportFor:
// compressed, a size cap), so the chat's sync (encrypted on the device)
// takes them to the user's other devices. A computer without its own copy
// (another one, or this one after a reinstall) can then undo in the chat's
// project folder there (importFrom).

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SYNC_BYTES = 256 * 1024;
const SYNC_ENTRIES = 10;
// A path from elsewhere must stay inside the project.
const inside = (root, rel) => {
  const abs = path.resolve(root, rel);
  const r = path.relative(path.resolve(root), abs);
  return r && !r.startsWith('..') && !path.isAbsolute(r) ? abs : null;
};

const KEEP = 40;
const MAX_FILE = 8 * 1024 * 1024;   // bigger files can't be undone (the card says so)

const safeName = (chatId) => String(chatId || 'no-chat').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);

function createCheckpoints(dir) {
  const fileOf = (chatId) => path.join(dir, `${safeName(chatId)}.json`);
  const load = (chatId) => {
    try {
      return JSON.parse(fs.readFileSync(fileOf(chatId), 'utf8'));
    } catch {
      return [];
    }
  };
  const save = (chatId, list) => {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${fileOf(chatId)}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(list.slice(-KEEP)));
    fs.renameSync(tmp, fileOf(chatId));
  };

  return {
    /**
     * Start a change. Call keep(abs, rel) for each file before changing it,
     * then done() once the change is made (or cancel() if it wasn't).
     */
    begin(chatId, root, label) {
      const files = [];
      const seen = new Set();
      return {
        keep(abs, rel) {
          if (seen.has(rel)) return true;
          seen.add(rel);
          let st = null;
          try {
            st = fs.statSync(abs);
          } catch {
            // doesn't exist yet: undo removes it
          }
          if (st && !st.isFile()) return false;
          if (st && st.size > MAX_FILE) {
            files.push({ rel, existed: true, tooBig: true });
            return false;
          }
          files.push(st ? { rel, existed: true, data: fs.readFileSync(abs).toString('base64'), mode: st.mode } : { rel, existed: false });
          return true;
        },
        done() {
          if (!files.length) return null;
          const list = load(chatId);
          const entry = { id: `${Date.now().toString(36)}-${list.length}`, at: Date.now(), label: String(label || 'Change').slice(0, 200), root, files };
          list.push(entry);
          save(chatId, list);
          return entry.id;
        },
        cancel() {
          files.length = 0;
        }
      };
    },

    // The changes that can be undone, newest first: [{ id, at, label, files: [rel] }].
    list(chatId) {
      return load(chatId).slice().reverse().map((e) => ({ id: e.id, at: e.at, label: e.label, root: e.root, files: e.files.map((f) => f.rel) }));
    },

    /**
     * Undo the newest change (or back to and including `id`).
     * @returns { undone: [labels], files: [rel], skipped: [rel] }
     */
    undo(chatId, id = null) {
      const list = load(chatId);
      if (!list.length) return { undone: [], files: [], skipped: [] };
      const at = id ? list.findIndex((e) => e.id === id) : list.length - 1;
      if (at < 0) throw new Error('That change is no longer kept.');
      const undone = [];
      const files = [];
      const skipped = [];
      for (const e of list.splice(at).reverse()) {
        for (const f of e.files.slice().reverse()) {
          const abs = inside(e.root, f.rel);
          if (f.tooBig || !abs) {
            skipped.push(f.rel);
            continue;
          }
          if (f.existed) {
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, Buffer.from(f.data, 'base64'));
            if (f.mode) fs.chmodSync(abs, f.mode & 0o7777);
          } else {
            fs.rmSync(abs, { force: true });
          }
          files.push(f.rel);
        }
        undone.push(e.label);
      }
      save(chatId, list);
      return { undone, files: [...new Set(files)], skipped };
    },

    /**
     * The newest changes, packed to travel with the chat: a string (gzip,
     * base64), or '' when there's nothing. Big ones are left out.
     */
    exportFor(chatId) {
      const list = load(chatId).filter((e) => !e.files.some((f) => f.tooBig));
      const out = [];
      let size = 0;
      for (const e of list.slice().reverse().slice(0, SYNC_ENTRIES)) {
        const one = JSON.stringify({ id: e.id, at: e.at, label: e.label, files: e.files });
        if (size + one.length > SYNC_BYTES * 4) break;
        size += one.length;
        out.unshift(JSON.parse(one));
      }
      if (!out.length) return '';
      let packed = zlib.gzipSync(JSON.stringify({ v: 1, entries: out })).toString('base64');
      while (packed.length > SYNC_BYTES && out.length > 1) {
        out.shift();
        packed = zlib.gzipSync(JSON.stringify({ v: 1, entries: out })).toString('base64');
      }
      return packed.length > SYNC_BYTES ? '' : packed;
    },

    /**
     * Changes that came with the chat, for this computer when it has none of
     * its own: kept with this computer's project folder. Returns how many.
     */
    importFrom(chatId, packed, root) {
      if (!packed || !root || load(chatId).length) return 0;
      let data;
      try {
        data = JSON.parse(zlib.gunzipSync(Buffer.from(String(packed), 'base64')).toString('utf8'));
      } catch {
        return 0;
      }
      const entries = (data && Array.isArray(data.entries) ? data.entries : [])
        .filter((e) => e && typeof e.id === 'string' && Array.isArray(e.files) && e.files.every((f) => f && typeof f.rel === 'string' && inside(root, f.rel)))
        .map((e) => ({ id: e.id, at: Number(e.at) || 0, label: String(e.label || 'Change').slice(0, 200), root, files: e.files.map((f) => ({ rel: f.rel, existed: !!f.existed, ...(f.existed ? { data: String(f.data || ''), ...(Number.isInteger(f.mode) ? { mode: f.mode } : {}) } : {}) })) }));
      if (!entries.length) return 0;
      save(chatId, entries);
      return entries.length;
    }
  };
}

module.exports = { createCheckpoints };
