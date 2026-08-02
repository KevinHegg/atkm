# Machine Grammar

## Opening Set

Each team receives the same 24 persistent visible objects:

| Part definition | Quantity |
|---|---:|
| Long spar | 2 |
| Medium spar | 2 |
| Short spar | 2 |
| Deck panel | 1 |
| Bearing block | 2 |
| Axle | 2 |
| Wheel | 2 |
| Winding drum | 1 |
| Sheave block | 2 |
| Hemp rope | 2 |
| Screw spindle | 1 |
| Screw nut | 1 |
| Wedge | 2 |
| Hook | 1 |
| Sling | 1 |

There are no machine-family IDs, recipes, craft cards, or post-start part spawns. Instance IDs are definition plus ordinal, such as `spar_long_01`. Captive pins do not count as separate objects.

## Port Families

The 16 visual port kinds reduce to ten mating rules:

| Pair | Joint | Remaining motion | Primary load |
|---|---|---|---|
| `rigid_peg` + `rigid_socket` | fixed | none | tension, compression, shear, torque |
| `pin_eye` + `hinge_cheek` | revolute | one rotation axis | tension, compression, shear |
| `axle_shaft` + `bearing_bore` | revolute | shaft rotation | shear and torque |
| `hook` + `load_eye` | revolute | swing | tension |
| `rope_end` + `load_eye` | rope | swing and twist | tension |
| `rope_end` + `hook` | rope | swing and twist | tension |
| `rope_end` + `cleat` | rope | twist | tension |
| `rope_end` + `sheave_groove` | rope | line travel | tension |
| `thread_male` + `thread_female` | thread | helical travel | torque and axial load |
| `wedge_face` + `wedge_gap` | contact | tapered slide | compression and shear |

`ground_foot` is a contact affordance, not a snap mate. The complete machine-readable limits live in `data/compatibility-matrix.json`; `docs/compatibility-table.csv` is the human-readable export.

## Recognition

`server/puzzle.ts` resolves only actual internal edges and their selected ports. It derives:

- lever from a rigid member, supported revolute pivot, and separated input/output locations;
- wheel and axle from a wheel bore and support bearing on a shared two-ended shaft;
- pulley from a rope path through a rotating groove, with confidence improved by a reaction anchor;
- inclined plane from a continuous deck surface with rigid support and length/rise estimate;
- wedge from a tapered face in a compatible reaction gap;
- screw from connected male/female threads and an input-handle interface.

Derived capabilities include confidence, input, output, ratio, direction, clearance, stability, and failure margin. Intrinsic labels never create a compound machine by themselves. Invalid near-misses are tested without relying on names or graph hashes.

## Lifecycle

The observable ledger supports:

`stored -> reserved -> being_fetched -> carried -> staged -> supported -> aligning -> connected -> tested -> operating -> detached/damaged -> recoverable -> stored_or_reused`

Interrupted work leaves parts at their last collision-valid pose. Failed connection records persist with integrity, load, and failure state so they can be diagnosed and repaired.
