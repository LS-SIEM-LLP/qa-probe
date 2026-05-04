'use strict';

/**
 * FastAPI adapter.
 * Fetches OpenAPI spec from /openapi.json and optional feature flags from /health/features.
 * Falls back to headless mode if spec is unavailable.
 */

function normalizeOpenApiRoutes(openapi) {
  const routes = {};

  for (const [rawPath, methods] of Object.entries(openapi.paths || {})) {
    for (const [method, op] of Object.entries(methods)) {
      if (['get', 'post', 'put', 'patch', 'delete'].includes(method)) {
        const key = `${method.toUpperCase()} ${rawPath}`;

        // Extract security requirement — FastAPI uses securitySchemes
        const requiresAuth = !!(
          (op.security && op.security.length > 0) ||
          (openapi.security && openapi.security.length > 0)
        );

        // Extract first response schema
        let responseSchema = null;
        const okResponse = (op.responses || {})['200'];
        if (okResponse) {
          const content = okResponse.content || {};
          const jsonContent = content['application/json'];
          if (jsonContent && jsonContent.schema) {
            responseSchema = resolveSchema(jsonContent.schema, openapi);
          }
        }

        // Collect path parameters
        const parameters = (op.parameters || []).filter(p => p.in === 'path').map(p => p.name);

        routes[key] = {
          summary: op.summary || '',
          tags: op.tags || [],
          requiresAuth,
          parameters,
          responseSchema,
          deprecated: !!op.deprecated,
        };
      }
    }
  }

  return routes;
}

function resolveSchema(schema, openapi, depth = 0) {
  if (depth > 5) return schema; // prevent infinite recursion
  if (!schema) return null;

  if (schema.$ref) {
    const refPath = schema.$ref.replace('#/', '').split('/');
    let resolved = openapi;
    for (const segment of refPath) {
      resolved = resolved[segment];
      if (!resolved) return null;
    }
    return resolveSchema(resolved, openapi, depth + 1);
  }

  if (schema.allOf) {
    return resolveSchema(schema.allOf[0], openapi, depth + 1);
  }

  if (schema.type === 'array' && schema.items) {
    return {
      type: 'array',
      items: resolveSchema(schema.items, openapi, depth + 1),
    };
  }

  return schema;
}

function parseFeatureFlags(featuresData) {
  if (!featuresData || typeof featuresData !== 'object') return {};

  const flags = {};

  // Expected shape: { "count": N, "routers": { "/prefix": { "included", "enabled", "message" } } }
  // Generic fallback: { "features": { ... } } or the object itself
  const source = featuresData.routers || featuresData.features || featuresData;

  // Skip top-level scalar fields (count, etc.)
  for (const [prefix, info] of Object.entries(source)) {
    if (typeof info !== 'object' || info === null) continue;
    const normPrefix = prefix.startsWith('/') ? prefix : `/${prefix}`;
    flags[normPrefix] = {
      included: info.included !== false,
      enabled: info.enabled !== false,
      message: info.message || null,
    };
  }

  return flags;
}

async function fetchSpec(config, http) {
  let openapi = null;
  let featureFlags = {};
  let headless = false;

  // Try to fetch OpenAPI spec
  try {
    const res = await http.get(config.openApiUrl || '/openapi.json');
    openapi = res.data;
  } catch (err) {
    headless = true;
    process.stderr.write(
      `[qa-probe] OpenAPI spec unavailable at ${config.openApiUrl}: ${err.message}\n` +
      `[qa-probe] Falling back to headless mode — HTTP status probing only.\n`
    );
  }

  // Try to fetch feature flags (FastAPI-specific, optional)
  if (!headless && config.featureStatusUrl) {
    try {
      const res = await http.get(config.featureStatusUrl);
      featureFlags = parseFeatureFlags(res.data);
    } catch {
      // /health/features is optional — not all FastAPI apps expose it
    }
  }

  return {
    routes: openapi ? normalizeOpenApiRoutes(openapi) : {},
    featureFlags,
    specUrl: config.openApiUrl,
    framework: 'fastapi',
    headless,
    rawSpec: openapi,
  };
}

function isAuthRequired(path, spec) {
  // Check if any route matching this path requires auth
  for (const [key, route] of Object.entries(spec.routes || {})) {
    const routePath = key.split(' ')[1];
    if (routePath === path || pathMatches(routePath, path)) {
      return !!route.requiresAuth;
    }
  }
  // Default: assume auth required
  return true;
}

function pathMatches(pattern, actual) {
  // Convert /items/{id} to regex /items/[^/]+
  const regex = new RegExp(
    '^' + pattern.replace(/\{[^}]+\}/g, '[^/]+').replace(/\//g, '\\/') + '$'
  );
  return regex.test(actual);
}

function buildAuthRequest(config) {
  const { auth } = config;
  if (auth.type === 'bearer') {
    return {
      method: 'POST',
      url: auth.loginUrl,
      data: auth.credentials,
    };
  }
  if (auth.type === 'api-key') {
    return null; // no login needed
  }
  return null;
}

function extractToken(loginResponse, config) {
  const { auth } = config;
  if (auth.type === 'bearer') {
    const token = loginResponse.data[auth.tokenPath];

    if (token) {
      return { Authorization: `Bearer ${token}` };
    }

    // Fallback: cookie-mode login (some apps return the JWT in a Set-Cookie header)
    const setCookies = loginResponse.headers && loginResponse.headers['set-cookie'];
    if (setCookies) {
      const cookies = Array.isArray(setCookies) ? setCookies : [setCookies];
      // Find the access token cookie — try common names
      const ACCESS_COOKIE_NAMES = ['access_token', 'jwt', 'auth_token', 'token', 'session'];
      for (const cookieStr of cookies) {
        const [nameVal] = cookieStr.split(';');
        const [name, val] = nameVal.split('=');
        if (ACCESS_COOKIE_NAMES.includes(name.trim())) {
          // Use as Bearer token (it's a JWT) and also send as Cookie for compatibility
          return {
            Authorization: `Bearer ${val.trim()}`,
            Cookie: `${name.trim()}=${val.trim()}`,
          };
        }
      }

      // If no named match, build full cookie string and send it
      const cookieHeader = cookies
        .map(c => c.split(';')[0].trim())
        .join('; ');
      return { Cookie: cookieHeader };
    }

    throw new Error(
      `Login succeeded but "${auth.tokenPath}" not found in response and no access cookie set. ` +
      `Response keys: ${Object.keys(loginResponse.data || {}).join(', ')}`
    );
  }
  if (auth.type === 'api-key') {
    return { [auth.apiKeyHeader]: auth.apiKey };
  }
  return {};
}

module.exports = { fetchSpec, isAuthRequired, buildAuthRequest, extractToken, normalizeOpenApiRoutes };
