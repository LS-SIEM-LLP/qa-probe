'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Write a compact AI-optimized context file.
 * Designed so Claude/Codex can answer "why is /rules showing no data?" in one shot.
 * No markdown tables — just bullet points and key facts.
 */
function writeAiContext(report, graph, config) {
  const lines = [];
  const score = report.overallScore || 0;

  lines.push(`QA-PROBE AI CONTEXT`);
  lines.push(`Base URL: ${report.meta && report.meta.baseUrl}`);
  lines.push(`Generated: ${report.meta && report.meta.generatedAt}`);
  lines.push(`Overall score: ${score}/100`);
  lines.push(`Headless mode: ${(report.meta && report.meta.headless) || false}`);
  lines.push('');

  // Broken routes (score < 80)
  const broken = Object.entries(report.routes || {})
    .filter(([, d]) => (d.score || 0) < 80)
    .sort((a, b) => (a[1].score || 0) - (b[1].score || 0));

  if (broken.length > 0) {
    lines.push(`BROKEN/DEGRADED ROUTES (${broken.length}):`);
    for (const [routePath, data] of broken) {
      lines.push(`  ${routePath} → score=${data.score}, cause=${data.rootCause}`);
      if (data.rootCauseDetail) lines.push(`    detail: ${data.rootCauseDetail}`);
      if (data.fixHint) lines.push(`    fix: ${data.fixHint}`);
    }
    lines.push('');
  }

  // Root cause summary
  if (report.rootCauseSummary && Object.keys(report.rootCauseSummary).length > 0) {
    lines.push('ROOT CAUSES:');
    for (const [cause, data] of Object.entries(report.rootCauseSummary)) {
      lines.push(`  ${cause}: ${data.count} route(s) → ${(data.affectedRoutes || []).slice(0, 5).join(', ')}`);
    }
    lines.push('');
  }

  // High blast radius
  if (report.blastRadius && Object.keys(report.blastRadius).length > 0) {
    lines.push('HIGH BLAST RADIUS:');
    for (const [ep, data] of Object.entries(report.blastRadius)) {
      lines.push(`  ${ep} (${data.rootCause}) → affects ${data.affectedRouteCount} routes`);
    }
    lines.push('');
  }

  // Feature flags
  const disabledFlags = Object.entries(graph.featureFlags || {})
    .filter(([, f]) => !f.included || !f.enabled);
  if (disabledFlags.length > 0) {
    lines.push('DISABLED FEATURE FLAGS:');
    disabledFlags.forEach(([prefix, flag]) => {
      lines.push(`  ${prefix}: included=${flag.included}, enabled=${flag.enabled}`);
    });
    lines.push('');
  }

  // Regression
  if (report.regression) {
    const { newFailures = [], newPasses = [] } = report.regression;
    if (newFailures.length > 0) {
      lines.push(`NEW REGRESSIONS: ${newFailures.join(', ')}`);
      lines.push('');
    }
    if (newPasses.length > 0) {
      lines.push(`NEWLY PASSING: ${newPasses.join(', ')}`);
      lines.push('');
    }
  }

  // Healthy routes (brief)
  const healthy = Object.entries(report.routes || {})
    .filter(([, d]) => (d.score || 0) >= 80)
    .map(([r]) => r);
  if (healthy.length > 0) {
    lines.push(`HEALTHY ROUTES (${healthy.length}): ${healthy.slice(0, 20).join(', ')}${healthy.length > 20 ? ' ...' : ''}`);
  }

  const outPath = path.join(process.cwd(), config.output.dir, 'ai-context.md');
  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
  return outPath;
}

module.exports = { writeAiContext };
