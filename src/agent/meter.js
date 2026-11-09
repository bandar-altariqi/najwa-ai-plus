// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// Privacy meter (Najwa AI Plus): what one agent task sent where. For each
// model it went to (the agent's, its helpers', the second opinion's): cloud or
// local, and how much project text; how many different secrets the firewall
// hid; and which private files were kept on this computer. The chat shows it
// under the agent's steps.

'use strict';

/**
 * @param onInfo  gets { kind: 'privacy', to: [{ label, cloud, bytes, items }], secrets, kept: [rel] }
 * @param secrets () -> how many different secrets have been hidden so far
 */
function createMeter({ onInfo = () => {}, secrets = () => 0 } = {}) {
  const to = new Map();   // label -> { label, cloud, bytes, items }
  const kept = new Set();
  const emit = () => onInfo({ kind: 'privacy', to: [...to.values()].map((d) => ({ ...d })), secrets: secrets(), kept: [...kept].slice(0, 50) });
  return {
    /** Text that went to a model. */
    sent(dest, text) {
      if (!dest || !dest.label) return;
      const d = to.get(dest.label) || { label: dest.label, cloud: !!dest.cloud, bytes: 0, items: 0 };
      d.bytes += Buffer.byteLength(String(text || ''), 'utf8');
      d.items++;
      to.set(dest.label, d);
      emit();
    },
    /** A private file a cloud model asked for, kept back. */
    keptBack(rel) {
      if (kept.has(rel)) return;
      kept.add(rel);
      emit();
    },
    snapshot: () => ({ to: [...to.values()], secrets: secrets(), kept: [...kept] })
  };
}

module.exports = { createMeter };
