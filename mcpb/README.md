# qa-probe as a Claude desktop extension

A desktop extension (`.mcpb`) lets someone install qa-probe in Claude Desktop with a few clicks and no
command line. It runs locally on their machine, which is what qa-probe needs because it reads their
project files.

## Build

```bash
npm ci
node scripts/build-mcpb.js        # writes dist-mcpb/qa-probe-<version>.mcpb
```

No extra tools are needed. The script stages `bin/`, `src/` (without tests), the production
dependencies and a `manifest.json` made from `mcpb/manifest.template.json`, then zips them.

## What the user is asked for when they install it

| Setting | Purpose |
|---|---|
| Project folder | The web app qa-probe should check. The extension starts qa-probe inside this folder. |
| Config file | Name of the qa-probe config inside that folder (default `qa-probe.config.js`). |
| Test account username / password (optional) | A dedicated low-privilege account. Handed to the config as `QA_PROBE_USER` and `QA_PROBE_PASS`. The password is marked sensitive, so Claude Desktop stores it in the system keychain. |

The user needs a `qa-probe.config.js` in their project; the README explains how to create one and
`qa-probe doctor` checks it.

## Before submitting (checklist)

- [ ] The manifest has been validated with Anthropic's own validator (`mcpb validate`), not only by
      this repository's tests. **Not done yet**: the manifest here follows the published format from
      memory of the spec and has been smoke-tested by unpacking the bundle and starting it with the
      manifest's own arguments (10 tools listed, matching the manifest), but it has not been checked
      against the official schema.
- [ ] Installed in Claude Desktop on a paid plan and run end to end against a real project.
- [ ] Each tool has a short, accurate description, and the tool annotations (read-only or not) match
      behaviour. No tool edits source files or sends writes to the backend. The analysis and label
      tools write only inside the project's `.qaprobe` folder (cache, reports, feedback).
- [ ] A privacy statement: qa-probe sends no data anywhere except HTTP requests to the backend URL the
      user configures; stack traces and SQL are redacted from what Claude sees.
- [ ] Support contact and repository links in the manifest are correct.
- [ ] Submit through the directory portal in a Claude.ai account that can publish
      (`claude.ai/directory/manage`), following the current submission guide. Listing is at
      Anthropic's discretion; there is no guarantee and no review date.

## Not covered by this extension

Anthropic's directory and OpenAI's ChatGPT/Codex directory list **remote** servers (a public HTTPS
endpoint). qa-probe is local by design, so it is not offered there. Codex, Cursor and Claude Code can
already use it with a local MCP entry (see the main README).
