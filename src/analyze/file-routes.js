'use strict';

/**
 * File-based routers. The page list lives in the file names, not in a <Route> tree, so the
 * JSX route extractor finds nothing. Supported:
 *   TanStack Router   createFileRoute("/_layout/items")  -> /items   (leading "_" segments are pathless)
 */

const fs = require('fs');
const path = require('path');

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage']);
const TANSTACK = /createFileRoute\(\s*["'`]([^"'`]*)["'`]\s*\)/;

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), out);
    } else if (/\.(j|t)sx$/.test(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

/** "/_layout/items/$id" -> "/items/:id"; "/_layout/" -> "/". */
function routePathFromTanstack(id) {
  const parts = String(id).split('/').filter(Boolean)
    .filter((seg) => !seg.startsWith('_'))
    .map((seg) => (seg.startsWith('$') ? ':' + seg.slice(1) : seg));
  return '/' + parts.join('/');
}

/** Map<routePath, { component, authGuard, requiredScopes, file }> */
function discoverFileRoutes(srcDir) {
  const routes = new Map();
  for (const file of walk(srcDir)) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    const m = TANSTACK.exec(text);
    if (!m) continue;
    const routePath = routePathFromTanstack(m[1]);
    const base = path.basename(file).replace(/\.[^.]+$/, '');
    const component = base === 'index' ? path.basename(path.dirname(file)) : base;
    if (!routes.has(routePath)) {
      routes.set(routePath, { component, authGuard: 'Route', requiredScopes: [], file });
    }
  }
  return routes;
}

module.exports = { discoverFileRoutes, routePathFromTanstack };
