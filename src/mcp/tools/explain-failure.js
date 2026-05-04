'use strict';

module.exports = {
  name: 'qa_probe_explain_failure',
  description: 'Explain in plain English why a specific frontend route is showing no data or failing. Ask: "Why is /rules showing no data?"',
  inputSchema: {
    type: 'object',
    properties: {
      route: { type: 'string', description: 'Frontend route path (e.g. /rules)' },
    },
    required: ['route'],
  },
  async execute({ route } = {}, { report, graph, probeResults }) {
    if (!report || !graph) return { error: 'No report or graph available. Run qa-probe run first.' };

    const routeData = report.routes && report.routes[route];
    if (!routeData) {
      return { error: `Route "${route}" not in report. Available routes: ${Object.keys(report.routes || {}).slice(0, 10).join(', ')}` };
    }

    const graphRoute = graph.frontendRoutes && graph.frontendRoutes[route];
    const apiCalls = (graphRoute && graphRoute.apiCalls) || [];
    const callDetails = [];

    for (const call of apiCalls) {
      const key = `${call.method} ${call.backendPath || call.path}`;
      const probe = probeResults && probeResults[key];
      callDetails.push({
        call: key,
        callSite: call.callSite,
        status: probe ? probe.status : 'not probed',
        ms: probe ? probe.ms : null,
        empty: probe ? probe.empty : null,
        itemCount: probe ? probe.itemCount : null,
      });
    }

    return {
      route,
      score: routeData.score,
      status: routeData.status,
      rootCause: routeData.rootCause,
      rootCauseDetail: routeData.rootCauseDetail,
      fixHint: routeData.fixHint,
      apiCalls: callDetails,
      featureFlag: graph.featureFlags && graph.featureFlags[route],
    };
  },
};
