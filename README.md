# qa-probe

**Find out exactly why your pages are blank — in under 5 minutes.**

```
Overall score: 74/100

Root causes detected:
  empty_db:              5 route(s)   → seed the database
  feature_flag_disabled: 3 route(s)   → enable HAS_BILLING, HAS_REPORTS, HAS_ANALYTICS
  missing_route:         1 route(s)   → fix trailing slash in /api/users/

┌──────────────────────────────┬────────┬────────────┬──────────────────────────┐
│ Route                        │ Score  │ Status     │ Root Cause               │
├──────────────────────────────┼────────┼────────────┼──────────────────────────┤
│ /dashboard                   │ 100    │ ✓ healthy  │                          │
│ /users                       │  80    │ ✓ healthy  │ empty db                 │
│ /billing                     │   0    │ ✗ broken   │ feature flag disabled    │
│ /reports                     │  50    │ ⚠ degraded │ empty db                 │
│ /settings                    │  85    │ ✓ healthy  │                          │
└──────────────────────────────┴────────┴────────────┴──────────────────────────┘
```

qa-probe is a Node.js CLI that maps common React frontend API calls to backend routes, probes safe endpoints live with real auth, and gives you a specific root-cause diagnosis instead of only a status code. It is strongest on React apps backed by FastAPI or Express with OpenAPI enabled.

---

## The problem it solves

Your dashboard loads. No crash. But every table is empty, every chart shows zero, and you have no idea why.

The cause is almost always one of:
- The frontend calls `/api/users/` but the backend route is `/api/users` (trailing slash)
- A feature flag (`HAS_BILLING=false`) silently disabled an entire router
- The database is connected but the table has no rows
- A backend refactor renamed `user_name` → `name` and the frontend component still reads the old field

Playwright and Schemathesis are still valuable: Playwright verifies user journeys, and Schemathesis fuzzes API contracts. qa-probe fills a different gap: it builds a source-aware smoke map from frontend calls to live backend responses, then explains why a page has no data.

---

## Choose your path

| I want to… | Go to |
|---|---|
| Run it from the terminal and read the report myself | [Manual setup (5 min)](#manual-setup-5-min) |
| Ask Claude / Cursor questions about my broken pages | [AI / MCP setup](#ai--mcp-setup) |
| Use it in CI to block broken deploys | [CI / GitHub Actions](#ci--github-actions) |

---

## Supported patterns

qa-probe is intentionally conservative. It works best when your app uses:

- React Router JSX, `createBrowserRouter(...)`, or TanStack `createRoute(...)`.
- Axios-style clients such as `api.get('/users')`, including project-specific clients created with `axios.create(...)`.
- Simple custom hooks such as `useApiData('/users')` and `useApiQuery(['users'], '/users')`.
- String literals, template literals, or simple string concatenation for paths.
- FastAPI, Express, Next.js, or generic OpenAPI backends.

It does not automatically understand every frontend data layer. Expect to add adapters or explicit config for GraphQL, tRPC, generated SDK clients, heavily dynamic URL factories, custom service layers, and Next server actions. See [Known limitations](#known-limitations) for details.

For a quick public demo outline, see [`examples/demo-fixture`](examples/demo-fixture).

---

## Manual setup (5 min)

### Step 1 — Install

```bash
# Use without installing (recommended for first try)
npx qa-probe run

# Or install globally
npm install -g qa-probe
```

### Step 2 — Create your config

Create `qa-probe.config.js` at your project root:

```js
// qa-probe.config.js
module.exports = {
  baseUrl: 'http://localhost:8000',     // your backend URL
  frontendSrc: './frontend/src',         // where your React files live
  routerFile: './frontend/src/App.tsx',  // your main router file

  auth: {
    type: 'bearer',
    loginUrl: '/auth/login',
    credentials: {
      username: process.env.QA_USER,
      password: process.env.QA_PASS,
    },
    tokenPath: 'access_token',
  },
};
```

> **Tip:** `qa-probe.config.js` is gitignored automatically. Never hardcode credentials — always use environment variables.

### Step 3 — Start your app, then run qa-probe

```bash
# Make sure your backend is running first, then:
QA_USER=testuser QA_PASS=testpass npx qa-probe run
```

That's it. qa-probe will:
1. Parse your React source and find every API call
2. Fetch your OpenAPI spec from `/openapi.json`
3. Probe every endpoint live with real auth
4. Write a full report to `.qaprobe/`

### Step 4 — Read the report

**Terminal** — summary table appears immediately after the run.

**Detailed report** — open `.qaprobe/report.md` in any Markdown viewer for the full breakdown.

**JSON** — `.qaprobe/report.json` for scripting or CI.

---

## Understanding the results

### Route statuses

| Status | What it means |
|---|---|
| ✓ healthy | All endpoints probed OK, data present, schema valid |
| ⚠ degraded | Works but has an issue (empty data, slow response) |
| ✗ broken | Endpoint is unreachable, 404, or 5xx |

### Root causes and what to do

| Root Cause | What happened | What to do |
|---|---|---|
| `feature_flag_disabled` | Backend router not registered — a `HAS_*` env flag is `false` | Set the flag to `true` in your backend config and restart |
| `missing_route` | 404 — endpoint doesn't exist in the OpenAPI spec | Check for a typo in the frontend API call path, or a missing `include_router()` in the backend |
| `contract_mismatch` | 404 — a *similar* route exists (trailing slash, casing) | Align the frontend call to match the exact backend path |
| `empty_db` | 200 OK but the response is an empty array | Seed your database with test data |
| `auth_scope_mismatch` | 401 or 403 — test user lacks the required role/scope | Use a user with broader permissions, or check the endpoint's required scopes |
| `schema_mismatch` | 200 OK but field names don't match the OpenAPI spec | A backend field was renamed — update the frontend component or the backend response model |
| `stream_dead` | SSE/WebSocket connected but no events arrived | Check the server-side event emitter and proxy config (nginx must allow SSE passthrough) |
| `server_error` | 5xx response | Check backend logs: `docker logs <api-container> --tail 50` |
| `slow_but_working` | 200 OK but response time is near the timeout | Add a database index or query result cache |

### Score breakdown

Each frontend route gets a 0–100 score. The overall score is the average.

```
100 = all endpoints healthy, data present, schema valid
80  = healthy but some empty data
50  = partially working
0   = completely broken
```

A score below 80 in CI (`--fail-under 80`) blocks the deploy.

---

## AI / MCP setup

qa-probe includes a **Model Context Protocol (MCP) server**. Once configured, Claude Code, Cursor, or any MCP-compatible AI assistant can query your QA data and explain failures in plain English — no manual report-reading required.

### Step 1 — Run qa-probe once to populate the cache

```bash
QA_USER=testuser QA_PASS=testpass npx qa-probe run
```

This creates `.qaprobe/graph.json`, `probe-results.json`, and `report.json`. The MCP server reads from these.

### Step 2 — Add the MCP server to your project

Add to `.mcp.json` at your repo root (create it if it doesn't exist):

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

If qa-probe is installed globally:

```json
{
  "mcpServers": {
    "qa-probe": {
      "command": "qa-probe",
      "args": ["mcp"]
    }
  }
}
```

Restart Claude Code or Cursor after saving.

### Step 3 — Ask questions in plain English

You don't need to know the tool names. Just ask naturally:

```
"Why is /reports showing no data?"
```
→ Calls `qa_probe_explain_failure` → returns root cause + exact fix hint

```
"Which pages will break if the users endpoint goes down?"
```
→ Calls `qa_probe_get_blast_radius` → lists every frontend route that calls `GET /users`

```
"Show me all broken routes"
```
→ Calls `qa_probe_get_report` with `filter: broken` → table of broken routes with root causes

```
"Run a full QA check on the app right now"
```
→ Calls `qa_probe_run_analysis` → triggers analyze + probe + report, returns overall score

```
"Is GET /users returning data right now?"
```
→ Calls `qa_probe_probe_endpoint` → live HTTP probe → status 200, 15 items, 42ms

### All available MCP tools

| Tool | Ask it… |
|---|---|
| `qa_probe_get_graph` | "Which backend routes does /dashboard call?" |
| `qa_probe_get_report` | "Show me all broken routes and their scores" |
| `qa_probe_probe_endpoint` | "Is GET /users returning data right now?" |
| `qa_probe_explain_failure` | "Why is /reports showing no data?" |
| `qa_probe_suggest_fix` | "What should I do about feature_flag_disabled issues?" |
| `qa_probe_get_blast_radius` | "What pages break if the users endpoint goes down?" |
| `qa_probe_run_analysis` | "Run a full QA check and give me the summary" |

> **Note:** MCP output has SQL errors, stack traces, and table names redacted before they reach the AI. The raw data stays on disk.

### Trust contract (for AI consumers)

Every diagnosis is **verifiable and honest about its certainty**, so an AI (or human) never has to trust a label blind:

- **`evidence`** — each result carries the request issued and a bounded, sanitized snapshot of what the server actually returned (status, content-type, body sample, timing). Auth headers are never captured.
- **`confidence`** — `high` (deterministic HTTP semantics), `medium` (inferred), or **`none`** (qa-probe has no rule for this signal). A `confidence: none` / `unknown` result is explicitly *not* a confirmed pass.
- **`trust`** — `qa_probe_explain_failure` returns a plain-English note when any call is unclassified, so an AI knows not to report it as passing without checking the evidence.

The intent: **100% real, fully transparent results** — confident answers come with their evidence, and "I don't know" is said out loud instead of hidden behind a perfect-looking score.

### Feedback — teach qa-probe (it gets smarter the more it's used)

Humans and AIs can record a verdict on any diagnosis; qa-probe persists it and reapplies it on future runs.

```bash
# Suppress a finding you've confirmed is fine:
qa-probe label "GET /alerts" expected -r "demo DB is empty by design"
# Confirm a real problem so it stays flagged with high confidence:
qa-probe label "GET /reports" bug -r "known 500 on cold cache"
```

Via MCP, an AI calls **`qa_probe_label`** with the same arguments — so an assistant can write back what it figured out instead of re-deriving it every run.

- **Verdicts** — `expected` / `ignore` / `known_gate` / `ok` *suppress* (reclassify as `acknowledged`); `bug` / `real_bug` / `confirm` *confirm* (keep it flagged, high confidence).
- **Honesty guard** — a label can be scoped to the rootCause it was made for (`--signal empty_db`). If the endpoint's behavior later changes (e.g. starts returning `500`), the label **auto-revokes** so a stale "expected" can never hide a regression.
- **Transparent** — suppression is never silent: the report's `feedback` block lists every label applied this run, by whom, and why. Stored in `<output.dir>/feedback.json` (point `feedbackFile` at a committed path to share across a team/CI).

---

## CI / GitHub Actions

Add qa-probe as a CI gate — fail the build if your overall score drops below a threshold.

```yaml
# .github/workflows/qa-probe.yml
name: QA Probe

on:
  push:
    branches: [main, develop]
  pull_request:

jobs:
  qa-probe:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Start app (adjust to your stack)
        run: docker compose up -d && sleep 10

      - name: Run qa-probe
        env:
          QA_USER: ${{ secrets.QA_PROBE_USER }}
          QA_PASS: ${{ secrets.QA_PROBE_PASS }}
        run: npx qa-probe run --fail-under 80

      - name: Upload report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: qa-probe-report
          path: .qaprobe/
```

`--fail-under 80` exits with code 1 if the score drops below 80, failing the CI job.

**Cache the graph between runs** (faster reruns — only re-probe when source changes):

```yaml
      - name: Cache qa-probe graph
        uses: actions/cache@v4
        with:
          path: .qaprobe/graph.json
          key: qa-probe-graph-${{ hashFiles('frontend/src/**', 'openapi.json') }}
```

---

## Troubleshooting

**"Empty graph — 0 API calls found"**

Your API client may use a variable name not in the default detection list. Add `apiClientFile` to your config pointing to the file where your client is created:
```js
apiClientFile: './src/utils/api.js'
```
qa-probe will auto-detect `axios.create()` instances from that file and add the variable name to the search list.

**"All endpoints return 401"**

Your `loginUrl` or `credentials` config is wrong, or the response field containing the token (`tokenPath`) doesn't match. Try `tokenPath: 'token'` or `tokenPath: 'data.access_token'`.

**"404 everywhere but the app works fine in the browser"**

Check `frontendApiPrefix`. If your React app calls `/api/users` and your backend serves `/users`, set `frontendApiPrefix: '/api'`. If the frontend calls the backend directly with no prefix, set `frontendApiPrefix: ''`.

**"Empty routes — 0 routes found"**

qa-probe looks for JSX `<Route>`, `createBrowserRouter([...])`, and TanStack Router `createRoute({})`. If your router file uses a pattern not in this list (e.g. a custom wrapper component), set `routerFile` to whichever file actually contains the route definitions.

**"Self-signed certificate errors"**

Set `probe: { ignoreHTTPSErrors: true }` in your config. **Dev/staging only — never production.**

**"Endpoints look healthy but the page is still blank"**

If qa-probe reports `empty_db` — the API is working correctly but your database has no rows. Run your project's seed/fixture script. Set `seedCommand: 'npm run db:seed'` in your config to see the exact command in the fix hint.

---

## How it works (deep dive)

qa-probe runs three phases. Each one writes a cache file so you can re-run individual phases without repeating earlier work.

### Phase 1 — Analyze

Builds a dependency map: which backend route does each frontend page actually call?

**Frontend AST walk** — Babel parses every `.js/.ts/.jsx/.tsx` file in `frontendSrc`. Detects:
- `api.get('/users')` — direct axios/fetch calls (auto-detects client variable names)
- `useApiData('/users', opts)` — custom hook patterns
- `` api.get(`/cases/${id}`) `` → normalized to `/cases/{id}`
- `'/users/' + userId` → `/users/{param}`

**Route extraction** — reads `routerFile` and supports all three React router patterns:
- `<Route path="...">` JSX (React Router v5 / v6 JSX API)
- `createBrowserRouter([{path, children}])` object config (React Router v6.4+)
- `createRoute({path, component})` (TanStack Router v1)

**Backend spec** — fetches `/openapi.json` (or your `openApiUrl`). Optionally fetches `/health/features` to detect disabled feature flags.

**Graph** — strips `frontendApiPrefix`, fuzzy-matches paths to backend routes, computes blast radius.

Output: `.qaprobe/graph.json`

### Phase 2 — Probe

Authenticates once, then fires concurrent HTTP requests at every discovered endpoint.

- Configurable concurrency, timeout, per-request delay
- Self-signed TLS support (`ignoreHTTPSErrors`)
- SSE: opens the stream, waits for first event within `firstEventTimeoutMs`
- WebSocket: upgrade handshake, waits for first frame
- Schema validation: compares response field names against OpenAPI model
- POST safety: all write-method endpoints skipped unless in `safePosts`
- 429 backoff: reads `Retry-After` header, retries up to 2x with exponential fallback

Output: `.qaprobe/probe-results.json`

### Phase 3 — Report

Applies the 9-rule root-cause classifier (priority order, first match wins):

| # | Root Cause | Signal |
|---|---|---|
| 1 | `feature_flag_disabled` | 404 at <15ms + path in feature flags |
| 2 | `contract_mismatch` | 404 + fuzzy match finds similar route |
| 3 | `missing_route` | 404 + not in OpenAPI spec |
| 4 | `empty_db` | 200 + empty array/body |
| 5 | `auth_scope_mismatch` | 401 / 403 |
| 6 | `schema_mismatch` | 200 + field names differ from spec |
| 7 | `stream_dead` | SSE/WS: connected but no events |
| 8 | `server_error` | 5xx |
| 9 | `slow_but_working` | 200 + response time > 80% of timeout |

**Cluster pass** — 5+ endpoints sharing the same prefix and root cause get collapsed into one diagnosis.

**Regression diff** — compares against `.qaprobe/history/` and surfaces new failures and new passes.

Outputs: `.qaprobe/report.json`, `.qaprobe/report.md`, `.qaprobe/ai-context.md`

---

## Configuration reference

```js
// qa-probe.config.js
module.exports = {

  // ── Target ──────────────────────────────────────────────────────────────────
  baseUrl: 'http://localhost:8000',
  // URL of your backend API. No trailing slash.

  frontendApiPrefix: '/api',
  // Prefix the frontend adds to API calls (e.g. axios baseURL: '/api').
  // Stripped when matching frontend calls to backend routes.
  // Accepts a string OR an array: ['/api/v1', '/api/v2']
  // Set to '' if frontend calls the backend directly (no prefix).

  framework: 'fastapi',
  // 'fastapi' | 'express' | 'nextjs' | 'generic'
  // Controls how the OpenAPI spec and feature flags are fetched.

  openApiUrl: '/openapi.json',
  // Path to the OpenAPI spec relative to baseUrl.
  // Set to null to enable headless mode (HTTP status probing only).

  featureStatusUrl: '/health/features',
  // Optional. Exposes router enable/disable status for feature_flag_disabled detection.
  // Format: { "routers": { "/prefix": { "included": bool, "enabled": bool } } }
  // Set to null to disable. FastAPI-specific but works with any backend that matches the format.

  // ── Frontend Source ─────────────────────────────────────────────────────────
  frontendSrc: './frontend/src',
  // Directory containing all React source files to parse.

  routerFile: './frontend/src/App.tsx',
  // File containing your route definitions.
  // Supports: <Route> JSX, createBrowserRouter([...]), createRoute({}) (TanStack).

  apiClientFile: './frontend/src/utils/api.js',
  // Optional. The file where your axios client is created.
  // qa-probe uses this to auto-detect your client variable name via axios.create().
  // Set to null if not applicable.

  // ── Auth ────────────────────────────────────────────────────────────────────
  auth: {
    type: 'bearer',
    // 'bearer'  — POST loginUrl, extract token from response body
    // 'cookie'  — POST loginUrl, server sets HttpOnly session cookie
    // 'api-key' — send a static key header on every request (no login call)
    // 'none'    — public API (no authentication)

    loginUrl: '/auth/login',
    // POST endpoint to authenticate. Only used when type is 'bearer' or 'cookie'.

    credentials: {
      username: process.env.QA_USER,
      password: process.env.QA_PASS,
      // Always use environment variables. Never hardcode credentials.
    },

    tokenPath: 'access_token',
    // JSON path in the login response body containing the bearer token.
    // If not found, qa-probe falls back to checking Set-Cookie headers.

    apiKey: process.env.QA_API_KEY,
    // Used when type is 'api-key'.

    apiKeyHeader: 'X-API-Key',
    // HTTP header name to send the API key in. Defaults to 'X-API-Key'.
  },

  // ── Probe Behavior ──────────────────────────────────────────────────────────
  probe: {
    concurrency: 5,
    // Max concurrent requests. Increase for speed, lower if you hit 429s.

    delayMs: 50,
    // Milliseconds to wait between requests in a batch.

    timeoutMs: 10000,
    // Per-request timeout in milliseconds. Note: this maps to axios's socket-
    // inactivity timeout, so it does NOT cancel a response that keeps streaming.

    hardTimeoutMs: 12000,
    // Hard per-request wall-clock deadline (default: timeoutMs + 2000). Fires
    // regardless of socket activity, so a streaming/long-poll endpoint can never
    // hang the probe. Reported as the `timeout` root cause when it triggers.

    maxProbeMs: null,
    // Optional overall deadline for the whole HTTP probe phase. When set, in-flight
    // requests are aborted and remaining endpoints are recorded as deadline-exceeded.

    maxResponseBytes: 26214400,
    // Cap on buffered response size (default 25 MB). Guards against an endpoint that
    // floods the socket being read into memory unbounded.

    ignoreHTTPSErrors: false,
    // Set true to accept self-signed TLS certificates. Dev/staging only.

    skipPaths: ['^/auth/', '^/health/', '^/openapi', '^/docs', '^/redoc'],
    // Regex patterns for paths to skip. Applied to the raw backend path.

    safePosts: [],
    // POST endpoints that are safe reads (not writes) and should be probed.
    // Example: ['/search', '/query/workbench', '/logs/search']
    // All other POST/PUT/PATCH/DELETE endpoints are skipped by default.

    pathParamValues: { id: '1' },
    // Values substituted for path parameters like {id}, {slug}.
    // Example: { id: '1', user_id: '42', slug: 'test-post' }

    sse: {
      enabled: true,
      firstEventTimeoutMs: 5000,   // fail if no event within this window
      paths: [],                    // explicit SSE paths; also auto-detected by content-type
    },

    ws: {
      enabled: true,
      firstFrameTimeoutMs: 5000,   // fail if no frame within this window
      paths: [],                    // explicit WebSocket paths
    },
  },

  // ── Scoring Weights ─────────────────────────────────────────────────────────
  // Penalty applied to a route's 0–100 score for each failing endpoint.
  scoring: {
    missingRoute:    -50,
    emptyResponse:   -20,
    authError:       -30,
    serverError:     -40,
    slowResponse:    -10,
    disabledFeature: -15,
    schemaMismatch:  -25,
    streamDead:      -35,
  },

  // ── Output ──────────────────────────────────────────────────────────────────
  output: {
    dir: '.qaprobe',           // where reports and history are written
    keepHistory: 10,           // runs to keep for regression comparison
    formats: ['json', 'markdown', 'ai-context'],
  },

  // ── Optional extras ─────────────────────────────────────────────────────────
  seedCommand: 'npm run db:seed',
  // Shell command shown verbatim in the empty_db fix hint.
  // When omitted, qa-probe shows a generic "run your seed script" message.

  // featureFlagMap: { '/billing': 'HAS_BILLING_V2' },
  // Overrides auto-derived HAS_* flag names for specific path prefixes.
  // By default /some-feature → HAS_SOME_FEATURE.
};
```

### Auth mode quick reference

```js
// Bearer token (most common)
auth: { type: 'bearer', loginUrl: '/auth/login',
  credentials: { username: process.env.QA_USER, password: process.env.QA_PASS },
  tokenPath: 'access_token' }

// Cookie session (server sets HttpOnly cookie on login)
auth: { type: 'cookie', loginUrl: '/auth/login',
  credentials: { username: process.env.QA_USER, password: process.env.QA_PASS },
  cookieName: 'session' }

// API key
auth: { type: 'api-key', apiKey: process.env.QA_API_KEY, apiKeyHeader: 'X-API-Key' }

// Public API
auth: { type: 'none' }
```

---

## CLI commands

```
qa-probe run       [--config <path>] [--fail-under <N>]   Full pipeline (analyze + probe + report)
qa-probe analyze   [--config <path>]                       Phase 1 only — build dependency graph
qa-probe probe     [--config <path>]                       Phase 2 only — probe all endpoints
qa-probe report    [--config <path>] [--fail-under <N>]   Phase 3 only — score + classify + output
qa-probe mcp       [--config <path>]                       Start MCP server over stdio
```

**`--fail-under <N>`** — exits with code 1 if overall score < N. Use as a CI gate.

**Run phases individually** when iterating:
```bash
# First run — full pipeline
npx qa-probe run

# Tweak config → re-probe without re-parsing (fast)
npx qa-probe probe
npx qa-probe report

# Re-parse frontend only (after adding new components)
npx qa-probe analyze
npx qa-probe probe
npx qa-probe report
```

---

## Headless mode

When `/openapi.json` is unavailable (docs disabled in production, spec behind auth), qa-probe falls back to **headless mode**: it probes the URLs discovered from the frontend source code without backend route matching.

In headless mode, root cause rules 1 (`feature_flag_disabled`), 3 (`contract_mismatch`), and 6 (`schema_mismatch`) are skipped — they require the OpenAPI spec. Rules 2, 4, 5, 7, 8, 9 still apply from HTTP status and response shape alone.

Enable: `openApiUrl: null` in your config.

---

## Feature flag detection (FastAPI)

If your FastAPI app exposes a router status endpoint at `featureStatusUrl`, qa-probe uses it to distinguish "this 404 is because the feature is disabled" from "this route genuinely doesn't exist."

Expected JSON format:

```json
{
  "count": 3,
  "routers": {
    "/billing":   { "included": false, "enabled": false, "message": "HAS_BILLING=false" },
    "/users":     { "included": true,  "enabled": true  },
    "/analytics": { "included": false, "enabled": false, "message": "HAS_ANALYTICS=false" }
  }
}
```

qa-probe classifies a 404 as `feature_flag_disabled` when:
1. The path prefix matches a key in the routers map with `included: false`
2. The response arrived in under 15ms (meaning the router isn't even registered — a registered-but-broken route takes longer)

---

## vs other tools

| Capability | qa-probe | Schemathesis | Dredd | Stoplight Prism | Postman |
|---|:---:|:---:|:---:|:---:|:---:|
| Requires OpenAPI spec | optional | required | required | required | optional |
| Frontend AST parsing | ✓ | — | — | — | — |
| Frontend → backend route map | ✓ | — | — | — | — |
| Live HTTP probe (with real auth) | ✓ | ✓ | ✓ | mock only | ✓ |
| SSE / WebSocket verification | ✓ | — | — | — | — |
| Root-cause labels with fix hints | ✓ | — | — | — | — |
| Blast radius (which pages break) | ✓ | — | — | — | — |
| Regression diff (run-to-run) | ✓ | — | — | ✓ | — |
| MCP server (Claude / Cursor) | ✓ | — | — | — | — |
| Headless mode (no OpenAPI) | ✓ | — | — | — | ✓ |
| CI exit code gate | ✓ | ✓ | ✓ | — | ✓ |

**Schemathesis** does property-based contract fuzzing — it generates edge-case inputs and catches spec violations you didn't think of. qa-probe is complementary: it probes your real app with real data and explains why pages are blank.

**Postman** requires a manually maintained collection. qa-probe discovers every endpoint automatically from your source code.

---

## Security

**Config file is executed as JavaScript.** `qa-probe.config.js` is loaded with `require()` — the same pattern as ESLint, Jest, and Vite. Do not run qa-probe on a project whose config you don't trust.

**`ignoreHTTPSErrors: true` disables TLS verification.** Dev and staging stacks only. Never against a production API.

**Credentials never leave your machine.** Auth tokens are held in memory for the run duration and not written to any output file. Set `QA_USER` and `QA_PASS` as environment variables — never hardcode them.

**429 rate-limit backoff.** qa-probe reads `Retry-After` headers and backs off automatically (up to 2 retries with exponential fallback). It does not attempt to bypass rate limits.

**MCP output is sanitized.** SQL errors, stack traces, table names, and Python/JS tracebacks are stripped from MCP tool responses before they reach the AI client. Raw data on disk is unredacted.

To report a security issue, open a GitHub issue tagged `security`.

---

## Known limitations

**Dynamic URL construction** — calls built via arbitrary functions aren't detected:
```js
api.get(`/cases/${id}`)        // ✓ detected (template literal)
api.get('/cases/' + caseId)    // ✓ detected (string concat)
api.get(buildUrl('cases', f))  // ✗ not detected (factory function)
```

**Generated clients and service layers** - qa-probe detects visible HTTP calls and a few common hook patterns. If your app hides requests behind generated SDK methods, GraphQL clients, tRPC routers, Next server actions, or custom service-layer functions, add a parser adapter or expose a small wrapper that qa-probe can recognize.

**POST body validation** — POST endpoints in `safePosts` are probed with an empty body. If your endpoint requires a valid body and returns 422 on empty input, expect false positives. Use Schemathesis for thorough POST contract testing.

**SSE auth via query string** — some backends require the token in the URL for SSE (`/events?token=...`) because browser `EventSource` doesn't support custom headers. qa-probe sends the token as a header. If that fails, set `sse.enabled: false`.

**React Router code splitting** — routes declared inside `React.lazy(() => import(...))` may not be found at parse time. Add those paths to your `routerFile` manually, or list them explicitly in the config.

**Multi-frontend monorepos** — run separate qa-probe instances per app, each with its own config. Use `frontendApiPrefix: ['/api/v1', '/api/v2']` if a single frontend calls multiple versioned API prefixes.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to add framework adapters, root-cause rules, and router pattern extractors.

## License

Apache 2.0 — see [LICENSE](LICENSE).
