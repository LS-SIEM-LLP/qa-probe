'use strict';

const { z } = require('zod');

const AuthSchema = z.object({
  type: z.enum(['bearer', 'cookie', 'api-key', 'none']).default('bearer'),
  loginUrl: z.string().default('/auth/login'),
  credentials: z.object({
    username: z.string(),
    password: z.string(),
  }).optional(),
  apiKey: z.string().optional(),
  apiKeyHeader: z.string().default('X-API-Key'),
  tokenPath: z.string().default('access_token'),
  cookieName: z.string().default('session'),
});

const SseSchema = z.object({
  enabled: z.boolean().default(true),
  firstEventTimeoutMs: z.number().default(5000),
  paths: z.array(z.string()).default([]),
});

const WsSchema = z.object({
  enabled: z.boolean().default(true),
  firstFrameTimeoutMs: z.number().default(5000),
  paths: z.array(z.string()).default([]),
});

const VisualProbeSchema = z.object({
  enabled: z.boolean().default(false),
  viewportWidth: z.number().default(1280),
  viewportHeight: z.number().default(720),
  densityThreshold: z.number().default(0.10),
  navigationTimeoutMs: z.number().default(30000),
});

const OtelSchema = z.object({
  enabled: z.boolean().default(false),
  backend: z.enum(['jaeger', 'tempo', 'honeycomb']).default('jaeger'),
  baseUrl: z.string().default('http://localhost:16686'),
  apiKey: z.string().optional(),
});

const PersonaSchema = z.object({
  name: z.string(),
  auth: z.record(z.string(), z.any()).prefault({}),
});

const SecuritySchema = z.object({
  idor: z.boolean().default(false),
  pii: z.boolean().default(false),
  authBypass: z.boolean().default(false),
});

const HarReplaySchema = z.object({
  enabled: z.boolean().default(false),
  harFile: z.string().default('./traffic.har'),
  anonymize: z.boolean().default(true),
});

// Top-level security checks (auth-bypass / privilege-escalation / PII). Distinct
// from the legacy probe.security booleans.
const SecurityChecksSchema = z.object({
  enabled: z.boolean().default(false),
  authBypass: z.boolean().default(true),
  pii: z.boolean().default(true),
  piiAllow: z.array(z.string()).default([]),
  personas: z.array(PersonaSchema).default([]),
  policies: z.record(z.string(), z.record(z.string(), z.number())).prefault({}),
});

// Read-only response assertions, keyed by "METHOD path".
const AssertionRuleSchema = z.object({
  field: z.string().optional(),
  present: z.boolean().optional(),
  type: z.string().optional(),
  in: z.array(z.any()).optional(),
  pattern: z.string().optional(),
  gte: z.number().optional(),
  lte: z.number().optional(),
  gt: z.number().optional(),
  lt: z.number().optional(),
  nonEmpty: z.boolean().optional(),
  minItems: z.number().optional(),
  maxItems: z.number().optional(),
}).passthrough();
const AssertionsSchema = z.record(z.string(), z.array(AssertionRuleSchema));

// Write-flow (CRUD-chain) testing — opt-in, mutating.
const WriteFlowStepSchema = z.object({
  method: z.string().optional(),
  path: z.string(),
  body: z.any().optional(),
}).passthrough();
const WriteFlowSchema = z.object({
  name: z.string().optional(),
  idField: z.string().optional(),
  create: WriteFlowStepSchema.optional(),
  read: WriteFlowStepSchema.optional(),
  update: WriteFlowStepSchema.optional(),
  delete: WriteFlowStepSchema.optional(),
}).passthrough();
const WriteFlowsSchema = z.object({
  enabled: z.boolean().default(false),
  flows: z.array(WriteFlowSchema).default([]),
});

// HAR import as an analyze-time discovery source (distinct from probe.harReplay,
// which only supplies request bodies).
const HarImportSchema = z.object({
  enabled: z.boolean().default(false),
  harFile: z.string().optional(),
});

const SchemathesisSchema = z.object({
  enabled: z.boolean().default(false),
  command: z.string().default('schemathesis'),
  timeoutMs: z.number().default(300000),
  hypothesisExamples: z.number().default(50),
});

const GraphqlSchema = z.object({
  endpoint: z.string().default('/graphql'),
  authToken: z.string().optional(),
});

const TrpcSchema = z.object({
  routerFile: z.string().default('./server/routers/index.ts'),
  endpoint: z.string().default('/api/trpc'),
});

const AnalyzeRuntimeSchema = z.object({
  enabled: z.boolean().default(false),
  browser: z.enum(['chromium', 'firefox', 'webkit']).default('chromium'),
  baseUrl: z.string().url().optional(),
  viewport: z.object({
    width: z.number().default(1280),
    height: z.number().default(720),
  }).prefault({}),
  navigationTimeoutMs: z.number().default(30000),
  captureWindowMs: z.number().default(5000),
  // Sign in the same way the probe does and send that header from the browser too, so pages behind a login can be traced.
  useProbeAuth: z.boolean().default(false),
  // Path to an existing Chromium when Playwright's own browser is not installed.
  executablePath: z.string().optional(),
  extraHTTPHeaders: z.record(z.string(), z.string()).optional(),
});

const LlmRepairSchema = z.object({
  enabled: z.boolean().default(false),
  provider: z.enum(['disabled', 'openai', 'anthropic', 'ollama']).default('disabled'),
  endpoint: z.string().optional(),
  apiKey: z.string().optional(),
  model: z.string().optional(),
  maxFileBytes: z.number().default(50000),
  maxLineDelta: z.number().default(5),
  maxCharDelta: z.number().default(200),
});

const AnalyzeSchema = z.object({
  runtime: AnalyzeRuntimeSchema.prefault({}),
  llmRepair: LlmRepairSchema.prefault({}),
  har: HarImportSchema.prefault({}),
});

const ProbeSchema = z.object({
  concurrency: z.number().default(5),
  delayMs: z.number().default(50),
  timeoutMs: z.number().default(10000),
  hardTimeoutMs: z.number().optional(),
  maxProbeMs: z.number().optional(),
  maxResponseBytes: z.number().optional(),
  idDiscovery: z.boolean().default(true),
  ignoreHTTPSErrors: z.boolean().default(false),
  skipPaths: z.array(z.string()).default(['^/auth/', '^/health/', '^/openapi', '^/docs']),
  expectedEmptyPaths: z.array(z.string()).default([]),
  generatedSamplePaths: z.array(z.string()).default([]),
  safePosts: z.array(z.string()).default([]),
  postBodyMode: z.enum(['empty', 'minimal', 'realistic', 'example', 'har']).default('minimal'),
  postBodyOverrides: z.record(z.string(), z.enum(['empty', 'minimal', 'realistic', 'example', 'har'])).prefault({}),
  pathParamValues: z.record(z.string(), z.string()).default({ id: '1' }),
  // Values for required query parameters, by name, when the spec gives none (for example { center_entity: 'host-1' }).
  queryParamValues: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).prefault({}),
  sse: SseSchema.prefault({}),
  ws: WsSchema.prefault({}),
  visual: VisualProbeSchema.prefault({}),
  otel: OtelSchema.prefault({}),
  personas: z.array(PersonaSchema).default([]),
  security: SecuritySchema.prefault({}),
  harReplay: HarReplaySchema.prefault({}),
  schemathesis: SchemathesisSchema.prefault({}),
});

const ScoringSchema = z.object({
  missingRoute: z.number().default(-50),
  emptyResponse: z.number().default(-20),
  authError: z.number().default(-30),
  serverError: z.number().default(-40),
  slowResponse: z.number().default(-10),
  disabledFeature: z.number().default(-15),
  schemaMismatch: z.number().default(-25),
  streamDead: z.number().default(-35),
  securityIssue: z.number().default(-50),
  assertionFailed: z.number().default(-30),
  preconditionGate: z.number().default(-30),
  unknown: z.number().default(-10),
});

const OutputSchema = z.object({
  dir: z.string().default('.qaprobe'),
  keepHistory: z.number().default(10),
  formats: z.array(z.enum(['json', 'markdown', 'ai-context', 'html'])).default(['json', 'markdown', 'ai-context', 'html']),
});

const ReportCoverageSchema = z.object({
  enabled: z.boolean().default(true),
  ignoreEndpointGlobs: z.array(z.string()).default([]),
});

const ReportSchema = z.object({
  coverage: ReportCoverageSchema.prefault({}),
  baselineRuns: z.number().default(20),
});

const ConfigSchema = z.object({
  // Target
  baseUrl: z.string().url('baseUrl must be a valid URL'),
  frontendApiPrefix: z.union([z.string(), z.array(z.string())]).default('/api'),
  framework: z.enum(['fastapi', 'express', 'nextjs', 'generic', 'graphql', 'trpc']).default('fastapi'),
  openApiUrl: z.string().default('/openapi.json'),
  openApiFile: z.string().nullable().default(null),
  featureStatusUrl: z.string().nullable().default('/health/features'),
  graphql: GraphqlSchema.prefault({}),
  trpc: TrpcSchema.prefault({}),

  // Frontend source
  frontendSrc: z.string().default('./frontend/src'),
  routerFile: z.string().default('./frontend/src/App.tsx'),
  apiClientFile: z.string().nullable().default(null),

  // Auth
  auth: AuthSchema.prefault({}),

  // Probe behavior
  analyze: AnalyzeSchema.prefault({}),
  probe: ProbeSchema.prefault({}),

  // Scoring
  scoring: ScoringSchema.prefault({}),

  // Output
  output: OutputSchema.prefault({}),

  // Report add-ons
  report: ReportSchema.prefault({}),

  // Security checks (auth-bypass / privilege-escalation / PII) — opt-in.
  security: SecurityChecksSchema.prefault({}),

  // Read-only response assertions, keyed by "METHOD path".
  assertions: AssertionsSchema.optional(),

  // Write-flow (CRUD-chain) testing — opt-in, mutating.
  writeFlows: WriteFlowsSchema.prefault({}),

  // Optional: relocate the feedback store (default <output.dir>/feedback.json).
  feedbackFile: z.string().optional(),

  // Optional: shell command to seed the database. Shown in empty_db fix hints.
  // Example: 'docker exec api python scripts/seed.py'
  //          'npm run db:seed'
  //          'make seed'
  seedCommand: z.string().optional(),

  // Optional: map path prefixes to custom HAS_* flag names for feature_flag_disabled hints.
  // Auto-derived as HAS_SOME_FEATURE from /some-feature when not specified.
  // Example: { '/credential-scanner': 'HAS_DEFAULT_CRED_SCANNER' }
  featureFlagMap: z.record(z.string(), z.string()).prefault({}),
});

module.exports = { ConfigSchema };
