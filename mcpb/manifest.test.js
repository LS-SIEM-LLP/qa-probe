'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const template = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.template.json'), 'utf8').replace(/__VERSION__/g, '0.0.0'));

function serverToolNames() {
  const dir = path.join(ROOT, 'src', 'mcp', 'tools');
  return fs.readdirSync(dir).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
    .map((f) => require(path.join(dir, f)).name).sort();
}

test('the manifest lists exactly the tools the server exposes', () => {
  assert.deepStrictEqual(template.tools.map((t) => t.name).sort(), serverToolNames());
});

test('every ${user_config.x} used by the server is declared in user_config', () => {
  const used = JSON.stringify(template.server.mcp_config).match(/\$\{user_config\.(\w+)\}/g) || [];
  for (const ref of used) {
    const key = ref.replace('${user_config.', '').replace('}', '');
    assert.ok(template.user_config[key], `user_config.${key} is used but not declared`);
  }
});

test('secrets are marked sensitive and nothing credential-like has a default', () => {
  assert.strictEqual(template.user_config.qa_password.sensitive, true);
  for (const [key, cfg] of Object.entries(template.user_config)) {
    if (/pass|secret|token|key/i.test(key)) assert.strictEqual(cfg.default, undefined, `${key} must not have a default`);
  }
});

test('the build produces a valid zip with the manifest at the root and no test files', () => {
  const { build } = require('../scripts/build-mcpb');
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-probe-build-'));
  const result = build({ outDir });
  const buf = fs.readFileSync(result.outFile);
  assert.strictEqual(buf.readUInt32LE(0), 0x04034b50, 'starts with a zip local header');
  assert.strictEqual(buf.readUInt32LE(buf.length - 22), 0x06054b50, 'ends with a zip end record');
  assert.strictEqual(result.manifest.version, require('../package.json').version);
  const names = buf.toString('latin1');
  assert.ok(names.includes('manifest.json'));
  assert.ok(!/src\/verify\/verify\.test\.js/.test(names));
  fs.rmSync(outDir, { recursive: true, force: true });
});
