---
name: modern-web-guidance
description: Current best practices for web UI work (HTML, CSS, browser JavaScript): dialogs, popovers, forms, layout, animation, dark mode, accessibility, performance, security. Use it first for any web front-end task, before writing code. Not for backend, scripts or tooling.
---

# Modern Web Guidance

Expert-written guides to today's web platform, from the Chrome, Edge, Firefox and MDN teams and the web community (see NOTICE.md). Models often fall back on old patterns from their training data; these guides show the modern, native way, with sensible fallbacks.

Use them at the **start** of building or changing any web UI, CSS layout or animation, or browser-side JavaScript (dates and time zones, sanitising HTML, performance, accessibility, UX fixes), before writing your own solution or adding a library.

The guides come with Najwa AI Plus and work offline. Look them up with the `web_guide` tool.

## How to use it

### 1. Search

`web_guide` with `action: "search"` and a **2–5 word query** about **one** web capability or UI pattern:

- Describe what the user sees: a verb and a UI or platform object, plus the HTML/CSS/JS feature name if you know it. Leave out framework and library names (React, Vue, Tailwind…) and the app's own names. Split a task with several features into several searches.
- Name the UI piece the request implies: "delete with confirmation" → search `confirmation dialog`; "pick a date" → `date picker input`.
- Good: `light dismiss dialog`, `responsive data table`. Too vague: `dialog`. Too much at once: `responsive table dark mode` (two searches).

Judge the results by their summaries. If nothing fits, rephrase once with the plain component name or a synonym (`dialog`, `modal`, `popover`, `table`, `form`). If still nothing fits, the topic isn't covered: go on without a guide.

### 2. Read

`web_guide` with `action: "read"` and the guide's `id`. Read the specific guides that match, and the broader one for the area when it applies (`html`, `css`, `forms`, `accessibility`, `color`, `performance`, `security`).

### 3. Check your work against the guide

- The modern pattern and any fallback the guide asks for are in place, without adding features nobody asked for.
- The user's request is fully done.

### 4. Say which guides you used

When the guides shaped your code, end your summary with a short **Modern Web Guidance** note: one line per guide id you applied, saying which non-obvious choice or fallback it led to and the pitfall it avoided. If you searched but no guide applied, say in one sentence what you checked. Never name a guide you didn't read in this task.

## Modernising an existing project

Only when asked for a broad, open-ended modernisation with no specific feature named: search the project for old patterns (heavy JavaScript where CSS or HTML now does the job, polyfills for features every browser has, hand-made dialogs, tooltips or carousels), read the matching guides, report what you found and, if asked to change the code, update it one guide at a time and keep any fallback the guide asks for.

## Guidelines

- Search first. Don't make guides up or ignore them: they are the preferred standard for this project.
- The guides use plain HTML, CSS and JavaScript. Adapt them to the project's framework without dropping the modern feature:
  - **Types**: spread or cast newly shipped HTML attributes (`{...({ popover: 'hint', interestfor: id, commandfor: id, switch: '' } as any)}`, `[attr.*]`) rather than removing them.
  - **SSR and bundlers**: guard `window`/`HTMLElement` during server rendering, and load polyfills with a bare `import('<pkg>')` in client code. Never copy files out of `node_modules`.
  - **DOM, IDs and CSS**: call `showModal()`/`moveBefore()` through refs on nodes the framework doesn't re-render, generate per-instance IDs and `anchor-name`s, and keep `:root` and `@starting-style` rules top-level.

## Browser support and fallbacks

- **By default**, features that are *Baseline widely available* are safe without fallbacks. For anything newer, follow the guide's fallback advice, unless the user has set their own browser support policy.
- **The user's own policy** wins: use the guide's compatibility data to decide whether a fallback can go (for a "Baseline YYYY" target, a feature qualifies if its "Baseline since" year is YYYY or earlier).
- **Electron and similar apps** run one known browser engine. If the project targets one (Electron, Tauri, a WebView), or the user worries about fallback size, suggest writing a policy in `NAJWA.md`, `AGENTS.md` or `CLAUDE.md`, for example: "**Browser support:** Allow newly available features; only add fallback code under 20 lines with no new dependencies."
