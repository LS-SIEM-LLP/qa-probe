'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function createParseCache(configOrOptions = {}) {
  const outputDir = configOrOptions.outputDir ||
    (configOrOptions.output && configOrOptions.output.dir) ||
    '.qaprobe';
  const cacheFile = path.resolve(process.cwd(), outputDir, 'parse-cache.json');
  const { entries, files } = readCache(cacheFile);

  return {
    cacheFile,
    get(source) {
      const hash = hashSource(source);
      return { hash, ast: entries[hash] ? entries[hash].ast : null };
    },
    getForFile(filePath) {
      const key = normalizeFile(filePath);
      const hash = files[key];
      return hash && entries[hash] ? entries[hash].ast : null;
    },
    set(source, ast, filePath = null) {
      const hash = hashSource(source);
      entries[hash] = {
        ast,
        updatedAt: new Date().toISOString(),
      };
      if (filePath) files[normalizeFile(filePath)] = hash;
      return hash;
    },
    save() {
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify({ version: 1, entries, files }, null, 2), 'utf8');
    },
  };
}

function readCache(cacheFile) {
  if (!fs.existsSync(cacheFile)) return { entries: {}, files: {} };
  try {
    const raw = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    return {
      entries: raw && raw.entries && typeof raw.entries === 'object' ? raw.entries : {},
      files: raw && raw.files && typeof raw.files === 'object' ? raw.files : {},
    };
  } catch {
    return { entries: {}, files: {} };
  }
}

function hashSource(source) {
  return crypto.createHash('sha256').update(source || '').digest('hex');
}

function makeParseWarning(file, err, extra = {}) {
  const loc = err && err.loc;
  return {
    file,
    error: err && err.message ? err.message : String(err || 'Parse failed'),
    line: loc && loc.line ? loc.line : null,
    ...extra,
  };
}

function normalizeFile(filePath) {
  return path.resolve(filePath).replace(/\\/g, '/');
}

module.exports = { createParseCache, hashSource, makeParseWarning };
