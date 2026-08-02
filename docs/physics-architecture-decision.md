# Physics Architecture Decision

## Decision

Rapier 2D on the server remains the sole gameplay authority for this mechanical
slice. It owns body poses, collisions, carried-load sweeps, dynamic tower blocks,
Humpty contacts, typed joints, connection loads and failures, victory, replay,
and checksums. PlayCanvas preserves the existing 2.5D theatre and follows server
transforms; browser Ammo cannot award damage, create an object, legalize a joint,
or decide a match.

This intentionally defers an engine migration. The brief explicitly says not to
start with one, and moving all server decisions, replay, tests, and LLM state into
browser Ammo would have traded visible progress for a second incomplete ruleset.

## Deterministic Step

- Fixed simulation step: 1/60 second with bounded real-time catch-up.
- Match limit: 600 seconds.
- Loose tower courses settle before curtain-up and then sleep.
- Inventory and assemblies are always dynamic; carrying applies finite force and
  torque with swept 2.5D clearance.
- Replay checksums quantize transforms to one stage unit and rotation to 0.01
  radians, avoiding meaningless sub-pixel solver drift while detecting material
  divergence in the same runtime.

## Outcome Boundary

Authoritative: body state, contacts, path blocking, joint state and load,
inventory lifecycle, damage, fracture, upright landing, winner, and replay.

Neutral planning estimates: center of mass, support span, signed margin,
clearance, binding, buckling, joint utilization, rope state, and derived
capability evidence.

Presentation only: gestures, connector highlights, dust, facial motion, local
material flex, and camera interpolation.

## Architectural Limit

This is a measured 2.5D authority, not a complete 3D Bullet world. The depth axis
is authoritative for floor layout, navigation, load footprint, port depth, and
agent observations; Rapier resolves rigid contact in the stage plane. The client
no longer presents a duplicate static pier or a separately decisive Humpty body,
but decorative local dynamics remain. The next architecture pass must choose one
3D authority rather than expanding both physics worlds.
