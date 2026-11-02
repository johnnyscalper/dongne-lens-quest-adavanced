# Browser interface

`index.html` defines the welcome view, six app screens, bottom navigation and dialogs. `styles.css` is the base theme; `mobile.css` is loaded last for the mobile-first layout. `mobile.js` owns screen/history transitions, local demo profiles, search/detail dialogs and saved snapshots. `app.js` owns search, transaction cards and financial inputs. `journey.js` draws the cinematic village; `labs.js` owns the two experiments.

The Python server serves `index.html` and same-origin API routes. Do not open this source HTML directly as a local file; open the generated root `play.html` instead.

For the standalone build, `build_static.py` embeds styles, region data and these scripts at the end of the body:

1. `local-analytics.js`: the Python-compatible calculation engine.
2. `local-insights.js`: matching-cohort and blind-choice engine.
3. `local-api.js`: fictional records and parsed-JSON route adapter.
4. `journey.js`, `labs.js`, `mobile.js`, `app.js`: the shared interface, in that order.

The adapter activates only when `DONGNE_RUNTIME === 'local'`. Failed official requests never switch silently to local data. The single-file edition needs no external assets or network connection; official data remains server-only.

Only explicit, successful searches emit `lens:search-success` to move to results. Initial loading and financial recalculation must not navigate. The demo profile is not authentication. Nickname, recent searches and saved snapshots may use guarded browser storage; financial inputs and blind-choice history are not automatically persisted. See [mobile behavior](../docs/MOBILE.md) and [API/events](../docs/API.md).
