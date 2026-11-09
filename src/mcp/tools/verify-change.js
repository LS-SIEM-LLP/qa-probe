'use strict';

const { verifyChange } = require('../../verify');

module.exports = {
  name: 'qa_probe_verify_change',
  description:
    'After you edit code, check that the running system still works. Pass the files you changed; qa-probe maps them to the pages and API endpoints they affect, live-probes those endpoints, and returns pass, fail or inconclusive with evidence and what it could not check. Ask: "I changed frontend/src/components/Alerts.tsx, does the app still work?" Never mutates data.',
  inputSchema: {
    type: 'object',
    properties: {
      files: {
        type: 'array',
        items: { type: 'string' },
        description: 'Paths of the files you changed, relative to the project root.',
      },
      all: {
        type: 'boolean',
        description: 'Probe every known endpoint instead of only those the changed files affect.',
      },
    },
  },
  async execute({ files = [], all = false } = {}, { config, graph }) {
    if (!config) return { error: 'No config available.' };
    if (!all && (!Array.isArray(files) || files.length === 0)) {
      return { error: 'Pass the changed files, or set all: true.' };
    }
    return verifyChange({ changedFiles: files, graph, config, all });
  },
};
