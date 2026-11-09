// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// Najwa AI Plus is its own app on every platform: it must never take Najwa
// AI's app ID, or a build would install over Najwa AI (or reach its store
// listings).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const PLUS = 'com.bandaraltariqi.najwa.plus';

test('Plus has its own app ID and name everywhere', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.strictEqual(pkg.build.appId, PLUS);
  const cap = JSON.parse(read('capacitor.config.json'));
  assert.strictEqual(cap.appId, PLUS);
  assert.strictEqual(cap.appName, 'Najwa AI Plus');
  assert.match(read('android/app/build.gradle'), new RegExp(`applicationId "${PLUS.replace(/\./g, '\\.')}"`));
  const strings = read('android/app/src/main/res/values/strings.xml');
  assert.match(strings, /name="app_name">Najwa AI Plus</);
  assert.match(strings, new RegExp(`name="package_name">${PLUS}<`));
  const ids = [...read('ios/App/App.xcodeproj/project.pbxproj').matchAll(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g)].map((m) => m[1]);
  assert.ok(ids.length > 0);
  for (const id of ids) assert.strictEqual(id, PLUS);
  assert.match(read('ios/App/App/Info.plist'), /<key>CFBundleDisplayName<\/key>\s*<string>Najwa AI Plus<\/string>/);
});

test('no workflow uploads to an app store', () => {
  const dir = path.join(ROOT, '.github/workflows');
  for (const f of fs.readdirSync(dir)) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.doesNotMatch(text, /play-upload|androidpublisher|PLAY_SERVICE_ACCOUNT|altool|upload-app|testflight/i, `${f} must not upload to Google Play or the App Store`);
  }
});

test('the phone build finds what it changes in the page', () => {
  // scripts/build-web.mjs edits renderer/index.html by exact text; a renamed
  // title once broke the phone build.
  const page = read('renderer/index.html');
  for (const m of read('scripts/build-web.mjs').matchAll(/^replace\('([^']+)'/gm)) {
    assert.ok(page.includes(m[1].replace(/\\n/g, '\n')), `renderer/index.html has no ${m[1]}`);
  }
});
