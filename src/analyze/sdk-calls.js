'use strict';

/**
 * Generated API clients (hey-api / openapi-typescript-codegen style).
 *
 * Many projects never write `axios.get('/items')`. They call a generated class instead:
 *   export class ItemsService { public static readItems(...) { return client.get({ url: '/api/v1/items/' }) } }
 *   await ItemsService.readItems(...)
 *
 * This reads the generated class once to learn which method and URL each function uses, then
 * counts every `ItemsService.readItems(` elsewhere as a call to that endpoint. Text scanning,
 * not AST, because generated files are regular and large.
 */

const fs = require('fs');
const path = require('path');

const HTTP_VERBS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage']);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), out);
    } else if (/\.(j|t)sx?$/.test(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

/** Method and URL used inside one generated function body. */
function endpointFromBody(body) {
  const url = (/\burl\s*:\s*['"`]([^'"`]+)['"`]/.exec(body) || [])[1];
  if (!url) return null;
  const verbCall = new RegExp('\\.(' + HTTP_VERBS.join('|') + ')\\s*(?:<|\\()', 'i').exec(body);
  const methodProp = /\bmethod\s*:\s*['"`](\w+)['"`]/i.exec(body);
  const method = ((verbCall && verbCall[1]) || (methodProp && methodProp[1]) || '').toUpperCase();
  if (!method) return null;
  return { method, url };
}

/** Learn `Class.function -> { method, url }` from generated service classes. */
function discoverSdk(srcDir) {
  const sdk = new Map();
  const files = new Set();
  for (const file of walk(srcDir)) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    if (!/\burl\s*:/.test(text) || !/export\s+class\s+\w+/.test(text)) continue;

    const classRx = /export\s+class\s+(\w+)\s*\{/g;
    let cm;
    while ((cm = classRx.exec(text))) {
      const className = cm[1];
      const start = cm.index + cm[0].length;
      const next = text.slice(start).search(/\nexport\s+(class|const|function|type|interface)\s/);
      const classBody = next === -1 ? text.slice(start) : text.slice(start, start + next);

      const fnRx = /(?:public\s+)?static\s+(?:async\s+)?(\w+)\s*(?:<[^(]*>)?\s*\(/g;
      const marks = [];
      let fm;
      while ((fm = fnRx.exec(classBody))) marks.push({ name: fm[1], at: fm.index });
      marks.forEach((mark, i) => {
        const body = classBody.slice(mark.at, i + 1 < marks.length ? marks[i + 1].at : undefined);
        const endpoint = endpointFromBody(body);
        if (endpoint) {
          sdk.set(`${className}.${mark.name}`, endpoint);
          files.add(file);
        }
      });
    }
  }
  return { sdk, files };
}

/** Every use of `Class.function(` outside the generated files, as an API call. */
function findSdkCalls(srcDir, discovered, relBase) {
  const { sdk, files } = discovered;
  if (!sdk.size) return [];
  const classes = [...new Set([...sdk.keys()].map((k) => k.split('.')[0]))];
  const callRx = new RegExp('\\b(' + classes.join('|') + ')\\.(\\w+)\\s*\\(', 'g');
  const calls = [];
  for (const file of walk(srcDir)) {
    if (files.has(file)) continue;
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    const rel = path.relative(relBase, file).replace(/\\/g, '/');
    let m;
    callRx.lastIndex = 0;
    while ((m = callRx.exec(text))) {
      const endpoint = sdk.get(`${m[1]}.${m[2]}`);
      if (!endpoint) continue;
      const line = text.slice(0, m.index).split('\n').length;
      calls.push({
        method: endpoint.method,
        path: endpoint.url,
        rawPath: endpoint.url,
        callSite: `${rel}:${line}`,
        source: 'sdk',
        file,
      });
    }
  }
  return calls;
}

module.exports = { discoverSdk, findSdkCalls, endpointFromBody };
