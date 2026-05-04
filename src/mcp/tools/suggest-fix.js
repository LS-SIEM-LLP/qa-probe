'use strict';

const FIX_GUIDES = {
  feature_flag_disabled: `
The backend router for this feature is not registered because its HAS_* flag is False.

Steps to fix:
1. Check your .env.prod or environment variables for the HAS_* flag controlling this prefix.
2. Set it to True (or 1, depending on your config parser).
3. Restart the API container: docker restart ls-api
4. Re-run qa-probe probe to confirm the 404 is gone.

For LightShield-SIEM the flags live in .env.prod and are parsed in backend/app/config.py.
`,
  missing_route: `
The frontend is calling a backend path that does not exist in the OpenAPI spec.

Steps to fix:
1. Check the frontend API call site (shown in explain-failure) for a typo.
2. Check backend/app/main.py to see if include_router() is missing for this router.
3. Check that the router file exists and imports cleanly (no ImportError).
4. If the route is new, ensure you added it to the correct router file AND registered it in main.py.
`,
  contract_mismatch: `
The frontend calls a path that is close to a backend route but not exactly matching.

Common causes:
- Trailing slash: frontend calls /alerts, backend has /alerts/ (or vice versa)
- API prefix: frontend calls /api/alerts, backend expects /alerts
- Casing: /Users vs /users

Fix: align the frontend call path to exactly match the backend route key shown in the detail.
`,
  empty_db: `
The endpoint is working correctly (200 OK) but the database has no records.

Steps to fix:
1. Run the seed script: docker exec -it ls-api python scripts/seed_demo_data.py
2. For specific tables, check other seed scripts in backend/scripts/.
3. Verify the seed ran: curl -H "Authorization: Bearer TOKEN" http://localhost:8000/alerts | jq length
`,
  auth_scope_mismatch: `
The test user does not have the required scope/role for this endpoint.

Steps to fix:
1. Check the endpoint's required scopes (visible in the OpenAPI spec or backend decorator).
2. Use a user with admin role for smoke testing.
3. Or update the test user's scopes in the database.
`,
  schema_mismatch: `
The endpoint returns 200 with data, but the response fields don't match what the frontend expects.

Common causes:
- A field was renamed (e.g., rule_name → name) in a backend refactor
- A field was removed from the response model
- A new required field was added that older data doesn't have

Fix: check the schemaErrors detail and align either the frontend component or the backend response model.
`,
  stream_dead: `
The SSE or WebSocket endpoint is not delivering events.

Steps to fix:
1. Confirm the endpoint URL is correct and the server is running.
2. Check that your reverse proxy (nginx/traefik) is configured to pass SSE/WS connections through
   (proxy_buffering off for nginx; no timeout/buffering for traefik).
3. Check backend logs for errors in the event emitter or background task.
4. Confirm the auth token works for streaming endpoints (some backends require separate WS auth).
`,
  server_error: `
The endpoint returned a 5xx error.

Steps to fix:
1. Check backend logs: docker logs ls-api --tail 100 | grep ERROR
2. Look for a Python traceback immediately before the 500 response.
3. Common causes: unhandled exception, database connection issue, missing dependency.
`,
  slow_but_working: `
The endpoint is working but responding slowly (near the probe timeout).

Suggested improvements:
1. Add a database index on the query's filter/sort columns.
2. Add a result cache (Redis or in-memory) for expensive aggregation queries.
3. Paginate the response if it returns large datasets.
`,
};

module.exports = {
  name: 'qa_probe_suggest_fix',
  description: 'Get a step-by-step fix guide for a root cause category. Ask: "What do I do about feature_flag_disabled issues?"',
  inputSchema: {
    type: 'object',
    properties: {
      rootCause: {
        type: 'string',
        enum: Object.keys(FIX_GUIDES),
        description: 'Root cause category to get a fix guide for.',
      },
    },
    required: ['rootCause'],
  },
  async execute({ rootCause } = {}) {
    const guide = FIX_GUIDES[rootCause];
    if (!guide) {
      return { error: `Unknown root cause: "${rootCause}". Known causes: ${Object.keys(FIX_GUIDES).join(', ')}` };
    }
    return { rootCause, guide: guide.trim() };
  },
};
