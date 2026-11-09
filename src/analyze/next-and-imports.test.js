'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { discoverFileRoutes, nextRoutePath } = require('./file-routes');
const { closureOf, resolveImport, routeFileFor, listSourceFiles } = require('./import-graph');
const { buildGraph } = require('./graph-builder');

function project(files) {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-probe-next-'));
  for (const [rel, text] of Object.entries(files)) {
    const file = path.join(src, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  return src;
}

test('Next.js route paths: dynamic, catch-all, groups and slots', () => {
  assert.strictEqual(nextRoutePath(['items', '[id]']), '/items/:id');
  assert.strictEqual(nextRoutePath(['(shop)', 'cart']), '/cart');
  assert.strictEqual(nextRoutePath(['docs', '[...slug]']), '/docs/:slug*');
  assert.strictEqual(nextRoutePath(['docs', '[[...slug]]']), '/docs/:slug*');
  assert.strictEqual(nextRoutePath(['@modal', 'photo']), '/photo');
  assert.strictEqual(nextRoutePath([]), '/');
});

test('Next.js app directory pages are found from page files only', () => {
  const src = project({
    'app/page.tsx': 'export default function Home() {}',
    'app/items/[id]/page.tsx': 'export default function Item() {}',
    'app/items/components.tsx': 'export const X = 1',
    'app/api/health/route.ts': 'export function GET() {}',
  });
  assert.deepStrictEqual([...discoverFileRoutes(src).keys()].sort(), ['/', '/items/:id']);
});

test('Next.js pages directory skips _app, _document and api', () => {
  const src = project({
    'pages/index.tsx': 'x', 'pages/about.tsx': 'x', 'pages/_app.tsx': 'x', 'pages/api/users.ts': 'x', 'pages/blog/[slug].tsx': 'x',
  });
  assert.deepStrictEqual([...discoverFileRoutes(src).keys()].sort(), ['/', '/about', '/blog/:slug']);
});

test('imports are followed through relative paths, aliases and index files', () => {
  const src = project({
    'pages/Orders.tsx': "import { Table } from '../components/Table'\nimport { useOrders } from '@/hooks/useOrders'",
    'components/Table.tsx': "import Row from './row'",
    'components/row.tsx': 'export default 1',
    'hooks/useOrders/index.ts': "import { api } from '../../api'",
    'api.ts': 'export const api = 1',
    'unrelated.ts': 'export const z = 1',
  });
  const files = closureOf(path.join(src, 'pages/Orders.tsx'), src);
  const names = [...files].map((f) => path.relative(src, f).split(path.sep).join('/')).sort();
  assert.deepStrictEqual(names, ['api.ts', 'components/Table.tsx', 'components/row.tsx', 'hooks/useOrders/index.ts', 'pages/Orders.tsx']);
  assert.strictEqual(resolveImport('react', path.join(src, 'a.ts'), src), null);
});

test('a call in a shared hook is attributed to the pages that use it', () => {
  const src = project({
    'pages/Orders.tsx': "import { useOrders } from '../hooks/useOrders'",
    'pages/Invoices.tsx': "import { useOrders } from '../hooks/useOrders'",
    'pages/Settings.tsx': 'export default 1',
    'hooks/useOrders.ts': 'export const useOrders = () => 1',
  });
  const hook = path.join(src, 'hooks/useOrders.ts');
  const frontendRoutes = new Map([
    ['/orders', { component: 'Orders', authGuard: 'Route', requiredScopes: [] }],
    ['/invoices', { component: 'Invoices', authGuard: 'Route', requiredScopes: [] }],
    ['/settings', { component: 'Settings', authGuard: 'Route', requiredScopes: [] }],
  ]);
  const call = { method: 'GET', path: '/api/orders', rawPath: '/api/orders', callSite: 'hooks/useOrders.ts:1' };
  const apiCalls = { byFile: new Map([[hook, [call]]]), allCalls: [call] };
  const graph = buildGraph({
    frontendRoutes,
    apiCalls,
    backendSpec: { routes: { 'GET /orders': {} }, featureFlags: {}, headless: false },
    config: { frontendSrc: src, frontendApiPrefix: '/api' },
  });
  assert.strictEqual(graph.frontendRoutes['/orders'].apiCalls.length, 1);
  assert.strictEqual(graph.frontendRoutes['/orders'].apiCalls[0].attributedVia, 'imports');
  assert.strictEqual(graph.frontendRoutes['/invoices'].apiCalls.length, 1);
  assert.strictEqual(graph.frontendRoutes['/settings'].apiCalls.length, 0);
  assert.deepStrictEqual(graph.blastRadius['GET /orders'].calledByRoutes.sort(), ['/invoices', '/orders']);
  assert.ok(!graph.frontendRoutes.__unmatched__ || graph.frontendRoutes.__unmatched__.apiCalls.length === 0);
});

test('a route file is found by component name', () => {
  const src = project({ 'pages/Orders.tsx': 'x', 'components/Other.tsx': 'x' });
  const files = listSourceFiles(src);
  assert.ok(routeFileFor({ component: 'Orders' }, files).endsWith('Orders.tsx'));
  assert.strictEqual(routeFileFor({ component: 'Nope' }, files), null);
});

test('a page behind a guard and a helper call is found, not the guard', () => {
  const { parse } = require('@babel/parser');
  const traverse = require('@babel/traverse').default;
  const src = project({
    'App.tsx': `
      const A = () => (
        <Routes>
          <Route path="alerts" element={<ScopeRoute scopes={['a']}>{feature('Alerts', <Alerts />)}</ScopeRoute>} />
          <Route path="plain" element={<Plain />} />
        </Routes>
      );`,
  });
  const { extractRoutes } = require('./route-extractor');
  const routes = extractRoutes(path.join(src, 'App.tsx'), src, {});
  assert.strictEqual(routes.get('/alerts').component, 'Alerts');
  assert.strictEqual(routes.get('/plain').component, 'Plain');
  void parse; void traverse;
});
