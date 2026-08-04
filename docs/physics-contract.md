# Repair Physics Contract

- Fixed step: 1/60 second with bounded catch-up.
- One gameplay authority writes body poses, contacts, constraints, damage,
  support state, inventory lifecycle, replay, and outcomes.
- Client interpolation is presentation-only and owns no gameplay body.
- Dynamic: 36 Jenga blocks, royal seat, Humpty, loose parts, detached parts, and
  any retained projectile.
- Controller-driven: one collision proxy per worker and a finite-force carry
  target coupled to a dynamic load.
- Static: floor, wall, boundaries, racks, plinth, and obstructing trim.
- No gameplay teleport, parenting, collision suppression, or transform snap.
- Initial settling must arise from gravity/contact. Sleeping is solver-owned.
- Diagnostics count worker penetration, deep penetration, illegal transform
  writes, post-start inventory creation, Humpty support contacts, and tower
  contacts. Worker penetration diagnostics name the colliding pair.

## Current Compliance Status

- Gameplay is authoritative in the server's Rapier 3D world. The PlayCanvas
  scene consumes snapshots and does not decide outcomes, construction poses, or
  body contacts.
- The live client path creates transform-only PlayCanvas entities. The reset
  tests scan the client for browser Ammo, rigid-body components, and collision
  components.
- The core reset exports an `m-kg-s-N-Nm` diagnostics contract, and the tower,
  seat, Humpty, workers, and frozen 24-piece-per-team kit are authored in
  metre-scale values.
- `illegalTransformWrites` is backed by the reset world's pose-write path and a
  test tripwire. Initial construction and explicit reset remain the allowed
  direct-write boundaries.
- `deepBodyPenetrations` reports solver contacts deeper than 0.02 m. Smaller
  support contacts remain observable through direct contact tests.
- `TENON_LOCK` and `KEYED_COAXIAL` create fixed joints, `AXLE_BEARING`
  creates a revolute joint, and `ROPE_ATTACH` creates a finite-length rope
  joint. Family compatibility is checked before a physical joint is created.
- Current automated coverage includes the single authority, 60 Hz stepping,
  deterministic replay, 36-block tower geometry, Humpty/seat/tower contact,
  worker collision sweeps, two-worker carrying, idle stability, persistent
  mirrored inventory matched against the opening manifest, all four connection
  classes, and illegal-write diagnostics.
