'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const { runDoctor } = require('./doctor');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qa-probe-doctor-'));
}

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('doctor reports a missing config file without throwing', async () => {
  const lines = [];
  const res = await runDoctor({ config: path.join(tmpDir(), 'nope.config.js') }, (l) => lines.push(String(l)));
  assert.strictEqual(res.failed, 1);
  assert.ok(lines.join('\n').includes('Config file'));
});

test('doctor passes against a reachable backend and never prints the password', async () => {
  const server = await listen((req, res) => { res.statusCode = 200; res.end('{}'); });
  const dir = tmpDir();
  const cfg = path.join(dir, 'qa-probe.config.js');
  const secret = 'S3cr3t-do-not-print';
  fs.writeFileSync(cfg, `module.exports = { baseUrl: 'http://127.0.0.1:${server.address().port}', output: { dir: ${JSON.stringify(path.join(dir, 'out'))} }, auth: { type: 'bearer', credentials: { username: 'u', password: '${secret}' } } };`);
  const lines = [];
  try {
    const res = await runDoctor({ config: cfg }, (l) => lines.push(String(l)));
    assert.strictEqual(res.failed, 0, lines.join('\n'));
    assert.ok(!lines.join('\n').includes(secret));
  } finally {
    server.close();
  }
});

test('doctor fails when the backend is unreachable', async () => {
  const dir = tmpDir();
  const cfg = path.join(dir, 'qa-probe.config.js');
  fs.writeFileSync(cfg, `module.exports = { baseUrl: 'http://127.0.0.1:1', output: { dir: ${JSON.stringify(path.join(dir, 'out'))} }, auth: { type: 'none' } };`);
  const res = await runDoctor({ config: cfg }, () => {});
  assert.strictEqual(res.failed, 1);
});

test('mcp with a broken config stays up and explains the problem instead of exiting', async () => {
  const dir = tmpDir();
  const cfg = path.join(dir, 'qa-probe.config.js');
  fs.writeFileSync(cfg, "throw new Error('QA_PASSWORD is required');");
  const bin = path.resolve(__dirname, '../../../bin/qa-probe.js');
  const child = spawn(process.execPath, [bin, 'mcp', '--config', cfg], { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  const send = (msg) => child.stdin.write(JSON.stringify(msg) + '\n');
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
  await new Promise((r) => setTimeout(r, 1200));
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'setup_status', arguments: {} } });
  await new Promise((r) => setTimeout(r, 1200));
  const stillRunning = child.exitCode === null;
  child.kill();
  assert.ok(stillRunning, 'server exited instead of staying up');
  assert.ok(out.includes('QA_PASSWORD is required'), out);
  assert.ok(out.includes('"version":"' + require('../../../package.json').version + '"'), 'server should report the package version');
});
