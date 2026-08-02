# Test and Balance Plan

## Automated Coverage

`npm test` currently covers:

- machine-grammar validation, exact 24-part expansion, mirrored 48-part opening, and edge placement;
- every declared connection pair plus unrelated-port rejection and deterministic port poses;
- all six simple-machine recognizers and invalid near-misses;
- collision-aware stock motion, tower avoidance, staged work, match beats, and ten-minute draw;
- sabotage, persistent failed connection, repair, detach, and visible recovery lifecycle;
- same-runtime deterministic state checksums;
- full live inventory fixed-step performance;
- tower resistance, man impact, Humpty projectile/fall thresholds, upright landing, replay archive, speech, and audio cue activity.

## Balance Metrics

Capture per seed and model:

- first useful connection, first simple machine, first tested assembly, and first hostile contact time;
- worker idle percentage and blocked-path time;
- parts touched, recovered, stolen, damaged, and reused;
- useful capability gain per connection and invalid-action rate;
- connection warning/yield/failure counts and repair rate;
- distinct topology count, normalized by joint semantics and capability graph;
- Humpty descent start, impact speed, landing angle, integrity, winner, and end time;
- model requests, response latency, input/output token count, fallback action rate;
- simulation p50/p95 tick time and replay checksum divergence.

## Required Scenario Set

1. Scripted lowering assembly reaches a controlled upright landing.
2. Scripted lever launcher produces a strong physical projectile.
3. A loaded rescue joint rejects ordinary detach, then yields to legal sabotage.
4. A failed joint is repaired and proof-tested.
5. A blocked carrier reroutes or leaves the part at a valid pose.
6. Two distinct geometries pass each simple-machine validator; three near-misses fail each.
7. Random legal snapping and topology-aware heuristic baselines run on the same seeds.
8. Recorded action streams reproduce periodic checksums in the supported runtime.

## Current Performance Result

The automated full-inventory fixture simulated five seconds with six workers, 48 puzzle parts, stones, the tower, and four assemblies in about 39 ms on the development machine. This is a regression guard, not a browser GPU benchmark. The acceptance threshold is under 1,000 ms for that fixture and under 16.67 ms p95 per live fixed step in browser profiling.
