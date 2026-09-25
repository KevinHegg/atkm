# The Great Fall

*Humpty Dumpty sat on a wall. You have a cannon.*

A toy-theatre physics game for the browser. You are the mad Queen's gunner.
Each verse is a little diorama of oak blocks, stone and powder kegs with
Humpty perched on top. Knock him off and make him fall far enough to crack.
The King's men, their stretcher crews and the King's horses will try to
catch him.

## Play

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). Add `?all` to the URL to
unlock every verse.

- **Aim:** point at anything. A dotted arc shows the shot, and a red ring means it hits Humpty.
  Off a bronze bumper the arc keeps going, so you can line up a bank shot. The gold ring on the
  rug marks the gun that will fire, and you can see what it's loaded with in its mouth.
- **Fire:** click. On touch screens, drag to aim and tap **Fire**.
- **Look around:** drag, the arrow buttons by the tray, or **←/→**. Scroll to zoom. **C** resets the view.
  Some verses hide things behind scenery; it pays to look.
- **Change shot:** keys **1–5**, or the tray. **6** is the Queen's blunderbuss when a rat appears.
- **How high is he?** The star for a great fall asks for a drop of so many metres. The chip at the
  top says how high he sits, and a surveyor's line from his feet to the boards shows it on stage
  at the start of each verse, whenever you aim at him, or when you hover over the chip.
- **R** restarts the verse, **Esc** opens the verse list, **M** mutes. These controls sit in the bottom bar,
  next to the tray.

## Rules

- **Only a fall breaks him.** Cannonballs push Humpty, but he cracks only when he
  hits something hard at speed. Roughly a 2 m drop does it.
- **Soft things save him.** Hay, stretchers and the arms of the King's men cushion him.
- **The King's men put him back.** When he lands safely, the stagehands lower a hook
  from the flies and hoist him back to the highest perch near his old spot. That
  costs you the shot.
- **The verse ends when he cracks.** Until then, everything you break, bowl over, ring or
  startle counts as **mayhem**, and the King sends you the bill. Each verse has a spare
  round shot for exploring: spend it on mischief, but save enough to finish the job.
- **Stars:** crack him; crack him with a drop of at least the verse's *great fall* height;
  crack him after causing the verse's target of mayhem. Your best mayhem per verse is kept.
- **Reviews and replays.** After the curtain the morning papers review the performance,
  and **Replay** shows the final shot again in slow motion. The simulation is
  deterministic, so the replay is exact.
- **Ordnance:**
  - **Round shot** is a flat, heavy punch.
  - **Mortar shells** lob over walls and burst on contact.
  - **Grapeshot** sprays small balls that bowl over the King's men.
  - **Chain shot** is two spinning balls on a chain. The chain is a blade: it knocks the
    blocks it sweeps through and it cuts rope and maypoles.
  - **Fizzing bombs** are lobbed from the mortar. The fuse is lit when the bomb lands; it
    bounces and rolls, then goes off wherever it has got to.
- **Powder kegs** explode when struck hard, and set off their neighbours. Stone and brick
  keep a blast's flash from reaching powder on the other side.
- **The King's men** carry stretchers and drive horse carts. They run to where Humpty
  will land. Knock them over (they get back up) or time your shot while they're
  away.
- **Precarious perches.** The Queen's music box turns Humpty round on its arm, so
  timing decides where he falls. A shot on the arm spins it. His swing hangs on four
  ropes that only chain shot can cut. His see-saw is a trebuchet: drop the anvil on
  the short end. His maypole is planted in the stage, and nothing moves it but chain
  shot, which cuts it down like a tree. A royal canopy takes a mortar blast for him.
- **Stage cues.** Some verses hide a small puzzle that sets the stage. Ring the dinner
  gong and every one of the King's men downs tools for lunch (a timer at the top says
  when they'll be back).
- **Bumpers and screens.** Bronze bumpers bounce round shot cleanly. Painted screens
  and hedges hide what's behind them, including hay.
- **The rat.** In later verses a giant rat creeps out of the wings to gnaw the Queen's
  powder. If he reaches it he steals a charge, but never the last one. The Queen's
  blunderbuss (key **6**) sends him packing without spending a shot.
- **Curios.** The scenery is full of nursery rhymes. Shoot the cow, the moon, Jack and
  Jill's hill, the cuckoo clock, the well, the spider, the Grand Old Duke of York's men
  on the painted hill, or Old King Cole in his royal box, and see what happens. None of
  them change the verse, but each pays mayhem once.
- **Gags.** A painter's pot on a stepladder, knocked onto a guard's head, blinds his crew
  for a while. A sandbag hanging from the flies swings like a wrecking ball when shot;
  chain shot cuts it loose. The stagehands who work the hoist can be seen in the wings,
  and one comes on with a mop when it's all over.
- **The Court Astrologer.** Lose a verse and, on the retry, a green ring marks a known
  winning shot. Aim anywhere inside it and your shot becomes his exactly.

## Development

```bash
npm run typecheck   # strict TypeScript
npm test            # physics rules + every verse stands still and is winnable
npm run solve       # brute-force shot search: difficulty report per verse
npm run solve -- --write           # re-record par solutions in src/sim/par.json
npm run solve -- --mayhem          # also report mayhem: the par line alone and with one exploring shot
                                   # (the most robust winning line, so hints survive a human hand)
npx tsx scripts/trace.ts <verse-id> <ammo> x y z [wait]   # trace one shot
npx tsx scripts/probe.ts <verse-id> <ammo> <xs> <ys> <zs> [opener-json]   # grid of shots
npm run build       # static site in dist/
npm run check       # all of the above that CI needs
```

The game is a static site. It deploys to GitHub Pages from
`.github/workflows/pages.yml`.

## Architecture

```
src/sim/      rules and physics, headless, no rendering
  game.ts       Rapier world, projectiles, the crack rule, explosions, hoist, phases
  crew.ts       King's men: patrol, landing prediction, stun
  rat.ts        the rat: creep, gnaw, flee
  mayhem.ts     the score: what everything is worth on the King's bill
  curios.ts     where the nursery-rhyme curios hide (shared with the scenery)
  geometry.ts   small vector helpers for ropes and rides
  level.ts      level format and the Mason builder (walls, towers, pillars, hay, kegs,
                fixtures, bumpers, hedges, turntables, swings, see-saws, canopies,
                maypoles, gongs, railings, houses)
  levels.ts     the thirteen verses
  ballistics.ts ammunition and launch solutions
  autoplay.ts   headless play-through used by tests and the solver
  par.json      one recorded winning line per verse
src/render/   PlayCanvas presentation, reads the sim and never writes it
  kit.ts        palette, material cache, primitives, lathe and baked-box meshes
  props.ts      Humpty, the Queen, King's men, horses, guns, blocks, kegs, hay
  stage.ts      the toy theatre: boards, painted backdrop, wings, proscenium
  curios.ts     the curios' little scenes
  company.ts    stagehands, Old King Cole in his box, the Grand Old Duke of York's men
  view.ts       sync + interpolation, animation, aim arc, effects, camera
src/main.ts   screens, HUD, input, speech bubbles, replays, the frame loop
src/review.ts the morning papers, written from the bill of damages
src/audio.ts  procedural foley, a music box, a theatre audience, the recorded royal voices
src/lines.ts  who says what, and when
```

The simulation steps at a fixed 60 Hz and is deterministic for a given build, so
tests and the solver replay shots exactly. Slow motion only changes how many
fixed steps run per real second.

The previous simultaneous-order siege game is preserved on the
`core-legibility-reset` branch.
