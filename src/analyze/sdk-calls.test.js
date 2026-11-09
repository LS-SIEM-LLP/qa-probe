'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { discoverSdk, findSdkCalls, endpointFromBody } = require('./sdk-calls');
const { discoverFileRoutes, routePathFromTanstack } = require('./file-routes');

function project(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-probe-sdk-'));
  const src = path.join(root, 'frontend', 'src');
  for (const [rel, text] of Object.entries(files)) {
    const file = path.join(src, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  return { root, src };
}

const HEY_API = `
export class ItemsService {
    public static readItems<ThrowOnError extends boolean = true>(options?: Options<X, ThrowOnError>) {
        return (options?.client ?? client).get<A, B, ThrowOnError>({
            url: '/api/v1/items/',
            ...options
        });
    }
    public static deleteItem<ThrowOnError extends boolean = true>(options: Options<Y, ThrowOnError>) {
        return (options.client ?? client).delete<A, B, ThrowOnError>({
            url: '/api/v1/items/{id}',
            ...options
        });
    }
}
`;

const CODEGEN = `
export class UsersService {
  public static readUsers(data) {
    return __request(OpenAPI, { method: 'GET', url: '/users/' });
  }
}
`;

test('endpoint is read from a hey-api style function body', () => {
  assert.deepStrictEqual(endpointFromBody("client.post<A>({ url: '/x/y' })"), { method: 'POST', url: '/x/y' });
  assert.deepStrictEqual(endpointFromBody("__request(OpenAPI, { method: 'GET', url: '/u' })"), { method: 'GET', url: '/u' });
  assert.strictEqual(endpointFromBody('nothing here'), null);
});

test('uses of a generated service are counted as calls to the URL it requests', () => {
  const { src } = project({
    'client/sdk.gen.ts': HEY_API,
    'routes/items.tsx': "import { ItemsService } from '@/client'\nconst q = await ItemsService.readItems({})\nawait ItemsService.deleteItem({ path: { id: 1 } })\n",
  });
  const calls = findSdkCalls(src, discoverSdk(src), path.resolve(src, '..', '..'));
  assert.deepStrictEqual(calls.map((c) => `${c.method} ${c.path}`).sort(), ['DELETE /api/v1/items/{id}', 'GET /api/v1/items/']);
  assert.ok(calls.every((c) => c.source === 'sdk' && /routes\/items\.tsx:\d+$/.test(c.callSite)));
});

test('the older openapi-typescript-codegen style is understood too', () => {
  const { src } = project({ 'services/UsersService.ts': CODEGEN, 'pages/Users.tsx': 'UsersService.readUsers({})' });
  const calls = findSdkCalls(src, discoverSdk(src), path.resolve(src, '..', '..'));
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].method, 'GET');
});

test('functions that are not in the generated client are ignored', () => {
  const { src } = project({ 'client/sdk.gen.ts': HEY_API, 'a.tsx': 'ItemsService.notAThing({})' });
  assert.deepStrictEqual(findSdkCalls(src, discoverSdk(src), path.resolve(src, '..', '..')), []);
});

test('TanStack file routes drop pathless layout segments and turn $id into :id', () => {
  assert.strictEqual(routePathFromTanstack('/_layout/items'), '/items');
  assert.strictEqual(routePathFromTanstack('/_layout/'), '/');
  assert.strictEqual(routePathFromTanstack('/users/$userId'), '/users/:userId');
});

test('file routes are discovered from createFileRoute calls', () => {
  const { src } = project({
    'routes/_layout/items.tsx': 'export const Route = createFileRoute("/_layout/items")({})',
    'routes/login.tsx': "export const Route = createFileRoute('/login')({})",
  });
  assert.deepStrictEqual([...discoverFileRoutes(src).keys()].sort(), ['/items', '/login']);
});
