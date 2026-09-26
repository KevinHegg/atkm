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
  collider the shot will touch. Off a bumper it continues with the true bounce. Chain
  shot's arc follows both whirling balls (`chainOffset` predicts them to a few cm), so it
  stops where a ball first clips something, and marks each rope its chain will cut.
  Pointing picks curio sensors and snaps onto ropes, so a player can aim at either;
  the arc marks a curio it flies through. Only mark what the physics will do.
- Only chain shot cuts rope and maypoles; nothing else moves a maypole. Curios never
  change a verse's physics (they pay mayhem once and may hide its star). The rat never steals the last charge, and the blunderbuss never spends
  a verse's shot.
- A bomb's fuse is lit when it first lands. Stone and brick between a blast and a powder
  keg keep the keg from going off (the blast still pushes things).
- Stage cues (the dinner gong, the wind machine, the trapdoor lever, the portcullis
  counterweight) are fixtures any stock shot can strike; lunch lasts `LUNCH_BREAK` seconds
  and nothing, not even a falling egg, interrupts it. The trapdoor (`Mason.trapRing`) drops
  every crew standing on its ring for `TRAP_TIME` seconds; trapped crews can't be stunned
  or sent to lunch. The portcullis (`Mason.gatehouse`) rises for `GATE_TIME` seconds. The
  beehive (`Mason.beehive`, cue `hive`) lets out a swarm for `SWARM_TIME` seconds that goes
  after the nearest crew able to catch, then the next; stung crews (`sting`, mode `stung`)
  don't run to catch him (though a bed that happens to be under him still breaks his fall). Stung bearers run only along their own beat (`beatOf`), and carts and guards
  stay put, so a panic never ploughs a crew into scenery: keep every litter's beat clear.
- The revolve (`Mason.revolve`, turned by `Mason.capstan`, cue `revolve`) is a kinematic ring
  of convex sectors round a fixed middle; it turns `turn` radians over `time` seconds, eased,
  and carries what rests on it by friction (everything is woken when it starts). Wreckage is
  measured against start positions turned round with it (`carryRound`), so a ride is never
  billed. Its sectors run well below the boards so a falling egg can't sink into them, and
  Humpty's landings sum the force from every collider of one body in a step, so coming down
  on a seam is the same blow as anywhere else.
- Side challenges (`src/sim/challenges.ts`) are judged in the simulation at the crack
  (`judgeChallenge`), from the bill and a few counters; like stars, they count only if he
  cracks. Each is proved possible by a recorded line in the tests, and no verse's par line
  may meet its own challenge. Rosettes are saved per player in `progress.challenges`.
- Mousetraps (`Mason.mousetrap`) are armed only by a stock shot or a blast. The rat, once
  round his waypoint, goes for an armed trap's cheese instead of the powder (`stepRat` bait),
  and is caught (`catchRat`): he steals nothing that visit.
- Banana skins (`Mason.peel`) trip any crew on the move whose footprint passes over them,
  but only once a stock shot or a blast has armed them. A shot flicks a skin (`flickPeel`) at a
  speed set by the shot's, not with the cannonball's full blow, and the skin ignores that
  ball for a moment so it isn't shoved twice.
- Machines are kinematic bodies driven in `updateMachines`: the weathercock (`Mason.vane`)
  turns `step` per blow, the carousel (`Mason.carousel`) turns steadily, the portcullis
  slides. The chute (`Mason.chute`) is a fixed trough with a scoring sensor in its hopper.
  The aim arc leaves the carousel out of its casts and sweeps the ball against its paddles
  where they will be when the shot arrives (`paddleHit`); keep that true if you change it.
- Dominoes (`Mason.dominoes`, material `domino`) are ordinary blocks, except that one
  toppling onto a stage cue calls it, as a shot would. `Mason.barrelRamp` lays a keg on its
  side behind a chock (cue `release`); its fuse lights once it's rolling. Keep every domino's
  fall, and the cart's turning circle, clear of the barrel's road.
- Bodies start asleep so verses stand still. Anything moving briskly wakes whatever it is
  still touching (`wakeSupported`), so nothing is left hanging when its support is shot away.
- Each stock shot opens a combo tally (`Game.combo`); it closes at the next shot, at the crack
  (before the crack is billed) or after two quiet seconds, and three or more distinct mayhem
  kinds earn `comboBonus`. Par lines rarely combo, so mayhem targets still come from the solver.
- Teetering (`checkTeeter`) is a query only: a probe a hand's breadth past him, the way he was
  last shoved. It never pushes him; rides are exempt.
- The King's china (`Mason.dresser`, `dresserChina`) is sensors on a fixed dresser, like
  curios: shots pass through, each piece pays `china` mayhem once, a direct hit rattles only
  the pieces either side of it (`shock`), a blast within 0.8 of its radius smashes what's in
  reach. It never touches physics. The view shrinks smashed pieces rather than disabling
  them, so the actors batch isn't rebuilt.
- The crowd and pit orchestra (`listenToCrowd` in `src/main.ts`) only listen: a snare roll
  while he teeters or falls, a cymbal on the crack, near-miss gasps scaled by how close each
  shot passed his shell. Sound only; nothing in the sim depends on it.
- The gun reloads `FALLING_RELOAD` times faster while Humpty is airborne, so a parting
  shot or two can add mayhem before he lands, but never a volley.
- The verse ends when Humpty cracks. Mayhem (`src/sim/mayhem.ts`) is scored in the
  simulation, frozen at the crack (the crack and its great-fall bonus are the last
  entries); each curio pays once. Stars, all registered only if he cracks: crack, mayhem
  target (`LevelDef.mayhem`), and the hidden star (`LevelDef.star`: a crew id, a curio,
  or the rat; released when a munition knocks that figure down). Set mayhem targets with
  `npm run solve -- --mayhem`: about the par line's mayhem plus one good exploring shot.
- Every verse has one treasure chest (`Mason.chest`): any munition that reaches it, or a
  blast within 2 m, opens it for three rounds: one of the kind that opened it (a keg's
  blast counts as the last shot fired), then `CHEST_EXTRA` more, one at a time, to the
  rack emptiest against the verse's starting stock, left to right on a tie (`Game.issued`
  tracks the totals for the tray). Nothing opens after the crack.
- With the battery empty, the verse is lost as soon as Humpty has come down safe and
  nothing is flying, fizzing or about to blow; it does not wait for swinging scenery.
- A shot that strikes one of the King's men fair and square bowls his crew over, as well
  as the contact-force rule for things falling on them.
- Nothing scores and no star is released before the Queen's first shot, and the free
  blunderbuss earns nothing but a scared rat (no chests, no bowled crews, no curios).
  Every verse must sit a full minute untouched without cracking, scoring or releasing its
  star (tests check this).
- Every shot is logged by step (`Game.log`); replays re-fire the log on a fresh game.
  Anything that makes the simulation depend on wall-clock time or `Math.random` breaks
  replays and the solver.
- The Court Astrologer's hint is the first shot of the recorded par line; aiming
  inside its ring fires exactly that shot.
- Every verse must stand still until the first shot and must have a recorded
  winning line in `src/sim/par.json`. The obvious lazy shot (round shot straight at
  Humpty, a shell on his head) should not be what wins a verse built around a mechanic;
  check with `npm run solve` and the one-shot win rate.

## Source of truth

- `src/sim/game.ts`: physics world, projectiles, the crack rule, explosions,
  hoist, phases, stars;
- `src/sim/crew.ts`: King's men movement, landing prediction, stun/recover, lunch and
  the trapdoor;
- `src/sim/rat.ts`: the rat's visits; `src/sim/curios.ts`: curio positions shared
  with `src/render/curios.ts`;
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
- Grid-test shots (optionally after an opener): `npx tsx scripts/probe.ts <verse-id> <ammo> <xs> <ys> <zs> [opener-json]`
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
- Keep draw calls down: long-lived bodies go in the "actors" dynamic batch group,
  static scenery in the "scenery" batch, and new figures bake their fixed parts with
  `kit.boxes`. The Queen and the curios batch too; anything a figure toggles on and
  off (a cat in the well, a daze of stars) goes in `UNBATCHED`. Check
  `app.stats.drawCalls` in a visible tab after adding scenery.
- Effect particles (puffs, sparks, flashes, confetti) come from pools in `view.ts`:
  `retire()` them, never destroy them. The pixel ratio steps down on slow machines
  (`governPixelRatio`) and back up when frames are quick again.
- Keep the look: chunky primitives, the oak/iron/bronze/crimson/verdigris palette,
  warm key light, the toy-theatre stage. Visual variety goes into props and
  scenery, not new rendering techniques.
- After changing physics constants, level layouts or crew behaviour, run
  `npm run solve -- --write` and `npm test`. A verse without a par line is broken.
  The solver records the most robust winning line (it re-runs candidates with the
  aim nudged and fired late) because that line becomes the player's hint.
- Moving rides (turntable, swing, see-saw) must start Humpty awake and give the
  hoist a perch to return him to; fall back to the highest perch when the ride is
  spent.
- Browser storage holds only per-player progress (stars, best mayhem, whether the
  finale has played, mute) and must tolerate being unavailable. Bump `STORAGE_KEY` in
  `src/main.ts` (listing the old key for removal) only when a scoring change makes old
  stars meaningless. Winning all `LEVELS.length * 3` stars plays the Grand Finale once.
