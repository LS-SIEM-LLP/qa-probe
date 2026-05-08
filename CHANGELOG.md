# Changelog

All notable changes to qa-probe are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).  
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.4.0] - 2026-05-08

### Added

- Coverage analytics report generation via `coverage.md`.
- Dead endpoint detection for OpenAPI routes with no frontend references, with configurable ignore globs.
- Dead component and orphaned response-field analytics for frontend/API cleanup.

---

## [1.3.0] - 2026-05-08

### Added

- Opt-in visual probe via `probe.visual.enabled` with viewport and density threshold controls.
- Layout density analysis for rendered text, images, and non-empty containers.
- `data_received_not_rendered` diagnosis for healthy HTTP routes that render as blank or sparse pages.

---

## [1.2.0] - 2026-05-08

### Added

- Opt-in CDP runtime tracing during analyze via `analyze.runtime.enabled`.
- Playwright-backed runtime driver that observes browser network requests and captures DOM snapshots.
- Runtime-discovered API calls merged into `graph.json` with `source: runtime`; duplicate AST/runtime calls are tagged `source: both`.
- Runtime navigation failures are emitted as warnings without aborting analyze.

---

## [1.1.0] - 2026-05-08

### Added

- Self-healing parser warnings, parse-cache fallback, and Markdown parse warning reporting.
- Recursive `React.lazy(() => import(...))` route resolution with cycle/depth protection.
- Zod-backed OpenAPI response validation with type mismatch, missing required field, and field rename classifications.
- Schema history snapshots under `.qaprobe/history/schemas/` with additive vs. breaking drift reporting.
- Stratified safe POST body generation with `empty`, `minimal`, `realistic`, and `example` modes plus per-route overrides.

### Changed

- Safe POST probes now default to minimal schema-derived JSON bodies instead of empty bodies.
- Analyze output now carries parse warnings into `graph.json` and downstream reports.

---

## [1.0.0] — 2026-05-04

Initial public release under Apache 2.0.

### Added

**Phase 1 — Analyze**
- Babel AST parser walks React frontend source (`frontendSrc`) and extracts all API calls:
  - Direct axios/fetch calls: `api.get('/path')`, `axios.post('/path', data)`
  - Custom hook patterns: `useApiData('/path', opts)`, `useApiQuery(['key'], '/path', opts)`
  - Template literals: `` api.get(`/cases/${id}`) `` → normalized to `/cases/{id}`
  - String concatenation: `'/users/' + id` → `/users/{param}`
- React Router v6 route extractor — parses `<Route>`, `<ScopeRoute>`, `<AdminRoute>`, `<PrivateRoute>` elements from `routerFile`; normalizes relative nested paths to absolute
- Backend spec fetcher — OpenAPI 3.0 via `openApiUrl`; optional feature flag status via `featureStatusUrl`
- FastAPI adapter — handles `/openapi.json` + `/health/features` router status endpoint
- Express adapter — handles `/api-docs/swagger.json` or `/swagger.json`
- Generic adapter — any OpenAPI 3.0 / Swagger 2.0 URL
- Graph builder — strips `frontendApiPrefix`, fuzzy-matches frontend calls to backend routes, computes blast radius (how many frontend routes call each backend endpoint)
- Headless mode fallback — when OpenAPI is unavailable, probes frontend-discovered URLs directly with HTTP status reporting only

**Phase 2 — Probe**
- Authenticator — bearer token (body + cookie-mode JWT fallback), API key header, none
- Concurrent HTTP endpoint runner — configurable concurrency, per-request timeout, inter-request delay, `ignoreHTTPSErrors` for self-signed TLS
- Safe POST whitelist — POST endpoints listed in `safePosts` are probed; all other write methods are skipped
- Path parameter sampler — substitutes `{id}`, `{name}`, and other path params from `pathParamValues` config
- SSE checker — opens Server-Sent Event streams, waits for first event within `firstEventTimeoutMs`
- WebSocket checker — performs upgrade handshake, waits for first frame within `firstFrameTimeoutMs`
- Schema validator — compares response field names against the OpenAPI response model for the probed endpoint

**Phase 3 — Report**
- 9-rule root-cause classifier (priority order, first match wins):
  1. `feature_flag_disabled` — 404 at <15ms + path in feature flags with `included: false`
  2. `missing_route` — 404 + not in OpenAPI spec
  3. `contract_mismatch` — 404 + fuzzy match finds a similar route (trailing slash, prefix, casing)
  4. `empty_db` — 200 + empty array or empty body
  5. `auth_scope_mismatch` — 401 or 403
  6. `schema_mismatch` — 200 + data present + response field names differ from spec
  7. `stream_dead` — SSE/WS connected but no events delivered within timeout
  8. `server_error` — 5xx response
  9. `slow_but_working` — 200 but response time exceeds 80% of configured timeout
- Cluster pass — groups 5+ failures sharing the same path prefix and root cause into one diagnosis
- Route scorer — computes a 0–100 score for each frontend route from the probe results; configurable penalty weights per root cause category
- Blast radius reporter — lists which frontend routes are affected by each backend endpoint failure
- Regression detector — diffs current run against `.qaprobe/history/`; reports newly broken and newly fixed endpoints
- Three output formatters:
  - `report.json` — machine-readable full report
  - `report.md` — human-readable Markdown with score table
  - `ai-context.md` — compact summary optimized for LLM context windows

**MCP Server**
- Stdio MCP server (`qa-probe mcp`) using `@modelcontextprotocol/sdk`
- 7 tools: `qa_probe_get_graph`, `qa_probe_get_report`, `qa_probe_probe_endpoint`, `qa_probe_explain_failure`, `qa_probe_suggest_fix`, `qa_probe_get_blast_radius`, `qa_probe_run_analysis`
- `.mcp.json` integration — Claude Code and Cursor pick up the server automatically

**CLI**
- `qa-probe analyze` — Phase 1 only
- `qa-probe probe` — Phase 2 only (requires graph from analyze)
- `qa-probe report [--fail-under N]` — Phase 3 only; exits 1 if overall score < N (CI gate)
- `qa-probe run [--fail-under N]` — All three phases in sequence
- `qa-probe mcp` — MCP server over stdio
- `--config <path>` flag on all commands

**Config**
- Zod-validated config schema with clear error messages for invalid values
- `qa-probe.config.js` convention — loaded from the working directory by default
- Environment variable support for credentials (`QA_USER`, `QA_PASS`, `QA_API_KEY`)

**Examples**
- `examples/fastapi-react/` — fully annotated FastAPI + React example
- `examples/express-app/` — Express + React minimal example

---

[1.0.0]: https://github.com/kinghtfall/LS-QA-Probe/releases/tag/v1.0.0
