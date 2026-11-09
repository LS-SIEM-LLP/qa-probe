'use strict';

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const chalk = require('chalk');
const { loadConfig } = require('../../config/loader');

const OK = chalk.green('✓');
const BAD = chalk.red('✗');
const WARN = chalk.yellow('!');

async function reach(url) {
  try {
    const res = await axios.get(url, { timeout: 4000, validateStatus: () => true });
    return { ok: true, status: res.status };
  } catch (err) {
    return { ok: false, reason: err.code || err.message };
  }
}

function finish(results, out) {
  const failed = results.filter((r) => r.level === 'fail').length;
  const warned = results.filter((r) => r.level === 'warn').length;
  out('');
  out(failed ? chalk.red(`${failed} problem(s) to fix.`) : warned ? chalk.yellow(`Ready, with ${warned} warning(s).`) : chalk.green('All checks passed.'));
  return { results, failed, warned };
}

/** Setup check. Never prints secrets: it only says whether they are present. */
async function runDoctor(opts, out = console.log) {
  const results = [];
  const add = (level, label, detail) => {
    results.push({ level, label, detail });
    const icon = level === 'ok' ? OK : level === 'warn' ? WARN : BAD;
    out(`  ${icon} ${label}${detail ? chalk.gray(' - ' + detail) : ''}`);
  };

  out(chalk.bold('qa-probe doctor'));

  const major = parseInt(process.versions.node.split('.')[0], 10);
  add(major >= 18 ? 'ok' : 'fail', 'Node.js version', process.versions.node + (major >= 18 ? '' : ' (needs 18 or newer)'));

  let config;
  try {
    config = loadConfig(opts.config);
    add('ok', 'Config file loads and validates', path.resolve(process.cwd(), opts.config));
  } catch (err) {
    add('fail', 'Config file', String(err.message).split('\n')[0]);
    return finish(results, out);
  }

  const auth = config.auth || {};
  if (auth.type === 'none') {
    add('ok', 'Authentication', 'none configured');
  } else if (auth.type === 'api-key') {
    add(auth.apiKey ? 'ok' : 'fail', 'API key', auth.apiKey ? 'present' : 'auth.apiKey is empty');
  } else if (auth.credentials && auth.credentials.username && auth.credentials.password) {
    add('ok', 'Login credentials', 'username and password present');
  } else if (config.authToken) {
    add('ok', 'Auth token', 'present');
  } else {
    add('warn', 'Login credentials', 'none found; protected endpoints will be probed unauthenticated');
  }

  const outDir = path.resolve(process.cwd(), (config.output && config.output.dir) || '.qaprobe');
  try {
    fs.mkdirSync(outDir, { recursive: true });
    fs.accessSync(outDir, fs.constants.W_OK);
    add('ok', 'Output folder writable', outDir);
  } catch (err) {
    add('fail', 'Output folder', `${outDir}: ${err.code || err.message}`);
  }

  const base = await reach(config.baseUrl);
  add(base.ok ? 'ok' : 'fail', 'Backend reachable', base.ok ? `${config.baseUrl} answered HTTP ${base.status}` : `${config.baseUrl}: ${base.reason}`);

  if (base.ok && config.openApiUrl && !config.openApiFile) {
    const spec = /^https?:/.test(config.openApiUrl) ? config.openApiUrl : config.baseUrl.replace(/\/$/, '') + config.openApiUrl;
    const res = await reach(spec);
    add(res.ok && res.status === 200 ? 'ok' : 'warn', 'OpenAPI spec', res.ok ? `HTTP ${res.status} at ${spec}` : `${spec}: ${res.reason} (use --headless without a spec)`);
  }

  return finish(results, out);
}

module.exports = async function doctor(opts) {
  const { failed } = await runDoctor(opts);
  process.exit(failed ? 1 : 0);
};
module.exports.runDoctor = runDoctor;
