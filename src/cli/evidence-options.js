'use strict';

/**
 * Command-line switches that add runtime evidence (what the app really calls) to an analysis.
 *   --har <file>          use a recorded .har file
 *   --runtime             open each page in a real browser and record its requests
 *   --frontend-url <url>  where the frontend is served (needed for --runtime)
 */
function applyEvidenceOptions(config, opts = {}) {
  config.analyze = config.analyze || {};
  if (opts.har) {
    config.analyze.har = { ...(config.analyze.har || {}), enabled: true, harFile: String(opts.har) };
  }
  if (opts.runtime || opts.frontendUrl) {
    const runtime = { ...(config.analyze.runtime || {}), enabled: true };
    if (opts.frontendUrl) runtime.baseUrl = String(opts.frontendUrl);
    if (runtime.useProbeAuth === undefined) runtime.useProbeAuth = true;
    config.analyze.runtime = runtime;
    if (!runtime.baseUrl) {
      throw new Error('--runtime needs the address of the running frontend: add --frontend-url http://localhost:3000 (or set analyze.runtime.baseUrl in the config).');
    }
  }
  return config;
}

module.exports = { applyEvidenceOptions };
