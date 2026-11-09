'use strict';

// A tiny backend with no dependencies, used to try qa-probe in under two minutes.
//   node server.js              healthy
//   DEMO_BREAK=1 node server.js GET /alerts returns 500, so `qa-probe verify` shows a failure
const http = require('http');

const PORT = Number(process.env.PORT || 8765);
const BREAK = process.env.DEMO_BREAK === '1';

const openapi = {
  openapi: '3.0.0',
  info: { title: 'qa-probe demo backend', version: '1.0.0' },
  paths: {
    '/auth/login': { post: { responses: { 200: { description: 'ok' } } } },
    '/alerts': { get: { responses: { 200: { description: 'list of alerts', content: { 'application/json': { schema: { type: 'array', items: { type: 'object', properties: { id: { type: 'integer' }, title: { type: 'string' } } } } } } } } } },
    '/reports': { get: { responses: { 200: { description: 'reports' } } } },
    '/settings': { get: { responses: { 200: { description: 'settings', content: { 'application/json': { schema: { type: 'object', properties: { displayName: { type: 'string' } } } } } } } } },
  },
};

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

http.createServer((req, res) => {
  const url = (req.url || '').split('?')[0];
  if (url === '/openapi.json') return send(res, 200, openapi);
  if (url === '/auth/login' && req.method === 'POST') return send(res, 200, { access_token: 'demo-token' });
  if (req.headers.authorization !== 'Bearer demo-token') return send(res, 401, { detail: 'Not authenticated' });
  if (url === '/alerts') {
    if (BREAK) return send(res, 500, { detail: 'database connection lost' });
    return send(res, 200, [{ id: 1, title: 'Impossible travel' }, { id: 2, title: 'Password spray' }]);
  }
  if (url === '/reports') return send(res, 200, []);                       // empty on purpose
  if (url === '/settings') return send(res, 200, { display_name: 'Demo' }); // frontend expects displayName
  return send(res, 404, { detail: 'Not found' });
}).listen(PORT, '127.0.0.1', () => console.log(`demo backend on http://127.0.0.1:${PORT}${BREAK ? ' (DEMO_BREAK on)' : ''}`));
