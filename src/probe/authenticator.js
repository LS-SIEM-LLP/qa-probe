'use strict';

const { getAdapter } = require('../analyze/backend-fetcher');

/**
 * Authenticate against the API and return request headers.
 * Supports: bearer token, api-key, cookie, none.
 */
async function authenticate(config, http) {
  return (await login(config, http)).headers;
}

/** Sign in. Returns the request headers and any cookies the login response set (for browser tracing). */
async function login(config, http) {
  const { auth } = config;
  const empty = (headers) => ({ headers, cookies: [] });

  if (auth.type === 'none') return empty({});

  if (auth.type === 'api-key') {
    return empty({ [auth.apiKeyHeader || 'X-API-Key']: auth.apiKey });
  }

  const adapter = getAdapter(config.framework);
  const authRequest = adapter.buildAuthRequest(config);
  if (!authRequest) return empty({});

  const format = (auth && auth.loginFormat) || 'auto';
  const send = async (asForm) => {
    const body = authRequest.data || {};
    return http.request({
      method: authRequest.method,
      url: authRequest.url,
      data: asForm ? new URLSearchParams(Object.entries(body).map(([k, v]) => [k, String(v)])).toString() : body,
      headers: asForm ? { 'Content-Type': 'application/x-www-form-urlencoded' } : undefined,
      validateStatus: () => true,
    });
  };

  let loginRes;
  try {
    loginRes = await send(format === 'form');
    // Many FastAPI apps use the OAuth2 password form: JSON gets 422 (or 415), a form body works.
    if (format === 'auto' && (loginRes.status === 422 || loginRes.status === 415)) {
      const retry = await send(true);
      if (retry.status < 400) loginRes = retry;
    }
  } catch (err) {
    throw new Error(`Authentication request failed: ${err.message}`);
  }

  if (loginRes.status >= 400) {
    throw new Error(
      `Authentication failed: ${loginRes.status} ${loginRes.statusText}. ` +
      `Check auth.credentials in your config. URL: ${authRequest.url}`
    );
  }

  const raw = loginRes.headers && loginRes.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  return { headers: adapter.extractToken(loginRes, config), cookies };
}

module.exports = { authenticate, login };
