---
name: verify-change
description: Use after editing code in a web app that has a qa-probe config, to check that the running system still works. Maps the changed files to the pages and API endpoints they affect, probes those endpoints live, and reports pass, fail or inconclusive with evidence.
---

# Verify a change with qa-probe

Use this after you edit frontend or backend code in a project that has a `qa-probe.config.js`.

1. Call the `qa_probe_verify_change` tool with the files you changed, relative to the project root.
2. Read the result honestly:
   - **pass**: at least one affected endpoint was verified healthy and none is broken. Check
     `notChecked` for what was not exercised (writes are never exercised).
   - **fail**: something probed live is broken. Report the endpoint, the status and the `fixHint`,
     and fix it before saying the change works.
   - **inconclusive**: nothing affected could be verified. Do not claim success. Say what could not
     be checked, then try `all: true` or ask the user.
3. If the project has not been analysed yet, ask the user to run `npx qa-probe run` once, or call
   `qa_probe_run_analysis`.
4. Use `qa_probe_get_claims` to see which page-to-endpoint relationships are only guessed from
   source (`static-only`) and which were seen in real traffic (`runtime-observed`).

qa-probe never changes data or edits source files. If the user has not configured a test account,
do not guess credentials.
