# The Great Fall — working rules

## The game

A single-player browser physics game in a toy theatre. The player is the Queen's
gunner. Each verse (level) is a diorama with Humpty perched high; the goal is to
make him fall far enough to crack. The King's men (stretcher crews, horse carts,
guards) and soft things (hay) protect him. Safe landings are undone by the
stagehands' hoist, which costs the player that shot.

Core promises:

- Only a hard impact cracks Humpty. Projectile contact never cracks him directly,
  and crew contact never cracks him.
- The aim arc is honest: it is the real launch solution, and it stops at the first
  collider the shot will touch.
- Every verse must stand still until the first shot and must have a recorded
  winning line in `src/sim/par.json`.

## Source of truth

- `src/sim/game.ts`: physics world, projectiles, the crack rule, explosions,
  hoist, phases, stars;
- `src/sim/crew.ts`: King's men movement, landing prediction, stun/recover;
- `src/sim/levels.ts` with `src/sim/level.ts`: verse layouts via the `Mason` builder;
- `src/sim/ballistics.ts`: ammunition specs and launch solutions;
- `src/render/*`: PlayCanvas presentation (kit, props, stage, view);
- `src/main.ts`: screens, HUD, input, speech, frame loop;
- `src/audio.ts`, `src/lines.ts`: sound and dialogue.

## Commands

- Development: `npm run dev`
- Type checking: `npm run typecheck`
- Tests: `npm test`
- Difficulty report / par solutions: `npm run solve`, `npm run solve -- --write`
- Trace a single shot: `npx tsx scripts/trace.ts <verse-id> <ammo> x y z [wait]`
- Production build: `npm run build`
- Full acceptance: `npm run check`

## Non-negotiable rules

- `src/sim` never imports PlayCanvas or touches the DOM. It must run headless in
  Node for tests and the solver.
- `src/render` reads simulation state and events; it never moves physics bodies or
  changes rules.
- The simulation steps at a fixed `STEP` (1/60 s). Slow motion and hit-stop change
  how many steps run per real second, never the step size.
- Never remove or create Rapier bodies inside an event-queue drain or query
  callback. Record what happened and act after the drain; Rapier holds world
  borrows during callbacks.
- Shared meshes in `Kit` are reference-held on creation; do not destroy them.
- Keep the look: chunky primitives, the oak/iron/bronze/crimson/verdigris palette,
  warm key light, the toy-theatre stage. Visual variety goes into props and
  scenery, not new rendering techniques.
- After changing physics constants, level layouts or crew behaviour, run
  `npm run solve -- --write` and `npm test`. A verse without a par line is broken.
- Browser storage holds only per-player progress (stars, mute) and must tolerate
  being unavailable.
