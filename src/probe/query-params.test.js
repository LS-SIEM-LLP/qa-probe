'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { sampleQueryParams, sampleValue } = require('./query-params');

const route = (queryParams) => ({ queryParams });

test('only required query parameters are sent, with type-appropriate values', () => {
  const out = sampleQueryParams(route([
    { name: 'center_entity', type: 'string', format: null, enum: null, default: null, example: null, minimum: null },
    { name: 'days', type: 'integer', format: null, enum: null, default: null, example: null, minimum: 7 },
    { name: 'flag', type: 'boolean', format: null, enum: null, default: null, example: null, minimum: null },
  ]), { probe: {} });
  assert.deepStrictEqual(out, { center_entity: 'qa-probe', days: 7, flag: false });
});

test('example, default and enum win over a type guess, in that order', () => {
  assert.strictEqual(sampleValue({ type: 'string', example: 'ex', default: 'df', enum: ['a'] }), 'ex');
  assert.strictEqual(sampleValue({ type: 'string', example: null, default: 'df', enum: ['a'] }), 'df');
  assert.strictEqual(sampleValue({ type: 'string', example: null, default: null, enum: ['a', 'b'] }), 'a');
});

test('the user can override a value, and a route with no required params sends nothing', () => {
  const r = route([{ name: 'center_entity', type: 'string', format: null, enum: null, default: null, example: null, minimum: null }]);
  assert.deepStrictEqual(sampleQueryParams(r, { probe: { queryParamValues: { center_entity: 'host-9' } } }), { center_entity: 'host-9' });
  assert.strictEqual(sampleQueryParams(route([]), { probe: {} }), undefined);
  assert.strictEqual(sampleQueryParams(null, { probe: {} }), undefined);
});

test('uuid and date formats get valid-looking values', () => {
  assert.match(sampleValue({ type: 'string', format: 'uuid' }), /^[0-9a-f-]{36}$/);
  assert.strictEqual(sampleValue({ type: 'string', format: 'date' }), '2026-01-01');
});
