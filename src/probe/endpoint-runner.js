'use strict';

const { validateSchema } = require('./schema-validator');
const { generateBody, resolvePostBodyMode, requestBodySchema } = require('./body-generator');
const { inferShape } = require('./schema-history');
const { createTraceContext, correlateTrace } = require('./otel-correlator');

const MAX_RETRIES = 2;

/**
 * Resolve the hard per-request deadline (ms).
 * axios `timeout` is socket-inactivity based, so a response that keeps trickling
 * data (streaming / SSE-over-HTTP / LLM token stream) never trips it. This is a
 * wall-clock cap that fires regardless of socket activity. Defaults to a small
 * margin beyond `timeoutMs` so ordinary idle timeouts still report via axios.
 */
function resolveHardTimeoutMs(config) {
  const p = (config && config.probe) || {};
  if (p.hardTimeoutMs) return p.hardTimeoutMs;
  const base = p.timeoutMs || 10000;
  return base + 2000;
}

function abortedResult(routeKey, attempt, error, ms = 0) {
  return {
    status: null,
    ms,
    routeKey,
    error,
    empty: false,
    itemCount: null,
    schemaValid: null,
    schemaErrors: [],
    retries: attempt,
    timedOut: true,
  };
}

/**
 * Probe a single HTTP endpoint.
 * Returns a probe result object.
 *
 * @param {AbortSignal|null} runSignal optional overall-run deadline signal; when it
 *   aborts, in-flight requests are cancelled and not-yet-started ones short-circuit.
 */
async function probeEndpoint(endpoint, headers, http, graph, config, attempt = 0, runSignal = null) {
  const { path: endpointPath, method, routeKey } = endpoint;
  const start = Date.now();

  // Overall run deadline already exceeded — don't even start this request.
  if (runSignal && runSignal.aborted) {
    return abortedResult(routeKey, attempt, 'probe run deadline exceeded');
  }

  // Hard per-request wall-clock abort: guarantees this request (and its concurrency
  // slot) can never hang indefinitely, even on a continuously-streaming response.
  const controller = new AbortController();
  const hardMs = resolveHardTimeoutMs(config);
  let timedOut = false;
  const killer = setTimeout(() => { timedOut = true; controller.abort(); }, hardMs);
  const onRunAbort = () => controller.abort();
  if (runSignal) runSignal.addEventListener('abort', onRunAbort, { once: true });

  let result;
  try {
    const routeInfo = routeKey && graph.backendRoutes ? graph.backendRoutes[routeKey] : null;
    const bodyMode = resolvePostBodyMode(endpoint, config);
    const requestSchema = requestBodySchema(routeInfo);
    const requestBody = ['POST', 'PUT', 'PATCH'].includes(method)
      ? generateBody(endpoint, requestSchema, bodyMode, config)
      : undefined;
    const traceContext = config.probe && config.probe.otel && config.probe.otel.enabled
      ? createTraceContext()
      : null;
    const requestHeaders = traceContext
      ? { ...headers, traceparent: traceContext.traceparent }
      : headers;
    const res = await http.request({
      method: method.toLowerCase(),
      url: endpointPath,
      headers: requestHeaders,
      data: requestBody,
      // Hard wall-clock abort (see resolveHardTimeoutMs) — covers streaming responses
      // that axios `timeout` would never cancel.
      signal: controller.signal,
      // Accept JSON and event-stream (for endpoints that might be either)
      validateStatus: () => true,
    });

    // Handle 429 rate-limit with backoff and retry
    if (res.status === 429 && attempt < MAX_RETRIES) {
      const retryAfter = res.headers['retry-after'];
      const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : Math.pow(2, attempt) * 1000;
      // Stop this attempt's deadline before backing off, then retry with a fresh one.
      clearTimeout(killer);
      if (runSignal) runSignal.removeEventListener('abort', onRunAbort);
      await new Promise(r => setTimeout(r, waitMs));
      return probeEndpoint(endpoint, headers, http, graph, config, attempt + 1, runSignal);
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
    let validation = null;
    if (res.status === 200 && routeInfo) {
      if (routeInfo && routeInfo.responseSchema) {
        const bodyForValidation = Array.isArray(body) ? body : body;
        validation = validateSchema(bodyForValidation, routeInfo.responseSchema);
        schemaValid = validation.valid;
        schemaErrors = validation.errors;
      }
    }

    let otel = null;
    if (traceContext) {
      try {
        otel = await correlateTrace(traceContext.traceId, config);
      } catch (err) {
        otel = { error: err.message, traceId: traceContext.traceId };
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
      validation: validation ? { ok: validation.ok, errors: validation.errors } : null,
      responseShape: res.status === 200 ? inferShape(body) : null,
      requestBodyMode: requestBody === undefined ? 'empty' : bodyMode,
      contentType: res.headers['content-type'] || null,
      retries: attempt,
      traceId: traceContext ? traceContext.traceId : null,
      otel,
    };
  } catch (err) {
    const ms = Date.now() - start;
    const runAborted = !!(runSignal && runSignal.aborted) && !timedOut;
    const error = timedOut
      ? `hard timeout: response did not complete within ${hardMs}ms (possible streaming/long-poll endpoint)`
      : runAborted
        ? 'probe run deadline exceeded'
        : err.message;
    result = {
      status: null,
      ms,
      routeKey,
      error,
      empty: false,
      itemCount: null,
      schemaValid: null,
      schemaErrors: [],
      retries: attempt,
      timedOut: timedOut || runAborted,
    };
  } finally {
    clearTimeout(killer);
    if (runSignal) runSignal.removeEventListener('abort', onRunAbort);
  }

  return result;
}

module.exports = { probeEndpoint, resolveHardTimeoutMs };
