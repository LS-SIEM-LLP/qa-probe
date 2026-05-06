'use strict';

const fs = require('fs');
const path = require('path');

function writeMarkdownReport(report, config) {
  const lines = [];
  const score = report.overallScore || 0;
  const scoreIcon = score >= 80 ? '[green]' : score >= 50 ? '[yellow]' : '[red]';
  const diagnostics = report.endpointDiagnostics || [];

  lines.push('# qa-probe Report');
  lines.push(`**Generated:** ${report.meta && report.meta.generatedAt}`);
  lines.push(`**Target:** ${report.meta && report.meta.baseUrl}`);
  lines.push('');
  lines.push(`## Overall Score: ${scoreIcon} ${score}/100`);
  lines.push('');

  lines.push('## Run Snapshot');
  lines.push('');
  lines.push(`- Frontend route score: ${score}/100`);
  lines.push(`- Endpoint issues found: ${diagnostics.length}`);
  lines.push(`- Headless mode: ${(report.meta && report.meta.headless) || false}`);
  lines.push('');

  if (report.rootCauseSummary && Object.keys(report.rootCauseSummary).length > 0) {
    lines.push('## Root Cause Summary');
    lines.push('');
    lines.push('| Root Cause | Product Label | Count | Affected Routes |');
    lines.push('|---|---|---|---|');
    for (const [cause, data] of Object.entries(report.rootCauseSummary)) {
      const affectedList = (data.affectedRoutes || []).slice(0, 3).join(', ');
      const more = (data.affectedRoutes || []).length > 3 ? ` +${data.affectedRoutes.length - 3} more` : '';
      lines.push(`| \`${cause}\` | \`${displayCause(cause)}\` | ${data.count} | ${escapeCell(affectedList + more)} |`);
    }
    lines.push('');
  }

  if (diagnostics.length > 0) {
    writeEndpointDiagnostics(lines, diagnostics);
  }

  lines.push('## Routes');
  lines.push('');
  lines.push('| Route | Score | Status | Root Cause | Fix |');
  lines.push('|---|---|---|---|---|');

  const routeEntries = Object.entries(report.routes || {})
    .sort((a, b) => (a[1].score || 0) - (b[1].score || 0));

  for (const [routePath, data] of routeEntries) {
    const s = data.score || 0;
    const icon = s >= 80 ? '[green]' : s >= 50 ? '[yellow]' : '[red]';
    const fixHint = escapeCell(data.fixHint || '').slice(0, 100);
    lines.push(`| \`${routePath}\` | ${icon} ${s} | ${data.status || '?'} | \`${displayCause(data.rootCause || 'ok')}\` | ${fixHint} |`);
  }
  lines.push('');

  if (report.blastRadius && Object.keys(report.blastRadius).length > 0) {
    lines.push('## High Blast Radius Issues');
    lines.push('');
    lines.push('Endpoints whose failure affects the most frontend routes:');
    lines.push('');
    lines.push('| Endpoint | Root Cause | Affects |');
    lines.push('|---|---|---|');
    for (const [ep, data] of Object.entries(report.blastRadius)) {
      lines.push(`| \`${ep}\` | \`${displayCause(data.rootCause)}\` | ${data.affectedRouteCount} route(s) |`);
    }
    lines.push('');
  }

  if (report.regression) {
    const { newFailures = [], newPasses = [] } = report.regression;
    if (newFailures.length > 0) {
      lines.push('## New Regressions');
      lines.push('');
      newFailures.forEach(f => lines.push(`- \`${f}\``));
      lines.push('');
    }
    if (newPasses.length > 0) {
      lines.push('## Newly Passing');
      lines.push('');
      newPasses.forEach(p => lines.push(`- \`${p}\``));
      lines.push('');
    }
  }

  const outPath = path.join(process.cwd(), config.output.dir, 'report.md');
  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
  return outPath;
}

function writeEndpointDiagnostics(lines, diagnostics) {
  const impactItems = diagnostics
    .filter(d => d.severity === 'critical' || d.severity === 'high' || d.affectedRouteCount > 0)
    .slice(0, 30);

  lines.push('## Endpoint Diagnostics');
  lines.push('');
  lines.push('Concrete probe evidence. `no_data` means the API returned 200 OK with an empty array/object/body; qa-probe does not query the database directly.');
  lines.push('');
  lines.push('| Endpoint | Label | Severity | Evidence | Affected Routes |');
  lines.push('|---|---|---|---|---|');
  for (const item of impactItems) {
    lines.push(`| \`${item.endpoint}\` | \`${item.label}\` | ${item.severity} | ${escapeCell(summarizeEvidence(item))} | ${escapeCell(formatAffectedRoutes(item))} |`);
  }
  lines.push('');

  const noData = diagnostics.filter(d => d.rootCause === 'empty_db').slice(0, 25);
  if (noData.length > 0) {
    lines.push('## No Data Evidence');
    lines.push('');
    lines.push('These endpoints returned successful responses but no records. This usually means empty demo data, no matching records for sampled parameters, or a legitimately empty queue/list.');
    lines.push('');
    lines.push('| Endpoint | Empty Signal | Time | Affected Routes |');
    lines.push('|---|---|---|---|');
    for (const item of noData) {
      lines.push(`| \`${item.endpoint}\` | \`${item.emptyReason || 'empty'}\` | ${item.ms || '?'}ms | ${escapeCell(formatAffectedRoutes(item))} |`);
    }
    lines.push('');
  }

  const unmapped = diagnostics.filter(d => !d.affectedRoutes || d.affectedRoutes.length === 0).slice(0, 25);
  if (unmapped.length > 0) {
    lines.push('## Backend-Only Or Unmatched Issues');
    lines.push('');
    lines.push('These endpoint issues were observed during backend probing but were not confidently tied to a frontend route. They are useful for API health, but should not lower page confidence until mapped.');
    lines.push('');
    lines.push('| Endpoint | Label | Evidence |');
    lines.push('|---|---|---|');
    for (const item of unmapped) {
      lines.push(`| \`${item.endpoint}\` | \`${item.label}\` | ${escapeCell(summarizeEvidence(item))} |`);
    }
    lines.push('');
  }
}

function displayCause(rootCause) {
  if (rootCause === 'empty_db') return 'no_data';
  if (rootCause === 'unknown') return 'needs_review';
  if (rootCause === 'sample_not_found') return 'sample_not_found';
  if (rootCause === 'invalid_sample_params') return 'invalid_sample';
  if (rootCause === 'timeout') return 'timeout';
  return rootCause || 'ok';
}

function formatAffectedRoutes(item) {
  const routes = item.affectedRoutes || [];
  if (routes.length === 0) return 'backend-only / unmatched';
  return routes.slice(0, 3).join(', ') + (routes.length > 3 ? ` +${routes.length - 3} more` : '');
}

function summarizeEvidence(item) {
  const parts = [];
  if (item.status !== null && item.status !== undefined) parts.push(`status=${item.status}`);
  if (item.ms !== null && item.ms !== undefined) parts.push(`${item.ms}ms`);
  if (item.emptyReason) parts.push(item.emptyReason);
  if (item.error) parts.push(item.error);
  if (item.detail) parts.push(item.detail);
  return parts.join('; ') || 'see probe-results.json';
}

function escapeCell(value) {
  return String(value || '').replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 180);
}

module.exports = { writeMarkdownReport };
