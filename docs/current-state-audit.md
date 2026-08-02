# Current State Audit

Date: 2026-08-01

## Scope And Baseline

This audit was completed before the mechanical-authority implementation pass.
The repository is the existing PlayCanvas game; no replacement scene or project
was created.

- Runtime: Node 20+, npm, strict TypeScript ES2022 modules.
- Development: `npm run dev` starts the HTTP/WebSocket server and Vite middleware.
- Verification: `npm run check` passes type checking, 25 tests, and the Vite
  production build. The built client is about 4.02 MB before gzip and emits the
  existing large-chunk warning.
- PlayCanvas: 2.21.3.
- Browser Ammo/Bullet bridge: `sync-ammo` 0.1.2.
- Server physics: `@dimforge/rapier2d-compat` 0.18.2.
- Baseline screenshot: `docs/screenshots/baseline-2026-08-01.png` at 1280 x 720.
- Baseline reproduction: an LLM match ended with Humpty cracked at 00:50. The
  report obscured the stage, several moving objects were visibly airborne, and
  the static-looking central pier did not communicate the server's dynamic
  block state.

## Existing Scene And Entity Conventions

`client/world3d.ts` creates the toy-fortress scene directly in code. Materials
are cached by name; most visible objects are primitive meshes grouped under a
root entity. Permanent stage architecture, workers, Humpty, stock, weapons,
projectiles, decorative machinery, and the pier are all created in the same
PlayCanvas application. The camera is orthographic and the stage is framed as a
2.5D theatre.

`client/main.ts` receives WebSocket snapshots, updates the ledger and speech,
and forwards each snapshot to `PhysicalWorld`. Replay is snapshot playback.
Workers and puzzle pieces have server targets but also own Ammo rigid bodies.

## Agent Loop

`server/index.ts` calls `GameSimulation.tick()` every 8 ms and broadcasts a
snapshot every 50 ms. `server/simulation.ts` integrates at a bounded 1/60 fixed
step, batches team decisions, validates JSON actions, and records NDJSON plus
compressed replay frames. `server/agents.ts` exposes compact stage-space facts,
stock, assemblies, joins, uses, failures, and nearby opponents. The current
interface still exposes result capabilities and legacy blueprint-era action
types that can bias strategy.

## Animation And Navigation

Workers route in stage x/depth space around a rectangular tower footprint and
other puzzle pieces. Puzzle construction is one compound `snap` task:
fetch/stage the target, fetch/carry the moving part, ease the moving assembly to
an exact computed port transform, then append a graph connection. Carrying is a
kinematic translation of the whole assembly near one worker. Handling worker
counts are not enforced. The browser adds its own spring forces and gestures,
so the visible path can diverge from the recorded path.

## Authoritative Physics Audit

There are currently two physics worlds:

1. Server Rapier owns gameplay x/y poses, contacts, tower blocks, Humpty damage,
   outcomes, observations, replay, and checksums.
2. Browser Ammo owns visible 3D workers, Humpty, parts, projectiles, and a
   completely separate static pier.

The server is authoritative for rules, but the viewer sees the browser world.
This split is the root cause of floating parts, visual penetration, static pier
artifacts, and outcomes that do not match visible impacts. The immediate rule is
that no client-side body may create gameplay state: client entities must follow
authoritative transforms. The intended end architecture is one headless
Ammo/Bullet authority shared through snapshots with PlayCanvas as renderer;
until that migration is complete, Rapier remains the only outcome authority and
browser Ammo must be presentation-only.

## Mechanical Failures Reproduced

- The central pier is 14 two-wide stone bodies plus two cap beams on the server,
  but seven courses of static decorative blocks plus static caps in the client.
- Humpty is dynamic on the server but initially fixed to the wall by a hidden
  browser joint.
- Puzzle stock starts as kinematic Rapier bodies. Unsupported stock is manually
  grounded by a correction loop.
- A single `snap` action performs reservation, fetching, carrying, staging,
  alignment, connection, and exact final placement.
- Connections are graph records; most do not create the typed physical joint
  described by the grammar.
- Capability analyzers use topology more than before, but do not yet require a
  complete supported input-to-output load path and operating clearance.
- The declared opening inventory contains 24 objects per team and includes
  medium spars, separate wheels, a drum, bearing blocks, and a loose hook. It
  does not match the required 27-object mirrored board.
- Extra useful projectile stones, pikes, crossbows, bolts, and decorative broken
  artillery exist outside the grammar inventory.
- Legacy named blueprints, prefabs, supply counters, and one-click project
  actions remain executable in the mock path.
- Sabotage changes integrity numerically and can move a target by setting a
  kinematic transform. Failure states are not persistent geometry changes.
- Rope connections are single endpoint joints without a conserved routed path,
  wrap state, scalar tension ledger, derailment, or spline driven by path nodes.

## Tests And Deployment

The current 25 tests cover seed repeatability, grammar validation, port poses,
one valid example of each simple machine, mirrored stock, collision-aware
routing, sabotage/repair state, replay checksums, ten-minute draw, impact and
landing rules, and long mock play. Missing coverage includes 24-block Jenga
settling/probing, all required near misses, worker-count enforcement, swept
two-worker carrying, typed joint tolerances and rejection, rope conservation,
CCD tunneling, floating-body prevention, and policy benchmark comparison.

There is no production deployment configuration in the repository. `npm run
build` produces `dist/`; the playable development target is
`http://127.0.0.1:5173/`.

## Implementation Order For This Pass

1. Replace the pier with 24 persistent dynamic blocks and a dynamic top support.
2. Replace the opening grammar with the exact 27 persistent mirrored objects.
3. Remove extra puzzle-mode weapons/projectiles and make loose stock dynamic.
4. Expose tower support/probe measurements and persistent inventory state.
5. Synchronize visible tower blocks from authoritative snapshots.
6. Split connection work into visible logistics/alignment/connection phases and
   enforce typed tolerances, support, duration, and handling count.
7. Expand simple-machine, sabotage/repair, replay, and performance tests.

The later high-risk work is a complete server-side Ammo/Bullet migration and a
hybrid routed-rope solver. Those cannot be represented honestly as complete
while Rapier imports or browser-owned gameplay rigid bodies remain.

## Post-Implementation Addendum

The audit findings drove the completed 2026-08-01 slice. The opening board now
has 24 authoritative dynamic tower blocks, a dynamic top support and Humpty,
exact mirrored 27-piece kits, dynamic finite-force logistics, typed Rapier
joints, live structure estimates, bounded tower probing, persistent projectile
reuse, physical sabotage/repair/recovery, compact team observations, and a
snapshot-driven visible pier. The remaining authority and rope limits are
recorded in `docs/physics-architecture-decision.md` and
`docs/implementation-notes.md`.
