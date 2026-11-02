# Automated checks

Run `python3 -m unittest discover -s tests -v` from the repository root. The retained baseline contains 83 checks: 71 Python calculation, experiment, XML, HTTP and CLI checks, plus 12 cross-runtime checks. v0.5 adds mobile shell regression checks; the actual final count and result belong in [the validation record](../docs/VALIDATION.md).

No live API key or external network is needed. HTTP integration starts and closes its own localhost server on an available port.

`test_local_engines.py` uses `local_engine_runner.cjs` and Node to compare full Python/browser engine responses and exercise the local API with real engines. It covers financial assumptions, Unicode candidate IDs, calendar windows, fictional records, cancellation and rejection of official requests. Without Node, these 12 development checks are skipped; the Python app and standalone HTML do not require Node.

`test_mobile_shell.py` adds 11 checks. Four cover template/bundle contracts, six run the real profile/favorite validation helpers through `mobile_shell_runner.cjs`, and one executes `mobile_client_runner.cjs` against the actual client and local engines. The client runner checks explicit search intent, financial recalculation, transaction cards, invalid regions, stale responses, and cancellation followed by reopening. Its small DOM adapter does not verify browser rendering. Real storage API failures, browser navigation, dialog focus, screen sizing and motion controls are checked separately in the validation record; structural checks are not presented as device tests.

After source changes, run `python3 build_static.py`, then `python3 build_static.py --check`. `npm run check:js` checks all seven JavaScript files when Node is available. Generated `play.html` belongs in the repository; `dist/` is regenerated for preview and hosting. Remote GitHub Actions and external Replit/MOLIT verification are recorded separately in `docs/VALIDATION.md`.
