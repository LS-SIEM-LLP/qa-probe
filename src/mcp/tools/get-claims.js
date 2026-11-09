'use strict';

const { buildClaims } = require('../../claims');

module.exports = {
  name: 'qa_probe_get_claims',
  description:
    'List what each page claims to depend on and how strong the evidence is: found only in source code (static-only) or seen in real traffic (runtime-observed), plus the latest live status (healthy, broken, unverified, not-probed). Use it to know what is proven and what is only a guess before you change code. Pass a page route to focus on one page.',
  inputSchema: {
    type: 'object',
    properties: {
      page: { type: 'string', description: 'Only this page route, for example "/alerts".' },
      limit: { type: 'number', description: 'Maximum pages to return (default 20, broken pages first).' },
    },
  },
  async execute({ page = null, limit = 20 } = {}, { graph, probeResults }) {
    if (!graph) return { error: 'No graph available. Run qa-probe analyze first.' };
    return buildClaims(graph, probeResults || {}, { route: page, limit });
  },
};
