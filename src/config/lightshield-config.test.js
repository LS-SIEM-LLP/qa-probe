'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const configModule = require(path.resolve(__dirname, '../../../qa-probe.lightshield.config.js'));
const { ConfigSchema } = require('./schema');

function withEnv(env, fn) {
  const oldEnv = process.env;
  process.env = { ...env };
  try {
    return fn();
  } finally {
    process.env = oldEnv;
  }
}

test('LightShield qa-probe config requires the qa_admin service account password', () => {
  assert.throws(
    () => withEnv({}, () => configModule()),
    /QA_SERVICE_PASSWORD/
  );
});

test('LightShield qa-probe config validates with the non-MFA QA service account', () => {
  const config = withEnv({ QA_SERVICE_PASSWORD: 'not-a-real-secret' }, () => configModule());
  const parsed = ConfigSchema.parse(config);

  assert.equal(parsed.auth.credentials.username, 'qa_admin');
  assert.equal(parsed.auth.credentials.password, 'not-a-real-secret');
  assert.equal(parsed.output.dir, '.qaprobe');
  assert.equal(parsed.probe.ignoreHTTPSErrors, true);
});

test('LightShield qa-probe config rejects accidental human account drift', () => {
  assert.throws(
    () => withEnv({
      QA_SERVICE_USER: 'interactive_user',
      QA_SERVICE_PASSWORD: 'not-a-real-secret',
    }, () => configModule()),
    /qa_admin/
  );
});
