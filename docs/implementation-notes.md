# Implementation Notes

Date: 2026-08-05

## Authoritative Core

- `server/core` owns one fixed-step Rapier 3D world at 60 Hz. PlayCanvas renders
  snapshots and has no gameplay rigid bodies or collision components.
- The center remains a 36-block, 12-course Jenga tower with a dynamic cradle and
  physical Humpty body.
- Six workers are collision-aware kinematic capsules. Autonomous battle mode
  uses a clear front muster; manual construction mode preserves the proven
  Gate 1-5 fixture layout.
- The mirrored opening repair inventory remains 24 persistent pieces per team,
  nine families, and four connection classes: `TENON_LOCK`, `AXLE_BEARING`,
  `KEYED_COAXIAL`, and `ROPE_ATTACH`.
- Diagnostics continue to expose world count, fixed rate, tower and inventory
  counts, joint classes, illegal transform writes, late inventory, penetration,
  support contacts, and render divergence.

## Gate 6 Battle Redesign

The former recipe-led autonomous match was replaced by a readable four-machine
battle. Red owns a fixed Rescue Winch and dynamic Catch Sledge. Green owns a
dynamic Battering Ram, fixed Stone Thrower, and five persistent loaded stones.
These are authored stage fixtures rather than post-start inventory.

`server/core/battle-director.ts` runs two concurrent utility-scored tactical
chains. Every choice records plan, crew movement, public `operate`, impact,
assessment, and recovery. The same advertised options are available to the
bounded OpenAI strategist, and invalid model output falls back to deterministic
utility choice.

All decisive effects remain physical:

- the ram drives into low tower courses or the catch sledge and then returns;
- stones follow ballistic trajectories and resolve actual contacts;
- the winch applies bounded stabilizing impulses while its line is tensioned;
- the catch is recorded only from Humpty-sledge contact;
- a disabled sledge overturns from the final ram impulse;
- hard floor contact or zero integrity awards Green;
- the ten-minute bell awards Red only while Humpty is uncracked.

The Watch sidebar now leads with replay controls, the siege clock, integrity,
tower stress, Humpty risk, each team's current chain stage and last result, and
a four-machine condition roster. Collapsed Watch keeps playback controls and
the current Red/Green status line.

## Packaged Simulations

- `The Sledgebreaker` (seed 7331): Red catches Humpty, Green destroys the catch
  bed, and the match ends from a hard fall around 52 seconds.
- `The Ten-Minute Hold` (seed 4198): mixed structural and direct shots leave
  Humpty damaged, but repeated winch tension carries Red to the bell.
- `The King Shot` (seed 1881): Green takes the direct royal shot before the
  catch bed arrives.

The public replay generator uses denser frames for short matches and a four
second interval for the full ten-minute record.

## Verification Contract

`npm run check` covers the single authority, deterministic fixed step,
transform-write tripwire, tower topology, physical support, mirrored inventory,
all four joint classes, collision-aware workers and two-worker carry, the manual
lever/ramp/ram/hoist fixtures, four battle machines, concurrent three-person
crews, physical ram/stone/catch evidence, deterministic replay, three seeded
opening targets, model-ID validation, manual takeover, and production build.

Browser acceptance must additionally verify desktop and mobile layout, visible
machine geometry, nonblank moving PlayCanvas output, playback transport,
collapsed Watch status, and zero application console errors before Gate 6 is
called current.

## Gate 6 Browser Acceptance

Date: 2026-08-05

- The exact static GitHub Pages path loaded `The Sledgebreaker` from the public
  replay manifest and autoplayed at 2x.
- The 1280 x 720 PlayCanvas was nonblank and showed the tower, Humpty, four
  battle machines, six crew figures, and persistent inventory without overlap.
- Pause, restart, ten-second forward, scrubber state, and replay speed updated
  the Watch status and timeline correctly.
- Collapsed Watch retained back, play/pause, forward, current replay time, and
  the current Red/Green chain result.
- Archive exposed three accurate outcomes: a 53-second Green win, a ten-minute
  Red win, and a 13-second Green win.
- At 390 x 844, the expanded ledger and compact stage had no horizontal
  overflow; stage controls, title, mode clock, and compact ledger occupied
  separate bounds.
- Browser diagnostics reported a 1280 x 720 canvas, no application errors, and
  no browser console errors.
- Screenshot evidence:
  `docs/screenshots/gate6-battle-redesign-2026-08-05.png`.
