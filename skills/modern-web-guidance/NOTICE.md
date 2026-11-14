# Modern Web Guidance in Najwa AI Plus

The guides in `guides/` are from **Modern Web Guidance**
(https://github.com/GoogleChrome/modern-web-guidance), stewarded by the Google
Chrome, Microsoft Edge, Mozilla Firefox and MDN teams with the web development
community. They are licensed under the Apache License 2.0 (see `LICENSE` in
this folder).

Copied from commit `4dd968349e54ca45a05dd5c818fb035c9054b022` (2026-11-10).

Changes made for Najwa AI Plus:
- `guides/` is unchanged.
- `SKILL.md` is rewritten: the original runs the `modern-web-guidance` command
  with `npx`, which needs Node.js and the internet. In Najwa AI Plus the agent
  searches and reads the bundled guides with its `web_guide` tool, offline.
  The workflow, guidelines and browser-support advice follow the original.

To update the guides: copy `skills/modern-web-guidance/guides/` from a newer
commit of the repository over this folder's `guides/`, update the commit
above, and run `npm test`.
