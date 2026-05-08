'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRemediations, renderFixes } = require('./index');

test('contract mismatch strategy emits one-line trailing slash diff with confidence 1.0', () => {
  const graph = {
    frontendRoutes: {
      '/users': {
        apiCalls: [{
          method: 'GET',
          path: '/api/users/',
          rawPath: '/api/users/',
          backendPath: '/users/',
          callSite: 'frontend/src/Users.tsx:4',
        }],
      },
    },
    backendRoutes: {
      'GET /users': {},
    },
  };
  const report = {
    endpointDiagnostics: [{
      endpoint: 'GET /users/',
      rootCause: 'contract_mismatch',
    }],
  };

  const fixes = buildRemediations(graph, {}, report, {});

  assert.equal(fixes.length, 1);
  assert.equal(fixes[0].confidence, 1.0);
  assert.equal(fixes[0].patch.before, '/api/users/');
  assert.equal(fixes[0].patch.after, '/api/users');
  assert.match(fixes[0].diff, /-\/api\/users\//);
  assert.match(fixes[0].diff, /\+\/api\/users/);
});

test('renderFixes includes confidence and diff text', () => {
  const output = renderFixes([{
    title: 'Align frontend path',
    confidence: 1,
    autoApply: true,
    diff: '--- a/file\n+++ b/file\n@@\n-old\n+new',
  }]);

  assert.match(output, /confidence=1\.00/);
  assert.match(output, /--- a\/file/);
});

test('low confidence remediation is suggestion-only', () => {
  const fixes = buildRemediations({}, {}, {
    endpointDiagnostics: [{ endpoint: 'GET /empty', rootCause: 'empty_db' }],
  }, {});

  assert.equal(fixes[0].autoApply, false);
  assert.ok(fixes[0].confidence < 0.8);
});
