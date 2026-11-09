// Try qa-probe on the bundled demo app. From this folder:
//   node server.js &                     (start the demo backend)
//   npx qa-probe doctor
//   npx qa-probe run
//   DEMO_BREAK=1 node server.js &        (restart it broken, then)
//   npx qa-probe verify --files frontend/src/components/Alerts.tsx
module.exports = {
  baseUrl: 'http://127.0.0.1:8765',
  frontendApiPrefix: '/api',
  framework: 'fastapi',
  openApiUrl: '/openapi.json',
  featureStatusUrl: null,
  frontendSrc: './frontend/src',
  routerFile: './frontend/src/App.tsx',
  auth: {
    type: 'bearer',
    loginUrl: '/auth/login',
    credentials: { username: 'demo', password: 'demo' },
    tokenPath: 'access_token',
  },
  output: { dir: '.qaprobe' },
};
