'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { verifyChange, selectAffected, sameFile } = require('./index');

const graph = {
  backendRoutes: {
    'GET /alerts': {},
    'GET /cases': {},
    'POST /cases': {},
  },
  blastRadius: {
    'GET /alerts': { calledByRoutes: ['/alerts'], calledByCount: 1 },
    'GET /cases': { calledByRoutes: ['/cases'], calledByCount: 1 },
  },
  frontendRoutes: {
    '/alerts': {
      component: 'Alerts',
      apiCalls: [{ method: 'GET', path: '/api/alerts', matchedBackendRoute: 'GET /alerts', callSite: 'components/AlertsApi.ts:12' }],
    },
    '/cases': {
      component: 'Cases',
      apiCalls: [
        { method: 'GET', path: '/api/cases', matchedBackendRoute: 'GET /cases', callSite: 'components/Cases.tsx:30' },
        { method: 'POST', path: '/api/cases', matchedBackendRoute: 'POST /cases', callSite: 'components/Cases.tsx:55' },
      ],
    },
  },
};

const config = { baseUrl: 'http://x', probe: { skipPaths: [], safePosts: [] } };

function fakeDeps(statusFor) {
  return {
    collectEndpoints: () => [
      { path: '/alerts', method: 'GET', routeKey: 'GET /alerts', type: 'http' },
      { path: '/cases', method: 'GET', routeKey: 'GET /cases', type: 'http' },
    ],
    createHttpClient: () => ({}),
    authenticate: async () => ({}),
    probeEndpoint: async (endpoint) => ({ status: statusFor(endpoint.routeKey), ms: 5, empty: false, schemaErrors: [], evidence: { request: { path: endpoint.path } } }),
    classifyEndpoint: (key, probe) => ({ rootCause: probe.status >= 500 ? 'server_error' : 'ok', fixHint: probe.status >= 500 ? 'check the server log' : null }),
  };
}

test('sameFile matches by path suffix and ignores separators', () => {
  assert.ok(sameFile('frontend/src/components/Cases.tsx', 'components/Cases.tsx'));
  assert.ok(sameFile('.\\components\\Cases.tsx', 'components/Cases.tsx'));
  assert.ok(!sameFile('components/Cases.tsx', 'components/OtherCases.tsx'));
});

test('a changed file with an API call maps to that endpoint with strong evidence', () => {
  const sel = selectAffected(graph, ['frontend/src/components/AlertsApi.ts']);
  assert.deepStrictEqual(sel.endpoints.map((e) => e.routeKey), ['GET /alerts']);
  assert.strictEqual(sel.endpoints[0].strength, 'call-site');
  assert.deepStrictEqual(sel.unmapped, []);
});

test('a page component file maps by name with weaker evidence', () => {
  const sel = selectAffected(graph, ['src/pages/Alerts.tsx']);
  assert.deepStrictEqual(sel.endpoints.map((e) => e.routeKey), ['GET /alerts']);
  assert.strictEqual(sel.endpoints[0].strength, 'component-name');
});

test('files that map to nothing are reported, not guessed', () => {
  const sel = selectAffected(graph, ['backend/app/routers/billing.py']);
  assert.deepStrictEqual(sel.endpoints, []);
  assert.deepStrictEqual(sel.unmapped, ['backend/app/routers/billing.py']);
});

test('pass: affected endpoint probed live and healthy', async () => {
  const res = await verifyChange({ changedFiles: ['components/AlertsApi.ts'], graph, config }, fakeDeps(() => 200));
  assert.strictEqual(res.verdict, 'pass');
  assert.strictEqual(res.confidence, 'high');
  assert.strictEqual(res.endpoints[0].evidenceLevel, 'live-probe');
});

test('fail: a broken endpoint fails the verdict with evidence and a hint', async () => {
  const res = await verifyChange({ changedFiles: ['components/AlertsApi.ts'], graph, config }, fakeDeps(() => 500));
  assert.strictEqual(res.verdict, 'fail');
  assert.strictEqual(res.endpoints[0].verdict, 'broken');
  assert.ok(res.endpoints[0].evidence);
  assert.strictEqual(res.endpoints[0].fixHint, 'check the server log');
});

test('inconclusive: nothing maps, and it says so instead of passing', async () => {
  const res = await verifyChange({ changedFiles: ['README.md'], graph, config }, fakeDeps(() => 200));
  assert.strictEqual(res.verdict, 'inconclusive');
  assert.ok(res.unmapped.includes('README.md'));
  assert.ok(res.summary.includes('nothing could be verified'));
});

test('a write endpoint that is not probed does not block a pass but lowers confidence and is listed', async () => {
  const res = await verifyChange({ changedFiles: ['components/Cases.tsx'], graph, config }, fakeDeps(() => 200));
  const post = res.endpoints.find((e) => e.endpoint === 'POST /cases');
  assert.strictEqual(post.verdict, 'unverified');
  assert.strictEqual(post.kind, 'write');
  assert.strictEqual(post.evidenceLevel, 'static-only');
  assert.strictEqual(res.verdict, 'pass');
  assert.strictEqual(res.confidence, 'medium');
  assert.ok(res.notChecked.some((n) => n.includes('write endpoint')));
});

test('only unverified endpoints means inconclusive, never a pass', async () => {
  const onlyWrites = { ...graph, frontendRoutes: { '/x': { component: 'X', apiCalls: [{ method: 'POST', path: '/api/cases', matchedBackendRoute: 'POST /cases', callSite: 'components/X.tsx:1' }] } } };
  const res = await verifyChange({ changedFiles: ['components/X.tsx'], graph: onlyWrites, config }, fakeDeps(() => 200));
  assert.strictEqual(res.verdict, 'inconclusive');
});

test('no graph: inconclusive with a clear next step', async () => {
  const res = await verifyChange({ changedFiles: ['a.ts'], graph: null, config });
  assert.strictEqual(res.verdict, 'inconclusive');
  assert.ok(res.reason.includes('qa-probe analyze'));
});

test('authentication failure is inconclusive, not a pass', async () => {
  const deps = fakeDeps(() => 200);
  deps.authenticate = async () => { throw new Error('bad login'); };
  const res = await verifyChange({ changedFiles: ['components/AlertsApi.ts'], graph, config }, deps);
  assert.strictEqual(res.verdict, 'inconclusive');
  assert.ok(res.reason.includes('Authentication failed'));
});

const { routesDeclaredIn, routeMatches, judgeProbe } = require('./index');

test('routes are read from a FastAPI router file, including its prefix', () => {
  const py = [
    'router = APIRouter(prefix="/cases", tags=["Cases"])',
    '@router.get("")',
    '@router.get("/{case_id}")',
    '@router.post("/{case_id}/resolve")',
  ].join('\n');
  assert.deepStrictEqual(routesDeclaredIn('backend/app/routers/cases.py', py), [
    { method: 'GET', path: '/cases' },
    { method: 'GET', path: '/cases/{}' },
    { method: 'POST', path: '/cases/{}/resolve' },
  ]);
});

test('routes are read from an Express file', () => {
  const js = "router.get('/users/:id', h);\napp.post('/login', h);";
  assert.deepStrictEqual(routesDeclaredIn('server/routes.js', js), [
    { method: 'GET', path: '/users/{}' },
    { method: 'POST', path: '/login' },
  ]);
});

test('a declared route matches the spec even when the spec mounts it under an extra prefix', () => {
  assert.ok(routeMatches('GET /api/v1/cases/{case_id}', { method: 'GET', path: '/cases/{}' }));
  assert.ok(!routeMatches('POST /cases/{case_id}', { method: 'GET', path: '/cases/{}' }));
  assert.ok(!routeMatches('GET /showcases', { method: 'GET', path: '/cases' }));
});

test('a changed backend file maps to the endpoints it declares and the pages that call them', async () => {
  const py = 'router = APIRouter(prefix="/alerts")\n@router.get("")\n';
  const res = await verifyChange(
    { changedFiles: ['backend/app/routers/alerts.py'], graph, config },
    { ...fakeDeps(() => 200), readFile: () => py },
  );
  assert.strictEqual(res.verdict, 'pass');
  assert.strictEqual(res.endpoints[0].endpoint, 'GET /alerts');
  assert.strictEqual(res.endpoints[0].mappingStrength, 'route-declaration');
  assert.deepStrictEqual(res.endpoints[0].affectedPages, ['/alerts']);
});

test('a 200 response with no data is not verified, and is never reported as broken', () => {
  const v = judgeProbe({ status: 200 }, { rootCause: 'empty_db' });
  assert.strictEqual(v.verdict, 'unverified');
});

test('a 403 for the test account and a timing-out stream are not failures', () => {
  assert.strictEqual(judgeProbe({ status: 403 }, { rootCause: 'auth_scope_mismatch' }, '/export/alerts').verdict, 'unverified');
  assert.strictEqual(judgeProbe({ status: null, error: 'timeout' }, { rootCause: 'timeout' }, '/alerts/stream').verdict, 'unverified');
  assert.strictEqual(judgeProbe({ status: null, error: 'timeout' }, { rootCause: 'timeout' }, '/alerts').verdict, 'broken');
});

test('a detail route is probed with an id taken from its collection', async () => {
  const idd = require('../probe/id-discovery');
  const g = {
    backendRoutes: { 'GET /items': {}, 'GET /items/{id}': {} },
    blastRadius: { 'GET /items/{id}': { calledByRoutes: ['/items'], calledByCount: 1 } },
    frontendRoutes: { '/items': { component: 'Items', apiCalls: [{ method: 'GET', path: '/api/items/1', matchedBackendRoute: 'GET /items/{id}', callSite: 'routes/items.tsx:3' }] } },
  };
  const seen = [];
  const deps = {
    collectEndpoints: () => [
      { path: '/items', method: 'GET', routeKey: 'GET /items', type: 'http' },
      { path: '/items/1', method: 'GET', routeKey: 'GET /items/{id}', type: 'http' },
    ],
    createHttpClient: () => ({}),
    authenticate: async () => ({}),
    idDiscovery: idd,
    probeEndpoint: async (endpoint) => {
      seen.push(endpoint.path);
      return endpoint.method === 'GET' && endpoint.path === '/items'
        ? { status: 200, empty: false, schemaErrors: [], firstItem: { id: 'real-42' }, routeKey: 'GET /items' }
        : { status: 200, empty: false, schemaErrors: [] };
    },
    classifyEndpoint: () => ({ rootCause: 'ok' }),
  };
  const res = await verifyChange({ changedFiles: ['routes/items.tsx'], graph: g, config: { baseUrl: 'http://x', probe: {} } }, deps);
  assert.ok(seen.includes('/items/real-42'), `expected the real id to be used, probed: ${seen.join(', ')}`);
  assert.strictEqual(res.verdict, 'pass');
});
