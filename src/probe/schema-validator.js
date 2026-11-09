'use strict';

const { openApiToZod } = require('./openapi-to-zod');

function validateSchema(body, responseSchema) {
  if (!responseSchema || body === null || body === undefined) {
    return { valid: true, ok: true, errors: [] };
  }

  try {
    const schema = openApiToZod(responseSchema);
    const result = schema.safeParse(body);
    if (result.success) return { valid: true, ok: true, errors: [], issues: [] };
    return {
      valid: false,
      ok: false,
      errors: result.error.issues.map(formatIssue),
      issues: result.error.issues,
    };
  } catch (err) {
    return { valid: true, ok: true, errors: [], issues: [], validatorError: err.message };
  }
}

function formatIssue(issue) {
  const field = issue.path && issue.path.length > 0 ? issue.path.join('.') : '(root)';
  if (issue.code === 'invalid_type') {
    // zod 3 gives `issue.received`; zod 4 only puts it in the message ("... received undefined").
    const received = issue.received || (/received (\w+)/.exec(String(issue.message || '')) || [])[1] || 'unknown';
    if (received === 'undefined') {
      return `Missing required field: "${field}"`;
    }
    return `Type mismatch at "${field}": expected ${issue.expected}, got ${received}`;
  }
  return `${field}: ${issue.message}`;
}

module.exports = { validateSchema };
