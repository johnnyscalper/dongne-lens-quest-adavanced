/* Test transport for the production mobile state boundaries; no fake DOM. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const helpers = require(path.resolve(__dirname, '../public/mobile.js'));
const allowed = new Set([
  'cleanName', 'normalizeProfile', 'normalizeRecent', 'normalizeSnapshot',
  'normalizeFavorites', 'routeFromHash', 'routeAfterEvent'
]);

const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const results = input.map(item => {
  if (!allowed.has(item.action) || typeof helpers[item.action] !== 'function') {
    throw new Error(`Unknown production boundary: ${item.action}`);
  }
  const args = item.args || [item.value];
  const before = JSON.stringify(args);
  const value = helpers[item.action](...args);
  return {value, inputChanged: JSON.stringify(args) !== before};
});
process.stdout.write(JSON.stringify(results));
