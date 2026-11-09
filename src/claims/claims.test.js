'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { buildClaims, liveStatusFor } = require('./index');

const graph = {
  frontendRoutes: {
    '/alerts': {
      component: 'Alerts',
      apiCalls: [
        { method: 'GET', path: '/api/alerts', matchedBackendRoute: 'GET /alerts', callSite: 'components/Alerts.tsx:10', source: 'ast' },
        { method: 'GET', path: '/api/ghost', backendPath: '/ghost', matchedBackendRoute: null, callSite: 'components/Alerts.tsx:20', source: 'ast' },
      ],
    },
    '/reports': {
      component: 'Reports',
      apiCalls: [{ method: 'GET', path: '/api/reports', matchedBackendRoute: 'GET /reports', callSite: 'runtime:/reports', source: 'runtime' }],
    },
  },
};

const probes = {
  'GET /alerts': { routeKey: 'GET /alerts', status: 200, empty: false, schemaErrors: [] },
  'GET /reports': { routeKey: 'GET /reports', status: 500 },
  __schemaDrift: [],
};

test('claims carry an evidence level and a live status', () => {
  const out = buildClaims(graph, probes);
  const alerts = out.pages.find((p) => p.page === '/alerts');
  assert.strictEqual(alerts.claims[0].evidence, 'static-only');
  assert.strictEqual(alerts.claims[0].live, 'healthy');
  const reports = out.pages.find((p) => p.page === '/reports');
  assert.strictEqual(reports.claims[0].evidence, 'runtime-observed');
  assert.strictEqual(reports.claims[0].live, 'broken');
});

test('a call with no matching backend route is flagged and never healthy', () => {
  const out = buildClaims(graph, probes);
  const ghost = out.pages.find((p) => p.page === '/alerts').claims[1];
  assert.strictEqual(ghost.matchedInSpec, false);
  assert.notStrictEqual(ghost.live, 'healthy');
  assert.strictEqual(out.pages.find((p) => p.page === '/alerts').unmatched, 1);
});

test('broken pages sort first and totals add up', () => {
  const out = buildClaims(graph, probes);
  assert.strictEqual(out.pages[0].page, '/reports');
  assert.strictEqual(out.totals.claims, 3);
  assert.strictEqual(out.totals.runtimeObserved, 1);
  assert.strictEqual(out.totals.staticOnly, 2);
  assert.strictEqual(out.totals.broken, 1);
});

test('the page filter narrows the output', () => {
  const out = buildClaims(graph, probes, { route: '/alerts' });
  assert.strictEqual(out.pages.length, 1);
});

test('empty, forbidden and missing results are never reported as healthy', () => {
  const map = (r) => new Map([['GET /x', r]]);
  assert.strictEqual(liveStatusFor('GET /x', map({ status: 200, empty: true })).status, 'unverified');
  assert.strictEqual(liveStatusFor('GET /x', map({ status: 403 })).status, 'unverified');
  assert.strictEqual(liveStatusFor('GET /y', map({ status: 200 })).status, 'not-probed');
});

test('a detail route that answers 404 or 422 to a guessed id is not reported as broken', () => {
  const map = (r) => new Map([['GET /cases/{case_id}', r]]);
  assert.strictEqual(liveStatusFor('GET /cases/{case_id}', map({ status: 404 })).status, 'unverified');
  assert.strictEqual(liveStatusFor('GET /cases/{case_id}', map({ status: 422 })).status, 'unverified');
  assert.strictEqual(liveStatusFor('GET /cases/{case_id}', map({ status: 500 })).status, 'broken');
});

test('the same relationship seen in source and in a browser is one claim, marked runtime-observed', () => {
  const g = {
    frontendRoutes: {
      '/alerts': {
        component: 'Alerts',
        apiCalls: [
          { method: 'GET', path: '/api/alerts', matchedBackendRoute: 'GET /alerts', callSite: 'components/Alerts.tsx:10', source: 'ast' },
          { method: 'GET', path: '/api/alerts', matchedBackendRoute: 'GET /alerts', callSite: 'runtime:/alerts', source: 'runtime' },
        ],
      },
    },
  };
  const out = buildClaims(g, {});
  assert.strictEqual(out.totals.claims, 1);
  assert.strictEqual(out.pages[0].claims[0].evidence, 'runtime-observed');
});

test('a generated-client call counts as source evidence, not runtime', () => {
  const g = { frontendRoutes: { '/items': { component: 'Items', apiCalls: [{ method: 'GET', path: '/api/v1/items/', matchedBackendRoute: 'GET /api/v1/items/', callSite: 'routes/items.tsx:5', source: 'sdk' }] } } };
  assert.strictEqual(buildClaims(g, {}).pages[0].claims[0].evidence, 'static-only');
});
