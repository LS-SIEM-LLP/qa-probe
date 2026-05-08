'use strict';

const { classifyEndpoint, clusterRootCauses } = require('./root-cause');
const { scoreRoute, scoreOverall } = require('./scorer');
const { getBlastRadiusSummary } = require('./blast-radius');
const { detectRegression } = require('./regression');
const { writeJsonReport } = require('./formatters/json');
const { writeMarkdownReport } = require('./formatters/markdown');
const { writeAiContext } = require('./formatters/ai-context');
const { writeHtmlReport } = require('./formatters/html');
const { saveReport } = require('../cache');
const { loadPreviousRun, saveToHistory } = require('../cache/history');

async function runReport(graph, probeResults, config) {
  const spinner = createSpinner();
  const effectiveProbeResults = enrichProbeResultsWithRouteKeys(graph, probeResults, config);

  // 1. Classify every probed endpoint
  spinner.start('Classifying root causes...');
  const endpointRootCauses = {};
  for (const [endpointKey, probe] of Object.entries(effectiveProbeResults || {})) {
    if (endpointKey.startsWith('__')) continue;
    endpointRootCauses[endpointKey] = classifyEndpoint(endpointKey, probe, graph, config);
  }

  // Cluster pass for groups of 5+ failures
  const clusters = clusterRootCauses(endpointRootCauses);
  spinner.succeed(`Root causes classified (${Object.keys(endpointRootCauses).length} endpoints, ${clusters.length} clusters)`);

  // 2. Score each frontend route
  spinner.start('Scoring routes...');
  const routeScores = {};
  for (const [routePath, routeData] of Object.entries(graph.frontendRoutes || {})) {
    if (routePath === '__unmatched__') continue;
    const scored = scoreRoute(routePath, routeData, effectiveProbeResults, endpointRootCauses, config);
    routeScores[routePath] = scored;
  }
  const overallScore = scoreOverall(routeScores);
  spinner.succeed(`Routes scored — overall: ${overallScore}/100`);

  // 3. Blast radius
  const blastRadius = getBlastRadiusSummary(graph, effectiveProbeResults, endpointRootCauses);

  // 3b. Endpoint-level diagnostics. These are the product evidence layer:
  // route scores answer "is my page healthy?", diagnostics answer "what did
  // qa-probe actually observe on the wire?"
  const endpointDiagnostics = buildEndpointDiagnostics(graph, effectiveProbeResults, endpointRootCauses);

  // 4. Root cause summary (aggregate by type)
  const rootCauseSummary = {};
  for (const [endpointKey, cause] of Object.entries(endpointRootCauses)) {
    const rc = cause.rootCause;
    if (rc === 'ok' || !rc) continue;
    if (!rootCauseSummary[rc]) rootCauseSummary[rc] = { count: 0, affectedRoutes: [] };
    rootCauseSummary[rc].count++;

    // Find which frontend routes call this endpoint
    for (const [routePath, routeData] of Object.entries(graph.frontendRoutes || {})) {
      const calls = routeData.apiCalls || [];
      const hits = calls.filter(c => {
        const k = `${c.method} ${c.backendPath || c.path}`;
        return k === endpointKey;
      });
      if (hits.length > 0 && !rootCauseSummary[rc].affectedRoutes.includes(routePath)) {
        rootCauseSummary[rc].affectedRoutes.push(routePath);
      }
    }
  }

  // 5. Build routes output (with root cause detail per route)
  const routesOut = {};
  for (const [routePath, scored] of Object.entries(routeScores)) {
    const routeData = graph.frontendRoutes[routePath] || {};
    const apiCalls = routeData.apiCalls || [];

    // Find the worst endpoint cause for this route
    let worstCause = null;
    let worstDetail = null;
    let fixHint = null;
    for (const call of apiCalls) {
      const epKey = `${call.method} ${call.backendPath || call.path}`;
      const cause = endpointRootCauses[epKey];
      if (cause && cause.rootCause !== 'ok') {
        if (!worstCause) {
          worstCause = cause.rootCause;
          worstDetail = cause.rootCauseDetail;
          fixHint = cause.fixHint;
        }
      }
    }

    routesOut[routePath] = {
      score: scored.score,
      status: scored.status,
      rootCause: scored.primaryCause || worstCause || 'ok',
      rootCauseDetail: worstDetail,
      fixHint,
      apiCallCount: apiCalls.length,
    };
  }

  // 6. Regression detection
  const previousRun = loadPreviousRun(config);
  const report = {
    meta: {
      generatedAt: new Date().toISOString(),
      baseUrl: config.baseUrl,
      headless: graph.meta && graph.meta.headless,
    },
    overallScore,
    routes: routesOut,
    rootCauseSummary,
    blastRadius,
    endpointDiagnostics,
    clusters,
    regression: null,
    parseWarnings: graph.warnings || [],
    schemaDrift: (probeResults && probeResults.__schemaDrift) || [],
  };

  const regression = detectRegression(report, previousRun);
  report.regression = regression;

  // 7. Save history + report
  saveToHistory(report, config);
  await saveReport(report, config);

  // 8. Write requested formats
  const formats = (config.output && config.output.formats) || ['json', 'markdown', 'ai-context'];
  if (formats.includes('json')) writeJsonReport(report, config);
  if (formats.includes('markdown')) writeMarkdownReport(report, config);
  if (formats.includes('ai-context')) writeAiContext(report, graph, config);
  if (formats.includes('html')) writeHtmlReport(report, config);

  spinner.succeed(`Reports written to ${config.output.dir}/`);

  return report;
}

function enrichProbeResultsWithRouteKeys(graph, probeResults, config) {
  const enriched = {};
  for (const [endpointKey, probe] of Object.entries(probeResults || {})) {
    enriched[endpointKey] = {
      ...probe,
      routeKey: probe.routeKey || findRouteKeyForEndpoint(endpointKey, graph, config),
    };
  }
  return enriched;
}

function findRouteKeyForEndpoint(endpointKey, graph, config) {
  const firstSpace = endpointKey.indexOf(' ');
  if (firstSpace === -1) return null;
  const method = endpointKey.slice(0, firstSpace);
  const endpointPath = endpointKey.slice(firstSpace + 1);
  const endpointPathNoQuery = endpointPath.split('?')[0];
  const paramValues = (config && config.probe && config.probe.pathParamValues) || {};

  for (const routeKey of Object.keys((graph && graph.backendRoutes) || {})) {
    const routeSpace = routeKey.indexOf(' ');
    if (routeSpace === -1) continue;
    const routeMethod = routeKey.slice(0, routeSpace);
    if (routeMethod !== method) continue;
    const routePath = routeKey.slice(routeSpace + 1);
    if (routePath === endpointPath || routePath === endpointPathNoQuery) return routeKey;
    if (fillPathParams(routePath, paramValues) === endpointPathNoQuery) return routeKey;
  }

  return null;
}

function fillPathParams(routePath, paramValues) {
  return routePath.replace(/\{([^}]+)\}/g, (_, name) => {
    return paramValues[name] || paramValues.id || '1';
  });
}

function buildEndpointDiagnostics(graph, probeResults, endpointRootCauses) {
  const routeIndex = buildEndpointRouteIndex(graph);

  return Object.entries(endpointRootCauses || {})
    .filter(([, cause]) => cause && cause.rootCause && cause.rootCause !== 'ok')
    .map(([endpointKey, cause]) => {
      const probe = (probeResults && probeResults[endpointKey]) || {};
      const affectedRoutes = routeIndex[endpointKey] || [];
      return {
        endpoint: endpointKey,
        rootCause: cause.rootCause,
        label: displayCause(cause.rootCause),
        severity: severityFor(cause.rootCause),
        confidence: confidenceFor(cause.rootCause, probe),
        affectedRoutes,
        affectedRouteCount: affectedRoutes.length,
        status: probe.status === undefined ? null : probe.status,
        ms: probe.ms === undefined ? null : probe.ms,
        empty: !!probe.empty,
        emptyReason: probe.emptyReason || null,
        itemCount: probe.itemCount === undefined ? null : probe.itemCount,
        error: probe.error || null,
        detail: cause.rootCauseDetail || null,
        fixHint: cause.fixHint || null,
      };
    })
    .sort((a, b) => {
      const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
      return (severityOrder[a.severity] - severityOrder[b.severity]) ||
        (b.affectedRouteCount - a.affectedRouteCount) ||
        a.endpoint.localeCompare(b.endpoint);
    });
}

function buildEndpointRouteIndex(graph) {
  const index = {};
  for (const [routePath, routeData] of Object.entries((graph && graph.frontendRoutes) || {})) {
    const calls = routeData.apiCalls || [];
    for (const call of calls) {
      const endpointKey = `${call.method} ${call.backendPath || call.path}`;
      if (!index[endpointKey]) index[endpointKey] = [];
      if (!index[endpointKey].includes(routePath)) index[endpointKey].push(routePath);
    }
  }
  return index;
}

function displayCause(rootCause) {
  const labels = {
    empty_db: 'no_data',
    contract_mismatch: 'contract_mismatch',
    missing_route: 'missing_route',
    server_error: 'server_error',
    auth_scope_mismatch: 'auth_scope_mismatch',
    schema_mismatch: 'schema_mismatch',
    type_mismatch: 'type_mismatch',
    missing_required_field: 'missing_required_field',
    field_renamed: 'field_renamed',
    stream_dead: 'stream_dead',
    slow_but_working: 'slow_but_working',
    feature_flag_disabled: 'feature_flag_disabled',
    sample_not_found: 'sample_not_found',
    invalid_sample_params: 'invalid_sample',
    timeout: 'timeout',
    unknown: 'needs_review',
  };
  return labels[rootCause] || rootCause || 'needs_review';
}

function severityFor(rootCause) {
  switch (rootCause) {
    case 'server_error':
    case 'missing_route':
    case 'contract_mismatch':
    case 'auth_scope_mismatch':
    case 'schema_mismatch':
    case 'type_mismatch':
    case 'missing_required_field':
    case 'field_renamed':
    case 'stream_dead':
      return 'high';
    case 'feature_flag_disabled':
    case 'slow_but_working':
    case 'unknown':
    case 'sample_not_found':
    case 'invalid_sample_params':
    case 'timeout':
      return 'medium';
    case 'empty_db':
      return 'low';
    default:
      return 'info';
  }
}

function confidenceFor(rootCause, probe) {
  if (rootCause === 'empty_db') return 'medium';
  if (rootCause === 'unknown') return 'low';
  if (rootCause === 'sample_not_found') return 'high';
  if (rootCause === 'invalid_sample_params') return 'medium';
  if (rootCause === 'timeout') return 'medium';
  if (probe && probe.status === null) return 'medium';
  return 'high';
}

function createSpinner() {
  try {
    const ora = require('ora');
    const s = ora({ spinner: 'dots' });
    return {
      start: (msg) => s.start(msg),
      succeed: (msg) => s.succeed(msg),
      fail: (msg) => s.fail(msg),
      warn: (msg) => s.warn(msg),
    };
  } catch {
    return {
      start: (msg) => process.stdout.write(`  ... ${msg}\n`),
      succeed: (msg) => process.stdout.write(`  ✓ ${msg}\n`),
      fail: (msg) => process.stderr.write(`  ✗ ${msg}\n`),
      warn: (msg) => process.stdout.write(`  ⚠ ${msg}\n`),
    };
  }
}

module.exports = { runReport, buildEndpointDiagnostics };
