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

Current reset status: Gates 1 through 6 are executable in `server/core` as
one server-authoritative Rapier 3D world, with PlayCanvas consuming snapshots
only. Gate 6 is browser-accepted as the current four-machine battle: Red operates the Rescue Winch
and Catch Sledge; Green operates the Battering Ram and Stone Thrower. The
ten-minute objective, tactical chains, physical impacts, packaged replays,
diagnostics, desktop/mobile layout, and replay controls belong to Gate 6. Older docs/archive files
still describe previous Rapier 2D, Pixi, Ammo, and recipe-led autonomous passes.

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

## Battle Contract

The live match has four advertised tactical chains and no private fallback
attack. Red may tension the rescue line or deploy the catch sledge. Green may
drive the ram or loose the stone thrower at its advertised target. Each choice
expands to a public `operate` packet against visible body IDs. Crew travel,
machine travel, projectiles, contact, damage, catches, and failure are resolved
in the authoritative Rapier world. The director may score only these listed
choices and an LLM must return one of the advertised IDs.

The Rescue Winch, Catch Sledge, Battering Ram, Stone Thrower, and five loaded
siege stones are non-inventory stage fixtures authorized by the Gate 6 redesign.
They are pre-authored bodies with visible collision proxies, finite state,
public operation, and no post-start spawning. Seeded siege doctrines may change
the stone thrower's advertised target, but never the projectile, force, or
collision authority. Green wins when Humpty cracks or strikes the floor hard.
Red wins only when the ten-minute bell rings with Humpty uncracked.

## Construction Lab Contract

The frozen opening inventory and four connection classes remain fixed. The
manual construction lab may enumerate unexpected contraptions from them. Agents may
choose a recipe permutation exposed by `/contraptions` or the model request:
the recipe can reorder crew roles and simple-machine ingredients, and it must
expand to a public action packet against visible body IDs. The action system
and Rapier world remain the only authorities. An invented ID, private force,
teleport, new part, or unadvertised connection is rejected. A blocked recipe
is evidence for the next choice, not permission to reset the stage.

`/agent-context` is the repository MCP-style contract surface. It returns this
file, the public rule endpoints, source-of-truth files, and the invariants that
an external agent must follow. Keep `shared/agent-rules.ts` and the construction
grammar synchronized when changing the lab. Keep `server/core/battle-director.ts`,
`server/core/physics.ts`, and `shared/core-protocol.ts` synchronized when changing
the live battle.

## Scope Freeze

The repair kit has nine visual families and four connection classes. Do not add
new physical families, connection classes, or post-start inventory without a
separate design decision. Recipe composition is allowed within the visible
kit; it cannot grant compatibility, spawn parts, create private actions, or
bypass the four frozen connection classes. A future inventory family such as a
screw or cam needs its own inventory, ports, physics, and acceptance gate. New
battle fixtures likewise require an explicit design decision, authored bodies,
public actions, diagnostics, and browser acceptance.
