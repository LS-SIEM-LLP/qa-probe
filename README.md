# qa-probe

**Map every frontend route to every backend API call. Probe them live. Get a root-cause diagnosis — not just a status code.**

```
Overall score: 74/100

Root causes:
  empty_db:              5 route(s)   → seed the database
  feature_flag_disabled: 3 route(s)   → enable HAS_NTA, HAS_DNS_C2_ROUTER, HAS_YARA
  missing_route:         1 route(s)   → fix trailing slash in /api/alerts/

┌──────────────────────────────┬────────┬────────────┬──────────────────────────┐
│ Route                        │ Score  │ Status     │ Root Cause               │
├──────────────────────────────┼────────┼────────────┼──────────────────────────┤
│ /rules                       │ 100    │ ✓ healthy  │                          │
│ /alerts                      │ 80     │ ✓ healthy  │ empty db                 │
│ /nta                         │  0     │ ✗ broken   │ feature flag disabled    │
│ /feedback-coordinator        │ 50     │ ⚠ degraded │ empty db                 │
│ /malware-detection           │ 85     │ ✓ healthy  │                          │
└──────────────────────────────┴────────┴────────────┴──────────────────────────┘
```

---

## The problem this solves

Your dashboard loads. The page doesn't crash. But every table is empty, every chart shows zero, and you have no idea why.

The root cause is usually one of:
- The frontend calls `/api/auth/login` but the backend route is `/api/login`
- A feature flag (`HAS_MALWARE_DETECTION=false`) silently disables an entire router
- The database is correctly connected but the table has no rows
- An OpenAPI response model was refactored — `rule_name` became `name` — and the frontend component still reads the old field

Playwright catches crashes. Schemathesis validates contracts. **Neither tells you which frontend page is broken because of which backend endpoint, or why.** qa-probe does.

It walks your React source code with a Babel AST parser — the same parser VS Code uses — extracts every API call across every component, maps them to your backend's OpenAPI spec, probes them live with real auth, and produces a scored report with a specific fix for every failure.

---

## Quickstart

```bash
# Run without installing
npx qa-probe run

# Or install globally
npm install -g qa-probe
qa-probe run

# Point at your config
qa-probe run --config ./qa-probe.config.js
```

**Minimum config** (`qa-probe.config.js` at your project root):

```js
module.exports = {
  baseUrl: 'http://localhost:8000',
  frontendSrc: './frontend/src',
  routerFile: './frontend/src/App.tsx',
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

```bash
QA_USER=testuser QA_PASS=testpass qa-probe run
```

---

## How it works

qa-probe runs three phases in sequence. Each phase writes a cache file so you can re-run individual phases without repeating earlier work.

### Phase 1 — Analyze

Builds the dependency graph: which backend routes does each frontend page actually call?

1. **Frontend AST walk** — Babel parses every `.js`, `.ts`, `.jsx`, `.tsx` file in `frontendSrc`. Extracts:
   - Direct axios/fetch calls: `api.get('/alerts')`, `fetch('/api/rules')`
   - Custom hooks: `useApiData('/playbooks', opts)`, `useApiQuery(['key'], '/endpoint')`
   - Template literals: `` api.get(`/cases/${id}`) `` → normalized to `/cases/{id}`
   - String concatenation: `'/users/' + userId` → `/users/{param}`

2. **Route extraction** — Parses `routerFile` (your `App.tsx`) for `<Route path="...">`, `<ScopeRoute>`, `<AdminRoute>` elements. Normalizes React Router v6 relative paths.

3. **Backend spec fetch** — `GET /openapi.json`. Optional `GET /health/features` for feature flag status (FastAPI-specific but configurable).

4. **Graph build** — Strips the `frontendApiPrefix` (e.g. `/api`) from frontend call paths, fuzzy-matches to backend routes, computes blast radius (how many pages call each endpoint).

Output: `.qaprobe/graph.json`

### Phase 2 — Probe

Authenticates once, then fires concurrent HTTP requests at every discovered endpoint.

- **Auth modes**: bearer token (two-step with cookie fallback), API key, none
- **HTTP probing**: configurable concurrency, timeout, per-request delay
- **Self-signed TLS**: `ignoreHTTPSErrors: true` for local/staging stacks
- **SSE verification**: opens the event stream, waits for the first event within `firstEventTimeoutMs`
- **WebSocket verification**: upgrade handshake + waits for first frame
- **Schema validation**: compares response fields against the OpenAPI response model
- **POST safety**: all POST/PUT/DELETE endpoints are skipped unless listed in `safePosts`

Output: `.qaprobe/probe-results.json`

### Phase 3 — Report

Classifies every endpoint with a **9-rule root-cause classifier** (priority order, first match wins):

| Priority | Root Cause | Detection | Fix Hint |
|---|---|---|---|
| 1 | `feature_flag_disabled` | 404 at <15ms + path in feature flags | Enable HAS_* flag and restart |
| 2 | `missing_route` | 404 + not in OpenAPI spec | Fix typo or add include_router() |
| 3 | `contract_mismatch` | 404 + fuzzy match finds similar route | Fix trailing slash / prefix |
| 4 | `empty_db` | 200 + empty array | Run seed script |
| 5 | `auth_scope_mismatch` | 401 / 403 | Use admin user or fix scopes |
| 6 | `schema_mismatch` | 200 + data + field names differ from spec | Align frontend or backend model |
| 7 | `stream_dead` | SSE/WS: connected but no events | Fix proxy buffering or event emitter |
| 8 | `server_error` | 5xx | Check backend logs |
| 9 | `slow_but_working` | 200 + response time > 80% of timeout | Add index or cache |

**Cluster pass**: if 5+ endpoints under the same path prefix share the same root cause, they're collapsed into one diagnosis.

**Regression diff**: compares the current run against `.qaprobe/history/` and flags new failures and new passes.

Outputs: `.qaprobe/report.json`, `.qaprobe/report.md`, `.qaprobe/ai-context.md`

---

## Comparison

| Capability | qa-probe | Schemathesis | Dredd | Stoplight Prism | Optic *(archived)* | Postman |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Requires OpenAPI spec | optional | required | required | required | required | optional |
| Frontend AST parsing | ✓ | — | — | — | — | — |
| Frontend→backend route map | ✓ | — | — | — | — | — |
| Live HTTP probe (authenticated) | ✓ | ✓ | ✓ | mock only | diff only | ✓ |
| SSE / WebSocket verification | ✓ | — | — | — | — | — |
| Root-cause labels | ✓ | — | — | — | — | — |
| Blast radius (which pages break) | ✓ | — | — | — | — | — |
| Regression diff (run-to-run) | ✓ | — | — | — | ✓ | — |
| MCP server (Claude / Cursor) | ✓ | — | — | — | — | — |
| Headless mode (no spec) | ✓ | — | — | — | — | ✓ |
| CI exit code gate | ✓ | ✓ | ✓ | — | — | ✓ |

**Schemathesis** is excellent at property-based contract fuzzing — it generates edge-case inputs and catches spec violations. qa-probe is complementary: it probes the real app with the real data and tells you *why* pages are blank.

**Dredd** validates backend responses against an OpenAPI spec in CI. It has no concept of the frontend, blast radius, or root causes.

**Stoplight Prism** mocks a backend from an OpenAPI spec — useful for frontend development before the backend exists. It never touches a live server.

**Postman** requires a manually maintained collection. qa-probe auto-discovers endpoints from source code.

---

## MCP Server

qa-probe includes a Model Context Protocol server. Once running, Claude, Cursor, or any MCP-compatible assistant can query your QA data directly.

**Setup** — add to `.mcp.json` at your repo root:

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

Or if installed globally:

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

**Available tools:**

| Tool | What it answers |
|---|---|
| `qa_probe_get_graph` | Which backend routes does `/dashboard` call? |
| `qa_probe_get_report` | Show me all broken routes and their scores |
| `qa_probe_probe_endpoint` | Is `GET /alerts` returning data right now? |
| `qa_probe_explain_failure` | Why is `/rules` showing no data? |
| `qa_probe_suggest_fix` | What do I do about `feature_flag_disabled` issues? |
| `qa_probe_get_blast_radius` | What pages break if `GET /alerts` goes down? |
| `qa_probe_run_analysis` | Run a full QA check and give me the summary |

**Example prompts** (works in Claude Code, Cursor, or any MCP client):

```
"Why is /rules showing no data?"
→ qa_probe_explain_failure → root cause: empty_db → fix: run seed script

"What pages break if the alerts endpoint goes down?"
→ qa_probe_get_blast_radius → /alerts, /dashboard, /triage-queue (3 routes)

"Run a full QA check"
→ qa_probe_run_analysis → triggers analyze + probe + report, returns overall score

"Is GET /alerts returning data right now?"
→ qa_probe_probe_endpoint → live HTTP probe → status 200, 15 items, 42ms
```

The MCP server reads from cached `.qaprobe/` files. Run `qa-probe run` first to populate them, then start the MCP server.

---

## Configuration Reference

```js
// qa-probe.config.js
module.exports = {

  // ── Target ──────────────────────────────────────────────────────────────────
  baseUrl: 'http://localhost:8000',
  // URL of your backend API. No trailing slash.

  frontendApiPrefix: '/api',
  // Prefix the frontend adds to API calls (e.g. axios baseURL: '/api').
  // Stripped when matching frontend calls to backend routes.
  // Set to '' if frontend calls /alerts directly (no prefix).

  framework: 'fastapi',
  // 'fastapi' | 'express' | 'nextjs' | 'generic'
  // Controls how the OpenAPI spec and auth are fetched.

  openApiUrl: '/openapi.json',
  // Path to the OpenAPI spec relative to baseUrl.
  // Set to null to enable headless mode (HTTP status probing only).

  featureStatusUrl: '/health/features',
  // Optional. FastAPI apps can expose a router status endpoint here.
  // Format: { "routers": { "/prefix": { "included": bool, "enabled": bool } } }
  // Set to null to disable feature flag detection.

  // ── Frontend Source ─────────────────────────────────────────────────────────
  frontendSrc: './frontend/src',
  // Directory containing all React source files to parse.

  routerFile: './frontend/src/App.tsx',
  // File containing your React Router <Route> definitions.

  apiClientFile: './frontend/src/utils/api.js',
  // Optional. Axios client file — used to detect baseURL and interceptors.
  // Set to null if not applicable.

  // ── Auth ────────────────────────────────────────────────────────────────────
  auth: {
    type: 'bearer',
    // 'bearer'  — POST loginUrl with credentials, extract token from response body or cookie
    // 'api-key' — send a static key header on every request (no login call)
    // 'none'    — no authentication (public API)

    loginUrl: '/auth/login',
    // POST endpoint to authenticate. Only used when type is 'bearer'.

    credentials: {
      username: process.env.QA_USER,
      password: process.env.QA_PASS,
      // Always use environment variables. Never hardcode credentials.
    },

    tokenPath: 'access_token',
    // JSON path in the login response body containing the bearer token.
    // If null or not found, qa-probe falls back to checking Set-Cookie headers
    // for common cookie names: ls_access, access_token, jwt, auth_token, token.

    apiKey: process.env.QA_API_KEY,
    // Used when type is 'api-key'.

    apiKeyHeader: 'X-API-Key',
    // HTTP header name to send the API key in.
  },

  // ── Probe Behavior ──────────────────────────────────────────────────────────
  probe: {
    concurrency: 5,
    // Max concurrent HTTP requests. Increase for faster probing on a healthy API.
    // Reduce if you see 429 or connection errors.

    delayMs: 50,
    // Delay between requests within a concurrency batch (milliseconds).

    timeoutMs: 10000,
    // Per-request timeout (milliseconds). Requests exceeding this are marked as errors.

    ignoreHTTPSErrors: false,
    // Set true to accept self-signed TLS certificates (local/staging stacks).

    skipPaths: ['^/auth/', '^/health/', '^/openapi', '^/docs', '^/redoc'],
    // Regex patterns for paths to skip entirely. Applied to the raw backend path.

    safePosts: [],
    // POST endpoints that are safe to probe (they are reads, not writes).
    // Example: ['/logs/search', '/query/workbench']
    // All other POST/PUT/PATCH/DELETE endpoints are skipped.

    pathParamValues: { id: '1' },
    // Default values for path parameters like {id}, {rule_name}.
    // qa-probe substitutes these when probing routes like /alerts/{id}.

    sse: {
      enabled: true,
      // Whether to probe Server-Sent Event endpoints.

      firstEventTimeoutMs: 5000,
      // Fail the SSE check if no event arrives within this window.

      paths: [],
      // Explicit SSE endpoint paths. Auto-detected from content-type: text/event-stream too.
    },

    ws: {
      enabled: true,
      // Whether to probe WebSocket endpoints.

      firstFrameTimeoutMs: 5000,
      // Fail the WS check if no frame arrives within this window.

      paths: [],
      // Explicit WebSocket paths (ws:// or wss:// upgrade paths).
    },
  },

  // ── Scoring Weights ─────────────────────────────────────────────────────────
  scoring: {
    missingRoute:    -50,  // 404 — frontend calls a path that doesn't exist in the spec
    emptyResponse:   -20,  // 200 but empty — database has no records
    authError:       -30,  // 401/403 — test user lacks required scope
    serverError:     -40,  // 5xx — backend error
    slowResponse:    -10,  // 200 but slow — near the probe timeout
    disabledFeature: -15,  // 404 — feature flag is disabled
    schemaMismatch:  -25,  // 200 but response fields differ from spec
    streamDead:      -35,  // SSE/WS — connected but no events delivered
  },

  // ── Output ──────────────────────────────────────────────────────────────────
  output: {
    dir: '.qaprobe',
    // Directory where cache files, reports, and history are written.

    keepHistory: 10,
    // Number of previous runs to keep for regression comparison.

    formats: ['json', 'markdown', 'ai-context'],
    // Output formats to generate. All three are recommended.
    // 'ai-context' is a compact summary optimized for LLM context windows.
  },

};
```

### Auth mode examples

**Bearer token (standard)**
```js
auth: { type: 'bearer', loginUrl: '/auth/token', credentials: { username: process.env.QA_USER, password: process.env.QA_PASS }, tokenPath: 'access_token' }
```

**Cookie-mode JWT** (token returned in `Set-Cookie`, not body)
```js
// No changes needed — qa-probe auto-detects cookie-mode when access_token is null in the response body
auth: { type: 'bearer', loginUrl: '/auth/login', credentials: { username: process.env.QA_USER, password: process.env.QA_PASS }, tokenPath: 'access_token' }
```

**API key**
```js
auth: { type: 'api-key', apiKey: process.env.QA_API_KEY, apiKeyHeader: 'X-API-Key' }
```

**No auth (public API)**
```js
auth: { type: 'none' }
```

---

## CLI Commands

```
qa-probe analyze   [--config <path>]            Parse frontend + fetch backend spec
qa-probe probe     [--config <path>]            Authenticate + probe every endpoint
qa-probe report    [--config <path>] [--fail-under <score>]   Score + classify + output
qa-probe run       [--config <path>] [--fail-under <score>]   All three phases in sequence
qa-probe mcp       [--config <path>]            Start MCP server over stdio
```

`--fail-under <N>`: exits with code 1 if the overall score is below N. Use this as a CI gate.

---

## CI / GitHub Actions

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

    services:
      # Start your app here. This example uses docker compose.
      app:
        image: your-app:latest
        ports:
          - 8000:8000

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install qa-probe
        run: npm install --prefix ./qa-probe qa-probe

      - name: Run qa-probe
        env:
          QA_USER: ${{ secrets.QA_PROBE_USER }}
          QA_PASS: ${{ secrets.QA_PROBE_PASS }}
        run: node qa-probe/bin/qa-probe.js run --fail-under 80

      - name: Upload report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: qa-probe-report
          path: .qaprobe/
```

**Caching the dependency graph between runs** (speeds up probe-only reruns):

```yaml
      - name: Cache qa-probe graph
        uses: actions/cache@v4
        with:
          path: .qaprobe/graph.json
          key: qa-probe-graph-${{ hashFiles('frontend/src/**', 'openapi.json') }}
```

---

## Headless mode

When `/openapi.json` is unavailable (docs disabled in production, staging behind auth), qa-probe falls back to **headless mode**: it probes the URLs discovered from the frontend source code directly, without backend route matching.

In headless mode:
- Root cause rules 1 (`feature_flag_disabled`), 3 (`contract_mismatch`), 6 (`schema_mismatch`) are skipped — they require the OpenAPI spec
- Rules 2, 4, 5, 7, 8, 9 still apply from HTTP status + response shape alone
- The report is labeled `headless: true`

Enable by setting `openApiUrl: null` in your config.

---

## Feature flag detection

If your FastAPI app exposes a router status endpoint, qa-probe uses it to distinguish between "this route is 404 because the feature is disabled" vs "this route genuinely doesn't exist."

Expected response format from `featureStatusUrl`:

```json
{
  "count": 3,
  "routers": {
    "/malware-detection": { "included": false, "enabled": false, "message": "HAS_MALWARE_DETECTION=false" },
    "/alerts":            { "included": true,  "enabled": true  },
    "/nta":               { "included": false, "enabled": false, "message": "HAS_NTA=false" }
  }
}
```

The heuristic: a 404 that arrives in **<15ms** at a flagged prefix is classified as `feature_flag_disabled`. A 404 that takes longer is `missing_route` (the router is registered but the specific path doesn't exist).

---

## Known limitations

**Dynamic URL construction**
```js
// qa-probe detects this ✓
api.get(`/cases/${id}`)

// qa-probe detects this ✓ (normalized to /cases/{param})
api.get('/cases/' + caseId)

// qa-probe cannot detect this — URL built in a loop or via a factory function
const url = buildUrl('cases', filters);
api.get(url);
```
Calls built via arbitrary functions or third-party URL builders are not detected. The graph will be incomplete for those routes.

**POST body validation**
POST endpoints in `safePosts` are probed with an empty body. If your endpoint validates the request body and returns 422 on empty input, qa-probe will classify it as a contract error. Add proper test fixtures for POST endpoints using a dedicated integration test suite (Schemathesis works well for this).

**SSE authentication**
Some backends require the auth token in the query string for SSE connections (e.g. `/alerts/live?token=...`) because browser EventSource does not support custom headers. qa-probe sends the token as a header. If your backend rejects that, the SSE check will show `stream_dead` even when the endpoint is healthy. Set `sse.enabled: false` in that case and verify SSE separately.

**React Router code splitting**
If routes are declared in lazily imported components (dynamic `import()` inside `React.lazy()`), the route extractor may not find them at parse time. Add those paths to your `probe.pathParamValues` config manually.

**Multi-frontend monorepos**
qa-probe assumes one frontend `src` directory. For monorepos with multiple apps, run separate instances with separate configs pointing to each app's `frontendSrc`.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache 2.0 — see [LICENSE](LICENSE).
