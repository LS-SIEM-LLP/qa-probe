# qa-probe

**Local QA agent for AI-built apps.** Maps frontend routes to backend API calls, probes every endpoint live, scores pages 0–100, and explains exactly why data is missing — without a QA team.

Works with FastAPI, Express, Next.js, or any app that exposes an OpenAPI spec.

```
  Overall score: 74/100

  Root causes:
    empty_db:             5 route(s)
    feature_flag_disabled: 3 route(s)
    missing_route:        1 route(s)

  ┌─────────────────────────────────┬────────┬────────────┬────────────────────────┐
  │ Route                           │ Score  │ Status     │ Root Cause             │
  ├─────────────────────────────────┼────────┼────────────┼────────────────────────┤
  │ /rules                          │ 100    │ ✓ healthy  │                        │
  │ /alerts                         │ 80     │ ✓ healthy  │                        │
  │ /malware-detection              │ 85     │ ✓ healthy  │                        │
  │ /feedback-coordinator           │ 50     │ ⚠ degraded │ empty db               │
  │ /nta                            │ 0      │ ✗ broken   │ feature flag disabled  │
  └─────────────────────────────────┴────────┴────────────┴────────────────────────┘
```

---

## What it does

| Capability | Detail |
|---|---|
| Frontend parsing | Babel AST extracts all `api.get()`, `useApiData()`, `useApiQuery()` calls |
| Backend spec | OpenAPI 3.0 (FastAPI, Express, generic) via `/openapi.json` |
| Feature flag detection | FastAPI `/health/features` endpoint |
| Live HTTP probing | Authenticated, concurrent, HTTPS with self-signed cert support |
| SSE verification | Connects to event-stream endpoints, waits for first event |
| WebSocket verification | Upgrade handshake + first frame check |
| Schema validation | Checks response fields against OpenAPI response model |
| Root cause analysis | 9 categories, first-match priority, cluster pass for mass failures |
| Regression detection | Diffs current run against history |
| Blast radius | Shows how many pages break when an endpoint fails |
| Headless mode | Works without OpenAPI — probes frontend-discovered URLs directly |
| MCP server | 7 tools for Claude, Codex, or any MCP-compatible assistant |

## What it does NOT do

- CSS regressions (use visual testing like Percy)
- React component errors (use Playwright/Cypress)
- Performance load testing (use k6/Locust)
- Write-path verification (mutations are skipped unless in `safePosts`)
- Auth flow testing (Playwright handles login flows)

---

## Quickstart — LightShield-SIEM

```bash
# From repo root
cp qa-probe/examples/lightshield-siem/qa-probe.config.js ./qa-probe.config.js
cd qa-probe && npm install && cd ..

# Run everything in one shot
node qa-probe/bin/qa-probe.js run

# Or step by step
node qa-probe/bin/qa-probe.js analyze   # writes .qaprobe/graph.json
node qa-probe/bin/qa-probe.js probe     # writes .qaprobe/probe-results.json
node qa-probe/bin/qa-probe.js report    # writes report.md, report.json, ai-context.md

# CI gate: fail if score drops below 80
node qa-probe/bin/qa-probe.js run --fail-under 80
```

## Quickstart — Any app

```bash
cd your-project
npm install --prefix ./qa-probe qa-probe   # or clone this repo

# Create config
cat > qa-probe.config.js << 'EOF'
module.exports = {
  baseUrl: 'http://localhost:8000',
  frontendSrc: './frontend/src',
  routerFile: './frontend/src/App.tsx',
  auth: {
    type: 'bearer',
    loginUrl: '/auth/login',
    credentials: { username: 'testuser', password: 'testpass' },
    tokenPath: 'access_token',
  },
};
EOF

node qa-probe/bin/qa-probe.js run
```

---

## CLI Commands

| Command | What it does |
|---|---|
| `qa-probe analyze` | Parse frontend + fetch backend spec → `.qaprobe/graph.json` |
| `qa-probe probe` | Authenticate + hit every endpoint → `.qaprobe/probe-results.json` |
| `qa-probe report [--fail-under N]` | Score + root causes → `report.json`, `report.md`, `ai-context.md` |
| `qa-probe mcp` | Start MCP server over stdio |
| `qa-probe run [--fail-under N]` | All 3 phases in sequence |

All commands accept `--config <path>` to point to a non-default config file.

---

## MCP Integration (Claude / Codex)

Add to `.mcp.json` in your repo root:

```json
{
  "mcpServers": {
    "qa-probe": {
      "command": "node",
      "args": ["qa-probe/bin/qa-probe.js", "mcp"]
    }
  }
}
```

Then ask Claude:
- *"Why is /rules showing no data?"* → `qa_probe_explain_failure`
- *"Is GET /alerts returning data right now?"* → `qa_probe_probe_endpoint`
- *"What pages break if /alerts goes down?"* → `qa_probe_get_blast_radius`
- *"Run a full QA check"* → `qa_probe_run_analysis`

---

## Root Cause Categories

| Category | Detection | Fix |
|---|---|---|
| `feature_flag_disabled` | 404 at <15ms + path in featureFlags | Enable HAS_* flag |
| `missing_route` | 404 + not in OpenAPI spec | Fix typo or add include_router() |
| `contract_mismatch` | 404 + fuzzy match finds similar route | Fix trailing slash / prefix |
| `empty_db` | 200 + empty array | Run seed script |
| `auth_scope_mismatch` | 401/403 | Use admin user or fix scopes |
| `schema_mismatch` | 200 + data + field name diff | Align frontend or backend model |
| `stream_dead` | SSE/WS no first event | Fix proxy buffering or event emitter |
| `server_error` | 5xx | Check backend logs |
| `slow_but_working` | 200 + near-timeout | Add index or cache |

---

## Config Reference

See `examples/lightshield-siem/qa-probe.config.js` for a fully annotated example.

Key options:

```js
module.exports = {
  baseUrl: 'http://localhost:8000',     // backend base URL
  frontendApiPrefix: '/api',            // stripped when matching frontend calls to backend routes
  framework: 'fastapi',                 // fastapi | express | nextjs | generic
  openApiUrl: '/openapi.json',
  featureStatusUrl: '/health/features', // null to disable

  frontendSrc: './frontend/src',
  routerFile: './frontend/src/App.tsx',

  auth: { type: 'bearer', loginUrl: '/auth/login', credentials: {...}, tokenPath: 'access_token' },

  probe: {
    concurrency: 5,
    timeoutMs: 10000,
    ignoreHTTPSErrors: true,    // required for self-signed TLS
    safePosts: ['/search'],     // POST paths safe to probe (reads, not writes)
    sse: { enabled: true, firstEventTimeoutMs: 5000, paths: ['/alerts/live'] },
    ws: { enabled: true, firstFrameTimeoutMs: 5000, paths: ['/ws'] },
  },

  output: { dir: '.qaprobe', keepHistory: 10, formats: ['json', 'markdown', 'ai-context'] },
};
```

---

## License

MIT
