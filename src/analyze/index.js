'use strict';

const { discoverFileRoutes } = require('./file-routes');

const { parseFrontendSrc } = require('./frontend-parser');
const { extractRoutes } = require('./route-extractor');
const { createHttpClient, getAdapter } = require('./backend-fetcher');
const { buildGraph } = require('./graph-builder');
const { saveGraph } = require('../cache');
const { createParseCache } = require('./parse-cache');
const { traceRuntimeRoutes } = require('./runtime-tracer');
const { harToRuntimeCalls } = require('./har-import');

async function runAnalyze(config, opts = {}) {
  const spinner = createSpinner();

  // 1. Parse frontend source
  spinner.start('Parsing frontend source files...');
  const warnings = [];
  const parseCache = createParseCache(config);
  const apiCalls = parseFrontendSrc(config.frontendSrc, {
    apiClientFile: config.apiClientFile,
    parseCache,
    warnings,
    llmRepair: config.analyze && config.analyze.llmRepair,
  });
  const frontendRoutes = extractRoutes(config.routerFile, config.frontendSrc, {
    parseCache,
    warnings,
  });
  // File-based routers (for example TanStack Router) have no <Route> tree to read.
  let fileRouteCount = 0;
  try {
    for (const [routePath, info] of discoverFileRoutes(config.frontendSrc)) {
      if (!frontendRoutes.has(routePath)) {
        frontendRoutes.set(routePath, { component: info.component, authGuard: info.authGuard, requiredScopes: info.requiredScopes });
        fileRouteCount++;
      }
    }
  } catch (err) {
    warnings.push({ message: `File-route discovery skipped: ${err.message}` });
  }
  parseCache.save();
  const discoveredClients = (apiCalls.clientNames || []).filter(
    n => !['api', 'apiClient', 'axios', 'client', 'http', 'axiosInstance', 'instance', 'httpClient', 'request', 'fetcher', 'apiV1', 'apiV2'].includes(n)
  );
  const clientNote = discoveredClients.length > 0 ? ` (auto-detected clients: ${discoveredClients.join(', ')})` : '';
  spinner.succeed(`Frontend: ${frontendRoutes.size} routes, ${apiCalls.allCalls.length} API calls found${clientNote}`);
  const sdkCallCount = apiCalls.allCalls.filter((c) => c.source === 'sdk').length;
  if (sdkCallCount) spinner.succeed(`  ${sdkCallCount} call(s) came from a generated API client`);
  if (fileRouteCount) spinner.succeed(`  ${fileRouteCount} route(s) came from file-based routing`);
  if (frontendRoutes.size === 0 || apiCalls.allCalls.length === 0) {
    spinner.warn(
      `Discovery found ${frontendRoutes.size} route(s) and ${apiCalls.allCalls.length} API call(s). ` +
      'That usually means qa-probe cannot read how this app is wired, not that nothing is wrong. ' +
      'Check frontendSrc and routerFile in your config, or record real traffic and import it ' +
      '(analyze.har), which works with any stack. Results below are not a clean bill of health.'
    );
  }

  let runtimeTrace = null;
  if (config.analyze && config.analyze.runtime && config.analyze.runtime.enabled) {
    if (config.analyze.runtime.useProbeAuth && !config.analyze.runtime.extraHTTPHeaders) {
      try {
        const { authenticate } = require('../probe/authenticator');
        const authHttp = createHttpClient(config);
        config.analyze.runtime.extraHTTPHeaders = await authenticate(config, authHttp);
      } catch (err) {
        warnings.push({ phase: 'runtime-trace', error: `Could not sign in for runtime tracing: ${err.message}` });
      }
    }
    spinner.start('Tracing frontend runtime network requests...');
    runtimeTrace = await traceRuntimeRoutes(frontendRoutes, config, { warnings });
    const runtimeCount = [...runtimeTrace.runtimeCalls.values()].reduce((sum, calls) => sum + calls.length, 0);
    spinner.succeed(`Runtime tracing: ${runtimeCount} API request(s) observed`);
  }

  // HAR import: discover endpoints from a captured .har file (for frontends too
  // dynamic to parse statically). Feeds the same runtimeCalls path as CDP tracing.
  const harCfg = (config.analyze && config.analyze.har) || {};
  if (harCfg.enabled && harCfg.harFile) {
    const harCalls = harToRuntimeCalls(harCfg.harFile, config);
    const harCount = [...harCalls.values()].reduce((sum, calls) => sum + calls.length, 0);
    if (harCount) {
      if (!runtimeTrace) {
        runtimeTrace = { runtimeCalls: harCalls, domSnapshots: null };
      } else {
        for (const [routePath, calls] of harCalls.entries()) {
          runtimeTrace.runtimeCalls.set(routePath, (runtimeTrace.runtimeCalls.get(routePath) || []).concat(calls));
        }
      }
      spinner.succeed(`HAR import: ${harCount} API request(s) from ${harCfg.harFile}`);
    } else {
      spinner.warn(`HAR import: no API requests found in ${harCfg.harFile}`);
    }
  }

  // 2. Fetch backend spec (or headless)
  let backendSpec;
  if (opts.headless) {
    spinner.start('Headless mode — skipping OpenAPI fetch...');
    backendSpec = { routes: {}, featureFlags: {}, headless: true, specUrl: null, framework: config.framework };
    spinner.succeed('Headless mode — will probe frontend-discovered URLs only');
  } else {
    spinner.start(`Fetching backend spec from ${config.baseUrl}${config.openApiUrl}...`);
    const http = createHttpClient(config);
    const adapter = getAdapter(config.framework);
    try {
      backendSpec = await adapter.fetchSpec(config, http);
      if (backendSpec.headless) {
        spinner.warn(`OpenAPI unavailable — running in headless mode`);
      } else {
        const routeCount = Object.keys(backendSpec.routes).length;
        const flagCount = Object.keys(backendSpec.featureFlags).length;
        spinner.succeed(`Backend: ${routeCount} routes, ${flagCount} feature flags`);
      }
    } catch (err) {
      spinner.fail(`Backend fetch failed: ${err.message}`);
      throw err;
    }
  }

  // 3. Build dependency graph
  spinner.start('Building dependency graph...');
  const graph = buildGraph({
    frontendRoutes,
    apiCalls,
    runtimeCalls: runtimeTrace && runtimeTrace.runtimeCalls,
    runtimeDomSnapshots: runtimeTrace && runtimeTrace.domSnapshots,
    backendSpec,
    config,
    warnings,
  });
  spinner.succeed('Dependency graph built');

  // 4. Save graph
  spinner.start('Saving graph...');
  await saveGraph(graph, config);
  spinner.succeed(`Graph saved → ${config.output.dir}/graph.json`);

  return graph;
}

function createSpinner() {
  // Use ora if available, else plain console
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

module.exports = { runAnalyze };
