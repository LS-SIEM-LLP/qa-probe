'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { authenticate } = require('./authenticator');

function config(extra = {}) {
  return { framework: 'fastapi', auth: { type: 'bearer', loginUrl: '/login', credentials: { username: 'a', password: 'b' }, tokenPath: 'access_token', ...extra } };
}

function fakeHttp(handler) {
  const calls = [];
  return { calls, request: async (req) => { calls.push(req); return handler(req); } };
}

test('a JSON login is sent as JSON', async () => {
  const http = fakeHttp(() => ({ status: 200, data: { access_token: 't1' } }));
  assert.deepStrictEqual(await authenticate(config(), http), { Authorization: 'Bearer t1' });
  assert.deepStrictEqual(http.calls[0].data, { username: 'a', password: 'b' });
  assert.strictEqual(http.calls.length, 1);
});

test('auto: a 422 on the JSON login is retried as an OAuth2 password form', async () => {
  const http = fakeHttp((req) => (typeof req.data === 'string' ? { status: 200, data: { access_token: 't2' } } : { status: 422, data: {} }));
  assert.deepStrictEqual(await authenticate(config(), http), { Authorization: 'Bearer t2' });
  assert.strictEqual(http.calls.length, 2);
  assert.strictEqual(http.calls[1].data, 'username=a&password=b');
  assert.strictEqual(http.calls[1].headers['Content-Type'], 'application/x-www-form-urlencoded');
});

test('loginFormat form sends a form straight away, json never retries', async () => {
  const form = fakeHttp(() => ({ status: 200, data: { access_token: 't3' } }));
  await authenticate(config({ loginFormat: 'form' }), form);
  assert.strictEqual(form.calls.length, 1);
  assert.strictEqual(typeof form.calls[0].data, 'string');

  const json = fakeHttp(() => ({ status: 422, data: {} }));
  await assert.rejects(() => authenticate(config({ loginFormat: 'json' }), json), /Authentication failed: 422/);
  assert.strictEqual(json.calls.length, 1);
});

test('a real failure still says so', async () => {
  const http = fakeHttp(() => ({ status: 401, statusText: 'Unauthorized', data: {} }));
  await assert.rejects(() => authenticate(config(), http), /Authentication failed: 401/);
});
