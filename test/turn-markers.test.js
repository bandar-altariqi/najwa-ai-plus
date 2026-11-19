// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// A phone model must never write both sides of a chat. Gemma from a GGUF file
// without a chat template was given ChatML, read "<|im_start|>" as plain text,
// never ended its turn, and wrote the user's next questions and its answers.
// The engine now picks the format from the model's own turn tokens, and both
// engines stop a reply at a chat marker written as text. (Checked with the
// real engine and Gemma 3 1B: see the commit that added this test.)

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const engine = read('native/llama/engine/balimda_engine.cpp');
const wasm = read('mobile/src/on-device.js');

test('no chat template: the format comes from the model\'s own turn tokens, not ChatML for everyone', () => {
  assert.match(engine, /if \(has_special_token\(vocab, "<start_of_turn>"\)\) return "gemma";/);
  assert.match(engine, /if \(has_special_token\(vocab, "<\|start_header_id\|>"\)\) return "llama3";/);
  assert.match(engine, /e->fallback = fallback_template\(e->vocab\);/);
  // The model's template first, then its fallback; never a bare llama_chat_apply_template(nullptr) (that's ChatML).
  assert.match(engine, /int32_t n = e\.tmpl\.empty\(\) \? -1 : run\(e\.tmpl\.c_str\(\)\);\s*if \(n < 0\) n = run\(e\.fallback\.c_str\(\)\);/);
  assert.doesNotMatch(engine, /run\(e\.tmpl\.empty\(\) \? nullptr/);
});

test('both engines stop a reply at a chat marker written as text, with the same markers', () => {
  const list = (src) => [...src.matchAll(/"(<[^"]+)"|'(<[^']+)'/g)].map((m) => m[1] || m[2]);
  const native = list(engine.slice(engine.indexOf('const char * const TURN_MARKERS[]'), engine.indexOf('};', engine.indexOf('const char * const TURN_MARKERS[]'))));
  const web = list(wasm.slice(wasm.indexOf('export const TURN_MARKERS'), wasm.indexOf('];', wasm.indexOf('export const TURN_MARKERS'))));
  assert.deepStrictEqual(web, native);
  for (const m of ['<|im_start|>', '<|im_end|>', '<end_of_turn>', '<start_of_turn>', '<|eot_id|>', '<end_of_']) assert.ok(native.includes(m), m);
  // Native: the reply ends before the marker; a possible marker's start waits for the next piece.
  assert.match(engine, /const size_t marker = find_turn_marker\(pending\);/);
  assert.match(engine, /pending\.erase\(marker\);/);
  assert.match(engine, /marker_prefix_at_end\(pending\)/);
  // WebAssembly (llama-server's own stop handling holds partial matches back).
  assert.match(wasm, /stop: TURN_MARKERS/);
});
