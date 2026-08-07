# All the King's Men

A PlayCanvas toy-theatre siege about one terrible hill. Green spends finite
round shot, mortar shells, and matchlock volleys to crack Humpty; Red uses
gabions, raids, a rescue capstan, and one last-chance litter to hold ten bells.

The game uses simultaneous orders. Each commander secretly commits one formed
unit, both orders reveal together, and the server resolves cover, fire, damage,
cooldowns, rescue effects, and victory before the next turn.

## Run It

Requirements: Node.js 20 or newer.

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173).

```bash
npm run typecheck
npm run lint
npm test
npm run generate:public-replays
npm run build
npm run check
```

No OpenAI key is required. The commanders use deterministic, seeded utility
rules so every battle can be replayed exactly.

## The Field

Red commands Royal Sappers, a Rescue Capstan, and a Gabion Rescue Cart. Green
commands a wheeled Demi-Culverin, a Bed Mortar, and a Matchlock Company. The
17th-century toy-armory silhouettes include powder chests, woven gabions,
straw litter, slow match, and visible finite shot. Equipment has visible
integrity, ammunition, and cooldown state.

The right ledger provides:

- **Watch:** battle clock, targets, simultaneous orders, equipment, public
  record, and replay transport;
- **Archive:** complete seeded battles and their outcomes;
- **Command:** legal unit, order, and target controls during the planning
  window.

Collapsing the ledger preserves view-specific controls and status. The stage
controls pause, refit the camera, expose physical diagnostics, and restart.

## Architecture

Rapier 3D on the server is the only gameplay physics world. PlayCanvas renders
public snapshots. `server/core/siege-rules.ts` owns the tactical rules;
`server/core/battle-director.ts` owns turn timing; `shared/core-protocol.ts`
defines the public contract.

GitHub Pages serves three packaged battle replays from `public/replays`. It is a
static theatre and cannot host the local Node/WebSocket simulation or accept
live orders.

The earlier loose-part construction kit remains as an isolated engineering
test bed. It is not spawned by the main battle and is not shown in the primary
interface.
