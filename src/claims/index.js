'use strict';

/**
 * Claim ledger: what the project's pages claim to depend on, and how strong the evidence is.
 *
 * Every claim is "page X depends on endpoint Y". Each carries an evidence level so a reader
 * (an AI agent especially) can tell what is proven from what is only guessed:
 *
 *   runtime-observed  seen in real traffic (HAR or browser trace)
 *   static-only       found in source code, never seen running
 *
 * and, from the latest probe results, a live status:
 *
 *   healthy | broken | unverified | not-probed
 *
 * "unverified" and "not-probed" are never shown as healthy.
 */

const HEALTHY = new Set(['ok', 'expected_empty', 'acknowledged']);

function liveStatusFor(routeKey, probeByRoute) {
  const probe = probeByRoute.get(routeKey);
  if (!probe) return { status: 'not-probed', detail: 'no probe result cached' };
  if (probe.status === null || probe.status === undefined) return { status: 'broken', detail: probe.error || 'no response' };
  if (probe.status === 401 || probe.status === 403) return { status: 'unverified', detail: `HTTP ${probe.status} for the test account` };
  // A detail route probed with a guessed id answers 400/404/422 even when it works fine.
  if (/\{[^}]*\}/.test(routeKey) && [400, 404, 422].includes(probe.status)) {
    return { status: 'unverified', detail: `HTTP ${probe.status} on a detail route, probably no real record with the sample id` };
  }
  if (probe.status >= 500) return { status: 'broken', detail: `HTTP ${probe.status}` };
  if (probe.status >= 400) return { status: 'broken', detail: `HTTP ${probe.status}` };
  if (probe.empty) return { status: 'unverified', detail: 'HTTP 200 with no data' };
  if (probe.schemaErrors && probe.schemaErrors.length) return { status: 'broken', detail: `${probe.schemaErrors.length} schema error(s)` };
  return { status: 'healthy', detail: `HTTP ${probe.status}` };
}

function buildClaims(graph, probeResults, { route = null, limit = 50 } = {}) {
  const probeByRoute = new Map();
  for (const [key, result] of Object.entries(probeResults || {})) {
    if (!result || typeof result !== 'object' || key.startsWith('__')) continue;
    const routeKey = result.routeKey || key;
    probeByRoute.set(routeKey, result);
  }

  const pages = [];
  for (const [pageRoute, info] of Object.entries((graph && graph.frontendRoutes) || {})) {
    if (route && pageRoute !== route) continue;
    const claims = (info.apiCalls || []).map((call) => {
      const matched = call.matchedBackendRoute || null;
      const live = matched ? liveStatusFor(matched, probeByRoute) : { status: 'not-probed', detail: 'no matching backend route' };
      return {
        claim: `${pageRoute} depends on ${matched || `${call.method} ${call.backendPath || call.path}`}`,
        endpoint: matched,
        evidence: !call.source || call.source === 'ast' ? 'static-only' : 'runtime-observed',
        foundAt: call.callSite || null,
        matchedInSpec: !!matched,
        live: live.status,
        liveDetail: live.detail,
      };
    });
    const counts = { healthy: 0, broken: 0, unverified: 0, 'not-probed': 0 };
    for (const c of claims) counts[c.live] = (counts[c.live] || 0) + 1;
    pages.push({
      page: pageRoute,
      component: info.component || null,
      summary: counts,
      unmatched: claims.filter((c) => !c.matchedInSpec).length,
      claims,
    });
  }

  pages.sort((a, b) => (b.summary.broken - a.summary.broken) || (b.summary['not-probed'] - a.summary['not-probed']) || a.page.localeCompare(b.page));
  const shown = pages.slice(0, limit);
  const totals = { pages: pages.length, claims: 0, runtimeObserved: 0, staticOnly: 0, healthy: 0, broken: 0 };
  for (const p of pages) {
    for (const c of p.claims) {
      totals.claims++;
      if (c.evidence === 'runtime-observed') totals.runtimeObserved++; else totals.staticOnly++;
      if (c.live === 'healthy') totals.healthy++;
      if (c.live === 'broken') totals.broken++;
    }
  }
  return {
    totals,
    note: 'static-only means found in source but never seen running. unverified and not-probed are not healthy.',
    shown: shown.length,
    pages: shown,
  };
}

module.exports = { buildClaims, liveStatusFor, HEALTHY };
