# Physical Legibility Repair Audit

Date: 2026-08-01

## Baseline

- Repository: existing PlayCanvas project at
  `/Users/kevinhegg/Desktop/code-projects/humpty`.
- Baseline build: `0801222220`, seed `1064029965`.
- Baseline screenshot: `docs/screenshots/repair-baseline-2026-08-01.png`.
- Runtime: `npm run dev` starts Vite, WebSocket snapshots, the agent loop, and
  the fixed-step server simulation.
- Checks: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, and
  `npm run check`.

The normal camera shows an eight-layer pier whose alternating topology is not
readable, a solid cap instead of a seat, loose stock heaped at both sides, tiny
port confetti, and machine attempts that read as disconnected debris.

## Physics Authority

The repository contains two simulations. `server/simulation.ts` owns gameplay
with Rapier 2D; `client/world3d.ts` creates a PlayCanvas Ammo world containing
additional local worker and Humpty bodies. Server snapshots decide outcomes,
but client dynamics can visibly diverge. This is the primary authority defect.

The repair keeps server snapshots as the only outcome authority and removes
client-side dynamic decision making. A complete engine-brand migration from
Rapier to Ammo is separate from removing the duplicate authority and is listed
as an explicit remaining architecture defect until performed.

## Transform Write Classification

### Legitimate initialization

- `client/world3d.ts:541-618`: primitive/entity creation, initial pose, visual
  child hierarchy, and rigid-body component initialization.
- `client/world3d.ts:633-815`: camera, lights, stage seams, backdrop, and static
  decorative architecture.
- `client/world3d.ts:853-1015`: initial tower/Humpty visual construction and
  child-only face, crown, arm, boot, and gallery placement.
- `client/world3d.ts:1395-1411`: worker visual rig and held-tool attachment.
- `client/world3d.ts:1788-1818`: presentation-only puzzle mesh and port-marker
  creation.
- `client/world3d.ts:2182-2815`: child meshes that give wheels, sheaves, drums,
  hubs, planks, rope fittings, and connections readable silhouettes.
- `server/simulation.ts:620-1250`: opening rigid-body, collider, and constraint
  initialization. Initial reset placement is legitimate only before tick zero.

### Legitimate reset or bounded recovery

- `server/simulation.ts:9795,9974`: debug/referee-only fixture placement.
- `client/world3d.ts:3053`: fallen-worker recovery is permitted only when the
  worker is out of bounds; it must increment diagnostics.
- `client/world3d.ts:3886,3941`: legacy projectile launch initialization. These
  paths are disabled by the repair scope freeze.
- `client/world3d.ts:4054-4082`: post-outcome visual restoration.

### Physics violations to remove

- `server/simulation.ts:5154-5174`: `translateLivingMan` directly translates a
  living worker and every limb, bypassing collision response.
- `client/world3d.ts:3364`: stalled workers teleport through the obstacle that
  stopped them.
- `client/world3d.ts:3521-3529`: final installation teleports and directly
  rotates a dynamic part.
- `client/world3d.ts:4010-4016`: Humpty is repositioned each frame by render
  interpolation while also owning a local rigid body.
- `client/world3d.ts:4021-4031`: tower bodies are directly interpolated. This is
  acceptable only after they are made presentation-only with no local physics.
- `server/simulation.ts:5519,5731-5775`: rescue/righting paths directly set
  Humpty rotation or body type during gameplay.
- `server/simulation.ts:5260-5505,5661`: legacy carry/rescue paths switch bodies
  between dynamic and kinematic types.
- `server/simulation.ts:6661-6670`: legacy carried targets become kinematic.
- `server/simulation.ts:7017-7337`: named blueprint/project bodies and hidden
  rope/project constraints remain executable outside the repaired kit.

### Suspicious and requiring an acceptance test

- `client/world3d.ts:1492-1749`: snapshot-following puzzle bodies, locks, ropes,
  ghosts, and alignment guides. These must remain presentation-only and may not
  invent poses absent from the snapshot.
- `client/world3d.ts:1873-1898`: puzzle visual interpolation. It is legal only
  because these entities have no rigid body or collider.
- `client/world3d.ts:3249`: carry-start rotation write. Removed from repaired
  puzzle play; any carry orientation must come from finite torque.
- `client/world3d.ts:3732-3839`: mechanism and Queen child animation. These may
  animate visuals but not load-bearing bodies.
- Every `setLocalPosition` or `setLocalEulerAngles` used for a face, limb, tool,
  speech anchor, or decorative mesh is presentation-only and covered by the
  illegal-transform diagnostics contract.

## Collision Failures

- Worker membership masks exclude all workers, so agents can overlap.
- Tower collision masks exclude all workers, so agents can pass through blocks.
- Puzzle-stock masks collide almost exclusively with the floor.
- Server depth is planned separately from Rapier contact; carried-load depth
  clearance is estimated rather than shape-cast.
- Browser workers simulate a second route toward server goals and can disagree
  with the recorded worker pose.

## Construction Failures

- The puzzle task has phases, but the final pose can still be forced exactly.
- The older blueprint catalog creates named machines and commissioning stages.
- Browser legacy stock can be created from complete blueprint definitions.
- The broad grammar produces tiny fittings and visually similar parts that are
  difficult to count from the normal camera.

## Repair Acceptance

The gate is accepted only from tests plus a normal-camera browser screenshot.
Documentation is evidence of the audit, not evidence that a gate passed.

## Implemented Repair Status

- The central stack is now 36 independent dynamic blocks in 12 complete
  three-block layers, with alternating visual yaw and no block-to-block joints.
- A separate visible dynamic royal seat rests on the top layer. Humpty is one
  dynamic CCD-enabled body resting on that seat, and the support-removal test
  makes him fall under gravity.
- Repaired worker routing uses the server worker bodies plus stage-depth path
  planning, solid bounds, local avoidance, and a carried-part envelope. Tests
  cover the stage wall, tower route, worker meeting, grounding, and long-beam
  clearance. It is not an Ammo capsule-sweep implementation.
- Puzzle connections now run through the observable lifecycle `reserve ->
  approach/fetch -> grasp/lift -> carry -> stage -> align -> connect ->
  release/support -> test -> step clear`. The joint is created at lock,
  interrupted alignment leaves both parts visible and unconnected, and a task
  remains active until its workers have vacated the assembly envelope.
- The opening kit is fixed at 24 pieces per team, nine visual families, and
  four connection classes. Normal-play port markers appear only during
  alignment; engineering mode can reveal them deliberately.
- The rescue fixture uses direct fixture initialization to arrange an A-frame
  and mount one inventory sheave on the usable backdrop. Once started, Humpty
  remains dynamic and motion comes from a changing physical rope limit plus
  bounded forces. The attack fixture is a hub-and-axle two-wheel beam ram whose
  target block moves through contact only.
- Diagnostics report fixed tick, body and constraint counts, worker and deep
  penetration counts, late inventory, Humpty support, tower contacts, and the
  latest lifecycle state. A nonzero worker count also identifies the colliding
  pair. Known sub-0.01 m solver contact corrections are below the
  deep-penetration threshold.

## Browser Acceptance Evidence

- Normal-camera after image:
  `docs/screenshots/repair-after-2026-08-01.png`.
- Fixed-seed diagnostics image:
  `docs/screenshots/repair-smoke-diagnostics-2026-08-01.png`.
- Seed `1881` ran in the browser from 00:21 through 01:38. At fixed tick 5908
  the panel reported 92 dynamic bodies, one active connection, zero worker
  penetrations, zero deep penetrations, zero transform writes, zero late
  inventory objects, two Humpty support contacts, and 39 tower contacts.
- The fresh single-server browser console contained no warnings or errors.
- The test-only rescue startup captured
  `repair-rescue-start-2026-08-01.png`,
  `repair-rescue-lift-2026-08-01.png`,
  `repair-rescue-hold-2026-08-01.png`, and
  `repair-rescue-lower-2026-08-01.png`. Humpty rose from 501 to 514 stage units,
  held, then returned through 505 while remaining dynamic.
- `npm run check` completed with 33 passing tests, two intentionally skipped
  legacy suites, and no failures. `npm run lint` also passed. The production
  build retains Vite's warning for its 4.03 MB JavaScript bundle.

## Remaining Architecture Defects

- Gate A is not complete. Rapier 2D remains the gameplay world and PlayCanvas
  still initializes Ammo-backed presentation bodies. This is not the requested
  PlayCanvas/Ammo-only single world.
- Stage coordinates are not consistently meters. The Jenga and kit dimensions
  are legacy stage units with different historical scale assumptions.
- Depth remains a planned 2.5D coordinate outside Rapier's 2D contacts. The
  route planner prevents visible crossings in tested cases, but this is not a
  true 3D collision world or a capsule shape cast.
- `illegalTransformWrites` is currently a surfaced counter without a complete
  transform-write interceptor. Debug fixture arrangement, match reset, and
  referee recovery still use direct placement intentionally.
- Legacy named-blueprint, kinematic rescue, projectile debug, and righting code
  remains in the repository. Puzzle-mode agent actions reject or bypass those
  paths, but they have not all been deleted.
- The rescue fixture's backdrop sheave is made fixed only by deterministic
  fixture setup. It proves the motion reference but is not yet an agent-built
  wall attachment assembled through the normal lifecycle.
