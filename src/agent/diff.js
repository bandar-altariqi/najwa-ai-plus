// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// Line diffs for the agent's changes: what the approval card shows ("+ added",
// "- removed"), and the counts in a step's label. Myers' algorithm, so big
// files with small changes stay fast.

'use strict';

const splitLines = (text) => {
  if (text == null || text === '') return [];
  const lines = String(text).split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
};

// The edit script from a to b: [{ op: ' ' | '-' | '+', line }].
function diffLines(a, b) {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  if (!max) return [];
  const v = new Map([[1, 0]]);
  const trace = [];
  outer:
  for (let d = 0; d <= max; d++) {
    trace.push(new Map(v));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v.get(k - 1) < v.get(k + 1)) ? v.get(k + 1) : v.get(k - 1) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v.set(k, x);
      if (x >= n && y >= m) break outer;
    }
  }
  // Walk back through the trace to build the script.
  const out = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const vd = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && vd.get(k - 1) < vd.get(k + 1)) ? k + 1 : k - 1;
    const prevX = vd.get(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      out.push({ op: ' ', line: a[--x] });
      y--;
    }
    if (d > 0) {
      if (x === prevX) out.push({ op: '+', line: b[--y] });
      else out.push({ op: '-', line: a[--x] });
    }
  }
  return out.reverse();
}

/**
 * A unified diff of two texts (null = the file doesn't exist).
 * @returns { text, added, removed }  text is '' when nothing changed
 */
function unifiedDiff(before, after, name = 'file', { context = 3, maxLines = 400 } = {}) {
  const a = splitLines(before);
  const b = splitLines(after);
  // Very large files: diff only the changed middle.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const pre = Math.max(0, start - context);
  const ops = [
    ...a.slice(pre, start).map((line) => ({ op: ' ', line })),
    ...diffLines(a.slice(start, endA), b.slice(start, endB)),
    ...a.slice(endA, Math.min(a.length, endA + context)).map((line) => ({ op: ' ', line }))
  ];
  const added = ops.filter((o) => o.op === '+').length;
  const removed = ops.filter((o) => o.op === '-').length;
  if (!added && !removed) return { text: '', added: 0, removed: 0 };

  // Group into hunks with `context` unchanged lines around each change.
  const hunks = [];
  let lineA = pre;
  let lineB = pre;
  let cur = null;
  let quiet = 0;
  for (const o of ops) {
    if (o.op === ' ') {
      if (cur) {
        cur.lines.push(o);
        quiet++;
        if (quiet > context * 2) {
          cur.lines.splice(cur.lines.length - (quiet - context));
          hunks.push(cur);
          cur = null;
        }
      }
    } else {
      if (!cur) {
        const lead = [];
        for (let i = ops.indexOf(o) - 1, c = 0; i >= 0 && c < context && ops[i].op === ' '; i--, c++) lead.unshift(ops[i]);
        cur = { a: lineA - lead.length, b: lineB - lead.length, lines: lead };
      }
      cur.lines.push(o);
      quiet = 0;
    }
    if (o.op !== '+') lineA++;
    if (o.op !== '-') lineB++;
  }
  if (cur) {
    if (quiet > context) cur.lines.splice(cur.lines.length - (quiet - context));
    hunks.push(cur);
  }
  const out = [`--- ${before == null ? '/dev/null' : `a/${name}`}`, `+++ ${after == null ? '/dev/null' : `b/${name}`}`];
  let shown = 0;
  for (const h of hunks) {
    const lenA = h.lines.filter((l) => l.op !== '+').length;
    const lenB = h.lines.filter((l) => l.op !== '-').length;
    out.push(`@@ -${lenA ? h.a + 1 : h.a},${lenA} +${lenB ? h.b + 1 : h.b},${lenB} @@`);
    for (const l of h.lines) {
      if (shown++ >= maxLines) {
        out.push(`… (${added + removed} changed lines in all, the rest not shown)`);
        return { text: out.join('\n'), added, removed };
      }
      out.push(`${l.op}${l.line}`);
    }
  }
  return { text: out.join('\n'), added, removed };
}

module.exports = { diffLines, unifiedDiff, splitLines };
