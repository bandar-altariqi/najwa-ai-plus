// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createBudget, parsePrices, priceFor } = require('../src/agent/budget');

test('budget: prices from the settings text', () => {
  const prices = parsePrices('deepseek-flash = 0.1 / 0.4\n# a note\nclaude-* : $3 / $15\nclaude-opus-* = 15/75\nnonsense\n');
  assert.strictEqual(prices.length, 3);
  assert.deepStrictEqual(priceFor(prices, 'deepseek-flash'), { pattern: 'deepseek-flash', input: 0.1, output: 0.4, cached: 0.1 });   // no cached price: the input price
  assert.strictEqual(priceFor(prices, 'claude-opus-5').input, 15);   // the longest prefix wins
  assert.strictEqual(priceFor(prices, 'claude-sonnet-5').input, 3);
  assert.strictEqual(priceFor(prices, 'gpt-x'), null);
});

test('budget: counts, shows, and asks at the cap', async () => {
  const infos = [];
  const asked = [];
  let answer = 'once';
  const b = createBudget({ model: 'm', prices: 'm = 1 / 2', capUsd: 0.01, approve: async (card) => { asked.push(card); return answer; }, onInfo: (i) => infos.push(i) });
  b.add({ input: 2000, output: 1000 });   // 0.002 + 0.002
  assert.ok(Math.abs(b.usd - 0.004) < 1e-9);
  assert.deepStrictEqual(infos[0], { kind: 'usage', input: 2000, output: 1000, cached: 0, usd: b.usd, capUsd: 0.01, capTokens: null });
  assert.strictEqual(await b.check(), true);
  assert.strictEqual(asked.length, 0);
  b.add({ input: 6000, output: 1000 });   // 0.012 in all
  assert.strictEqual(await b.check(), true);   // "Keep going": as much again
  assert.strictEqual(asked.length, 1);
  assert.strictEqual(asked[0].kind, 'budget');
  assert.match(asked[0].command, /10\.0k tokens .* about \$0\.01/);
  assert.strictEqual(await b.check(), true);   // under the new cap (0.02): not asked again
  assert.strictEqual(asked.length, 1);
  b.add({ input: 10000, output: 0 });
  answer = 'deny';
  assert.strictEqual(await b.check(), false);
});

test('budget: tokens without a price, and local models are free', async () => {
  const b = createBudget({ model: 'unknown', capTokens: 100, approve: async () => 'deny' });
  b.add({ input: 50, output: 10 });
  assert.strictEqual(await b.check(), true);
  b.add({ input: 50, output: 0 });
  assert.strictEqual(await b.check(), false);
  assert.match(b.summary(), /^110 tokens/);
  const local = createBudget({ model: 'qwen3:4b', local: true, prices: '', capUsd: 1, approve: async () => 'deny' });
  local.add({ input: 1e7, output: 1e7 });
  assert.strictEqual(local.usd, 0);
  assert.strictEqual(await local.check(), true);
  createBudget({ model: 'x', approve: async () => 'once' }).add(null);   // a step without usage
});

test('budget: cached input at its own price', () => {
  assert.deepStrictEqual(parsePrices('deepseek-* = 0.28 / 0.42 / 0.028')[0], { pattern: 'deepseek-*', input: 0.28, output: 0.42, cached: 0.028 });
  const b = createBudget({ model: 'deepseek-flash', prices: 'deepseek-* = 1 / 2 / 0.1', approve: async () => 'once' });
  b.add({ input: 10000, output: 1000, cached: 8000 });   // 2000 × 1 + 8000 × 0.1 + 1000 × 2
  assert.ok(Math.abs(b.usd - 0.0048) < 1e-12);
  b.add({ input: 100, cached: 500 });   // never more cached than input
  assert.strictEqual(b.totals.cached, 8100);
  assert.match(b.summary(), /10\.1k in, 8\.1k of them cached/);
});

test('budget: the provider\'s prices, and a line for one model wins', () => {
  const { providerPrice } = require('../src/agent/budget');
  assert.deepStrictEqual(providerPrice({ input: 0.15, output: 0.6, cached: 0.003 }), { input: 0.15, output: 0.6, cached: 0.003 });
  assert.deepStrictEqual(providerPrice({ input: '0.15', output: '0.6' }), { input: 0.15, output: 0.6, cached: 0.15 });   // no cached price: the input price
  assert.strictEqual(providerPrice({ input: 0.15 }), null);   // both input and output, or none
  assert.strictEqual(providerPrice({ input: -1, output: 1 }), null);
  assert.strictEqual(providerPrice(null), null);
  const provider = { input: 1, output: 2, cached: 0.1 };
  const byProvider = createBudget({ model: 'deepseek-flash', provider, approve: async () => 'once' });
  byProvider.add({ input: 1000000, output: 0, cached: 0 });
  assert.strictEqual(byProvider.usd, 1);
  const byLine = createBudget({ model: 'deepseek-v4-pro', prices: 'deepseek-v4-pro = 3 / 6', provider, approve: async () => 'once' });
  byLine.add({ input: 1000000, output: 0 });
  assert.strictEqual(byLine.usd, 3);
  const none = createBudget({ model: 'x', approve: async () => 'once' });
  none.add({ input: 1000, output: 10 });
  assert.match(none.summary(), /^1\.0k tokens/);
  assert.doesNotMatch(none.summary(), /\$/);
});
