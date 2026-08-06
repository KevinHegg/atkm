# Agent Interface

## Match Objective

The live game is a ten-minute king-of-the-hill siege.

- Red wins when the ten-minute bell rings and Humpty still has positive integrity.
- Green wins immediately when Humpty reaches zero integrity or strikes the floor at 3.0 m/s or faster.
- A catch, damaged tower, or safe low landing does not end the match by itself.

Physics advances at 60 Hz in one server-authoritative Rapier 3D world. The
PlayCanvas client consumes snapshots and never owns gameplay bodies.

## Tactical Choice

Both three-person crews choose concurrently. The live director advertises four
bounded tactics:

| Team | Tactic | Machine | Purpose |
| --- | --- | --- | --- |
| Red | `red-stabilize-cradle` | Rescue Winch | Tension the cradle and resist a developing fall. |
| Red | `red-deploy-catch-sledge` | Catch Sledge | Put a padded receiving bed beneath the fall line. |
| Green | `green-drive-ram` | Battering Ram | Drive lower timbers or attack a deployed catch bed. |
| Green | `green-fire-stone` | Stone Thrower | Fire one persistent stone at the advertised target. |

Each option carries a utility score derived from visible tower stress, Humpty
risk, machine state, ammunition, and the previous choice. The deterministic
director selects the highest eligible score. With `AGENT_DRIVER=llm`, the
Responses API receives the same listed options and public observations. An
invented or ineligible ID, timeout, or service error falls back to utility
selection without pausing physics.

## Observable Chain

Every team snapshot exposes the same readable chain:

1. choosing a tactic;
2. crewing the named machine;
3. operating it through the public action system;
4. watching for physical impact;
5. assessing measured contact, travel, damage, catch, or failure;
6. recovering before the next choice.

The snapshot also exposes round, tempo, tower stress, Humpty risk, current and
last result, simple-machine ingredients, and the state, integrity, and
ammunition of all four battle machines.

## Physical Boundary

Agents choose a listed high-level tactic. The game owns collision-aware crew
travel, operation timing, impulses, projectiles, contact, damage, and recovery.
No agent receives transform-editing authority, engine handles, hidden forces,
spawn authority, or an unadvertised target. A machine operation is rejected if
the machine is moving, spent, disabled, opposed, or unreachable.

The Rescue Winch, Catch Sledge, Battering Ram, Stone Thrower, and five siege
stones are visible pre-authored stage fixtures. They are not repair-kit
inventory. Stones become colliding projectiles only at the visible release;
they never respawn. The sledge catches through collider contact and can be
damaged and overturned. The ram travels, contacts, and returns through Rapier.

## Seeded Doctrines

The public replay seeds use three deterministic gunnery doctrines. Seed 1881
opens on Humpty, seed 4198 mixes structural and royal targets, and seed 7331
commits to structural destruction and the rescue bed. The advertised target and
physical projectile agree in every case.

## Manual Construction Lab

`AGENT_DRIVER=off` retains the Gate 1-5 construction lab. Its frozen
24-piece-per-team inventory, nine families, four connection classes, public
legal actions, compound-plan grammar, and deterministic lever, ramp, ram,
hoist, and carry fixtures remain available. Starting the manual lab uses its
clear fixture staging layout; starting an autonomous match uses the authored
battle layout.
