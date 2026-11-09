// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// Budget guard (Najwa AI Plus): the tokens and cost of one agent task, shown
// live, and a cap. When the task reaches the cap the user is asked before it
// spends more ("Keep going" allows as much again, "Stop" ends the task).
//
// Prices are the user's own, never fetched or guessed: each provider's price
// fields (Settings → Models & providers), or for one model a line in Settings →
// Agent → Prices for specific models, per million tokens, one model
// per line:   deepseek-flash = 0.1 / 0.4      (input / output, in dollars)
// or with a third price for input the provider had cached (prompt caching,
// usually much cheaper):   deepseek-flash = 0.1 / 0.4 / 0.01
// Without it, cached input is counted at the input price (never less than the bill).
// A trailing * matches the start of a name (claude-* = 3 / 15). A model with
// no price counts tokens only; local models cost nothing.

'use strict';

/** "model = in / out [/ cached]" lines -> [{ pattern, input, output, cached }] */
function parsePrices(text) {
  const out = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.replace(/#.*/, '').trim();
    const m = /^(.+?)\s*[=:]\s*\$?([\d.]+)\s*\/\s*\$?([\d.]+)\s*(?:\/\s*\$?([\d.]+)\s*)?$/.exec(line);
    if (!m) continue;
    const input = Number(m[2]);
    const output = Number(m[3]);
    const cached = m[4] != null ? Number(m[4]) : input;
    if (Number.isFinite(input) && Number.isFinite(output) && Number.isFinite(cached)) out.push({ pattern: m[1].trim(), input, output, cached });
  }
  return out;
}

function priceFor(prices, model) {
  const name = String(model || '');
  const exact = prices.find((p) => p.pattern === name);
  if (exact) return exact;
  // The longest matching prefix wins (claude-opus-* before claude-*).
  return prices
    .filter((p) => p.pattern.endsWith('*') && name.startsWith(p.pattern.slice(0, -1)))
    .sort((a, b) => b.pattern.length - a.pattern.length)[0] || null;
}

const fmtTokens = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const fmtUsd = (n) => `$${n < 0.01 && n > 0 ? n.toFixed(4) : n.toFixed(2)}`;

/**
 * @param model     the model's name, to find its price
 * @param local     a model on this computer (costs nothing)
 * @param prices    text, see above
 * @param capUsd    stop and ask at this cost (0: no cap)
 * @param capTokens stop and ask at this many tokens (0: no cap)
 * @param approve   asks the user ({ title, command, description, choices, kind }) -> 'once' | 'deny'
 * @param onInfo    gets { kind: 'usage', ... } after each step
 */
/** A provider's price fields ({ input, output, cached }, dollars per million) -> a price, or null. */
function providerPrice(p) {
  if (!p) return null;
  const num = (v) => (v === '' || v == null ? NaN : Number(v));
  const input = num(p.input);
  const output = num(p.output);
  if (!Number.isFinite(input) || !Number.isFinite(output) || input < 0 || output < 0) return null;
  const cached = num(p.cached);
  return { input, output, cached: Number.isFinite(cached) && cached >= 0 ? cached : input };
}

/**
 * Prices: a line in `prices` for the model wins; else the provider's price
 * fields (Settings → Models & providers); else tokens only.
 */
function createBudget({ model, local = false, prices = '', provider = null, capUsd = 0, capTokens = 0, approve, onInfo = () => {} }) {
  const price = local ? { input: 0, output: 0, cached: 0 } : (priceFor(parsePrices(prices), model) || providerPrice(provider));
  const total = { input: 0, output: 0, cached: 0, steps: 0 };
  let usd = 0;
  let allowUsd = capUsd > 0 ? capUsd : 0;
  let allowTokens = capTokens > 0 ? capTokens : 0;

  const summary = () => `${fmtTokens(total.input + total.output)} tokens (${fmtTokens(total.input)} in${total.cached ? `, ${fmtTokens(total.cached)} of them cached` : ''}, ${fmtTokens(total.output)} out)${price ? `, about ${fmtUsd(usd)}` : ''}`;

  return {
    get usd() {
      return usd;
    },
    get tokens() {
      return total.input + total.output;
    },
    get totals() {
      return { ...total };
    },
    summary,
    /** One step's usage: { input, output, cached } (any may be missing). */
    add(usage) {
      if (!usage) return;
      const input = Math.max(0, Number(usage.input) || 0);
      const output = Math.max(0, Number(usage.output) || 0);
      // Input the provider had cached (prompt caching): its own, cheaper price.
      const cached = Math.min(input, Math.max(0, Number(usage.cached) || 0));
      total.input += input;
      total.output += output;
      total.cached += cached;
      total.steps++;
      if (price) usd += ((input - cached) * price.input + cached * (price.cached != null ? price.cached : price.input) + output * price.output) / 1e6;
      onInfo({ kind: 'usage', input: total.input, output: total.output, cached: total.cached, usd: price ? usd : null, capUsd: allowUsd || null, capTokens: allowTokens || null });
    },
    /** Over the cap? Ask; resolves true to go on, false to stop. */
    async check() {
      const overUsd = allowUsd > 0 && price && usd >= allowUsd;
      const overTokens = allowTokens > 0 && total.input + total.output >= allowTokens;
      if (!overUsd && !overTokens) return true;
      const more = overUsd ? fmtUsd(capUsd) : `${fmtTokens(capTokens)} tokens`;
      const choice = await approve({
        title: 'Budget reached',
        command: `This task has used ${summary()}.`,
        description: `It reached its budget of ${overUsd ? fmtUsd(allowUsd) : `${fmtTokens(allowTokens)} tokens`} (Settings → Agent). Keep going allows ${more} more.`,
        choices: ['once', 'deny'],
        kind: 'budget'
      });
      if (choice === 'deny') return false;
      if (overUsd) allowUsd += capUsd;
      if (overTokens) allowTokens += capTokens;
      return true;
    }
  };
}

module.exports = { createBudget, parsePrices, priceFor, providerPrice, fmtTokens, fmtUsd };
