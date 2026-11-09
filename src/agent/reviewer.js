// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// Second opinion: before you're asked about a change or a command, a second
// model (Settings → Agent, often a small local one) looks at it next to what
// you asked for, and the approval card shows its verdict: looks fine, a
// concern, or stop. In modes that don't ask, a concern or a stop makes the
// agent ask you after all.

'use strict';

const VERDICTS = { ok: 'Looks fine', concern: 'Has a concern', block: 'Says stop' };
const ICON = { ok: '✅', concern: '⚠️', block: '⛔' };

const SYSTEM = `You review actions an AI coding agent wants to take on the user's computer, before the user approves them. You are a careful senior engineer.
Judge only this one action against the user's request: is it what they asked for, is it correct, could it lose data, leak secrets, break the project, or reach outside it?
Answer with JSON only, no other text: {"verdict": "ok" | "concern" | "block", "summary": "one short sentence for the user", "risks": ["short risk", ...]}
Use "block" only for actions that are clearly harmful or clearly not what the user wanted. Use "concern" when the user should look closely. Keep the summary under 25 words.`;

function parseVerdict(text) {
  // Thinking models write their reasoning first (in <think>, which can hold
  // braces of its own): the verdict is the JSON after it.
  const said = String(text || '').replace(/<think>[\s\S]*?(<\/think>|$)/g, '');
  const m = said.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const v = JSON.parse(m[0]);
    const verdict = ['ok', 'concern', 'block'].includes(v.verdict) ? v.verdict : null;
    if (!verdict) return null;
    return {
      verdict,
      summary: String(v.summary || '').slice(0, 300),
      risks: Array.isArray(v.risks) ? v.risks.map((r) => String(r).slice(0, 160)).slice(0, 4) : []
    };
  } catch {
    return null;
  }
}

/**
 * @param chat  (req, signal) -> text   one plain reply from the reviewing model
 * @param label the reviewing model's name, shown on the card
 * @param scrub text -> text            the privacy firewall for that model
 */
function createReviewer({ chat, label, scrub = (t) => t, timeoutMs = 45000 }) {
  return {
    label,
    async review({ task, action, detail }, signal) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeoutMs);
      const stop = () => ctl.abort();
      if (signal) signal.addEventListener('abort', stop, { once: true });
      try {
        const prompt = `What the user asked for:\n${scrub(String(task || '(not given)')).slice(0, 4000)}\n\nThe action the agent wants to take: ${action}\n\n${scrub(String(detail || '')).slice(0, 12000)}`;
        const text = await chat({ system: SYSTEM, messages: [{ role: 'user', content: prompt }], maxTokens: 400, temperature: 0 }, ctl.signal);
        return parseVerdict(text);
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', stop);
      }
    }
  };
}

// What the card says about a review.
function reviewNote(review, label) {
  if (!review) return `🧑‍⚖️ Second opinion (${label}): couldn't get one this time.`;
  const risks = review.risks.length ? ` Risks: ${review.risks.join('; ')}.` : '';
  return `${ICON[review.verdict]} Second opinion (${label}): ${VERDICTS[review.verdict]}. ${review.summary}${risks}`.trim();
}

module.exports = { createReviewer, parseVerdict, reviewNote, VERDICTS };
