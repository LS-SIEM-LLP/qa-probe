---
name: verify-change
description: Use after editing code in a web app that has a qa-probe config, to check that the running system still works. Runs the qa-probe command line, which maps the changed files to the pages and API endpoints they affect, probes those endpoints live, and reports pass, fail or inconclusive with evidence.
---

# Verify a change with qa-probe

Use this after you edit frontend or backend code in a project that has a `qa-probe.config.js`
(or after the user asks whether the running app still works).

## Run it

From the project root, with the files you changed (comma separated, relative to the project root):

```bash
npx -y qa-probe@2.14.0 verify --files path/one.tsx,path/two.py --json
```

- Leave out `--files` to use the files changed in git.
- Add `--all` to probe every known endpoint.
- Add `--strict` when "inconclusive" should count as a failure (for example in CI).
- If it says there is no graph yet, run `npx -y qa-probe@2.14.0 analyze` once, or `npx -y qa-probe@2.14.0 run`.
- To check the setup first: `npx -y qa-probe@2.14.0 doctor`.

qa-probe needs a config file and a backend it can reach. If the project has no `qa-probe.config.js`,
tell the user and point them to https://github.com/LS-SIEM-LLP/qa-probe#readme. Never guess or invent
credentials; the test account belongs in the project's own config or environment.

## Read the result honestly

The JSON has `verdict`, `confidence`, `endpoints`, `notChecked` and `summary`.

- **pass**: at least one affected endpoint was verified healthy and none is broken. Look at
  `notChecked` for what was not exercised (write endpoints are never exercised).
- **fail**: something probed live is broken. Report the endpoint, its status and `fixHint`, and fix it
  before saying the change works. The command also exits with a non-zero code.
- **inconclusive**: nothing affected could be verified. Do not claim success. Say what could not be
  checked, then try `--all` or ask the user.

A 200 response with no data, a 401 or 403 for the test account, and long-lived streams are reported as
not verified, never as failures. Files that map to no page or endpoint are listed in `notChecked`
instead of being guessed at.

qa-probe never changes data and never edits source files.
