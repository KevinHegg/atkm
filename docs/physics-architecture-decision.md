# Physics Architecture Decision

Date: 2026-08-02

## Decision

The core legibility reset uses one server-authoritative Rapier 3D world. Rapier
owns body poses, collisions, worker character sweeps, carried-load clearance,
dynamic tower blocks, Humpty contacts, constraints, diagnostics, and replayable
fixed-step state. PlayCanvas is a renderer: it creates meshes from snapshots,
interpolates toward server transforms, and owns no gameplay rigid bodies.

This supersedes the earlier split where server Rapier 2D decided gameplay while
browser Ammo presented a separate physical-looking scene.

## Deterministic Step

- Fixed simulation step: 1/60 second with bounded real-time catch-up.
- Units: metres, kilograms, seconds, newtons, and newton-metres.
- Snapshots broadcast at 20 Hz; renderer interpolation is presentation-only.
- Tower, seat, Humpty, parts, and detached assemblies are dynamic server bodies.
- Worker bodies are kinematic capsules moved through Rapier character-controller
  sweeps. Blocked direct sweeps do not route around the tower by sliding.

## Outcome Boundary

Authoritative: body state, contacts, path blocking, joint state and load,
inventory lifecycle, damage, fracture, upright landing, winner, diagnostics, and
replay inputs.

Presentation only: camera interpolation, gestures, facial motion, material
styling, speech layout, dust, and other local visual cues.

## Current Limit

The reset is not the whole game yet. The opening kit now matches the frozen
nine-family, 24-piece-per-team manifest, and its four connection classes now
remain distinct through requests, validation, joints, snapshots, and
diagnostics. The hoist exercises a deterministic two-span rope proxy and the
ram exercises the frozen attack topology, while model-backed autonomous match
flow remains outside this core gate. Historical
docs and archived files may still describe the older Rapier 2D, Pixi, or
browser Ammo implementation.
