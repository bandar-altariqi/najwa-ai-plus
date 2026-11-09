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
`REVIEW=1` adds the second opinion). Not yet tried with a real model.

Plus has its own name, app ID (`com.bandaraltariqi.najwa.plus`) and data folder
("Najwa AI Plus"), so it installs beside Najwa AI. The phone, Google Play and
model-link workflows were removed: Plus must never upload to Najwa AI's Play listing.

## What's next

1. **Agent in your pocket, finished:** a Plus phone app (own app ID) or the phone
   side in the regular Najwa AI app. Coloured diffs on the phone, starting work in
   a computer's folder, push notifications when the agent asks.
2. Try it with real models (Ollama qwen3/llama3.1, Claude, OpenAI) and tune the prompt.
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
