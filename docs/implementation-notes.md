# Implementation Notes

Date: 2026-08-01

## Completed Mechanical Slice

- The central pier is 24 individually dynamic oak blocks in eight alternating
  courses plus a separate dynamic top support. The visible pier is generated
  from authoritative snapshot bodies; the old decorative duplicate is gone.
- Humpty is a heavy dynamic rounded body. Opening settlement is completed before
  curtain-up, then tower and shell bodies sleep until an explicit probe, impact,
  or rescue wakes them.
- Every team owns exactly 27 persistent pieces: 4 short spars, 4 long spars, 4
  bearing nodes, 2 deck panels, 2 axles, 2 wheel/drums, 2 sheave blocks, 2 ropes,
  2 wedges, 1 threaded spindle, 1 nut/slider, and 1 sling.
- Inventory occupies two mirrored x lanes at the stage edges and reachable depth
  rows from backdrop to apron. No complete machine or loose projectile is added
  to puzzle play.
- Workers fetch, lift, carry, stage, align, connect, recover, sabotage, and repair
  through visible task phases. Parts remain dynamic and are moved with bounded
  spring, damping, torque, gravity compensation, load-speed braking, and swept
  load footprints. Long spars and broad decks reserve a helper.
- Snap completion creates Rapier fixed, revolute, rope, prismatic-thread, or
  contact constraints. Misaligned, blocked, occupied, overlapping, unsupported,
  or fast-moving joins are rejected. Flexible rope reach is measured from the
  persistent rope body rather than treating the six-metre line as a rigid bar.
- The Queen's commissioned shot launches an existing wheel/drum or wedge. The
  projectile remains in the ledger and must be recovered; no stone is spawned.
- Failed joints remove their physical constraint and preserve damaged state.
  Repair requires physical realignment before a new joint is created. Recovery
  now has carry, release, and gravity-settle phases.
- Assembly observations include live center of mass, support span, signed tipping
  margin, binding risk, buckling risk, joint utilization, rope state, and neutral
  derived capabilities. The legal join frontier is capped at 12 diverse options;
  an opening team state is about 14 KB.
- GPT-5.4 receives first choice of work whenever a crew member is idle. Requests
  are suppressed while every worker is already occupied, and named completion
  targets used by the local continuity policy are stripped from model input.
  Invalid, late, or unavailable responses fall back to physical local initiative
  without pausing the world.
- Six simple-machine recognizers derive evidence from typed parts and connected
  geometry. No `machineType`, blueprint ID, recipe, or graph hash is sent to an
  agent.
- A bounded tower probe reports input impulse, estimated reaction force, selected
  block displacement, neighboring motion, angular motion, and signed support
  margin, and aborts if the tower approaches its safety thresholds.

## Verification

`npm run check` covers strict TypeScript, grammar and schema contracts, mirrored
inventory, dynamic pier count, connection legality, six simple machines,
finite-force logistics, worker routing, sabotage/repair/recovery, replay
checksums, ten-minute draw, Humpty fracture, upright landing, performance, and a
production Vite build. Human-only acceptance fixtures are documented in
`docs/worked-assemblies.md` and are not available to agents.

## Known Limits

- Rapier 2D remains the gameplay authority while PlayCanvas/Ammo is a corrected
  presentation layer. Depth participates in layout, routing, swept clearance,
  and observations, but not full 3D rigid-body contact. A server-side Ammo
  migration was deliberately not attempted in this pass.
- Rope has persistent endpoints, physical rope joints, free-length reach, load,
  slack/tension state, and rendered path cues, but not yet a multi-segment
  sheave-wrap solver with conserved arc length and derailment.
- Support polygon, buckling, and binding values are conservative live estimates,
  not a finite-element structural solver.
- The dormant recipe-era server code still exists for old replay compatibility,
  but puzzle mode rejects its actions and creates none of its useful objects.
- Policy matchups are explicitly marked unrun in `data/benchmark-results.json`;
  model-backed comparative balance needs a separate credit-bearing evaluation.
- The final live API verification returned `429` because the configured account
  had no remaining credits. The game remains playable through local initiative;
  GPT-5.4 resumes automatically after credit is available and the server restarts.

## Next Highest-Value Work

1. Replace the remaining presentation Ammo bodies with transform-only entities,
   or migrate the authority to one headless 3D Bullet world.
2. Add a routed rope solver with sheave wrap, slack propagation, overload,
   derailment, and persistent fraying geometry.
3. Add an automated multi-policy match runner and tune from completion rate,
   capability diversity, time-to-first-machine, and outcome balance.
