'use strict';

const { validateSchema } = require('./schema-validator');

const MAX_RETRIES = 2;

/**
 * Probe a single HTTP endpoint.
 * Returns a probe result object.
 */
async function probeEndpoint(endpoint, headers, http, graph, config, attempt = 0) {
  const { path: endpointPath, method, routeKey } = endpoint;
  const start = Date.now();

  let result;
  try {
    const res = await http.request({
      method: method.toLowerCase(),
      url: endpointPath,
      headers,
      // Accept JSON and event-stream (for endpoints that might be either)
      validateStatus: () => true,
    });

    // Handle 429 rate-limit with backoff and retry
    if (res.status === 429 && attempt < MAX_RETRIES) {
      const retryAfter = res.headers['retry-after'];
      const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : Math.pow(2, attempt) * 1000;
      await new Promise(r => setTimeout(r, waitMs));
      return probeEndpoint(endpoint, headers, http, graph, config, attempt + 1);
    }

    const ms = Date.now() - start;
    const body = res.data;

    // Determine if response is empty
    let empty = false;
    let itemCount = null;
    let emptyReason = null;

    if (res.status === 200) {
      if (body === null || body === undefined || body === '') {
        empty = true;
        emptyReason = 'null_body';
      } else if (Array.isArray(body) && body.length === 0) {
        empty = true;
        emptyReason = 'empty_array';
        itemCount = 0;
      } else if (Array.isArray(body)) {
        itemCount = body.length;
      } else if (typeof body === 'object' && body !== null) {
        // Check for common "empty" patterns: { data: [], results: [], items: [] }
        const keys = Object.keys(body);
        const listKey = keys.find(k => ['data', 'results', 'items', 'records'].includes(k));
        if (listKey && Array.isArray(body[listKey]) && body[listKey].length === 0) {
          empty = true;
          emptyReason = `empty_nested_array (${listKey})`;
          itemCount = 0;
        } else if (listKey && Array.isArray(body[listKey])) {
          itemCount = body[listKey].length;
        }
      }
    }

    // Schema validation
    let schemaValid = null;
    let schemaErrors = [];
    if (res.status === 200 && routeKey && graph.backendRoutes) {
      const routeInfo = graph.backendRoutes[routeKey];
      if (routeInfo && routeInfo.responseSchema) {
        const bodyForValidation = Array.isArray(body) ? body : body;
        const validation = validateSchema(bodyForValidation, routeInfo.responseSchema);
        schemaValid = validation.valid;
        schemaErrors = validation.errors;
      }
    }

    result = {
      status: res.status,
      ms,
      routeKey,
      empty,
      itemCount,
      emptyReason,
      schemaValid,
      schemaErrors,
      contentType: res.headers['content-type'] || null,
      retries: attempt,
    };
  } catch (err) {
    const ms = Date.now() - start;
    result = {
      status: null,
      ms,
      routeKey,
      error: err.message,
      empty: false,
      itemCount: null,
      schemaValid: null,
      schemaErrors: [],
      retries: attempt,
    };
  }

  return result;
}

module.exports = { probeEndpoint };
