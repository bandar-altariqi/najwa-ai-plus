// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// Run replay (Najwa AI Plus): every agent run is kept as a timeline (its
// steps, questions and answers, to-do list, cost and the reply as it was
// written), to play back in the app or save as one web page to share. A
// saved page has secrets hidden (the same firewall as for cloud models).

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_EVENTS = 3000;
const MAX_TEXT = 200000;
const KEEP_RUNS = 300;
const safeId = (id) => String(id || '').replace(/[^\w-]/g, '').slice(0, 64);

/**
 * @param dir      where runs are kept
 * @param chatId   the chat
 * @param task     what the user asked
 * @param model    the model
 * @param project  the project folder's name
 */
function createRecorder({ dir, chatId, task, model, project }) {
  const id = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  const start = Date.now();
  const run = { id, chatId: String(chatId || ''), task: String(task || '').slice(0, 4000), model: String(model || ''), project: String(project || ''), startedAt: new Date(start).toISOString(), events: [], seconds: 0, error: null };
  let text = 0;
  let pending = '';
  let pendingAt = 0;
  const t = () => Date.now() - start;
  const push = (evt) => {
    if (run.events.length < MAX_EVENTS) run.events.push(evt);
  };
  // Pieces of the reply are joined until the next step (a timeline needs
  // paragraphs, not tokens).
  const flush = () => {
    if (!pending) return;
    push({ t: pendingAt, kind: 'text', text: pending });
    pending = '';
  };
  return {
    id,
    info(evt) {
      if (!evt || !evt.kind || evt.kind === 'shot') return;
      flush();
      const keep = { t: t(), kind: evt.kind };
      for (const k of ['id', 'label', 'status', 'emoji', 'title', 'command', 'description', 'askKind', 'choice', 'text', 'input', 'output', 'usd']) {
        if (evt[k] != null) keep[k] = typeof evt[k] === 'string' ? evt[k].slice(0, 12000) : evt[k];
      }
      if (evt.kind === 'todo' && Array.isArray(evt.items)) keep.items = evt.items.slice(0, 30);
      push(keep);
    },
    delta(piece) {
      if (!piece || text > MAX_TEXT) return;
      text += piece.length;
      if (!pending) pendingAt = t();
      pending += piece;
      if (pending.length > 4000) flush();
    },
    finish(error) {
      flush();
      run.seconds = Math.round(t() / 100) / 10;
      run.error = error ? String(error.message || error).slice(0, 500) : null;
      try {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(run));
        prune(dir);
      } catch {
        // a replay isn't worth failing the reply for
      }
      return run;
    }
  };
}

function prune(dir) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  for (const f of files.slice(0, Math.max(0, files.length - KEEP_RUNS))) fs.rmSync(path.join(dir, f), { force: true });
}

/** A chat's runs, newest first: [{ id, task, model, startedAt, seconds, steps }] */
function listRuns(dir, chatId) {
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().reverse();
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    try {
      const run = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (run.chatId !== String(chatId)) continue;
      out.push({ id: run.id, task: run.task.slice(0, 200), model: run.model, startedAt: run.startedAt, seconds: run.seconds, steps: run.events.filter((e) => e.kind === 'tool' && e.status === 'completed').length, error: run.error });
    } catch {
      // a broken file
    }
  }
  return out;
}

function loadRun(dir, id) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, `${safeId(id)}.json`), 'utf8'));
  } catch {
    return null;
  }
}

/** A run with every text through scrub (for sharing). */
function scrubRun(run, scrub) {
  const s = (v) => (typeof v === 'string' ? scrub(v) : v);
  return {
    ...run,
    task: s(run.task),
    events: run.events.map((e) => {
      const out = {};
      for (const [k, v] of Object.entries(e)) out[k] = k === 'items' ? v.map((i) => ({ ...i, text: s(i.text) })) : s(v);
      return out;
    })
  };
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** One web page that plays the run back (no network, no outside files). */
function replayHtml(run) {
  const data = JSON.stringify(run).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Najwa AI Plus run: ${esc(run.task.slice(0, 60))}</title>
<style>
:root{--bg:#f7f6fb;--card:#fff;--text:#1f1a33;--muted:#6b6580;--line:#e4e0ef;--add:#e6f6ea;--del:#fdecea;--accent:#45337f}
@media (prefers-color-scheme:dark){:root{--bg:#17132a;--card:#211c38;--text:#ece9f6;--muted:#a59fbd;--line:#352e55;--add:#173823;--del:#3d1d1d;--accent:#b9a8f5}}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:860px;margin:0 auto;padding:20px 16px 80px}
h1{font-size:19px;margin:0 0 4px}.meta{color:var(--muted);font-size:13px;margin-bottom:14px}
.bar{position:sticky;top:0;background:var(--bg);padding:10px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap;border-bottom:1px solid var(--line);z-index:1}
button{font:inherit;padding:6px 12px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--text);cursor:pointer}
input[type=range]{flex:1;min-width:140px;accent-color:var(--accent)}
.ev{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px 12px;margin:8px 0;overflow-wrap:anywhere}
.ev .t{color:var(--muted);font-size:12px;float:right;margin-left:8px}
.step{border-left:3px solid var(--accent)}.ask{border-left:3px solid #d08a2c}.text{white-space:pre-wrap}
pre{white-space:pre-wrap;font:12.5px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;margin:6px 0 0;direction:ltr;text-align:left}
pre span{display:block;unicode-bidi:plaintext}.add{background:var(--add)}.del{background:var(--del)}
.todo div{font-size:14px}.foot{color:var(--muted);font-size:12px;margin-top:24px}
</style></head><body><main>
<h1 dir="auto">${esc(run.task.slice(0, 300))}</h1>
<div class="meta">${esc(run.model)} · ${esc(run.project)} · ${esc(new Date(run.startedAt).toLocaleString('en-GB'))} · ${run.seconds}s</div>
<div class="bar"><button id="play">▶ Play</button><button id="step">Next step</button><button id="all">Show all</button><input id="pos" type="range" min="0" value="0"><span id="n" class="meta"></span></div>
<div id="out"></div>
<div class="foot">Najwa AI Plus by Bandar Altariqi · a run replay (secrets hidden)</div>
</main><script>
const run=${data};
const ev=run.events,out=document.getElementById('out'),pos=document.getElementById('pos'),n=document.getElementById('n');
pos.max=ev.length;
const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e};
const sec=(ms)=>(ms/1000).toFixed(1)+'s';
function diff(text){const pre=el('pre');for(const l of String(text).split('\\n')){const s=el('span',/^\\+(?!\\+\\+ )/.test(l)?'add':/^-(?!-- )/.test(l)?'del':'',l||' ');pre.append(s)}return pre}
function card(e){
  if(e.kind==='tool'&&e.status==='completed'){const d=el('div','ev step');d.append(el('span','t',sec(e.t)),el('span','',(e.emoji?e.emoji+' ':'')+(e.label||'')));return d}
  if(e.kind==='approval'){const d=el('div','ev ask');d.append(el('span','t',sec(e.t)),el('b','','❓ '+(e.title||'A question')));if(e.command)d.append(diff(e.command));if(e.description)d.append(el('div','meta',e.description));return d}
  if(e.kind==='answer'){const d=el('div','ev ask');d.append(el('span','t',sec(e.t)),el('span','','↳ '+({once:'Allowed',session:'Allowed for the chat',always:'Always allowed',deny:'Refused'}[e.choice]||e.choice)));return d}
  if(e.kind==='todo'){const d=el('div','ev todo');d.append(el('span','t',sec(e.t)),el('b','','📋 To-do'));for(const i of e.items||[])d.append(el('div','',(i.status==='done'?'✓ ':i.status==='in_progress'?'▸ ':'○ ')+i.text));return d}
  if(e.kind==='usage'){return null}
  if(e.kind==='text'){const t=e.text.replace(/<think>[\\s\\S]*?(<\\/think>|$)/g,'');if(!t.trim())return null;const d=el('div','ev text');d.dir='auto';d.append(el('span','t',sec(e.t)),document.createTextNode(t));return d}
  return null}
let shown=0,timer=null;
function show(k){out.textContent='';for(const e of ev.slice(0,k)){const c=card(e);if(c)out.append(c)}shown=k;pos.value=k;const u=[...ev.slice(0,k)].reverse().find((e)=>e.kind==='usage');n.textContent=k+' / '+ev.length+(u?' · '+(u.input+u.output)+' tokens'+(u.usd!=null?' · $'+u.usd.toFixed(4):''):'')}
function next(){let k=shown+1;while(k<ev.length&&!card(ev[k-1]))k++;show(Math.min(k,ev.length));if(shown>=ev.length)stop();window.scrollTo(0,document.body.scrollHeight)}
function stop(){clearInterval(timer);timer=null;document.getElementById('play').textContent='▶ Play'}
document.getElementById('play').onclick=()=>{if(timer)return stop();if(shown>=ev.length)show(0);timer=setInterval(next,700);document.getElementById('play').textContent='⏸ Pause'};
document.getElementById('step').onclick=()=>{stop();next()};
document.getElementById('all').onclick=()=>{stop();show(ev.length)};
pos.oninput=()=>{stop();show(Number(pos.value))};
show(ev.length);
</script></body></html>
`;
}

module.exports = { createRecorder, listRuns, loadRun, scrubRun, replayHtml };
