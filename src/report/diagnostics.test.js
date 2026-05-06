'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { buildEndpointDiagnostics } = require('./index.js');

describe('buildEndpointDiagnostics', () => {
  test('adds evidence, product label, severity, confidence, and affected routes', () => {
    const graph = {
      frontendRoutes: {
        '/alerts': {
          apiCalls: [
            { method: 'GET', backendPath: '/alerts/dedup' },
          ],
        },
      },
    };
    const probeResults = {
      'GET /alerts/dedup': {
        status: 200,
        ms: 42,
        empty: true,
        emptyReason: 'empty_array',
        itemCount: 0,
      },
    };
    const rootCauses = {
      'GET /alerts/dedup': {
        rootCause: 'empty_db',
        rootCauseDetail: 'GET /alerts/dedup -> 200 but empty_array.',
        fixHint: 'Seed demo data.',
      },
    };

    const diagnostics = buildEndpointDiagnostics(graph, probeResults, rootCauses);

    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].endpoint, 'GET /alerts/dedup');
    assert.equal(diagnostics[0].label, 'no_data');
    assert.equal(diagnostics[0].severity, 'low');
    assert.equal(diagnostics[0].confidence, 'medium');
    assert.deepEqual(diagnostics[0].affectedRoutes, ['/alerts']);
    assert.equal(diagnostics[0].emptyReason, 'empty_array');
  });

  test('marks unmatched unknown endpoint evidence as backend-only low confidence', () => {
    const diagnostics = buildEndpointDiagnostics(
      { frontendRoutes: {} },
      { 'GET /agent/report': { status: null, ms: 15000, error: 'timeout of 15000ms exceeded' } },
      { 'GET /agent/report': { rootCause: 'unknown', rootCauseDetail: 'timeout' } },
    );

    assert.equal(diagnostics[0].label, 'needs_review');
    assert.equal(diagnostics[0].confidence, 'low');
    assert.deepEqual(diagnostics[0].affectedRoutes, []);
    assert.equal(diagnostics[0].error, 'timeout of 15000ms exceeded');
  });
});
