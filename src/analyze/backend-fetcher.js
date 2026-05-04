'use strict';

const axios = require('axios');
const https = require('https');

/**
 * Create a pre-configured axios instance for probing.
 */
function createHttpClient(config) {
  const httpsAgent = config.probe.ignoreHTTPSErrors
    ? new https.Agent({ rejectUnauthorized: false })
    : undefined;

  return axios.create({
    baseURL: config.baseUrl,
    timeout: config.probe.timeoutMs,
    httpsAgent,
    validateStatus: () => true, // never throw on HTTP errors — we inspect status ourselves
  });
}

/**
 * Get the right adapter for the configured framework.
 */
function getAdapter(framework) {
  switch (framework) {
    case 'express': return require('./adapters/express');
    case 'nextjs':  return require('./adapters/fastapi'); // next uses same OpenAPI shape
    case 'generic': return require('./adapters/generic');
    default:        return require('./adapters/fastapi');
  }
}

module.exports = { createHttpClient, getAdapter };
