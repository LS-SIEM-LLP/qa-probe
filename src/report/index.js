'use strict';

const { classifyEndpoint, clusterRootCauses } = require('./root-cause');
const { scoreRoute, scoreOverall } = require('./scorer');
const { getBlastRadiusSummary } = require('./blast-radius');
const { detectRegression } = require('./regression');
const { writeJsonReport } = require('./formatters/json');
const { writeMarkdownReport } = require('./formatters/markdown');
const { writeAiContext } = require('./formatters/ai-context');
const { saveReport } = require('../cache');
const { loadPreviousRun, saveToHistory } = require('../cache/history');

async function runReport(graph, probeResults, config) {
  const spinner = createSpinner();

  // 1. Classify every probed endpoint
  spinner.start('Classifying root causes...');
  const endpointRootCauses = {};
  for (const [endpointKey, probe] of Object.entries(probeResults || {})) {
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
    const scored = scoreRoute(routePath, routeData, probeResults, endpointRootCauses, config);
    routeScores[routePath] = scored;
  }
  const overallScore = scoreOverall(routeScores);
  spinner.succeed(`Routes scored — overall: ${overallScore}/100`);

  // 3. Blast radius
  const blastRadius = getBlastRadiusSummary(graph, probeResults, endpointRootCauses);

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
    clusters,
    regression: null,
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

  spinner.succeed(`Reports written to ${config.output.dir}/`);

  return report;
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

module.exports = { runReport };
