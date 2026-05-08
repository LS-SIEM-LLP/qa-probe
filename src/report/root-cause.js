'use strict';

/**
 * Root cause classifier.
 * Rules applied in priority order — first match wins.
 *
 * Priority:
 *  1. feature_flag_disabled  — 404 + path prefix in featureFlags with included/enabled: false
 *  2. missing_route          — 404 + NOT in OpenAPI spec + not a disabled flag
 *  3. contract_mismatch      — fuzzy match finds backend route but exact path differs
 *  4. empty_db               — 200 + empty array/body + list endpoint
 *  5. auth_scope_mismatch    — 403
 *  6. type_mismatch          — 200 + data present + wrong field type
 *  7. missing_required_field — 200 + data present + required field absent
 *  8. field_renamed          — 200 + bidirectional drift indicates rename
 *  9. stream_dead            — SSE/WS connected=false OR no first event/frame
 * 10. server_error           — 5xx
 * 11. invalid_sample_params  — 400/422 from generated sample params/query
 * 12. sample_not_found       — 404 on a known templated backend route
 * 13. timeout                — request timed out/aborted
 * 14. slow_but_working       — 200 + ms > 80% of timeout
 * 15. ok                     — everything else
 */

const DISABLED_FEATURE_MAX_MS = 15; // 404 at <15ms → flag disabled

function classifyEndpoint(endpointKey, probeResult, graph, config) {
  if (!probeResult) return { rootCause: 'not_probed', rootCauseDetail: null, fixHint: null };

  const { status, ms, empty, schemaErrors, type, connected, error, routeKey } = probeResult;

  // --- Rule 7: stream_dead (SSE/WS) ---
  if (type === 'sse' || type === 'ws') {
    if (!connected || probeResult.status === 'error' || probeResult.status === 'timeout') {
      return {
        rootCause: 'stream_dead',
        rootCauseDetail: `${type.toUpperCase()} ${endpointKey}: ${error || 'not connected'}`,
        fixHint: 'Check streaming endpoint auth, server-side event emitter, and proxy config (nginx/traefik must allow SSE/WS passthrough).',
      };
    }
    if (probeResult.status === 'no_events' || probeResult.status === 'no_frames') {
      return {
        rootCause: 'stream_dead',
        rootCauseDetail: `${type.toUpperCase()} connected but no events delivered within timeout`,
        fixHint: 'Server is not emitting events. Check that the event loop/background task is running.',
      };
    }
    return { rootCause: 'ok', rootCauseDetail: null, fixHint: null };
  }

  // --- Rule 1: feature_flag_disabled ---
  if (status === 404 && ms < DISABLED_FEATURE_MAX_MS) {
    const flagInfo = findFeatureFlag(endpointKey, graph);
    if (flagInfo && (!flagInfo.included || !flagInfo.enabled)) {
      const flagName = getFlagName(endpointKey, graph);
      return {
        rootCause: 'feature_flag_disabled',
        rootCauseDetail: `${endpointKey} → 404 at ${ms}ms. Router not registered: ${flagInfo.message || 'feature flag disabled'}`,
        fixHint: flagName
          ? `Set ${flagName}=true in backend config (.env.prod or environment variables) and restart the API.`
          : 'Enable the corresponding HAS_* flag in backend config and restart the API.',
      };
    }
  }

  // --- Rule 3: contract_mismatch (checked before missing_route) ---
  // A fuzzy match is a better diagnosis than a generic "not found" — it tells the
  // developer exactly which route to align to, rather than leaving them to search.
  if (status === 404) {
    if (routeKey && /\{[^}]+\}/.test(routeKey)) {
      return {
        rootCause: 'sample_not_found',
        rootCauseDetail: `${endpointKey} -> 404 on known backend route ${routeKey}. The sampled path value probably does not exist.`,
        fixHint: 'Set probe.pathParamValues in qa-probe.config.js to IDs/slugs that exist in your demo or test database.',
      };
    }

    const fuzzyMatch = findFuzzyBackendMatch(endpointKey, graph);
    if (fuzzyMatch) {
      return {
        rootCause: 'contract_mismatch',
        rootCauseDetail: `${endpointKey} → 404. Similar route exists: ${fuzzyMatch}`,
        fixHint: 'Align the frontend call path to match the backend route. Check trailing slashes, prefix differences, or casing.',
      };
    }
  }

  // --- Rule 2: missing_route ---
  if (status === 404) {
    const inSpec = isInBackendSpec(endpointKey, graph);
    if (!inSpec) {
      return {
        rootCause: 'missing_route',
        rootCauseDetail: `${endpointKey} → 404. Not found in OpenAPI spec.`,
        fixHint: 'Check for typos in the frontend API call path or a missing include_router() in backend/app/main.py.',
      };
    }
  }

  // --- Rule 8: server_error ---
  if (status >= 500) {
    return {
      rootCause: 'server_error',
      rootCauseDetail: `${endpointKey} → ${status}. Backend returned a server error.`,
      fixHint: 'Check backend logs for a traceback (e.g. `docker logs <api-container> --tail 50`).',
    };
  }

  if (status === 400 || status === 422) {
    return {
      rootCause: 'invalid_sample_params',
      rootCauseDetail: `${endpointKey} -> ${status}. Generated probe parameters did not satisfy this endpoint's validation rules.`,
      fixHint: 'Tune probe.pathParamValues or skip this endpoint if it requires domain-specific query parameters.',
    };
  }

  // --- Rule 5: auth_scope_mismatch ---
  if (status === 403) {
    return {
      rootCause: 'auth_scope_mismatch',
      rootCauseDetail: `${endpointKey} → 403. Test user lacks required scopes.`,
      fixHint: 'Use a user with admin role, or check the required scopes for this endpoint in the backend.',
    };
  }

  if (status === 401) {
    return {
      rootCause: 'auth_scope_mismatch',
      rootCauseDetail: `${endpointKey} → 401. Authentication token rejected or expired.`,
      fixHint: 'Check that auth credentials are correct and the token has not expired.',
    };
  }

  if (status === 200) {
    // --- Rule 4: empty_db ---
    if (empty) {
      const seedCmd = config && config.seedCommand;
      const seedHint = seedCmd
        ? `Run: ${seedCmd}`
        : 'Run your project\'s seed or fixture script to populate test data (set seedCommand in qa-probe.config.js to show the exact command here).';
      return {
        rootCause: 'empty_db',
        rootCauseDetail: `${endpointKey} → 200 but ${probeResult.emptyReason || 'empty body'}. No records in database.`,
        fixHint: `Seed the database. ${seedHint}`,
      };
    }

    // --- Rule 6: schema_mismatch ---
    if (schemaErrors && schemaErrors.length > 0) {
      const schemaCause = classifySchemaError(schemaErrors[0]);
      return {
        rootCause: schemaCause.rootCause,
        rootCauseDetail: `${endpointKey} → 200 but response shape differs from spec: ${schemaErrors[0]}`,
        fixHint: schemaCause.fixHint,
      };
    }

    // --- Rule 9: slow_but_working ---
    const timeout = (config && config.probe && config.probe.timeoutMs) || 10000;
    if (ms > timeout * 0.8) {
      return {
        rootCause: 'slow_but_working',
        rootCauseDetail: `${endpointKey} → 200 but took ${ms}ms (${Math.round((ms / timeout) * 100)}% of timeout)`,
        fixHint: 'Consider adding a database index or query result caching.',
      };
    }

    return { rootCause: 'ok', rootCauseDetail: null, fixHint: null };
  }

  // Anything else — not probed or unknown
  if (status === null && error && /timeout|aborted|ECONNRESET|socket hang up/i.test(error)) {
    return {
      rootCause: 'timeout',
      rootCauseDetail: `${endpointKey} -> ${error}`,
      fixHint: 'Check whether the endpoint is long-running, streaming, calling an external model, or should be skipped/tuned for smoke tests.',
    };
  }

  return {
    rootCause: 'unknown',
    rootCauseDetail: `${endpointKey} → status=${status}, error=${error || 'none'}`,
    fixHint: null,
  };
}

function findFeatureFlag(endpointKey, graph) {
  const path = endpointKey.split(' ').slice(1).join(' ');
  for (const [prefix, flag] of Object.entries(graph.featureFlags || {})) {
    if (path === prefix || path.startsWith(prefix + '/') || path.startsWith(prefix)) {
      return flag;
    }
  }
  return null;
}

function classifySchemaError(error) {
  const message = String(error || '');
  if (/missing required field/i.test(message)) {
    return {
      rootCause: 'missing_required_field',
      fixHint: 'Return the required field from the backend response or update the OpenAPI schema if the contract changed intentionally.',
    };
  }
  if (/type mismatch/i.test(message)) {
    return {
      rootCause: 'type_mismatch',
      fixHint: 'Align the backend field type with OpenAPI, or update the spec and frontend parser for the new type.',
    };
  }
  if (/no expected fields found|renamed/i.test(message)) {
    return {
      rootCause: 'field_renamed',
      fixHint: 'A field appears to have been renamed. Align the frontend read, backend response, and OpenAPI field name.',
    };
  }
  return {
    rootCause: 'schema_mismatch',
    fixHint: 'A field was renamed or removed. Align the frontend component or backend response model.',
  };
}

function getFlagName(endpointKey, graph) {
  // Derive a probable HAS_* flag name from the path prefix using the
  // standard convention: /some-feature → HAS_SOME_FEATURE.
  // Projects can override this by adding a featureFlagMap to their config.
  const path = endpointKey.split(' ').slice(1).join(' ');
  const segment = path.split('/').filter(Boolean)[0];
  if (!segment) return null;

  // Check config-provided override map first (config.featureFlagMap)
  const configMap = (graph && graph.config && graph.config.featureFlagMap) || {};
  const prefix = '/' + segment;
  if (configMap[prefix]) return configMap[prefix];

  // Auto-derive: /some-feature-name → HAS_SOME_FEATURE_NAME
  return 'HAS_' + segment.toUpperCase().replace(/-/g, '_');
}

function isInBackendSpec(endpointKey, graph) {
  return !!(graph.backendRoutes && graph.backendRoutes[endpointKey]);
}

function findFuzzyBackendMatch(endpointKey, graph) {
  if (!graph.backendRoutes) return null;
  const [method, callPath] = endpointKey.split(' ');

  for (const routeKey of Object.keys(graph.backendRoutes)) {
    const [routeMethod, routePath] = routeKey.split(' ');
    if (routeMethod !== method) continue;

    // Check if stripping/adding trailing slash would match
    if (routePath === callPath + '/' || routePath + '/' === callPath) {
      return routeKey;
    }

    // Check if paths are the same ignoring case
    if (routePath.toLowerCase() === callPath.toLowerCase()) {
      return routeKey;
    }

    // Levenshtein-like: are they 1-2 path segments different?
    const callParts = callPath.split('/').filter(Boolean);
    const routeParts = routePath.split('/').filter(Boolean);
    if (Math.abs(callParts.length - routeParts.length) <= 1) {
      const shared = callParts.filter((p, i) => routeParts[i] === p || routeParts[i] === `{${p}}`);
      // Require at least 1 shared segment so fully-unrelated paths don't match.
      // When min segment count is N, allow at most 1 mismatch (N-1 shared required),
      // but never accept 0 shared segments regardless of length delta.
      if (shared.length >= 1 && shared.length >= Math.min(callParts.length, routeParts.length) - 1) {
        return routeKey;
      }
    }
  }

  return null;
}

/**
 * Cluster pass: if 5+ endpoints share the same path prefix and the same root cause,
 * group them under one shared root cause entry.
 */
function clusterRootCauses(endpointResults) {
  const prefixGroups = {};

  for (const [key, data] of Object.entries(endpointResults)) {
    const pathPart = key.split(' ').slice(1).join(' ');
    const prefix = '/' + pathPart.split('/').filter(Boolean)[0];
    if (!prefixGroups[prefix]) prefixGroups[prefix] = [];
    prefixGroups[prefix].push({ key, ...data });
  }

  const clusters = [];
  for (const [prefix, items] of Object.entries(prefixGroups)) {
    if (items.length < 5) continue;
    const causeCounts = {};
    for (const item of items) {
      causeCounts[item.rootCause] = (causeCounts[item.rootCause] || 0) + 1;
    }
    const dominantCause = Object.entries(causeCounts).sort((a, b) => b[1] - a[1])[0];
    if (dominantCause && dominantCause[1] >= 5) {
      clusters.push({
        prefix,
        rootCause: dominantCause[0],
        count: dominantCause[1],
        keys: items.map(i => i.key),
      });
    }
  }

  return clusters;
}

module.exports = { classifyEndpoint, clusterRootCauses, classifySchemaError };
