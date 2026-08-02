# Core Legibility Reset Baseline

- Checkpoint date: 2026-08-01
- Last responsive live build: `0802002327`
- Last responsive live seed: `1071297005`
- Fixed comparison seed: `1881`
- Agent driver before reset: `gpt-5.4`
- Baseline screenshot: `docs/screenshots/core-reset-baseline-2026-08-01.png`
- Baseline test log: `docs/checkpoints/core-legibility-reset-baseline-test.log`
- Baseline tests: 33 passed, 2 intentionally skipped, 0 failed.
- Baseline production bundle: 4,028.14 kB JavaScript, 986.05 kB gzip.

The pre-reset server also reproduced an operational failure during checkpointing:
after listening on port 5173, both mock and LLM runs stopped servicing `/health`
while the process remained alive. This is baseline evidence, not a reset result.
