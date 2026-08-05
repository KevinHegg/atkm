# Implementation Notes

Date: 2026-08-03

## Current Core Legibility Reset

- The running app now starts from `server/core` rather than the archived
  scripted match code. `npm run dev` serves one local HTTP/WebSocket process
  with Vite middleware and a PlayCanvas client.
- Rapier 3D is the only gameplay physics authority. The server creates and steps
  the world at 60 Hz, and the client renders snapshot bodies without Ammo,
  browser rigid bodies, or browser collision components. Rapier's shared WASM
  runtime initializes once even when the server resets or tests create another
  world.
- The central stack is a 36-block Jenga tower: twelve alternating courses, three
  dynamic oak timbers per course, no block-to-block joints, and a computed
  tower-height placement for the royal seat and Humpty.
- The royal seat and Humpty are dynamic bodies supported by contact. Removing a
  top support changes the seat response through physics rather than through a
  scripted pose.
- Six workers are kinematic Rapier capsule bodies with character-controller
  sweeps. Direct blocked sweeps stop instead of sliding a worker through or
  around the tower, while the two-worker carry fixture still routes a long beam
  around the center at safe depth.
- The opening kit now matches the frozen 24-piece-per-team manifest: three beam
  lengths, four hubs, two axle lengths, wheels, sheaves, one winding drum,
  planks, hooked ropes, and wedge feet. The nine visual families are mirrored,
  persistent, placed on edge racks, and checked for no late spawning.
- Connections now carry one of four explicit classes. Tenon and keyed coaxial
  joins are fixed, axle bearings are revolute, and rope attachments use a
  finite-length rope joint with observable slack. Requests and family pairs are
  validated before the joint is created, and snapshots count each class.
- Diagnostics expose the physics adapter, one-world count, fixed-step rate,
  units, dynamic body count, joint count, tower and inventory counts, illegal
  transform writes, penetration counts, Humpty support contacts, tower contacts,
  and render divergence.
- The deterministic lever and ramp now route workers and frozen-kit parts from
  their real opening rack poses. The ram keys two wheels to one long axle, pins
  that axle through a broad-plank chassis bearing, tenon-locks a long beam to
  the chassis, rolls on both wheels, and drives a fourth-course tower timber
  through measured contact.
- The deterministic hoist braces a long axle, keys a deep-groove sheave to it,
  attaches both ends of one hooked rope, and raises a broad-plank proof load.
  Tension shortens the live rope joints; the fixture passes only after measured
  upward travel, positive line tension, low slack, and explicit joint tests.
- The default development server now starts a seeded autonomous match after one
  second. `shared/agent-rules.ts` enumerates 31 strategic rules with stable IDs,
  team and objective eligibility, phase, weight, observable preconditions,
  public action packets, connection class where relevant, and structured
  simple-machine ingredients and capabilities for compound rules. Six independent
  worker lanes choose and execute their opening concurrently over the same physics world. The
  opening uses separated rack aisles and work bays so each figure can act on the
  same tick without interpenetration. Subsequent choices use the seed and repeat
  penalties. After the opening, one Red team lane and one Green team lane run
  concurrently. Red evaluates an escalade and rescue hoist; Green evaluates a
  wheel bombard, wheeled ram, pivoted striker, and counterweight sling. Weighted
  seeded selection is repeatable but varies across
  seeds. Success records the relevant contacts, joint classes, climb or load
  travel, line state, wheel rotation, projectile motion, and tower-timber
  displacement. Per-figure rules, complete choice sets, selected plan IDs, and
  machine evidence appear in snapshots; manual control cancels every
  autonomous lane first.
- `AGENT_DRIVER=llm` now runs a bounded asynchronous Responses API strategist.
  It receives only objectives, triggers, observed facts, and currently eligible
  IDs. Structured responses are validated against the advertised choices;
  timeout, service failure, or an invented ID falls back to the seeded director
  while Rapier continues stepping. Failed machine work records its evidence,
  keeps the changed world, excludes the attempted class, and makes one recovery
  choice.
- The client restores user-enabled Web Audio cues and local recorded lines for
  Humpty and the Mad Queen, with browser speech as the fallback for unexpected
  text. Royal speech events animate Humpty's mouth or the Queen's
  head, crown, and scepter. Worksite events produce throttled step, fastening,
  rope, launch, impact, and crack cues without adding media assets.
- Autonomous connections use IDs derived from class and body IDs, so concurrent
  Red and Green assembly cannot collide in the joint ledger. Public `wait`
  actions may include a destination and route a figure there physically before
  waiting, which lets plans muster crews without private movement authority.
- The right performance ledger can collapse from its always-reachable stage
  control. The preference persists across reloads, the camera refits after the
  width transition, and mobile keeps the full stage without the redundant dock.
- Red's objective is an intact, low-speed, one-second stand on the stage floor.
  Green's objective is zero integrity before that stand; a floor impact at or
  above 3.0 m/s produces the current terminal crack. Simply reaching floor
  height no longer awards Green the match.

## Verification

`npm run typecheck` passes strict TypeScript. `npm test` runs the reset
tests covering the single authority, render-path absence of gameplay physics,
fixed-step determinism, transform-write tripwire, 36-block tower geometry,
Humpty/seat/tower contact, worker collision, two-worker carrying, idle
stability, mirrored inventory, four connection classes and joint kinds, and the
public reset action vocabulary. The fixture regression also runs the lever,
ramp, ram, and hoist from fresh fixed-seed worlds and checks the machines'
exact joint-class inventories, tested rope path, line tension, and slack.
The autonomous-match regressions verify six choices on one tick, concurrent
Red and Green machine operation, clean manual takeover, six observed-fact plan
builders, recovery, seeded selection variation across all six classes, model
ID validation, and a scripted model driver through the public boundary. The fixed-seed round remains free
of late inventory and illegal transform writes. Separate contract tests cover rule
uniqueness, legal-action-only packets, all four frozen connection classes, all
five simple-machine ingredients, all six machine capabilities, climb target
validation, and both objective outcomes.

## Gate 6 Browser Acceptance

Date: 2026-08-05

- Browser build `0805011641` started at
  `http://127.0.0.1:5173/?mode=legibility-lab&seed=1881` with the configured
  LLM driver. The snapshot recorded `llm` and `autonomous` gate evidence after
  six model-led moves.
- The watch ledger now scrolls correctly at 1280 x 720, the command desk opens
  with fixture controls reachable, and closed command-desk contents do not
  overlap or intercept transcript clicks.
- Browser controls ran the fixture sequence: Carry, Lever, Ramp, Ram, and
  Hoist. The visible gate panel reported `9/9 cleared - all staged`.
- The final browser diagnostics reported Rapier 3D, one physics world, 36 tower
  bodies, 24 King parts, 24 Queen parts, zero illegal pose writes, zero late
  inventory, zero worker penetrations, zero carried-part penetrations, zero
  deep penetrations, zero client Ammo bodies, and zero render lag.
- Screenshot evidence:
  `docs/screenshots/gate6-browser-acceptance-2026-08-05.png`.
- The browser console contained only PlayCanvas deprecation warnings for
  `createTorus` and `createMesh`; no application errors were observed.

## Known Limits

- The pivoted striker and counterweight sling are selectable and physically
  staged, but collision-blocked routes can still leave either incomplete. The
  recovery ledger deliberately reports that result and selects a different
  class instead of awarding synthetic success.
- Rope behavior uses a deterministic two-span proxy rather than a full flexible
  cable solver. Attached rope coils become non-solid physics sensors while the
  finite-length joints carry load, and the client renders each live span.
- Several historical docs and archived files intentionally remain for audit
  context and may describe the old Rapier 2D, Pixi, browser Ammo, or recipe-era
  implementation.
- The refreshed normal camera has current Gate 6 evidence, but the ram fixture
  can still produce brief contact-correction diagnostics while passing through
  legal measured contact. The final post-hoist acceptance state is clean.

## Next Highest-Value Work

1. Tune the Green staging lanes so the striker and sling complete more often
   without relaxing collision or evidence requirements.
2. Replace the deterministic two-span rope proxy only if full cable wrapping is
   needed for autonomous match tactics.
