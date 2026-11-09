'use strict';

const { loadConfig } = require('../../config/loader');
const { startMcpServer, startSetupErrorServer } = require('../../mcp/server');

module.exports = async function mcp(opts) {
  let config;
  try {
    config = loadConfig(opts.config);
  } catch (err) {
    // Report the problem through MCP so the client shows it, instead of "connection closed".
    console.error(`\nError: ${err.message}`);
    if (process.env.DEBUG) console.error(err.stack);
    await startSetupErrorServer(err.message);
    return;
  }
  try {
    await startMcpServer(config);
  } catch (err) {
    console.error(`\nError: ${err.message}`);
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  }
};
