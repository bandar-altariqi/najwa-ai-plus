// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// The iPhone app talks to the user's own servers over plain http (Ollama,
// LM Studio, Hermes, the computer), on the home Wi-Fi or over Tailscale
// (100.x.y.z addresses). App Transport Security allows that only with
// NSAllowsArbitraryLoads, and iOS ignores that key as soon as any of the
// narrower ones is there too: with NSAllowsLocalNetworking alone, Tailscale
// was refused ("…requires the use of a secure connection").

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

test('iPhone: plain http to the user\'s own servers is allowed, Tailscale included', () => {
  const plist = fs.readFileSync(path.join(__dirname, '..', 'ios', 'App', 'App', 'Info.plist'), 'utf8');
  const ats = /<key>NSAppTransportSecurity<\/key>\s*<dict>([\s\S]*?)<\/dict>/.exec(plist);
  assert.ok(ats, 'Info.plist has NSAppTransportSecurity');
  assert.match(ats[1], /<key>NSAllowsArbitraryLoads<\/key>\s*<true\/>/);
  for (const key of ['NSAllowsLocalNetworking', 'NSAllowsArbitraryLoadsInWebContent', 'NSAllowsArbitraryLoadsForMedia']) {
    assert.ok(!ats[1].includes(key), `${key} would make iOS ignore NSAllowsArbitraryLoads`);
  }
});
