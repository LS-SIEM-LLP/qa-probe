'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { fillPathParams } = require('./sampler');

test('a UUID path parameter gets a well-formed UUID, not 1', () => {
  const route = { pathParamTypes: { item_id: { type: 'string', format: 'uuid' } } };
  assert.strictEqual(fillPathParams('/items/{item_id}', { probe: { pathParamValues: { id: '1' } } }, route), '/items/00000000-0000-4000-8000-000000000001');
});

test('an explicit value from the config wins, and other params still fall back to the default id', () => {
  const route = { pathParamTypes: { item_id: { type: 'string', format: 'uuid' } } };
  assert.strictEqual(fillPathParams('/items/{item_id}', { probe: { pathParamValues: { item_id: 'x9' } } }, route), '/items/x9');
  assert.strictEqual(fillPathParams('/cases/{case_id}', { probe: { pathParamValues: { id: '1' } } }), '/cases/1');
});
