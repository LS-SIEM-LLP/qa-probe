# qa-probe for Claude

qa-probe checks that your running web app still works after a change. It reads your frontend source,
maps every page to the API endpoints it calls, probes those endpoints live with your test account, and
tells Claude the root cause when something is wrong. This plugin adds a skill so that, after Claude
edits code, it runs `qa-probe verify` and gets a pass, fail or inconclusive answer with evidence.

## What you need

- Node.js 18 or newer.
- A `qa-probe.config.js` in your project (see the
  [main README](https://github.com/LS-SIEM-LLP/qa-probe#readme)). Run `npx qa-probe doctor` to check it.
- A backend you can reach, and a dedicated low-privilege test account. Never use a personal or admin
  account.

## What it adds

- **Skill** `verify-change`. After Claude edits code, it runs the qa-probe command line
  (`npx qa-probe@2.14.0 verify`), which maps the changed files to the pages and endpoints they affect,
  probes those endpoints live, and reports pass, fail or inconclusive with evidence. The skill also tells
  Claude how to read the result honestly.

The plugin contains no server of its own. If you also want qa-probe's tools inside Claude (explain a
failure, list what each page depends on, probe one endpoint), you can add the MCP server yourself:
`claude mcp add qa-probe -- npx -y qa-probe@2.14.0 mcp`. That is optional and separate from this plugin.

## What it does and does not do

It reads your project files and sends HTTP requests to the backend address in your config. It never
changes your data (write endpoints are not exercised) and never edits your source files. It checks that
endpoints respond healthily; it does not check that a page renders them correctly.

## Privacy Policy

- **Data collected:** none by us. qa-probe has no telemetry, account or server of its own.
- **Usage and storage:** it reads responses from the backend you configure and writes its cache, reports,
  feedback you record, and a short snapshot (up to about 800 characters) of each probed response to a
  `.qaprobe` folder inside your project, on your machine. If your backend returns personal data
  (names, emails), a snapshot can contain some of it, so point qa-probe at a test environment with a
  test account and test data. Stack traces, SQL and table names are redacted before anything is
  shown to Claude. Delete the folder to remove everything it stored.
- **Third-party sharing:** none. The only network traffic is requests to the backend URL you configure
  (and, if you ask for runtime tracing, to your own frontend), plus the one-time download of the
  `qa-probe` package from the npm registry the first time Claude runs the command. The login details in your config are
  sent only to the login address of the backend you configure.
- **Retention:** nothing is kept outside your machine. Files in `.qaprobe` stay until you delete them.
- **Contact:** [github.com/LS-SIEM-LLP/qa-probe/issues](https://github.com/LS-SIEM-LLP/qa-probe/issues)

Credentials live in your config or environment; they are never stored by this plugin.

## License

Apache-2.0. See `LICENSE`.
