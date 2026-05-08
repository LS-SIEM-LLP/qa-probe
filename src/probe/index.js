'use strict';

const { authenticate } = require('./authenticator');
const { collectEndpoints } = require('./sampler');
const { probeEndpoint } = require('./endpoint-runner');
const { checkSSE } = require('./sse-checker');
const { checkWS } = require('./ws-checker');
const { runConcurrent } = require('./rate-limiter');
const { createHttpClient } = require('../analyze/backend-fetcher');
const { saveProbeResults } = require('../cache');
const { snapshotSchemas } = require('./schema-history');
const { runVisualProbe } = require('./visual-probe');

async function runProbe(graph, config) {
  const http = createHttpClient(config);
  const spinner = createSpinner();

  // 1. Authenticate
  spinner.start('Authenticating...');
  let headers;
  try {
    headers = await authenticate(config, http);
    spinner.succeed('Authenticated');
  } catch (err) {
    spinner.fail(`Authentication failed: ${err.message}`);
    throw err;
  }

  // 2. Collect endpoints to probe
  const endpoints = collectEndpoints(graph, config);
  spinner.succeed(`Probing ${endpoints.length} endpoints...`);

  const results = {};

  // 3. Separate HTTP, SSE, WS
  const httpEndpoints = endpoints.filter(e => e.type === 'http');
  const sseEndpoints = endpoints.filter(e => e.type === 'sse');
  const wsEndpoints = endpoints.filter(e => e.type === 'ws');

  // 4. HTTP probing with concurrency limit
  let done = 0;
  const probeOne = async (endpoint) => {
    const result = await probeEndpoint(endpoint, headers, http, graph, config);
    const key = `${endpoint.method} ${endpoint.path}`;
    results[key] = result;
    done++;
    if (done % 10 === 0 || done === httpEndpoints.length) {
      spinner.start(`  Probing HTTP... ${done}/${httpEndpoints.length}`);
    }
    return result;
  };

  await runConcurrent(httpEndpoints, probeOne, {
    concurrency: config.probe.concurrency || 5,
    delayMs: config.probe.delayMs || 50,
  });
  spinner.succeed(`HTTP: ${httpEndpoints.length} endpoints probed`);

  // 5. SSE checking
  if (sseEndpoints.length > 0 && config.probe.sse && config.probe.sse.enabled) {
    spinner.start(`Checking ${sseEndpoints.length} SSE endpoint(s)...`);
    for (const ep of sseEndpoints) {
      const url = config.baseUrl.replace(/\/$/, '') + ep.path;
      const result = await checkSSE(url, headers, config);
      results[`SSE ${ep.path}`] = result;
    }
    spinner.succeed(`SSE: ${sseEndpoints.length} endpoint(s) checked`);
  }

  // 6. WS checking
  if (wsEndpoints.length > 0 && config.probe.ws && config.probe.ws.enabled) {
    spinner.start(`Checking ${wsEndpoints.length} WebSocket endpoint(s)...`);
    for (const ep of wsEndpoints) {
      const url = config.baseUrl.replace(/\/$/, '').replace(/^https?/, 'wss') + ep.path;
      const result = await checkWS(url, headers, config);
      results[`WS ${ep.path}`] = result;
    }
    spinner.succeed(`WS: ${wsEndpoints.length} endpoint(s) checked`);
  }

  // 7. Visual probing
  if (config.probe.visual && config.probe.visual.enabled) {
    spinner.start('Running visual probe...');
    const visual = await runVisualProbe(graph, results, config);
    Object.assign(results, visual.syntheticResults);
    results.__visual = {
      routes: visual.routeResults,
      warnings: visual.warnings,
    };
    const issueCount = Object.values(visual.routeResults).filter(item =>
      item.httpScore >= 80 && item.density < item.densityThreshold
    ).length;
    spinner.succeed(`Visual probe: ${Object.keys(visual.routeResults).length} route(s), ${issueCount} low-density issue(s)`);
  }

  // 8. Save results
  const schemaDrift = snapshotSchemas(results, config);
  if (schemaDrift.length > 0) {
    results.__schemaDrift = schemaDrift;
  }
  await saveProbeResults(results, config);
  spinner.succeed(`Probe results saved → ${config.output.dir}/probe-results.json`);

  return results;
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

module.exports = { runProbe };
