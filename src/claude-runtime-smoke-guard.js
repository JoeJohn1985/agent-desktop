'use strict';

// Prevent a packaged smoke under a checkout from silently borrowing its dependencies.
const { registerHooks } = require('node:module');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const root = path.resolve(process.env.AGENT_DESKTOP_SMOKE_MODULE_ROOT);
registerHooks({
  resolve(specifier, context, nextResolve) {
    const result = nextResolve(specifier, context);
    if (result.url.startsWith('file:')) {
      const file = fileURLToPath(result.url);
      if (!file.startsWith(root + path.sep)) {
        throw new Error(`Smoke dependency escaped bundled node_modules: ${file}`);
      }
    }
    return result;
  },
});
