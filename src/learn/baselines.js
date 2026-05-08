'use strict';

function computeBaselines(runs) {
  const grouped = new Map();
  for (const run of runs || []) {
    const diagnostics = run.endpointDiagnostics || [];
    for (const item of diagnostics) {
      if (!item.endpoint) continue;
      if (!grouped.has(item.endpoint)) grouped.set(item.endpoint, { latencies: [], sizes: [], cardinalities: [] });
      const bucket = grouped.get(item.endpoint);
      if (typeof item.ms === 'number') bucket.latencies.push(item.ms);
      if (typeof item.responseSize === 'number') bucket.sizes.push(item.responseSize);
      if (typeof item.itemCount === 'number') bucket.cardinalities.push(item.itemCount);
    }
  }

  const out = {};
  for (const [endpoint, values] of grouped.entries()) {
    out[endpoint] = {
      latency: summarize(values.latencies),
      responseSize: summarize(values.sizes),
      cardinality: summarize(values.cardinalities),
    };
  }
  return out;
}

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: mean(sorted),
    sigma: sigma(sorted),
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    count: sorted.length,
  };
}

function percentile(sorted, p) {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sigma(values) {
  const avg = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + Math.pow(value - avg, 2), 0) / values.length);
}

function historicalFixSuggestion(endpoint, rootCause, runs) {
  for (const run of [...(runs || [])].reverse()) {
    for (const fix of run.resolvedFixes || []) {
      if (fix.endpoint === endpoint && fix.rootCause === rootCause) return fix.fixHint || fix.summary || null;
    }
  }
  return null;
}

module.exports = { computeBaselines, summarize, historicalFixSuggestion };
