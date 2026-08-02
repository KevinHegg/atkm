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

The current repository has not passed Gate 1's engine requirement: gameplay is
still authoritative Rapier 2D while PlayCanvas/Ammo presents snapshots. Do not
describe the full repair as complete until that architecture and the meter-unit
contract are resolved. Later work may preserve and test the repaired tower,
support, locomotion, lifecycle, kit, and fixtures without mislabeling Gate 1.

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

## Scope Freeze

The repair kit has nine visual families and four connection classes. Do not add
gears, racks, screws, crossbows, torsion bundles, cams, belts, chains, complex
rope networks, procedural machine generators, or named machine recipes.
