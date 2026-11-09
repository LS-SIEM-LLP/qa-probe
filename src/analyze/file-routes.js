'use strict';

/**
 * File-based routers. The page list lives in the file names, not in a <Route> tree, so the
 * JSX route extractor finds nothing. Supported:
 *   TanStack Router   createFileRoute("/_layout/items")  -> /items   (leading "_" segments are pathless)
 *   Next.js app dir   app/items/[id]/page.tsx             -> /items/:id  ((group) and @slot folders are not in the URL)
 *   Next.js pages     pages/items/[id].tsx                -> /items/:id  (_app, _document and api/ are not pages)
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
  for (const [routePath, info] of discoverNextRoutes(srcDir)) {
    if (!routes.has(routePath)) routes.set(routePath, info);
  }
  return routes;
}

/** "[id]" -> ":id", "[...slug]" -> ":slug*", "[[...slug]]" -> ":slug*"; route groups and parallel slots vanish. */
function nextSegment(seg) {
  if (/^\(.*\)$/.test(seg) || seg.startsWith('@')) return null;
  const optionalCatchAll = /^\[\[\.\.\.(\w+)\]\]$/.exec(seg);
  if (optionalCatchAll) return ':' + optionalCatchAll[1] + '*';
  const catchAll = /^\[\.\.\.(\w+)\]$/.exec(seg);
  if (catchAll) return ':' + catchAll[1] + '*';
  const dynamic = /^\[(\w+)\]$/.exec(seg);
  if (dynamic) return ':' + dynamic[1];
  return seg;
}

function nextRoutePath(relativeParts) {
  const segs = relativeParts.map(nextSegment).filter((s) => s !== null && s !== '');
  return '/' + segs.join('/');
}

/** Folders that hold a Next.js router: <src>/app, <src>/pages, <src>/src/app, <src>/src/pages, or src itself. */
function nextRoots(srcDir) {
  const roots = [];
  for (const rel of ['app', 'pages', 'src/app', 'src/pages']) {
    const dir = path.join(srcDir, rel);
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) roots.push({ dir, kind: path.basename(dir) });
  }
  const own = path.basename(srcDir);
  if (own === 'app' || own === 'pages') roots.push({ dir: srcDir, kind: own });
  return roots;
}

function discoverNextRoutes(srcDir) {
  const routes = new Map();
  for (const { dir, kind } of nextRoots(srcDir)) {
    for (const file of walkAll(dir)) {
      const rel = path.relative(dir, file).split(path.sep);
      const name = rel[rel.length - 1];
      let parts;
      if (kind === 'app') {
        if (!/^page\.(j|t)sx?$/.test(name)) continue;
        parts = rel.slice(0, -1);
      } else {
        if (rel[0] === 'api' || /^_(app|document|error)\./.test(name) || /\.(test|spec)\./.test(name)) continue;
        const base = name.replace(/\.[^.]+$/, '');
        parts = [...rel.slice(0, -1), ...(base === 'index' ? [] : [base])];
      }
      const routePath = nextRoutePath(parts);
      const component = kind === 'app'
        ? (parts.filter((p) => nextSegment(p)).pop() || 'home')
        : (name.replace(/\.[^.]+$/, '') === 'index' ? (rel.length > 1 ? rel[rel.length - 2] : 'index') : name.replace(/\.[^.]+$/, ''));
      if (!routes.has(routePath)) routes.set(routePath, { component, authGuard: 'Route', requiredScopes: [], file });
    }
  }
  return routes;
}

function walkAll(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walkAll(path.join(dir, entry.name), out);
    } else if (/\.(j|t)sx?$/.test(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

module.exports = { discoverFileRoutes, routePathFromTanstack, discoverNextRoutes, nextRoutePath };
