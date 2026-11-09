// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// Checkpoints: before the agent changes a file, the file as it was is kept,
// per chat, so "Undo" can put it back, one change at a time (newest first).
// Changes the agent applies from a dry run are kept the same way. Kept on this
// computer, in the app's data folder; the newest 40 changes per chat.

'use strict';

const fs = require('fs');
const path = require('path');

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
          const abs = path.join(e.root, f.rel);
          if (f.tooBig) {
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
    }
  };
}

module.exports = { createCheckpoints };
