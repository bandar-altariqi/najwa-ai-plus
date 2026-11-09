# Najwa AI Plus: plan and handover

Najwa AI Plus is Najwa AI (github.com/bandar9994/najwa-ai) with a full agent
harness. Same author (Bandar Altariqi), same Najwa AI License. This repository
(bandar-altariqi/najwa-ai-plus) is private.

## What's built (phase 1)

A chat can have a **project folder** (📁 Project in the top bar) and a **mode**;
its replies then run as an agent there, on the desktop app.

| Part | Where |
|---|---|
| Tools: list_files, read_file, find_files, search_files, write_file, edit_file, run_command (+ background), command_output, stop_command, todo_write | `src/agent/tools.js` |
| Project folder guard (links included), globs, folder walk | `src/agent/paths.js` |
| Modes ask / edits / plan / auto, "always allow" rules, harm checks (always ask) | `src/agent/permissions.js` |
| Checkpoints and undo, per chat, newest 40 | `src/agent/checkpoints.js` |
| **Privacy firewall**: secrets → «secret-N» for cloud models, restored on write; private files local-only | `src/agent/firewall.js` |
| **Second opinion**: another model's verdict on each change/command; concerns force a question | `src/agent/reviewer.js` |
| **Dry run**: commands that change files run in a copy; card shows the diff; Allow applies (not re-run) | `src/agent/dryrun.js` |
| Diffs (Myers) | `src/agent/diff.js` |
| Commands with time limits, process-tree kill, background jobs | `src/agent/shell.js` |
| System prompt, NAJWA.md / AGENTS.md / CLAUDE.md | `src/agent/instructions.js` |
| Tool loop: more steps for agents (150), older results shortened (`compactResults`) | `src/tool-chat.js` |
| Wiring: `agentToolset()` in `runChat`, IPC `agent:*`, remote ops `agentProjects/agentCheckpoints/agentUndo` | `main.js`, `preload.js`, `src/remote.js`, `mobile/src/bridge.js` |
| UI: project button and dialog, coloured diffs on approval cards, to-do list, ⋯ → Undo, Settings → Agent | `renderer/app.js`, `renderer/styles.css`, `renderer/index.html` |
| Settings (`settings.agent`, this computer only): dryRun, firewall, privateFiles, rules, reviewer, defaultMode, recent | `src/storage.js` |

## What's built since (Nov 2026)

| Part | Where |
|---|---|
| 💰 **Budget guard**: each step's tokens (OpenAI-style `stream_options`, Claude, Ollama), live tokens and cost on the reply, a cap per task in dollars and/or tokens (Settings → Agent; prices are the user's, none guessed); at the cap a card asks Keep going / Stop | `src/agent/budget.js`, `src/tool-chat.js` |
| 🌿 **Git tools**: git_status, git_diff, git_log (look, every mode); git_commit (asked like a command, card shows message and files, never pushes). git runs with an argument list, never a shell; private files left out | `src/agent/git.js` |
| **Slash commands**: `/name args` → `.najwa/commands/name.md` (or `.claude/commands/`, or `<data>/agent/commands`), `$ARGUMENTS`/`$1`; built in `/review`, `/init`; typing `/` lists them | `src/agent/commands.js`, `main.js` (runChat) |
| 🧩 **Skills**: `SKILL.md` folders (`.najwa/skills`, `.claude/skills`, the app's); the prompt lists name + description, `use_skill` loads the rest | `src/agent/commands.js` |
| 🪝 **Hooks**: `.najwa/hooks.json` before/after commands around tools (a failing before hook stops the tool; after output goes to the model). Never automatic: the exact commands are shown first; Always trusts that fingerprint, any change asks again | `src/agent/hooks.js` |
| 🤝 **Helper agents**: `ask_helper` → same (or the crew's) model, fresh context, only the tools that look; steps shown, tokens in the same budget; several in one step run in parallel (`tools.parallel` in the tool loop) | `src/agent/helpers.js`, `src/tool-chat.js` |
| 👥 **Mixed crew** (Helpers use: another model) and **Local only** (project chats, helpers and second opinion stay local; a local project never gets a cloud helper: `chooseHelper`) | `src/agent/helpers.js`, `main.js` |
| 🏠 **Homelab**: Settings → Agent → Machines (`name = user@host : look\|ask\|auto`, Find Tailscale machines); `list_machines`, `run_on_machine` over ssh (keys only, BatchMode); commands that look always run, risky ones (deleting containers/volumes, compose down, zfs destroy, sudo…) asked on every machine | `src/agent/homelab.js` |
| 🎬 **Run replay**: every agent reply recorded (`<data>/agent-runs`, newest 300); ⋯ → Replay the agent's runs (Play, slider); Save as a web page (one file, secrets hidden) | `src/agent/replay.js`, `renderer/app.js` |
| 🎙️ **Voice + Arabic**: Arabic for the agent's screens; a diff line's text keeps its own direction (`<bdi>`); with Read replies aloud, the agent's questions and finished to-do steps are said | `renderer/i18n-ar.js`, `renderer/app.js` |
| ⏪ **Undo travels with the chat**: newest 10 changes (≤ 256 KB, gzip) in `chat.agentUndo`, synced encrypted with the chat; a computer with no history of its own undoes in its own project folder (paths checked inside the project) | `src/agent/checkpoints.js` (`exportFor`, `importFrom`) |
| ⌨️ **najwa-agent**: the agent from a terminal (`node bin/najwa-agent.js --help`; `npm link` for `najwa-agent`). In a terminal questions are asked there; in a script all are refused unless `--yes`, which never allows risky ones, hooks or the budget question. `--json` for scripts | `bin/najwa-agent.js` |
| 📱 **Phone notifications**: Android (`AgentAlerts.java`, `NetPlugin.agentAsks`) and iPhone (`NetPlugin.swift`); tap opens the chat. **Allow / Deny on the notification** (Allow needs the phone unlocked; a risky question or the budget gets only Deny, and the screens refuse an Allow the card doesn't offer for the chat) | `AgentAnswerReceiver.java`, `renderer/app.js` (`answerFromNotification`) |
| 💬 **Steer from the phone**: a message sent mid-task goes to the agent on the computer (a `steer` request over the private link, by the reply's job), read after its current step; if it can't take one yet it waits, never interrupts | `src/remote.js`, `main.js` (`remoteSteering`), `renderer/app.js` (`midReplyAction`) |
| 🛡️ **Privacy meter**: under the agent's steps, what went to the cloud (or that nothing left), secrets hidden, private files kept back; tap for each model (agent, helpers, workers, second opinion) and how much project text it got | `src/agent/meter.js` |
| 👷 **Workers** (mixed crew that does the work): `delegate_work` hands a defined change to the crew's model with every tool but handing on, under the agent's own mode, questions, checkpoints, budget and firewall | `src/agent/helpers.js` (`workerView`) |
| 🗜️ **Compaction**: a long agent chat's older messages go to the model as a summary (kept per chat, extended as it grows); the newest six word for word; the chat keeps everything | `src/agent/compact.js` |

Tests: `npm test` (318 pass), including `test/{budget,git-tools,commands,hooks,helpers,homelab,replay,checkpoint-sync,cli,plus-identity}.test.js`.

End to end in the real Electron app with a scripted model: `scripts/agent-e2e/`
(`node scripts/agent-e2e/fake-model.js &` then `xvfb-run -a node scripts/agent-e2e/run.js`,
`REVIEW=1` adds the second opinion).

**With a real model**, without the window: `scripts/agent-real/run.js` runs the
same tool loop and tools on 17 small checked projects (fix a bug, a feature, a
rename around a secret, plan mode, a "no", a question, a refactor, a background
server, a prompt injection, a to-do app across files, two bugs, fix-and-commit,
a skill via a slash command, a hook, helpers, the budget stop, copying a file
with a secret, a mixed crew). Steps go to `$AGENT_REAL_DIR/<task>.json` and a replay page to
`<task>.html`. DeepSeek, for example:
`NODE_USE_ENV_PROXY=1 MODEL_URL=https://api.deepseek.com MODEL=deepseek-flash MODEL_KEY=… node scripts/agent-real/run.js`
(`KIND=ollama MODEL_URL=http://127.0.0.1:11434 MODEL=qwen3:4b` for Ollama,
`REVIEWER=<model>` adds the second opinion, `PRICES="deepseek-* = 0.1 / 0.4"` shows cost).
Results (Nov 2026): DeepSeek V4.1 Flash passes all of them with the second
opinion on (about $0.04 for the whole run at that price); V4 Pro passed the
first ten; the crew task runs V4 Pro planning with V4.1 Flash as the worker
(`CREW_MODEL=deepseek-flash`). A 68,551-character conversation compacted to
1,492 characters with all ten key facts kept.
Fixed from these runs: secrets after read_file's line numbers and
search_files' "path:line:" weren't hidden unless they looked like a known key
(`test/firewall-lines.test.js`).
Fixed from the runs: second-opinion verdicts from thinking models were lost when
their reasoning held a brace; the prompt says not to pipe commands through
head/tail, and to keep a to-do list for tasks of three or more steps.

Plus has its own name, app ID (`com.bandaraltariqi.najwa.plus`) and data folder
("Najwa AI Plus"), so it installs beside Najwa AI, on the desktop and on phones.
The Google Play, TestFlight and model-link workflows were removed: Plus must never
upload to Najwa AI's store listings (`test/plus-identity.test.js` checks the app
IDs and that no workflow uploads to a store).

**The Plus phone app** is separate from Najwa AI's. Its app ID and name are Plus's
(`capacitor.config.json`, `android/app/build.gradle` applicationId, strings.xml,
the Xcode project); the Java package stays `com.bandaraltariqi.najwa` because the
native engine's JNI names use it. The **Android app (Plus)** workflow builds the
APK on every push to main and attaches it to the run only (no release, no Play);
a newer push replaces a build still running. The **iPhone app (Plus)** workflow
is run by hand (macOS minutes count ten times on a private repository) and
attaches an unsigned .ipa. Google sign-in (Drive sync) on the phone needs an
Android OAuth client for `com.bandaraltariqi.najwa.plus` with the SHA-1 the
Android workflow prints (Google Cloud, same project).

Agent in your pocket, on the phone (shared screens, `renderer/app.js`): choose a
computer's project folder (📁 Project lists each computer's recent folders), the
agent runs there and the phone shows its steps, to-do list, cost and approval
cards with coloured diffs; ⋯ → Undo works through the computer. A reply keeps
going in the background (a foreground service on Android). When the agent asks
while the chat isn't on screen, the phone shows a notification that opens the
chat. Not yet tried on a real phone.

## What's next

1. **Try it on real devices**: the Plus phone app with a computer (Android APK
   from the workflow's run; the iPhone build is unsigned and its Swift hasn't
   been compiled yet: run the iPhone workflow once), the desktop app with the
   new screens (budget line, replays, Settings → Agent), homelab over real SSH
   (there was no ssh in the cloud container), and `najwa-agent` on a computer.
2. **Small local models** (Ollama qwen3/llama3.1) with `scripts/agent-real`:
   where most failures will be; then Claude and OpenAI.
3. **True push**: a notification when the phone app was swiped away needs a push
   service (Firebase or similar, set up by the owner); today notifications (and
   their Allow / Deny) work while the app is in the background with a reply running.
4. Ideas from building this: helpers on several machines at once (homelab +
   helpers), a replay viewer on the phone, prices fetched from providers that
   publish them.

## Rules for working on it

- Commit as `Bandar Altariqi <317137347+bandar9994@users.noreply.github.com>`; no Claude/AI credits or model names in commits.
- Keep every source file's license header. Never commit keys or secrets.
- Approvals for risky actions are never automatic (harm checks always ask).
- Run `npm test` before every push; for UI changes, check it in the real app.
- Push to `main` here when tests pass (the owner asked for direct merges). Ask before anything public.
- Write UI text in plain, short English (the app also has Arabic via `renderer/i18n-ar.js`).
