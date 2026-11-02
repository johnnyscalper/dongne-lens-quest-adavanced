/* Test transport only: run browser engines without a DOM or network. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function main() {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  const root = path.resolve(__dirname, '..');
  const NativeDate = Date;
  const timestamp = NativeDate.parse(input.now || '2026-11-02T03:00:00Z');
  class FixedDate extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [timestamp])); }
    static now() { return timestamp; }
  }
  const context = vm.createContext({
    Date: FixedDate, URL, TextEncoder, AbortController,
    DONGNE_REGIONS: JSON.parse(fs.readFileSync(path.join(root, 'data/regions.json'), 'utf8'))
  });
  for (const name of ['local-analytics.js', 'local-insights.js', 'local-api.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'public', name), 'utf8'), context, {filename: name});
  }
  const results = [];
  for (const item of input.cases) {
    try {
      let value;
      if (item.action === 'analyze') value = context.DongneAnalytics.analyze(item.records, item.options);
      else if (item.action === 'insights') value = context.DongneInsights.build(item.records, item.options);
      else if (item.action === 'example') value = context.DongneInsights.example();
      else if (item.action === 'api') {
        const options = {...item.options};
        const controller = new AbortController();
        if (item.abort) options.signal = controller.signal;
        if (item.abort === 'before') controller.abort();
        const pending = context.DongneLocal.request(item.url, options);
        if (item.abort === 'during') controller.abort();
        value = await pending;
      } else throw new Error('Unknown test action');
      results.push({ok: true, value});
    } catch (error) {
      results.push({ok: false, name: error.name, status: error.status || null, message: error.message});
    }
  }
  process.stdout.write(JSON.stringify(results));
}
main().catch(error => { process.stderr.write(String(error.stack)); process.exitCode = 1; });
