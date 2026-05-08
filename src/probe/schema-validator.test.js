'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { validateSchema } = require('./schema-validator');
const { diffSchemaSnapshots } = require('./schema-history');
const { classifyEndpoint } = require('../report/root-cause');

describe('schema validation', () => {
  test('reports type mismatches from OpenAPI response schemas', () => {
    const schema = {
      type: 'object',
      required: ['created_at'],
      properties: { created_at: { type: 'string', format: 'date-time' } },
    };
    const result = validateSchema({ created_at: 1234567890 }, schema);
    assert.equal(result.ok, false);
    assert.match(result.errors[0], /Type mismatch.*created_at.*string.*number/);

    const cause = classifyEndpoint(
      'GET /cases',
      { status: 200, ms: 20, empty: false, schemaErrors: result.errors },
      { backendRoutes: {} },
      { probe: { timeoutMs: 10000 } },
    );
    assert.equal(cause.rootCause, 'type_mismatch');
    assert.ok(cause.fixHint.includes('field type'));
  });

  test('reports missing required fields', () => {
    const result = validateSchema({}, {
      type: 'object',
      required: ['email'],
      properties: { email: { type: 'string' } },
    });
    assert.equal(result.ok, false);
    assert.match(result.errors[0], /Missing required field: "email"/);
  });

  test('schema history detects breaking rename across runs', () => {
    const oldSnapshot = { 'GET /users': { type: 'object', fields: { user_name: 'string' } } };
    const newSnapshot = { 'GET /users': { type: 'object', fields: { username: 'string' } } };
    const changes = diffSchemaSnapshots(oldSnapshot, newSnapshot);
    assert.ok(changes.some(c => c.kind === 'breaking' && c.field === 'user_name'));
    assert.ok(changes.some(c => c.kind === 'additive' && c.field === 'username'));
  });

  test('schema history snapshots are written under history/schemas', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-probe-schema-history-'));
    const config = { output: { dir: path.join(root, '.qaprobe') } };
    const { snapshotSchemas } = require('./schema-history');
    snapshotSchemas({ 'GET /cases': { responseShape: { type: 'object', fields: { id: 'number' } } } }, config);
    assert.ok(fs.readdirSync(path.join(root, '.qaprobe', 'history', 'schemas')).length > 0);
  });
});
