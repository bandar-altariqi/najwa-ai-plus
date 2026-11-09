// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

// Replies where the model can use tools (the browser, see src/browser-tools.js).
// The model answers, asks for a tool, gets its result, and goes on, until it
// answers without asking for one. Each kind of API takes tools its own way;
// for the user it's one reply, with each tool step shown as it happens.
//
// Models that can't use tools (an Ollama model without them, a server that
// refuses the request) get the ordinary reply instead: chatWithTools then
// resolves with { fallback: true } before writing anything.

'use strict';

const {
  PROVIDERS, trimSlash, httpError, withSystem, textOnly, picturesOf, ollamaMessages, openaiMessages, anthropicMessages,
  capabilitiesOf, replyWriter, readLines
} = require('./providers');

// Which providers can use tools, and how their API takes them.
const TOOL_KINDS = { anthropic: 'anthropic', openai: 'openai', openaiCompatible: 'openaiCompatible', ollama: 'ollama' };
const MAX_STEPS = 25;

class ToolsUnsupported extends Error {}

// A server that refuses tools says so with a 400 that mentions them.
async function toolsError(res) {
  const err = await httpError(res);
  return res.status === 400 && /tool|function/i.test(err.message) ? new ToolsUnsupported(err.message) : err;
}

const abortError = () => {
  const err = new Error('The operation was aborted.');
  err.name = 'AbortError';
  return err;
};

const dataUrlParts = (url) => {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(String(url || ''));
  return m ? { mediaType: m[1], data: m[2] } : null;
};

// ---- Claude ---------------------------------------------------------------

const anthropicKind = {
  async turn(cfg, req, defs, extra, w, signal) {
    const impl = PROVIDERS.anthropic.impl;
    const client = impl.client(cfg);
    const params = impl.params(req);
    params.messages = [...anthropicMessages(req.messages), ...extra];
    params.tools = defs.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
    const stream = impl.stream(client, params, signal);
    for await (const event of stream) {
      if (event.type !== 'content_block_delta') continue;
      if (event.delta.type === 'thinking_delta') w.reasoning(event.delta.thinking);
      else if (event.delta.type === 'text_delta') w.answer(event.delta.text);
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal') {
      const why = final.stop_details && final.stop_details.explanation;
      w.answer(`\n\n_The model declined this request${why ? `: ${why}` : '.'}_`);
    }
    return {
      calls: final.content.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, args: b.input || {} })),
      // The whole answer goes back, thinking included (Claude needs it to go on).
      assistant: [{ role: 'assistant', content: final.content }],
      stopReason: final.stop_reason,
      usage: final.usage ? { input: (final.usage.input_tokens || 0) + (final.usage.cache_read_input_tokens || 0) + (final.usage.cache_creation_input_tokens || 0), output: final.usage.output_tokens || 0 } : null
    };
  },

  results(calls, results) {
    return [{
      role: 'user',
      content: calls.map((c, i) => {
        const r = results[i];
        const blocks = [{ type: 'text', text: r.text || '(no text)' }];
        const pic = dataUrlParts(r.image);
        if (pic) blocks.push({ type: 'image', source: { type: 'base64', media_type: pic.mediaType, data: pic.data } });
        return { type: 'tool_result', tool_use_id: c.id, content: blocks, ...(r.error ? { is_error: true } : {}) };
      })
    }];
  },

  // A message from the user, after the results (in the same turn).
  say(extra, text) {
    extra[extra.length - 1].content.push({ type: 'text', text });
  }
};

// ---- OpenAI and OpenAI-compatible servers ------------------------------------

const openaiKind = (compatible) => ({
  async turn(cfg, req, defs, extra, w, signal) {
    const body = {
      model: req.model,
      messages: [...withSystem(req.system, openaiMessages(req.messages)), ...extra],
      stream: true,
      tools: defs.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }))
    };
    // The agent's budget guard needs each step's tokens (the last piece has them).
    if (req.usage) body.stream_options = { include_usage: true };
    if (compatible) {
      if (req.temperature != null) body.temperature = req.temperature;
      if (req.maxTokens > 0) body.max_tokens = req.maxTokens;
    } else if (req.maxTokens > 0) {
      body.max_completion_tokens = req.maxTokens;
    }
    const headers = { 'Content-Type': 'application/json' };
    if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
    const res = await fetch(`${trimSlash(cfg.baseUrl)}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body), signal });
    if (!res.ok) throw await toolsError(res);
    let text = '';
    let reasoning = '';
    let stopReason = 'end_turn';
    let usage = null;
    const calls = [];
    for await (const line of readLines(res.body)) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') break;
      let evt;
      try {
        evt = JSON.parse(data);
      } catch {
        continue;
      }
      if (evt.error) throw new Error(evt.error.message || JSON.stringify(evt.error));
      if (evt.usage) usage = { input: evt.usage.prompt_tokens || 0, output: evt.usage.completion_tokens || 0 };
      const choice = evt.choices && evt.choices[0];
      const delta = (choice && choice.delta) || {};
      const thought = delta.reasoning_content || delta.reasoning;
      if (thought && typeof thought === 'string') {
        reasoning += thought;
        w.reasoning(thought);
      }
      if (delta.content) {
        text += delta.content;
        w.answer(delta.content);
      }
      for (const tc of delta.tool_calls || []) {
        const i = tc.index ?? calls.length;
        const call = calls[i] || (calls[i] = { id: '', name: '', argsText: '' });
        if (tc.id) call.id = tc.id;
        if (tc.function && tc.function.name) call.name += tc.function.name;
        if (tc.function && tc.function.arguments) call.argsText += tc.function.arguments;
      }
      if (choice && choice.finish_reason === 'length') stopReason = 'max_tokens';
    }
    const made = calls.filter(Boolean).map((c, i) => {
      let args = {};
      try {
        args = c.argsText ? JSON.parse(c.argsText) : {};
      } catch {
        args = { _unreadable: c.argsText };
      }
      return { id: c.id || `call_${i}`, name: c.name, args, argsText: c.argsText || '{}' };
    });
    const assistant = {
      role: 'assistant',
      content: text || null,
      ...(made.length ? { tool_calls: made.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.argsText } })) } : {})
    };
    // Thinking models on some servers (DeepSeek's, for one) want their
    // reasoning back while they use tools.
    if (compatible && reasoning) assistant.reasoning_content = reasoning;
    return { calls: made, assistant: [assistant], stopReason, usage };
  },

  results(calls, results) {
    const out = calls.map((c, i) => ({ role: 'tool', tool_call_id: c.id, content: results[i].text || '(no text)' }));
    // Tool results can't hold pictures: a screenshot follows as a message.
    const pics = results.filter((r) => r.image);
    if (pics.length) {
      out.push({
        role: 'user',
        content: [{ type: 'text', text: 'The browser screenshot you asked for:' }, ...pics.map((r) => ({ type: 'image_url', image_url: { url: r.image } }))]
      });
    }
    return out;
  },

  say(extra, text) {
    extra.push({ role: 'user', content: text });
  }
});

// ---- Ollama --------------------------------------------------------------------

const ollamaKind = {
  async turn(cfg, req, defs, extra, w, signal) {
    const caps = await capabilitiesOf(cfg, req.model);
    if (caps && !caps.includes('tools')) throw new ToolsUnsupported(`${req.model} can't use tools.`);
    this.vision = !caps || caps.includes('vision');
    let messages = req.messages;
    if (caps && !caps.includes('vision') && messages.some((m) => picturesOf(m).length)) messages = textOnly(messages);
    const options = {};
    if (req.temperature != null) options.temperature = req.temperature;
    if (req.maxTokens > 0) options.num_predict = req.maxTokens;
    const body = {
      model: req.model,
      messages: [...withSystem(req.system, ollamaMessages(messages)), ...extra],
      stream: true,
      keep_alive: '30m',
      options,
      tools: defs.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }))
    };
    if ((cfg.think === false || req.think === false) && caps && caps.includes('thinking')) body.think = false;
    const res = await fetch(`${trimSlash(cfg.baseUrl)}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
    if (!res.ok) throw await toolsError(res);
    let text = '';
    let stopReason = 'end_turn';
    let stats;
    let usage = null;
    const calls = [];
    for await (const line of readLines(res.body)) {
      if (!line.trim()) continue;
      const evt = JSON.parse(line);
      if (evt.error) {
        if (/does not support tools/i.test(evt.error)) throw new ToolsUnsupported(evt.error);
        throw new Error(evt.error);
      }
      const m = evt.message || {};
      if (m.thinking) w.reasoning(m.thinking);
      if (m.content) {
        text += m.content;
        w.answer(m.content);
      }
      for (const tc of m.tool_calls || []) calls.push(tc);
      if (evt.done) {
        if (evt.done_reason === 'length') stopReason = 'max_tokens';
        usage = { input: evt.prompt_eval_count || 0, output: evt.eval_count || 0 };
        if (evt.eval_count) {
          const ns = (v) => (Number(v) || 0) / 1e6;
          stats = { engine: 'Ollama', device: 'Ollama', loadMs: ns(evt.load_duration), promptTokens: evt.prompt_eval_count || 0, promptMs: ns(evt.prompt_eval_duration), tokens: evt.eval_count, ms: ns(evt.eval_duration) };
        }
      }
    }
    return {
      calls: calls.map((tc, i) => ({ id: `call_${i}`, name: tc.function && tc.function.name, args: (tc.function && tc.function.arguments) || {} })),
      assistant: [{ role: 'assistant', content: text, tool_calls: calls }],
      stopReason,
      stats,
      usage
    };
  },

  results(calls, results) {
    return calls.map((c, i) => {
      const r = results[i];
      const pic = this.vision && dataUrlParts(r.image);
      return { role: 'tool', tool_name: c.name, content: r.text || '(no text)', ...(pic ? { images: [pic.data] } : {}) };
    });
  },

  say(extra, text) {
    extra.push({ role: 'user', content: text });
  }
};

const KINDS = { anthropic: anthropicKind, openai: openaiKind(false), openaiCompatible: openaiKind(true), ollama: ollamaKind };

/**
 * One reply with tools.
 * @param tools { defs: [{ name, description, parameters }], run(name, args, signal) -> { text, image?, error? },
 *               describe(call) -> label shown for the step }
 * onInfo gets { kind: 'tool', id, emoji, label, status } for each step and
 * { kind: 'shot', src, label } for a screenshot.
 * Resolves with { text, stopReason, stats } or { fallback: true }.
 */
async function chatWithTools({ kind, cfg, req, onDelta, signal, onInfo = () => {}, tools }) {
  if (!KINDS[kind]) return { fallback: true };
  const k = Object.create(KINDS[kind]); // per reply (Ollama remembers whether the model can see)
  const w = replyWriter(onDelta);
  const extra = [];
  // Messages the user sends meanwhile: read by the model after the current
  // step, once it's working with tools. Before that (just answering), the app
  // interrupts the reply instead, so it's refused here.
  const inbox = [];
  const working = { yes: false };
  if (req.steering) req.steering.send = (text, id) => working.yes && inbox.push({ text, id }) > 0;
  try {
    return await toolLoop({ k, cfg, req, w, extra, inbox, working, signal, onInfo, tools });
  } finally {
    if (req.steering) req.steering.send = null;
  }
}

// Long agent tasks: once the tool results so far get big, the older ones are
// cut down to their start (the newest few stay whole), so the model keeps room
// to work. Works on each API's own message shapes.
function compactResults(extra, budget, keep = 6) {
  const holders = [];
  for (const m of extra) {
    if (m.role === 'tool' && typeof m.content === 'string') holders.push({ get: () => m.content, set: (v) => { m.content = v; } });
    else if (Array.isArray(m.content)) {
      for (const b of m.content) {
        if (b && b.type === 'tool_result' && typeof b.content === 'string') holders.push({ get: () => b.content, set: (v) => { b.content = v; } });
      }
    }
  }
  let total = holders.reduce((n, x) => n + x.get().length, 0);
  if (total <= budget) return 0;
  let trimmed = 0;
  for (const x of holders.slice(0, Math.max(0, holders.length - keep))) {
    const text = x.get();
    if (text.length <= 600 || text.startsWith('[Older result, shortened')) continue;
    const short = `[Older result, shortened to save room. Run the tool again if you need it all.]\n${text.slice(0, 500)}…`;
    x.set(short);
    total -= text.length - short.length;
    trimmed++;
    if (total <= budget) break;
  }
  return trimmed;
}

async function toolLoop({ k, cfg, req, w, extra, inbox, working, signal, onInfo, tools }) {
  let turn;
  const maxSteps = tools.maxSteps || MAX_STEPS;
  for (let step = 0; ; step++) {
    if (tools.contextBudget) compactResults(extra, tools.contextBudget);
    try {
      turn = await k.turn(cfg, tools.budget ? { ...req, usage: true } : req, tools.defs, extra, w, signal);
    } catch (err) {
      if (err instanceof ToolsUnsupported && step === 0 && !w.text) {
        return { fallback: true, ...(inbox.length ? { pendingSteer: inbox.map((m) => m.text).join('\n') } : {}) };
      }
      throw err;
    }
    if (tools.budget) tools.budget.add(turn.usage);
    if (!turn.calls.length) break;
    // Budget guard: at the cap the user decides whether the task goes on.
    if (tools.budget && !(await tools.budget.check())) {
      w.answer(`\n\n⏸️ Stopped at the budget: ${tools.budget.summary()}. Ask again to go on.`);
      break;
    }
    working.yes = true;
    extra.push(...turn.assistant);
    w.gap();
    const results = [];
    const runOne = async (call, i) => {
      const id = `${call.id || 'call'}-${step}-${i}`;
      const label = tools.describe(call);
      onInfo({ kind: 'tool', id, emoji: tools.emoji ? tools.emoji(call) : '🌐', label, status: 'running' });
      let r;
      if (step >= maxSteps) {
        r = { text: 'You\'ve used enough tools for this reply. Answer the user now with what you found.', error: true };
      } else {
        try {
          r = await tools.run(call.name, call.args || {}, signal, { id, label });
        } catch (err) {
          if (signal && signal.aborted) throw abortError();
          r = { text: `That didn't work: ${err.message || err}`, error: true };
        }
      }
      const done = r.label || label;
      onInfo({ kind: 'tool', id, label: r.error && !r.label ? `${done} (didn't work)` : done, relabel: true, status: 'completed' });
      if (r.image) onInfo({ kind: 'shot', src: r.image, label });
      return r;
    };
    // One at a time, except calls a toolset runs side by side (helper agents)
    // when they come together.
    const together = (call) => !!(tools.parallel && tools.parallel(call.name));
    for (let i = 0; i < turn.calls.length;) {
      if (signal && signal.aborted) throw abortError();
      let j = i + 1;
      if (together(turn.calls[i])) while (j < turn.calls.length && together(turn.calls[j])) j++;
      const batch = turn.calls.slice(i, j);
      results.push(...(await Promise.all(batch.map((call, n) => runOne(call, i + n)))));
      i = j;
    }
    extra.push(...k.results(turn.calls, results));
    if (inbox.length) {
      const said = inbox.splice(0);
      k.say(extra, `[The user sent this while you were working]\n${said.map((m) => m.text).join('\n\n')}`);
      for (const m of said) onInfo({ kind: 'steer', id: m.id, status: 'read' });
    }
  }
  w.close();
  // Sent too late for the model to read: the app sends it as the next message.
  const pendingSteer = inbox.map((m) => m.text).join('\n');
  return { text: w.text, stopReason: turn.stopReason, stats: turn.stats, ...(pendingSteer ? { pendingSteer } : {}) };
}

// Several sets of tools (the browser, each connector) as one.
function combineTools(sets) {
  const live = sets.filter((t) => t && t.defs && t.defs.length);
  const owner = (name) => live.find((t) => (t.owns ? t.owns(name) : t.defs.some((d) => d.name === name)));
  return {
    defs: live.flatMap((t) => t.defs),
    describe: (call) => (owner(call.name) ? owner(call.name).describe(call) : `Using ${call.name}`),
    emoji: (call) => {
      const t = owner(call.name);
      return t && t.emoji ? t.emoji(call) : '🌐';
    },
    run: (name, args, signal, step) => {
      const t = owner(name);
      return t ? t.run(name, args, signal, step) : Promise.resolve({ text: `There's no tool called ${name}.`, error: true });
    },
    close: () => live.forEach((t) => t.close && t.close()),
    budget: (live.find((t) => t.budget) || {}).budget,
    parallel: (name) => {
      const t = owner(name);
      return !!(t && t.parallel && t.parallel(name));
    },
    // The largest wins: an agent set asks for more steps and room than a browser.
    maxSteps: Math.max(0, ...live.map((t) => t.maxSteps || 0)) || undefined,
    contextBudget: Math.max(0, ...live.map((t) => t.contextBudget || 0)) || undefined
  };
}

module.exports = { chatWithTools, combineTools, compactResults, TOOL_KINDS, MAX_STEPS };
