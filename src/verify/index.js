'use strict';

/**
 * Verify a change against the running system.
 *
 * Given the files an AI agent (or a person) just edited, work out which pages and API
 * endpoints those files can affect, live-probe those endpoints, and return a verdict with
 * evidence. The verdict is honest about what it could not check:
 *
 *   pass          every affected endpoint was probed live and is healthy
 *   fail          at least one affected endpoint was probed live and is broken
 *   inconclusive  nothing could be mapped or probed, so nothing is proven either way
 *
 * Code-intelligence tools answer "what could this change affect?". This answers "does the
 * running system still work, with evidence?".
 */

const fs = require('fs');
const path = require('path');

function normalize(file) {
  return String(file || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

/** True when two relative paths refer to the same file, one being a suffix of the other. */
function sameFile(a, b) {
  const x = normalize(a);
  const y = normalize(b);
  if (!x || !y) return false;
  return x === y || x.endsWith('/' + y) || y.endsWith('/' + x);
}

function fileOfCallSite(callSite) {
  const text = String(callSite || '');
  if (text.startsWith('runtime:')) return null;
  return normalize(text.replace(/:(\d+|\?)$/, ''));
}

function baseName(file) {
  return path.posix.basename(normalize(file)).replace(/\.[^.]+$/, '').toLowerCase();
}

// ---- backend files: find the routes a changed server file defines -------------------------

const PY_DECORATOR = /@\s*\w+\s*\.\s*(get|post|put|patch|delete|head)\s*\(\s*(?:path\s*=\s*)?["']([^"']*)["']/gi;
const PY_PREFIX = /APIRouter\s*\([^)]*?prefix\s*=\s*["']([^"']*)["']/;
const JS_ROUTE = /\b(?:router|app|server)\s*\.\s*(get|post|put|patch|delete|head)\s*\(\s*["'`]([^"'`]*)["'`]/gi;

function shape(routePath) {
  return String(routePath || '').replace(/\{[^}]*\}/g, '{}').replace(/:[A-Za-z_]\w*/g, '{}').replace(/\/+$/, '') || '/';
}

/** [{ method, path }] for the routes a server source file declares (FastAPI-style and Express-style). */
function routesDeclaredIn(file, text) {
  const out = [];
  if (!text) return out;
  if (/\.py$/i.test(file)) {
    const prefix = (PY_PREFIX.exec(text) || [])[1] || '';
    PY_DECORATOR.lastIndex = 0;
    let m;
    while ((m = PY_DECORATOR.exec(text))) out.push({ method: m[1].toUpperCase(), path: shape(prefix + m[2]) });
  } else if (/\.(js|ts|mjs|cjs)$/i.test(file)) {
    JS_ROUTE.lastIndex = 0;
    let m;
    while ((m = JS_ROUTE.exec(text))) out.push({ method: m[1].toUpperCase(), path: shape(m[2]) });
  }
  return out;
}

/** True when a spec route (maybe mounted under an extra prefix) ends with the declared path. */
function routeMatches(routeKey, declared) {
  const [method, rawPath] = String(routeKey).split(' ');
  if (method !== declared.method) return false;
  const spec = shape(rawPath);
  return spec === declared.path || spec.endsWith(declared.path === '/' ? '/__never__' : declared.path);
}

function defaultReadFile(file) {
  try { return fs.readFileSync(path.resolve(process.cwd(), file), 'utf8'); } catch { return null; }
}

/**
 * Map changed files to affected backend endpoints using the cached graph.
 *
 *   call-site       a changed file contains an API call that the graph attributed to a page (strong)
 *   component-name  the changed file is named after a page component (weaker)
 *
 * Files that map to nothing are returned in `unmapped` instead of being guessed at.
 */
function selectAffected(graph, changedFiles, readFile = defaultReadFile) {
  const files = [...new Set((changedFiles || []).map(normalize).filter(Boolean))];
  const endpoints = new Map(); // routeKey -> { routeKey, routes:Set, reasons:Set, strength }
  const pages = new Map();     // route path -> { route, files:Set }
  const mapped = new Set();

  const addEndpoint = (routeKey, route, reason, strength) => {
    if (!routeKey) return;
    let entry = endpoints.get(routeKey);
    if (!entry) {
      entry = { routeKey, routes: new Set(), reasons: new Set(), strength: 'component-name' };
      endpoints.set(routeKey, entry);
    }
    entry.routes.add(route);
    entry.reasons.add(reason);
    if (strength === 'call-site') entry.strength = 'call-site';
    else if (strength === 'route-declaration' && entry.strength !== 'call-site') entry.strength = 'route-declaration';
  };

  const frontendRoutes = (graph && graph.frontendRoutes) || {};
  for (const [route, info] of Object.entries(frontendRoutes)) {
    const component = String((info && info.component) || '').toLowerCase();
    for (const file of files) {
      const fileHasCall = (info.apiCalls || []).some((call) => sameFile(fileOfCallSite(call.callSite), file));
      // A page component is a UI file; alerts.py is not the Alerts page.
      const componentMatch = component && /\.(tsx|jsx|vue|svelte)$/i.test(file) && baseName(file) === component;
      if (!fileHasCall && !componentMatch) continue;

      mapped.add(file);
      if (!pages.has(route)) pages.set(route, { route, files: new Set() });
      pages.get(route).files.add(file);

      for (const call of info.apiCalls || []) {
        if (!call.matchedBackendRoute) continue;
        if (fileHasCall && sameFile(fileOfCallSite(call.callSite), file)) {
          addEndpoint(call.matchedBackendRoute, route, `call in ${file}`, 'call-site');
        } else if (componentMatch) {
          addEndpoint(call.matchedBackendRoute, route, `page component ${info.component} changed`, 'component-name');
        }
      }
    }
  }

  // Changed server files: match the routes they declare to the spec's routes.
  const backendRoutes = Object.keys((graph && graph.backendRoutes) || {});
  for (const file of files) {
    const declared = routesDeclaredIn(file, readFile(file));
    for (const d of declared) {
      for (const routeKey of backendRoutes.filter((k) => routeMatches(k, d))) {
        mapped.add(file);
        const blast = ((graph.blastRadius || {})[routeKey] || {}).calledByRoutes || [];
        for (const route of blast.length ? blast : ['(no page calls this yet)']) {
          addEndpoint(routeKey, route, `route declared in ${file}`, 'route-declaration');
        }
        for (const route of blast) {
          if (!pages.has(route)) pages.set(route, { route, files: new Set() });
          pages.get(route).files.add(file);
        }
      }
    }
  }

  return {
    endpoints: [...endpoints.values()].map((e) => ({
      routeKey: e.routeKey,
      routes: [...e.routes],
      reasons: [...e.reasons],
      strength: e.strength,
    })),
    pages: [...pages.values()].map((p) => ({ route: p.route, files: [...p.files] })),
    unmapped: files.filter((f) => !mapped.has(f)),
  };
}

const HEALTHY_CAUSES = new Set(['ok', 'expected_empty', 'acknowledged']);

/** Turn one probe result into a verdict for that endpoint. */
function judgeProbe(probe, cause, endpointPath) {
  if (!probe) return { verdict: 'unverified', why: 'not probed' };
  const rootCause = (cause && cause.rootCause) || 'unknown';
  if (rootCause === 'not_probed') return { verdict: 'unverified', why: 'not probed' };
  if (rootCause === 'auth_scope_mismatch' || probe.status === 401 || probe.status === 403) {
    return { verdict: 'unverified', why: 'the test account is not allowed to call this endpoint (HTTP ' + probe.status + '), so it was not verified' };
  }
  if (rootCause === 'timeout' && /(stream|events|ws|socket|subscribe)/i.test(String(endpointPath || ''))) {
    return { verdict: 'unverified', why: 'looks like a long-lived stream, which a plain request cannot verify' };
  }
  if (rootCause === 'sample_unavailable' || rootCause === 'sample_not_found' || rootCause === 'invalid_sample_params') {
    return { verdict: 'unverified', why: 'no usable sample id to probe this endpoint' };
  }
  if ((rootCause === 'empty_db' || rootCause === 'no_data') && probe.status >= 200 && probe.status < 300) {
    return { verdict: 'unverified', why: 'returned HTTP 200 with no data, so working and empty cannot be told apart' };
  }
  if (HEALTHY_CAUSES.has(rootCause) && probe.status >= 200 && probe.status < 400) {
    return { verdict: 'ok', why: rootCause === 'expected_empty' ? 'healthy, empty result is expected' : 'healthy' };
  }
  if (probe.status === null || probe.status === undefined) {
    return { verdict: 'broken', why: probe.error || 'no response' };
  }
  return { verdict: 'broken', why: rootCause };
}

/**
 * Roll endpoint verdicts up to one answer.
 *   fail          something probed live is broken
 *   pass          at least one affected endpoint was verified healthy and none is broken
 *                 (anything not probed is listed separately and lowers the confidence)
 *   inconclusive  nothing affected could be verified
 */
function overallVerdict(results, selection) {
  if (!selection.endpoints.length) return 'inconclusive';
  if (results.some((r) => r.verdict === 'broken')) return 'fail';
  if (results.some((r) => r.verdict === 'ok')) return 'pass';
  return 'inconclusive';
}

/**
 * Verify a change. `deps` lets tests supply fake probing; real use takes the defaults.
 */
async function verifyChange({ changedFiles, graph, config, all = false }, deps = {}) {
  const startedAt = new Date().toISOString();
  if (!graph) {
    return {
      verdict: 'inconclusive',
      confidence: 'none',
      startedAt,
      reason: 'No graph is cached. Run `qa-probe analyze` first.',
      changedFiles: changedFiles || [],
      affectedPages: [],
      endpoints: [],
      unmapped: changedFiles || [],
      notChecked: ['everything: no graph'],
    };
  }

  const selection = all
    ? {
        endpoints: Object.keys(graph.backendRoutes || {}).map((routeKey) => ({
          routeKey, routes: ((graph.blastRadius || {})[routeKey] || {}).calledByRoutes || [], reasons: ['--all'], strength: 'call-site',
        })),
        pages: [],
        unmapped: [],
      }
    : selectAffected(graph, changedFiles, deps.readFile);

  const wanted = new Set(selection.endpoints.map((e) => e.routeKey));
  const collect = deps.collectEndpoints || require('../probe/sampler').collectEndpoints;
  const probeEndpoint = deps.probeEndpoint || require('../probe/endpoint-runner').probeEndpoint;
  const classify = deps.classifyEndpoint || require('../report/root-cause').classifyEndpoint;

  const probeable = collect(graph, config).filter((e) => e.type === 'http' && wanted.has(e.routeKey));
  const probedKeys = new Set(probeable.map((e) => e.routeKey));

  let headers = {};
  let http = null;
  const notChecked = [];
  if (probeable.length) {
    const makeClient = deps.createHttpClient || require('../analyze/backend-fetcher').createHttpClient;
    const authenticate = deps.authenticate || require('../probe/authenticator').authenticate;
    http = makeClient(config);
    try {
      headers = await authenticate(config, http);
    } catch (err) {
      return {
        verdict: 'inconclusive',
        confidence: 'none',
        startedAt,
        reason: `Authentication failed, so nothing could be probed: ${err.message}`,
        changedFiles: changedFiles || [],
        affectedPages: selection.pages,
        endpoints: [],
        unmapped: selection.unmapped,
        notChecked: ['all affected endpoints: authentication failed'],
      };
    }
  }

  // Detail routes (/items/{id}) need a real id. Probe the collection each one belongs to first,
  // take an id from its first item, and fill it in, as `qa-probe probe` does.
  const probedFor = new Map(); // "METHOD /path" -> raw result, so ids can be harvested
  const idd = deps.idDiscovery || require('../probe/id-discovery');
  const needIds = probeable.filter((e) => idd.hasPathParam(e.routeKey || e.path));
  if (needIds.length) {
    const have = new Set(probeable.map((e) => e.routeKey));
    const helpers = [];
    for (const endpoint of needIds) {
      const collection = String(endpoint.routeKey).replace(/\/\{[^}]+\}.*$/, '');
      // routeKey is "GET /items/{id}", so the collection is "GET /items" (or "GET /items/").
      const helperKey = collection.replace(/^\w+/, 'GET');
      const found = collect(graph, config).find((e) => e.type === 'http' && e.method === 'GET' && String(e.routeKey).replace(/\/+$/, '') === helperKey.replace(/\/+$/, ''));
      if (found && !have.has(found.routeKey) && !helpers.some((h) => h.routeKey === found.routeKey)) helpers.push(found);
    }
    for (const helper of helpers) {
      const result = await probeEndpoint(helper, headers, http, graph, config);
      probedFor.set(`${helper.method} ${helper.path}`, result);
    }
  }

  const results = [];
  const ordered = [...probeable.filter((e) => !idd.hasPathParam(e.routeKey || e.path)), ...needIds];
  for (const endpoint of ordered) {
    const meta = selection.endpoints.find((e) => e.routeKey === endpoint.routeKey);
    if (idd.hasPathParam(endpoint.routeKey || endpoint.path) && probedFor.size) {
      idd.applyDiscoveredIds([endpoint], idd.harvestCollectionItems(Object.fromEntries(probedFor)), config);
    }
    const probe = await probeEndpoint(endpoint, headers, http, graph, config);
    probedFor.set(`${endpoint.method} ${endpoint.path}`, probe);
    const key = `${endpoint.method} ${endpoint.path}`;
    const cause = classify(key, probe, graph, config);
    const judged = judgeProbe(probe, cause, endpoint.path);
    results.push({
      endpoint: endpoint.routeKey,
      probedAs: key,
      verdict: judged.verdict,
      why: judged.why,
      evidenceLevel: 'live-probe',
      mappingStrength: meta ? meta.strength : 'call-site',
      affectedPages: meta ? meta.routes : [],
      mappedBecause: meta ? meta.reasons : [],
      status: probe ? (probe.status === undefined ? null : probe.status) : null,
      ms: probe ? (probe.ms === undefined ? null : probe.ms) : null,
      rootCause: cause ? cause.rootCause : null,
      fixHint: (cause && cause.fixHint) || null,
      evidence: (probe && probe.evidence) || null,
    });
  }

  for (const e of selection.endpoints) {
    if (probedKeys.has(e.routeKey)) continue;
    results.push({
      endpoint: e.routeKey,
      probedAs: null,
      verdict: 'unverified',
      kind: /^(GET|HEAD)\b/.test(e.routeKey) ? 'not-probed' : 'write',
      why: /^(GET|HEAD)\b/.test(e.routeKey)
        ? 'not probed (skipped path, stream or no usable sample)'
        : 'write endpoint: qa-probe never changes data unless you allow it',
      evidenceLevel: 'static-only',
      mappingStrength: e.strength,
      affectedPages: e.routes,
      mappedBecause: e.reasons,
      status: null,
      ms: null,
      rootCause: null,
      fixHint: null,
      evidence: null,
    });
  }

  if (selection.unmapped.length) {
    notChecked.push(`files not mapped to any page or endpoint: ${selection.unmapped.join(', ')}`);
  }
  const writes = results.filter((r) => r.verdict === 'unverified' && r.kind === 'write').length;
  const other = results.filter((r) => r.verdict === 'unverified' && r.kind !== 'write').length;
  if (writes) notChecked.push(`${writes} write endpoint(s) were not exercised (qa-probe never changes data unless you allow it)`);
  if (other) notChecked.push(`${other} endpoint(s) could not be probed (skipped path, stream or no usable sample)`);

  const verdict = overallVerdict(results, selection);
  const strongOnly = results.length > 0 && results.every((r) => r.mappingStrength !== 'component-name');
  let confidence = 'none';
  if (verdict === 'fail') confidence = 'high';
  else if (verdict === 'pass') {
    const anyUnverified = results.some((r) => r.verdict === 'unverified');
    confidence = strongOnly && !selection.unmapped.length && !anyUnverified ? 'high' : 'medium';
  }
  else if (results.length) confidence = 'low';

  return {
    verdict,
    confidence,
    startedAt,
    finishedAt: new Date().toISOString(),
    changedFiles: changedFiles || [],
    affectedPages: selection.pages,
    endpoints: results,
    unmapped: selection.unmapped,
    notChecked,
    summary: summarize(verdict, results, selection),
  };
}

function summarize(verdict, results, selection) {
  const ok = results.filter((r) => r.verdict === 'ok').length;
  const broken = results.filter((r) => r.verdict === 'broken');
  const unverified = results.filter((r) => r.verdict === 'unverified').length;
  if (!selection.endpoints.length) {
    return 'The changed files did not map to any page or endpoint in the graph, so nothing could be verified. Run `qa-probe verify --all` for a full check.';
  }
  const head = verdict === 'pass' ? 'Verified healthy' : verdict === 'fail' ? 'A change broke something' : 'Could not verify the change';
  const parts = `${ok} healthy, ${broken.length} broken, ${unverified} not verified`;
  const detail = broken.length ? ` Broken: ${broken.map((b) => `${b.endpoint} (${b.why})`).join('; ')}.` : '';
  return `${head} (${parts}).${detail}`;
}

module.exports = { verifyChange, selectAffected, judgeProbe, overallVerdict, sameFile, routesDeclaredIn, routeMatches };
