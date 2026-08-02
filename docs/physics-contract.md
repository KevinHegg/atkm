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

- Gameplay is authoritative in the server's Rapier 2D world. The PlayCanvas
  scene consumes snapshots and does not decide outcomes or construction poses.
- The PlayCanvas scene still initializes presentation rigid bodies through its
  Ammo integration. That means the requested PlayCanvas/Ammo-only single-world
  architecture has **not** been reached, even though duplicate gameplay
  authority has been removed from the repaired puzzle path.
- Legacy stage coordinates are still pixel-like world units. The code records
  `world.lengthUnit = 52`, but tower and kit dimensions are not consistently
  authored in meters. A unit migration remains required before claiming the
  meter contract.
- `illegalTransformWrites` is exposed in diagnostics but is not yet backed by a
  complete write-site interceptor. The audit and tests cover known gameplay
  paths; the counter alone is not proof that every future transform write is
  legal.
- `deepBodyPenetrations` counts contact separation beyond 1.9 stage units,
  approximately the requested 0.01 m tolerance under the tower scale. Smaller
  solver corrections remain observable through contact tests but are not
  reported as deep violations.
