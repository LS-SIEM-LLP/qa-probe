'use strict';

/**
 * Validate a response body against the OpenAPI response schema.
 * Only checks field presence — does not do deep type checking.
 *
 * Returns: { valid: bool, errors: string[] }
 */
function validateSchema(body, responseSchema) {
  if (!responseSchema || !body) return { valid: true, errors: [] };

  const errors = [];

  try {
    if (responseSchema.type === 'array') {
      if (!Array.isArray(body)) {
        errors.push(`Expected array, got ${typeof body}`);
      } else if (body.length > 0 && responseSchema.items) {
        // Validate first item against items schema
        const itemErrors = validateObject(body[0], responseSchema.items);
        errors.push(...itemErrors);
      }
    } else if (responseSchema.type === 'object' || responseSchema.properties) {
      const objErrors = validateObject(body, responseSchema);
      errors.push(...objErrors);
    }
  } catch {
    // Schema validation errors should never break the probe run
  }

  return { valid: errors.length === 0, errors };
}

function validateObject(obj, schema) {
  if (!schema || !schema.properties || typeof obj !== 'object') return [];
  const errors = [];

  const required = schema.required || [];
  for (const field of required) {
    if (!(field in obj)) {
      errors.push(`Missing required field: "${field}"`);
    }
  }

  // Check for unexpected field names that might indicate a rename
  // Only flag if ALL known fields are missing (not just a few)
  const known = Object.keys(schema.properties);
  if (known.length > 0 && typeof obj === 'object' && obj !== null) {
    const responseKeys = Object.keys(obj);
    const overlap = known.filter(k => responseKeys.includes(k));
    if (overlap.length === 0 && responseKeys.length > 0) {
      // None of the spec fields appear in the response — likely a rename
      errors.push(
        `No expected fields found. Spec expects: [${known.slice(0, 5).join(', ')}]. ` +
        `Response has: [${responseKeys.slice(0, 5).join(', ')}]`
      );
    }
  }

  return errors;
}

module.exports = { validateSchema };
