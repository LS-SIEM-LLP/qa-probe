#!/usr/bin/env node
'use strict';

/**
 * Build a Claude desktop extension (.mcpb) for qa-probe. No third-party tools needed.
 *
 *   node scripts/build-mcpb.js [--out <dir>]
 *
 * A .mcpb file is a zip holding manifest.json plus the server and its production
 * dependencies. This script stages those files, writes the manifest from
 * mcpb/manifest.template.json with the package version, and zips the result.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const pkg = require(path.join(ROOT, 'package.json'));

// ---- dependency closure (production only) ------------------------------------------------

function resolvePackageDir(name, fromDir) {
  let dir = fromDir;
  for (;;) {
    const candidate = path.join(dir, 'node_modules', name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function productionClosure(rootDir) {
  const seen = new Map();
  const missing = [];
  const queue = [{ dir: rootDir, pkg: JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')) }];
  while (queue.length) {
    const { dir, pkg: manifest } = queue.shift();
    const deps = { ...(manifest.dependencies || {}), ...(manifest.optionalDependencies || {}) };
    for (const name of Object.keys(deps)) {
      const found = resolvePackageDir(name, dir);
      if (!found) {
        if (!(manifest.optionalDependencies || {})[name]) missing.push(`${name} (needed by ${manifest.name})`);
        continue;
      }
      if (seen.has(found)) continue;
      seen.set(found, true);
      queue.push({ dir: found, pkg: JSON.parse(fs.readFileSync(path.join(found, 'package.json'), 'utf8')) });
    }
  }
  return { dirs: [...seen.keys()], missing };
}

// ---- staging -----------------------------------------------------------------------------

function copyDir(src, dest, skip = () => false) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (skip(from, entry)) continue;
    if (entry.isDirectory()) copyDir(from, to, skip);
    else if (entry.isFile()) fs.copyFileSync(from, to);
  }
}

/** Leave out what a running server never reads: nested node_modules (visited separately), tests, docs, source maps. */
function skipInDependency(from, entry) {
  if (entry.isDirectory()) return /^(node_modules|test|tests|__tests__|docs?|examples?|\.github)$/i.test(entry.name);
  if (/\.(map|markdown)$/i.test(entry.name)) return true;
  return /\.md$/i.test(entry.name) && !/^(license|licence|notice)/i.test(entry.name);
}

function stage(stageDir) {
  const isTest = (file, entry) => entry.isFile() && /\.test\.js$/.test(entry.name);
  copyDir(path.join(ROOT, 'bin'), path.join(stageDir, 'bin'));
  copyDir(path.join(ROOT, 'src'), path.join(stageDir, 'src'), isTest);
  for (const file of ['package.json', 'LICENSE', 'NOTICE', 'README.md', 'CHANGELOG.md']) {
    if (fs.existsSync(path.join(ROOT, file))) fs.copyFileSync(path.join(ROOT, file), path.join(stageDir, file));
  }

  const { dirs, missing } = productionClosure(ROOT);
  if (missing.length) throw new Error(`Dependencies are not installed: ${missing.join(', ')}. Run npm ci first.`);
  for (const dir of dirs) {
    const rel = path.relative(ROOT, dir);
    // Skip a package's own nested node_modules here: the closure visits those separately.
    copyDir(dir, path.join(stageDir, rel), skipInDependency);
  }

  const template = fs.readFileSync(path.join(ROOT, 'mcpb', 'manifest.template.json'), 'utf8');
  const manifest = JSON.parse(template.replace(/__VERSION__/g, pkg.version));
  fs.writeFileSync(path.join(stageDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { manifest, packages: dirs.length };
}

// ---- zip writer (deflate, no dependencies) -----------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0;
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function listFiles(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, base, out);
    else if (entry.isFile()) out.push({ full, name: path.relative(base, full).split(path.sep).join('/') });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function writeZip(files, outFile) {
  const parts = [];
  const central = [];
  let offset = 0;
  const dosTime = 0;
  const dosDate = (1 << 5) | 1 | ((2026 - 1980) << 9); // fixed date keeps builds reproducible

  for (const file of files) {
    const data = fs.readFileSync(file.full);
    const compressed = zlib.deflateRawSync(data, { level: 9 });
    const useDeflate = compressed.length < data.length;
    const body = useDeflate ? compressed : data;
    const method = useDeflate ? 8 : 0;
    const name = Buffer.from(file.name, 'utf8');
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, name, body);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt16LE(dosTime, 12);
    entry.writeUInt16LE(dosDate, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(0o100644 << 16 >>> 0, 38);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += local.length + name.length + body.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, Buffer.concat([...parts, centralBuf, end]));
}

// ---- main --------------------------------------------------------------------------------

function build({ outDir = path.join(ROOT, 'dist-mcpb'), keepStage = false } = {}) {
  const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-probe-mcpb-'));
  try {
    const { manifest, packages } = stage(stageDir);
    const files = listFiles(stageDir);
    const outFile = path.join(outDir, `qa-probe-${pkg.version}.mcpb`);
    writeZip(files, outFile);
    return { outFile, files: files.length, packages, manifest, stageDir: keepStage ? stageDir : null };
  } finally {
    if (!keepStage) fs.rmSync(stageDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  const outIdx = process.argv.indexOf('--out');
  const result = build({ outDir: outIdx > -1 ? path.resolve(process.argv[outIdx + 1]) : undefined });
  const size = (fs.statSync(result.outFile).size / 1024 / 1024).toFixed(1);
  console.log(`Built ${result.outFile}`);
  console.log(`  ${result.files} files, ${result.packages} dependency packages, ${size} MB`);
}

module.exports = { build, productionClosure, writeZip, crc32 };
