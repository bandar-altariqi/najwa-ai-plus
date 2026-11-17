---
name: verify
description: Check a change to Najwa AI Plus before calling it done or pushing it. Runs the tests, a secrets check, and for interface changes the app in a real browser with screenshots to look at. Use it after every change, before every commit and push.
---

# Verify a change

Work isn't done until it's checked. Run the checks, read what they say, and
report it as it is.

## 1. Run the checks

```bash
npm run verify            # what changed since origin/main, plus uncommitted work
npm run verify -- --all   # everything
```

It picks the checks that fit what changed (`scripts/verify.js`):

| Changed | Checked |
|---|---|
| anything | `npm test`, and no key-shaped text (API keys, tokens, private keys) in the change |
| `.github/workflows/` | every workflow file still parses |
| `renderer/`, `src/lease.js`, `mobile/`, the phone build | the phone build, the interface in Chromium (`scripts/ui-check/run.js`: windows, the ⋯ menu, tabs, toasts, the message box, phone layout, Arabic) and screenshots (`scripts/ui-check/shots.js`) |

The browser checks need Playwright with Chromium. Where it's missing they're
skipped, and the summary says so: say that in your report too, never "passed".

## 2. Look at the screenshots (interface changes)

They're in `$UI_CHECK_DIR` (default `<tmp>/najwa-ui-check`), named
`verify-<view>.png`: welcome, welcome-dark, chat, chat-dark, phone, settings,
arabic, hover. Open the ones your change touches and look:

- light and dark both right (text readable, nothing left in the other theme's colours)
- the phone layout: nothing cut off, nothing wider than the screen
- Arabic: mirrored (sidebar on the right, your bubble on the left), Arabic text in Readex Pro
- nothing overlapping, nothing that moved by accident

## 3. Check what the tests can't

- **The agent** (`src/agent/`, `src/tool-chat.js`): when a model key is available,
  run the real-model task that covers the change, for example
  `node scripts/agent-real/run.js fix-bug` (see `docs/PLUS.md` for the
  settings). It costs a little money: run only the tasks that matter.
- **The desktop app or the phone apps** can't be run here: say which part you
  couldn't check on a real device.

## 4. When a check fails

Fix the cause, not the check: never skip, weaken or delete a test to get green.
Run `npm run verify` again. If the same check still fails after three tries,
stop and tell the person what fails, with the output, and what you tried.

## 5. Report

Say what you checked and how it went, in plain words: what passed, what was
skipped and why, what you looked at in the screenshots, and anything you
couldn't check. Then commit and push as `docs/PLUS.md` says (as Bandar
Altariqi, no Claude or model names in commits, never secrets).
