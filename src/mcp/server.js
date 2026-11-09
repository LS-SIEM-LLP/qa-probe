'use strict';

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { sanitizeResult } = require('./sanitize');
const pkg = require('../../package.json');

const tools = [
  require('./tools/get-graph'),
  require('./tools/get-report'),
  require('./tools/probe-endpoint'),
  require('./tools/explain-failure'),
  require('./tools/suggest-fix'),
  require('./tools/blast-radius'),
  require('./tools/run-analysis'),
  require('./tools/label'),
];

async function startMcpServer(config) {
  // Load cached state from disk
  const { loadGraph, loadProbeResults, loadReport } = require('../cache');
  let state = {
    graph: await loadGraph(config),
    probeResults: await loadProbeResults(config),
    report: await loadReport(config),
    config,
  };

  function updateState(updates) {
    Object.assign(state, updates);
  }

  const server = new Server(
    { name: 'qa-probe', version: pkg.version },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema || { type: 'object', properties: {} },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = tools.find(t => t.name === name);

    if (!tool) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
        isError: true,
      };
    }

    try {
      const result = await tool.execute(args || {}, { ...state, updateState });
      return {
        content: [{ type: 'text', text: JSON.stringify(sanitizeResult(result), null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: JSON.stringify(sanitizeResult({ error: err.message })) }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.stderr.write('[qa-probe] MCP server started. Tools: ' + tools.map(t => t.name).join(', ') + '\n');
}

/**
 * Start a minimal MCP server that reports a setup problem (bad or missing config,
 * missing credentials) through the protocol. Exiting instead makes most MCP clients
 * show only "connection closed", hiding the actual reason.
 */
async function startSetupErrorServer(message) {
  const server = new Server(
    { name: 'qa-probe', version: pkg.version },
    { capabilities: { tools: {} } }
  );
  const text = JSON.stringify({
    error: 'qa-probe is not configured',
    detail: String(message),
    next: 'Fix the configuration, then restart the MCP server. Run `qa-probe doctor` for a full check.',
  }, null, 2);

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{
      name: 'setup_status',
      description: 'qa-probe could not start normally. Call this to see why and how to fix it.',
      inputSchema: { type: 'object', properties: {} },
    }],
  }));
  server.setRequestHandler(CallToolRequestSchema, async () => ({
    content: [{ type: 'text', text }],
    isError: true,
  }));

  await server.connect(new StdioServerTransport());
  process.stderr.write('[qa-probe] Started in setup-error mode: ' + String(message).split('\n')[0] + '\n');
}

module.exports = { startMcpServer, startSetupErrorServer };
