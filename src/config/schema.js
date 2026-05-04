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

const ProbeSchema = z.object({
  concurrency: z.number().default(5),
  delayMs: z.number().default(50),
  timeoutMs: z.number().default(10000),
  ignoreHTTPSErrors: z.boolean().default(false),
  skipPaths: z.array(z.string()).default(['^/auth/', '^/health/', '^/openapi', '^/docs']),
  safePosts: z.array(z.string()).default([]),
  pathParamValues: z.record(z.string()).default({ id: '1' }),
  sse: SseSchema.default({}),
  ws: WsSchema.default({}),
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
});

const OutputSchema = z.object({
  dir: z.string().default('.qaprobe'),
  keepHistory: z.number().default(10),
  formats: z.array(z.enum(['json', 'markdown', 'ai-context'])).default(['json', 'markdown', 'ai-context']),
});

const ConfigSchema = z.object({
  // Target
  baseUrl: z.string().url('baseUrl must be a valid URL'),
  frontendApiPrefix: z.string().default('/api'),
  framework: z.enum(['fastapi', 'express', 'nextjs', 'generic']).default('fastapi'),
  openApiUrl: z.string().default('/openapi.json'),
  featureStatusUrl: z.string().nullable().default('/health/features'),

  // Frontend source
  frontendSrc: z.string().default('./frontend/src'),
  routerFile: z.string().default('./frontend/src/App.tsx'),
  apiClientFile: z.string().nullable().default(null),

  // Auth
  auth: AuthSchema.default({}),

  // Probe behavior
  probe: ProbeSchema.default({}),

  // Scoring
  scoring: ScoringSchema.default({}),

  // Output
  output: OutputSchema.default({}),
});

module.exports = { ConfigSchema };
