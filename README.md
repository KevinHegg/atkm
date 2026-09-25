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
- **Fire:** click. On touch screens, drag to aim and tap **Fire**.
- **Look around:** drag, or right-drag. Scroll to zoom. **C** resets the view.
- **Change shot:** keys **1–4**, or the tray.
- **R** restarts the verse, **Esc** opens the verse list, **M** mutes.

## Rules

- **Only a fall breaks him.** Cannonballs push Humpty, but he cracks only when he
  hits something hard at speed. Roughly a 2 m drop does it.
- **Soft things save him.** Hay, stretchers and the arms of the King's men cushion him.
- **The King's men put him back.** When he lands safely, the stagehands lower a hook
  from the flies and hoist him back to the highest perch near his old spot. That
  costs you the shot.
- **Stars:** crack him; crack him with a shot to spare; crack him with a drop of at
  least the verse's *great fall* height.
- **Ordnance:**
  - **Round shot** is a flat, heavy punch.
  - **Mortar shells** lob over walls and burst on contact.
  - **Grapeshot** sprays small balls that bowl over the King's men.
  - **Chain shot** is two spinning balls on a chain.
- **Powder kegs** explode when struck hard, and set off their neighbours.
- **The King's men** carry stretchers and drive horse carts. They run to where Humpty
  will land. Knock them over (they get back up) or time your shot while they're
  away.

## Development

```bash
npm run typecheck   # strict TypeScript
npm test            # physics rules + every verse stands still and is winnable
npm run solve       # brute-force shot search: difficulty report per verse
npm run solve -- --write           # re-record par solutions in src/sim/par.json
npx tsx scripts/trace.ts <verse-id> <ammo> x y z [wait]   # trace one shot
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
  level.ts      level format and the Mason builder (walls, towers, pillars, hay, kegs)
  levels.ts     the eight verses
  ballistics.ts ammunition and launch solutions
  autoplay.ts   headless play-through used by tests and the solver
  par.json      one recorded winning line per verse
src/render/   PlayCanvas presentation, reads the sim and never writes it
  kit.ts        palette, material cache, primitives, lathe and baked-box meshes
  props.ts      Humpty, the Queen, King's men, horses, guns, blocks, kegs, hay
  stage.ts      the toy theatre: boards, painted backdrop, wings, proscenium
  view.ts       sync + interpolation, animation, aim arc, effects, camera
src/main.ts   screens, HUD, input, speech bubbles, the frame loop
src/audio.ts  procedural foley and the recorded royal voices
src/lines.ts  who says what, and when
```

The simulation steps at a fixed 60 Hz and is deterministic for a given build, so
tests and the solver replay shots exactly. Slow motion only changes how many
fixed steps run per real second.

The previous simultaneous-order siege game is preserved on the
`core-legibility-reset` branch.
