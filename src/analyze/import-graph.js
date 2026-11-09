'use strict';

/**
 * Which source files does a page use? A page file imports components, which import hooks and
 * API helpers, which make the calls. Following those imports attributes a call to every page
 * that (transitively) uses the file it lives in.
 */

const fs = require('fs');
const path = require('path');

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage']);
const EXTENSIONS = ['', '.tsx', '.ts', '.jsx', '.js', '.mjs', '/index.tsx', '/index.ts', '/index.jsx', '/index.js'];
const IMPORT_RX = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)["'`]([^"'`]+)["'`]/g;
const ALIASES = ['@/', '~/', 'src/'];

function listSourceFiles(srcDir) {
  const out = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name));
      } else if (/\.(j|t)sx?$/.test(entry.name) && !/\.(test|spec|stories)\.(j|t)sx?$/.test(entry.name)) {
        out.push(path.join(dir, entry.name));
      }
    }
  };
  walk(srcDir);
  return out;
}

function tryFile(base) {
  for (const ext of EXTENSIONS) {
    const candidate = base + ext;
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch { /* keep trying */ }
  }
  return null;
}

/** Turn an import specifier into a file inside the project, or null for packages. */
function resolveImport(spec, fromFile, srcDir) {
  if (spec.startsWith('.')) return tryFile(path.resolve(path.dirname(fromFile), spec));
  for (const alias of ALIASES) {
    if (spec.startsWith(alias)) return tryFile(path.resolve(srcDir, spec.slice(alias.length)));
  }
  return null;
}

function importsOf(file, srcDir, cache) {
  if (cache.has(file)) return cache.get(file);
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { /* unreadable */ }
  const found = new Set();
  IMPORT_RX.lastIndex = 0;
  let m;
  while ((m = IMPORT_RX.exec(text))) {
    const resolved = resolveImport(m[1], file, srcDir);
    if (resolved && resolved !== file) found.add(resolved);
  }
  const list = [...found];
  cache.set(file, list);
  return list;
}

/** Every project file a page file uses, directly or through other files, including itself. */
function closureOf(file, srcDir, cache = new Map(), limit = 400) {
  const seen = new Set([file]);
  const queue = [file];
  while (queue.length && seen.size < limit) {
    const current = queue.shift();
    for (const next of importsOf(current, srcDir, cache)) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

/** The file behind a route: an explicit file (file-based routers) or the file named after its component. */
function routeFileFor(info, allFiles) {
  if (info && info.file && fs.existsSync(info.file)) return info.file;
  const name = String((info && info.component) || '').toLowerCase();
  if (!name) return null;
  const named = allFiles.filter((f) => path.basename(f).replace(/\.[^.]+$/, '').toLowerCase() === name);
  if (named.length) return named[0];
  const indexed = allFiles.filter((f) => /^index\./i.test(path.basename(f)) && path.basename(path.dirname(f)).toLowerCase() === name);
  return indexed[0] || null;
}

module.exports = { listSourceFiles, resolveImport, importsOf, closureOf, routeFileFor };
