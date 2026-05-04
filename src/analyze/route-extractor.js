'use strict';

const fs = require('fs');
const path = require('path');
const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const PARSE_OPTS = {
  sourceType: 'module',
  plugins: ['typescript', 'jsx', 'decorators-legacy', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator'],
  errorRecovery: true,
};

/**
 * Extract frontend route definitions from the router file (App.tsx or similar).
 *
 * Looks for:
 *   <Route path="/some-path" element={<Component />} />
 *   <ScopeRoute path="..." scopes={["scope:read"]} />
 *   <AdminRoute path="..." />
 *   <PrivateRoute path="..." />
 *
 * Returns Map<routePath, { component, file, authGuard, requiredScopes }>
 */
function extractRoutes(routerFile, srcDir) {
  if (!fs.existsSync(routerFile)) {
    process.stderr.write(`[qa-probe] Router file not found: ${routerFile}\n`);
    return new Map();
  }

  const src = fs.readFileSync(routerFile, 'utf8');
  const routes = new Map();

  let ast;
  try {
    ast = parse(src, PARSE_OPTS);
  } catch (err) {
    process.stderr.write(`[qa-probe] Failed to parse router file: ${err.message}\n`);
    return routes;
  }

  // Auth guard component names we recognize
  const AUTH_GUARDS = new Set(['ScopeRoute', 'AdminRoute', 'PrivateRoute', 'ProtectedRoute', 'AuthRoute', 'RequireAuth']);
  const ROUTE_COMPONENTS = new Set(['Route', ...AUTH_GUARDS]);

  traverse(ast, {
    JSXOpeningElement(nodePath) {
      const { name, attributes } = nodePath.node;

      const componentName =
        name.type === 'JSXIdentifier' ? name.name :
        name.type === 'JSXMemberExpression' ? `${name.object.name}.${name.property.name}` : null;

      if (!componentName || !ROUTE_COMPONENTS.has(componentName)) return;

      // Extract attributes
      const attrs = {};
      for (const attr of attributes) {
        if (attr.type !== 'JSXAttribute') continue;
        const attrName = attr.name.name;
        const val = attr.value;

        if (!val) {
          attrs[attrName] = true;
        } else if (val.type === 'StringLiteral') {
          attrs[attrName] = val.value;
        } else if (val.type === 'JSXExpressionContainer') {
          const expr = val.expression;
          if (expr.type === 'StringLiteral') {
            attrs[attrName] = expr.value;
          } else if (expr.type === 'ArrayExpression') {
            attrs[attrName] = expr.elements
              .filter(e => e && e.type === 'StringLiteral')
              .map(e => e.value);
          } else if (expr.type === 'Identifier') {
            attrs[attrName] = `{${expr.name}}`;
          }
        }
      }

      let routePath = attrs.path;
      if (!routePath || typeof routePath !== 'string') return;
      if (routePath.includes('*') && !routePath.includes(':')) return; // wildcard catch-all
      // Normalize relative paths (React Router v6 nested routes) to absolute
      if (!routePath.startsWith('/')) routePath = '/' + routePath;

      // Resolve component name from element prop or from JSX children context
      let component = null;
      const elementAttr = attrs.element;
      if (typeof elementAttr === 'string') {
        component = elementAttr;
      } else if (elementAttr === undefined) {
        // Try parent JSXElement to find element attribute
        const parent = nodePath.findParent(p => p.isJSXElement());
        if (parent) {
          const opening = parent.node.openingElement;
          for (const attr of opening.attributes) {
            if (attr.type === 'JSXAttribute' && attr.name.name === 'element') {
              const v = attr.value;
              if (v && v.type === 'JSXExpressionContainer' && v.expression.type === 'JSXElement') {
                const inner = v.expression.openingElement.name;
                component = inner.type === 'JSXIdentifier' ? inner.name : null;
              }
            }
          }
        }
      }

      const isAuthGuard = AUTH_GUARDS.has(componentName);
      const authGuard = isAuthGuard ? componentName : (isAuthGuard ? componentName : null);
      const requiredScopes = Array.isArray(attrs.scopes) ? attrs.scopes : [];

      if (!routes.has(routePath)) {
        routes.set(routePath, {
          component: component || null,
          authGuard: isAuthGuard ? componentName : 'Route',
          requiredScopes,
        });
      }
    },
  });

  return routes;
}

module.exports = { extractRoutes };
