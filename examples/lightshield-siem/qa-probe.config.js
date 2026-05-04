// qa-probe config for LightShield-SIEM
// Run from the repo root: node qa-probe/bin/qa-probe.js run --config qa-probe.config.js

module.exports = {
  // ── Target ────────────────────────────────────────────────────────────────
  // Backend API — nginx strips /api and proxies to FastAPI on port 8000
  baseUrl: 'http://localhost:8000',
  frontendApiPrefix: '/api',
  framework: 'fastapi',
  openApiUrl: '/openapi.json',
  featureStatusUrl: '/health/features',

  // ── Frontend Source ────────────────────────────────────────────────────────
  frontendSrc: './frontend/src',
  routerFile: './frontend/src/App.tsx',
  apiClientFile: './frontend/src/utils/api.js',

  // ── Auth ──────────────────────────────────────────────────────────────────
  auth: {
    type: 'bearer',
    loginUrl: '/auth/login',
    credentials: {
      // Set QA_PROBE_USER / QA_PROBE_PASS in your environment or CI secrets.
      // Never commit real credentials to source control.
      username: process.env.QA_PROBE_USER,
      password: process.env.QA_PROBE_PASS,
    },
    tokenPath: 'access_token',
  },

  // ── Probe Behavior ────────────────────────────────────────────────────────
  probe: {
    concurrency: 5,
    delayMs: 50,
    timeoutMs: 10000,
    // LightShield uses self-signed TLS — must be true for HTTPS mode
    ignoreHTTPSErrors: true,
    skipPaths: ['^/auth/', '^/health', '^/openapi', '^/docs', '^/redoc'],
    // POST endpoints that are safe reads (search/query, not writes)
    safePosts: [
      '/query/workbench',
      '/logs/search',
      '/alerts/search',
    ],
    pathParamValues: {
      id: '1',
      rule_name: 'test-rule',
      case_id: '1',
      user_id: '1',
    },
    sse: {
      enabled: true,
      firstEventTimeoutMs: 5000,
      paths: ['/alerts/live', '/ws/alerts'],
    },
    ws: {
      enabled: true,
      firstFrameTimeoutMs: 5000,
      paths: ['/ws'],
    },
  },

  // ── Scoring Weights ───────────────────────────────────────────────────────
  scoring: {
    missingRoute: -50,
    emptyResponse: -20,
    authError: -30,
    serverError: -40,
    slowResponse: -10,
    disabledFeature: -15,
    schemaMismatch: -25,
    streamDead: -35,
  },

  // ── Output ────────────────────────────────────────────────────────────────
  output: {
    dir: '.qaprobe',
    keepHistory: 10,
    formats: ['json', 'markdown', 'ai-context'],
  },
};
