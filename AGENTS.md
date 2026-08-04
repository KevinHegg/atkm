# All the King's Men Repair Rules

## Gate Order

Work in this order and do not call a later gate complete while an earlier gate
is failing:

1. one authoritative gameplay physics world;
2. 36-block, 12-layer Jenga tower and physical Humpty seat;
3. collision-aware worker and carried-load locomotion;
4. observable part lifecycle with no self-assembly;
5. nine-family, 24-piece mirrored kit and four connection classes;
6. rescue/attack fixtures, diagnostics, and browser acceptance.

Current reset status: Gate 1 is executable in `server/core` as one
server-authoritative Rapier 3D world, with PlayCanvas consuming snapshots only.
Gates 2 through 5 are also executable: a 36-block, 12-course tower, a
physical Humpty seat, collision-aware worker capsules, and two-worker carry
fixtures. The opening inventory now matches the frozen nine-family,
24-piece-per-team manifest, and connections are represented separately as
`TENON_LOCK`, `AXLE_BEARING`, `KEYED_COAXIAL`, and `ROPE_ATTACH`. Do not
describe the full repair as complete until Gate 6 browser acceptance is current;
older docs/archive files still describe previous Rapier 2D, Pixi, and Ammo
passes.

## Commands

- Development: `npm run dev`
- Type checking and lint contract: `npm run typecheck`, `npm run lint`
- Tests: `npm test`
- Production build: `npm run build`
- Full acceptance: `npm run check`

## Non-Negotiable Physics Rules

- Gameplay transforms come from the authoritative fixed-step physics state.
- Do not teleport or directly set the transform of a dynamic body during
  locomotion, carrying, alignment, connection, operation, or failure.
- Direct transforms are allowed only for initial construction, explicit match
  reset, bounded referee recovery, and presentation-only child animation.
- Do not parent a dynamic part to a worker or another dynamic body.
- Do not disable collisions to make carrying or construction succeed.
- Every visible obstruction needs an authoritative collision proxy.
- Every connection must follow the logged lifecycle and create a physical
  constraint only at the visible lock moment.
- Keep inventory persistent. No useful part may spawn, clone, vanish, or be
  replaced after the opening ledger is created.

## Contraption Extension Contract

The frozen opening inventory and four connection classes remain fixed, but the
strategy layer may now enumerate unexpected contraptions from them. Agents may
choose a recipe permutation exposed by `/contraptions` or the model request:
the recipe can reorder crew roles and simple-machine ingredients, and it must
expand to a public action packet against visible body IDs. The action system
and Rapier world remain the only authorities. An invented ID, private force,
teleport, new part, or unadvertised connection is rejected. A blocked recipe
is evidence for the next choice, not permission to reset the stage.

`/agent-context` is the repository MCP-style contract surface. It returns this
file, the public rule endpoints, source-of-truth files, and the invariants that
an external agent must follow. Keep `shared/agent-rules.ts`,
`server/core/compound-plans.ts`, and `server/core/contraption-grammar.ts`
synchronized when adding a new recipe family.

## Scope Freeze

The repair kit has nine visual families and four connection classes. Do not add
new physical families, connection classes, or post-start inventory without a
separate design decision. Recipe composition is allowed within the visible
kit; it cannot grant compatibility, spawn parts, create private actions, or
bypass the four frozen connection classes. A future family such as a screw or
cam needs its own inventory, ports, physics, and acceptance gate.
