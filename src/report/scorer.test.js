'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { scoreRoute } = require('./scorer');

test('a failing endpoint lowers the page score even when the call path carries a different prefix', () => {
  const route = { apiCalls: [{ method: 'GET', path: '/api/v1/items/', backendPath: '/v1/items/', matchedBackendRoute: 'GET /api/v1/items/' }] };
  const probeResults = { 'GET /api/v1/items/': { status: 500, routeKey: 'GET /api/v1/items/' } };
  const rootCauses = { 'GET /api/v1/items/': { rootCause: 'server_error' } };
  const out = scoreRoute('/items', route, probeResults, rootCauses, { scoring: {} });
  assert.ok(out.score < 100, `expected a penalty, got ${out.score}`);
  assert.strictEqual(out.primaryCause, 'server_error');
});

test('detail routes are matched through the spec route, not the filled path', () => {
  const route = { apiCalls: [{ method: 'GET', path: '/api/v1/items/{id}', backendPath: '/v1/items/{id}', matchedBackendRoute: 'GET /api/v1/items/{id}' }] };
  const probeResults = { 'GET /api/v1/items/abc': { status: 500, routeKey: 'GET /api/v1/items/{id}' } };
  const rootCauses = { 'GET /api/v1/items/abc': { rootCause: 'server_error' } };
  assert.ok(scoreRoute('/items', route, probeResults, rootCauses, { scoring: {} }).score < 100);
});

test('an endpoint that was never probed is still skipped, not penalised', () => {
  const route = { apiCalls: [{ method: 'GET', path: '/x', matchedBackendRoute: 'GET /x' }] };
  assert.strictEqual(scoreRoute('/x', route, {}, {}, { scoring: {} }).score, 100);
});
