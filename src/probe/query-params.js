'use strict';

/**
 * Sample values for REQUIRED query parameters.
 *
 * A required query parameter that is missing makes a healthy endpoint answer 422, which
 * looks like a bug but is not one. Values come from, in order: the user's own
 * `probe.queryParamValues`, the spec's example, its default, its first enum value, then a
 * harmless value for the type. Optional parameters are never sent.
 */

function sampleValue(param) {
  if (param.example !== null && param.example !== undefined) return param.example;
  if (param.default !== null && param.default !== undefined) return param.default;
  if (Array.isArray(param.enum) && param.enum.length) return param.enum[0];
  switch (param.type) {
    case 'integer':
      return param.minimum !== null && param.minimum !== undefined ? Math.max(1, param.minimum) : 1;
    case 'number':
      return param.minimum !== null && param.minimum !== undefined ? Math.max(1, param.minimum) : 1;
    case 'boolean':
      return false;
    case 'array':
      return undefined;
    default:
      break;
  }
  if (param.format === 'uuid') return '00000000-0000-4000-8000-000000000001';
  if (param.format === 'date') return '2026-01-01';
  if (param.format === 'date-time') return '2026-01-01T00:00:00Z';
  if (param.format === 'email') return 'qa-probe@example.com';
  return 'qa-probe';
}

function sampleQueryParams(routeInfo, config) {
  const required = (routeInfo && routeInfo.queryParams) || [];
  if (!required.length) return undefined;
  const overrides = (config && config.probe && config.probe.queryParamValues) || {};
  const out = {};
  for (const param of required) {
    const value = Object.prototype.hasOwnProperty.call(overrides, param.name) ? overrides[param.name] : sampleValue(param);
    if (value !== undefined) out[param.name] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

module.exports = { sampleQueryParams, sampleValue };
