// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// Modern Web Guidance, offline (Najwa AI Plus).
//
// The modern-web-guidance skill (skills/modern-web-guidance, from the Chrome,
// Edge, Firefox and MDN teams: see its NOTICE.md) comes with ~200 guides to
// today's web platform. The original looks them up with `npx`, which needs
// Node.js and the internet; here the agent's web_guide tool searches and reads
// the bundled guides directly.

'use strict';

const fs = require('fs');
const path = require('path');

const MAX_READ = 60000;
const STOP = new Set(['a', 'an', 'and', 'the', 'to', 'of', 'in', 'on', 'for', 'with', 'by', 'or', 'how', 'use', 'using', 'my', 'is', 'it', 'its', 'that', 'this', 'from', 'into', 'at', 'be', 'make', 'add', 'create', 'build', 'implement']);
// A few words people use for the same thing.
const ALSO = {
  modal: ['dialog'], popup: ['popover', 'dialog'], dropdown: ['select', 'popover', 'menu'], tooltip: ['tooltips', 'popover'],
  sidebar: ['drawer'], menu: ['menus'], toast: ['notification'], tabs: ['tab'], slider: ['carousel', 'range'],
  darkmode: ['dark', 'scheme'], theme: ['scheme', 'color'], colour: ['color'], animate: ['animation', 'transition'],
  animation: ['animate', 'transition'], lazy: ['loading'], datepicker: ['date']
};

const stem = (w) => (w.length > 4 && w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
// "translate" finds "translator", "validation" finds "validate".
const near = (set, w) => set.has(w) || (w.length >= 6 && [...set].some((x) => x.length >= 6 && x.slice(0, Math.min(w.length, x.length) - 2) === w.slice(0, Math.min(w.length, x.length) - 2)));
const words = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean);

function walk(dir, out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.name.endsWith('.md')) out.push(full);
  }
  return out;
}

function summaryOf(lines) {
  for (const raw of lines) {
    const l = raw.trim();
    if (!l || l.startsWith('#') || l.startsWith('```') || l.startsWith('|') || l.startsWith('<')) continue;
    const plain = l.replace(/^[-*>\d.\s]+/, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`]/g, '');
    if (plain.length < 25) continue;
    return plain.length > 220 ? `${plain.slice(0, 219)}…` : plain;
  }
  return '';
}

function buildIndex(guidesDir) {
  return walk(guidesDir).sort().map((file) => {
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);
    const titleLine = lines.find((l) => /^#\s/.test(l)) || '';
    const id = path.basename(file, '.md');
    const area = path.relative(guidesDir, path.dirname(file)).split(path.sep).join('/');
    const title = titleLine.replace(/^#\s+/, '').trim() || id;
    const headings = lines.filter((l) => /^#{2,4}\s/.test(l)).map((l) => l.replace(/^#+\s+/, ''));
    const bodyWords = new Map();
    for (const w of words(text)) {
      const s = stem(w);
      bodyWords.set(s, (bodyWords.get(s) || 0) + 1);
    }
    return {
      id, area, title, file,
      summary: summaryOf(lines.slice(lines.indexOf(titleLine) + 1)),
      idWords: new Set(words(id).map(stem)),
      titleWords: new Set(words(title).map(stem)),
      headWords: new Set(words(headings.join(' ')).map(stem)),
      areaWords: new Set(words(area).map(stem)),
      lower: words(text).join(' '),
      bodyWords
    };
  });
}

const cache = new Map();

/** The guides in a modern-web-guidance skill folder: { count, search(query), read(id) }, or null. */
function webGuides(skillDir) {
  if (!skillDir) return null;
  const guidesDir = path.join(skillDir, 'guides');
  if (!cache.has(guidesDir)) {
    let index = [];
    try {
      if (fs.statSync(guidesDir).isDirectory()) index = buildIndex(guidesDir);
    } catch {
      index = [];
    }
    cache.set(guidesDir, index);
  }
  const index = cache.get(guidesDir);
  if (!index.length) return null;

  function search(query, limit = 8) {
    const terms = [...new Set(words(query).filter((w) => !STOP.has(w)).map(stem))];
    if (!terms.length) return [];
    const scored = index.map((g) => {
      let score = 0;
      let matched = 0;
      for (const t of terms) {
        const alts = [t, ...(ALSO[t] || []).map(stem)];
        let best = 0;
        for (const [i, a] of alts.entries()) {
          const weight = i === 0 ? 1 : 0.6;
          let s = 0;
          if (near(g.idWords, a)) s += 6;
          if (near(g.titleWords, a)) s += 5;
          if (g.headWords.has(a)) s += 2;
          if (g.areaWords.has(a)) s += 1.5;
          s += Math.min(g.bodyWords.get(a) || 0, 12) * 0.25;
          best = Math.max(best, s * weight);
        }
        if (best > 0) matched += 1;
        score += best;
      }
      // Words of the query that appear together in the guide ("container queries").
      for (let i = 0; i + 1 < terms.length; i += 1) {
        const pair = new RegExp(`\\b${terms[i]}[a-z]*\\s${terms[i + 1].slice(0, Math.max(3, terms[i + 1].length - 1))}`, 'g');
        score += Math.min((g.lower.match(pair) || []).length, 4) * 1.5;
      }
      // Guides that cover every word of the query come first.
      score *= 0.5 + (matched / terms.length) ** 2;
      return { g, score, share: matched / terms.length };
    }).filter((r) => r.score >= 1.5 && (r.share >= 0.5 || r.score >= 4)).sort((a, b) => b.score - a.score || a.g.id.localeCompare(b.g.id));
    return scored.slice(0, limit).map(({ g }) => ({ id: g.id, area: g.area, title: g.title, summary: g.summary }));
  }

  function read(id) {
    const want = String(id || '').trim().replace(/\.md$/i, '').toLowerCase();
    const g = index.find((x) => x.id.toLowerCase() === want || `${x.area}/${x.id}`.toLowerCase() === want);
    if (!g) return null;
    // The guides point to each other with the original's command; here that's web_guide.
    let text = fs.readFileSync(g.file, 'utf8').replace(/\(via `npx -y modern-web-guidance@latest retrieve "([^"]+)"`\)/g, '(web_guide read "$1")');
    if (text.length > MAX_READ) text = `${text.slice(0, MAX_READ)}\n\n[… the rest of this guide is left out]`;
    return { id: g.id, area: g.area, title: g.title, text };
  }

  return { count: index.length, search, read, list: () => index.map((g) => ({ id: g.id, area: g.area, title: g.title })) };
}

/** The web_guide tool's answer. */
function webGuideTool(guides, args) {
  const action = String((args && args.action) || (args && args.id ? 'read' : 'search')).toLowerCase();
  if (action === 'read') {
    const ids = String(args.id || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 4);
    if (!ids.length) return { text: 'Give the guide\'s id (from a search).', error: true };
    const found = [];
    const missing = [];
    for (const id of ids) {
      const g = guides.read(id);
      if (g) found.push(g);
      else missing.push(id);
    }
    if (!found.length) return { text: `There's no guide called ${missing.join(', ')}. Search first to find the right id.`, error: true };
    let text = found.map((g) => `--- Guide: ${g.id} (${g.area}) ---\n${g.text}`).join('\n\n');
    if (missing.length) text += `\n\n(No guide called ${missing.join(', ')}.)`;
    return { text, label: `📐 Read the guide${found.length > 1 ? 's' : ''} ${found.map((g) => g.id).join(', ')}` };
  }
  if (action === 'list') {
    const byArea = {};
    for (const g of guides.list()) (byArea[g.area] = byArea[g.area] || []).push(g.id);
    return { text: Object.entries(byArea).map(([a, ids]) => `${a}: ${ids.join(', ')}`).join('\n'), label: `📐 Listed ${guides.count} guides` };
  }
  const query = String((args && args.query) || '').trim();
  if (!query) return { text: 'Give a short search, like "light dismiss dialog".', error: true };
  const results = guides.search(query);
  if (!results.length) return { text: `No guide matches "${query}". Try the plain name of the UI piece or feature (dialog, popover, table, form), or go on without a guide.`, label: `📐 No guide for "${query}"` };
  return {
    text: results.map((r) => `- ${r.id} (${r.area}): ${r.title}${r.summary ? `. ${r.summary}` : ''}`).join('\n') + '\n\nRead the ones that match with action "read".',
    label: `📐 Searched the web guides for "${query}"`
  };
}

module.exports = { webGuides, webGuideTool };
