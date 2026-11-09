'use strict';

/**
 * Fill path parameters in a route pattern.
 * /items/{id}/tags → /items/1/tags (using pathParamValues from config)
 */
function fillPathParams(routePath, config, routeInfo) {
  const paramValues = (config.probe && config.probe.pathParamValues) || {};
  const types = (routeInfo && routeInfo.pathParamTypes) || {};
  return routePath.replace(/\{([^}]+)\}/g, (_, name) => {
    if (paramValues[name]) return paramValues[name];
    // A guessed "1" is rejected outright (422) when the id is a UUID, so use a well-formed one.
    const t = types[name] || {};
    if (t.format === 'uuid') return '00000000-0000-4000-8000-000000000001';
    return paramValues['id'] || '1';
  });
}

/**
 * Collect all unique backend paths that need probing.
 * Includes:
 *   - All paths matched by frontend API calls (from graph)
 *   - Direct paths discovered in headless mode
 * Excludes:
 *   - skipPaths patterns
 *   - non-safe POST/PUT/DELETE endpoints
 */
function collectEndpoints(graph, config) {
  const skipPatterns = (config.probe.skipPaths || []).map(p => new RegExp(p));
  const safePosts = new Set((config.probe.safePosts || []).map(p => p.toLowerCase()));
  const sseConfigPaths = new Set((config.probe.sse && config.probe.sse.paths) || []);
  const wsConfigPaths = new Set((config.probe.ws && config.probe.ws.paths) || []);

  const endpoints = new Map(); // key: "METHOD /path" → { path, method, routeKey, type }

  function shouldSkip(path) {
    return skipPatterns.some(rx => rx.test(path));
  }

  // Collect from backend spec routes
  for (const [routeKey, routeInfo] of Object.entries(graph.backendRoutes || {})) {
    const [method, rawPath] = routeKey.split(' ');
    const filledPath = fillPathParams(rawPath, config, routeInfo);

    if (shouldSkip(filledPath)) continue;

    // Skip writes unless they are in safePosts
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      const normalizedPath = rawPath.toLowerCase();
      if (!safePosts.has(normalizedPath) && !safePosts.has(filledPath.toLowerCase())) {
        continue;
      }
    }

    // Detect SSE paths
    if (sseConfigPaths.has(rawPath) || sseConfigPaths.has(filledPath)) {
      endpoints.set(`SSE ${filledPath}`, { path: filledPath, method: 'SSE', routeKey, type: 'sse' });
      continue;
    }

    // Detect WS paths
    if (wsConfigPaths.has(rawPath) || wsConfigPaths.has(filledPath)) {
      endpoints.set(`WS ${filledPath}`, { path: filledPath, method: 'WS', routeKey, type: 'ws' });
      continue;
    }

    const key = `${method} ${filledPath}`;
    endpoints.set(key, { path: filledPath, method, routeKey, type: 'http' });
  }

  // Also collect any frontend API calls that didn't match a backend route (headless + partial)
  for (const [, routeData] of Object.entries(graph.frontendRoutes || {})) {
    for (const call of (routeData.apiCalls || [])) {
      if (!call.matchedBackendRoute) {
        const filledPath = fillPathParams(call.backendPath || call.path, config);
        if (shouldSkip(filledPath)) continue;
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(call.method)) {
          const normalizedPath = (call.backendPath || call.path).toLowerCase();
          if (!safePosts.has(normalizedPath)) continue;
        }
        const key = `${call.method} ${filledPath}`;
        if (!endpoints.has(key)) {
          endpoints.set(key, { path: filledPath, method: call.method, routeKey: null, type: 'http' });
        }
      }
    }
  }

  return [...endpoints.values()];
}

module.exports = { fillPathParams, collectEndpoints };
