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

Tests: `test/agent.test.js` (12) and the rest of the suite (`npm test`, 295 pass).
End to end in the real Electron app with a scripted model: `scripts/agent-e2e/`
(`node scripts/agent-e2e/fake-model.js &` then `xvfb-run -a node scripts/agent-e2e/run.js`,
`REVIEW=1` adds the second opinion).

With a real model, without the window: `scripts/agent-real/run.js` runs the same
tool loop, tools, permissions, firewall and checkpoints on ten small projects
(fix a bug, add a feature, rename around a secret, plan mode, a "no", a question,
a refactor, a background server, a prompt injection, copying a file with a secret)
and checks each result. Approvals are answered by the script; steps go to
`$AGENT_REAL_DIR/<task>.json`. For example, DeepSeek:
`MODEL_URL=https://api.deepseek.com MODEL=deepseek-flash MODEL_KEY=… node scripts/agent-real/run.js`
(`KIND=ollama MODEL_URL=http://127.0.0.1:11434 MODEL=qwen3:4b` for Ollama, `REVIEWER=<model>` adds the second opinion).
First results (Nov 2026): DeepSeek V4.1 Flash and V4 Pro pass all ten, with the second opinion on.
Found and fixed on the way: verdicts from thinking models were lost when their
reasoning held a brace; the prompt now says not to pipe commands through head/tail.

Plus has its own name, app ID (`com.bandaraltariqi.najwa.plus`) and data folder
("Najwa AI Plus"), so it installs beside Najwa AI, on the desktop and on phones.
The Google Play, iOS and model-link workflows were removed: Plus must never upload
to Najwa AI's store listings (`test/plus-identity.test.js` checks the app IDs and
that no workflow uploads to a store).

**The Plus phone app** is separate from Najwa AI's. Its app ID and name are Plus's
(`capacitor.config.json`, `android/app/build.gradle` applicationId, strings.xml,
the Xcode project); the Java package stays `com.bandaraltariqi.najwa` because the
native engine's JNI names use it. The **Android app (Plus)** workflow builds the
APK and attaches it to the run only (no release, no Play). Google sign-in (Drive
sync) on the phone needs an Android OAuth client for `com.bandaraltariqi.najwa.plus`
with the SHA-1 the workflow prints (Google Cloud, same project).

Agent in your pocket, on the phone (shared screens, `renderer/app.js`): choose a
computer's project folder (📁 Project lists each computer's recent folders), the
agent runs there and the phone shows its steps, to-do list and approval cards with
coloured diffs; ⋯ → Undo works through the computer. A reply keeps going in the
background (a foreground service). When the agent asks while the chat isn't on
screen, Android shows a notification that opens the chat (`AgentAlerts.java`,
`NetPlugin.agentAsks`). Not yet tried on a real phone.

## What's next

1. **Agent in your pocket:** try it on a real phone with a computer. Still to do:
   the iPhone (no build workflow; notifications), and true push (a notification
   when the app was swiped away, which needs a push service).
2. More real models: DeepSeek done (see above). Still to try: small local ones
   (Ollama qwen3/llama3.1, where most failures will be), Claude, OpenAI; and harder,
   longer tasks.
3. Phase 3, the other unique ideas:
   - 🏠 Homelab agent: Tailscale machines, SSH and Docker with per-machine permissions, one task across servers
   - 👥 Mixed crew: a big model plans, small local models work; "local only" switch
   - 💰 Budget guard: spending cap per task, live tokens and cost
   - 🎙️ Voice + Arabic: talk to the agent (local Whisper), progress read back, RTL-friendly diffs
   - 🎬 Run replay: every run as a timeline to replay or share
   - ⏪ Checkpoints synced encrypted across devices (undo from the phone already works through the computer)
4. Standard harness extras: helper agents (sub-agents), hooks, slash commands/skills, Git tools, headless CLI.

## Rules for working on it

- Commit as `Bandar Altariqi <317137347+bandar9994@users.noreply.github.com>`; no Claude/AI credits or model names in commits.
- Keep every source file's license header. Never commit keys or secrets.
- Approvals for risky actions are never automatic (harm checks always ask).
- Run `npm test` before every push; for UI changes, check it in the real app.
- Push to `main` here when tests pass (the owner asked for direct merges). Ask before anything public.
- Write UI text in plain, short English (the app also has Arabic via `renderer/i18n-ar.js`).
