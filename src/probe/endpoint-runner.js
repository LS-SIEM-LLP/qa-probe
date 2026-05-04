'use strict';

const { validateSchema } = require('./schema-validator');

/**
 * Probe a single HTTP endpoint.
 * Returns a probe result object.
 */
async function probeEndpoint(endpoint, headers, http, graph, config) {
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
      empty,
      itemCount,
      emptyReason,
      schemaValid,
      schemaErrors,
      contentType: res.headers['content-type'] || null,
    };
  } catch (err) {
    const ms = Date.now() - start;
    result = {
      status: null,
      ms,
      error: err.message,
      empty: false,
      itemCount: null,
      schemaValid: null,
      schemaErrors: [],
    };
  }

  return result;
}

module.exports = { probeEndpoint };
