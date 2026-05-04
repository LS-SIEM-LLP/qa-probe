'use strict';

/**
 * Score a frontend route 0–100.
 * Starts at 100 and deducts points for each broken/degraded API call.
 */
function scoreRoute(routePath, routeData, probeResults, rootCauses, config) {
  const weights = config.scoring || {};
  const apiCalls = (routeData && routeData.apiCalls) || [];

  if (apiCalls.length === 0) {
    // No API calls — score is neutral (no data dependency)
    return { score: 100, status: 'healthy', penalties: [] };
  }

  let score = 100;
  const penalties = [];

  for (const call of apiCalls) {
    const probeKey = `${call.method} ${call.backendPath || call.path}`;
    const probe = probeResults[probeKey];
    const cause = rootCauses[probeKey];

    if (!probe) continue; // not probed

    const rootCause = cause && cause.rootCause;

    switch (rootCause) {
      case 'feature_flag_disabled':
        score += (weights.disabledFeature || -15);
        penalties.push({ probeKey, reason: 'feature_flag_disabled', delta: weights.disabledFeature || -15 });
        break;
      case 'missing_route':
        score += (weights.missingRoute || -50);
        penalties.push({ probeKey, reason: 'missing_route', delta: weights.missingRoute || -50 });
        break;
      case 'contract_mismatch':
        score += (weights.missingRoute || -50);
        penalties.push({ probeKey, reason: 'contract_mismatch', delta: weights.missingRoute || -50 });
        break;
      case 'empty_db':
        score += (weights.emptyResponse || -20);
        penalties.push({ probeKey, reason: 'empty_db', delta: weights.emptyResponse || -20 });
        break;
      case 'auth_scope_mismatch':
        score += (weights.authError || -30);
        penalties.push({ probeKey, reason: 'auth_scope_mismatch', delta: weights.authError || -30 });
        break;
      case 'schema_mismatch':
        score += (weights.schemaMismatch || -25);
        penalties.push({ probeKey, reason: 'schema_mismatch', delta: weights.schemaMismatch || -25 });
        break;
      case 'stream_dead':
        score += (weights.streamDead || -35);
        penalties.push({ probeKey, reason: 'stream_dead', delta: weights.streamDead || -35 });
        break;
      case 'server_error':
        score += (weights.serverError || -40);
        penalties.push({ probeKey, reason: 'server_error', delta: weights.serverError || -40 });
        break;
      case 'slow_but_working':
        score += (weights.slowResponse || -10);
        penalties.push({ probeKey, reason: 'slow_but_working', delta: weights.slowResponse || -10 });
        break;
    }
  }

  score = Math.max(0, Math.min(100, score));

  let status;
  if (score >= 80) status = 'healthy';
  else if (score >= 50) status = 'degraded';
  else status = 'broken';

  // Primary root cause is the worst penalty
  const primaryCause = penalties.length > 0
    ? penalties.sort((a, b) => a.delta - b.delta)[0].reason
    : (score === 100 ? 'ok' : null);

  return { score, status, penalties, primaryCause };
}

/**
 * Compute overall score as weighted average across all routes.
 */
function scoreOverall(routeScores) {
  const scores = Object.values(routeScores).map(r => r.score);
  if (scores.length === 0) return 100;
  return Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length);
}

module.exports = { scoreRoute, scoreOverall };
