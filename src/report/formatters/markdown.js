'use strict';

const fs = require('fs');
const path = require('path');

function writeMarkdownReport(report, config) {
  const lines = [];
  const score = report.overallScore || 0;
  const scoreEmoji = score >= 80 ? '🟢' : score >= 50 ? '🟡' : '🔴';

  lines.push(`# qa-probe Report`);
  lines.push(`**Generated:** ${report.meta && report.meta.generatedAt}`);
  lines.push(`**Target:** ${report.meta && report.meta.baseUrl}`);
  lines.push('');
  lines.push(`## Overall Score: ${scoreEmoji} ${score}/100`);
  lines.push('');

  // Root cause summary
  if (report.rootCauseSummary && Object.keys(report.rootCauseSummary).length > 0) {
    lines.push('## Root Cause Summary');
    lines.push('');
    lines.push('| Root Cause | Count | Affected Routes |');
    lines.push('|---|---|---|');
    for (const [cause, data] of Object.entries(report.rootCauseSummary)) {
      const affectedList = (data.affectedRoutes || []).slice(0, 3).join(', ');
      const more = (data.affectedRoutes || []).length > 3 ? ` +${data.affectedRoutes.length - 3} more` : '';
      lines.push(`| \`${cause}\` | ${data.count} | ${affectedList}${more} |`);
    }
    lines.push('');
  }

  // Route details
  lines.push('## Routes');
  lines.push('');
  lines.push('| Route | Score | Status | Root Cause | Fix |');
  lines.push('|---|---|---|---|---|');

  const routeEntries = Object.entries(report.routes || {})
    .sort((a, b) => (a[1].score || 0) - (b[1].score || 0));

  for (const [routePath, data] of routeEntries) {
    const s = data.score || 0;
    const icon = s >= 80 ? '🟢' : s >= 50 ? '🟡' : '🔴';
    const fixHint = (data.fixHint || '').replace(/\|/g, '\\|').slice(0, 80);
    lines.push(`| \`${routePath}\` | ${icon} ${s} | ${data.status || '?'} | \`${data.rootCause || 'ok'}\` | ${fixHint} |`);
  }
  lines.push('');

  // Blast radius
  if (report.blastRadius && Object.keys(report.blastRadius).length > 0) {
    lines.push('## High Blast Radius Issues');
    lines.push('');
    lines.push('Endpoints whose failure affects the most frontend routes:');
    lines.push('');
    lines.push('| Endpoint | Root Cause | Affects |');
    lines.push('|---|---|---|');
    for (const [ep, data] of Object.entries(report.blastRadius)) {
      lines.push(`| \`${ep}\` | \`${data.rootCause}\` | ${data.affectedRouteCount} route(s) |`);
    }
    lines.push('');
  }

  // Regression
  if (report.regression) {
    const { newFailures = [], newPasses = [] } = report.regression;
    if (newFailures.length > 0) {
      lines.push('## ⚠️ New Regressions');
      lines.push('');
      newFailures.forEach(f => lines.push(`- \`${f}\``));
      lines.push('');
    }
    if (newPasses.length > 0) {
      lines.push('## ✅ Newly Passing');
      lines.push('');
      newPasses.forEach(p => lines.push(`- \`${p}\``));
      lines.push('');
    }
  }

  const outPath = path.join(process.cwd(), config.output.dir, 'report.md');
  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
  return outPath;
}

module.exports = { writeMarkdownReport };
