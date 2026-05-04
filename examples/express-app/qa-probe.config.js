// qa-probe config for a typical Express + React app

module.exports = {
  baseUrl: 'http://localhost:3001',
  frontendApiPrefix: '/api',
  framework: 'express',
  openApiUrl: '/api-docs/swagger.json',
  featureStatusUrl: null,

  frontendSrc: './src',
  routerFile: './src/App.tsx',
  apiClientFile: './src/api/client.ts',

  auth: {
    type: 'bearer',
    loginUrl: '/api/auth/login',
    credentials: {
      username: process.env.QA_USER || 'test@example.com',
      password: process.env.QA_PASS || 'testpassword',
    },
    tokenPath: 'token',
  },

  probe: {
    concurrency: 5,
    delayMs: 100,
    timeoutMs: 8000,
    ignoreHTTPSErrors: false,
    skipPaths: ['^/auth/', '^/health'],
    safePosts: [],
    pathParamValues: { id: '1' },
    sse: { enabled: false, firstEventTimeoutMs: 5000, paths: [] },
    ws: { enabled: false, firstFrameTimeoutMs: 5000, paths: [] },
  },

  output: {
    dir: '.qaprobe',
    keepHistory: 5,
    formats: ['json', 'markdown', 'ai-context'],
  },
};
