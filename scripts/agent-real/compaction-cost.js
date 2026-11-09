// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// What compaction saves, measured: a long agent chat (about 160,000
// characters of history) gets the same three follow-up tasks twice, with and
// without compaction, on a real model. Each run counts the tokens the
// provider reports (cached input separately) and prices them with PRICES.
//
//   MODEL_URL=https://api.deepseek.com MODEL=deepseek-flash MODEL_KEY=… \
//   PRICES="deepseek-* = 0.15 / 0.60 / 0.003" node scripts/agent-real/compaction-cost.js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { chatWithTools, TOOL_KINDS } = require('../../src/tool-chat');
const { PROVIDERS } = require('../../src/providers');
const { agentTools } = require('../../src/agent/tools');
const { createFirewall } = require('../../src/agent/firewall');
const { createCheckpoints } = require('../../src/agent/checkpoints');
const { backgroundJobs } = require('../../src/agent/shell');
const { createBudget } = require('../../src/agent/budget');
const { compactMessages, summaryStore, SUMMARY_SYSTEM } = require('../../src/agent/compact');

const KIND = process.env.KIND || 'openaiCompatible';
const MODEL = process.env.MODEL;
const PRICES = process.env.PRICES || '';
const cfg = { baseUrl: process.env.MODEL_URL || '', apiKey: process.env.MODEL_KEY || '' };
const DIR = process.env.AGENT_REAL_DIR || path.join(os.tmpdir(), 'najwa-compaction-cost');
if (!MODEL) {
  console.error('Set MODEL (and MODEL_URL, MODEL_KEY, PRICES).');
  process.exit(2);
}

const FILES = {
  'package.json': '{ "name": "invoice", "scripts": { "test": "node test.js" } }\n',
  'config/rates.js': "exports.VAT_RATE = 0.15;\nexports.FREE_SHIPPING_MIN = 500;\nexports.FREE_SHIPPING_CITIES = ['Riyadh', 'Jeddah'];\nexports.FLAT_FEE = { Dammam: 25, default: 20 };\n",
  'lib/shipping.js': "const r = require('../config/rates');\nexports.shippingFor = (order) => {\n  if (order.total >= r.FREE_SHIPPING_MIN && r.FREE_SHIPPING_CITIES.includes(order.city)) return 0;\n  return r.FLAT_FEE[order.city] ?? r.FLAT_FEE.default;\n};\n",
  'test.js': "const assert = require('assert');\nconst { shippingFor } = require('./lib/shipping');\nassert.strictEqual(shippingFor({ total: 600, city: 'Riyadh' }), 0);\nassert.strictEqual(shippingFor({ total: 100, city: 'Dammam' }), 25);\nassert.strictEqual(shippingFor({ total: 100, city: 'Abha' }), 20);\nconsole.log('ok');\n"
};

// A long history: an invoice app's agent chat, its replies full of detail.
function history() {
  const topics = ['VAT rounding', 'the discount order', 'free shipping', 'the Dammam fee', 'CSV export', 'Arabic invoice PDFs', 'the payment webhook', 'refunds', 'the admin report', 'rate limits'];
  const detail = (t, i) => `Work on ${t} (step ${i}): I read config/rates.js and lib/shipping.js, checked how ${t} interacts with VAT_RATE = 0.15 and FREE_SHIPPING_MIN = 500, and ran npm test (all passing). `
    + Array.from({ length: 30 }, (_, j) => `Line ${j}: in lib/module${i}.js, function handle${j}() validates the order total, applies ${t}, logs the result and returns it; edge case ${j} covered by test ${i}.${j}.`).join(' ');
  const out = [];
  for (let i = 0; i < 30; i++) {
    out.push({ role: 'user', content: `Next, look at ${topics[i % topics.length]} (part ${i}).` });
    out.push({ role: 'assistant', content: detail(topics[i % topics.length], i) });
  }
  return out;
}

const TURNS = [
  'Change the Dammam shipping fee to 30 and update its test.',
  'Add a comment above shippingFor in lib/shipping.js explaining the free-shipping rule, in one line.',
  'Run the tests and tell me the result in one sentence.',
  'Add Abha to the flat fees at 22 SAR, with a test.',
  'What is the free-shipping minimum now? One line.',
  'Rename FLAT_FEE to SHIPPING_FEES everywhere and run the tests.',
  'Add a test that an order of exactly 500 SAR in Jeddah ships free.',
  'Run the tests and tell me the result in one sentence.'
].slice(0, Number(process.env.TURNS) || 3);

async function session(withCompaction) {
  const root = path.join(DIR, withCompaction ? 'with' : 'without');
  fs.rmSync(root, { recursive: true, force: true });
  for (const [rel, text] of Object.entries(FILES)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  const store = summaryStore(path.join(root, '..', `${path.basename(root)}-summaries`));
  fs.rmSync(path.join(root, '..', `${path.basename(root)}-summaries`), { recursive: true, force: true });
  const all = createBudget({ model: MODEL, prices: PRICES, approve: async () => 'once' });
  let messages = history();
  const sent = [];
  for (const turn of TURNS) {
    messages = [...messages, { role: 'user', content: turn }];
    let forModel = messages;
    if (withCompaction) {
      const c = await compactMessages({
        chatId: 'cost', messages, store,
        summarize: async (text) => {
          let out = '';
          await PROVIDERS[KIND].impl.streamChat(cfg, { model: MODEL, system: SUMMARY_SYSTEM, messages: [{ role: 'user', content: text }], maxTokens: 2000, temperature: 0 }, (p) => { out += p; });
          return out;
        }
      });
      forModel = c.messages;
      if (c.usage) all.add(c.usage);
    }
    sent.push(JSON.stringify(forModel).length);
    const tools = agentTools({
      root, chatId: 'cost', mode: 'auto', model: MODEL, options: { dryRun: 'off', prices: PRICES },
      firewall: createFirewall({ cloud: true }), approve: async () => 'once', chatAllowed: new Set(),
      checkpoints: createCheckpoints(path.join(root, '..', 'cps')), jobs: backgroundJobs()
    });
    const res = await chatWithTools({ kind: TOOL_KINDS[KIND] || KIND, cfg, tools, onDelta: () => {}, req: { model: MODEL, system: tools.system, messages: forModel, maxTokens: 4000 } });
    const t = tools.budget.totals;
    all.add({ input: t.input, output: t.output, cached: t.cached });
    messages = [...messages, { role: 'assistant', content: String(res.text || '').replace(/<think>[\s\S]*?<\/think>\s*/g, '') }];
  }
  const ok = fs.readFileSync(path.join(root, 'config/rates.js'), 'utf8').includes('Dammam: 30');
  return { totals: all.totals, usd: all.usd, sent, ok };
}

(async () => {
  const k = (n) => `${(n / 1000).toFixed(1)}k`;
  console.log(`History: ${JSON.stringify(history()).length} characters. Model ${MODEL}, prices "${PRICES || 'none'}".\n`);
  const rows = [];
  for (const withCompaction of [false, true]) {
    const r = await session(withCompaction);
    rows.push(r);
    console.log(`${withCompaction ? 'With compaction   ' : 'Without compaction'}: ${k(r.totals.input)} input (${k(r.totals.cached)} cached, ${k(r.totals.input - r.totals.cached)} not), ${k(r.totals.output)} output, ${r.totals.steps} model calls · $${r.usd.toFixed(4)} · history sent per turn ${r.sent.map((n) => k(n)).join(', ')} chars · task done: ${r.ok}`);
  }
  const [a, b] = rows;
  console.log(`\nSaved: ${k(a.totals.input - b.totals.input)} input tokens (${Math.round((1 - b.totals.input / a.totals.input) * 100)}%), $${(a.usd - b.usd).toFixed(4)} (${Math.round((1 - b.usd / Math.max(1e-12, a.usd)) * 100)}% of the cost).`);
})().catch((e) => { console.error(e); process.exit(1); });
