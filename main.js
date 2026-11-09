// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

const { app, BrowserWindow, ipcMain, Menu, shell, dialog, safeStorage, nativeTheme, screen, net, systemPreferences, powerSaveBlocker, Notification } = require('electron');
const fs = require('fs');
const path = require('path');
const { Storage, DEFAULT_SETTINGS } = require('./src/storage');
const { nodeFsBackend } = require('./src/backends/node-fs');
const { PROVIDERS, normalizeMessages } = require('./src/providers');
const { Sync } = require('./src/sync');
const { createReplyHub } = require('./src/reply-hub');
const Lease = require('./src/lease');
const { isAllowedExternal } = require('./renderer/report');
// The app's language (Settings → General) for the menus, dialogs and
// notifications here; the window tells it (app:language).
const I18n = require('./renderer/i18n');
const tr = (text) => I18n.t(text);
const { desktopGoogleAuth } = require('./src/google-auth-desktop');
const { linkKey } = require('./src/remote');
const { startRemoteServer, localAddresses } = require('./src/remote-server');
const { createVoice } = require('./src/voice-desktop');
const { readLink } = require('./src/link-reader');
const { chatWithTools, combineTools, TOOL_KINDS } = require('./src/tool-chat');
const { connectorHub, connectorsNote, urlOf } = require('./src/connectors');
const { httpTransport } = require('./src/mcp-client');
const { stdioTransport } = require('./src/mcp-stdio');
const { localApprovals } = require('./src/local-approvals');
const { desktopBrowser } = require('./src/browser-desktop');
const { browsingNote } = require('./src/browser-tools');
const { agentTools } = require('./src/agent/tools');
const { createFirewall, isLocalModel } = require('./src/agent/firewall');
const { createCheckpoints } = require('./src/agent/checkpoints');
const { helperRunner, chooseHelper } = require('./src/agent/helpers');
const { tailscaleMachines } = require('./src/agent/homelab');
const { createRecorder, listRuns, loadRun, scrubRun, replayHtml } = require('./src/agent/replay');
const { compactMessages, summaryStore, SUMMARY_SYSTEM } = require('./src/agent/compact');
const { expandCommand, listCommands } = require('./src/agent/commands');
const { createReviewer } = require('./src/agent/reviewer');
const { backgroundJobs } = require('./src/agent/shell');
const os = require('os');

// Najwa AI Plus: Najwa AI with a full agent harness (src/agent/). It has its
// own name, data folder and keychain entry, so it installs beside Najwa AI
// without touching its chats or keys.
const APP_NAME = 'Najwa AI Plus';
const INTERNAL_NAME = 'Najwa AI Plus';
app.setName(INTERNAL_NAME);
app.setPath('userData', path.join(app.getPath('appData'), INTERNAL_NAME));
app.setAboutPanelOptions({ applicationName: APP_NAME });

// Allow a custom data folder (e.g. a synced folder) via BALIMDA_DATA_DIR.
const dataDir = process.env.BALIMDA_DATA_DIR || path.join(app.getPath('userData'), 'data');

let storage;
let sync;
let mainWindow;
const activeRequests = new Map();
const activeSteering = new Map(); // requestId -> { send } for messages sent mid-reply

// Voice chat: Whisper (built by scripts/build-whisper.js, packed into the
// app's resources) recognises speech on this computer.
const whisperDir = app.isPackaged
  ? path.join(process.resourcesPath, 'whisper')
  : path.join(__dirname, 'whisper-bin', `${{ win32: 'win', darwin: 'mac' }[process.platform] || 'linux'}-${process.arch}`);
let voice;
// Chromium reads text aloud through speech-dispatcher on Linux.
if (process.platform === 'linux') app.commandLine.appendSwitch('enable-speech-dispatcher');

// Only one copy runs; a second launch focuses the first. exit() rather than
// quit(), so the second copy never starts sync or sharing with the phone.
if (!app.requestSingleInstanceLock()) {
  app.exit(0);
}

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

// API keys are encrypted with the OS keychain when it is available.
function secrets() {
  const canEncrypt = () => {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  };
  return {
    encrypt(s) {
      if (!s || !canEncrypt()) return s;
      return `enc:${safeStorage.encryptString(s).toString('base64')}`;
    },
    decrypt(s) {
      if (!s || !s.startsWith('enc:')) return s;
      try {
        return safeStorage.decryptString(Buffer.from(s.slice(4), 'base64'));
      } catch {
        return '';
      }
    }
  };
}

// Google sign-in (for Drive sync) needs the app's OAuth client. Release
// builds get it from google-oauth.json, which CI writes from repository
// secrets; for development, set BALIMDA_GOOGLE_CLIENT_ID and _SECRET.
function googleAuth() {
  let cfg = null;
  try {
    cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'google-oauth.json'), 'utf8'));
  } catch {
    cfg = { clientId: process.env.BALIMDA_GOOGLE_CLIENT_ID, clientSecret: process.env.BALIMDA_GOOGLE_CLIENT_SECRET };
  }
  if (!cfg || !cfg.clientId || !cfg.clientSecret) return null;
  const auth = desktopGoogleAuth({
    ...cfg,
    openUrl: (url) => shell.openExternal(url),
    fetch: (url, opts) => net.fetch(url, opts)
  });
  return {
    ...auth,
    // Bring Najwa AI back to the front once the browser part is done.
    async signIn() {
      const result = await auth.signIn();
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
      return result;
    }
  };
}

function boundsAreVisible(bounds) {
  return screen.getAllDisplays().some(({ workArea: a }) =>
    bounds.x < a.x + a.width && bounds.x + bounds.width > a.x &&
    bounds.y < a.y + a.height && bounds.y + bounds.height > a.y);
}

let quitPrepared = false;  // before-quit has saved and synced; quitting goes ahead

// Asks the window to write the chats it is waiting to save (see
// renderer/save-queue.js), and waits for it, but not for long.
function flushWindowSaves(timeoutMs = 3000) {
  const win = mainWindow;
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return Promise.resolve();
  const timeout = new Promise((r) => setTimeout(r, timeoutMs));
  const flush = win.webContents.executeJavaScript('window.najwaFlushSaves ? window.najwaFlushSaves() : 0', true);
  return Promise.race([flush, timeout]).catch(() => {});
}

async function createWindow() {
  const state = await storage.getState();
  const saved = state.windowBounds;
  const bounds = saved && boundsAreVisible(saved) ? saved : { width: 1200, height: 800 };

  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 720,
    minHeight: 480,
    title: APP_NAME,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#16171b' : '#ffffff',
    icon: path.join(__dirname, 'build', 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true
    }
  });
  if (state.maximized) mainWindow.maximize();

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Remember window size and position between sessions.
  const saveBounds = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const maximized = mainWindow.isMaximized();
    storage.saveState(maximized ? { maximized } : { maximized, windowBounds: mainWindow.getBounds() }).catch(() => {});
  };
  let boundsTimer;
  const scheduleSave = () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(saveBounds, 500);
  };
  mainWindow.on('resize', scheduleSave);
  mainWindow.on('move', scheduleSave);
  mainWindow.on('close', saveBounds);
  // Closing the window: first let it write the chats it is still waiting to
  // save (a streaming reply is saved on a timer), then close. When the app is
  // quitting, before-quit has done this already.
  let closeFlushed = false;
  mainWindow.on('close', (e) => {
    if (closeFlushed || quitPrepared) return;
    e.preventDefault();
    closeFlushed = true;
    const win = mainWindow;
    flushWindowSaves().finally(() => {
      if (!win.isDestroyed()) win.close();
    });
  });
  // Pick up what you did on your phone as soon as you come back to the PC.
  mainWindow.on('focus', () => sync.run());

  // Open links in the user's browser, never inside the app. Web pages, and the
  // report email (mailto to the support address only; see renderer/report.js).
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternal(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (url !== mainWindow.webContents.getURL()) {
      e.preventDefault();
      if (isAllowedExternal(url)) shell.openExternal(url);
    }
  });
}

// ---- "Use my computer's models" from the phone ------------------------------
// When turned on (settings.shareWithPhone) and sync is set up, a small
// encrypted server answers the phone's chat requests with this computer's
// models, and this computer's addresses are published through sync.

let remote = null;        // { port, close } while sharing
let replies = null;       // reply bookkeeping (src/reply-hub.js)
let remoteKey = null;     // { syncKey, key }
let remoteError = null;
let shareWanted = false;  // settings.shareWithPhone, as last read

// Keeping the computer awake for the phone. An idle computer goes to sleep
// however busy it is answering the phone (only the keyboard and mouse count),
// which cut replies off and left the phone unable to reach it. It stays awake
// while it's answering the phone, and while sharing if settings.shareKeepAwake
// (the default); the screen can still turn off.
let keepAwake = true;    // settings.shareKeepAwake, as last read
let phoneRequests = 0;   // replies being written for the phone
let awakeId = null;      // powerSaveBlocker id
function updateAwake() {
  const want = phoneRequests > 0 || (!!remote && keepAwake);
  if (want && awakeId === null) {
    awakeId = powerSaveBlocker.start('prevent-app-suspension');
  } else if (!want && awakeId !== null) {
    powerSaveBlocker.stop(awakeId);
    awakeId = null;
  }
}
async function whileAnswering(work) {
  phoneRequests++;
  updateAwake();
  try {
    return await work();
  } finally {
    phoneRequests--;
    updateAwake();
  }
}

async function currentLinkKey() {
  const syncKey = sync && sync.linkKey();
  if (!syncKey) return null;
  if (!remoteKey || remoteKey.syncKey !== syncKey) remoteKey = { syncKey, key: await linkKey(syncKey) };
  return remoteKey.key;
}

function computerName() {
  return os.hostname().replace(/\.(local|lan|home)$/i, '') || 'My computer';
}

async function computerId() {
  const state = await storage.getState();
  if (state.computerId) return state.computerId;
  const id = globalThis.crypto.randomUUID();
  await storage.saveState({ computerId: id });
  return id;
}

async function enabledProviders(settings) {
  return Object.keys(PROVIDERS).filter((id) => {
    const p = settings.providers[id];
    return p && p.enabled !== false && ((id !== 'anthropic' && id !== 'openai') || p.apiKey);
  });
}

// Connectors (Settings → Connectors): their tools, kept connected between
// replies; and the user's answers when one wants to change something.
const connectors = connectorHub({
  transportFor: (c) => (c.kind === 'command'
    ? stdioTransport({ command: c.command, args: c.args || [], env: c.env || {} })
    : httpTransport({ url: urlOf(c), headers: c.token ? { Authorization: `Bearer ${c.token}` } : {} })),
  version: app.getVersion()
});
const approvals = localApprovals();

// ---- The agent (Najwa AI Plus): a chat with a project folder ----------------
// Checkpoints (undo) live in the data folder; background commands last while
// the app runs.
const checkpoints = createCheckpoints(path.join(dataDir, 'agent-checkpoints'));
// The app's own commands and skills, for every project (<data>/agent/commands, /skills).
const agentDir = path.join(dataDir, 'agent');
const runsDir = path.join(dataDir, 'agent-runs');
const summaries = summaryStore(path.join(dataDir, 'agent-summaries'));
const agentJobs = backgroundJobs();

const textOf = (content) => (typeof content === 'string' ? content : Array.isArray(content) ? content.map((p) => (typeof p === 'string' ? p : p && p.text) || '').join('\n') : '');

// One plain reply from a model (for the second opinion).
function plainReply(providerId, cfg, req, signal) {
  const provider = PROVIDERS[providerId];
  if (!provider) throw new Error(`Unknown provider: ${providerId}`);
  let text = '';
  return provider.impl.streamChat(cfg, req, (piece) => { text += piece; }, signal, () => {}).then(() => text);
}

// Recent project folders that are still there: [{ root, name }].
function existingProjects(settings) {
  return ((settings.agent && settings.agent.recent) || []).filter((r) => {
    try {
      return fs.statSync(r).isDirectory();
    } catch {
      return false;
    }
  }).map((root) => ({ root, name: path.basename(root) }));
}

// A project folder used: first in the list of recent ones (for the phone too).
async function rememberProject(root) {
  const settings = await storage.getSettings();
  const agent = { ...(settings.agent || {}) };
  agent.recent = [root, ...(agent.recent || []).filter((r) => r !== root)].slice(0, 12);
  await storage.saveSettings({ ...settings, agent });
}

// Mixed crew: helpers can use another model (Settings → Agent → Helpers use),
// say small local ones while a big model plans. A project on a local model
// stays local: its helpers must be local too (and with Local only, always).
function helperFor(providerId, cfg, model, a, settings, onInfo) {
  const h = a.helperModel && a.helperModel.provider ? { ...a.helperModel, cfg: settings.providers[a.helperModel.provider] || {} } : null;
  const use = chooseHelper({ main: { provider: providerId, cfg, model }, helper: h, localOnly: !!a.localOnly, isLocal: isLocalModel, canUseTools: (p) => !!TOOL_KINDS[p] });
  return helperRunner({ kind: TOOL_KINDS[use.provider], cfg: use.cfg, model: use.model, local: isLocalModel(use.provider, use.cfg), onInfo });
}

// "Always" for a project's hooks: their fingerprint (src/agent/hooks.js).
async function trustHooks(hash) {
  const settings = await storage.getSettings();
  const agent = { ...(settings.agent || {}) };
  if ((agent.trustedHooks || []).includes(hash)) return;
  agent.trustedHooks = [...(agent.trustedHooks || []), hash].slice(-100);
  await storage.saveSettings({ ...settings, agent });
}

async function rememberCommand(start) {
  const settings = await storage.getSettings();
  const agent = { ...(settings.agent || {}) };
  if ((agent.rules || []).includes(start)) return;
  agent.rules = [...(agent.rules || []), start];
  await storage.saveSettings({ ...settings, agent });
}

/**
 * The agent's tools for a reply in a chat with a project folder.
 * @param spec { root, mode } from the chat
 */
async function agentToolset(providerId, cfg, settings, req, spec, onInfo, signal, origin) {
  const root = path.resolve(String(spec.root || ''));
  const a = { ...(DEFAULT_SETTINGS.agent || {}), ...(settings.agent || {}) };
  const privateGlobs = String(a.privateFiles || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const firewall = createFirewall({ enabled: a.firewall !== false, cloud: !isLocalModel(providerId, cfg), privateGlobs });
  let reviewer = null;
  const rcfgOf = (r) => settings.providers[r.provider] || {};
  if (a.reviewer && a.reviewer.provider && a.reviewer.model && PROVIDERS[a.reviewer.provider] && (!a.localOnly || isLocalModel(a.reviewer.provider, rcfgOf(a.reviewer)))) {
    const rcfg = rcfgOf(a.reviewer);
    const rWall = createFirewall({ enabled: a.firewall !== false, cloud: !isLocalModel(a.reviewer.provider, rcfg), privateGlobs });
    reviewer = createReviewer({
      label: a.reviewer.model,
      cloud: !isLocalModel(a.reviewer.provider, rcfg),
      scrub: (t) => rWall.scrub(t).text,
      chat: (r, sig) => plainReply(a.reviewer.provider, rcfg, { model: a.reviewer.model, ...r }, sig)
    });
  }
  const lastUser = [...(req.messages || [])].reverse().find((m) => m.role === 'user');
  const set = agentTools({
    root,
    chatId: req.chatId,
    mode: spec.mode || a.defaultMode || 'ask',
    options: { rules: a.rules || [], dryRun: a.dryRun || 'risky', prices: a.prices || '', budgetUsd: a.budgetUsd || 0, budgetTokens: a.budgetTokens || 0, providerPrice: cfg.price || null, skillDirs: [agentDir], trustedHooks: a.trustedHooks || [], onTrustHooks: (hash) => trustHooks(hash).catch(() => {}), runHelper: helperFor(providerId, cfg, req.model || '', a, settings, onInfo), machines: a.machines || '' },
    model: req.model || '',
    local: isLocalModel(providerId, cfg),
    firewall,
    approve: (() => {
      const ask = approvals.asker(onInfo, signal, origin);
      // The answer goes in the run's replay too.
      return async (card) => {
        const choice = await ask(card);
        onInfo({ kind: 'answer', title: card.title, choice });
        return choice;
      };
    })(),
    chatAllowed: approvals.allowedFor(req.chatId ? `agent:${req.chatId}` : null),
    checkpoints,
    reviewer,
    task: lastUser ? textOf(lastUser.content) : '',
    jobs: agentJobs,
    onInfo,
    onAlways: (start) => rememberCommand(start).catch(() => {})
  });
  rememberProject(root).catch(() => {});
  return set;
}

// Run replay (src/agent/replay.js): an agent reply is recorded as it goes.
async function runChat(providerId, req, onDelta, signal, onInfo) {
  if (!(req.agent && req.agent.root)) return runChatInner(providerId, req, onDelta, signal, onInfo);
  const lastUser = [...(req.messages || [])].reverse().find((m) => m.role === 'user');
  const rec = createRecorder({ dir: runsDir, chatId: req.chatId, task: lastUser ? textOf(lastUser.content) : '', model: req.model, project: path.basename(String(req.agent.root)) });
  try {
    const res = await runChatInner(providerId, req, (p) => { rec.delta(p); onDelta(p); }, signal, (i) => { rec.info(i); if (onInfo) onInfo(i); });
    rec.finish();
    return res;
  } catch (err) {
    rec.finish(err);
    throw err;
  }
}

async function runChatInner(providerId, req, onDelta, signal, onInfo) {
  const provider = PROVIDERS[providerId];
  if (!provider) throw new Error(`Unknown provider: ${providerId}`);
  const settings = await storage.getSettings();
  const cfg = settings.providers[providerId] || {};
  const request = {
    model: req.model,
    system: req.system,
    messages: normalizeMessages(req.messages || []),
    temperature: req.temperature,
    maxTokens: req.maxTokens,
    think: req.think,
    steering: req.steering,
    ...(req.resumeRun ? { resumeRun: String(req.resumeRun) } : {})
  };
  // Tools for models that can use them (also for the phone, when it uses this
  // computer's models): "Let models use a browser" (this computer's hidden
  // browser), and this computer's connectors.
  const agentSpec = req.agent && req.agent.root ? req.agent : null;
  // A slash command ("/review src") becomes its saved prompt for the model.
  if (agentSpec) {
    const last = request.messages[request.messages.length - 1];
    const cmd = last && last.role === 'user' ? expandCommand(path.resolve(String(agentSpec.root)), textOf(last.content), [agentDir]) : null;
    if (cmd) {
      request.messages = [...request.messages.slice(0, -1), { ...last, content: Array.isArray(last.content) ? [{ type: 'text', text: cmd.text }, ...last.content.filter((p) => p && p.type !== 'text')] : cmd.text }];
      onInfo({ kind: 'status', text: `/${cmd.name}` });
    }
  }
  if (agentSpec && settings.agent && settings.agent.localOnly && !isLocalModel(providerId, cfg)) {
    throw new Error('Local only is on (Settings → Agent): choose a model on this computer or your network for this project, or turn it off.');
  }
  // Compaction: a long agent chat's older messages go to the model as a summary.
  let compactUsage = null;
  if (agentSpec && TOOL_KINDS[providerId] && req.chatId) {
    const res = await compactMessages({
      chatId: req.chatId,
      messages: request.messages,
      store: summaries,
      onStatus: (text) => { if (onInfo) onInfo({ kind: 'status', text }); },
      summarize: (text) => plainReply(providerId, cfg, { model: request.model, system: SUMMARY_SYSTEM, messages: [{ role: 'user', content: text }], maxTokens: 2000, temperature: 0 }, signal)
    }).catch(() => ({ messages: request.messages, compacted: 0 }));
    request.messages = res.messages;
    compactUsage = res.usage || null;
  }
  if (agentSpec && !TOOL_KINDS[providerId]) throw new Error(`${provider.label} can't work in a project folder. Choose a model from Ollama, LM Studio, Claude or OpenAI.`);
  if (TOOL_KINDS[providerId] && (req.browse || req.connectors || agentSpec)) {
    const sets = [];
    let system = request.system;
    const browser = req.browse ? desktopBrowser() : null;
    try {
      if (agentSpec) {
        const origin = { id: await computerId(), name: computerName(), computer: true };
        const agent = await agentToolset(providerId, cfg, settings, { chatId: req.chatId, messages: request.messages, model: request.model }, agentSpec, onInfo, signal, origin);
        sets.push(agent);
        if (compactUsage) agent.budget.add(compactUsage);
        system = system ? `${system}\n\n${agent.system}` : agent.system;
      }
      if (browser) {
        sets.push(browser);
        system = browsingNote(system, true);
      }
      const mine = req.connectors ? (settings.connectors || []).filter((c) => c.enabled !== false) : [];
      if (mine.length) {
        const origin = { id: await computerId(), name: computerName(), computer: true };
        const set = await connectors.toolset(mine, { approve: approvals.asker(onInfo, signal, origin), allowed: approvals.allowedFor(req.chatId), signal });
        sets.push(set);
        system = connectorsNote(system, set);
      }
      const tools = combineTools(sets);
      if (tools.defs.length) {
        const result = await chatWithTools({ kind: TOOL_KINDS[providerId], cfg, req: { ...request, system }, onDelta, signal, onInfo, tools });
        if (!result.fallback) return result;
        if (agentSpec) throw new Error(`${req.model} can't use tools, so it can't work in a project folder. Choose a model that can (most recent Qwen, Llama 3.1+, Mistral, Claude and GPT models can).`);
        // Messages sent meanwhile go as the next message.
        if (result.pendingSteer) {
          const plain = await provider.impl.streamChat(cfg, request, onDelta, signal, onInfo);
          return { ...plain, pendingSteer: result.pendingSteer };
        }
      }
    } finally {
      if (browser) browser.close();
    }
  }
  return provider.impl.streamChat(cfg, request, onDelta, signal, onInfo);
}

async function checkShared(providerId) {
  if (!(await enabledProviders(await storage.getSettings())).includes(providerId)) {
    throw new Error(`${PROVIDERS[providerId] ? PROVIDERS[providerId].label : 'This provider'} is turned off on ${computerName()}.`);
  }
}

// An answer to a question of a phone's reply on this computer: its copy in
// this computer's chat says so too (see reply-hub.js).
function answeredHere(payload, ok) {
  if (ok !== false && replies && payload) replies.answered(payload);
  return ok;
}

async function approveOn(providerId, payload) {
  // A connector's question, asked by this computer.
  if (approvals.owns(payload)) return approvals.answer(payload);
  const provider = PROVIDERS[providerId];
  if (!provider || !provider.impl.approve) throw new Error('This model can\'t take approvals.');
  const cfg = (await storage.getSettings()).providers[providerId] || {};
  return provider.impl.approve(cfg, payload);
}

const remoteSteering = new Map();   // reply job -> { send } (the phone steering a reply here)

const remoteHandlers = {
  hello: async () => ({ app: 'balimda', name: computerName(), version: app.getVersion() }),
  models: async () => {
    const settings = await storage.getSettings();
    const out = [];
    await Promise.all((await enabledProviders(settings)).map(async (id) => {
      try {
        const models = await PROVIDERS[id].impl.listModels(settings.providers[id]);
        const short = PROVIDERS[id].label.replace(/\s*\(.*\)$/, '');
        if (models.length) out.push({ provider: id, label: PROVIDERS[id].label, short, models });
      } catch {
        // not running: leave it out
      }
    }));
    return out;
  },
  chat: async (msg, { emit, signal }) => {
    await checkShared(msg.provider);
    // Najwa AI Plus: the phone can send messages into this reply while it
    // works (the "steer" request, by the reply's job).
    const steering = { send: null };
    if (msg.job != null) remoteSteering.set(String(msg.job), steering);
    // One reply per chat (a second one is refused with a "busy" error), and
    // the reply is kept in this computer's copy of the chat too, steps and
    // questions included.
    try {
      return await whileAnswering(() => replies.remoteChat(msg, { emit, signal }, (onDelta, work, onInfo) => runChat(msg.provider, { ...(msg.req || {}), steering }, onDelta, work || signal, onInfo || ((info) => emit({ t: 'info', info })))));
    } finally {
      if (msg.job != null && remoteSteering.get(String(msg.job)) === steering) remoteSteering.delete(String(msg.job));
    }
  },
  // A message from the phone for a reply running here: true when it took it.
  steer: async (msg) => {
    const s = remoteSteering.get(String(msg.of));
    if (!s || !s.send || typeof msg.text !== 'string' || !msg.text.trim()) return false;
    return !!s.send(msg.text.slice(0, 8000), msg.id ? String(msg.id) : undefined);
  },
  // The phone stays connected and is told when this computer has new data to sync.
  watch: (msg, ctx) => replies.watch(msg, ctx),
  // The phone has just put new data in the synced copy: sync now.
  pushed: async () => {
    sync.run().catch(() => {});
    return true;
  },
  // The agent from the phone: this computer's recent project folders, and
  // undoing an agent's changes here.
  agentProjects: async () => existingProjects(await storage.getSettings()),
  agentCheckpoints: async (msg) => checkpoints.list(String(msg.chatId || '')),
  agentUndo: async (msg) => checkpoints.undo(String(msg.chatId || ''), msg.id || null),
  // The phone answering an agent's request for permission.
  approve: async (msg) => {
    // A connector's question this computer asked, answered from the phone.
    if (approvals.owns(msg.payload)) return answeredHere(msg.payload, approvals.answer(msg.payload));
    await checkShared(msg.provider);
    return answeredHere(msg.payload, await approveOn(msg.provider, msg.payload || {}));
  }
};

// Start/stop sharing and publish this computer's addresses. Runs one at a
// time: several triggers (startup, settings, sync status, the timer) can
// fire together, and two at once would start two servers.
let remoteUpdate = Promise.resolve();
function updateRemote() {
  remoteUpdate = remoteUpdate.then(doUpdateRemote).catch((err) => {
    remoteError = `Couldn't share with the phone: ${err.message || err}`;
    send('remote:status', remoteStatus());
  });
  return remoteUpdate;
}

async function doUpdateRemote() {
  const settings = await storage.getSettings();
  shareWanted = !!settings.shareWithPhone;
  keepAwake = settings.shareKeepAwake !== false;
  const wanted = shareWanted && !!sync.linkKey();
  try {
    if (wanted && !remote) {
      remote = await startRemoteServer({ getKey: currentLinkKey, handlers: remoteHandlers });
    } else if (!wanted && remote) {
      await remote.close();
      remote = null;
    }
    remoteError = null;
  } catch (err) {
    remote = null;
    remoteError = `Couldn't start sharing: ${err.message}`;
  }
  updateAwake();
  if (sync.linkKey()) {
    const id = await computerId();
    const known = (settings.computers || {})[id];
    if (remote) {
      await storage.publishComputer(id, { id, name: computerName(), addrs: localAddresses(), port: remote.port, enabled: true });
    } else if (known && known.enabled) {
      await storage.publishComputer(id, { ...known, enabled: false });
    }
  }
  send('remote:status', remoteStatus());
}

function remoteStatus() {
  return {
    sharing: !!remote,
    syncReady: !!(sync && sync.linkKey()),
    name: computerName(),
    addrs: remote ? localAddresses() : [],
    port: remote ? remote.port : null,
    error: remoteError
  };
}

// A file name from a chat title, keeping letters in any language (Arabic too).
function safeFileName(title) {
  return String(title || '').replace(/[^\p{L}\p{N}\- ]+/gu, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'chat';
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    // The app menu, labelled with the name people see (the default one uses
    // the internal name, see APP_NAME).
    ...(isMac ? [{
      label: APP_NAME,
      submenu: [
        { role: 'about', label: tr(`About ${APP_NAME}`) },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide', label: tr(`Hide ${APP_NAME}`) },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit', label: tr(`Quit ${APP_NAME}`) }
      ]
    }] : []),
    {
      label: tr('File'),
      submenu: [
        { label: tr('New Chat'), accelerator: 'CmdOrCtrl+N', click: () => send('menu', 'new-chat') },
        { label: tr('Search Chats'), accelerator: 'CmdOrCtrl+K', click: () => send('menu', 'search') },
        { label: tr('Settings'), accelerator: 'CmdOrCtrl+,', click: () => send('menu', 'settings') },
        { type: 'separator' },
        { label: tr('Export All Chats…'), click: () => send('menu', 'export') },
        { label: tr('Import Chats…'), click: () => send('menu', 'import') },
        { label: tr('Sync Now'), click: () => sync.run() },
        { label: tr('Open Data Folder'), click: () => shell.openPath(dataDir) },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    { role: 'editMenu' },
    {
      label: tr('View'),
      submenu: [
        { label: tr('Toggle Sidebar'), accelerator: 'CmdOrCtrl+B', click: () => send('menu', 'toggle-sidebar') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerIpc() {
  ipcMain.handle('chats:list', () => storage.listChats());
  ipcMain.handle('chats:search', (_e, q) => storage.searchChats(q));
  ipcMain.handle('chats:recall', (_e, q, opts) => storage.recall(q, opts));
  ipcMain.handle('chats:get', (_e, id) => storage.getChat(id));
  ipcMain.handle('chats:create', (_e, init) => storage.createChat(init));
  // The window's copy may be behind a phone's reply this computer is writing
  // into the same chat (src/reply-hub.js): that reply's newer stored copy stays.
  ipcMain.handle('chats:save', async (_e, chat) => {
    const here = await computerId();
    return storage.saveChatOver(chat, (stored, incoming) => Lease.keepNewerReplies(stored, incoming, here));
  });
  ipcMain.handle('chats:delete', (_e, id) => storage.deleteChat(id));

  ipcMain.handle('settings:get', () => storage.getSettings());
  ipcMain.handle('settings:save', async (_e, s) => {
    const saved = await storage.saveSettings(s);
    const was = !!remote;
    if (!!saved.shareWithPhone !== was) await updateRemote();
    keepAwake = saved.shareKeepAwake !== false;
    updateAwake();
    return saved;
  });
  ipcMain.handle('remote:status', () => remoteStatus());
  ipcMain.handle('state:get', () => storage.getState());
  ipcMain.handle('state:save', (_e, patch) => storage.saveState(patch));

  ipcMain.handle('app:info', async () => ({
    version: app.getVersion(),
    deviceId: await computerId(),
    deviceName: computerName(),
    dataDir,
    platform: process.platform,
    appName: APP_NAME,
    icon: '../build/icon.png',
    mobile: false,
    providers: Object.fromEntries(Object.entries(PROVIDERS).map(([k, v]) => [k, v.label]))
  }));
  ipcMain.handle('app:language', (_e, lang) => {
    if (I18n.setLanguage(lang, { doc: null, store: false })) buildMenu();
  });
  ipcMain.handle('app:openDataDir', () => shell.openPath(dataDir));
  // LICENSE / THIRD-PARTY-NOTICES.md for the About page.
  ipcMain.handle('app:legal', (_e, which) => {
    const file = which === 'notices' ? 'THIRD-PARTY-NOTICES.md' : 'LICENSE';
    return fs.readFileSync(path.join(__dirname, file), 'utf8');
  });

  ipcMain.handle('backup:export', async () => {
    const stamp = new Date().toISOString().slice(0, 10);
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: tr('Export all chats'),
      defaultPath: `najwa-ai-backup-${stamp}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (canceled || !filePath) return null;
    const data = await storage.exportAll();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return { filePath, count: data.chats.length };
  });

  ipcMain.handle('backup:import', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: tr('Import chats'),
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (canceled || !filePaths.length) return null;
    let data;
    try {
      data = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
    } catch {
      throw new Error(tr('This file isn\'t a Najwa AI backup (it can\'t be read as one).'));
    }
    return { count: await storage.importAll(data) };
  });

  ipcMain.handle('chat:exportMarkdown', async (_e, id) => {
    const chat = await storage.getChat(id);
    if (!chat) return null;
    const safe = safeFileName(chat.title);
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: tr('Export chat'),
      defaultPath: `${safe}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    });
    if (canceled || !filePath) return null;
    const lines = [`# ${chat.title}`, ''];
    for (const m of chat.messages) {
      // A reasoning model's thinking isn't part of the reply.
      const text = String(m.content || '').replace(/^\s*<think>[\s\S]*?(<\/think>|$)\s*/, '');
      // Pictures stay in the file, as data URLs.
      const pics = (Array.isArray(m.images) ? m.images : []).filter((u) => typeof u === 'string' && u.startsWith('data:image/'));
      lines.push(`## ${m.role === 'user' ? 'You' : 'Assistant'}`, '', ...pics.map((u, i) => `![Picture ${i + 1}](${u})\n`), text, '');
    }
    fs.writeFileSync(filePath, lines.join('\n'));
    return { filePath };
  });

  ipcMain.handle('sync:status', () => sync.status());
  ipcMain.handle('sync:connect', (_e, opts) => sync.connect(opts));
  ipcMain.handle('sync:disconnect', () => sync.disconnect());
  ipcMain.handle('sync:now', () => sync.run());

  ipcMain.handle('ai:models', async (_e, providerId) => {
    const provider = PROVIDERS[providerId];
    if (!provider) throw new Error(`Unknown provider: ${providerId}`);
    const cfg = (await storage.getSettings()).providers[providerId] || {};
    return provider.impl.listModels(cfg);
  });

  // Streams a reply. Deltas are pushed to the renderer as 'ai:event' messages.
  ipcMain.handle('ai:chat', async (_e, req) => {
    const { requestId, provider: providerId } = req;
    if (!PROVIDERS[providerId]) throw new Error(`Unknown provider: ${providerId}`);
    const controller = new AbortController();
    activeRequests.set(requestId, controller);
    // Set by the provider while it can take messages mid-reply (see ai:steer).
    const steering = { send: null };
    activeSteering.set(requestId, steering);
    let release = () => {};
    try {
      // One reply per chat: not while a phone is using this computer's models
      // for it, nor while another device is writing one (see src/lease.js).
      if (req.chatId) {
        const chat = await storage.getChat(String(req.chatId)).catch(() => null);
        const there = Lease.foreignInChat(chat, await computerId());
        if (there) {
          const busy = new Error(`A reply is already being written in this chat (on ${there.owner.name || 'another device'}). Wait for it to finish, or stop it there first.`);
          busy.code = 'busy';
          throw busy;
        }
        release = replies.claim(req.chatId, { source: 'local', deviceId: await computerId(), name: computerName() });
      }
      const result = await runChat(providerId, { ...req, steering }, (text) => send('ai:event', { requestId, type: 'delta', text }), controller.signal,
        (info) => send('ai:event', { requestId, type: 'info', ...info }));
      return { ok: true, ...result };
    } catch (err) {
      if (controller.signal.aborted) return { ok: true, aborted: true };
      return { ok: false, error: err.message || String(err), ...(err.code === 'busy' ? { code: 'busy' } : {}) };
    } finally {
      release();
      activeRequests.delete(requestId);
      activeSteering.delete(requestId);
    }
  });

  // A message sent while a reply is written: true if the model will read it
  // during this reply (Hermes, or a reply using tools); false to send it after.
  ipcMain.handle('ai:steer', async (_e, requestId, text, id) => {
    const s = activeSteering.get(requestId);
    if (!s || !s.send) return false;
    try {
      return !!(await s.send(String(text || ''), id));
    } catch {
      return false;
    }
  });

  // "Read links": a page's text for the model (src/link-reader.js).
  ipcMain.handle('web:read', (_e, url) => readLink(url));

  // Settings → Connectors: "Test" connects and lists the tools.
  ipcMain.handle('connectors:test', (_e, c) => connectors.test(c));

  ipcMain.handle('ai:approve', async (_e, providerId, _model, payload) => answeredHere(payload, await approveOn(providerId, payload)));

  // The agent (Najwa AI Plus): a chat's project folder, and undoing its changes.
  ipcMain.handle('agent:pickFolder', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, { title: 'Choose the project folder', properties: ['openDirectory', 'createDirectory'] });
    if (canceled || !filePaths[0]) return null;
    await rememberProject(filePaths[0]);
    return filePaths[0];
  });
  ipcMain.handle('agent:recent', async () => existingProjects(await storage.getSettings()));
  ipcMain.handle('agent:runs', (_e, chatId) => listRuns(runsDir, String(chatId || '')));
  ipcMain.handle('agent:run', (_e, id) => loadRun(runsDir, id));
  // A run as one web page to share: secrets hidden, like for cloud models.
  ipcMain.handle('agent:exportRun', async (_e, id) => {
    const run = loadRun(runsDir, id);
    if (!run) throw new Error('That run isn\'t there any more.');
    const wall = createFirewall({ cloud: true });
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Save the run as a web page',
      defaultPath: `najwa-run-${run.startedAt.slice(0, 10)}-${run.id.slice(-6)}.html`,
      filters: [{ name: 'Web page', extensions: ['html'] }]
    });
    if (canceled || !filePath) return null;
    fs.writeFileSync(filePath, replayHtml(scrubRun(run, (t) => wall.scrub(t).text)));
    return filePath;
  });
  // Homelab: this computer's Tailscale machines, to add in Settings → Agent.
  ipcMain.handle('agent:tailscale', () => new Promise((resolve) => {
    require('child_process').execFile('tailscale', ['status', '--json'], { timeout: 10000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve({ error: err.code === 'ENOENT' ? 'Tailscale isn\'t installed on this computer.' : 'Tailscale didn\'t answer. Is it running and signed in?' });
      try {
        resolve({ machines: tailscaleMachines(stdout) });
      } catch {
        resolve({ error: 'Tailscale\'s answer couldn\'t be read.' });
      }
    });
  }));
  ipcMain.handle('agent:commands', (_e, root) => listCommands(path.resolve(String(root || '')), [agentDir]).map(({ name, description }) => ({ name, description })));
  ipcMain.handle('agent:checkpoints', (_e, chatId) => checkpoints.list(String(chatId)));
  ipcMain.handle('agent:undo', (_e, chatId, id) => checkpoints.undo(String(chatId), id || null));
  // Undo history that travels with the chat (synced, encrypted on the device).
  ipcMain.handle('agent:exportUndo', (_e, chatId) => checkpoints.exportFor(String(chatId)));
  ipcMain.handle('agent:importUndo', (_e, chatId, packed, root) => checkpoints.importFrom(String(chatId), String(packed || ''), root ? path.resolve(String(root)) : ''));

  // Stop a reply a phone asked this computer for (Stop pressed here, in the chat
  // where the reply shows as "Replying on <phone>"). 0 when this computer isn't writing it.
  ipcMain.handle('ai:stopElsewhere', (_e, chatId) => (remote ? remote.stopChat(String(chatId)) : 0));

  ipcMain.handle('ai:abort', (_e, requestId) => {
    const c = activeRequests.get(requestId);
    if (c) c.abort();
    return !!c;
  });

  ipcMain.handle('voice:status', () => voice.status());
  ipcMain.handle('voice:download', (_e, id) => { voice.download(id); });
  ipcMain.handle('voice:cancelDownload', (_e, id) => voice.cancelDownload(id));
  ipcMain.handle('voice:deleteModel', (_e, id) => voice.deleteModel(id));
  ipcMain.handle('voice:transcribe', (_e, wav, lang, model) => voice.transcribe(Buffer.from(wav), lang, model));
  // macOS asks the user once before an app can use the microphone.
  ipcMain.handle('voice:askMic', () => (process.platform === 'darwin' ? systemPreferences.askForMediaAccess('microphone') : true));
}

app.whenReady().then(async () => {
  storage = await Storage.open(nodeFsBackend(dataDir), { secrets: secrets() });
  // net.fetch uses the system proxy settings, which matters on work networks.
  sync = new Sync({
    storage,
    device: `desktop (${process.platform})`,
    secrets: secrets(),
    fetch: (url, opts) => net.fetch(url, opts),
    googleAuth: googleAuth(),
    onEvent: (evt) => {
      // Data this computer just pushed: the phones watching it sync now.
      if (evt.type === 'pushed') {
        if (replies) replies.announce(evt);
        return;
      }
      send('sync:event', evt);
      // Sync was just set up or removed: start or stop sharing with the phone.
      if (evt.type === 'status' && !remoteError && !!remote !== !!(sync.linkKey() && shareWanted)) updateRemote();
    }
  });
  await sync.load();
  replies = createReplyHub({
    storage,
    name: computerName,
    notify: (chats) => send('sync:event', { type: 'changed', chats, deleted: [], settings: false }),
    syncNow: () => { sync.run().catch(() => {}); },
    // A phone's reply on this computer asks for permission (Hermes, a
    // connector): it shows in this computer's chat too, so say so here, in
    // case the phone has gone away and nobody would see it in time.
    onAsk: (chatId, a) => {
      try {
        if (!Notification.isSupported()) return;
        const n = new Notification({ title: tr(`${a.title ? 'A connector' : 'Hermes'} is asking for permission`), body: String(a.title || a.command || a.description || '').slice(0, 160) });
        n.on('click', () => {
          if (!mainWindow || mainWindow.isDestroyed()) return;
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
          mainWindow.focus();
          send('chat:open', chatId);
        });
        n.show();
      } catch {
        // no notifications here
      }
    }
  });
  voice = createVoice({
    binDir: whisperDir,
    modelsDir: path.join(app.getPath('userData'), 'whisper'),
    fetch: (url, opts) => net.fetch(url, opts),
    onEvent: (evt) => send('voice:event', evt)
  });
  registerIpc();
  buildMenu();
  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  sync.run();
  // Every 20 s while the window is open or a phone is connected (watching), so
  // a reply written on the phone shows up here soon; once a minute otherwise.
  let quietTicks = 0;
  setInterval(() => {
    const active = (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && !mainWindow.isMinimized()) || (!!remote && !!replies && replies.watching() > 0);
    if (active || ++quietTicks >= 3) {
      quietTicks = 0;
      sync.run();
    }
  }, 20 * 1000);

  // Share with the phone if turned on; keep the published addresses current
  // (Wi-Fi changes, laptop moves between networks).
  await updateRemote();
  setInterval(() => {
    if (remote) updateRemote();
  }, 60 * 1000);
});

// Write the chats the window is still waiting to save, then push the last
// changes before quitting, so they're on the phone right away.
app.on('before-quit', (e) => {
  if (quitPrepared) return;
  e.preventDefault();
  quitPrepared = true;
  (async () => {
    await flushWindowSaves();
    if (sync && sync.pending()) await Promise.race([sync.run(), new Promise((r) => setTimeout(r, 8000))]);
  })().catch(() => {}).finally(() => app.quit());
});

app.on('will-quit', () => {
  agentJobs.stopAll();
  if (voice) voice.stop();
});

app.on('window-all-closed', () => {
  for (const c of activeRequests.values()) c.abort();
  if (process.platform !== 'darwin') app.quit();
});
